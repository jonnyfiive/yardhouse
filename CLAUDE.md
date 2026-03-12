# Yardhouse — Project Documentation

## Owner
Jonathan Crespo, Senior Manager at JUST NATION. Pallet sales & recycling in Edison, NJ.

## Company
**JUST NATION** — 271 Meadow Rd, Edison, NJ 08817
Phones: (732) 985-7300 | (973) 609-6520
Email: jonathan@justnationllc.com | Website: www.justnationusa.com

## Preferences
- New deliveries: default status = **Scheduled**, leave type blank (not "Delivery", not "Pending")
- DeftFulfillment is ONE WORD (not "Deft Fulfillment")
- Direct, no-nonsense communication style
- macOS Tahoe design language throughout

## Folder Structure
```
Yardhouse/
  src/                    — React UI components, hooks, types
  electron/               — Electron main process
  dashboard_server.py     — Flask API backend (port 5050)
  email_poller.py         — Email integration
  qbo_integration.py      — QuickBooks integration
  release/                — Built .app and .dmg
  screenshots/            — App screenshots and design iterations
  legacy/                 — Old HTML dashboard + Flask chat server + static assets
    server/               — Original Flask chat server (app.py, tools.py, etc.)
    static/               — Original chat.js
    start.command          — Original one-click launcher
    Daily Briefing.html   — Original HTML dashboard
  mockup-mobile.jsx       — Mobile app mockup (React component)
  mockup-mobile.html      — Standalone HTML version of mobile mockup
  Company Logo/           — Original Just Nation logos
  Figma Assets/           — Design assets (Liquid Glass Material Editor, etc.)
  email_poll_state.json   — Email polling state
  CLAUDE.md               — This file
```

## Notion Delivery Schedule — How to Pull Live Data

**Database:** Delivery Schedule
**URL:** `https://www.notion.so/fa9ae860cff447a38344a84e4c73f81f?v=309b735b971480a69872000cb1e50a56`
**Data Source:** `collection://68998201-f7ec-424b-b437-7dfb6b2b4b69`
**View:** "Current" — filters `date is after yesterday`, sorted by Status ascending

### CRITICAL: `notion-search` is BROKEN for recent data
The Notion MCP `notion-search` tool uses a semantic search index that lags **days to weeks** behind. It will NOT find recently created delivery entries. Do NOT rely on it for the daily briefing.

### RELIABLE METHOD: Chrome JavaScript extraction
1. Open Chrome tab to the Notion database "Current" view URL above
2. Wait 3-4 seconds for page load
3. Run this JavaScript via `javascript_tool`:

```javascript
const rows = document.querySelectorAll('.notion-collection-item');
const result = [];
rows.forEach(row => {
  const c = row.querySelectorAll('.notion-table-view-cell');
  if (c.length >= 6) {
    result.push([
      c[0]?.textContent?.trim(),  // Date
      c[1]?.textContent?.trim(),  // Customer
      c[2]?.textContent?.trim(),  // Notes
      c[3]?.textContent?.trim(),  // Driver
      c[4]?.textContent?.trim(),  // Trip #
      c[5]?.textContent?.trim(),  // Status
      c[6]?.textContent?.trim()   // Type
    ].join('|'));
  }
});
result.join('\n');
```

### Schema Reference
| Column | Type | Values |
|--------|------|--------|
| Date | date | ISO date |
| Customer | relation | Linked to Customers DB |
| Notes | text | Free text |
| Driver | select | Adalid Torres, Tito Estrada, Nick De Oleviera |
| Trip # | number | Route number |
| Status | status | Pending, Scheduled, Loaded, On Route, Completed, Cancelled |
| Type | select | Delivery, Pick Up, Drop Trailer, Pick Up Trailer, CPU |

## Notion Employee Production Database

**Database:** Employee Production
**URL:** `https://www.notion.so/6bc75026325d4d5097f6a8b79cc1795a`
**Data Source:** `collection://503c1bba-0e76-4a20-a70b-6108970c5db1`
**Purpose:** Synced production data across all Yardhouse app installations. Each row = one employee + one week.

### Schema
| Column | Type | Notes |
|--------|------|-------|
| Employee | title | Employee ID (e.g., "angie-martinez") |
| Week | date | Week start date (Thursday) |
| Mon–Sat | text | JSON-encoded day values: "true"/"false" (salaried), `[{"qty":8,"type":"48x40"}]` (piece), `{"in":"06:15","out":"15:45"}` (driver) |
| Hrs Worked | number | Driver hours worked |
| Hrs Payroll | number | Default payroll hours |
| Deductions | number | Weekly deductions |
| Debit | number | Weekly debit |
| Total | number | Calculated total pay |
| Total Override | number | Manual override (null = auto-calculate) |
| Notes | text | Free text notes |

### How Sync Works
- Static config (employees list, piece rates, bonus rates, employee defaults) stays in local `production-data.json`
- Weekly entries are read/written from Notion via the Flask API
- On GET: fetches week entries from Notion, merges with local static config
- On POST: saves static config locally, upserts weekly entries to Notion (creates new pages or updates existing ones by Employee+Week match)
- Local JSON also keeps a copy of weeks as offline fallback

## Dashboard Server (Flask on port 5050)

**File:** `dashboard_server.py`
**Purpose:** Serves customer, product, and delivery data from Notion to the Daily Briefing dashboard
**Dependencies:** `pip install flask flask-cors requests`

### Startup Command
```bash
cd Yardhouse
export NOTION_TOKEN=your_notion_integration_token
python3 dashboard_server.py
```

### Endpoints
| Route | Method | Description |
|-------|--------|-------------|
| `/api/customers` | GET | All companies + contacts from Notion |
| `/api/products?company=NAME` | GET | Products for a specific company |
| `/api/deliveries?days=7` | GET | Upcoming deliveries |
| `/api/ar-by-customer` | GET | All open QBO invoices aggregated by customer name |
| `/api/cache/clear` | POST | Clear in-memory cache |
| `/health` | GET | Server status + config check |

### Notion Databases Used
| Database | Database Page ID | Collection ID (MCP internal) |
|----------|-----------------|------------------------------|
| Companies | `fadc95374fe64eb3be43d38b3950dc66` | `f949d09f-6414-47db-99d5-785237916709` |
| Contacts | `30ab735b971480c08a41f31ac6f086ef` | `30ab735b-9714-8000-b1df-000b126debae` |
| Products & Services | `10890dd37a914fef9be6265af09aa50a` | `7ea6a6fc-896d-4dd8-92d9-c67ea84579e6` |
| Delivery Schedule | `fa9ae860cff447a38344a84e4c73f81f` | `68998201-f7ec-424b-b437-7dfb6b2b4b69` |
| Employee Production | `6bc75026325d4d5097f6a8b79cc1795a` | `503c1bba-0e76-4a20-a70b-6108970c5db1` |

> **Note:** The REST API (`dashboard_server.py`) uses Database Page IDs. The Notion MCP connector uses Collection IDs (`collection://...`). These are different UUIDs.

### Cache
In-memory, 120s TTL. Hit `/api/cache/clear` to force refresh.

### Flask Debugger PIN
`469-791-346`

## Yardhouse — Desktop App

**Name:** Yardhouse
**Stack:** Electron 33 + React 18 + Vite 6 + TypeScript
**Built app:** `release/mac-arm64/Yardhouse.app`
**App ID:** `com.justnation.yardhouse`
**Backend:** Flask API on `localhost:5050` (same `dashboard_server.py`)

### Dev Commands
```bash
cd Yardhouse
npm run electron:dev    # Dev mode (Vite 5173 + Electron)
npm run electron:dmg    # Build production DMG
npm run dev             # Vite only (no Electron shell)
```

### Architecture
- **Electron shell** (`electron/main.ts`) — frameless macOS window with `titleBarStyle: hiddenInset`, traffic lights at (16, 18), 1600x1000 default
- **Vite + React** (`src/`) — all UI, compiles to `dist/`
- **Flask API** (`dashboard_server.py` on port 5050) — Notion data, QBO A/R, deliveries, briefing, chat, production
- **Static fallback** — `briefing-data.json` for offline/server-down

### Components (13 files, ~2,272 lines)
| Component | Purpose |
|-----------|---------|
| `Header.tsx` | Tahoe-style titlebar with logo, date, liquid glass buttons |
| `LiquidGlassButton.tsx` | macOS Tahoe liquid glass pill button (pure CSS) |
| `TickerBar.tsx` | Scrolling A/R ticker (QBO data) |
| `DeliveriesTable.tsx` | Today's deliveries with inline status editing |
| `DeliveryReceiptPanel.tsx` | Full-screen delivery receipt/BOL generator |
| `CustomerPanel.tsx` | Slide-out customer directory with products/pricing |
| `ProductionPanel.tsx` | Full-screen daily production tracker |
| `ProductionCell.tsx` | Individual cell editing for production grid |
| `NextMoves.tsx` | Today's action items |
| `WaitingOn.tsx` | Sidebar — prospects awaiting response |
| `Overdue.tsx` | Sidebar — overdue follow-ups |
| `TopicPanel.tsx` | Slide-out detail panel for topics |
| `ChatPanel.tsx` | AI chat assistant (sends to `/api/chat`) |

### Hooks
| Hook | Purpose |
|------|---------|
| `useApi.ts` | All Flask API calls (deliveries, customers, AR, briefing, chat, production) |
| `useTheme.ts` | Dark/light mode toggle |
| `useProduction.ts` | Production data management |

### Design System
- **macOS Tahoe** inspired — based on Apple macOS 26 UI Kit (Figma Community)
- CSS tokens in `src/index.css` (3,035 lines) with full light/dark mode
- Liquid glass buttons: `backdrop-filter: blur()`, semi-transparent fills, specular highlights
- System colors: `--system-blue`, `--system-orange`, `--system-red`, `--system-green`
- App accent: `--accent: #FF5000` (Just Nation orange)

### Keyboard Shortcuts
| Key | Action |
|-----|--------|
| `T` | Toggle dark/light theme |
| `Cmd+J` | Toggle Customers panel |
| `Cmd+D` | Toggle Delivery Receipt panel |
| `Cmd+P` | Toggle Production panel |
| `Esc` | Close any open panel |

### API Endpoints (useApi.ts → localhost:5050)
| Route | Method | Description |
|-------|--------|-------------|
| `/api/deliveries?days=0` | GET | Today's deliveries |
| `/api/deliveries/:id` | PATCH | Update a delivery field |
| `/api/deliveries` | POST | Create new delivery |
| `/api/customers-with-products` | GET | All companies + products |
| `/api/ar-summary` | GET | QBO A/R totals |
| `/api/ar-top-overdue?limit=3` | GET | Top overdue invoices |
| `/api/briefing` | GET | Waiting on, overdue, next moves |
| `/api/briefing/poll` | POST | Trigger email poll |
| `/api/chat` | POST | AI chat (messages array) |
| `/api/production` | GET/POST | Daily production data |
| `/api/ar-by-customer` | GET | All open QBO invoices aggregated by customer |
| `/api/cache/clear` | POST | Clear server cache |
| `/qbo/status` | GET | QuickBooks Online connection status |

### Legacy HTML Dashboard
The original `Daily Briefing.html` is in `legacy/` and is **no longer the primary app**. Yardhouse (Electron + React) is the active version.

### UI Design Notes
- **Aetherfield SaaS template** (Figma Sites) was explored for design inspiration but the hero section / stat cards / rounded card redesign was **rejected** by Jonathan — reverted completely. Don't re-attempt that style.
- **Figma Sites/Community files** can't be accessed via the Figma API for variables — they're in linked libraries.

### Figma Assets
- `Figma Assets/Liquid Glass Material Editor/` — Full React app with WebGL shader components (unzipped from Figma Community download). Key files: `src/components/LiquidGlassShader.tsx` (775-line WebGL fragment/vertex shader with SDF shapes, refraction, blur, chromatic aberration), `src/components/LiquidGlassEditor.tsx` (editor UI), `src/styles/globals.css` (CSS variables/theme tokens). Used as reference for the liquid glass buttons — the actual WebGL shader is too heavy for buttons so it was adapted to pure CSS.

## Yardhouse Mobile App — Mockup

**Files:** `mockup-mobile.jsx` (React component) + `mockup-mobile.html` (standalone HTML)
**Design:** "Brutal × Nothing" aesthetic — Nothing Phone-inspired with dot-matrix, monospace, stark contrast, mechanical precision
**Stack:** React (CDN/JSX), inline styles, no build system yet — prototype/mockup stage
**Fonts:** Space Grotesk (headings) + JetBrains Mono (data/mono)
**Accent Colors:** Lavender `#CFB8FF`, Cream `#FEFFDD`, Orange `#FF5000`, Green `#B8FFD0`, Red `#FFB8B8`

### Tabs (3)
| Tab | Name | Content |
|-----|------|---------|
| home | DISPATCH | Delivery board with KPI pills (Total/Active/Done), progress bar, compact delivery rows with status dot cycling, expandable detail panel with Call/Edit/Map buttons |
| actions | ACTIONS | Segmented control (Next/Waiting/Overdue) showing next moves with tags (URG/CALL/OPS/INV), waiting-on items with day counters, overdue follow-ups |
| accounts | ACCOUNTS | Searchable customer directory with product/price columns, expandable detail with Call/Email/Order buttons |

### Components
| Component | Purpose |
|-----------|---------|
| `PhoneFrame` | 393×852 phone shell with dynamic island notch |
| `HeaderBar` | Logo + "YARDHOUSE" + date |
| `TabBar` | Bottom nav — 3 pill-style tabs |
| `DeliveryRow` | Compact row: status dot, customer, type badge, driver, trip dots |
| `StatusDot` | Color-coded dot per delivery status |
| `HomeTab` | Dispatch board with KPIs + delivery list + detail panel |
| `ActionsTab` | Next moves / waiting / overdue sections |
| `AccountsTab` | Customer directory with search + expandable cards |
| `JNLogo` | SVG 5-bar diamond logo mark |

### Current State (as of 2026-03-09)
- **Connected to live Flask API** on localhost:5050 (all tabs pull real data)
- All inline styles (no CSS file)
- Phone frame wrapper for desktop preview — served via Python HTTP server on port 8888
- Status dot tap cycles through statuses
- Row tap expands detail panel
- **File location:** `Yardhouse Mobile App/index.html` (single-file PWA, ~2200 lines)

### Live Data Integration
| Tab | Data Source | Endpoint |
|-----|-----------|----------|
| DISPATCH | Deliveries from Notion | `/api/deliveries?days=0` |
| ACTIONS > Today | Email briefing items | `/api/briefing` |
| ACTIONS > Tasks | Next moves from briefing | `/api/briefing` |
| ACTIONS > Schedule | Upcoming deliveries | `/api/deliveries?days=7` |
| ACCOUNTS | Companies + contacts from Notion | `/api/customers-with-products` |
| ACCOUNTS (balances) | All open QBO invoices | `/api/ar-by-customer` |

### DataStore Pattern
Global reactive store (`window.DataStore`) with listener-based re-rendering:
- `DataStore.customers` — array of companies with contacts, products, balance
- `DataStore.deliveries` — today's deliveries
- `DataStore.briefing` — email briefing (next moves, waiting on, overdue)
- `DataStore.arSummary` — AR totals from QBO
- `DataStore._notify()` — triggers all registered listeners to re-render
- `DataStore.init()` — fetches deliveries, customers → AR (chained), briefing on load

### AR Balance Name Matching
QBO customer names don't always match Notion names. 3-tier matching:
1. **Exact** — lowercase trim match
2. **Partial/contains** — either name contains the other (e.g., "bettaway" ↔ "bettaway pallet systems, inc.")
3. **First-word** — first word match if ≥3 chars (e.g., "deftfulfillment" ↔ "deftfulfillment llc")

Result: 39 of 136 Notion customers matched to QBO balances ($470K total across 52 QBO customers)

### Next Steps (when resuming mobile work)
- Add new features / tabs as needed
- Potentially convert to React Native / Expo for actual mobile deployment
- Consider adding service worker for offline support
- LaunchAgent plist (`com.justnation.yardhouse-server.plist`) still has old working directory — update to `~/Claude/Work/Projects/Yardhouse`

## Session Log — March 12, 2026

### MS Graph Calendar + Tasks Integration (dashboard_server.py)
**Problem:** Mobile app's Schedule and Tasks tabs were empty; calendar event edits didn't persist.

**Root causes & fixes:**
1. **Scope mismatch** — Pallet-sales MCP server's token cache only had Mail scopes (`Mail.Read`, `Mail.ReadWrite`, `Mail.Send`). Flask server needs `Tasks.ReadWrite` + `Calendars.ReadWrite` too. Fixed by adding all scopes to `MS_GRAPH_SCOPES` list.
2. **Calendar PATCH 403** — Changed scope from `Calendars.Read` to `Calendars.ReadWrite`.
3. **Calendar PATCH logic** — Rewrote to fetch existing event date as fallback anchor when `startDate` not sent. Handles `startTime` and `endTime` independently.
4. **Timezone bug in GET /api/calendar** — Was returning UTC times. Added `Prefer: outlook.timezone="Eastern Standard Time"` header so times display correctly.
5. **Token cache persistence** — Set default `_msal_cache_path` even when no file exists, so first-time auth saves properly.
6. **Create/update task field mismatches** — Flask now accepts both `title`/`text` and `status`/`done` fields from the mobile client.
7. **Auth resilience** — Added `_invalidate_graph_token()` and `_graph_request()` helper with automatic 401 retry. Added `/api/ms-auth` POST endpoint for triggering device code flow from browser, `/api/ms-auth/complete` to finish it, and `/api/ms-auth/status` to check state.

**IMPORTANT for next session:** The MSAL token cache from the pallet-sales MCP server (`.token-cache.json`) may only have Mail scopes. If Calendar/Tasks return 401, the Flask server needs its own device code auth flow. Hit `POST /api/ms-auth` to start it, complete the device code at microsoft.com/devicelogin, then `POST /api/ms-auth/complete`.

### Mobile App (yardhouse-mobile) — Time Picker
- **Custom iOS-style scroll picker** (`src/components/TimePicker.tsx`) — three FlatList wheels (Hour 1-12, Minute 00/15/30/45, AM/PM) with `snapToInterval={44}` for snapping behavior.
- `parse24()` / `to24()` convert between 12h and 24h formats.
- No dark overlay background (user explicitly removed it).
- Times displayed in 12-hour format on the TouchableOpacity fields.
- `pickerTarget` state routes confirmed time to correct field (editStart/editEnd/newStart/newEnd).
- Error banners ("CALENDAR OFFLINE" / "TASKS OFFLINE") show when Graph API auth fails.

### Desktop App — Production Tab Fix
**Problem:** Week 3/12-3/18 showed only the header row, no employee rows.

**Root cause:** Backend returned the week from Notion with `{entries: {}, dates: []}` (no data entered yet). Frontend's `ensureWeek()` checked `if (prodData.weeks[weekKey]) return prodData` — since the week key existed (even with empty entries), it skipped populating defaults.

**Fix in `src/hooks/useProduction.ts`:**
- Changed check: now also verifies `Object.keys(existingWeek.entries).length > 0`
- If week exists but entries are empty, populates default entries for all employees
- Merges any existing Notion entries with defaults for missing employees
- Preserves existing dates array if available

**App rebuilt:** `npm run electron:build` → `release/mac-arm64/Yardhouse.app`

### Known Issues / Watch Items
- Flask debug reloader spawns two processes — can cause duplicate device code auth prompts. The child process (WERKZEUG_RUN_MAIN=true) is the one that serves requests.
- When testing from the Cowork sandbox VM, `curl http://localhost:5050` hits the VM's own localhost, NOT the Mac's server. Use `osascript do shell script "curl ..."` to hit the Mac's server.
- The packaged Yardhouse.app at `release/mac-arm64/` has its own embedded Flask server at `~/Library/Application Support/yardhouse/server/dashboard_server.py`. Changes to the project's `dashboard_server.py` need either: (a) rebuild the .app, or (b) the embedded copy is a symlink/same file.
