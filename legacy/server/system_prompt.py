"""
Builds the system prompt for the chat Claude.
Loads CLAUDE.md + current briefing summary + tasks.
"""
import json
from pathlib import Path
from datetime import datetime


def build_system_prompt(base_dir: Path) -> str:
    """Assemble system prompt from local files."""
    parts = []

    # Core identity
    parts.append("""You are an AI sales operations assistant for JUST NATION, a pallet sales and recycling company in Edison, NJ. You're embedded in Jonathan Crespo's Daily Briefing dashboard.

## Your Role
- Help Jonathan manage his day: customers, prospects, vendors, deliveries, tasks
- Draft emails, look up CRM data, update the briefing and task list
- Be direct and no-nonsense — pallet industry style
- Always show email drafts for review before suggesting to send
- Use the tools available to you to read/write data

## Important Rules
- NEVER send emails without Jonathan's explicit approval
- Always show drafts in chat first
- DeftFulfillment is ONE WORD
- Ongweoweh and Pallet Trader are brokers — don't flag as urgent
- Include pricing upfront in outreach drafts
- No email signature on replies — only on cold/first outreach
- When drafting cold outreach, use this signature:
  Jonathan Crespo
  Senior Manager, JUST NATION
  (732) 985-7300 | (973) 609-6520
  www.justnationusa.com
  jonathan@justnationllc.com
  271 Meadow Rd, Edison, NJ 08817
""")

    # Load CLAUDE.md for full business context — read fresh on every call
    claude_md = base_dir / "CLAUDE.md"
    if claude_md.exists():
        content = claude_md.read_text()
        parts.append(f"\n## Business Context (from CLAUDE.md)\n{content}")

    # Current date
    parts.append(f"\n## Current Date\nToday is {datetime.now().strftime('%A, %B %d, %Y')}.")

    # Quick briefing summary
    bf = base_dir / "briefing-data.json"
    if bf.exists():
        try:
            data = json.loads(bf.read_text())
            priority = data.get("priority", "")
            actions = data.get("todaysActions", [])
            parts.append(f"\n## Today's Briefing Summary")
            if priority:
                if isinstance(priority, dict):
                    parts.append(f"**Priority:** {priority.get('headline', 'None')}")
                else:
                    parts.append(f"**Priority:** {priority}")
            parts.append(f"**Actions today:** {len(actions)}")
            for a in actions[:5]:
                if isinstance(a, dict):
                    parts.append(f"  - [{a.get('tag', {}).get('text', '')}] {a.get('label', '')}")
                else:
                    parts.append(f"  - {a}")
            if len(actions) > 5:
                parts.append(f"  ... and {len(actions) - 5} more")
        except (json.JSONDecodeError, KeyError):
            pass

    return "\n".join(parts)
