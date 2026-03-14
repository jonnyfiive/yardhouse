#!/usr/bin/env python3
"""
JUST NATION — QuickBooks Online Integration
OAuth2 flow + invoice queries for A/R balances.
"""

import json
import os
import time
from datetime import datetime, date
from intuitlib.client import AuthClient
from intuitlib.enums import Scopes
from quickbooks import QuickBooks
from quickbooks.objects.invoice import Invoice
from quickbooks.objects.creditmemo import CreditMemo

# ============================================================================
# Configuration
# ============================================================================

QBO_CLIENT_ID = os.environ.get("QBO_CLIENT_ID", "")
QBO_CLIENT_SECRET = os.environ.get("QBO_CLIENT_SECRET", "")
QBO_REDIRECT_URI = os.environ.get("QBO_REDIRECT_URI", "http://localhost:5050/qbo/callback")
# Production requires HTTPS non-localhost redirect. Use Intuit's playground URL for OAuth,
# then manually exchange the code via /qbo/exchange endpoint.
QBO_PROD_REDIRECT_URI = "https://developer.intuit.com/v2/OAuth2Playground/RedirectUrl"
QBO_ENVIRONMENT = os.environ.get("QBO_ENVIRONMENT", "production")  # 'sandbox' or 'production'

# Token storage file (persists refresh tokens across restarts)
TOKEN_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".qbo_tokens.json")

# Cache
_ar_cache = {"data": None, "ts": 0}
AR_CACHE_TTL = 300  # 5 minutes


# ============================================================================
# Token Management
# ============================================================================

def _load_tokens():
    """Load saved tokens from disk or QBO_TOKENS_JSON env var."""
    if os.path.exists(TOKEN_FILE):
        with open(TOKEN_FILE, "r") as f:
            return json.load(f)
    env_tokens = os.environ.get("QBO_TOKENS_JSON")
    if env_tokens:
        try:
            return json.loads(env_tokens)
        except json.JSONDecodeError:
            pass
    return {}


def _sync_tokens_to_railway(tokens):
    """Push QBO tokens to Railway so the mobile app stays in sync.
    Runs in a background thread to avoid blocking the request."""
    import threading

    def _push():
        try:
            import subprocess
            token_json = json.dumps(tokens)
            # Use Railway CLI to set the env var
            result = subprocess.run(
                ["railway", "variables", "set", f"QBO_TOKENS_JSON={token_json}"],
                capture_output=True, text=True, timeout=30,
                cwd=os.path.dirname(os.path.abspath(__file__)),
            )
            if result.returncode == 0:
                print("   QBO: tokens synced to Railway", flush=True)
            else:
                print(f"   QBO: Railway sync failed — {result.stderr[:200]}", flush=True)
        except FileNotFoundError:
            print("   QBO: Railway CLI not installed — skipping sync", flush=True)
        except Exception as e:
            print(f"   QBO: Railway sync error — {e}", flush=True)

    threading.Thread(target=_push, daemon=True).start()


def _save_tokens(tokens):
    """Persist tokens to disk and sync to Railway."""
    with open(TOKEN_FILE, "w") as f:
        json.dump(tokens, f)
    # Push to Railway in background so mobile app always has fresh tokens
    _sync_tokens_to_railway(tokens)


def get_auth_client():
    """Create an AuthClient instance."""
    tokens = _load_tokens()
    return AuthClient(
        client_id=QBO_CLIENT_ID,
        client_secret=QBO_CLIENT_SECRET,
        access_token=tokens.get("access_token", ""),
        refresh_token=tokens.get("refresh_token", ""),
        realm_id=tokens.get("realm_id", ""),
        environment=QBO_ENVIRONMENT,
        redirect_uri=QBO_REDIRECT_URI,
    )


def get_auth_url():
    """Generate the OAuth2 authorization URL.
    For production, uses the Intuit Playground redirect URI since
    localhost is not allowed for production redirect URIs.
    """
    redirect = QBO_PROD_REDIRECT_URI if QBO_ENVIRONMENT == "production" else QBO_REDIRECT_URI
    auth_client = AuthClient(
        client_id=QBO_CLIENT_ID,
        client_secret=QBO_CLIENT_SECRET,
        environment=QBO_ENVIRONMENT,
        redirect_uri=redirect,
    )
    url = auth_client.get_authorization_url([Scopes.ACCOUNTING])
    return url, auth_client.state_token


def handle_callback(auth_code, realm_id, state=None):
    """Exchange auth code for tokens and save them (sandbox/localhost flow)."""
    auth_client = AuthClient(
        client_id=QBO_CLIENT_ID,
        client_secret=QBO_CLIENT_SECRET,
        environment=QBO_ENVIRONMENT,
        redirect_uri=QBO_REDIRECT_URI,
    )
    auth_client.get_bearer_token(auth_code, realm_id=realm_id)
    tokens = {
        "access_token": auth_client.access_token,
        "refresh_token": auth_client.refresh_token,
        "realm_id": realm_id,
        "expires_at": time.time() + 3600,
        "refresh_expires_at": time.time() + (100 * 24 * 3600),  # ~100 days
    }
    _save_tokens(tokens)
    return tokens


def handle_prod_exchange(auth_code, realm_id):
    """Exchange auth code for tokens using the production playground redirect URI."""
    auth_client = AuthClient(
        client_id=QBO_CLIENT_ID,
        client_secret=QBO_CLIENT_SECRET,
        environment=QBO_ENVIRONMENT,
        redirect_uri=QBO_PROD_REDIRECT_URI,
    )
    auth_client.get_bearer_token(auth_code, realm_id=realm_id)
    tokens = {
        "access_token": auth_client.access_token,
        "refresh_token": auth_client.refresh_token,
        "realm_id": realm_id,
        "expires_at": time.time() + 3600,
        "refresh_expires_at": time.time() + (100 * 24 * 3600),  # ~100 days
    }
    _save_tokens(tokens)
    return tokens


def _get_qb_client():
    """Get an authenticated QuickBooks client, refreshing tokens if needed."""
    tokens = _load_tokens()
    if not tokens.get("refresh_token"):
        return None

    auth_client = AuthClient(
        client_id=QBO_CLIENT_ID,
        client_secret=QBO_CLIENT_SECRET,
        access_token=tokens.get("access_token", ""),
        refresh_token=tokens.get("refresh_token", ""),
        environment=QBO_ENVIRONMENT,
        redirect_uri=QBO_REDIRECT_URI,
    )

    # Refresh if expired or about to expire
    if tokens.get("expires_at", 0) < time.time() + 60:
        auth_client.refresh()
        tokens["access_token"] = auth_client.access_token
        tokens["refresh_token"] = auth_client.refresh_token
        tokens["expires_at"] = time.time() + 3600
        _save_tokens(tokens)

    client = QuickBooks(
        auth_client=auth_client,
        refresh_token=tokens["refresh_token"],
        company_id=tokens["realm_id"],
    )
    return client


# ============================================================================
# A/R Queries
# ============================================================================

def _query_all_open_invoices(client):
    """
    Paginate through ALL open invoices using python-quickbooks.
    The .where() method defaults to max 100 results.
    We paginate with start_position to get everything.
    """
    all_invoices = []
    start_pos = 1
    page_size = 100  # QBO default page size

    while True:
        batch = Invoice.where(
            "Balance > '0'",
            start_position=start_pos,
            max_results=page_size,
            qb=client,
        )
        if not batch:
            break

        all_invoices.extend(batch)

        if len(batch) < page_size:
            break  # Last page

        start_pos += page_size

    return all_invoices


def _query_all_open_credit_memos(client):
    """
    Paginate through ALL open credit memos (unapplied credits).
    These reduce the effective A/R balance.
    """
    all_memos = []
    start_pos = 1
    page_size = 100

    while True:
        try:
            batch = CreditMemo.where(
                "RemainingCredit > '0'",
                start_position=start_pos,
                max_results=page_size,
                qb=client,
            )
        except Exception:
            # Fallback: query all and filter
            try:
                batch = CreditMemo.where(
                    "Balance > '0'",
                    start_position=start_pos,
                    max_results=page_size,
                    qb=client,
                )
            except Exception:
                break
        if not batch:
            break

        all_memos.extend(batch)

        if len(batch) < page_size:
            break
        start_pos += page_size

    return all_memos


def get_ar_summary():
    """
    Query open invoices and return A/R summary:
    - total_open: sum of all unpaid invoice balances
    - total_overdue: sum of balances past due date
    - overdue_count: number of overdue invoices
    - open_count: number of open invoices
    - aging buckets: current, 1-30, 31-60, 61-90, 90+
    """
    global _ar_cache
    now = time.time()
    if _ar_cache["data"] and (now - _ar_cache["ts"]) < AR_CACHE_TTL:
        return _ar_cache["data"]

    client = _get_qb_client()
    if not client:
        return {"error": "not_connected", "message": "QuickBooks not connected"}

    try:
        # PRIMARY: Use QBO's AgedReceivables report (matches QBO UI)
        report = get_ar_from_report()
        if "error" not in report and report.get("raw_totals"):
            totals = report["raw_totals"]
            total_open = totals.get("total", 0)
            overdue = totals.get("1_30", 0) + totals.get("31_60", 0) + totals.get("61_90", 0) + totals.get("91_plus", 0)

            # Count invoices via query for the count (report doesn't give count)
            invoices = _query_all_open_invoices(client)
            today = date.today()
            overdue_count = 0
            for inv in invoices:
                if inv.DueDate:
                    try:
                        due = datetime.strptime(str(inv.DueDate), "%Y-%m-%d").date()
                        if due < today:
                            overdue_count += 1
                    except (ValueError, TypeError):
                        pass

            result = {
                "total_open": round(total_open, 2),
                "total_overdue": round(overdue, 2),
                "open_count": len(invoices),
                "overdue_count": overdue_count,
                "source": "report_api",
                "aging": {
                    "current": round(totals.get("current", 0), 2),
                    "1_30": round(totals.get("1_30", 0), 2),
                    "31_60": round(totals.get("31_60", 0), 2),
                    "61_90": round(totals.get("61_90", 0), 2),
                    "90_plus": round(totals.get("91_plus", 0), 2),
                },
                "last_updated": datetime.now().isoformat(),
            }
        else:
            # FALLBACK: Use invoice query if report fails
            invoices = _query_all_open_invoices(client)
            today = date.today()
            total_open = 0.0
            total_overdue = 0.0
            overdue_count = 0
            current = 0.0
            days_1_30 = 0.0
            days_31_60 = 0.0
            days_61_90 = 0.0
            days_90_plus = 0.0

            for inv in invoices:
                balance = float(inv.Balance or 0)
                total_open += balance
                due_date = None
                if inv.DueDate:
                    try:
                        due_date = datetime.strptime(str(inv.DueDate), "%Y-%m-%d").date()
                    except (ValueError, TypeError):
                        pass
                if due_date and due_date < today:
                    total_overdue += balance
                    overdue_count += 1
                    days_past = (today - due_date).days
                    if days_past <= 30:
                        days_1_30 += balance
                    elif days_past <= 60:
                        days_31_60 += balance
                    elif days_past <= 90:
                        days_61_90 += balance
                    else:
                        days_90_plus += balance
                else:
                    current += balance

            result = {
                "total_open": round(total_open, 2),
                "total_overdue": round(total_overdue, 2),
                "open_count": len(invoices),
                "overdue_count": overdue_count,
                "source": "invoice_query_fallback",
                "aging": {
                    "current": round(current, 2),
                    "1_30": round(days_1_30, 2),
                    "31_60": round(days_31_60, 2),
                    "61_90": round(days_61_90, 2),
                    "90_plus": round(days_90_plus, 2),
                },
                "last_updated": datetime.now().isoformat(),
            }

        _ar_cache = {"data": result, "ts": now}
        return result

    except Exception as e:
        error_msg = str(e)
        if "401" in error_msg or "AuthorizationFault" in error_msg:
            return {"error": "token_expired", "message": "QuickBooks authorization expired. Please reconnect."}
        return {"error": "api_error", "message": error_msg}


def get_ar_debug():
    """Debug endpoint: return raw invoice count and first/last few invoices."""
    client = _get_qb_client()
    if not client:
        return {"error": "not_connected"}

    try:
        invoices = _query_all_open_invoices(client)
        summaries = []
        for inv in invoices:
            cust_ref = inv.CustomerRef
            cust_name = cust_ref.name if cust_ref else "?"
            summaries.append({
                "id": inv.Id,
                "customer": cust_name,
                "balance": float(inv.Balance or 0),
                "total": float(inv.TotalAmt or 0),
                "due_date": str(inv.DueDate) if inv.DueDate else None,
                "doc_number": inv.DocNumber,
            })

        total = sum(s["balance"] for s in summaries)

        # Also get credit memos
        credit_memos = _query_all_open_credit_memos(client)
        cm_summaries = []
        total_credits = 0.0
        for cm in credit_memos:
            credit_amt = float(getattr(cm, 'RemainingCredit', None) or cm.Balance or 0)
            total_credits += credit_amt
            cust_ref = cm.CustomerRef
            cust_name = cust_ref.name if cust_ref else "?"
            cm_summaries.append({
                "id": cm.Id,
                "customer": cust_name,
                "credit": credit_amt,
                "doc_number": cm.DocNumber,
                "date": str(cm.TxnDate) if cm.TxnDate else None,
            })

        return {
            "invoice_count": len(summaries),
            "total_open_balance": round(total, 2),
            "credit_memo_count": len(cm_summaries),
            "total_credits": round(total_credits, 2),
            "net_open": round(total - total_credits, 2),
            "invoices": sorted(summaries, key=lambda x: -x["balance"]),
            "credit_memos": sorted(cm_summaries, key=lambda x: -x["credit"]),
        }
    except Exception as e:
        return {"error": str(e)}


def get_ar_from_report():
    """
    Pull A/R summary directly from QBO's AgedReceivables report.
    This should match exactly what the QBO UI shows.
    """
    client = _get_qb_client()
    if not client:
        return {"error": "not_connected"}

    try:
        # Use the QBO report API via raw query
        # The python-quickbooks client exposes the underlying auth for raw requests
        import requests as req

        tokens = _load_tokens()
        realm_id = tokens["realm_id"]
        access_token = tokens["access_token"]

        base_url = "https://quickbooks.api.intuit.com" if QBO_ENVIRONMENT == "production" else "https://sandbox-quickbooks.api.intuit.com"

        # AgedReceivables summary report
        url = f"{base_url}/v3/company/{realm_id}/reports/AgedReceivables"
        headers = {
            "Authorization": f"Bearer {access_token}",
            "Accept": "application/json",
        }
        params = {
            "date_macro": "Today",
        }

        resp = req.get(url, headers=headers, params=params)
        resp.raise_for_status()
        report_data = resp.json()

        # Parse the report structure
        result = {
            "report_name": report_data.get("Header", {}).get("ReportName", ""),
            "report_date": report_data.get("Header", {}).get("DateMacro", ""),
            "raw_totals": {},
        }

        # Extract totals from the report
        rows = report_data.get("Rows", {})
        # The last row group typically has the totals
        row_list = rows.get("Row", [])

        customers = []
        for row in row_list:
            if row.get("type") == "Data":
                cols = row.get("ColData", [])
                if cols:
                    customer_entry = {
                        "customer": cols[0].get("value", "") if len(cols) > 0 else "",
                        "current": float(cols[1].get("value", "0") or "0") if len(cols) > 1 else 0,
                        "1_30": float(cols[2].get("value", "0") or "0") if len(cols) > 2 else 0,
                        "31_60": float(cols[3].get("value", "0") or "0") if len(cols) > 3 else 0,
                        "61_90": float(cols[4].get("value", "0") or "0") if len(cols) > 4 else 0,
                        "91_plus": float(cols[5].get("value", "0") or "0") if len(cols) > 5 else 0,
                        "total": float(cols[6].get("value", "0") or "0") if len(cols) > 6 else 0,
                    }
                    customers.append(customer_entry)
            elif row.get("group") == "GrandTotal" or row.get("type") == "Section":
                # Check for summary row or nested sections
                summary = row.get("Summary", {})
                if summary:
                    cols = summary.get("ColData", [])
                    if cols and cols[0].get("value", "").lower() == "total":
                        result["raw_totals"] = {
                            "current": float(cols[1].get("value", "0") or "0") if len(cols) > 1 else 0,
                            "1_30": float(cols[2].get("value", "0") or "0") if len(cols) > 2 else 0,
                            "31_60": float(cols[3].get("value", "0") or "0") if len(cols) > 3 else 0,
                            "61_90": float(cols[4].get("value", "0") or "0") if len(cols) > 4 else 0,
                            "91_plus": float(cols[5].get("value", "0") or "0") if len(cols) > 5 else 0,
                            "total": float(cols[6].get("value", "0") or "0") if len(cols) > 6 else 0,
                        }
                # Also check Rows inside sections
                sub_rows = row.get("Rows", {}).get("Row", [])
                for sr in sub_rows:
                    if sr.get("type") == "Data":
                        cols = sr.get("ColData", [])
                        if cols:
                            customer_entry = {
                                "customer": cols[0].get("value", "") if len(cols) > 0 else "",
                                "current": float(cols[1].get("value", "0") or "0") if len(cols) > 1 else 0,
                                "1_30": float(cols[2].get("value", "0") or "0") if len(cols) > 2 else 0,
                                "31_60": float(cols[3].get("value", "0") or "0") if len(cols) > 3 else 0,
                                "61_90": float(cols[4].get("value", "0") or "0") if len(cols) > 4 else 0,
                                "91_plus": float(cols[5].get("value", "0") or "0") if len(cols) > 5 else 0,
                                "total": float(cols[6].get("value", "0") or "0") if len(cols) > 6 else 0,
                            }
                            customers.append(customer_entry)

        result["customers"] = customers
        result["customer_count"] = len(customers)

        # If we found grand totals, use them
        if result["raw_totals"]:
            totals = result["raw_totals"]
            result["total_open"] = totals.get("total", 0)
            result["total_overdue"] = totals.get("1_30", 0) + totals.get("31_60", 0) + totals.get("61_90", 0) + totals.get("91_plus", 0)

        return result

    except Exception as e:
        return {"error": str(e)}


def get_top_overdue_customers(limit=3):
    """
    Return the top N customers by overdue balance, computed from invoice data.
    Each entry: {customer, overdue_amount, total_balance, invoice_count}
    """
    client = _get_qb_client()
    if not client:
        return {"error": "not_connected"}

    try:
        invoices = _query_all_open_invoices(client)
        today = date.today()
        by_customer = {}

        for inv in invoices:
            balance = float(inv.Balance or 0)
            cust_ref = inv.CustomerRef
            cust_name = cust_ref.name if cust_ref else "Unknown"

            if cust_name not in by_customer:
                by_customer[cust_name] = {"overdue": 0.0, "total": 0.0, "count": 0}

            by_customer[cust_name]["total"] += balance
            by_customer[cust_name]["count"] += 1

            if inv.DueDate:
                try:
                    due = datetime.strptime(str(inv.DueDate), "%Y-%m-%d").date()
                    if due < today:
                        by_customer[cust_name]["overdue"] += balance
                except (ValueError, TypeError):
                    pass

        # Filter to only customers with overdue balance, sort descending
        overdue_list = [
            {
                "customer": name,
                "overdue_amount": round(data["overdue"], 2),
                "total_balance": round(data["total"], 2),
                "invoice_count": data["count"],
            }
            for name, data in by_customer.items()
            if data["overdue"] > 0
        ]
        overdue_list.sort(key=lambda x: -x["overdue_amount"])

        return {
            "top_overdue": overdue_list[:limit],
            "total_overdue_customers": len(overdue_list),
        }

    except Exception as e:
        return {"error": str(e)}


def is_connected():
    """Check if we have valid QBO tokens."""
    tokens = _load_tokens()
    return bool(tokens.get("refresh_token"))


def disconnect():
    """Remove saved tokens."""
    if os.path.exists(TOKEN_FILE):
        os.remove(TOKEN_FILE)
    _ar_cache["data"] = None
    _ar_cache["ts"] = 0
