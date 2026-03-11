"""
Just Nation Daily Briefing — Chat Server
Flask app that serves the briefing dashboard + AI chat via Anthropic API.
"""
import os
import json
import time
from pathlib import Path
from flask import Flask, request, Response, send_from_directory, jsonify, stream_with_context
from dotenv import load_dotenv
import anthropic

# ── Config ──
BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / '.env')

app = Flask(__name__, static_folder=str(BASE_DIR / 'static'))
client = None
API_KEY = os.getenv('ANTHROPIC_API_KEY', '')

@app.after_request
def add_cors_headers(response):
    response.headers['Access-Control-Allow-Origin'] = '*'
    response.headers['Access-Control-Allow-Headers'] = 'Content-Type'
    response.headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS'
    return response

def get_client():
    global client
    if client is None:
        if not API_KEY:
            raise RuntimeError("ANTHROPIC_API_KEY not set in .env")
        client = anthropic.Anthropic(api_key=API_KEY)
    return client

# ── Import tools ──
from tools import TOOL_DEFINITIONS, execute_tool
from system_prompt import build_system_prompt

# ═══════════════════════════════════════
# ROUTES
# ═══════════════════════════════════════

@app.route('/')
def index():
    return send_from_directory(str(BASE_DIR), 'Daily Briefing.html')

@app.route('/briefing-data.js')
def briefing_js():
    return send_from_directory(str(BASE_DIR), 'briefing-data.js')

@app.route('/briefing-data.json')
def briefing_json():
    return send_from_directory(str(BASE_DIR), 'briefing-data.json')

@app.route('/Company Logo/<path:filename>')
def company_logo(filename):
    return send_from_directory(str(BASE_DIR / 'Company Logo'), filename)

@app.route('/static/<path:filename>')
def static_files(filename):
    return send_from_directory(str(BASE_DIR / 'static'), filename)

@app.route('/api/health')
def health():
    return jsonify({
        "status": "ok",
        "api_key_configured": bool(API_KEY),
        "base_dir": str(BASE_DIR)
    })

# ═══════════════════════════════════════
# CHAT ENDPOINT (SSE Streaming)
# ═══════════════════════════════════════

@app.route('/api/chat', methods=['POST', 'OPTIONS'])
def chat():
    if request.method == 'OPTIONS':
        return Response('', status=204)
    data = request.json
    messages = data.get('messages', [])
    print(f"\n→ Chat request: {len(messages)} messages")
    if not messages:
        return jsonify({"error": "No messages provided"}), 400

    try:
        c = get_client()
        print("→ Anthropic client ready")
    except RuntimeError as e:
        print(f"→ Client error: {e}")
        return jsonify({"error": str(e)}), 500

    system_prompt = build_system_prompt(BASE_DIR)

    def generate():
        nonlocal messages
        # Tool use loop — keep going until Claude gives a final text response
        max_iterations = 10
        for iteration in range(max_iterations):
            try:
                with c.messages.stream(
                    model="claude-sonnet-4-20250514",
                    max_tokens=4096,
                    system=system_prompt,
                    messages=messages,
                    tools=TOOL_DEFINITIONS,
                ) as stream:
                    # Collect the full response for tool use handling
                    full_content_blocks = []
                    has_tool_use = False

                    for event in stream:
                        if event.type == 'content_block_start':
                            block = event.content_block
                            if block.type == 'text':
                                yield f"data: {json.dumps({'type': 'text_start'})}\n\n"
                            elif block.type == 'tool_use':
                                has_tool_use = True
                                yield f"data: {json.dumps({'type': 'tool_start', 'tool_name': block.name, 'tool_id': block.id})}\n\n"

                        elif event.type == 'content_block_delta':
                            delta = event.delta
                            if hasattr(delta, 'text'):
                                yield f"data: {json.dumps({'type': 'text_delta', 'text': delta.text})}\n\n"
                            elif hasattr(delta, 'partial_json'):
                                pass  # Tool input building — skip

                        elif event.type == 'content_block_stop':
                            pass

                        elif event.type == 'message_stop':
                            pass

                    # Get the final message
                    response = stream.get_final_message()
                    full_content_blocks = response.content

                    # Check if there are tool uses
                    tool_uses = [b for b in full_content_blocks if b.type == 'tool_use']

                    if not tool_uses:
                        # No tool calls — we're done
                        yield f"data: {json.dumps({'type': 'done'})}\n\n"
                        return

                    # Execute tools and continue the loop
                    # Add assistant message to history
                    messages.append({
                        "role": "assistant",
                        "content": [block_to_dict(b) for b in full_content_blocks]
                    })

                    # Execute each tool and build results
                    tool_results = []
                    for tool_use in tool_uses:
                        result = execute_tool(tool_use.name, tool_use.input, BASE_DIR)
                        yield f"data: {json.dumps({'type': 'tool_result', 'tool_name': tool_use.name, 'result_preview': str(result)[:200]})}\n\n"
                        tool_results.append({
                            "type": "tool_result",
                            "tool_use_id": tool_use.id,
                            "content": json.dumps(result) if isinstance(result, (dict, list)) else str(result)
                        })

                    # Add tool results to messages
                    messages.append({
                        "role": "user",
                        "content": tool_results
                    })

                    # Signal that we're continuing with tool results
                    yield f"data: {json.dumps({'type': 'text_start'})}\n\n"
                    # Loop continues — Claude will process tool results

            except anthropic.APIError as e:
                yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"
                return

        yield f"data: {json.dumps({'type': 'done'})}\n\n"

    return Response(
        stream_with_context(generate()),
        mimetype='text/event-stream',
        headers={
            'Cache-Control': 'no-cache',
            'X-Accel-Buffering': 'no',
            'Connection': 'keep-alive',
        }
    )


def block_to_dict(block):
    """Convert an Anthropic content block to a serializable dict."""
    if block.type == 'text':
        return {"type": "text", "text": block.text}
    elif block.type == 'tool_use':
        return {"type": "tool_use", "id": block.id, "name": block.name, "input": block.input}
    return {"type": block.type}


# ═══════════════════════════════════════
# CUSTOMERS ENDPOINT
# ═══════════════════════════════════════

import re

def parse_info_md(filepath):
    """Parse a customer INFO.md file into structured data."""
    try:
        text = filepath.read_text(encoding='utf-8')
    except:
        return None

    result = {
        'name': '',
        'address': '',
        'phone': '',
        'notes': '',
        'contacts': [],
        'notionUrl': '',
        'palletType': '',
        'status': 'Active',
    }

    # Name from first heading
    m = re.search(r'^#\s+(.+)', text, re.MULTILINE)
    if m:
        result['name'] = m.group(1).strip()

    # Location
    m = re.search(r'\*\*Location:\*\*\s*(.+)', text)
    if m:
        result['address'] = m.group(1).strip()

    # Pallet type
    m = re.search(r'\*\*Type:\*\*\s*(.+)', text)
    if m:
        result['palletType'] = m.group(1).strip()

    # Notes section
    m = re.search(r'## Notes\s*\n([\s\S]*?)(?=\n##|\n---|\Z)', text)
    if m:
        result['notes'] = m.group(1).strip()

    # Contacts from markdown table
    table_match = re.search(r'## Key Contacts.*?\n\|.*?\n\|[-\s|]+\n([\s\S]*?)(?=\n##|\n\n[^|]|\Z)', text)
    if table_match:
        rows = table_match.group(1).strip().split('\n')
        for row in rows:
            cells = [c.strip() for c in row.split('|')[1:-1]]
            if len(cells) >= 4:
                contact = {
                    'name': cells[0].strip(' —-'),
                    'title': cells[1].strip(' —-'),
                    'email': cells[2].strip(' —-'),
                    'phone': cells[3].strip(' —-'),
                }
                for k in contact:
                    if contact[k] in ('—', '-', '–', ''):
                        contact[k] = ''
                if contact['name']:
                    result['contacts'].append(contact)

    # Fallback: bullet-list contact format (## Contact section with **Name**: etc.)
    if not result['contacts']:
        contact_section = re.search(r'## Contacts?\s*\n([\s\S]*?)(?=\n##|\Z)', text)
        if contact_section:
            block = contact_section.group(1)
            ct = {'name': '', 'title': '', 'email': '', 'phone': ''}
            nm = re.search(r'\*\*Name\*\*:\s*(.+)', block)
            if nm: ct['name'] = nm.group(1).strip()
            tm = re.search(r'\*\*Title\*\*:\s*(.+)', block)
            if tm: ct['title'] = tm.group(1).strip()
            em = re.search(r'\*\*Email\*\*:\s*(.+)', block)
            if em: ct['email'] = em.group(1).strip()
            pm = re.search(r'\*\*Phone\*\*:\s*(.+)', block)
            if pm: ct['phone'] = pm.group(1).strip()
            # Also grab address from contact block if main address is missing
            am = re.search(r'\*\*Address\*\*:\s*(.+)', block)
            if am and not result['address']:
                result['address'] = am.group(1).strip()
            if ct['name']:
                result['contacts'].append(ct)

    return result


@app.route('/api/customers')
def get_customers():
    """Fetch customers from Notion (primary) with INFO.md fallback."""
    source = "notion"

    # Try Notion first
    if os.getenv('NOTION_API_KEY'):
        try:
            from notion_api import fetch_customers
            customers = fetch_customers()
            if customers is not None:
                return jsonify({'customers': customers, 'source': source})
        except Exception as e:
            print(f"⚠ Notion fetch failed, falling back to local files: {e}")

    # Fallback: read from INFO.md files
    source = "local"
    customers_dir = BASE_DIR / 'Customers'
    customers = []

    if customers_dir.exists():
        for folder in sorted(customers_dir.iterdir()):
            if not folder.is_dir():
                continue
            info_file = folder / 'INFO.md'
            if info_file.exists():
                data = parse_info_md(info_file)
                if data:
                    data['id'] = re.sub(r'[^a-z0-9]+', '-', folder.name.lower()).strip('-')
                    data['folder'] = folder.name
                    if not data['name']:
                        data['name'] = folder.name
                    customers.append(data)

    return jsonify({'customers': customers, 'source': source})


@app.route('/api/customers/update', methods=['POST'])
def update_customer_endpoint():
    """Update a customer and/or its contacts in Notion."""
    if not os.getenv('NOTION_API_KEY'):
        return jsonify({'status': 'error', 'message': 'NOTION_API_KEY not configured'}), 400

    try:
        from notion_api import update_customer, update_contact
        payload = request.get_json()
        if not payload:
            return jsonify({'status': 'error', 'message': 'No data provided'}), 400

        results = []

        # Update customer fields
        cust_page_id = payload.get('pageId')
        cust_data = payload.get('customer')
        if cust_page_id and cust_data:
            r = update_customer(cust_page_id, cust_data)
            results.append({'type': 'customer', **r})

        # Update contacts
        contacts = payload.get('contacts', [])
        for ct in contacts:
            ct_page_id = ct.get('pageId')
            ct_data = ct.get('data')
            if ct_page_id and ct_data:
                r = update_contact(ct_page_id, ct_data)
                results.append({'type': 'contact', 'pageId': ct_page_id, **r})

        return jsonify({'status': 'ok', 'results': results})

    except Exception as e:
        print(f"⚠ Customer update failed: {e}")
        return jsonify({'status': 'error', 'message': str(e)}), 500


@app.route('/api/products')
def get_products():
    """Fetch products for a given company name from the Product Rates DB."""
    company = request.args.get('company', '').strip()
    if not company:
        return jsonify({'products': [], 'error': 'No company name provided'}), 400

    if not os.getenv('NOTION_API_KEY'):
        return jsonify({'products': [], 'error': 'NOTION_API_KEY not configured'}), 400

    try:
        from notion_api import fetch_products_by_company
        products = fetch_products_by_company(company)
        return jsonify({'products': products, 'company': company})
    except Exception as e:
        print(f"⚠ Products fetch failed: {e}")
        return jsonify({'products': [], 'error': str(e)}), 500


@app.route('/api/schedule')
def get_schedule():
    """Fetch today's delivery schedule from Notion."""
    date = request.args.get('date', '').strip()

    if not os.getenv('NOTION_API_KEY'):
        return jsonify({'deliveries': [], 'error': 'NOTION_API_KEY not configured'}), 400

    try:
        from notion_api import fetch_deliveries_today
        result = fetch_deliveries_today(date or None)
        return jsonify({
            'deliveries': result.get('deliveries', []),
            'date': date or 'today',
        })
    except Exception as e:
        print(f"⚠ Schedule fetch failed: {e}")
        return jsonify({'deliveries': [], 'error': str(e)}), 500


@app.route('/api/customers/refresh')
def refresh_customers():
    """Force refresh the Notion customer cache."""
    if os.getenv('NOTION_API_KEY'):
        try:
            from notion_api import clear_cache, fetch_customers
            clear_cache()
            customers = fetch_customers()
            if customers is not None:
                return jsonify({'status': 'ok', 'count': len(customers), 'source': 'notion'})
        except Exception as e:
            return jsonify({'status': 'error', 'message': str(e)}), 500
    return jsonify({'status': 'error', 'message': 'NOTION_API_KEY not configured'}), 400


# ═══════════════════════════════════════
# MAIN
# ═══════════════════════════════════════

if __name__ == '__main__':
    if not API_KEY:
        print("\n⚠️  ANTHROPIC_API_KEY not found in .env")
        print(f"   Create {BASE_DIR / '.env'} with:")
        print("   ANTHROPIC_API_KEY=sk-ant-your-key-here\n")
    else:
        print(f"\n✓ API key configured")

    print(f"✓ Serving from {BASE_DIR}")
    print(f"✓ Dashboard: http://localhost:5050\n")

    # Suppress repeated GET request logs — only show warnings+errors
    import logging
    log = logging.getLogger('werkzeug')
    log.setLevel(logging.WARNING)

    app.run(host='0.0.0.0', port=5050, debug=False)
