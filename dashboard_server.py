#!/usr/bin/env python3
"""
JUST NATION — Dashboard API Server
Serves customer, product, and delivery data from Notion to the Daily Briefing dashboard.
Runs on http://localhost:5050
"""

import json
import os
import re
import threading
import time
import requests
from pathlib import Path
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
from flask import Flask, jsonify, request, send_file, send_from_directory, redirect
from flask_cors import CORS

# Load .env file for QBO credentials and other config
try:
    from dotenv import load_dotenv
    # Check Yardhouse dir first, then parent (Pallet Operations) dir
    env_path = Path(__file__).parent / '.env'
    if not env_path.exists():
        env_path = Path(__file__).parent.parent / '.env'
    load_dotenv(env_path)
except ImportError:
    pass  # python-dotenv not installed, rely on shell environment

app = Flask(__name__)
CORS(app)

# ── API Key Authentication ──────────────────────────────────────────────
@app.before_request
def check_api_key():
    """Require X-API-Key header on API routes when API_KEY is set."""
    api_key = os.environ.get("API_KEY")
    if not api_key:
        return  # No key configured = open access (local dev)
    exempt = ['/health', '/qbo/callback', '/qbo/exchange']
    if request.path in exempt:
        return
    if request.path.startswith('/api/') or request.path.startswith('/qbo/'):
        provided = request.headers.get('X-API-Key')
        if not provided or provided != api_key:
            return jsonify({"error": "Unauthorized"}), 401

# QuickBooks Online integration
try:
    import qbo_integration as qbo
except ImportError:
    qbo = None

# ── Railway QBO Proxy (for coworkers without local QBO tokens) ────────
RAILWAY_URL = os.environ.get("RAILWAY_URL", "https://unique-patience-production-3270.up.railway.app")
RAILWAY_API_KEY = os.environ.get("RAILWAY_API_KEY", "")

def _qbo_available_locally():
    """Check if QBO is usable on this machine."""
    return qbo and qbo.is_connected()

def _proxy_qbo_from_railway(path):
    """Fetch QBO data from Railway when local QBO isn't connected."""
    if not RAILWAY_API_KEY:
        return None
    try:
        url = f"{RAILWAY_URL}{path}"
        resp = requests.get(url, headers={"X-API-Key": RAILWAY_API_KEY}, timeout=10)
        if resp.status_code == 200:
            return resp.json()
    except Exception as e:
        print(f"   Railway QBO proxy error: {e}", flush=True)
    return None

# Anthropic AI Chat
try:
    import anthropic
    ANTHROPIC_KEY = os.environ.get("ANTHROPIC_API_KEY", "")
    ai_client = anthropic.Anthropic(api_key=ANTHROPIC_KEY) if ANTHROPIC_KEY else None
except ImportError:
    ai_client = None

# Email poller
try:
    import email_poller
except ImportError:
    email_poller = None

BRIEFING_PATH = Path(__file__).parent / "briefing-data.json"

# ============================================================================
# Notion API Configuration
# ============================================================================

NOTION_TOKEN = os.environ.get("NOTION_TOKEN", "") or os.environ.get("NOTION_API_KEY", "")
NOTION_VERSION = "2022-06-28"
NOTION_BASE = "https://api.notion.com/v1"

# Database IDs (from Notion page URLs, NOT collection IDs)
COMPANIES_DB = "fadc95374fe64eb3be43d38b3950dc66"        # Companies
CONTACTS_DB  = "30ab735b971480c08a41f31ac6f086ef"        # Contacts
PRODUCTS_DB  = "10890dd37a914fef9be6265af09aa50a"        # Products & Services
DELIVERY_DB  = "fa9ae860cff447a38344a84e4c73f81f"        # Delivery Schedule
PRODUCTION_DB = "6bc75026325d4d5097f6a8b79cc1795a"       # Employee Production

HEADERS = {
    "Authorization": f"Bearer {NOTION_TOKEN}",
    "Notion-Version": NOTION_VERSION,
    "Content-Type": "application/json",
}

# ============================================================================
# Notion API Helpers
# ============================================================================

def notion_query(database_id, filter_obj=None, sorts=None, page_size=100):
    """Query a Notion database and return all pages."""
    url = f"{NOTION_BASE}/databases/{database_id}/query"
    payload = {"page_size": page_size}
    if filter_obj:
        payload["filter"] = filter_obj
    if sorts:
        payload["sorts"] = sorts

    all_results = []
    has_more = True
    start_cursor = None

    while has_more:
        if start_cursor:
            payload["start_cursor"] = start_cursor
        resp = requests.post(url, headers=HEADERS, json=payload)
        if resp.status_code != 200:
            print(f"Notion API error {resp.status_code}: {resp.text[:200]}")
            break
        data = resp.json()
        all_results.extend(data.get("results", []))
        has_more = data.get("has_more", False)
        start_cursor = data.get("next_cursor")

    return all_results


def get_property_value(page, prop_name):
    """Extract a plain value from a Notion page property."""
    props = page.get("properties", {})
    prop = props.get(prop_name)
    if not prop:
        return None

    ptype = prop.get("type")

    if ptype == "title":
        items = prop.get("title", [])
        return "".join(t.get("plain_text", "") for t in items) if items else None

    elif ptype == "rich_text":
        items = prop.get("rich_text", [])
        return "".join(t.get("plain_text", "") for t in items) if items else None

    elif ptype == "number":
        return prop.get("number")

    elif ptype == "select":
        sel = prop.get("select")
        return sel.get("name") if sel else None

    elif ptype == "multi_select":
        return [s.get("name") for s in prop.get("multi_select", [])]

    elif ptype == "status":
        st = prop.get("status")
        return st.get("name") if st else None

    elif ptype == "date":
        d = prop.get("date")
        return d.get("start") if d else None

    elif ptype == "email":
        return prop.get("email")

    elif ptype == "phone_number":
        return prop.get("phone_number")

    elif ptype == "url":
        return prop.get("url")

    elif ptype == "relation":
        return [r.get("id") for r in prop.get("relation", [])]

    elif ptype == "checkbox":
        return prop.get("checkbox")

    return None


def get_page_url(page):
    """Get the Notion URL for a page."""
    return page.get("url", "")


def get_page_id(page):
    """Get the page ID."""
    return page.get("id", "")


# ============================================================================
# Cache (persistent until invalidated)
# ============================================================================

_cache = {}

def cached(key, fetcher):
    """Persistent cache — only refreshed on explicit invalidation."""
    if key in _cache:
        return _cache[key]
    data = fetcher()
    _cache[key] = data
    return data


def clear_cache():
    _cache.clear()


def invalidate_cache(*keys):
    """Invalidate specific cache keys (e.g. after a save)."""
    for key in keys:
        _cache.pop(key, None)


# ============================================================================
# Data Fetchers
# ============================================================================

def fetch_all_contacts():
    """Fetch all contacts and index by page ID."""
    pages = notion_query(CONTACTS_DB)
    contacts = {}
    for p in pages:
        pid = get_page_id(p)
        contacts[pid] = {
            "name": get_property_value(p, "Contact"),
            "email": get_property_value(p, "E-mail"),
            "phone": get_property_value(p, "Business Phone") or get_property_value(p, "Mobile Phone"),
            "title": get_property_value(p, "Job Title"),
            "department": get_property_value(p, "Department"),
        }
    return contacts


def fetch_all_companies():
    """Fetch all companies with their contacts."""
    contact_index = cached("contacts", fetch_all_contacts)
    pages = notion_query(COMPANIES_DB)

    companies = []
    for p in pages:
        pid = get_page_id(p)
        name = get_property_value(p, "Customer")
        if not name:
            continue

        # Resolve contact relations
        contact_ids = get_property_value(p, "Contact") or []
        resolved_contacts = []
        for cid in contact_ids:
            c = contact_index.get(cid, {})
            if c.get("name"):
                resolved_contacts.append({
                    "name": c.get("name", ""),
                    "email": c.get("email", ""),
                    "phone": c.get("phone", ""),
                    "title": c.get("title", ""),
                })

        companies.append({
            "id": pid,
            "name": name,
            "address": get_property_value(p, "Shipping Address") or "",
            "address2": get_property_value(p, "Address 2") or "",
            "billingAddress": get_property_value(p, "Billing Address") or "",
            "phone": get_property_value(p, "Phone") or "",
            "group": get_property_value(p, "Group") or "",
            "hours": get_property_value(p, "Hours") or "",
            "notes": get_property_value(p, "Notes") or "",
            "contacts": resolved_contacts,
            "notionUrl": get_page_url(p),
        })

    return companies


def fetch_all_products():
    """Fetch ALL products and index by company ID."""
    pages = notion_query(PRODUCTS_DB)
    products_by_company = {}

    for p in pages:
        # Get company relation IDs
        company_ids = get_property_value(p, "Company") or []
        product = {
            "id": get_page_id(p),
            "product": get_property_value(p, "Product/Service") or "",
            "name": get_property_value(p, "Product/Service") or "",
            "description": get_property_value(p, "Description") or "",
            "price": get_property_value(p, "Price"),
            "cost": get_property_value(p, "Cost"),
            "category": get_property_value(p, "Category") or "",
        }
        for cid in company_ids:
            if cid not in products_by_company:
                products_by_company[cid] = []
            products_by_company[cid].append(product)

    return products_by_company


def fetch_products_for_company(company_name):
    """Fetch products linked to a specific company."""
    # First find the company page ID
    companies = cached("companies", fetch_all_companies)
    company_id = None
    for c in companies:
        if c["name"].lower().strip() == company_name.lower().strip():
            company_id = c["id"]
            break

    if not company_id:
        # Try partial match
        for c in companies:
            if company_name.lower() in c["name"].lower():
                company_id = c["id"]
                break

    if not company_id:
        return []

    # Query products with relation filter
    filter_obj = {
        "property": "Company",
        "relation": {"contains": company_id}
    }
    pages = notion_query(PRODUCTS_DB, filter_obj=filter_obj)

    products = []
    for p in pages:
        products.append({
            "id": get_page_id(p),
            "product": get_property_value(p, "Product/Service") or "",
            "name": get_property_value(p, "Product/Service") or "",
            "description": get_property_value(p, "Description") or "",
            "price": get_property_value(p, "Price"),
            "cost": get_property_value(p, "Cost"),
            "category": get_property_value(p, "Category") or "",
        })

    return products


def normalize_id(uid):
    """Strip dashes from a UUID for consistent comparison."""
    return (uid or "").replace("-", "").lower()


def _now_eastern():
    """Return current datetime in US/Eastern timezone."""
    return datetime.now(ZoneInfo("America/New_York"))

def fetch_deliveries(days_ahead=0):
    """Fetch deliveries. days_ahead=0 means today only."""
    now_et = _now_eastern()
    today = now_et.strftime("%Y-%m-%d")
    end_date = (now_et + timedelta(days=days_ahead)).strftime("%Y-%m-%d")

    filter_obj = {
        "and": [
            {"property": "Date", "date": {"on_or_after": today}},
            {"property": "Date", "date": {"on_or_before": end_date}},
        ]
    }
    sorts = [
        {"property": "Date", "direction": "ascending"},
        {"property": "Status", "direction": "ascending"},
    ]

    pages = notion_query(DELIVERY_DB, filter_obj=filter_obj, sorts=sorts)

    # Resolve company names — normalize IDs for reliable matching
    companies = cached("companies", fetch_all_companies)
    company_index = {normalize_id(c["id"]): c["name"] for c in companies}

    deliveries = []
    for p in pages:
        date_val = get_property_value(p, "Date") or ""
        company_ids = get_property_value(p, "Company") or []
        company_name = ""
        for cid in company_ids:
            match = company_index.get(normalize_id(cid), "")
            if match:
                company_name = match
                break

        # Use the title field as fallback label
        title = get_property_value(p, " ") or ""

        # Get the first company relation ID for editing
        company_id = ""
        if company_ids:
            company_id = company_ids[0]

        deliveries.append({
            "id": get_page_id(p),
            "date": date_val,
            "customer": company_name or title,
            "customerId": company_id,
            "title": title,
            "notes": get_property_value(p, "Notes") or "",
            "driver": get_property_value(p, "Driver") or "",
            "trip": get_property_value(p, "Trip #"),
            "status": get_property_value(p, "Status") or "",
            "type": get_property_value(p, "Type") or "",
            "notionUrl": get_page_url(p),
        })

    return deliveries


def fetch_deliveries_for_date(date_str):
    """Fetch deliveries for a specific date (YYYY-MM-DD)."""
    filter_obj = {
        "and": [
            {"property": "Date", "date": {"on_or_after": date_str}},
            {"property": "Date", "date": {"on_or_before": date_str}},
        ]
    }
    sorts = [
        {"property": "Date", "direction": "ascending"},
        {"property": "Status", "direction": "ascending"},
    ]

    pages = notion_query(DELIVERY_DB, filter_obj=filter_obj, sorts=sorts)

    companies = cached("companies", fetch_all_companies)
    company_index = {normalize_id(c["id"]): c["name"] for c in companies}

    deliveries = []
    for p in pages:
        date_val = get_property_value(p, "Date") or ""
        company_ids = get_property_value(p, "Company") or []
        company_name = ""
        for cid in company_ids:
            match = company_index.get(normalize_id(cid), "")
            if match:
                company_name = match
                break

        title = get_property_value(p, " ") or ""
        company_id = company_ids[0] if company_ids else ""

        deliveries.append({
            "id": get_page_id(p),
            "date": date_val,
            "customer": company_name or title,
            "customerId": company_id,
            "title": title,
            "notes": get_property_value(p, "Notes") or "",
            "driver": get_property_value(p, "Driver") or "",
            "trip": get_property_value(p, "Trip #"),
            "status": get_property_value(p, "Status") or "",
            "type": get_property_value(p, "Type") or "",
            "notionUrl": get_page_url(p),
        })

    return deliveries


def fetch_deliveries_range(start_str, end_str):
    """Fetch deliveries between start and end dates (inclusive)."""
    filter_obj = {
        "and": [
            {"property": "Date", "date": {"on_or_after": start_str}},
            {"property": "Date", "date": {"on_or_before": end_str}},
        ]
    }
    sorts = [
        {"property": "Date", "direction": "ascending"},
        {"property": "Status", "direction": "ascending"},
    ]

    pages = notion_query(DELIVERY_DB, filter_obj=filter_obj, sorts=sorts)

    companies = cached("companies", fetch_all_companies)
    company_index = {normalize_id(c["id"]): c["name"] for c in companies}

    deliveries = []
    for p in pages:
        date_val = get_property_value(p, "Date") or ""
        company_ids = get_property_value(p, "Company") or []
        company_name = ""
        for cid in company_ids:
            match = company_index.get(normalize_id(cid), "")
            if match:
                company_name = match
                break

        title = get_property_value(p, " ") or ""
        company_id = company_ids[0] if company_ids else ""

        deliveries.append({
            "id": get_page_id(p),
            "date": date_val,
            "customer": company_name or title,
            "customerId": company_id,
            "title": title,
            "notes": get_property_value(p, "Notes") or "",
            "driver": get_property_value(p, "Driver") or "",
            "trip": get_property_value(p, "Trip #"),
            "status": get_property_value(p, "Status") or "",
            "type": get_property_value(p, "Type") or "",
            "notionUrl": get_page_url(p),
        })

    return deliveries


# ============================================================================
# API Routes
# ============================================================================

@app.route("/api/customers", methods=["GET"])
def api_customers():
    """Return all companies with contacts."""
    try:
        companies = cached("companies", fetch_all_companies)
        contact_index = cached("contacts", fetch_all_contacts)
        return jsonify({
            "customers": companies,
            "contacts": contact_index,
            "count": len(companies),
        })
    except Exception as e:
        print(f"Error fetching customers: {e}")
        return jsonify({"error": str(e), "customers": []}), 500


@app.route("/api/customers-with-products", methods=["GET"])
def api_customers_with_products():
    """Return all companies with their products pre-loaded. Single API call."""
    try:
        companies = cached("companies", fetch_all_companies)
        products_index = cached("all_products", fetch_all_products)

        result = []
        for c in companies:
            company_products = products_index.get(c["id"], [])
            result.append({**c, "products": company_products})

        return jsonify({"customers": result, "count": len(result)})
    except Exception as e:
        print(f"Error fetching customers with products: {e}")
        return jsonify({"error": str(e), "customers": []}), 500


@app.route("/api/products", methods=["GET"])
def api_products():
    """Return products for a specific company."""
    company = request.args.get("company", "")
    if not company:
        return jsonify({"error": "company parameter required", "products": []}), 400

    try:
        products = fetch_products_for_company(company)
        return jsonify({"products": products, "count": len(products)})
    except Exception as e:
        print(f"Error fetching products for {company}: {e}")
        return jsonify({"error": str(e), "products": []}), 500


@app.route("/api/deliveries", methods=["GET"])
def api_deliveries():
    """Return deliveries. ?start=&end= for range, ?date= for single day, ?days=N for relative."""
    target_date = request.args.get("date")
    start_date = request.args.get("start")
    end_date = request.args.get("end")
    days = int(request.args.get("days", 0))
    try:
        if start_date and end_date:
            deliveries = fetch_deliveries_range(start_date, end_date)
        elif target_date:
            deliveries = fetch_deliveries_for_date(target_date)
        else:
            deliveries = fetch_deliveries(days_ahead=days)
        return jsonify({"deliveries": deliveries, "count": len(deliveries)})
    except Exception as e:
        print(f"Error fetching deliveries: {e}")
        return jsonify({"error": str(e), "deliveries": []}), 500


@app.route("/api/deliveries/<page_id>", methods=["PATCH"])
def api_update_delivery(page_id):
    """Update a delivery page in Notion."""
    data = request.get_json()
    if not data:
        return jsonify({"error": "No data provided"}), 400

    properties = {}

    # Status (type: status)
    if "status" in data:
        properties["Status"] = {"status": {"name": data["status"]}}

    # Driver (type: select)
    if "driver" in data:
        if data["driver"]:
            properties["Driver"] = {"select": {"name": data["driver"]}}
        else:
            properties["Driver"] = {"select": None}

    # Trip # (type: number)
    if "trip" in data:
        properties["Trip #"] = {"number": data["trip"] if data["trip"] is not None else None}

    # Notes (type: rich_text)
    if "notes" in data:
        properties["Notes"] = {
            "rich_text": [{"text": {"content": data["notes"]}}] if data["notes"] else []
        }

    # Type (type: select)
    if "type" in data:
        if data["type"]:
            properties["Type"] = {"select": {"name": data["type"]}}
        else:
            properties["Type"] = {"select": None}

    # Date (type: date)
    if "date" in data:
        if data["date"]:
            properties["Date"] = {"date": {"start": data["date"]}}
        else:
            properties["Date"] = {"date": None}

    # Customer (type: relation) — expects a company page ID
    if "customerId" in data:
        if data["customerId"]:
            properties["Company"] = {"relation": [{"id": data["customerId"]}]}
        else:
            properties["Company"] = {"relation": []}

    if not properties:
        return jsonify({"error": "No valid fields to update"}), 400

    try:
        url = f"{NOTION_BASE}/pages/{page_id}"
        resp = requests.patch(url, headers=HEADERS, json={"properties": properties})
        if resp.status_code != 200:
            return jsonify({"error": f"Notion API error: {resp.text[:300]}"}), resp.status_code
        clear_cache()
        return jsonify({"status": "ok", "id": page_id})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/customers/<page_id>", methods=["PATCH"])
def api_update_customer(page_id):
    """Update a company page in Notion."""
    data = request.get_json()
    if not data:
        return jsonify({"error": "No data provided"}), 400

    properties = {}

    # Address (type: rich_text)
    if "address" in data:
        properties["Address"] = {
            "rich_text": [{"text": {"content": data["address"]}}] if data["address"] else []
        }

    # Phone (type: phone_number)
    if "phone" in data:
        properties["Phone"] = {"phone_number": data["phone"] or None}

    # Notes (type: rich_text)
    if "notes" in data:
        properties["Notes"] = {
            "rich_text": [{"text": {"content": data["notes"]}}] if data["notes"] else []
        }

    # Hours (type: rich_text)
    if "hours" in data:
        properties["Hours"] = {
            "rich_text": [{"text": {"content": data["hours"]}}] if data["hours"] else []
        }

    if not properties:
        return jsonify({"error": "No valid fields to update"}), 400

    try:
        url = f"{NOTION_BASE}/pages/{page_id}"
        resp = requests.patch(url, headers=HEADERS, json={"properties": properties})
        if resp.status_code != 200:
            return jsonify({"error": f"Notion API error: {resp.text[:300]}"}), resp.status_code
        clear_cache()
        return jsonify({"status": "ok", "id": page_id})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/products/<page_id>", methods=["PATCH"])
def api_update_product(page_id):
    """Update a product page in Notion."""
    data = request.get_json()
    if not data:
        return jsonify({"error": "No data provided"}), 400

    properties = {}

    # Price (type: number)
    if "price" in data:
        properties["Price"] = {"number": float(data["price"]) if data["price"] is not None else None}

    # Cost (type: number)
    if "cost" in data:
        properties["Cost"] = {"number": float(data["cost"]) if data["cost"] is not None else None}

    if not properties:
        return jsonify({"error": "No valid fields to update"}), 400

    try:
        url = f"{NOTION_BASE}/pages/{page_id}"
        resp = requests.patch(url, headers=HEADERS, json={"properties": properties})
        if resp.status_code != 200:
            return jsonify({"error": f"Notion API error: {resp.text[:300]}"}), resp.status_code
        clear_cache()
        return jsonify({"status": "ok", "id": page_id})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/deliveries", methods=["POST"])
def api_create_delivery():
    """Create a new delivery page in Notion."""
    data = request.get_json()
    if not data:
        return jsonify({"error": "No data provided"}), 400

    properties = {}

    # Title property (the unnamed title column " ")
    title_text = data.get("title", "")
    properties[" "] = {"title": [{"text": {"content": title_text}}]}

    # Date (required)
    if data.get("date"):
        properties["Date"] = {"date": {"start": data["date"]}}

    # Status
    if data.get("status"):
        properties["Status"] = {"status": {"name": data["status"]}}
    else:
        properties["Status"] = {"status": {"name": "Scheduled"}}

    # Driver
    if data.get("driver"):
        properties["Driver"] = {"select": {"name": data["driver"]}}

    # Trip #
    if data.get("trip") is not None:
        properties["Trip #"] = {"number": data["trip"]}

    # Notes
    if data.get("notes"):
        properties["Notes"] = {
            "rich_text": [{"text": {"content": data["notes"]}}]
        }

    # Type
    if data.get("type"):
        properties["Type"] = {"select": {"name": data["type"]}}

    # Customer relation
    if data.get("customerId"):
        properties["Company"] = {"relation": [{"id": data["customerId"]}]}

    try:
        url = f"{NOTION_BASE}/pages"
        payload = {
            "parent": {"database_id": DELIVERY_DB},
            "properties": properties,
        }
        resp = requests.post(url, headers=HEADERS, json=payload)
        if resp.status_code != 200:
            return jsonify({"error": f"Notion API error: {resp.text[:300]}"}), resp.status_code
        new_page = resp.json()
        clear_cache()
        return jsonify({"status": "ok", "id": new_page.get("id", "")})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/deliveries/<page_id>", methods=["DELETE"])
def api_delete_delivery(page_id):
    """Archive (trash) a delivery page in Notion."""
    try:
        url = f"{NOTION_BASE}/pages/{page_id}"
        resp = requests.patch(url, headers=HEADERS, json={"archived": True})
        if resp.status_code != 200:
            return jsonify({"error": f"Notion API error: {resp.text[:300]}"}), resp.status_code
        clear_cache()
        return jsonify({"status": "ok", "id": page_id})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/cache/clear", methods=["POST"])
def api_clear_cache():
    """Clear the in-memory cache."""
    clear_cache()
    return jsonify({"status": "ok", "message": "Cache cleared"})


@app.route("/", methods=["GET"])
def serve_dashboard():
    """Serve the Daily Briefing dashboard."""
    import os
    html_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "Daily Briefing.html")
    if os.path.exists(html_path):
        return send_file(html_path)
    return "Dashboard HTML not found", 404


@app.route("/briefing-data.js", methods=["GET"])
def serve_briefing_data():
    """Serve the briefing data JS file."""
    import os
    js_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "briefing-data.js")
    if os.path.exists(js_path):
        return send_file(js_path, mimetype="application/javascript")
    return "window.BRIEFING_DATA = {};", 200, {"Content-Type": "application/javascript"}


@app.route("/Company Logo/<path:filename>", methods=["GET"])
def serve_logo(filename):
    """Serve files from the Company Logo folder."""
    import os
    logo_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "Company Logo")
    return send_from_directory(logo_dir, filename)


# ============================================================================
# QuickBooks Online Routes
# ============================================================================

@app.route("/qbo/status", methods=["GET"])
def qbo_status():
    """Check if QuickBooks is connected (locally or via Railway proxy)."""
    if _qbo_available_locally():
        return jsonify({"connected": True, "available": True})
    # Check if Railway proxy is available as fallback
    if RAILWAY_API_KEY:
        return jsonify({"connected": True, "available": True, "source": "railway"})
    if not qbo:
        return jsonify({"connected": False, "available": False, "error": "QBO module not loaded"})
    return jsonify({"connected": False, "available": True})


@app.route("/qbo/connect", methods=["GET"])
def qbo_connect():
    """Start OAuth2 flow — redirects to Intuit login."""
    if not qbo:
        return "QBO module not loaded", 500
    if not qbo.QBO_CLIENT_ID:
        return "QBO_CLIENT_ID not set. Set environment variables and restart.", 500
    url, state = qbo.get_auth_url()
    return redirect(url)


@app.route("/qbo/callback", methods=["GET"])
def qbo_callback():
    """OAuth2 callback — exchange code for tokens."""
    if not qbo:
        return "QBO module not loaded", 500
    auth_code = request.args.get("code")
    realm_id = request.args.get("realmId")
    if not auth_code or not realm_id:
        return "Missing auth code or realmId", 400
    try:
        qbo.handle_callback(auth_code, realm_id)
        return """
        <html><body style="font-family:Inter,sans-serif;background:#1A1A1A;color:#E5E5E5;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;">
        <div style="text-align:center;">
            <h1 style="color:#FF5000;">&#10003; QuickBooks Connected</h1>
            <p>You can close this tab and return to the dashboard.</p>
            <script>setTimeout(()=>window.close(),3000);</script>
        </div></body></html>
        """
    except Exception as e:
        return f"OAuth callback error: {e}", 500


@app.route("/qbo/exchange", methods=["GET"])
def qbo_exchange():
    """Manual token exchange for production OAuth.
    After authorizing via /qbo/connect, user lands on Intuit's playground page.
    Copy the 'code' and 'realmId' from that URL and paste them here:
    /qbo/exchange?code=AUTH_CODE&realmId=REALM_ID
    """
    if not qbo:
        return "QBO module not loaded", 500
    auth_code = request.args.get("code")
    realm_id = request.args.get("realmId")
    if not auth_code or not realm_id:
        return """
        <html><body style="font-family:Inter,sans-serif;background:#1A1A1A;color:#E5E5E5;padding:40px;">
        <h2 style="color:#FF5000;">QuickBooks Token Exchange</h2>
        <p>Paste the <b>code</b> and <b>realmId</b> from the Intuit redirect URL:</p>
        <form method="GET" action="/qbo/exchange">
            <label>Auth Code: <input name="code" style="width:600px;padding:8px;" /></label><br><br>
            <label>Realm ID: <input name="realmId" style="width:300px;padding:8px;" /></label><br><br>
            <button type="submit" style="background:#FF5000;color:white;padding:10px 20px;border:none;cursor:pointer;">Exchange Tokens</button>
        </form>
        </body></html>
        """, 200
    try:
        qbo.handle_prod_exchange(auth_code, realm_id)
        return """
        <html><body style="font-family:Inter,sans-serif;background:#1A1A1A;color:#E5E5E5;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;">
        <div style="text-align:center;">
            <h1 style="color:#FF5000;">&#10003; QuickBooks Connected (Production)</h1>
            <p>Tokens saved. You can close this tab and return to the dashboard.</p>
        </div></body></html>
        """
    except Exception as e:
        return f"Token exchange error: {e}", 500


@app.route("/qbo/disconnect", methods=["POST"])
def qbo_disconnect():
    """Remove saved QBO tokens."""
    if qbo:
        qbo.disconnect()
    return jsonify({"disconnected": True})


@app.route("/api/ar-summary", methods=["GET"])
def ar_summary():
    """Get accounts receivable summary from QuickBooks."""
    if _qbo_available_locally():
        result = qbo.get_ar_summary()
        return jsonify(result)
    # Fallback: proxy from Railway
    proxy = _proxy_qbo_from_railway("/api/ar-summary")
    if proxy:
        return jsonify(proxy)
    return jsonify({"error": "not_connected", "message": "QuickBooks not connected"})


@app.route("/api/ar-debug", methods=["GET"])
def ar_debug():
    """Debug: show all open invoices from QuickBooks."""
    if not qbo:
        return jsonify({"error": "not_available"})
    if not qbo.is_connected():
        return jsonify({"error": "not_connected"})
    result = qbo.get_ar_debug()
    return jsonify(result)


@app.route("/api/ar-top-overdue", methods=["GET"])
def ar_top_overdue():
    """Top N customers by overdue balance."""
    limit = request.args.get("limit", 3, type=int)
    if _qbo_available_locally():
        result = qbo.get_top_overdue_customers(limit=limit)
        return jsonify(result)
    proxy = _proxy_qbo_from_railway(f"/api/ar-top-overdue?limit={limit}")
    if proxy:
        return jsonify(proxy)
    return jsonify({"error": "not_connected"})


@app.route("/api/ar-report", methods=["GET"])
def ar_report():
    """Pull A/R directly from QBO's AgedReceivables report (matches QBO UI)."""
    if _qbo_available_locally():
        result = qbo.get_ar_from_report()
        return jsonify(result)
    proxy = _proxy_qbo_from_railway("/api/ar-report")
    if proxy:
        return jsonify(proxy)
    return jsonify({"error": "not_connected"})


@app.route("/api/ar-by-customer", methods=["GET"])
def ar_by_customer():
    """All open invoice balances aggregated by customer name."""
    if not _qbo_available_locally():
        proxy = _proxy_qbo_from_railway("/api/ar-by-customer")
        if proxy:
            return jsonify(proxy)
        return jsonify({"error": "not_connected"})
    try:
        client = qbo._get_qb_client()
        if not client:
            return jsonify({"error": "not_connected"})
        invoices = qbo._query_all_open_invoices(client)
        by_customer = {}
        for inv in invoices:
            balance = float(inv.Balance or 0)
            cust_ref = inv.CustomerRef
            cust_name = cust_ref.name if cust_ref else "Unknown"
            if cust_name not in by_customer:
                by_customer[cust_name] = {"total": 0.0, "count": 0}
            by_customer[cust_name]["total"] += balance
            by_customer[cust_name]["count"] += 1
        customers = [
            {"customer": name, "balance": round(data["total"], 2), "invoice_count": data["count"]}
            for name, data in by_customer.items()
            if data["total"] > 0
        ]
        customers.sort(key=lambda x: -x["balance"])
        return jsonify({"customers": customers, "total": round(sum(c["balance"] for c in customers), 2)})
    except Exception as e:
        return jsonify({"error": str(e)})


# ============================================================================
# Email Poller Integration
# ============================================================================

def build_contact_index():
    """Build {email_lower: {name, company, topicId}} from Notion contacts + companies."""
    try:
        companies = cached("companies", fetch_all_companies)
        contact_data = cached("contacts", fetch_all_contacts)
    except Exception as e:
        print(f"[email_poller] Failed to build contact index: {e}")
        return {}

    # Build company name lookup by page ID
    company_names = {c["id"]: c["name"] for c in companies}

    # Build contact-to-company mapping from company relations
    contact_company = {}
    for c in companies:
        for contact in c.get("contacts", []):
            email = (contact.get("email") or "").lower().strip()
            if email:
                contact_company[email] = c["name"]

    index = {}
    for pid, contact in contact_data.items():
        email = (contact.get("email") or "").lower().strip()
        if not email:
            continue
        name = contact.get("name") or email
        company = contact_company.get(email, "")
        # Generate a topicId from company name (lowercase, hyphens)
        topic_id = company.lower().replace(" ", "-").replace("/", "-") if company else ""
        index[email] = {"name": name, "company": company, "topicId": topic_id}

    return index


_poller_status = {"running": False, "last_run": None, "last_error": None}


def _email_poll_loop():
    """Background thread: poll emails every 5 minutes."""
    _poller_status["running"] = True
    while True:
        try:
            contact_index = build_contact_index()
            email_poller.run_poll(str(BRIEFING_PATH), contact_index)
            _poller_status["last_run"] = datetime.now().isoformat()
            _poller_status["last_error"] = None
        except Exception as e:
            _poller_status["last_error"] = str(e)
            print(f"[email_poller] Error: {e}")
        time.sleep(300)  # 5 minutes


@app.route("/api/briefing", methods=["GET"])
def api_briefing():
    """Serve current briefing-data.json."""
    if BRIEFING_PATH.exists():
        data = json.loads(BRIEFING_PATH.read_text())
        return jsonify(data)
    return jsonify({"error": "briefing-data.json not found"}), 404


@app.route("/api/briefing/poll", methods=["POST"])
def api_briefing_poll():
    """Trigger an immediate email poll cycle."""
    if not email_poller:
        return jsonify({"error": "email_poller module not available"}), 500
    try:
        contact_index = build_contact_index()
        changed = email_poller.run_poll(str(BRIEFING_PATH), contact_index)
        _poller_status["last_run"] = datetime.now().isoformat()
        _poller_status["last_error"] = None
        return jsonify({"status": "ok", "changed": changed})
    except Exception as e:
        _poller_status["last_error"] = str(e)
        return jsonify({"error": str(e)}), 500


def _strip_email_signature(text):
    """Strip common email signatures and clean up whitespace."""
    import re
    if not text:
        return ""
    # Cut at common signature markers
    sig_patterns = [
        r'\r?\n--\s*\r?\n', r'\r?\nBest regards',  r'\r?\nBest,',
        r'\r?\nKind regards', r'\r?\nRegards,', r'\r?\nThanks,?\s*\r?\n',
        r'\r?\nThank you,?\s*\r?\n', r'\r?\nSent from my ',
        r'\r?\nGet Outlook', r'\r?\n_{3,}', r'\r?\nCheers,',
        r'\r?\nWarm regards', r'\r?\nSincerely,', r'\r?\nAll the best',
        r'\r?\nV/r,', r'\r?\n\[cid:', r'\r?\nDisclaimer:',
    ]
    for pat in sig_patterns:
        m = re.search(pat, text, re.IGNORECASE)
        if m and m.start() > 0:
            text = text[:m.start()].rstrip()
            break
    # Collapse 3+ consecutive newlines into 2
    text = re.sub(r'(\r?\n){3,}', '\n\n', text)
    # Strip leading/trailing whitespace per line, remove blank-only lines at start/end
    lines = text.split('\n')
    lines = [l.rstrip() for l in lines]
    # Strip leading blank lines
    while lines and not lines[0].strip():
        lines.pop(0)
    # Strip trailing blank lines
    while lines and not lines[-1].strip():
        lines.pop()
    return '\n'.join(lines)


@app.route("/api/emails", methods=["GET"])
def api_emails():
    """Fetch today's focused inbox emails from Outlook via MS Graph.
    Query params: days=0 (default, today only), limit=50
    """
    days = int(request.args.get("days", 0))
    limit = min(int(request.args.get("limit", 50)), 100)

    hdrs = ms_graph_headers()
    if not hdrs:
        return jsonify({"error": "MS Graph not authenticated", "emails": []}), 200

    # Calculate time window (Eastern time)
    now = _now_eastern()
    if days == 0:
        since = now.replace(hour=0, minute=0, second=0, microsecond=0)
    else:
        since = now - timedelta(days=days)
    since_iso = since.strftime("%Y-%m-%dT%H:%M:%SZ")

    hdrs["Prefer"] = 'outlook.timezone="Eastern Standard Time"'

    # Fetch from focused inbox only
    resp = requests.get(
        f"{MS_GRAPH_BASE}/me/messages",
        headers=hdrs,
        params={
            "$filter": f"receivedDateTime ge {since_iso} and inferenceClassification eq 'focused'",
            "$select": "id,from,subject,receivedDateTime,body,isRead,importance",
            "$top": str(limit),
            "$orderby": "receivedDateTime desc",
        },
    )
    if resp.status_code == 401:
        _invalidate_graph_token()
        return jsonify({"error": "Auth expired", "emails": []}), 200
    if resp.status_code != 200:
        return jsonify({"error": f"Graph API {resp.status_code}", "emails": []}), 200

    messages = resp.json().get("value", [])
    emails = []
    for msg in messages:
        from_obj = msg.get("from", {}).get("emailAddress", {})
        # Extract plain text from body (HTML → text)
        body_obj = msg.get("body", {})
        body_content = body_obj.get("content", "")
        if body_obj.get("contentType") == "html" and body_content:
            import re
            # Strip HTML tags to get plain text
            text = re.sub(r'<style[^>]*>.*?</style>', '', body_content, flags=re.DOTALL | re.IGNORECASE)
            text = re.sub(r'<br\s*/?>', '\n', text, flags=re.IGNORECASE)
            text = re.sub(r'</p>', '\n', text, flags=re.IGNORECASE)
            text = re.sub(r'</div>', '\n', text, flags=re.IGNORECASE)
            text = re.sub(r'<[^>]+>', '', text)
            # Decode HTML entities
            import html as html_mod
            text = html_mod.unescape(text)
            body_content = text
        body_clean = _strip_email_signature(body_content)
        emails.append({
            "id": msg.get("id", ""),
            "from": from_obj.get("name", from_obj.get("address", "")),
            "fromEmail": from_obj.get("address", ""),
            "subject": msg.get("subject", ""),
            "body": body_clean,
            "date": msg.get("receivedDateTime", ""),
            "isRead": msg.get("isRead", True),
            "importance": msg.get("importance", "normal"),
        })

    return jsonify({"emails": emails, "count": len(emails)})


# ============================================================================
# AI Chat
# ============================================================================

CHAT_SYSTEM_PROMPT = """You are the AI assistant for JUST NATION LLC, a pallet sales and recycling company based at 271 Meadow Rd, Edison, NJ 08817.

## Your Role
You help Jonathan Crespo (Senior Manager) with sales, operations, customer communication, and decision-making. You have full knowledge of the business.

## Company Info
- JUST NATION LLC — Pallets | Corrugated | Plastic
- 271 Meadow Rd, Edison, NJ 08817
- Phone: (732) 985-7300 | (973) 609-6520
- Email: jonathan@justnationllc.com | Website: www.justnationusa.com
- Accounting: Angie Martinez (accounting@justnationllc.com)

## Current Pricing
- 48x40 Grade A: $6.00
- 48x40 Grade A1: $7.00
- 48x40 Grade B: $4.00
- 48x40 9-Block: $5.00
- Blue HD Block: $8.00
- Heat Treated (HT B): $6.50
- Heat Treated (new): $15.50
- NEW 48x40: $12.50 (broker rate, locked 3 months)
- Core Buyback: $1.50
- Scrap Removal: $500/load
- Standard load: 520 pallets (also 560/616 pinwheel)
- Drop trailer: no charge. Same-day delivery available.

## Industry Terms
- Grade A: Best recycled pallet, no broken boards
- Grade A1: Premium — like new condition
- Grade B: Economy — functional but cosmetic issues
- 9-Block: Plastic/press-wood block pallet
- HT / Heat Treated: ISPM-15 certified for international shipping
- Core Buyback: We buy back repairable pallets from customers
- Drop trailer: Leave trailer at customer site for loading/unloading
- MOQ: Minimum order quantity — 480 pallets (1 truckload)
- CHEP: Blue pallet pooling company (competitor program)
- 48Forty: Large pallet company (competitor)

## Jonathan's Email Style
- Direct, no-nonsense, professional but friendly
- Always includes pricing upfront in outreach
- Short paragraphs, gets to the point
- Signs cold/first outreach emails with full signature:
  Jonathan Crespo
  JUST NATION LLC
  271 Meadow Rd, Edison, NJ 08817
  (732) 985-7300
  jonathan@justnationllc.com
  www.justnationusa.com
- Does NOT use a signature on replies — only on cold/first outreach
- Never uses overly formal language or corporate jargon
- Uses "Hi [Name]," as greeting (not "Dear")
- Closes with "Thanks," or "Thanks, Jonathan" (not "Best regards" or "Sincerely")

## Communication Preferences
- Show email drafts in chat — never send without explicit approval
- Be concise and direct — pallet industry standard
- Include pricing upfront when relevant
- When unsure, ask rather than guess

## What You Can Help With
- Draft emails to customers and prospects
- Answer questions about pricing, products, logistics
- Help with sales strategy and follow-up planning
- Look up customer/contact info from the database
- Help calculate quotes and load planning
- General business operations questions

When drafting emails, match Jonathan's natural writing style exactly. Keep them short, direct, and professional without being stiff."""


def _get_customer_context():
    """Build a full summary of all customers for the AI."""
    try:
        companies = cached("companies", fetch_all_companies)
        products_index = cached("all_products", fetch_all_products)
        lines = []
        for c in companies:
            company_products = products_index.get(c["id"], [])
            products = ""
            if company_products:
                products = ", ".join(
                    f"{p.get('product','')} @ ${p.get('price','?')}"
                    for p in company_products[:5] if isinstance(p, dict)
                )
            contacts_str = ""
            if c.get("contacts"):
                contact_parts = []
                for ct in c["contacts"][:3]:
                    part = ct.get("name", "")
                    if ct.get("email"):
                        part += f" <{ct['email']}>"
                    if ct.get("phone"):
                        part += f" {ct['phone']}"
                    contact_parts.append(part)
                contacts_str = "; ".join(contact_parts)
            line = f"- {c['name']}"
            if c.get("address"):
                line += f" | {c['address']}"
            if c.get("phone"):
                line += f" | {c['phone']}"
            if contacts_str:
                line += f" | Contacts: {contacts_str}"
            if products:
                line += f" | Products: {products}"
            if c.get("notes"):
                line += f" | Notes: {c['notes']}"
            lines.append(line)
        return "\n".join(lines)
    except Exception as e:
        return f"(Customer data unavailable: {e})"


def _get_deliveries_context():
    """Get today's deliveries for the AI."""
    try:
        deliveries = fetch_deliveries(days_ahead=0)
        if not deliveries:
            return "No deliveries scheduled today."
        lines = []
        for d in deliveries:
            line = f"- {d['customer']}: {d['type']} | Status: {d['status']}"
            if d.get("driver"):
                line += f" | Driver: {d['driver']}"
            if d.get("trip"):
                line += f" (Trip #{d['trip']})"
            if d.get("notes"):
                line += f" | Notes: {d['notes']}"
            lines.append(line)
        return "\n".join(lines)
    except Exception:
        return "(Delivery data unavailable)"


def _get_briefing_context():
    """Get current briefing data for the AI."""
    try:
        if BRIEFING_PATH.exists():
            briefing = json.loads(BRIEFING_PATH.read_text())
            parts = []

            waiting = briefing.get("waitingOn", [])
            if waiting:
                parts.append("### Waiting On Responses")
                for w in waiting:
                    parts.append(f"- {w.get('contact','?')}: {w.get('subject','')} ({w.get('days',0)} days)")

            overdue = briefing.get("overdue", [])
            if overdue:
                parts.append("### Overdue Follow-ups")
                for o in overdue:
                    parts.append(f"- {o.get('contact','?')}: {o.get('opportunity','')} (last contact: {o.get('lastContact','')})")

            moves = briefing.get("nextMoves", [])
            if moves:
                parts.append("### Next Moves")
                for m in moves:
                    # Strip HTML tags
                    import re
                    text = re.sub(r'<[^>]+>', '', m.get('text', ''))
                    parts.append(f"- {text}")

            actions = briefing.get("todaysActions", [])
            if actions:
                parts.append("### Today's Actions")
                for a in actions:
                    text = a.get("text", a) if isinstance(a, dict) else a
                    parts.append(f"- {text}")

            return "\n".join(parts) if parts else "No briefing data available."
        return "No briefing file found."
    except Exception:
        return "(Briefing data unavailable)"


def _search_email(query, top=10):
    """Search Outlook emails. Returns formatted results or error string."""
    if not email_poller:
        return "(Email search unavailable — email_poller not loaded)"
    token = email_poller.get_token()
    if not token:
        return "(Email search unavailable — not authenticated with Outlook)"
    results = email_poller.search_emails(token, query, top)
    if not results:
        return f"No emails found matching: {query}"
    lines = []
    for e in results:
        date_str = e["date"][:10] if e.get("date") else "?"
        lines.append(f"- [{date_str}] From: {e['from']} | Subject: {e['subject']}")
        if e.get("preview"):
            preview = e["preview"][:200].replace("\n", " ").replace("\r", "")
            lines.append(f"  Preview: {preview}")
    return "\n".join(lines)


@app.route("/api/email/search", methods=["GET"])
def api_email_search():
    """Search Outlook emails. ?q=search+terms&top=10"""
    query = request.args.get("q", "")
    top = int(request.args.get("top", 10))
    if not query:
        return jsonify({"error": "q parameter required"}), 400
    if not email_poller:
        return jsonify({"error": "email_poller not available"}), 500
    token = email_poller.get_token()
    if not token:
        return jsonify({"error": "Not authenticated with Outlook"}), 500
    results = email_poller.search_emails(token, query, top)
    return jsonify({"results": results, "count": len(results), "query": query})


@app.route("/api/chat", methods=["POST"])
def api_chat():
    """AI chat endpoint. Expects {messages: [{role, content}]}."""
    if not ai_client:
        return jsonify({"error": "AI not configured. Set ANTHROPIC_API_KEY."}), 500

    data = request.get_json()
    if not data or "messages" not in data:
        return jsonify({"error": "messages required"}), 400

    messages = data["messages"]

    # Build system prompt with full live context
    now = _now_eastern()
    time_ctx = now.strftime("Today is %A, %B %d, %Y. Current time: %I:%M %p ET.")

    customer_ctx = _get_customer_context()
    delivery_ctx = _get_deliveries_context()
    briefing_ctx = _get_briefing_context()

    email_capability = ""
    if email_poller:
        email_capability = """

## Email Access
You can search Jonathan's Outlook emails. When the user asks about an email, a conversation, or anything that requires checking email, respond with EXACTLY this format on its own line:
[EMAIL_SEARCH: your search query here]

Examples:
- User asks "Did Wendy from Ferraro reply?" → [EMAIL_SEARCH: from:wromm@ferrarofoods.com]
- User asks "Any emails about the Ongweoweh RFQ?" → [EMAIL_SEARCH: Ongweoweh RFQ]
- User asks "What did Juan say about the order?" → [EMAIL_SEARCH: from:JuanO@3Gwhse.com]
- User asks "Check my emails from PepsiCo" → [EMAIL_SEARCH: PepsiCo]

Use the contact emails from the customer database when searching by person. You can include your own commentary before or after the search tag, but the tag must be on its own line. The system will automatically execute the search and provide results."""

    system = CHAT_SYSTEM_PROMPT + f"""

## Current Date & Time
{time_ctx}

## Today's Deliveries
{delivery_ctx}

## Current Briefing Status
{briefing_ctx}
{email_capability}

## Full Customer Database
{customer_ctx}"""

    try:
        response = ai_client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=2048,
            system=system,
            messages=messages,
        )
        reply = response.content[0].text

        # Check if the AI requested an email search
        email_search_match = re.search(r'\[EMAIL_SEARCH:\s*(.+?)\]', reply)
        if email_search_match:
            query = email_search_match.group(1).strip()
            email_results = _search_email(query)

            # Remove the search tag from the reply
            clean_reply = re.sub(r'\[EMAIL_SEARCH:\s*.+?\]', '', reply).strip()

            # Feed results back to get a final answer
            followup_messages = messages + [
                {"role": "assistant", "content": reply},
                {"role": "user", "content": f"[SYSTEM: Email search results for '{query}']\n\n{email_results}\n\nNow answer the original question using these email results. Do NOT output another EMAIL_SEARCH tag."},
            ]
            response2 = ai_client.messages.create(
                model="claude-sonnet-4-20250514",
                max_tokens=2048,
                system=system,
                messages=followup_messages,
            )
            reply = response2.content[0].text

        return jsonify({"reply": reply})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/health", methods=["GET"])
def health():
    """Health check endpoint."""
    return jsonify({
        "status": "ok",
        "notion_configured": bool(NOTION_TOKEN),
        "qbo_connected": qbo.is_connected() if qbo else False,
        "ai_chat": ai_client is not None,
        "email_poller": {
            "available": email_poller is not None,
            "running": _poller_status["running"],
            "last_run": _poller_status["last_run"],
            "last_error": _poller_status["last_error"],
        },
        "databases": {
            "companies": COMPANIES_DB,
            "contacts": CONTACTS_DB,
            "products": PRODUCTS_DB,
            "deliveries": DELIVERY_DB,
        }
    })


# ============================================================================
# Production Data — backed by Notion for multi-machine sync
# Static config (employees, rates) stays in local JSON.
# Weekly entries are stored in the Notion "Employee Production" database.
# ============================================================================

PRODUCTION_PATH = Path(__file__).parent / "production-data.json"
DAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat"]
DAY_PROPS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]


def _load_production_config():
    """Load static config (employees, rates, defaults) from local JSON."""
    try:
        with open(PRODUCTION_PATH) as f:
            data = json.load(f)
        return {
            "employees": data.get("employees", []),
            "pieceRates": data.get("pieceRates", {}),
            "bonusRates": data.get("bonusRates", {}),
            "employeeDefaults": data.get("employeeDefaults", {}),
        }
    except FileNotFoundError:
        return {"employees": [], "pieceRates": {}, "bonusRates": {}, "employeeDefaults": {}}


def _notion_query_production(week_start):
    """Query Notion for all production entries for a given week.
    Returns list of pages on success (may be empty).
    Raises RuntimeError if the Notion API returns a non-200 status.
    """
    filter_obj = {
        "property": "Week",
        "date": {"equals": week_start}
    }
    url = f"{NOTION_BASE}/databases/{PRODUCTION_DB}/query"
    payload = {"page_size": 100, "filter": filter_obj}
    resp = requests.post(url, headers=HEADERS, json=payload)
    if resp.status_code != 200:
        raise RuntimeError(f"Notion API {resp.status_code}: {resp.text[:200]}")
    data = resp.json()
    return data.get("results", [])


def _parse_day_value(text):
    """Parse a Notion text field back into a production day value.
    Returns: bool (salaried), list (piece worker), number (driver hours), or None.
    """
    if not text or text.strip() == "":
        return None
    t = text.strip()
    if t.lower() == "true":
        return True
    if t.lower() == "false":
        return False
    try:
        return json.loads(t)
    except (json.JSONDecodeError, ValueError):
        try:
            return float(t) if "." in t else int(t)
        except ValueError:
            return t


def _encode_day_value(val):
    """Encode a production day value for storage in Notion text field."""
    if val is None:
        return ""
    if isinstance(val, bool):
        return "true" if val else "false"
    if isinstance(val, (list, dict)):
        return json.dumps(val)
    return str(val)


def _notion_row_to_entry(page):
    """Convert a Notion page to a production entry dict."""
    entry = {}
    days = {}
    for dk, dp in zip(DAY_KEYS, DAY_PROPS):
        raw = get_property_value(page, dp)
        days[dk] = _parse_day_value(raw) if raw else None

    entry["days"] = days
    entry["hrsWorked"] = get_property_value(page, "Hrs Worked")
    entry["hrsPayroll"] = get_property_value(page, "Hrs Payroll")
    entry["deductions"] = get_property_value(page, "Deductions") or 0
    entry["debit"] = get_property_value(page, "Debit") or 0
    entry["total"] = get_property_value(page, "Total") or 0
    entry["totalOverride"] = get_property_value(page, "Total Override")
    entry["notes"] = get_property_value(page, "Notes") or ""
    return entry


def _build_notion_properties(employee_id, week_start, entry):
    """Build Notion properties dict from a production entry."""
    props = {
        "Employee": {"title": [{"text": {"content": employee_id}}]},
        "Week": {"date": {"start": week_start}},
    }
    days = entry.get("days", {})
    for dk, dp in zip(DAY_KEYS, DAY_PROPS):
        val = days.get(dk)
        encoded = _encode_day_value(val)
        props[dp] = {"rich_text": [{"text": {"content": encoded}}]}

    if entry.get("hrsWorked") is not None:
        props["Hrs Worked"] = {"number": entry["hrsWorked"]}
    if entry.get("hrsPayroll") is not None:
        props["Hrs Payroll"] = {"number": entry["hrsPayroll"]}
    props["Deductions"] = {"number": entry.get("deductions", 0) or 0}
    props["Debit"] = {"number": entry.get("debit", 0) or 0}
    props["Total"] = {"number": entry.get("total", 0) or 0}
    if entry.get("totalOverride") is not None:
        props["Total Override"] = {"number": entry["totalOverride"]}
    else:
        props["Total Override"] = {"number": None}
    notes = entry.get("notes", "")
    props["Notes"] = {"rich_text": [{"text": {"content": notes[:2000]}}]}
    return props


@app.route("/api/production", methods=["GET"])
def get_production():
    """Return full production data: static config + weekly entries from Notion."""
    config = _load_production_config()

    # Get requested week (default: current week start)
    week_param = request.args.get("week")

    # Build the weeks dict — Notion is the single source of truth
    weeks = {}
    if week_param:
        week_keys = [week_param]
    else:
        # Calculate current Thursday-start week (matching frontend logic)
        from datetime import date, timedelta
        today = date.today()
        day_of_week = today.weekday()  # Mon=0, Thu=3
        # Thu=3. If day < 3, go back to previous Thu. If day >= 3, use this Thu.
        if day_of_week >= 3:  # Thu-Sun
            diff = day_of_week - 3
        else:  # Mon-Wed
            diff = day_of_week + 4
        current_thu = today - timedelta(days=diff)
        prev_thu = current_thu - timedelta(days=7)
        week_keys = [prev_thu.isoformat(), current_thu.isoformat()]

    # Load local cache ONLY as fallback if Notion API fails
    local_weeks = {}
    try:
        with open(PRODUCTION_PATH) as f:
            local_data = json.load(f)
        local_weeks = local_data.get("weeks", {})
    except (FileNotFoundError, json.JSONDecodeError):
        pass

    # Build employee type lookup for normalizing day values
    employees = config.get("employees", [])
    emp_types = {e["id"]: e.get("type", "piece") for e in employees}

    for wk in week_keys:
        try:
            pages = _notion_query_production(wk)
        except Exception as e:
            print(f"[Production] Notion query failed for {wk}: {e}")
            # Notion API failed — use local cache as fallback
            if wk in local_weeks:
                weeks[wk] = local_weeks[wk]
            else:
                weeks[wk] = {"entries": {}, "dates": []}
            continue

        # Notion succeeded — use its data even if empty (it's the source of truth)
        entries = {}
        for page in pages:
            emp_id = get_property_value(page, "Employee")
            if emp_id:
                entry = _notion_row_to_entry(page)
                # Normalize None day values for piece workers only (need empty arrays)
                etype = emp_types.get(emp_id, "piece")
                for dk in DAY_KEYS:
                    if entry["days"].get(dk) is None and etype == "piece":
                        entry["days"][dk] = []
                entries[emp_id] = entry
        weeks[wk] = {
            "entries": entries,
            "dates": local_weeks.get(wk, {}).get("dates", []),
        }

    config["weeks"] = weeks
    return jsonify(config)


@app.route("/api/production", methods=["POST"])
def save_production():
    """Save production data. Static config goes to local JSON,
    weekly entries go to Notion for sync across machines."""
    data = request.json
    if not data:
        return jsonify({"error": "No data"}), 400

    # Save static config locally (employees, rates, etc.)
    config_keys = ["employees", "pieceRates", "bonusRates", "employeeDefaults"]
    local_data = {}
    try:
        with open(PRODUCTION_PATH) as f:
            local_data = json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        pass

    for k in config_keys:
        if k in data:
            local_data[k] = data[k]

    # Keep a local copy of weeks for offline fallback
    if "weeks" in data:
        local_data["weeks"] = data["weeks"]

    tmp_path = str(PRODUCTION_PATH) + ".tmp"
    with open(tmp_path, "w") as f:
        json.dump(local_data, f, indent=2)
    os.replace(tmp_path, str(PRODUCTION_PATH))

    # Sync weekly entries to Notion
    # If a specific changedWeek is given, only sync that one (fast path)
    changed_week = data.get("changedWeek")
    weeks = data.get("weeks", {})
    if changed_week and changed_week in weeks:
        weeks_to_sync = {changed_week: weeks[changed_week]}
    else:
        weeks_to_sync = weeks

    errors = []
    for week_start, week_data in weeks_to_sync.items():
        entries = week_data.get("entries", {})
        if not entries:
            continue

        # Query existing Notion rows for this week
        existing_pages = _notion_query_production(week_start)
        existing_map = {}  # employee_id -> page_id
        for page in existing_pages:
            emp_id = get_property_value(page, "Employee")
            if emp_id:
                existing_map[emp_id] = page["id"]

        for emp_id, entry in entries.items():
            props = _build_notion_properties(emp_id, week_start, entry)

            try:
                if emp_id in existing_map:
                    # Update existing page
                    page_id = existing_map[emp_id]
                    url = f"{NOTION_BASE}/pages/{page_id}"
                    resp = requests.patch(url, headers=HEADERS, json={"properties": props})
                    if resp.status_code != 200:
                        errors.append(f"Update {emp_id}: {resp.status_code}")
                else:
                    # Create new page
                    url = f"{NOTION_BASE}/pages"
                    payload = {
                        "parent": {"database_id": PRODUCTION_DB},
                        "properties": props,
                    }
                    resp = requests.post(url, headers=HEADERS, json=payload)
                    if resp.status_code != 200:
                        errors.append(f"Create {emp_id}: {resp.status_code}")
            except Exception as e:
                errors.append(f"{emp_id}: {str(e)}")

    if errors:
        return jsonify({"ok": True, "warnings": errors})
    return jsonify({"ok": True})


# ============================================================================
# Microsoft Graph (MSAL OAuth) Integration
# ============================================================================
# Reuses the same Azure AD app registration as the pallet-sales MCP server.
# Token cache is shared so if you've already authenticated via the MCP server,
# no additional login is needed.

MS_GRAPH_BASE = "https://graph.microsoft.com/v1.0"
AZURE_CLIENT_ID = "38628aa9-d0f8-405a-a1e7-e3e8af735c07"
AZURE_TENANT_ID = "bfeb2076-6e72-4b34-9cf6-60c1773a664f"
MS_GRAPH_SCOPES = [
    "https://graph.microsoft.com/Mail.Read",
    "https://graph.microsoft.com/Mail.ReadWrite",
    "https://graph.microsoft.com/Mail.Send",
    "https://graph.microsoft.com/Tasks.ReadWrite",
    "https://graph.microsoft.com/Calendars.ReadWrite",
]

# Find token cache from pallet-sales MCP server
_MSAL_TOKEN_CACHE_PATHS = [
    Path(__file__).parent.parent / "Pallet Operations" / "pallet-sales-mcp-server" / ".token-cache.json",
    Path(__file__).parent / ".ms-token-cache.json",
    Path.home() / ".pallet-sales-token-cache.json",
]

_msal_app = None
_msal_cache_path = None

def _init_msal():
    """Initialize MSAL public client with persistent token cache."""
    global _msal_app, _msal_cache_path
    if _msal_app:
        return _msal_app

    try:
        import msal
    except ImportError:
        print("   ⚠️  msal not installed — run: pip install msal")
        return None

    # Find existing token cache (or set default save path)
    cache = msal.SerializableTokenCache()
    _msal_cache_path = _MSAL_TOKEN_CACHE_PATHS[0]  # default save location
    # Support cloud deployment: load token cache from env var
    env_cache = os.environ.get("MS_TOKEN_CACHE_JSON")
    if env_cache:
        cache.deserialize(env_cache)
        _msal_cache_path = Path("/tmp/.ms-token-cache.json")
        print(f"   MS Graph: loaded token cache from MS_TOKEN_CACHE_JSON env var")
    else:
        for p in _MSAL_TOKEN_CACHE_PATHS:
            if p.exists():
                _msal_cache_path = p
                cache.deserialize(p.read_text())
                print(f"   MS Graph: loaded token cache from {p}")
                break

    _msal_app = msal.PublicClientApplication(
        client_id=AZURE_CLIENT_ID,
        authority=f"https://login.microsoftonline.com/{AZURE_TENANT_ID}",
        token_cache=cache,
    )
    return _msal_app


_graph_token_cache = {"token": None, "expires": 0}
_device_flow_state = {"flow": None, "status": "idle"}  # for async device code auth

def _save_msal_cache():
    """Save MSAL token cache to disk."""
    if _msal_cache_path and _msal_app and _msal_app.token_cache.has_state_changed:
        _msal_cache_path.write_text(_msal_app.token_cache.serialize())

def _get_graph_token(allow_device_flow=False):
    """Get a valid MS Graph access token via silent refresh.
    If allow_device_flow=True (startup only), will block for device code auth.
    Otherwise returns None if silent refresh fails.
    """
    import time as _time

    # Return cached token if still valid
    if _graph_token_cache["token"] and _time.time() < _graph_token_cache["expires"]:
        return _graph_token_cache["token"]

    app = _init_msal()
    if not app:
        return None

    accounts = app.get_accounts()

    # Try silent acquisition first
    if accounts:
        result = app.acquire_token_silent(MS_GRAPH_SCOPES, account=accounts[0])
        if result and "access_token" in result:
            _save_msal_cache()
            _graph_token_cache["token"] = result["access_token"]
            _graph_token_cache["expires"] = _time.time() + 3000  # ~50 min
            return result["access_token"]

        err = result.get('error_description', 'unknown error') if result else 'scopes not yet authorized'
        print(f"   MS Graph: silent refresh failed — {err}", flush=True)

    # Only do device code flow at startup (blocking)
    if allow_device_flow:
        print("\n" + "=" * 50)
        print("MS GRAPH LOGIN REQUIRED")
        print("Need consent for: Mail + Tasks + Calendar scopes")
        print("=" * 50)
        flow = app.initiate_device_flow(scopes=MS_GRAPH_SCOPES)
        if "user_code" not in flow:
            print(f"   MS Graph: device flow failed — {flow.get('error_description', 'unknown')}")
            return None
        print(f"\n   {flow['message']}\n")
        result = app.acquire_token_by_device_flow(flow)
        if result and "access_token" in result:
            _save_msal_cache()
            print("   ✅ MS Graph authenticated!")
            _graph_token_cache["token"] = result["access_token"]
            _graph_token_cache["expires"] = _time.time() + 3000
            return result["access_token"]
        err = result.get('error_description', 'unknown error') if result else 'no result'
        print(f"   MS Graph: device code auth failed — {err}")

    return None

def _invalidate_graph_token():
    """Clear the in-memory token cache so next call re-acquires."""
    _graph_token_cache["token"] = None
    _graph_token_cache["expires"] = 0


def ms_graph_headers():
    token = _get_graph_token()
    if not token:
        return None
    return {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    }

def _graph_request(method, url, **kwargs):
    """Make a Graph API request with automatic 401 retry (re-acquires token)."""
    hdrs = ms_graph_headers()
    if not hdrs:
        return None
    resp = requests.request(method, url, headers=hdrs, **kwargs)
    if resp.status_code == 401:
        _invalidate_graph_token()
        hdrs = ms_graph_headers()
        if not hdrs:
            return None
        resp = requests.request(method, url, headers=hdrs, **kwargs)
    return resp


# ── MS Auth Trigger (device code flow via HTTP) ──────────────────────────

@app.route("/api/ms-auth", methods=["POST"])
def trigger_ms_auth():
    """Start device code flow for MS Graph authentication.
    Returns the user_code and verification_uri for the user to complete."""
    app_msal = _init_msal()
    if not app_msal:
        return jsonify({"error": "MSAL not available"}), 500

    flow = app_msal.initiate_device_flow(scopes=MS_GRAPH_SCOPES)
    if "user_code" not in flow:
        return jsonify({"error": flow.get("error_description", "Device flow failed")}), 500

    _device_flow_state["flow"] = flow
    _device_flow_state["status"] = "pending"

    return jsonify({
        "user_code": flow["user_code"],
        "verification_uri": flow.get("verification_uri", "https://microsoft.com/devicelogin"),
        "message": flow.get("message", ""),
        "expires_in": flow.get("expires_in", 900),
    })


@app.route("/api/ms-auth/complete", methods=["POST"])
def complete_ms_auth():
    """Complete the device code flow after user has authenticated."""
    import time as _time

    app_msal = _init_msal()
    if not app_msal:
        return jsonify({"error": "MSAL not available"}), 500

    flow = _device_flow_state.get("flow")
    if not flow:
        return jsonify({"error": "No pending auth flow. POST /api/ms-auth first."}), 400

    result = app_msal.acquire_token_by_device_flow(flow)
    if result and "access_token" in result:
        _save_msal_cache()
        _graph_token_cache["token"] = result["access_token"]
        _graph_token_cache["expires"] = _time.time() + 3000
        _device_flow_state["flow"] = None
        _device_flow_state["status"] = "authenticated"
        return jsonify({"ok": True, "message": "MS Graph authenticated with all scopes!"})

    err = result.get("error_description", "Unknown error") if result else "No result"
    _device_flow_state["status"] = "failed"
    return jsonify({"error": err}), 400


@app.route("/api/ms-auth/status", methods=["GET"])
def ms_auth_status():
    """Check current MS Graph auth status."""
    token = _get_graph_token()
    return jsonify({
        "authenticated": token is not None,
        "device_flow_pending": _device_flow_state.get("status") == "pending",
    })


def get_todo_default_list_id():
    """Get the default 'Tasks' list ID from Microsoft To Do."""
    hdrs = ms_graph_headers()
    if not hdrs:
        return None
    resp = requests.get(f"{MS_GRAPH_BASE}/me/todo/lists", headers=hdrs)
    if resp.status_code != 200:
        return None
    lists = resp.json().get("value", [])
    # Find the default "Tasks" list (wellknownListName == "defaultList")
    for lst in lists:
        if lst.get("wellknownListName") == "defaultList":
            return lst.get("id")
    # Fallback: return the first list
    return lists[0].get("id") if lists else None


@app.route("/api/tasks", methods=["GET"])
def get_tasks():
    """Get all tasks from Microsoft To Do (default list)."""
    if not ms_graph_headers():
        return jsonify({"error": "MS Graph not authenticated — connect via pallet-sales MCP first", "tasks": []}), 200

    list_id = get_todo_default_list_id()
    if not list_id:
        return jsonify({"error": "No task list found", "tasks": []}), 200

    # Get incomplete tasks
    resp = requests.get(
        f"{MS_GRAPH_BASE}/me/todo/lists/{list_id}/tasks",
        headers=ms_graph_headers(),
        params={"$filter": "status ne 'completed'", "$orderby": "createdDateTime desc"}
    )
    active = resp.json().get("value", []) if resp.status_code == 200 else []

    # Get completed tasks (last 20)
    resp2 = requests.get(
        f"{MS_GRAPH_BASE}/me/todo/lists/{list_id}/tasks",
        headers=ms_graph_headers(),
        params={"$filter": "status eq 'completed'", "$top": "20", "$orderby": "completedDateTime/dateTime desc"}
    )
    completed = resp2.json().get("value", []) if resp2.status_code == 200 else []

    def map_task(t):
        # Map category to tag (use first category or default to OPS)
        categories = t.get("categories", [])
        tag = "OPS"
        for c in categories:
            cl = c.upper()
            if cl in ("URG", "URGENT"):
                tag = "URG"
            elif cl in ("CALL", "PHONE"):
                tag = "CALL"
            elif cl in ("INV", "INVOICE"):
                tag = "INV"
            elif cl in ("OPS", "OPERATIONS"):
                tag = "OPS"
        return {
            "id": t.get("id"),
            "text": t.get("title", ""),
            "tag": tag,
            "done": t.get("status") == "completed",
            "importance": t.get("importance", "normal"),
            "createdAt": t.get("createdDateTime"),
        }

    tasks = [map_task(t) for t in active] + [map_task(t) for t in completed]
    return jsonify({"tasks": tasks, "listId": list_id})


@app.route("/api/tasks", methods=["POST"])
def create_task():
    """Create a new task in Microsoft To Do."""
    if not ms_graph_headers():
        return jsonify({"error": "MS Graph not authenticated"}), 400

    data = request.json or {}
    text = (data.get("title") or data.get("text") or "").strip()
    tag = data.get("tag", "OPS")
    if not text:
        return jsonify({"error": "Task text required"}), 400

    list_id = get_todo_default_list_id()
    if not list_id:
        return jsonify({"error": "No task list found"}), 400

    # Map tag to category
    categories = [tag]

    body = {
        "title": text,
        "categories": categories,
        "importance": "high" if tag == "URG" else "normal",
    }

    resp = requests.post(
        f"{MS_GRAPH_BASE}/me/todo/lists/{list_id}/tasks",
        headers=ms_graph_headers(),
        json=body
    )

    if resp.status_code in (200, 201):
        t = resp.json()
        return jsonify({
            "ok": True,
            "task": {
                "id": t.get("id"),
                "text": t.get("title"),
                "tag": tag,
                "done": False,
            }
        })
    return jsonify({"error": f"Graph API error {resp.status_code}"}), 500


@app.route("/api/tasks/<task_id>", methods=["PATCH"])
def update_task(task_id):
    """Update a task (complete/uncomplete) in Microsoft To Do."""
    if not ms_graph_headers():
        return jsonify({"error": "MS Graph not authenticated"}), 400

    data = request.json or {}
    list_id = get_todo_default_list_id()
    if not list_id:
        return jsonify({"error": "No task list found"}), 400

    body = {}
    if "status" in data:
        # Client sends { status: 'completed' | 'notStarted' } directly
        body["status"] = data["status"]
    elif "done" in data:
        body["status"] = "completed" if data["done"] else "notStarted"
    if "title" in data:
        body["title"] = data["title"]
    elif "text" in data:
        body["title"] = data["text"]
    if "tag" in data:
        body["categories"] = [data["tag"]]

    resp = requests.patch(
        f"{MS_GRAPH_BASE}/me/todo/lists/{list_id}/tasks/{task_id}",
        headers=ms_graph_headers(),
        json=body
    )

    if resp.status_code == 200:
        return jsonify({"ok": True})
    return jsonify({"error": f"Graph API error {resp.status_code}"}), 500


@app.route("/api/tasks/<task_id>", methods=["DELETE"])
def delete_task(task_id):
    """Delete a task from Microsoft To Do."""
    if not ms_graph_headers():
        return jsonify({"error": "MS Graph not authenticated"}), 400

    list_id = get_todo_default_list_id()
    if not list_id:
        return jsonify({"error": "No task list found"}), 400

    resp = requests.delete(
        f"{MS_GRAPH_BASE}/me/todo/lists/{list_id}/tasks/{task_id}",
        headers=ms_graph_headers()
    )

    if resp.status_code in (200, 204):
        return jsonify({"ok": True})
    return jsonify({"error": f"Graph API error {resp.status_code}"}), 500


# ============================================================================
# Outlook Calendar (Graph API) Integration
# ============================================================================

@app.route("/api/calendar", methods=["GET"])
def get_calendar():
    """Get upcoming calendar events from Outlook (next 7 days by default)."""
    if not ms_graph_headers():
        return jsonify({"error": "MS Graph not authenticated", "events": []}), 200

    days = int(request.args.get("days", 7))
    from datetime import datetime, timedelta
    now = datetime.utcnow()
    end = now + timedelta(days=days)

    params = {
        "startDateTime": now.strftime("%Y-%m-%dT%H:%M:%S.0000000Z"),
        "endDateTime": end.strftime("%Y-%m-%dT%H:%M:%S.0000000Z"),
        "$top": "50",
        "$orderby": "start/dateTime",
        "$select": "subject,start,end,location,organizer,attendees,isAllDay,bodyPreview",
    }

    hdrs = ms_graph_headers()
    if hdrs:
        hdrs["Prefer"] = 'outlook.timezone="Eastern Standard Time"'
    resp = requests.get(
        f"{MS_GRAPH_BASE}/me/calendarview",
        headers=hdrs,
        params=params,
    )

    if resp.status_code != 200:
        return jsonify({"error": f"Graph API error {resp.status_code}", "events": []}), 200

    raw = resp.json().get("value", [])
    events = []
    for ev in raw:
        start = ev.get("start", {})
        end_t = ev.get("end", {})
        organizer = ev.get("organizer", {}).get("emailAddress", {})
        attendees = [
            a.get("emailAddress", {}).get("name", "")
            for a in ev.get("attendees", [])
        ]
        events.append({
            "id": ev.get("id", ""),
            "subject": ev.get("subject", ""),
            "startDate": start.get("dateTime", "")[:10],
            "startTime": start.get("dateTime", "")[11:16] if "T" in start.get("dateTime", "") else "",
            "endTime": end_t.get("dateTime", "")[11:16] if "T" in end_t.get("dateTime", "") else "",
            "location": ev.get("location", {}).get("displayName", ""),
            "isAllDay": ev.get("isAllDay", False),
            "organizer": organizer.get("name", ""),
            "attendees": attendees,
            "preview": ev.get("bodyPreview", "")[:100],
        })

    return jsonify({"events": events})


@app.route("/api/calendar", methods=["POST"])
def create_calendar_event():
    """Create a new Outlook calendar event."""
    if not ms_graph_headers():
        return jsonify({"error": "MS Graph not authenticated"}), 400

    data = request.json or {}
    subject = data.get("subject", "New Event")
    start_date = data.get("startDate")  # "2026-03-14"
    start_time = data.get("startTime", "09:00")  # "09:00"
    end_time = data.get("endTime", "10:00")  # "10:00"
    location = data.get("location", "")
    is_all_day = data.get("isAllDay", False)
    body = data.get("body", "")

    if not start_date:
        return jsonify({"error": "startDate required"}), 400

    if is_all_day:
        event_body = {
            "subject": subject,
            "isAllDay": True,
            "start": {"dateTime": f"{start_date}T00:00:00", "timeZone": "Eastern Standard Time"},
            "end": {"dateTime": f"{start_date}T00:00:00", "timeZone": "Eastern Standard Time"},
        }
    else:
        event_body = {
            "subject": subject,
            "start": {"dateTime": f"{start_date}T{start_time}:00", "timeZone": "Eastern Standard Time"},
            "end": {"dateTime": f"{start_date}T{end_time}:00", "timeZone": "Eastern Standard Time"},
        }

    if location:
        event_body["location"] = {"displayName": location}
    if body:
        event_body["body"] = {"contentType": "text", "content": body}

    resp = requests.post(
        f"{MS_GRAPH_BASE}/me/events",
        headers=ms_graph_headers(),
        json=event_body,
    )
    if resp.status_code in (200, 201):
        ev = resp.json()
        return jsonify({"id": ev.get("id"), "subject": ev.get("subject"), "ok": True})
    return jsonify({"error": f"Graph API error {resp.status_code}", "detail": resp.text}), resp.status_code


@app.route("/api/calendar/<path:event_id>", methods=["PATCH"])
def update_calendar_event(event_id):
    """Update an existing Outlook calendar event."""
    if not ms_graph_headers():
        return jsonify({"error": "MS Graph not authenticated"}), 400

    data = request.json or {}
    update = {}

    if "subject" in data:
        update["subject"] = data["subject"]
    if "location" in data:
        update["location"] = {"displayName": data["location"]}
    if "isAllDay" in data:
        update["isAllDay"] = data["isAllDay"]

    # Build start/end — need the date anchor to form the datetime string.
    # If startDate wasn't sent, fetch the existing event to get the current date.
    date_anchor = data.get("startDate")
    needs_time_update = "startTime" in data or "endTime" in data or "startDate" in data
    if needs_time_update and not date_anchor:
        # Fetch existing event to get current start date
        existing = requests.get(
            f"{MS_GRAPH_BASE}/me/events/{event_id}",
            headers=ms_graph_headers(),
            params={"$select": "start,end"},
        )
        if existing.status_code == 200:
            ex = existing.json()
            date_anchor = ex.get("start", {}).get("dateTime", "")[:10]

    if needs_time_update and date_anchor:
        if "startTime" in data or "startDate" in data:
            start_time = data.get("startTime", "09:00")
            update["start"] = {"dateTime": f"{date_anchor}T{start_time}:00", "timeZone": "Eastern Standard Time"}
        if "endTime" in data:
            update["end"] = {"dateTime": f"{date_anchor}T{data['endTime']}:00", "timeZone": "Eastern Standard Time"}

    if not update:
        return jsonify({"ok": True, "noop": True})

    resp = requests.patch(
        f"{MS_GRAPH_BASE}/me/events/{event_id}",
        headers=ms_graph_headers(),
        json=update,
    )
    if resp.status_code == 200:
        return jsonify({"ok": True})
    return jsonify({"error": f"Graph API error {resp.status_code}", "detail": resp.text}), resp.status_code


@app.route("/api/calendar/<path:event_id>", methods=["DELETE"])
def delete_calendar_event(event_id):
    """Delete an Outlook calendar event."""
    if not ms_graph_headers():
        return jsonify({"error": "MS Graph not authenticated"}), 400

    resp = requests.delete(
        f"{MS_GRAPH_BASE}/me/events/{event_id}",
        headers=ms_graph_headers(),
    )
    if resp.status_code == 204:
        return jsonify({"ok": True})
    return jsonify({"error": f"Graph API error {resp.status_code}"}), resp.status_code


# ============================================================================
# Receipt Number (synced across machines via local file + Notion fallback)
# ============================================================================

RECEIPT_NUMBER_PATH = Path(__file__).parent / "receipt-number.json"
STARTING_RECEIPT_NUMBER = 294500


def _load_receipt_number():
    """Load the last used receipt number from local file."""
    try:
        with open(RECEIPT_NUMBER_PATH) as f:
            data = json.load(f)
        return data.get("lastUsed", STARTING_RECEIPT_NUMBER)
    except (FileNotFoundError, json.JSONDecodeError):
        return STARTING_RECEIPT_NUMBER


def _save_receipt_number(num):
    """Save the last used receipt number to local file."""
    with open(RECEIPT_NUMBER_PATH, "w") as f:
        json.dump({"lastUsed": num}, f)


# Notion page for syncing receipt number across machines
# We'll use a simple page in the Companies DB (or a dedicated page)
RECEIPT_COUNTER_PAGE_ID = None  # Will be discovered/created on first use


def _get_receipt_counter_from_notion():
    """Fetch the receipt counter from Notion (stored as a page in a known location)."""
    if not NOTION_TOKEN:
        return None
    try:
        # Search for a page titled "__receipt_counter__" in the Production DB
        filter_obj = {"property": "Employee", "title": {"equals": "__receipt_counter__"}}
        pages = notion_query(PRODUCTION_DB, filter_obj=filter_obj, page_size=1)
        if pages:
            page = pages[0]
            # Store the counter in the "Total" number field
            val = get_property_value(page, "Total")
            return {"page_id": page["id"], "lastUsed": int(val) if val else STARTING_RECEIPT_NUMBER}
    except Exception:
        pass
    return None


def _save_receipt_counter_to_notion(num):
    """Save the receipt counter to Notion."""
    if not NOTION_TOKEN:
        return
    try:
        counter = _get_receipt_counter_from_notion()
        props = {
            "Employee": {"title": [{"text": {"content": "__receipt_counter__"}}]},
            "Total": {"number": num},
        }
        if counter and counter.get("page_id"):
            # Update existing
            url = f"{NOTION_BASE}/pages/{counter['page_id']}"
            requests.patch(url, headers=HEADERS, json={"properties": props})
        else:
            # Create new
            url = f"{NOTION_BASE}/pages"
            payload = {"parent": {"database_id": PRODUCTION_DB}, "properties": props}
            requests.post(url, headers=HEADERS, json=payload)
    except Exception:
        pass


@app.route("/api/receipt-number/next", methods=["GET"])
def get_next_receipt_number():
    """Get the next receipt number, synced across machines."""
    # Try Notion first (authoritative source)
    notion_counter = _get_receipt_counter_from_notion()
    local_num = _load_receipt_number()

    if notion_counter and notion_counter.get("lastUsed"):
        # Use the highest of local and Notion to avoid collisions
        best = max(notion_counter["lastUsed"], local_num)
    else:
        best = local_num

    return jsonify({"next": best + 1, "lastUsed": best})


@app.route("/api/receipt-number/commit", methods=["POST"])
def commit_receipt_number():
    """Mark a receipt number as used (after print or new receipt)."""
    data = request.json or {}
    num = data.get("number")
    if not num or not isinstance(num, (int, float)):
        return jsonify({"error": "Invalid number"}), 400

    num = int(num)

    # Save locally
    _save_receipt_number(num)

    # Save to Notion for cross-machine sync
    _save_receipt_counter_to_notion(num)

    return jsonify({"ok": True, "lastUsed": num})


# ============================================================================
# Main
# ============================================================================

if __name__ == "__main__":
    if not NOTION_TOKEN:
        print("=" * 50)
        print("WARNING: NOTION_TOKEN not set!")
        print("Set it with: export NOTION_TOKEN=your_token_here")
        print("Get your token from: https://www.notion.so/my-integrations")
        print("=" * 50)

    print(f"\n🚀 JUST NATION Dashboard Server starting on http://localhost:5050")
    print(f"   Notion token: {'configured' if NOTION_TOKEN else 'NOT SET'}")
    _init_msal()
    # Only block for device code flow if running interactively in a terminal
    # (not when spawned by Electron, which has no stdin/terminal)
    _interactive = os.isatty(0)  # stdin is a TTY = running in Terminal
    _graph_ok = _get_graph_token(allow_device_flow=_interactive) is not None
    print(f"   MS Graph:     {'connected (MSAL)' if _graph_ok else 'NOT AUTHENTICATED (run pallet-sales MCP first)'}")
    print(f"   Companies DB: {COMPANIES_DB}")
    print(f"   Products DB:  {PRODUCTS_DB}")
    print(f"   Delivery DB:  {DELIVERY_DB}")
    print(f"   Cache:        persistent (invalidate on save)")

    port = int(os.environ.get("PORT", 5050))
    debug = os.environ.get("FLASK_DEBUG", "true").lower() == "true"

    # Start email poller background thread
    # Guard against Werkzeug reloader spawning duplicate threads
    if email_poller and (os.environ.get("WERKZEUG_RUN_MAIN") == "true" or not debug):
        poller_thread = threading.Thread(target=_email_poll_loop, daemon=True)
        poller_thread.start()
        print(f"   Email poller: STARTED (every 5 min)\n")
    elif email_poller:
        print(f"   Email poller: available (waiting for reloader)\n")
    else:
        print(f"   Email poller: NOT AVAILABLE (import failed)\n")

    app.run(host="0.0.0.0", port=port, debug=debug)
