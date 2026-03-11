#!/usr/bin/env python3
"""
JUST NATION — Email Poller
Polls Outlook (MS Graph API) for new emails, matches against known contacts,
and updates briefing-data.json automatically.

Can run standalone for testing or as a background thread in dashboard_server.py.
"""

import json
import os
import tempfile
import time
import requests
from datetime import datetime, timedelta, timezone
from pathlib import Path

import msal

# ============================================================================
# Azure AD / MSAL Configuration
# ============================================================================

CLIENT_ID = "38628aa9-d0f8-405a-a1e7-e3e8af735c07"
TENANT_ID = "bfeb2076-6e72-4b34-9cf6-60c1773a664f"
AUTHORITY = f"https://login.microsoftonline.com/{TENANT_ID}"
SCOPES = ["https://graph.microsoft.com/Mail.Read"]
GRAPH_BASE = "https://graph.microsoft.com/v1.0"

TOKEN_CACHE_PATH = Path(__file__).parent / "pallet-sales-mcp-server" / ".token-cache.json"
POLL_STATE_PATH = Path(__file__).parent / "email_poll_state.json"
BRIEFING_PATH = Path(__file__).parent / "briefing-data.json"
BRIEFING_JS_PATH = Path(__file__).parent / "briefing-data.js"

MAX_PROCESSED_IDS = 500
OVERDUE_DAYS = 7

# ============================================================================
# Authentication
# ============================================================================

def _load_token_cache():
    """Load the MSAL token cache from disk (shared with Node.js MCP server)."""
    cache = msal.SerializableTokenCache()
    if TOKEN_CACHE_PATH.exists():
        cache.deserialize(TOKEN_CACHE_PATH.read_text())
    return cache


def _save_token_cache(cache):
    """Persist token cache changes back to disk."""
    if cache.has_state_changed:
        TOKEN_CACHE_PATH.write_text(cache.serialize())


def get_token():
    """Acquire an access token silently using cached refresh token.
    Returns the access token string, or None if auth fails."""
    cache = _load_token_cache()
    app = msal.PublicClientApplication(
        CLIENT_ID,
        authority=AUTHORITY,
        token_cache=cache,
    )

    accounts = app.get_accounts()
    if not accounts:
        print("[email_poller] No cached accounts found. Node MCP server must authenticate first.")
        return None

    result = app.acquire_token_silent(SCOPES, account=accounts[0])
    _save_token_cache(cache)

    if result and "access_token" in result:
        return result["access_token"]

    error = result.get("error_description", "Unknown error") if result else "No result"
    print(f"[email_poller] Token acquisition failed: {error}")
    return None


# ============================================================================
# Graph API Email Fetching
# ============================================================================

def _graph_get(token, url):
    """Make an authenticated GET to MS Graph. Returns JSON or None."""
    headers = {"Authorization": f"Bearer {token}"}
    resp = requests.get(url, headers=headers, timeout=30)
    if resp.status_code == 200:
        return resp.json()
    print(f"[email_poller] Graph API {resp.status_code}: {resp.text[:200]}")
    return None


def fetch_recent_emails(token, since_iso):
    """Fetch inbox emails received since `since_iso` (ISO 8601 string)."""
    url = (
        f"{GRAPH_BASE}/me/messages"
        f"?$filter=receivedDateTime ge {since_iso}"
        f"&$select=id,from,toRecipients,subject,receivedDateTime,isRead"
        f"&$top=50&$orderby=receivedDateTime desc"
    )
    data = _graph_get(token, url)
    return data.get("value", []) if data else []


def search_emails(token, query, top=10):
    """Search emails using MS Graph $search. Returns list of email summaries."""
    import urllib.parse
    encoded = urllib.parse.quote(query)
    url = (
        f"{GRAPH_BASE}/me/messages"
        f"?$search=\"{encoded}\""
        f"&$select=id,from,toRecipients,subject,receivedDateTime,bodyPreview,isRead"
        f"&$top={top}"
    )
    data = _graph_get(token, url)
    if not data:
        return []
    results = []
    for msg in data.get("value", []):
        from_addr = _get_email_address(msg.get("from"))
        from_name = msg.get("from", {}).get("emailAddress", {}).get("name", from_addr)
        to_list = [
            _get_email_address(r) for r in msg.get("toRecipients", [])
        ]
        results.append({
            "from": from_name,
            "fromEmail": from_addr,
            "to": to_list,
            "subject": msg.get("subject", ""),
            "date": msg.get("receivedDateTime", ""),
            "preview": msg.get("bodyPreview", "")[:300],
            "isRead": msg.get("isRead", True),
        })
    return results


def get_email_by_subject(token, subject, top=5):
    """Find emails by subject line."""
    return search_emails(token, f"subject:{subject}", top)


def get_emails_from_contact(token, email_addr, top=10):
    """Find emails from a specific sender."""
    return search_emails(token, f"from:{email_addr}", top)


def fetch_sent_emails(token, since_iso):
    """Fetch sent emails since `since_iso`."""
    url = (
        f"{GRAPH_BASE}/me/mailFolders/sentItems/messages"
        f"?$filter=sentDateTime ge {since_iso}"
        f"&$select=id,toRecipients,subject,sentDateTime"
        f"&$top=50&$orderby=sentDateTime desc"
    )
    data = _graph_get(token, url)
    return data.get("value", []) if data else []


# ============================================================================
# Contact Matching
# ============================================================================

def _get_email_address(email_obj):
    """Extract email address from a Graph email address object."""
    if not email_obj:
        return None
    addr = email_obj.get("emailAddress", {})
    return (addr.get("address") or "").lower().strip()


def match_contact(email_addr, contact_index):
    """Look up an email address in the contact index. Returns match dict or None."""
    if not email_addr:
        return None
    return contact_index.get(email_addr.lower().strip())


# ============================================================================
# State Management
# ============================================================================

def load_poll_state():
    """Load persisted poll state."""
    if POLL_STATE_PATH.exists():
        try:
            return json.loads(POLL_STATE_PATH.read_text())
        except (json.JSONDecodeError, IOError):
            pass
    return {
        "last_poll_time": None,
        "contact_last_seen": {},
        "waiting_since": {},
        "processed_message_ids": [],
    }


def save_poll_state(state):
    """Persist poll state atomically."""
    # Trim processed IDs to prevent unbounded growth
    if len(state.get("processed_message_ids", [])) > MAX_PROCESSED_IDS:
        state["processed_message_ids"] = state["processed_message_ids"][-MAX_PROCESSED_IDS:]

    tmp_fd, tmp_path = tempfile.mkstemp(dir=POLL_STATE_PATH.parent, suffix=".tmp")
    try:
        with os.fdopen(tmp_fd, "w") as f:
            json.dump(state, f, indent=2)
        os.replace(tmp_path, POLL_STATE_PATH)
    except Exception:
        if os.path.exists(tmp_path):
            os.unlink(tmp_path)
        raise


# ============================================================================
# Briefing Data Updates
# ============================================================================

def load_briefing():
    """Load current briefing-data.json."""
    if BRIEFING_PATH.exists():
        return json.loads(BRIEFING_PATH.read_text())
    return {}


def save_briefing(data):
    """Atomically write briefing-data.json and regenerate briefing-data.js."""
    # Write JSON atomically
    tmp_fd, tmp_path = tempfile.mkstemp(dir=BRIEFING_PATH.parent, suffix=".tmp")
    try:
        with os.fdopen(tmp_fd, "w") as f:
            json.dump(data, f, indent=2)
        os.replace(tmp_path, BRIEFING_PATH)
    except Exception:
        if os.path.exists(tmp_path):
            os.unlink(tmp_path)
        raise

    # Regenerate JS wrapper
    js_content = f"window.BRIEFING_DATA = {json.dumps(data)};"
    BRIEFING_JS_PATH.write_text(js_content)


def _now_iso():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def apply_updates(briefing, inbox_emails, sent_emails, contact_index, state):
    """Apply email-based updates to briefing data. Returns True if changes were made."""
    changed = False
    processed = set(state.get("processed_message_ids", []))
    waiting_on = briefing.get("waitingOn", [])
    overdue = briefing.get("overdue", [])
    actions = briefing.get("todaysActions", [])
    contact_last_seen = state.get("contact_last_seen", {})

    # --- Process inbox emails ---
    for msg in inbox_emails:
        msg_id = msg.get("id", "")
        if msg_id in processed:
            continue
        processed.add(msg_id)

        from_addr = _get_email_address(msg.get("from"))
        contact = match_contact(from_addr, contact_index)
        subject = msg.get("subject", "(no subject)")
        is_read = msg.get("isRead", True)
        received = msg.get("receivedDateTime", "")

        if not contact:
            continue

        name = contact.get("name", from_addr)
        company = contact.get("company", "")
        topic_id = contact.get("topicId", "")

        # Update last-seen timestamp
        contact_last_seen[from_addr] = received

        # Rule 1: WaitingOn resolution — email FROM a waiting contact
        resolved_waiting = []
        for item in waiting_on:
            item_topic = item.get("topicId", "")
            item_contact = (item.get("contact") or "").lower()
            # Match by topicId or by contact name substring
            if topic_id and item_topic == topic_id:
                resolved_waiting.append(item)
            elif name.lower() in item_contact or (from_addr and from_addr in item_contact):
                resolved_waiting.append(item)

        for item in resolved_waiting:
            waiting_on.remove(item)
            action_text = f"[REPLY RECEIVED] {name} responded — {subject}"
            if action_text not in actions:
                actions.insert(0, action_text)
            changed = True

        # Rule 4: Overdue resolution — email from overdue contact
        resolved_overdue = []
        for item in overdue:
            item_topic = item.get("topicId", "")
            item_contact = (item.get("contact") or "").lower()
            if topic_id and item_topic == topic_id:
                resolved_overdue.append(item)
            elif name.lower() in item_contact:
                resolved_overdue.append(item)

        for item in resolved_overdue:
            overdue.remove(item)
            changed = True

        # Rule 5: New unread email notification
        if not is_read:
            action_text = f"[NEW EMAIL] {name} ({company}) — {subject}"
            if action_text not in actions:
                actions.insert(0, action_text)
                changed = True

    # --- Process sent emails ---
    for msg in sent_emails:
        msg_id = msg.get("id", "")
        if msg_id in processed:
            continue
        processed.add(msg_id)

        for recip in msg.get("toRecipients", []):
            to_addr = _get_email_address(recip)
            contact = match_contact(to_addr, contact_index)
            if not contact:
                continue

            sent_time = msg.get("sentDateTime", "")
            contact_last_seen[to_addr] = sent_time

            # Rule 4: Overdue resolution — we sent to overdue contact
            topic_id = contact.get("topicId", "")
            name = contact.get("name", to_addr)
            resolved_overdue = []
            for item in overdue:
                item_topic = item.get("topicId", "")
                item_contact = (item.get("contact") or "").lower()
                if topic_id and item_topic == topic_id:
                    resolved_overdue.append(item)
                elif name.lower() in item_contact:
                    resolved_overdue.append(item)
            for item in resolved_overdue:
                overdue.remove(item)
                changed = True

    # --- Rule 2: Recalculate waitingOn day counters ---
    now = datetime.now(timezone.utc)
    for item in waiting_on:
        # Use waiting_since from state, or estimate from current days value
        topic_id = item.get("topicId", "")
        if topic_id in state.get("waiting_since", {}):
            since_str = state["waiting_since"][topic_id]
            try:
                since_dt = datetime.fromisoformat(since_str.replace("Z", "+00:00"))
                new_days = (now - since_dt).days
                if new_days != item.get("days"):
                    item["days"] = new_days
                    changed = True
            except (ValueError, TypeError):
                pass

    # --- Update state ---
    state["processed_message_ids"] = list(processed)
    state["contact_last_seen"] = contact_last_seen
    state["last_poll_time"] = _now_iso()

    # Persist waiting_since for items that don't have one yet
    waiting_since = state.get("waiting_since", {})
    for item in waiting_on:
        tid = item.get("topicId", "")
        if tid and tid not in waiting_since:
            # Estimate start date from current days count
            days = item.get("days", 0) or 0
            estimated = now - timedelta(days=days)
            waiting_since[tid] = estimated.strftime("%Y-%m-%dT%H:%M:%SZ")
    state["waiting_since"] = waiting_since

    # Write back
    briefing["waitingOn"] = waiting_on
    briefing["overdue"] = overdue
    briefing["todaysActions"] = actions

    return changed


# ============================================================================
# Main Poll Cycle
# ============================================================================

def run_poll(briefing_path=None, contact_index=None):
    """Execute one full poll cycle: auth -> fetch -> match -> update -> write.

    Args:
        briefing_path: Path to briefing-data.json (uses default if None)
        contact_index: Dict {email_lower: {name, company, topicId}} (uses empty if None)
    """
    global BRIEFING_PATH, BRIEFING_JS_PATH
    if briefing_path:
        BRIEFING_PATH = Path(briefing_path)
        BRIEFING_JS_PATH = BRIEFING_PATH.parent / "briefing-data.js"

    if contact_index is None:
        contact_index = {}

    # Authenticate
    token = get_token()
    if not token:
        print("[email_poller] Skipping cycle — no valid token")
        return False

    # Load state
    state = load_poll_state()

    # Determine time window
    last_poll = state.get("last_poll_time")
    if last_poll:
        since_iso = last_poll
    else:
        # First run — look back 24 hours
        since_iso = (datetime.now(timezone.utc) - timedelta(hours=24)).strftime("%Y-%m-%dT%H:%M:%SZ")

    print(f"[email_poller] Polling emails since {since_iso}")

    # Fetch emails
    inbox = fetch_recent_emails(token, since_iso)
    sent = fetch_sent_emails(token, since_iso)
    print(f"[email_poller] Found {len(inbox)} inbox, {len(sent)} sent emails")

    # Load and update briefing
    briefing = load_briefing()
    changed = apply_updates(briefing, inbox, sent, contact_index, state)

    if changed:
        save_briefing(briefing)
        print("[email_poller] Briefing data updated")
    else:
        print("[email_poller] No changes to briefing data")

    # Always save state (updated timestamps, processed IDs)
    save_poll_state(state)
    return changed


# ============================================================================
# Standalone Execution (for testing)
# ============================================================================

if __name__ == "__main__":
    print("=" * 50)
    print("JUST NATION — Email Poller (standalone test)")
    print("=" * 50)

    # Build a basic contact index from CLAUDE.md known contacts
    # In production, dashboard_server.py builds this from Notion
    test_contacts = {
        "juano@3gwhse.com": {"name": "Juan Ocampo", "company": "3G Warehouse", "topicId": "3g-warehouse"},
        "ptierney@21stcenturydistribution.com": {"name": "Patrick Tierney", "company": "21st Century", "topicId": ""},
        "nj@deftfulfillment.com": {"name": "Jenny", "company": "DeftFulfillment", "topicId": ""},
        "ralph.perez@expeditors.com": {"name": "Ralph Perez", "company": "Expeditors", "topicId": ""},
        "jcoyle@ongweoweh.com": {"name": "Jazlyn Coyle", "company": "Ongweoweh", "topicId": "ongweoweh-pennsauken"},
        "cmarziano@ongweoweh.com": {"name": "Cora Marziano", "company": "Ongweoweh", "topicId": "ongweoweh-lakewood"},
        "rpearsall@risingpharma.com": {"name": "Richard Pearsall", "company": "Rising Pharma", "topicId": "rising-pharma"},
        "jorge.llanos@bms.com": {"name": "Jorge Llanos", "company": "Bristol Myers", "topicId": "bristol-myers"},
        "wromm@ferrarofoods.com": {"name": "Wendy Romm", "company": "Ferraro Foods", "topicId": "ferraro-foods"},
        "ken.mancuso@pepsico.com": {"name": "Ken Mancuso", "company": "PepsiCo", "topicId": "pepsico"},
        "jt.jones@novolex.com": {"name": "JT Jones", "company": "Novolex", "topicId": "novolex"},
        "thomas@ppoic.com": {"name": "Thomas Winch", "company": "PPOIC", "topicId": "ppoic"},
        "acalixto@rosepallet.com": {"name": "Ana Calixto", "company": "Rose Pallet", "topicId": "rose-pallet"},
        "carl@udsnj.com": {"name": "Carl Ingargiola", "company": "UDS", "topicId": ""},
        "chai12036@yahoo.com": {"name": "Ben Friedlander", "company": "BC USA", "topicId": "bc-usa"},
        "sal@stoneworkinc.com": {"name": "Salvatore Biondo", "company": "Stonework Inc", "topicId": "stonework-inc"},
        "jravallese@peerlessbev.com": {"name": "Jim Ravallese", "company": "Peerless Beverage", "topicId": ""},
        "nj.accounting@yankeeclipperdist.com": {"name": "David Testa", "company": "Yankee Clipper", "topicId": ""},
        "juanc.illescas@drpraegers.com": {"name": "Juan Illescas", "company": "Dr. Praeger's", "topicId": ""},
        "mike.walker@smtmiss.com": {"name": "Mike Walker", "company": "Southern MS Trading", "topicId": ""},
    }

    result = run_poll(contact_index=test_contacts)
    print(f"\nPoll complete. Changes made: {result}")
