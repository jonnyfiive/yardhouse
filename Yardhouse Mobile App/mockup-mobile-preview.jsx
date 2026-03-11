import { useState } from "react";

// ============================================================
// BRUTAL × NOTHING DESIGN TOKENS
// ============================================================
// Nothing Phone aesthetic: dot-matrix, monospace, stark contrast,
// minimal color, mechanical precision
const T = {
  bg: "#E8E8E8",
  white: "#FFFFFF",
  black: "#000000",
  lavender: "#CFB8FF",
  cream: "#FEFFDD",
  orange: "#FF5000",
  orangeLight: "#FFE0CC",
  green: "#B8FFD0",
  red: "#FFB8B8",
  border: "2px solid #000",
  borderThin: "1px solid #000",
  radius: 15,
  // Nothing-style fonts — Space Grotesk (geometric/futuristic) + JetBrains Mono (data)
  fontHead: "'Space Grotesk', 'SF Pro Display', sans-serif",
  fontMono: "'JetBrains Mono', 'SF Mono', 'Courier New', monospace",
  fontBody: "'Space Grotesk', sans-serif",
};

// Google Fonts import for Space Grotesk + JetBrains Mono
const FONT_LINK = "https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&family=Space+Grotesk:wght@400;500;600;700&display=swap";

// ============================================================
// MOCK DATA
// ============================================================
const DELIVERIES = [
  { id: 1, customer: "3G Warehouse", type: "DEL", driver: "Adalid", trip: 1, status: "Loaded", notes: "520 Grade A" },
  { id: 2, customer: "21st Century", type: "DEL", driver: "Tito", trip: 1, status: "Scheduled", notes: "480 Grade A" },
  { id: 3, customer: "DeftFulfillment", type: "DEL", driver: "Adalid", trip: 2, status: "Pending", notes: "520 9-Block Dock#14" },
  { id: 4, customer: "Sayweee", type: "CPU", driver: "Nick", trip: 1, status: "Scheduled", notes: "Core pickup ~800" },
  { id: 5, customer: "Yankee Clipper", type: "DEL", driver: "Tito", trip: 2, status: "Pending", notes: "520 Grade B" },
  { id: 6, customer: "Expeditors", type: "DEL", driver: "Nick", trip: 2, status: "Loaded", notes: "520 Grade B" },
  { id: 7, customer: "SalSon", type: "DEL", driver: "Adalid", trip: 3, status: "Pending", notes: "480 Grade B" },
  { id: 8, customer: "UDS", type: "DEL", driver: "Tito", trip: 3, status: "Pending", notes: "520 Blue HD Block" },
  { id: 9, customer: "Bettaway Fair.", type: "CPU", driver: "Nick", trip: 3, status: "Scheduled", notes: "Core repairable" },
  { id: 10, customer: "Americold", type: "DEL", driver: "Adalid", trip: 4, status: "Pending", notes: "PO #4421" },
  { id: 11, customer: "BC USA", type: "DEL", driver: "Tito", trip: 4, status: "Pending", notes: "NEW 48x40, BOL req" },
  { id: 12, customer: "Dr. Praeger's", type: "CPU", driver: "Nick", trip: 4, status: "Scheduled", notes: "Damage pickup" },
  { id: 13, customer: "Peerless Bev.", type: "CPU", driver: "Adalid", trip: 5, status: "Pending", notes: "Recycling trailer" },
];

const NEXT_MOVES = [
  { id: 1, text: "Follow up Ongweoweh — RFQ deadline passed", tag: "URG" },
  { id: 2, text: "Stonework Inc — 300x custom 27x32 skid quote", tag: "URG" },
  { id: 3, text: "Ken Mancuso @ PepsiCo — back from OOO", tag: "CALL" },
  { id: 4, text: "Parke Pallet euro pickup — schedule Monday", tag: "OPS" },
  { id: 5, text: "Water Haven — invoice empties", tag: "INV" },
];

const WAITING_ON = [
  { contact: "Ongweoweh", subject: "Dayton + Lakewood RFQ", days: 9 },
  { contact: "Rising Pharma", subject: "HT pricing approval", days: 7 },
  { contact: "Ferraro Foods", subject: "Volume commitment", days: 6 },
  { contact: "Bristol Myers", subject: "Grade A1/A Summit NJ", days: 6 },
];

const OVERDUE = [
  { contact: "Novolex", subject: "48Forty replacement", days: 14 },
  { contact: "Crate & Barrel", subject: "Cranbury follow-up", days: 53 },
  { contact: "Wayfair", subject: "Cranbury follow-up", days: 53 },
];

const CUSTOMERS = [
  { name: "3G Warehouse", contact: "Juan Ocampo", product: "Grade A", price: "$6.00" },
  { name: "21st Century", contact: "Patrick Tierney", product: "Grade A", price: "$6.00" },
  { name: "DeftFulfillment", contact: "Jenny", product: "9-Block", price: "$5.00" },
  { name: "Sayweee", contact: "Steven Yu", product: "Core", price: "$1.00" },
  { name: "Yankee Clipper", contact: "David Testa", product: "Grade B", price: "$5.00" },
  { name: "Expeditors", contact: "Ralph Perez", product: "Grade B", price: "$4.00" },
  { name: "SalSon", contact: "Anthony B. Jr.", product: "Grade B", price: "$4.00" },
  { name: "UDS", contact: "Carl Ingargiola", product: "HD Block", price: "$8.00" },
  { name: "Bettaway", contact: "Daniel Storey", product: "Tender", price: "—" },
  { name: "Americold", contact: "Vaibhav Venkat", product: "PO", price: "—" },
];

// ============================================================
// JUST NATION LOGO (SVG — 5-bar glossy diamond, simplified)
// ============================================================
function JNLogo({ size = 36, color = "#000" }) {
  // Simplified 5-bar diamond mark
  return (
    <svg width={size} height={size} viewBox="0 0 100 100">
      <g transform="rotate(45, 50, 50)">
        {[0, 1, 2, 3, 4].map(i => {
          const y = 18 + i * 15;
          return (
            <rect
              key={i}
              x="15" y={y} width="70" height="10" rx="5"
              fill={color}
              opacity={0.7 + i * 0.06}
            />
          );
        })}
      </g>
    </svg>
  );
}

// ============================================================
// STATUS DOT
// ============================================================
function StatusDot({ status }) {
  const colors = {
    Pending: "#AAA",
    Scheduled: T.lavender,
    Loaded: T.orange,
    "On Route": "#00C853",
    Completed: "#00C853",
  };
  return (
    <span style={{
      width: 8, height: 8, borderRadius: "50%",
      background: colors[status] || "#AAA",
      border: "1.5px solid #000",
      display: "inline-block", flexShrink: 0,
    }} />
  );
}

// ============================================================
// PHONE FRAME
// ============================================================
function PhoneFrame({ children }) {
  return (
    <div style={{
      width: 393, height: 852, borderRadius: 48,
      border: "6px solid #000", background: T.bg,
      overflow: "hidden", position: "relative",
      boxShadow: "0 25px 80px rgba(0,0,0,0.4), 0 0 0 2px #444",
    }}>
      <link href={FONT_LINK} rel="stylesheet" />
      <style>{`
        .brutal-scroll::-webkit-scrollbar { display: none; }
        .brutal-scroll { scrollbar-width: none; -ms-overflow-style: none; }
      `}</style>
      <div style={{
        position: "absolute", top: 10, left: "50%", transform: "translateX(-50%)",
        width: 126, height: 36, borderRadius: 20, background: "#000", zIndex: 100,
      }} />
      <div style={{ height: "100%", overflow: "hidden", display: "flex", flexDirection: "column" }}>
        {children}
      </div>
    </div>
  );
}

// ============================================================
// HEADER — Logo + title, Nothing minimal
// ============================================================
function HeaderBar() {
  const now = new Date();
  const day = now.toLocaleDateString("en-US", { weekday: "short" }).toUpperCase();
  const date = now.toLocaleDateString("en-US", { month: "short", day: "numeric" }).toUpperCase();
  return (
    <div style={{
      background: T.white, borderBottom: T.border,
      padding: "54px 20px 12px",
      display: "flex", alignItems: "center", justifyContent: "space-between",
      flexShrink: 0,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <JNLogo size={34} color="#000" />
        <span style={{
          fontFamily: T.fontHead, fontWeight: 600, fontSize: 20,
          color: T.black, letterSpacing: -0.5,
        }}>YARDHOUSE</span>
      </div>
      <span style={{
        fontFamily: T.fontMono, fontSize: 11, fontWeight: 500,
        color: T.black, letterSpacing: 1, opacity: 0.6,
      }}>{day} {date}</span>
    </div>
  );
}

// ============================================================
// TAB BAR — Nothing-style minimal icons
// ============================================================
function TabBar({ activeTab, onTabChange }) {
  const tabs = [
    { id: "home", label: "DISPATCH" },
    { id: "actions", label: "ACTIONS" },
    { id: "accounts", label: "ACCOUNTS" },
  ];
  return (
    <div style={{
      display: "flex", justifyContent: "space-around",
      height: 72, paddingBottom: 16, flexShrink: 0,
      background: T.white, borderTop: T.border,
      alignItems: "center",
    }}>
      {tabs.map(t => {
        const active = activeTab === t.id;
        return (
          <button key={t.id} onClick={() => onTabChange(t.id)} style={{
            background: active ? T.black : "none",
            border: active ? "none" : T.border,
            borderRadius: 20, cursor: "pointer",
            padding: "7px 20px",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <span style={{
              fontFamily: T.fontMono, fontSize: 10, fontWeight: 600,
              letterSpacing: 1.5, color: active ? T.white : T.black,
              textTransform: "uppercase", lineHeight: 1,
            }}>{t.label}</span>
          </button>
        );
      })}
    </div>
  );
}

// ============================================================
// COMPACT DELIVERY ROW
// ============================================================
function DeliveryRow({ d, isSelected, onSelect, onStatusTap }) {
  return (
    <div onClick={() => onSelect(isSelected ? null : d.id)} style={{
      display: "flex", alignItems: "center", gap: 8,
      padding: "9px 0",
      borderBottom: "1px solid rgba(0,0,0,0.12)",
      cursor: "pointer",
      background: isSelected ? "rgba(207,184,255,0.2)" : "transparent",
      transition: "background 0.1s",
    }}>
      {/* Status dot */}
      <div onClick={(e) => { e.stopPropagation(); onStatusTap(d.id); }}>
        <StatusDot status={d.status} />
      </div>

      {/* Customer name — fixed width */}
      <span style={{
        fontFamily: T.fontHead, fontSize: 13, fontWeight: 600,
        color: T.black, width: 120, flexShrink: 0,
        whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
      }}>{d.customer}</span>

      {/* Type badge */}
      <span style={{
        fontFamily: T.fontMono, fontSize: 9, fontWeight: 700,
        background: d.type === "CPU" ? T.cream : T.lavender,
        border: T.borderThin, borderRadius: 4,
        padding: "2px 5px", letterSpacing: 0.5, flexShrink: 0,
      }}>{d.type}</span>

      {/* Driver */}
      <span style={{
        fontFamily: T.fontMono, fontSize: 11, fontWeight: 400,
        color: T.black, opacity: 0.5, flex: 1,
        whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
      }}>{d.driver}</span>

      {/* Trip dots */}
      <span style={{
        fontFamily: T.fontMono, fontSize: 12, fontWeight: 400,
        color: T.black, opacity: 0.6, flexShrink: 0,
        letterSpacing: 2,
      }}>{"●".repeat(d.trip)}</span>
    </div>
  );
}

// ============================================================
// HOME TAB — Dispatch board with compact rows
// ============================================================
function HomeTab() {
  const [deliveries, setDeliveries] = useState(DELIVERIES);
  const [selected, setSelected] = useState(null);
  const [editing, setEditing] = useState(null); // holds draft edits for a delivery

  const cycleStatus = (id) => {
    const order = ["Pending", "Scheduled", "Loaded", "On Route", "Completed"];
    setDeliveries(prev => prev.map(d => {
      if (d.id !== id) return d;
      const idx = order.indexOf(d.status);
      return { ...d, status: order[(idx + 1) % order.length] };
    }));
  };

  const isWeekend = [0, 6].includes(new Date().getDay());
  const total = deliveries.length;
  const loaded = deliveries.filter(d => ["Loaded", "On Route"].includes(d.status)).length;
  const done = deliveries.filter(d => d.status === "Completed").length;
  const pending = total - loaded - done;
  const selectedDelivery = deliveries.find(d => d.id === selected);

  const editLabelStyle = {
    fontFamily: T.fontMono, fontSize: 9, fontWeight: 600,
    letterSpacing: 1.2, color: T.black, opacity: 0.5,
    display: "block", marginBottom: 4,
  };
  const editInputStyle = {
    width: "100%", padding: "8px 10px", borderRadius: 8,
    border: T.borderThin, background: T.white, color: T.black,
    fontFamily: T.fontMono, fontSize: 12, fontWeight: 500,
    outline: "none", boxSizing: "border-box", marginBottom: 10,
  };

  return (
    <div className="brutal-scroll" style={{ flex: 1, overflow: "auto", WebkitOverflowScrolling: "touch" }}>
      {/* Section title */}
      <div style={{ padding: "16px 20px 4px" }}>
        <p style={{
          fontFamily: T.fontHead, fontWeight: 600, fontSize: 20,
          color: T.black, letterSpacing: -0.3,
        }}>
          {isWeekend ? "Monday's Dispatch" : "Today's Dispatch"}
        </p>
      </div>

      {/* KPI strip — 3 inline pill badges */}
      <div style={{ display: "flex", gap: 8, padding: "10px 20px 6px" }}>
        {[
          { label: "TOTAL", value: total, bg: T.white },
          { label: "ACTIVE", value: loaded, bg: T.orangeLight },
          { label: "DONE", value: done, bg: T.green },
        ].map(k => (
          <div key={k.label} style={{
            flex: 1, background: k.bg, border: "1.5px solid #000",
            borderRadius: 50, padding: "6px 10px",
            display: "flex", alignItems: "center", justifyContent: "space-between",
          }}>
            <span style={{
              fontFamily: T.fontMono, fontSize: 8, fontWeight: 600,
              letterSpacing: 1.2, color: T.black, opacity: 0.5,
            }}>{k.label}</span>
            <span style={{
              fontFamily: T.fontMono, fontSize: 18, fontWeight: 700, color: T.black,
            }}>{k.value}</span>
          </div>
        ))}
      </div>

      {/* Progress bar */}
      <div style={{ padding: "8px 20px 4px" }}>
        <div style={{ display: "flex", height: 6, borderRadius: 3, overflow: "hidden", border: T.borderThin }}>
          <div style={{ width: `${(done / total) * 100}%`, background: "#00C853", transition: "width 0.3s" }} />
          <div style={{ width: `${(loaded / total) * 100}%`, background: T.orange, transition: "width 0.3s" }} />
          <div style={{ flex: 1, background: "#DDD" }} />
        </div>
      </div>

      {/* Column headers */}
      <div style={{
        display: "flex", alignItems: "center", gap: 8,
        padding: "12px 20px 4px",
      }}>
        <span style={{ width: 8 }} />
        <span style={{
          fontFamily: T.fontMono, fontSize: 9, fontWeight: 600,
          letterSpacing: 1, color: T.black, opacity: 0.35,
          width: 120, flexShrink: 0,
        }}>CUSTOMER</span>
        <span style={{
          fontFamily: T.fontMono, fontSize: 9, fontWeight: 600,
          letterSpacing: 1, color: T.black, opacity: 0.35,
          width: 30, flexShrink: 0,
        }}>TYP</span>
        <span style={{
          fontFamily: T.fontMono, fontSize: 9, fontWeight: 600,
          letterSpacing: 1, color: T.black, opacity: 0.35,
          flex: 1,
        }}>DRIVER</span>
        <span style={{
          fontFamily: T.fontMono, fontSize: 9, fontWeight: 600,
          letterSpacing: 1, color: T.black, opacity: 0.35,
          flexShrink: 0,
        }}>TRIP</span>
      </div>

      {/* Delivery rows */}
      <div style={{ padding: "0 20px" }}>
        {deliveries.map(d => (
          <DeliveryRow
            key={d.id}
            d={d}
            isSelected={selected === d.id}
            onSelect={setSelected}
            onStatusTap={cycleStatus}
          />
        ))}
      </div>

      {/* Expanded detail panel — slides up from bottom of list */}
      {selectedDelivery && !editing && (
        <div style={{
          margin: "0 20px 16px", padding: "12px 16px",
          background: T.lavender, border: T.border, borderRadius: T.radius,
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{
              fontFamily: T.fontHead, fontSize: 15, fontWeight: 700, color: T.black,
            }}>{selectedDelivery.customer}</span>
            <span style={{
              fontFamily: T.fontMono, fontSize: 10, fontWeight: 600,
              background: T.white, border: T.borderThin, borderRadius: 4,
              padding: "2px 8px", letterSpacing: 0.5,
            }}>{selectedDelivery.status.toUpperCase()}</span>
          </div>
          <p style={{
            fontFamily: T.fontMono, fontSize: 12, fontWeight: 400,
            color: T.black, opacity: 0.7, marginTop: 6,
          }}>{selectedDelivery.notes}</p>
          <p style={{
            fontFamily: T.fontMono, fontSize: 11, fontWeight: 400,
            color: T.black, opacity: 0.5, marginTop: 4,
          }}>{selectedDelivery.driver} · Trip {selectedDelivery.trip} · {selectedDelivery.type === "CPU" ? "Customer Pick Up" : "Delivery"}</p>
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <button onClick={() => setEditing({ ...selectedDelivery })} style={{
              flex: 1, padding: "9px", borderRadius: 10, border: T.border,
              background: T.orange, color: "#fff",
              fontFamily: T.fontMono, fontSize: 11, fontWeight: 700,
              letterSpacing: 1, cursor: "pointer",
            }}>EDIT</button>
            <button style={{
              flex: 1, padding: "9px", borderRadius: 10, border: T.border,
              background: T.white, color: T.black,
              fontFamily: T.fontMono, fontSize: 11, fontWeight: 700,
              letterSpacing: 1, cursor: "pointer",
            }}>RECEIPT</button>
            <button style={{
              flex: 1, padding: "9px", borderRadius: 10, border: T.border,
              background: T.cream, color: T.black,
              fontFamily: T.fontMono, fontSize: 11, fontWeight: 700,
              letterSpacing: 1, cursor: "pointer",
            }}>MAP</button>
          </div>
        </div>
      )}

      {/* Edit mode panel — replaces detail card when editing */}
      {selectedDelivery && editing && (
        <div style={{
          margin: "0 20px 16px", padding: "14px 16px",
          background: T.lavender, border: T.border, borderRadius: T.radius,
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <span style={{
              fontFamily: T.fontHead, fontSize: 15, fontWeight: 700, color: T.black,
            }}>Edit Delivery</span>
            <button onClick={() => setEditing(null)} style={{
              background: "none", border: "none", cursor: "pointer",
              fontFamily: T.fontMono, fontSize: 18, fontWeight: 700, color: T.black, lineHeight: 1,
            }}>×</button>
          </div>

          {/* Customer */}
          <label style={{ ...editLabelStyle }}>CUSTOMER</label>
          <input value={editing.customer} onChange={e => setEditing({ ...editing, customer: e.target.value })}
            style={{ ...editInputStyle }} />

          {/* Status */}
          <label style={{ ...editLabelStyle }}>STATUS</label>
          <div style={{ display: "flex", gap: 4, marginBottom: 10 }}>
            {["Pending", "Scheduled", "Loaded", "On Route", "Completed"].map(s => (
              <button key={s} onClick={() => setEditing({ ...editing, status: s })} style={{
                flex: 1, padding: "6px 2px", borderRadius: 6,
                border: editing.status === s ? "2px solid #000" : T.borderThin,
                background: editing.status === s ? T.white : "rgba(255,255,255,0.4)",
                fontFamily: T.fontMono, fontSize: 8, fontWeight: editing.status === s ? 700 : 500,
                letterSpacing: 0.3, cursor: "pointer", color: T.black,
              }}>{s.toUpperCase()}</button>
            ))}
          </div>

          {/* Type */}
          <label style={{ ...editLabelStyle }}>TYPE</label>
          <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
            {["DEL", "CPU", "DROP", "PUT", "PU TRL"].map(t => (
              <button key={t} onClick={() => setEditing({ ...editing, type: t })} style={{
                padding: "6px 10px", borderRadius: 6,
                border: editing.type === t ? "2px solid #000" : T.borderThin,
                background: editing.type === t ? (t === "CPU" ? T.cream : T.lavender) : "rgba(255,255,255,0.4)",
                fontFamily: T.fontMono, fontSize: 9, fontWeight: editing.type === t ? 700 : 500,
                letterSpacing: 0.5, cursor: "pointer", color: T.black,
              }}>{t}</button>
            ))}
          </div>

          {/* Driver */}
          <label style={{ ...editLabelStyle }}>DRIVER</label>
          <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
            {["Adalid", "Tito", "Nick"].map(dr => (
              <button key={dr} onClick={() => setEditing({ ...editing, driver: dr })} style={{
                flex: 1, padding: "7px 4px", borderRadius: 6,
                border: editing.driver === dr ? "2px solid #000" : T.borderThin,
                background: editing.driver === dr ? T.white : "rgba(255,255,255,0.4)",
                fontFamily: T.fontMono, fontSize: 10, fontWeight: editing.driver === dr ? 700 : 500,
                letterSpacing: 0.3, cursor: "pointer", color: T.black,
              }}>{dr.toUpperCase()}</button>
            ))}
          </div>

          {/* Trip # */}
          <label style={{ ...editLabelStyle }}>TRIP #</label>
          <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
            {[1, 2, 3, 4, 5].map(n => (
              <button key={n} onClick={() => setEditing({ ...editing, trip: n })} style={{
                width: 36, height: 36, borderRadius: 8,
                border: editing.trip === n ? "2px solid #000" : T.borderThin,
                background: editing.trip === n ? T.white : "rgba(255,255,255,0.4)",
                fontFamily: T.fontMono, fontSize: 14, fontWeight: editing.trip === n ? 700 : 500,
                cursor: "pointer", color: T.black,
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>{n}</button>
            ))}
          </div>

          {/* Notes */}
          <label style={{ ...editLabelStyle }}>NOTES</label>
          <input value={editing.notes} onChange={e => setEditing({ ...editing, notes: e.target.value })}
            style={{ ...editInputStyle }} />

          {/* Save / Cancel */}
          <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
            <button onClick={() => {
              setDeliveries(prev => prev.map(d => d.id === editing.id ? { ...editing } : d));
              setEditing(null);
            }} style={{
              flex: 1, padding: "10px", borderRadius: 10, border: T.border,
              background: T.orange, color: "#fff",
              fontFamily: T.fontMono, fontSize: 11, fontWeight: 700,
              letterSpacing: 1, cursor: "pointer",
            }}>SAVE</button>
            <button onClick={() => setEditing(null)} style={{
              flex: 1, padding: "10px", borderRadius: 10, border: T.border,
              background: T.white, color: T.black,
              fontFamily: T.fontMono, fontSize: 11, fontWeight: 700,
              letterSpacing: 1, cursor: "pointer",
            }}>CANCEL</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================
// ACTIONS TAB
// ============================================================
function ActionsTab() {
  const [section, setSection] = useState("moves");
  return (
    <div className="brutal-scroll" style={{ flex: 1, overflow: "auto", WebkitOverflowScrolling: "touch" }}>
      <div style={{ padding: "16px 20px 8px" }}>
        <p style={{
          fontFamily: T.fontHead, fontWeight: 600, fontSize: 20,
          color: T.black, letterSpacing: -0.3,
        }}>Actions</p>
      </div>

      {/* Segment — brutal pill bar */}
      <div style={{
        display: "flex", margin: "0 20px 12px",
        border: T.border, borderRadius: 20, overflow: "hidden",
      }}>
        {[
          { id: "moves", label: "NEXT" },
          { id: "waiting", label: "WAITING" },
          { id: "overdue", label: "OVERDUE" },
        ].map((seg, i) => (
          <button key={seg.id} onClick={() => setSection(seg.id)} style={{
            flex: 1, padding: "9px 0", border: "none",
            borderRight: i < 2 ? T.border : "none",
            background: section === seg.id ? T.black : T.white,
            color: section === seg.id ? T.white : T.black,
            fontFamily: T.fontMono, fontSize: 10, fontWeight: 700,
            cursor: "pointer", letterSpacing: 1,
          }}>{seg.label}</button>
        ))}
      </div>

      <div style={{ padding: "0 20px 20px", display: "flex", flexDirection: "column", gap: 6 }}>
        {section === "moves" && NEXT_MOVES.map(m => (
          <div key={m.id} style={{
            display: "flex", alignItems: "flex-start", gap: 10,
            padding: "10px 14px", background: T.white,
            border: T.border, borderRadius: 12,
          }}>
            <span style={{
              fontFamily: T.fontMono, fontSize: 9, fontWeight: 700,
              background: m.tag === "URG" ? T.red : m.tag === "CALL" ? T.orangeLight : T.cream,
              border: T.borderThin, borderRadius: 4,
              padding: "2px 6px", letterSpacing: 0.5, flexShrink: 0, marginTop: 1,
            }}>{m.tag}</span>
            <span style={{
              fontFamily: T.fontBody, fontSize: 13, fontWeight: 500,
              color: T.black, lineHeight: 1.4,
            }}>{m.text}</span>
          </div>
        ))}

        {section === "waiting" && WAITING_ON.map((w, i) => (
          <div key={i} style={{
            padding: "10px 14px", background: T.lavender,
            border: T.border, borderRadius: 12,
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{
                fontFamily: T.fontHead, fontSize: 14, fontWeight: 700, color: T.black,
              }}>{w.contact}</span>
              <span style={{
                fontFamily: T.fontMono, fontSize: 10, fontWeight: 700,
                background: w.days > 7 ? T.red : T.cream,
                border: T.borderThin, borderRadius: 4,
                padding: "2px 6px", letterSpacing: 0.5,
              }}>{w.days}D</span>
            </div>
            <p style={{
              fontFamily: T.fontMono, fontSize: 11, fontWeight: 400,
              color: T.black, opacity: 0.6, marginTop: 4,
            }}>{w.subject}</p>
          </div>
        ))}

        {section === "overdue" && OVERDUE.map((o, i) => (
          <div key={i} style={{
            padding: "10px 14px", background: T.red,
            border: T.border, borderRadius: 12,
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{
                fontFamily: T.fontHead, fontSize: 14, fontWeight: 700, color: T.black,
              }}>{o.contact}</span>
              <span style={{
                fontFamily: T.fontMono, fontSize: 10, fontWeight: 700,
                background: T.white, border: T.borderThin, borderRadius: 4,
                padding: "2px 6px", letterSpacing: 0.5,
              }}>{o.days}D</span>
            </div>
            <p style={{
              fontFamily: T.fontMono, fontSize: 11, fontWeight: 400,
              color: T.black, opacity: 0.6, marginTop: 4,
            }}>{o.subject}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================================================
// ACCOUNTS TAB
// ============================================================
function AccountsTab() {
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState(null);
  const filtered = CUSTOMERS.filter(c =>
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    c.contact.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="brutal-scroll" style={{ flex: 1, overflow: "auto", WebkitOverflowScrolling: "touch" }}>
      <div style={{ padding: "16px 20px 4px" }}>
        <p style={{
          fontFamily: T.fontHead, fontWeight: 600, fontSize: 20,
          color: T.black, letterSpacing: -0.3,
        }}>Accounts</p>
        <p style={{
          fontFamily: T.fontMono, fontSize: 10, fontWeight: 500,
          color: T.black, opacity: 0.4, letterSpacing: 1, marginTop: 2,
        }}>{CUSTOMERS.length} ACTIVE</p>
      </div>

      {/* Search */}
      <div style={{ padding: "10px 20px" }}>
        <input
          placeholder="SEARCH..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{
            width: "100%", padding: "10px 14px", borderRadius: 12,
            border: T.border, background: T.white, color: T.black,
            fontFamily: T.fontMono, fontSize: 12, fontWeight: 500,
            letterSpacing: 1, outline: "none", boxSizing: "border-box",
          }}
        />
      </div>

      {/* Customer rows — compact table */}
      <div style={{ padding: "0 20px" }}>
        {/* Header */}
        <div style={{
          display: "flex", alignItems: "center", padding: "6px 0",
          borderBottom: "1px solid rgba(0,0,0,0.15)",
        }}>
          <span style={{
            fontFamily: T.fontMono, fontSize: 9, fontWeight: 600,
            letterSpacing: 1, color: T.black, opacity: 0.35,
            flex: 1,
          }}>ACCOUNT</span>
          <span style={{
            fontFamily: T.fontMono, fontSize: 9, fontWeight: 600,
            letterSpacing: 1, color: T.black, opacity: 0.35,
            width: 70, textAlign: "center",
          }}>PRODUCT</span>
          <span style={{
            fontFamily: T.fontMono, fontSize: 9, fontWeight: 600,
            letterSpacing: 1, color: T.black, opacity: 0.35,
            width: 50, textAlign: "right",
          }}>PRICE</span>
        </div>

        {filtered.map(c => (
          <div key={c.name}>
            <div onClick={() => setSelected(selected === c.name ? null : c.name)} style={{
              display: "flex", alignItems: "center", padding: "10px 0",
              borderBottom: "1px solid rgba(0,0,0,0.08)",
              cursor: "pointer",
              background: selected === c.name ? "rgba(207,184,255,0.15)" : "transparent",
            }}>
              <span style={{
                fontFamily: T.fontHead, fontSize: 13, fontWeight: 600,
                color: T.black, flex: 1,
                whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
              }}>{c.name}</span>
              <span style={{
                fontFamily: T.fontMono, fontSize: 10, fontWeight: 500,
                color: T.black, opacity: 0.5, width: 70, textAlign: "center",
                letterSpacing: 0.3,
              }}>{c.product}</span>
              <span style={{
                fontFamily: T.fontMono, fontSize: 13, fontWeight: 700,
                color: T.black, width: 50, textAlign: "right",
              }}>{c.price}</span>
            </div>

            {/* Expanded detail */}
            {selected === c.name && (
              <div style={{
                padding: "10px 14px", margin: "4px 0 8px",
                background: T.lavender, border: T.border, borderRadius: 12,
              }}>
                <p style={{
                  fontFamily: T.fontMono, fontSize: 11, fontWeight: 400,
                  color: T.black, opacity: 0.6,
                }}>Contact: {c.contact}</p>
                <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
                  <button style={{
                    flex: 1, padding: "8px", borderRadius: 8, border: T.border,
                    background: T.orange, color: "#fff",
                    fontFamily: T.fontMono, fontSize: 10, fontWeight: 700,
                    letterSpacing: 1, cursor: "pointer",
                  }}>CALL</button>
                  <button style={{
                    flex: 1, padding: "8px", borderRadius: 8, border: T.border,
                    background: T.white, color: T.black,
                    fontFamily: T.fontMono, fontSize: 10, fontWeight: 700,
                    letterSpacing: 1, cursor: "pointer",
                  }}>EMAIL</button>
                  <button style={{
                    flex: 1, padding: "8px", borderRadius: 8, border: T.border,
                    background: T.cream, color: T.black,
                    fontFamily: T.fontMono, fontSize: 10, fontWeight: 700,
                    letterSpacing: 1, cursor: "pointer",
                  }}>ORDER</button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
      <div style={{ height: 20 }} />
    </div>
  );
}

// ============================================================
// MAIN APP
// ============================================================
export default function YardhouseMobile() {
  const [activeTab, setActiveTab] = useState("home");

  return (
    <div style={{
      display: "flex", justifyContent: "center", alignItems: "center",
      minHeight: "100vh", background: "#C8C8C8", padding: 20,
    }}>
      <PhoneFrame>
        <HeaderBar />
        {activeTab === "home" && <HomeTab />}
        {activeTab === "actions" && <ActionsTab />}
        {activeTab === "accounts" && <AccountsTab />}
        <TabBar activeTab={activeTab} onTabChange={setActiveTab} />
      </PhoneFrame>
    </div>
  );
}