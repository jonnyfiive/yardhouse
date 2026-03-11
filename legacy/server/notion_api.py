"""
Just Nation — Notion API Client
Fetches companies and contacts from the Notion CRM databases.
Uses the requests library directly (no notion-client SDK needed).
"""
import os
import re
import json
import time
import requests
from pathlib import Path


# ── Notion Database IDs ──
COMPANIES_DB_ID = "fadc95374fe64eb3be43d38b3950dc66"
CONTACTS_DB_ID = "30ab735b971480c08a41f31ac6f086ef"
PRODUCTS_DB_ID = "10890dd37a914fef9be6265af09aa50a"
DELIVERY_DB_ID = "fa9ae860cff447a38344a84e4c73f81f"

# ── API Config ──
NOTION_API_URL = "https://api.notion.com/v1"
NOTION_VERSION = "2022-06-28"

# ── Cache (avoid hitting Notion on every request) ──
_cache = {
    "customers": None,
    "timestamp": 0,
}
CACHE_TTL = 300  # 5 minutes


def _get_headers():
    """Build Notion API request headers."""
    token = os.getenv("NOTION_API_KEY", "")
    if not token:
        raise RuntimeError("NOTION_API_KEY not set in .env")
    return {
        "Authorization": f"Bearer {token}",
        "Notion-Version": NOTION_VERSION,
        "Content-Type": "application/json",
    }


def _extract_text(prop, prop_type="rich_text"):
    """Extract plain text from a Notion property."""
    if not prop:
        return ""
    items = prop.get(prop_type, [])
    if not items:
        items = prop.get("title", [])
    if not items:
        return ""
    return "".join(item.get("plain_text", "") for item in items)


def _extract_select(prop):
    """Extract the name from a Notion select property."""
    if not prop:
        return ""
    sel = prop.get("select")
    if sel and isinstance(sel, dict):
        return sel.get("name", "")
    return ""


def _extract_relation_ids(prop):
    """Extract page IDs from a relation property."""
    if not prop:
        return []
    return [r["id"] for r in prop.get("relation", [])]


def _query_database(db_id, start_cursor=None):
    """Query a Notion database, returning one page of results."""
    url = f"{NOTION_API_URL}/databases/{db_id}/query"
    body = {"page_size": 100}
    if start_cursor:
        body["start_cursor"] = start_cursor

    resp = requests.post(url, headers=_get_headers(), json=body, timeout=30)
    resp.raise_for_status()
    return resp.json()


def _query_all_pages(db_id):
    """Query all pages from a Notion database (handles pagination)."""
    all_pages = []
    cursor = None
    while True:
        data = _query_database(db_id, start_cursor=cursor)
        all_pages.extend(data.get("results", []))
        if not data.get("has_more"):
            break
        cursor = data.get("next_cursor")
    return all_pages


def _fetch_page(page_id):
    """Fetch a single Notion page by ID."""
    url = f"{NOTION_API_URL}/pages/{page_id}"
    resp = requests.get(url, headers=_get_headers(), timeout=30)
    resp.raise_for_status()
    return resp.json()


def _make_id(name):
    """Generate a URL-safe ID from a name."""
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


def fetch_contacts_map():
    """Fetch all contacts and return a dict keyed by page ID."""
    contacts_map = {}

    try:
        pages = _query_all_pages(CONTACTS_DB_ID)
        for page in pages:
            props = page.get("properties", {})
            contact = {
                "name": "",
                "title": "",
                "email": "",
                "phone": "",
            }

            # Contact name — title property is "Contact"
            contact["name"] = _extract_text(props.get("Contact"), "title")

            # Job Title
            contact["title"] = _extract_text(props.get("Job Title"))

            # Email
            email_prop = props.get("E-mail", {})
            contact["email"] = email_prop.get("email", "") or ""

            # Phone — try Business Phone first, then Mobile Phone
            biz_phone = props.get("Business Phone", {})
            contact["phone"] = biz_phone.get("phone_number", "") or ""
            if not contact["phone"]:
                mobile = props.get("Mobile Phone", {})
                contact["phone"] = mobile.get("phone_number", "") or ""

            contact["pageId"] = page["id"]
            contacts_map[page["id"]] = contact

    except Exception as e:
        print(f"⚠ Failed to fetch contacts from Notion: {e}")

    return contacts_map


def fetch_customers():
    """
    Fetch all companies from Notion, resolve contact relations.
    Returns a list of customer dicts ready for the frontend.
    """
    # Check cache
    now = time.time()
    if _cache["customers"] and (now - _cache["timestamp"]) < CACHE_TTL:
        return _cache["customers"]

    try:
        # Step 1: Fetch companies
        pages = _query_all_pages(COMPANIES_DB_ID)
        print(f"✓ Fetched {len(pages)} companies from Notion")

        # Step 2: Fetch contacts for resolving relations
        contacts_map = fetch_contacts_map()
        print(f"✓ Fetched {len(contacts_map)} contacts from Notion")

        customers = []
        for page in pages:
            props = page.get("properties", {})

            name = _extract_text(props.get("Customer"), "title")
            if not name:
                continue

            address = _extract_text(props.get("Address"))
            address2 = _extract_text(props.get("Address 2"))
            phone = _extract_text(props.get("Phone"))
            hours = _extract_text(props.get("Hours"))
            notes = _extract_text(props.get("Notes"))
            group = _extract_select(props.get("Group"))

            # Resolve contact relations
            contact_ids = _extract_relation_ids(props.get("Contact"))
            resolved_contacts = []
            for cid in contact_ids:
                if cid in contacts_map:
                    resolved_contacts.append(contacts_map[cid])
                else:
                    # Try fetching the individual contact page
                    try:
                        cp = _fetch_page(cid)
                        cp_props = cp.get("properties", {})
                        cname = _extract_text(cp_props.get("Contact"), "title")
                        email_prop = cp_props.get("E-mail", {})
                        biz_phone = cp_props.get("Business Phone", {})
                        mobile = cp_props.get("Mobile Phone", {})
                        resolved_contacts.append({
                            "name": cname,
                            "title": _extract_text(cp_props.get("Job Title")),
                            "email": email_prop.get("email", "") or "",
                            "phone": (biz_phone.get("phone_number", "") or
                                      mobile.get("phone_number", "") or ""),
                            "pageId": cid,
                        })
                    except Exception:
                        pass

            customer = {
                "id": _make_id(name),
                "name": name,
                "address": address,
                "address2": address2,
                "phone": phone,
                "hours": hours,
                "notes": notes,
                "group": group,
                "contacts": resolved_contacts,
                "pageId": page["id"],
                "notionUrl": f"https://www.notion.so/{page['id'].replace('-', '')}",
            }
            customers.append(customer)

        # Sort by name
        customers.sort(key=lambda c: c["name"].upper())

        # Update cache
        _cache["customers"] = customers
        _cache["timestamp"] = now

        return customers

    except Exception as e:
        print(f"⚠ Notion customer fetch failed: {e}")
        return None


def clear_cache():
    """Clear the customer cache (call after edits)."""
    _cache["customers"] = None
    _cache["timestamp"] = 0


def _rich_text(value):
    """Build a Notion rich_text property value."""
    return [{"type": "text", "text": {"content": value or ""}}]


def _extract_number(prop):
    """Extract a number from a Notion number property."""
    if not prop:
        return None
    return prop.get("number")


def _query_database_filtered(db_id, filter_body, start_cursor=None):
    """Query a Notion database with a filter, returning one page of results."""
    url = f"{NOTION_API_URL}/databases/{db_id}/query"
    body = {"page_size": 100, "filter": filter_body}
    if start_cursor:
        body["start_cursor"] = start_cursor
    resp = requests.post(url, headers=_get_headers(), json=body, timeout=30)
    resp.raise_for_status()
    return resp.json()


def _build_name_variants(company_name):
    """
    Build a list of name variants to try, ordered from most specific to broadest.
    Handles: ALL CAPS vs Title Case, parenthetical suffixes, multi-word names.
    """
    variants = []
    raw = company_name.strip()

    # Helper to add all case variants for a name
    def add_cases(name):
        results = set()
        results.add(name)
        results.add(name.title())
        results.add(" ".join(
            w.capitalize() if w.isalpha() else w
            for w in name.split()
        ))
        return results

    # 1. Full name as-is
    variants.append(add_cases(raw))

    # 2. Strip parenthetical suffix: "BETTAWAY (US Beverage)" -> "BETTAWAY"
    stripped = re.sub(r"\s*\(.*?\)\s*$", "", raw).strip()
    if stripped != raw:
        variants.append(add_cases(stripped))

    # 3. Drop trailing words one at a time: "THEA ENTERPRISE" -> "THEA"
    words = stripped.split()
    for i in range(len(words) - 1, 0, -1):
        shorter = " ".join(words[:i])
        if len(shorter) >= 3:
            variants.append(add_cases(shorter))

    return variants


def _search_products(variant_set, seen_ids):
    """Run starts_with queries for a set of name variants. Returns pages found."""
    pages = []
    for variant in variant_set:
        filter_body = {
            "property": "Product/Service",
            "title": {"starts_with": variant}
        }
        cursor = None
        while True:
            data = _query_database_filtered(PRODUCTS_DB_ID, filter_body, start_cursor=cursor)
            for page in data.get("results", []):
                if page["id"] not in seen_ids:
                    seen_ids.add(page["id"])
                    pages.append(page)
            if not data.get("has_more"):
                break
            cursor = data.get("next_cursor")
    return pages


def fetch_products_by_company(company_name):
    """
    Fetch products from the Product Rates database that match a company name.
    The title field "Product/Service" has format "Company - Product".
    Tries progressively shorter name prefixes to handle mismatches like
    "THEA ENTERPRISE" (Companies DB) vs "Thea" (Product Rates).
    Returns a list of product dicts.
    """
    if not company_name:
        return []

    try:
        variant_groups = _build_name_variants(company_name)

        all_pages = []
        seen_ids = set()

        # Try each variant group; stop as soon as we find results
        for variant_set in variant_groups:
            pages = _search_products(variant_set, seen_ids)
            if pages:
                all_pages.extend(pages)
                break  # Found matches — don't try broader names

        products = []
        for page in all_pages:
            props = page.get("properties", {})
            full_name = _extract_text(props.get("Product/Service"), "title")

            # Parse product from "Company - Product" title
            product_name = ""
            if " - " in full_name:
                product_name = full_name.rsplit(" - ", 1)[1].strip()
            else:
                product_name = full_name

            product = {
                "name": full_name,
                "product": product_name,
                "price": _extract_number(props.get("Price")),
                "cost": _extract_number(props.get("Cost")),
                "category": _extract_select(props.get("Category")),
                "description": _extract_text(props.get("Description")),
            }
            products.append(product)

        # Sort by product name
        products.sort(key=lambda p: p["product"].upper() if p["product"] else "")
        return products

    except Exception as e:
        print(f"⚠ Product fetch failed for '{company_name}': {e}")
        return []


def update_customer(page_id, data):
    """
    Update a company page in Notion.
    data can include: name, address, address2, phone, hours, notes, group
    """
    url = f"{NOTION_API_URL}/pages/{page_id}"
    props = {}

    if "name" in data:
        props["Customer"] = {"title": _rich_text(data["name"])}
    if "address" in data:
        props["Address"] = {"rich_text": _rich_text(data["address"])}
    if "address2" in data:
        props["Address 2"] = {"rich_text": _rich_text(data["address2"])}
    if "phone" in data:
        props["Phone"] = {"rich_text": _rich_text(data["phone"])}
    if "hours" in data:
        props["Hours"] = {"rich_text": _rich_text(data["hours"])}
    if "notes" in data:
        props["Notes"] = {"rich_text": _rich_text(data["notes"])}
    if "group" in data:
        val = (data["group"] or "").strip()
        if val:
            props["Group"] = {"select": {"name": val}}
        else:
            props["Group"] = {"select": None}

    if not props:
        return {"status": "no_changes"}

    body = {"properties": props}
    resp = requests.patch(url, headers=_get_headers(), json=body, timeout=30)
    if not resp.ok:
        print(f"⚠ Notion update_customer error: {resp.status_code} {resp.text}")
    resp.raise_for_status()
    clear_cache()
    return {"status": "ok"}


def update_contact(page_id, data):
    """
    Update a contact page in Notion.
    data can include: name, title, email, phone
    """
    url = f"{NOTION_API_URL}/pages/{page_id}"
    props = {}

    if "name" in data:
        props["Contact"] = {"title": _rich_text(data["name"])}
    if "title" in data:
        props["Job Title"] = {"rich_text": _rich_text(data["title"])}
    if "email" in data:
        val = (data["email"] or "").strip()
        if val:
            props["E-mail"] = {"email": val}
        else:
            props["E-mail"] = {"email": None}
    if "phone" in data:
        val = (data["phone"] or "").strip()
        if val:
            props["Business Phone"] = {"phone_number": val}
        else:
            props["Business Phone"] = {"phone_number": None}

    if not props:
        return {"status": "no_changes"}

    body = {"properties": props}
    resp = requests.patch(url, headers=_get_headers(), json=body, timeout=30)
    if not resp.ok:
        print(f"⚠ Notion update_contact error: {resp.status_code} {resp.text}")
    resp.raise_for_status()
    clear_cache()
    return {"status": "ok"}


# ── Delivery Schedule ──

def _extract_date(prop):
    """Extract an ISO date string from a Notion date property."""
    if not prop:
        return ""
    d = prop.get("date")
    if not d:
        return ""
    return d.get("start", "")


def _extract_status(prop):
    """Extract name from a Notion status property."""
    if not prop:
        return ""
    s = prop.get("status")
    if s and isinstance(s, dict):
        return s.get("name", "")
    return ""


def _resolve_relation_names(page_ids):
    """Fetch page titles for a list of relation page IDs."""
    names = []
    for pid in page_ids:
        try:
            page = _fetch_page(pid)
            props = page.get("properties", {})
            # Try common title property names
            for key in ("Customer", "Name", "Title", "name", "title"):
                if key in props:
                    txt = _extract_text(props[key], "title")
                    if txt:
                        names.append(txt)
                        break
            else:
                # Fallback: scan all props for a title type
                for _k, v in props.items():
                    if v.get("type") == "title":
                        txt = _extract_text(v, "title")
                        if txt:
                            names.append(txt)
                            break
        except Exception:
            names.append(pid[:8])
    return names


def _find_date_property(props):
    """Find the date property regardless of trailing spaces in the name."""
    for key, val in props.items():
        if key.strip().lower() == "date" and isinstance(val, dict):
            if val.get("type") == "date":
                return key, val
    return None, {}


def _build_company_name_map():
    """Build a page_id → company_name lookup from the Companies DB."""
    name_map = {}
    try:
        pages = _query_all_pages(COMPANIES_DB_ID)
        for page in pages:
            props = page.get("properties", {})
            name = _extract_text(props.get("Customer"), "title")
            if name:
                name_map[page["id"]] = name
        print(f"✓ Built company name map: {len(name_map)} entries")
    except Exception as e:
        print(f"⚠ Failed to build company name map: {e}")
    return name_map


def fetch_deliveries_today(date_str=None):
    """
    Fetch today's delivery schedule from the Delivery Schedule database.
    date_str: ISO date string (YYYY-MM-DD). Defaults to today.
    Returns a dict with deliveries list.
    """
    from datetime import date as dt_date

    if not date_str:
        date_str = dt_date.today().isoformat()

    # Pre-build company name lookup (single batch fetch, no per-row API calls)
    company_map = _build_company_name_map()

    deliveries = []
    cursor = None

    while True:
        data = _query_database(DELIVERY_DB_ID, start_cursor=cursor)

        for page in data.get("results", []):
            props = page.get("properties", {})

            # Find the date property (handles trailing space)
            _date_key, date_prop = _find_date_property(props)
            page_date = _extract_date(date_prop)

            # Filter: only include entries matching the target date
            if not page_date or not page_date.startswith(date_str):
                continue

            # Resolve company relation using the pre-built map
            cust_ids = _extract_relation_ids(props.get("Company", {}))
            cust_names = [company_map[cid] for cid in cust_ids if cid in company_map]

            delivery = {
                "id": page["id"],
                "date": page_date,
                "company": ", ".join(cust_names) if cust_names else "",
                "notes": _extract_text(props.get("Notes", {})),
                "driver": _extract_select(props.get("Driver", {})),
                "trip": _extract_number(props.get("Trip #", {})),
                "status": _extract_status(props.get("Status", {})),
                "type": _extract_select(props.get("Type", {})),
            }
            deliveries.append(delivery)

        if not data.get("has_more"):
            break
        cursor = data.get("next_cursor")

    # Sort by trip number, then status
    status_order = {
        "Pending": 0, "Scheduled": 1, "Loaded": 2,
        "On Route": 3, "Completed": 4, "Cancelled": 5,
    }
    deliveries.sort(key=lambda d: (
        status_order.get(d["status"], 99),
        d["trip"] or 999,
    ))

    return {"deliveries": deliveries}
