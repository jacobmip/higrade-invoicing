import { useState, useEffect } from "react";

const NAVY = "#0a1628";
const ORANGE = "#E8622A";

function fmtPrice(n) {
  return "$" + Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

export default function PriceBook({ items, onSelect, onClose }) {
  const [query, setQuery] = useState("");
  const [isDesktop, setIsDesktop] = useState(window.innerWidth > 600);

  useEffect(() => {
    const update = () => setIsDesktop(window.innerWidth > 600);
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  const q = query.trim().toLowerCase();
  const filtered = q
    ? items.filter(i => i.name.toLowerCase().includes(q) || (i.category || "").toLowerCase().includes(q))
    : items;
  const categories = [...new Set(filtered.map(i => i.category || "Other"))];

  const sheetStyle = isDesktop
    ? { background: "#fff", borderRadius: 14, width: "100%", maxWidth: 460, maxHeight: "78vh", display: "flex", flexDirection: "column", overflow: "hidden", boxShadow: "0 12px 48px rgba(0,0,0,0.22)" }
    : { background: "#fff", borderRadius: "18px 18px 0 0", width: "100%", maxHeight: "86vh", display: "flex", flexDirection: "column", overflow: "hidden" };

  return (
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(10,22,40,0.58)", zIndex: 900, display: "flex", alignItems: isDesktop ? "center" : "flex-end", justifyContent: "center" }}
    >
      <div onClick={e => e.stopPropagation()} style={sheetStyle}>

        {/* Header */}
        <div style={{ background: NAVY, padding: "14px 16px 12px", flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
            <span style={{ color: "#fff", fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 13, letterSpacing: 1.5, textTransform: "uppercase" }}>
              Price Book
            </span>
            <button
              onClick={onClose}
              style={{ background: "rgba(255,255,255,0.13)", border: "none", borderRadius: "50%", width: 24, height: 24, color: "#fff", fontSize: 16, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", lineHeight: 1, padding: 0 }}
            >
              ×
            </button>
          </div>
          <input
            autoFocus
            type="search"
            placeholder="Search items…"
            value={query}
            onChange={e => setQuery(e.target.value)}
            style={{ width: "100%", padding: "7px 10px", borderRadius: 8, border: "none", fontSize: 13, outline: "none", boxSizing: "border-box", background: "rgba(255,255,255,0.13)", color: "#fff", fontFamily: "'Barlow', sans-serif" }}
          />
        </div>

        {/* Item list */}
        <div style={{ overflowY: "auto", flex: 1, WebkitOverflowScrolling: "touch" }}>
          {categories.length === 0 && (
            <div style={{ padding: 32, textAlign: "center", color: "#aaa", fontSize: 14 }}>No items match</div>
          )}
          {categories.map(cat => (
            <div key={cat}>
              <div style={{ background: "#f4f6fa", padding: "5px 12px", fontSize: 10, fontWeight: 700, color: ORANGE, letterSpacing: 1.5, textTransform: "uppercase", fontFamily: "'Barlow Condensed', sans-serif" }}>
                {cat}
              </div>
              {filtered.filter(i => (i.category || "Other") === cat).map(item => (
                <div
                  key={item.id}
                  style={{ display: "flex", alignItems: "center", padding: "9px 12px", borderBottom: "1px solid #f0f2f8", gap: 8 }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, color: "#1a1a1a", fontWeight: 500, lineHeight: 1.3 }}>{item.name}</div>
                    {item.desc && (
                      <div style={{ fontSize: 11, color: "#8899bb", marginTop: 2, lineHeight: 1.3 }}>{item.desc}</div>
                    )}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                    <span style={{ color: ORANGE, fontWeight: 700, fontSize: 13, fontFamily: "'Barlow Condensed', sans-serif" }}>
                      {fmtPrice(item.price)}
                    </span>
                    <button
                      onClick={() => { onSelect(item); onClose(); }}
                      style={{ width: 26, height: 26, borderRadius: "50%", background: ORANGE, border: "none", color: "#fff", fontSize: 18, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", lineHeight: 1, padding: 0, flexShrink: 0 }}
                    >
                      +
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>

      </div>
    </div>
  );
}
