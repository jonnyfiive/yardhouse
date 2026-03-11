"""
Tool definitions and handlers for the chat Claude.
Each tool maps to a function that reads/writes local files.
"""
import os
import json
import re
from pathlib import Path
from datetime import datetime

# ═══════════════════════════════════════
# TOOL DEFINITIONS (Anthropic format)
# ═══════════════════════════════════════

TOOL_DEFINITIONS = [
    {
        "name": "get_crm_data",
        "description": "Look up a customer, prospect, or vendor by name. Returns their INFO.md file with contacts, pricing, history, and notes. Use fuzzy matching — 'Americold' matches 'Americold' folder.",
        "input_schema": {
            "type": "object",
            "properties": {
                "entity_type": {
                    "type": "string",
                    "enum": ["customer", "prospect", "vendor", "any"],
                    "description": "Type of entity. Use 'any' to search all folders."
                },
                "name": {
                    "type": "string",
                    "description": "Company name or partial match (e.g., 'Americold', 'Rising', 'Parke')"
                }
            },
            "required": ["name"]
        }
    },
    {
        "name": "read_current_briefing",
        "description": "Get the current Daily Briefing data — today's actions, priority item, waiting-on list, overdue items, and next moves.",
        "input_schema": {
            "type": "object",
            "properties": {}
        }
    },
    {
        "name": "read_tasks",
        "description": "Read the TASKS.md file — active tasks, waiting-on items, and completed items.",
        "input_schema": {
            "type": "object",
            "properties": {}
        }
    },
    {
        "name": "update_briefing",
        "description": "Update the Daily Briefing data. Can add/modify actions, change priority, update waiting-on list, etc. Provide a partial JSON object that will be merged into briefing-data.json.",
        "input_schema": {
            "type": "object",
            "properties": {
                "updates": {
                    "type": "object",
                    "description": "Partial JSON to merge into briefing-data.json. Keys: priority, todaysActions, waitingOn, overdue, nextMoves, topics, etc."
                }
            },
            "required": ["updates"]
        }
    },
    {
        "name": "update_tasks",
        "description": "Add, complete, or modify a task in TASKS.md.",
        "input_schema": {
            "type": "object",
            "properties": {
                "action": {
                    "type": "string",
                    "enum": ["add", "complete", "remove"],
                    "description": "What to do with the task"
                },
                "section": {
                    "type": "string",
                    "enum": ["Active", "Waiting On", "Construction Project", "Someday"],
                    "description": "Which section of TASKS.md"
                },
                "task_text": {
                    "type": "string",
                    "description": "The task text (for add: full text; for complete/remove: substring match)"
                }
            },
            "required": ["action", "task_text"]
        }
    },
    {
        "name": "draft_email",
        "description": "Compose an email draft. This will be shown to Jonathan in the chat for review — he can edit, copy, or send it. Never send without showing the draft first.",
        "input_schema": {
            "type": "object",
            "properties": {
                "to": {"type": "string", "description": "Recipient email(s), comma-separated"},
                "subject": {"type": "string", "description": "Email subject line"},
                "body": {"type": "string", "description": "Email body text (plain text, not HTML)"}
            },
            "required": ["to", "subject", "body"]
        }
    },
    {
        "name": "search_crm",
        "description": "Full-text search across the CRM database (pallet_crm.json) and all INFO.md files. Returns matching companies with key details.",
        "input_schema": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "Search term — company name, contact name, city, product, etc."
                }
            },
            "required": ["query"]
        }
    },
    {
        "name": "update_customer_info",
        "description": "Append a note or update to a customer/prospect/vendor's INFO.md file. Use for logging interactions, updating status, adding timeline entries.",
        "input_schema": {
            "type": "object",
            "properties": {
                "entity_type": {
                    "type": "string",
                    "enum": ["customer", "prospect", "vendor"],
                },
                "name": {
                    "type": "string",
                    "description": "Company name (must match folder name)"
                },
                "note": {
                    "type": "string",
                    "description": "Text to append to the INFO.md file (will be added under Timeline or Notes)"
                }
            },
            "required": ["name", "note"]
        }
    }
]


# ═══════════════════════════════════════
# TOOL EXECUTION
# ═══════════════════════════════════════

def execute_tool(tool_name: str, tool_input: dict, base_dir: Path) -> dict:
    """Route tool call to the right handler."""
    handlers = {
        "get_crm_data": handle_get_crm_data,
        "read_current_briefing": handle_read_briefing,
        "read_tasks": handle_read_tasks,
        "update_briefing": handle_update_briefing,
        "update_tasks": handle_update_tasks,
        "draft_email": handle_draft_email,
        "search_crm": handle_search_crm,
        "update_customer_info": handle_update_customer_info,
    }
    handler = handlers.get(tool_name)
    if not handler:
        return {"error": f"Unknown tool: {tool_name}"}
    try:
        return handler(tool_input, base_dir)
    except Exception as e:
        return {"error": str(e)}


# ═══════════════════════════════════════
# HANDLERS
# ═══════════════════════════════════════

def handle_get_crm_data(input: dict, base_dir: Path) -> dict:
    name = input.get("name", "")
    entity_type = input.get("entity_type", "any")

    folders_to_search = []
    if entity_type in ("customer", "any"):
        folders_to_search.append(("Customers", "customer"))
    if entity_type in ("prospect", "any"):
        folders_to_search.append(("Prospects", "prospect"))
    if entity_type in ("vendor", "any"):
        folders_to_search.append(("Vendors", "vendor"))

    results = []
    for folder_name, etype in folders_to_search:
        folder = base_dir / folder_name
        if not folder.exists():
            continue
        for sub in sorted(folder.iterdir()):
            if sub.is_dir() and name.lower() in sub.name.lower():
                info_file = sub / "INFO.md"
                content = info_file.read_text() if info_file.exists() else f"(No INFO.md found in {sub.name})"
                results.append({
                    "type": etype,
                    "name": sub.name,
                    "info": content
                })

    if not results:
        return {"status": "not_found", "message": f"No match for '{name}' in {entity_type} folders"}
    return {"status": "found", "results": results}


def handle_read_briefing(input: dict, base_dir: Path) -> dict:
    bf = base_dir / "briefing-data.json"
    if not bf.exists():
        return {"error": "briefing-data.json not found"}
    data = json.loads(bf.read_text())
    # Return a summary to keep token count reasonable
    summary = {
        "date": data.get("date"),
        "dateLabel": data.get("dateLabel"),
        "priority": data.get("priority"),
        "todaysActions": [{"label": a.get("label"), "tag": a.get("tag", {}).get("text")} for a in data.get("todaysActions", [])],
        "waitingOn": [{"contact": w.get("contact"), "subject": w.get("subject")} for w in data.get("waitingOn", [])],
        "overdue": [{"contact": o.get("contact"), "opportunity": o.get("opportunity")} for o in data.get("overdue", [])],
        "nextMoves_count": len(data.get("nextMoves", [])),
    }
    return summary


def handle_read_tasks(input: dict, base_dir: Path) -> dict:
    tf = base_dir / "TASKS.md"
    if not tf.exists():
        return {"error": "TASKS.md not found"}
    return {"content": tf.read_text()}


def handle_update_briefing(input: dict, base_dir: Path) -> dict:
    updates = input.get("updates", {})
    bf = base_dir / "briefing-data.json"
    if not bf.exists():
        return {"error": "briefing-data.json not found"}

    data = json.loads(bf.read_text())
    # Deep merge updates
    deep_merge(data, updates)
    data["generated"] = datetime.utcnow().isoformat() + "Z"

    bf.write_text(json.dumps(data, indent=2))
    # Also regenerate briefing-data.js
    js_file = base_dir / "briefing-data.js"
    js_file.write_text(f"window.BRIEFING_DATA = {json.dumps(data)};")

    return {"status": "updated", "message": "Briefing data updated. Dashboard will refresh automatically."}


def handle_update_tasks(input: dict, base_dir: Path) -> dict:
    action = input.get("action", "add")
    task_text = input.get("task_text", "")
    section = input.get("section", "Active")
    tf = base_dir / "TASKS.md"
    if not tf.exists():
        return {"error": "TASKS.md not found"}

    content = tf.read_text()

    if action == "add":
        # Find the section and add the task
        section_header = f"## {section}"
        if section_header in content:
            # Insert after the header line
            idx = content.index(section_header) + len(section_header)
            next_newline = content.index('\n', idx)
            insert_point = next_newline + 1
            new_line = f"\n- [ ] **{task_text}**"
            content = content[:insert_point] + new_line + content[insert_point:]
        else:
            content += f"\n\n## {section}\n\n- [ ] **{task_text}**"

    elif action == "complete":
        # Find a matching task and mark it done
        lines = content.split('\n')
        found = False
        for i, line in enumerate(lines):
            if task_text.lower() in line.lower() and '- [ ]' in line:
                lines[i] = line.replace('- [ ]', '- [x]')
                found = True
                break
        if not found:
            return {"status": "not_found", "message": f"No active task matching '{task_text}'"}
        content = '\n'.join(lines)

    elif action == "remove":
        lines = content.split('\n')
        new_lines = [l for l in lines if task_text.lower() not in l.lower()]
        if len(new_lines) == len(lines):
            return {"status": "not_found", "message": f"No task matching '{task_text}'"}
        content = '\n'.join(new_lines)

    tf.write_text(content)
    return {"status": "updated", "action": action, "task": task_text}


def handle_draft_email(input: dict, base_dir: Path) -> dict:
    return {
        "type": "email_draft",
        "to": input.get("to", ""),
        "subject": input.get("subject", ""),
        "body": input.get("body", ""),
        "message": "Email draft ready for review. Jonathan can edit, copy, or send from the chat."
    }


def handle_search_crm(input: dict, base_dir: Path) -> dict:
    query = input.get("query", "").lower()
    results = []

    # Search pallet_crm.json
    crm_file = base_dir / "data" / "pallet_crm.json"
    if crm_file.exists():
        try:
            crm_data = json.loads(crm_file.read_text())
            for entry in crm_data:
                entry_str = json.dumps(entry).lower()
                if query in entry_str:
                    results.append({
                        "source": "pallet_crm.json",
                        "company": entry.get("company_name", "Unknown"),
                        "contact": entry.get("contact_name", ""),
                        "email": entry.get("contact_email", ""),
                        "status": entry.get("status", ""),
                        "city": entry.get("city", ""),
                        "state": entry.get("state", ""),
                    })
        except json.JSONDecodeError:
            pass

    # Search INFO.md files
    for folder_name in ["Customers", "Prospects", "Vendors"]:
        folder = base_dir / folder_name
        if not folder.exists():
            continue
        for sub in folder.iterdir():
            if sub.is_dir():
                info_file = sub / "INFO.md"
                if info_file.exists():
                    content = info_file.read_text().lower()
                    if query in content or query in sub.name.lower():
                        results.append({
                            "source": f"{folder_name}/{sub.name}/INFO.md",
                            "company": sub.name,
                            "preview": info_file.read_text()[:300]
                        })

    if not results:
        return {"status": "not_found", "message": f"No results for '{query}'"}
    return {"status": "found", "count": len(results), "results": results[:10]}


def handle_update_customer_info(input: dict, base_dir: Path) -> dict:
    name = input.get("name", "")
    note = input.get("note", "")
    entity_type = input.get("entity_type", "customer")

    folder_map = {"customer": "Customers", "prospect": "Prospects", "vendor": "Vendors"}
    folder = base_dir / folder_map.get(entity_type, "Customers")

    # Find matching subfolder
    target = None
    if folder.exists():
        for sub in folder.iterdir():
            if sub.is_dir() and name.lower() in sub.name.lower():
                target = sub
                break

    if not target:
        return {"error": f"No folder found matching '{name}' in {folder.name}"}

    info_file = target / "INFO.md"
    today = datetime.now().strftime("%b %d, %Y")
    append_text = f"\n- {today}: {note}"

    if info_file.exists():
        content = info_file.read_text()
        # Try to append under Timeline section
        if "## Timeline" in content:
            idx = content.index("## Timeline")
            # Find the next section or end
            next_section = content.find("\n## ", idx + 12)
            if next_section == -1:
                content += append_text
            else:
                content = content[:next_section] + append_text + "\n" + content[next_section:]
        else:
            content += f"\n\n## Timeline{append_text}"
        info_file.write_text(content)
    else:
        info_file.write_text(f"# {target.name}\n\n## Timeline{append_text}\n")

    return {"status": "updated", "file": str(info_file.relative_to(base_dir)), "note": note}


# ═══════════════════════════════════════
# UTILS
# ═══════════════════════════════════════

def deep_merge(base: dict, updates: dict):
    """Recursively merge updates into base dict."""
    for key, value in updates.items():
        if key in base and isinstance(base[key], dict) and isinstance(value, dict):
            deep_merge(base[key], value)
        else:
            base[key] = value
