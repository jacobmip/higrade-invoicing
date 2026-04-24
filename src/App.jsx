import { useState, useEffect, useRef } from "react";
import * as GCal from './googleCalendar.js';

const NAVY = "#0a1628";
const ORANGE = "#E8622A";
const NAVY2 = "#0f2040";
const LIGHT = "#f4f6fa";
const TAX_RATE = 4.712;
const KEY = "higrade_v5";

const SAVED_ITEMS = [
  { id: 1, category: "Drain", name: "Drain Clean – Snake", price: 350 },
  { id: 2, category: "Drain", name: "Drain Clean – Hydro Jet", price: 750 },
  { id: 3, category: "Toilet", name: "Toilet Repair", price: 295 },
  { id: 4, category: "Toilet", name: "Toilet Replace (labor only)", price: 425 },
  { id: 5, category: "Toilet", name: "Toilet Replace (supply + labor)", price: 750 },
  { id: 6, category: "Faucet", name: "Faucet Repair", price: 265 },
  { id: 7, category: "Faucet", name: "Faucet Replace (labor only)", price: 325 },
  { id: 8, category: "Faucet", name: "Faucet Replace (supply + labor)", price: 575 },
  { id: 9, category: "Water Heater", name: "Water Heater – Electric 40gal", price: 1800 },
  { id: 10, category: "Water Heater", name: "Water Heater – Gas 40gal", price: 2200 },
  { id: 11, category: "Water Heater", name: "Tankless Water Heater", price: 4200 },
  { id: 12, category: "Sewer", name: "Sewer Camera Inspection", price: 450 },
  { id: 13, category: "Sewer", name: "Sewer Spot Repair", price: 2800 },
  { id: 14, category: "Gas", name: "Gas Line Repair", price: 1200 },
  { id: 15, category: "Service", name: "Service Call / Diagnostic", price: 225 },
  { id: 16, category: "Service", name: "After Hours Emergency", price: 385 },
];

const DEFAULT_CLIENTS = [
  { id: 1, name: "Jacob Petersen", email: "jacobmip@gmail.com", email2: "", phone: "", fax: "", address1: "", address2: "", address3: "" },
];

const DEFAULT_INVOICES = [
  {
    id: "INV0005", type: "invoice", client: "Jacob Petersen", date: "2026-04-22", dueDate: "2026-04-22",
    status: "outstanding", tax: TAX_RATE, discount: 0, notes: "", year: 2026, payments: [],
    items: [{ name: "Sewer Camera Inspection", desc: "Locate cleanout access and set up camera equipment\nRun camera through main sewer line from cleanout to street\nInspect for root intrusion, cracks, and blockages\nDocument findings with photos and footage\nProvide verbal report of pipe condition and recommendations", qty: 1, price: 450, unit: "flat", discount: 0, discountType: "%", taxable: true }],
  },
  {
    id: "INV0004", type: "invoice", client: "Jacob Petersen", date: "2026-04-18", dueDate: "2026-04-18",
    status: "outstanding", tax: TAX_RATE, discount: 0, notes: "", year: 2026, payments: [],
    items: [{ name: "Kitchen Faucet Replacement", desc: "Shut off hot and cold supply valves under sink\nDisconnect supply lines and remove old faucet\nClean mounting surface and inspect for corrosion\nInstall new customer-supplied faucet with new supply lines\nReconnect drain and check garbage disposal connection\nRestore water and test for leaks at all connections\nVerify hot and cold operation and proper flow rate", qty: 1, price: 575, unit: "flat", discount: 0, discountType: "%", taxable: true }],
  },
  {
    id: "INV0003", type: "invoice", client: "Jacob Petersen", date: "2026-04-14", dueDate: "2026-04-14",
    status: "paid", tax: TAX_RATE, discount: 0, notes: "", year: 2026, payments: [{ amount: 1884.82, method: "Check", date: "2026-04-14" }],
    items: [{ name: "Water Heater Replacement – Electric 40gal", desc: "Shut off power at breaker and cold water supply to unit\nDrain existing water heater and disconnect supply lines\nDisconnect electrical connections and remove old unit\nPosition and secure new 40-gallon electric water heater\nReconnect cold supply, hot outlet, and pressure relief valve\nReconnect electrical wiring and verify proper grounding\nRestore power and water, purge air from lines\nTest thermostat settings and check all connections for leaks", qty: 1, price: 1800, unit: "flat", discount: 0, discountType: "%", taxable: true }],
  },
  {
    id: "INV0002", type: "invoice", client: "Jacob Petersen", date: "2026-04-10", dueDate: "2026-04-10",
    status: "paid", tax: TAX_RATE, discount: 0, notes: "", year: 2026, payments: [{ amount: 790.35, method: "Cash", date: "2026-04-10" }],
    items: [{ name: "Drain Cleaning – Hydro Jet", desc: "Locate and access main line cleanout\nSet up hydro-jet equipment and safety barriers\nInsert jetting hose and clear grease buildup and debris\nFlush line at 3,500 PSI from cleanout to street connection\nBackflush to clear any remaining obstruction\nRun camera to confirm line is fully clear\nRestore cleanout cap and clean work area", qty: 1, price: 750, unit: "flat", discount: 0, discountType: "%", taxable: true }],
  },
  {
    id: "INV0001", type: "invoice", client: "Jacob Petersen", date: "2026-04-07", dueDate: "2026-04-07",
    status: "paid", tax: TAX_RATE, discount: 0, notes: "", year: 2026, payments: [{ amount: 403.13, method: "Venmo", date: "2026-04-07" }],
    items: [{ name: "Wax Seal Replacement – Rear Outlet Toilet", desc: "Shut off water supply to toilet and flush to empty tank and bowl\nDisconnect water supply line and remove toilet from floor\nRemove old wax ring and inspect floor flange for damage\nInstall new wax ring and new closet bolts\nReset toilet and secure evenly to floor\nReconnect water supply line and restore water\nTest fill valve operation and inspect all connections for leaks\nVerify proper flush and drainage", qty: 1, price: 385, unit: "flat", discount: 0, discountType: "%", taxable: true }],
  },
];

function loadData() {
  try { const raw = localStorage.getItem(KEY); if (raw) return JSON.parse(raw); } catch {}
  return { invoices: DEFAULT_INVOICES, clients: DEFAULT_CLIENTS, savedItems: SAVED_ITEMS, nextNum: 6 };
}
function saveData(d) { try { localStorage.setItem(KEY, JSON.stringify(d)); } catch {} }

function calcItemTotal(it) {
  const gross = (it.qty || 1) * (it.price || 0);
  if (!it.discount) return gross;
  return it.discountType === "%" ? gross * (1 - it.discount / 100) : Math.max(0, gross - it.discount);
}
function calcTotals(inv) {
  const sub = inv.items.reduce((s, it) => s + calcItemTotal(it), 0);
  const disc = inv.discount || 0;
  const afterDisc = sub - disc;
  const taxAmt = afterDisc * (inv.tax / 100);
  const total = afterDisc + taxAmt;
  const paid = (inv.payments || []).reduce((s, p) => s + p.amount, 0);
  return { sub, disc, afterDisc, taxAmt, total, paid, balance: total - paid };
}
function fmt(n) { return "$" + Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function today() { return new Date().toISOString().slice(0, 10); }
function fmtDate(d) { if (!d) return "—"; const [y, m, day] = d.split("-"); return `${m}/${day}/${y}`; }

function buildGlobalSystemPrompt(data) {
  const invoiceLines = data.invoices.slice(0, 20).map(inv => {
    const t = calcTotals(inv);
    return `  ${inv.id} | ${inv.client} | ${fmt(t.total)} | ${inv.status} | ${inv.date}`;
  }).join("\n");
  const clientLines = data.clients.map(c =>
    `  ${c.name}${c.email ? " | " + c.email : ""}${c.phone ? " | " + c.phone : ""}`
  ).join("\n");
  const savedItemLines = (data.savedItems || []).map(i => `  ${i.name}: $${i.price}`).join("\n");

  return `You are Jake's AI assistant for HI Grade Plumbing LLC's invoicing app (Honolulu, Hawaii). You have full control over the app.

CURRENT INVOICES (ID | Client | Total | Status | Date):
${invoiceLines || "  (none)"}

CLIENTS (Name | Email | Phone):
${clientLines || "  (none)"}

JAKE'S SAVED PRICES — always use these exact prices when generating estimates or invoices for matching jobs:
${savedItemLines || "  (none saved yet)"}

FALLBACK HONOLULU PRICING (only use if no saved price matches):
Drain snake $300–$450 | Hydro-jet $550–$950 | Toilet repair $220–$380 | Toilet replace $550–$950
Faucet repair $195–$350 | Faucet replace $450–$750 | Water heater elec 40gal $1,400–$2,200
Water heater gas 40gal $1,800–$2,800 | Tankless $3,200–$5,500 | Sewer camera $350–$550
Sewer spot repair $1,800–$4,500 | Gas line repair $800–$2,500 | Bathroom remodel $4,500–$12,000

ACTIONS — when taking an action respond with ONLY a JSON object, no markdown fences, no extra text:

Create a new invoice:
{"action":"create_invoice","invoice":{"client":"exact name from CLIENTS","date":"YYYY-MM-DD","dueDate":"YYYY-MM-DD","items":[{"name":"Short Title","desc":"step1\\nstep2\\nstep3","qty":1,"price":000}],"notes":"","tax":4.712,"discount":0},"summary":"one sentence"}

Create a new estimate (use this when user says estimate, quote, or bid):
{"action":"create_estimate","invoice":{"client":"exact name from CLIENTS","date":"YYYY-MM-DD","dueDate":"YYYY-MM-DD","items":[{"name":"Short Title","desc":"step1\\nstep2\\nstep3","qty":1,"price":000}],"notes":"","tax":4.712,"discount":0},"summary":"one sentence"}

Add items to an existing invoice:
{"action":"add_items","invoiceId":"INV0000","items":[{"name":"Short Title","desc":"step1\\nstep2","qty":1,"price":000}],"summary":"one sentence"}

Send invoice email (requires confirmation):
{"action":"send_email","invoiceId":"INV0000","summary":"one sentence"}

Save or update a price in Jake's memory (use when Jake says "save", "remember", "set price", "my price for X is Y"):
{"action":"save_item","item":{"name":"Item Name","category":"Category","price":000},"summary":"one sentence"}

RULES:
- Match client names exactly as they appear in CLIENTS above. Always include the client field.
- When generating an estimate or invoice, check JAKE'S SAVED PRICES first — if a match exists, use that exact price.
- One flat-rate line item per job. Never add a separate service call.
- Item name: short title, 6 words max. Item desc: newline-separated work steps, no bullets or dashes, minimum 6 steps.
- Category for save_item must be one of: Drain, Toilet, Faucet, Water Heater, Sewer, Gas, Service, Custom.
- For plain questions or conversation, reply in plain text without JSON.`;
}

async function callAI(messages, systemPrompt = null) {
  const res = await fetch("/api/ai", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages, ...(systemPrompt ? { systemPrompt } : {}) }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || data.error);
  return data.content?.[0]?.text || "";
}

async function sendInvoiceEmail(invoice, client) {
  const t = calcTotals(invoice);
  const itemsHtml = invoice.items.map(it => {
    const title = it.name || it.desc || "";
    const detail = it.name && it.desc ? `<br><span style="color:#888;font-size:12px;">${it.desc.replace(/\n/g, "<br>")}</span>` : "";
    return `<tr><td style="padding:8px;border-bottom:1px solid #eee;">${title}${detail}</td><td style="padding:8px;border-bottom:1px solid #eee;text-align:center;">${it.qty}</td><td style="padding:8px;border-bottom:1px solid #eee;text-align:right;">${fmt(calcItemTotal(it))}</td></tr>`;
  }).join("");
  const invoiceHtml = `
    <table style="width:100%;border-collapse:collapse;margin-top:16px;">
      <thead><tr style="background:#0a1628;color:#fff;">
        <th style="padding:10px;text-align:left;">Description</th>
        <th style="padding:10px;text-align:center;">Qty</th>
        <th style="padding:10px;text-align:right;">Amount</th>
      </tr></thead>
      <tbody>${itemsHtml}</tbody>
    </table>
    <div style="text-align:right;margin-top:12px;">
      <p>Subtotal: ${fmt(t.sub)}</p>
      <p>GET (${invoice.tax}%): ${fmt(t.taxAmt)}</p>
    </div>
  `;
  const res = await fetch("/api/send-email", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ to: client.email, clientName: client.name, invoiceId: invoice.id, total: t.total.toFixed(2), invoiceHtml }),
  });
  return res.json();
}

// ─── Icons ────────────────────────────────────────────────────────────────────
const Icon = ({ name, size = 20, color = "currentColor" }) => {
  const p = { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: color, strokeWidth: 2 };
  const icons = {
    invoice:   <svg {...p}><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="8" y1="8" x2="16" y2="8"/><line x1="8" y1="12" x2="16" y2="12"/><line x1="8" y1="16" x2="12" y2="16"/></svg>,
    estimates: <svg {...p}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="12" y2="17"/></svg>,
    clients:   <svg {...p}><circle cx="9" cy="7" r="4"/><path d="M3 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/><path d="M21 21v-2a4 4 0 0 0-3-3.85"/></svg>,
    items:     <svg {...p}><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>,
    dollar:    <svg {...p}><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>,
    ai:        <svg {...p}><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.22 4.22l2.12 2.12M17.66 17.66l2.12 2.12M2 12h3M19 12h3M4.22 19.78l2.12-2.12M17.66 6.34l2.12-2.12"/></svg>,
    plus:      <svg {...p} strokeWidth={2.5}><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>,
    mic:       <svg {...p}><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0 0 14 0"/><line x1="12" y1="19" x2="12" y2="22"/><line x1="8" y1="22" x2="16" y2="22"/></svg>,
    send:      <svg {...p}><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>,
    trash:     <svg {...p}><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>,
    back:      <svg {...p}><polyline points="15 18 9 12 15 6"/></svg>,
    mail:      <svg {...p}><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>,
    payment:   <svg {...p}><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>,
    check:     <svg {...p} strokeWidth={2.5}><polyline points="20 6 9 17 4 12"/></svg>,
    eye:       <svg {...p}><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>,
    clock:     <svg {...p}><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>,
    pencil:    <svg {...p}><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>,
    chevron:   <svg {...p}><polyline points="9 18 15 12 9 6"/></svg>,
    grip:      <svg {...p}><line x1="6" y1="9" x2="18" y2="9"/><line x1="6" y1="12" x2="18" y2="12"/><line x1="6" y1="15" x2="18" y2="15"/></svg>,
    arrowUp:   <svg {...p}><polyline points="18 15 12 9 6 15"/></svg>,
    arrowDown: <svg {...p}><polyline points="6 9 12 15 18 9"/></svg>,
    calendar:  <svg {...p}><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>,
    bell:      <svg {...p}><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>,
  };
  return icons[name] || null;
};

const S = {
  btn: (v = "primary") => ({
    background: v === "primary" ? ORANGE : v === "navy" ? NAVY : v === "green" ? "#27ae60" : "#e8ecf4",
    color: v === "ghost" ? "#444" : "#fff",
    border: "none", borderRadius: 8, padding: "10px 18px",
    fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 14, letterSpacing: 1,
    cursor: "pointer",
  }),
  input: {
    width: "100%", border: "1.5px solid #dde2ee", borderRadius: 8,
    padding: "9px 12px", fontSize: 14, fontFamily: "'Barlow', sans-serif",
    outline: "none", background: "#fff", boxSizing: "border-box",
  },
  label: {
    fontSize: 11, fontWeight: 700, color: "#6677aa", letterSpacing: 1,
    textTransform: "uppercase", fontFamily: "'Barlow Condensed', sans-serif",
    display: "block", marginBottom: 4,
  },
  card: {
    background: "#fff", borderRadius: 12, marginBottom: 10, overflow: "hidden",
    boxShadow: "0 1px 6px rgba(0,0,0,0.07)",
  },
  pill: (color) => ({
    background: color + "22", color,
    fontSize: 10, fontWeight: 700, letterSpacing: 1, padding: "3px 8px",
    borderRadius: 20, textTransform: "uppercase", fontFamily: "'Barlow Condensed', sans-serif",
  }),
};

// ─── AI Chat Panel ────────────────────────────────────────────────────────────
function AIChatPanel({ onAddItems }) {
  const [msgs, setMsgs] = useState([{ role: "assistant", text: "Hey Jake! Describe a job and I'll build the estimate." }]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [listening, setListening] = useState(false);
  const endRef = useRef(null);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }); }, [msgs, loading]);

  const startListening = () => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { alert("Voice not supported."); return; }
    const r = new SR(); r.lang = "en-US";
    r.onresult = e => { setInput(p => (p + " " + e.results[0][0].transcript).trim()); setListening(false); };
    r.onerror = () => setListening(false); r.onend = () => setListening(false);
    r.start(); setListening(true);
  };

  const send = async () => {
    const text = input.trim(); if (!text || loading) return;
    setInput(""); const userMsg = { role: "user", text };
    setMsgs(p => [...p, userMsg]); setLoading(true);
    try {
      const history = [...msgs, userMsg].filter(m => m.text?.trim()).map(m => ({ role: m.role === "user" ? "user" : "assistant", content: m.text }));
      const first = history.findIndex(m => m.role === "user");
      const reply = await callAI(first >= 0 ? history.slice(first) : history);
      let parsed = null;
      try { const m = reply.match(/\{[\s\S]*"action"\s*:\s*"estimate"[\s\S]*\}/); if (m) parsed = JSON.parse(m[0]); } catch {}
      if (parsed?.action === "estimate" && parsed.items?.length) {
        setMsgs(p => [...p, { role: "assistant", text: parsed.summary || "Here's your estimate:", estimate: parsed }]);
      } else {
        setMsgs(p => [...p, { role: "assistant", text: reply }]);
      }
    } catch (e) { setMsgs(p => [...p, { role: "assistant", text: "Error: " + e.message }]); }
    setLoading(false);
  };

  return (
    <div style={{ position: "relative", height: 400, background: "#f4f6fa", borderRadius: 12, overflow: "hidden", border: "1.5px solid #dde2ee" }}>
      <style>{`@keyframes bounce{0%,80%,100%{transform:translateY(0)}40%{transform:translateY(-8px)}}`}</style>
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 62, overflowY: "auto", padding: 14 }}>
        {msgs.map((m, i) => (
          <div key={i} style={{ marginBottom: 10, display: "flex", justifyContent: m.role === "user" ? "flex-end" : "flex-start" }}>
            <div style={{ maxWidth: "85%", background: m.role === "user" ? NAVY : "#fff", color: m.role === "user" ? "#fff" : "#1a1a1a", borderRadius: m.role === "user" ? "14px 14px 4px 14px" : "14px 14px 14px 4px", padding: "10px 13px", fontSize: 13, lineHeight: 1.55, boxShadow: "0 1px 4px rgba(0,0,0,0.09)" }}>
              {m.text}
              {m.estimate && (
                <div style={{ marginTop: 10, borderTop: "1px solid #e8ecf4", paddingTop: 8 }}>
                  {m.estimate.items.map((it, j) => (
                    <div key={j} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 5 }}>
                      <span style={{ color: "#ccd" }}>{it.name || it.desc}</span>
                      <strong style={{ color: ORANGE, marginLeft: 8 }}>{fmt(calcItemTotal(it))}</strong>
                    </div>
                  ))}
                  <button onClick={() => { onAddItems(m.estimate.items, m.estimate.notes); setMsgs(p => [...p, { role: "assistant", text: "✓ Items added!" }]); }} style={{ ...S.btn("primary"), width: "100%", marginTop: 10, fontSize: 13 }}>+ Add to Invoice</button>
                </div>
              )}
            </div>
          </div>
        ))}
        {loading && <div style={{ display: "flex", marginBottom: 10 }}><div style={{ background: "#fff", borderRadius: "14px 14px 14px 4px", padding: "12px 16px", boxShadow: "0 1px 4px rgba(0,0,0,0.08)", display: "flex", gap: 5 }}>{[0,1,2].map(i => <span key={i} style={{ width: 8, height: 8, borderRadius: "50%", background: ORANGE, display: "inline-block", animation: `bounce 1s ${i*0.18}s infinite` }}/>)}</div></div>}
        <div ref={endRef} />
      </div>
      <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 62, background: "#fff", borderTop: "1px solid #dde2ee", display: "flex", alignItems: "center", gap: 8, padding: "0 10px" }}>
        <button onClick={startListening} style={{ width: 40, height: 40, borderRadius: 8, border: "none", background: listening ? ORANGE : "#f0f2f8", color: listening ? "#fff" : "#666", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}><Icon name="mic" size={18} /></button>
        <input style={{ flex: 1, border: "1.5px solid #dde2ee", borderRadius: 8, padding: "9px 12px", fontSize: 13, fontFamily: "'Barlow', sans-serif", outline: "none", background: "#f8f9fc" }} value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === "Enter" && send()} placeholder={listening ? "Listening…" : "Describe a job…"} />
        <button onClick={send} style={{ width: 40, height: 40, borderRadius: 8, border: "none", background: NAVY, color: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}><Icon name="send" size={17} /></button>
      </div>
    </div>
  );
}

// ─── Payment Modal ────────────────────────────────────────────────────────────
function PaymentModal({ invoice, onClose, onSave }) {
  const t = calcTotals(invoice);
  const [amount, setAmount] = useState(t.balance.toFixed(2));
  const [method, setMethod] = useState("Cash");
  const [date, setDate] = useState(today());
  const save = () => {
    const payment = { amount: parseFloat(amount), method, date };
    const payments = [...(invoice.payments || []), payment];
    const newTotal = payments.reduce((s, p) => s + p.amount, 0);
    onSave({ ...invoice, payments, status: newTotal >= t.total - 0.01 ? "paid" : "partial" });
    onClose();
  };
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 500, display: "flex", alignItems: "flex-end" }}>
      <div style={{ background: "#fff", width: "100%", borderRadius: "16px 16px 0 0", padding: 24, maxWidth: 480, margin: "0 auto" }}>
        <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 20, marginBottom: 16 }}>Record Payment</div>
        <div style={{ marginBottom: 12 }}><label style={S.label}>Amount</label><input type="number" style={S.input} value={amount} onChange={e => setAmount(e.target.value)} step="0.01" /></div>
        <div style={{ marginBottom: 12 }}><label style={S.label}>Method</label><select style={S.input} value={method} onChange={e => setMethod(e.target.value)}>{["Cash","Check","Venmo","Zelle","Credit Card","Bank Transfer","Other"].map(m => <option key={m}>{m}</option>)}</select></div>
        <div style={{ marginBottom: 20 }}><label style={S.label}>Date</label><input type="date" style={S.input} value={date} onChange={e => setDate(e.target.value)} /></div>
        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={onClose} style={{ ...S.btn("ghost"), flex: 1 }}>Cancel</button>
          <button onClick={save} style={{ ...S.btn("green"), flex: 2 }}>Save Payment</button>
        </div>
      </div>
    </div>
  );
}

// ─── Schedule Job Modal ───────────────────────────────────────────────────────
function ScheduleJobModal({ invoice, gcalAuthed, onClose, onSave }) {
  const [date, setDate] = useState(invoice.gcalDate?.slice(0, 10) || today());
  const [time, setTime] = useState(invoice.gcalDate?.slice(11, 16) || "09:00");
  const [duration, setDuration] = useState("2");
  const [saving, setSaving] = useState(false);
  const jobTitle = invoice.items?.[0]?.name || "Plumbing Service";
  const desc = invoice.items?.[0]?.desc || "";

  const handleSave = async () => {
    setSaving(true);
    let gcalEventId = invoice.gcalEventId || null;
    if (gcalAuthed && GCal.isConfigured()) {
      const startDt = new Date(`${date}T${time}:00`);
      const endDt = new Date(startDt.getTime() + parseInt(duration) * 3600000);
      const event = {
        summary: `${invoice.client || "Client"} – ${jobTitle}`,
        description: desc,
        start: { dateTime: startDt.toISOString(), timeZone: GCal.TZ },
        end: { dateTime: endDt.toISOString(), timeZone: GCal.TZ },
      };
      try {
        if (gcalEventId) await GCal.deleteEvent(gcalEventId).catch(() => {});
        const resp = await GCal.createEvent(event);
        gcalEventId = resp?.id || gcalEventId;
      } catch {}
    }
    onSave({ gcalDate: `${date}T${time}`, gcalEventId });
    setSaving(false);
    onClose();
  };

  const handleRemove = async () => {
    if (invoice.gcalEventId && gcalAuthed) await GCal.deleteEvent(invoice.gcalEventId).catch(() => {});
    onSave({ gcalDate: null, gcalEventId: null });
    onClose();
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 500, display: "flex", alignItems: "flex-end" }}>
      <div style={{ background: "#fff", width: "100%", borderRadius: "16px 16px 0 0", padding: 24, maxWidth: 480, margin: "0 auto" }}>
        <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 20, marginBottom: 4, color: NAVY }}>Schedule Job</div>
        <div style={{ fontSize: 13, color: "#888", marginBottom: 16 }}>{invoice.client || "No client"} · {jobTitle}</div>
        <div style={{ marginBottom: 12 }}><label style={S.label}>Date</label><input type="date" style={S.input} value={date} onChange={e => setDate(e.target.value)} /></div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 20 }}>
          <div><label style={S.label}>Start Time</label><input type="time" style={S.input} value={time} onChange={e => setTime(e.target.value)} /></div>
          <div><label style={S.label}>Duration</label>
            <select style={S.input} value={duration} onChange={e => setDuration(e.target.value)}>
              {["1","2","3","4","6","8"].map(h => <option key={h} value={h}>{h} hr{h !== "1" ? "s" : ""}</option>)}
            </select>
          </div>
        </div>
        {!gcalAuthed && GCal.isConfigured() && <div style={{ fontSize: 11, color: "#aaa", marginBottom: 12, background: "#f8f9fc", borderRadius: 6, padding: "7px 10px" }}>Connect Google Calendar in the Calendar tab to sync this event.</div>}
        <div style={{ display: "flex", gap: 8 }}>
          {invoice.gcalDate && <button onClick={handleRemove} style={{ ...S.btn("ghost"), fontSize: 12, padding: "10px 12px", color: "#cc4444" }}>Remove</button>}
          <button onClick={onClose} style={{ ...S.btn("ghost"), flex: 1 }}>Cancel</button>
          <button onClick={handleSave} disabled={saving} style={{ ...S.btn("primary"), flex: 2 }}>{saving ? "Saving…" : "Schedule"}</button>
        </div>
      </div>
    </div>
  );
}

// ─── Follow Up Modal ──────────────────────────────────────────────────────────
function FollowUpModal({ invoice, gcalAuthed, onClose, onSave }) {
  const [date, setDate] = useState(() => {
    if (invoice.followUpDate) return invoice.followUpDate;
    const d = new Date(); d.setDate(d.getDate() + 3); return d.toISOString().slice(0, 10);
  });
  const [saving, setSaving] = useState(false);
  const preset = (days) => { const d = new Date(); d.setDate(d.getDate() + days); setDate(d.toISOString().slice(0, 10)); };

  const handleSave = async () => {
    setSaving(true);
    let followUpEventId = invoice.followUpEventId || null;
    if (gcalAuthed && GCal.isConfigured()) {
      const event = { summary: `Follow up: ${invoice.id} – ${invoice.client || "Client"}`, start: { date }, end: { date } };
      try {
        if (followUpEventId) await GCal.deleteEvent(followUpEventId).catch(() => {});
        const resp = await GCal.createEvent(event);
        followUpEventId = resp?.id || followUpEventId;
      } catch {}
    }
    onSave({ followUpDate: date, followUpEventId });
    setSaving(false);
    onClose();
  };

  const handleRemove = async () => {
    if (invoice.followUpEventId && gcalAuthed) await GCal.deleteEvent(invoice.followUpEventId).catch(() => {});
    onSave({ followUpDate: null, followUpEventId: null });
    onClose();
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 500, display: "flex", alignItems: "flex-end" }}>
      <div style={{ background: "#fff", width: "100%", borderRadius: "16px 16px 0 0", padding: 24, maxWidth: 480, margin: "0 auto" }}>
        <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 20, marginBottom: 16, color: NAVY }}>Set Follow-Up Reminder</div>
        <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
          {[["Tomorrow", 1], ["3 Days", 3], ["1 Week", 7]].map(([label, days]) => (
            <button key={label} onClick={() => preset(days)} style={{ ...S.btn("ghost"), flex: 1, fontSize: 12, padding: "8px 4px" }}>{label}</button>
          ))}
        </div>
        <div style={{ marginBottom: 20 }}><label style={S.label}>Custom Date</label><input type="date" style={S.input} value={date} onChange={e => setDate(e.target.value)} /></div>
        {!gcalAuthed && GCal.isConfigured() && <div style={{ fontSize: 11, color: "#aaa", marginBottom: 12, background: "#f8f9fc", borderRadius: 6, padding: "7px 10px" }}>Connect Google Calendar in the Calendar tab to sync reminders.</div>}
        <div style={{ display: "flex", gap: 8 }}>
          {invoice.followUpDate && <button onClick={handleRemove} style={{ ...S.btn("ghost"), fontSize: 12, padding: "10px 12px", color: "#cc4444" }}>Remove</button>}
          <button onClick={onClose} style={{ ...S.btn("ghost"), flex: 1 }}>Cancel</button>
          <button onClick={handleSave} disabled={saving} style={{ ...S.btn("primary"), flex: 2 }}>{saving ? "Saving…" : "Set Reminder"}</button>
        </div>
      </div>
    </div>
  );
}

// ─── Global AI Modal ──────────────────────────────────────────────────────────
function GlobalAIModal({ data, onClose, onAction, onOpenDoc }) {
  const [msgs, setMsgs] = useState([{ role: "assistant", text: `Hey Jake! I can see ${data.invoices.length} invoices and ${data.clients.length} clients. I can create invoices, add items, send emails, or build estimates. What do you need?` }]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [listening, setListening] = useState(false);
  const endRef = useRef(null);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }); }, [msgs, loading]);

  const startListening = () => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { alert("Voice not supported."); return; }
    const r = new SR(); r.lang = "en-US";
    r.onresult = e => { setInput(p => (p + " " + e.results[0][0].transcript).trim()); setListening(false); };
    r.onerror = () => setListening(false); r.onend = () => setListening(false);
    r.start(); setListening(true);
  };

  const send = async () => {
    const text = input.trim(); if (!text || loading) return;
    setInput(""); const userMsg = { role: "user", text };
    setMsgs(p => [...p, userMsg]); setLoading(true);
    try {
      const history = [...msgs, userMsg].filter(m => m.text?.trim()).map(m => ({ role: m.role === "user" ? "user" : "assistant", content: m.text }));
      const first = history.findIndex(m => m.role === "user");
      const reply = await callAI(first >= 0 ? history.slice(first) : history, buildGlobalSystemPrompt(data));
      let parsed = null;
      try { const m = reply.match(/\{[\s\S]*"action"\s*:\s*"[\w_]+"[\s\S]*\}/); if (m) parsed = JSON.parse(m[0]); } catch {}
      if (parsed?.action === "create_invoice" || parsed?.action === "create_estimate") {
        const newInv = onAction(parsed);
        const label = parsed.action === "create_estimate" ? "Estimate created." : "Invoice created.";
        setMsgs(p => [...p, { role: "assistant", text: parsed.summary || label, card: { type: "created", invoice: newInv } }]);
      } else if (parsed?.action === "save_item") {
        onAction(parsed);
        setMsgs(p => [...p, { role: "assistant", text: parsed.summary || "Price saved.", card: { type: "saved_item", item: parsed.item } }]);
      } else if (parsed?.action === "add_items") {
        onAction(parsed);
        setMsgs(p => [...p, { role: "assistant", text: parsed.summary || "Items added.", card: { type: "added", invoiceId: parsed.invoiceId, count: parsed.items?.length || 0 } }]);
      } else if (parsed?.action === "send_email") {
        const inv = data.invoices.find(i => i.id === parsed.invoiceId);
        const client = data.clients.find(c => c.name === inv?.client);
        if (!inv || !client?.email) {
          setMsgs(p => [...p, { role: "assistant", text: `Couldn't find ${parsed.invoiceId} or no email on file.` }]);
        } else {
          setMsgs(p => [...p, { role: "assistant", text: parsed.summary || `Ready to send ${parsed.invoiceId}.`, card: { type: "confirm_email", invoiceId: parsed.invoiceId, email: client.email, total: calcTotals(inv).total } }]);
        }
      } else if (parsed?.action === "estimate") {
        setMsgs(p => [...p, { role: "assistant", text: parsed.summary || "Here's the estimate:", estimate: parsed }]);
      } else {
        setMsgs(p => [...p, { role: "assistant", text: reply }]);
      }
    } catch (e) { setMsgs(p => [...p, { role: "assistant", text: "Error: " + e.message }]); }
    setLoading(false);
  };

  const confirmEmail = async (idx) => {
    const { invoiceId } = msgs[idx].card;
    setMsgs(p => p.map((m, i) => i === idx ? { ...m, card: { ...m.card, type: "email_sending" } } : m));
    try {
      const inv = data.invoices.find(i => i.id === invoiceId);
      const client = data.clients.find(c => c.name === inv?.client);
      await sendInvoiceEmail(inv, client);
      setMsgs(p => p.map((m, i) => i === idx ? { ...m, card: { ...m.card, type: "email_sent" } } : m));
    } catch (e) {
      setMsgs(p => p.map((m, i) => i === idx ? { ...m, card: { ...m.card, type: "email_failed", error: e.message } } : m));
    }
  };

  const createFromEstimate = (estimate) => {
    const newInv = onAction({ action: "create_invoice", invoice: { client: "", date: today(), dueDate: today(), items: estimate.items, notes: estimate.notes || "", tax: TAX_RATE, discount: 0 }, summary: "Invoice created from estimate" });
    setMsgs(p => [...p, { role: "assistant", text: `Created ${newInv.id} — open it from the invoice list to assign a client.`, card: { type: "created", invoice: newInv } }]);
  };

  const bubble = (isUser) => ({ maxWidth: "88%", background: isUser ? NAVY : "#fff", color: isUser ? "#fff" : "#1a1a1a", borderRadius: isUser ? "16px 16px 4px 16px" : "16px 16px 16px 4px", padding: "11px 14px", fontSize: 13, lineHeight: 1.55, boxShadow: "0 1px 4px rgba(0,0,0,0.08)" });

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 300, display: "flex", flexDirection: "column", background: LIGHT, maxWidth: 480, margin: "0 auto" }}>
      <style>{`@keyframes bounce{0%,80%,100%{transform:translateY(0)}40%{transform:translateY(-8px)}}`}</style>
      <div style={{ background: NAVY, padding: "14px 16px", display: "flex", alignItems: "center", gap: 12, flexShrink: 0, boxShadow: "0 2px 12px rgba(0,0,0,0.3)" }}>
        <div style={{ width: 36, height: 36, background: ORANGE, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center" }}><Icon name="ai" size={20} color="#fff" /></div>
        <div style={{ flex: 1 }}>
          <div style={{ color: "#fff", fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 17, letterSpacing: 1 }}>AI ASSISTANT</div>
          <div style={{ color: "#8899bb", fontSize: 11 }}>{data.invoices.length} invoices · {data.clients.length} clients</div>
        </div>
        <button onClick={onClose} style={{ background: "none", border: "none", color: "#8899bb", cursor: "pointer", fontSize: 28, lineHeight: 1, padding: "0 4px" }}>×</button>
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: "14px 14px 0" }}>
        {msgs.map((m, i) => (
          <div key={i} style={{ marginBottom: 12, display: "flex", justifyContent: m.role === "user" ? "flex-end" : "flex-start" }}>
            <div style={bubble(m.role === "user")}>
              {m.text}
              {m.estimate && (
                <div style={{ marginTop: 10, borderTop: "1px solid #f0f2f8", paddingTop: 10 }}>
                  {m.estimate.items.map((it, j) => (
                    <div key={j} style={{ marginBottom: 8 }}>
                      <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ fontWeight: 600, flex: 1 }}>{it.name || it.desc}</span><strong style={{ color: ORANGE, marginLeft: 10 }}>{fmt(calcItemTotal(it))}</strong></div>
                      {it.name && it.desc && <div style={{ fontSize: 11, color: "#aaa", marginTop: 3, lineHeight: 1.5, whiteSpace: "pre-line" }}>{it.desc}</div>}
                    </div>
                  ))}
                  <button onClick={() => createFromEstimate(m.estimate)} style={{ ...S.btn("primary"), width: "100%", marginTop: 10, fontSize: 13 }}>+ Create Invoice</button>
                </div>
              )}
              {m.card?.type === "created" && <div onClick={() => onOpenDoc?.(m.card.invoice)} style={{ marginTop: 10, background: "#edfaf3", borderRadius: 8, padding: "10px 12px", display: "flex", alignItems: "center", gap: 10, cursor: "pointer", border: "1.5px solid #b8f0d0" }}><Icon name="check" size={16} color="#27ae60" /><div style={{ flex: 1 }}><div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 15, color: "#27ae60" }}>{m.card.invoice?.id} Created</div>{m.card.invoice?.client && <div style={{ fontSize: 12, color: "#555" }}>{m.card.invoice.client}</div>}{m.card.invoice && <div style={{ fontSize: 13, fontWeight: 700, color: "#27ae60" }}>{fmt(calcTotals(m.card.invoice).total)}</div>}</div><div style={{ fontSize: 11, color: "#27ae60", fontWeight: 600 }}>Open →</div></div>}
              {m.card?.type === "added" && <div style={{ marginTop: 10, background: "#edfaf3", borderRadius: 8, padding: "10px 12px", display: "flex", alignItems: "center", gap: 10 }}><Icon name="check" size={16} color="#27ae60" /><div style={{ fontSize: 13, fontWeight: 600, color: "#27ae60" }}>{m.card.count} item{m.card.count !== 1 ? "s" : ""} added to {m.card.invoiceId}</div></div>}
              {m.card?.type === "saved_item" && <div style={{ marginTop: 10, background: "#edf4ff", borderRadius: 8, padding: "10px 12px", display: "flex", alignItems: "center", gap: 10, border: "1.5px solid #c0d8ff" }}><Icon name="items" size={15} color="#2980b9" /><div><div style={{ fontSize: 13, fontWeight: 700, color: "#2980b9" }}>{m.card.item?.name}</div><div style={{ fontSize: 12, color: "#555" }}>{fmt(m.card.item?.price)} saved to My Items</div></div></div>}
              {m.card?.type === "confirm_email" && <div style={{ marginTop: 10, background: "#f4f6fa", borderRadius: 8, padding: 12 }}><div style={{ fontSize: 13, fontWeight: 600, marginBottom: 2 }}>{m.card.invoiceId} · {fmt(m.card.total)}</div><div style={{ fontSize: 12, color: "#666", marginBottom: 10 }}>Send to: {m.card.email}</div><div style={{ display: "flex", gap: 8 }}><button onClick={() => setMsgs(p => p.map((x, j) => j === i ? { ...x, card: { ...x.card, type: "email_cancelled" } } : x))} style={{ ...S.btn("ghost"), flex: 1, fontSize: 12, padding: "7px 0" }}>Cancel</button><button onClick={() => confirmEmail(i)} style={{ ...S.btn("navy"), flex: 2, fontSize: 12, padding: "7px 0", display: "flex", alignItems: "center", justifyContent: "center", gap: 5 }}><Icon name="mail" size={13} color="#fff" /> Confirm Send</button></div></div>}
              {m.card?.type === "email_sending" && <div style={{ marginTop: 10, background: "#f4f6fa", borderRadius: 8, padding: "10px 12px", display: "flex", alignItems: "center", gap: 8 }}>{[0,1,2].map(k => <span key={k} style={{ width: 7, height: 7, borderRadius: "50%", background: ORANGE, display: "inline-block", animation: `bounce 1s ${k*0.18}s infinite` }}/>)}<span style={{ fontSize: 12, color: "#888", marginLeft: 4 }}>Sending…</span></div>}
              {m.card?.type === "email_sent" && <div style={{ marginTop: 10, background: "#edfaf3", borderRadius: 8, padding: "10px 12px", display: "flex", alignItems: "center", gap: 8 }}><Icon name="check" size={15} color="#27ae60" /><span style={{ fontSize: 12, fontWeight: 600, color: "#27ae60" }}>Sent!</span></div>}
              {m.card?.type === "email_cancelled" && <div style={{ marginTop: 10, background: "#f4f6fa", borderRadius: 8, padding: "10px 12px" }}><span style={{ fontSize: 12, color: "#aaa" }}>Email cancelled</span></div>}
              {m.card?.type === "email_failed" && <div style={{ marginTop: 10, background: "#fff0ee", borderRadius: 8, padding: "10px 12px" }}><span style={{ fontSize: 12, color: "#cc4444" }}>Failed: {m.card.error}</span></div>}
            </div>
          </div>
        ))}
        {loading && <div style={{ display: "flex", marginBottom: 12 }}><div style={{ background: "#fff", borderRadius: "16px 16px 16px 4px", padding: "12px 16px", boxShadow: "0 1px 4px rgba(0,0,0,0.08)", display: "flex", gap: 5 }}>{[0,1,2].map(k => <span key={k} style={{ width: 8, height: 8, borderRadius: "50%", background: ORANGE, display: "inline-block", animation: `bounce 1s ${k*0.18}s infinite` }}/>)}</div></div>}
        <div ref={endRef} style={{ height: 14 }} />
      </div>
      <div style={{ background: "#fff", borderTop: "1px solid #dde2ee", padding: "10px 12px", display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
        <button onClick={startListening} style={{ width: 40, height: 40, borderRadius: 8, border: "none", background: listening ? ORANGE : "#f0f2f8", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><Icon name="mic" size={18} color={listening ? "#fff" : "#666"} /></button>
        <input style={{ flex: 1, border: "1.5px solid #dde2ee", borderRadius: 8, padding: "9px 12px", fontSize: 13, fontFamily: "'Barlow', sans-serif", outline: "none", background: "#f8f9fc" }} value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === "Enter" && send()} placeholder={listening ? "Listening…" : "Create invoice, add items, send email…"} />
        <button onClick={send} style={{ width: 40, height: 40, borderRadius: 8, border: "none", background: NAVY, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><Icon name="send" size={17} color="#fff" /></button>
      </div>
    </div>
  );
}

// ─── Item Modal ───────────────────────────────────────────────────────────────
function ItemModal({ item, onSave, onClose, onDelete, onSaveToLibrary }) {
  const [form, setForm] = useState({ name: "", desc: "", qty: 1, price: 0, unit: "ea", discount: 0, discountType: "%", taxable: true, ...item });
  const [saveToItems, setSaveToItems] = useState(false);
  const [improving, setImproving] = useState(false);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const aiImprove = async () => {
    const target = form.name || form.desc;
    if (!target.trim()) return;
    setImproving(true);
    try {
      const reply = await callAI([{ role: "user", content: `Rewrite this plumbing invoice item name as a professional, concise title (6 words max). Return ONLY the rewritten text, no quotes.\n\nOriginal: ${target}` }]);
      set("name", reply.trim().replace(/^["']|["']$/g, ""));
    } catch {}
    setImproving(false);
  };

  const handleDone = () => {
    if (saveToItems && onSaveToLibrary && form.name) {
      onSaveToLibrary({ name: form.name, category: "Custom", price: form.price });
    }
    onSave(form);
    onClose();
  };

  const lineTotal = calcItemTotal(form);

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 500, display: "flex", alignItems: "flex-end" }}>
      <div style={{ background: "#fff", width: "100%", borderRadius: "18px 18px 0 0", padding: "22px 20px 32px", maxWidth: 480, margin: "0 auto", maxHeight: "90vh", overflowY: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
          <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 20, color: NAVY }}>Edit Item</span>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "#bbb", cursor: "pointer", fontSize: 28, lineHeight: 1, padding: "0 4px" }}>×</button>
        </div>

        {/* Name + AI Improve */}
        <div style={{ marginBottom: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 5 }}>
            <label style={S.label}>Item Name</label>
            <button onClick={aiImprove} disabled={improving} style={{ display: "flex", alignItems: "center", gap: 5, background: improving ? "#f4f6fa" : NAVY, color: improving ? "#aaa" : "#fff", border: "none", borderRadius: 6, padding: "4px 10px", fontSize: 11, fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, letterSpacing: 0.8, cursor: improving ? "default" : "pointer" }}>
              <Icon name="ai" size={12} color={improving ? "#aaa" : "#fff"} />{improving ? "Improving…" : "AI Improve"}
            </button>
          </div>
          <input style={{ ...S.input, fontWeight: 600 }} value={form.name} onChange={e => set("name", e.target.value)} placeholder="e.g. Drain Clean – Snake" autoFocus />
        </div>

        {/* Description */}
        <div style={{ marginBottom: 12 }}>
          <label style={S.label}>Description <span style={{ fontWeight: 400, color: "#aaa", textTransform: "none", letterSpacing: 0 }}>(optional)</span></label>
          <textarea style={{ ...S.input, height: 64, resize: "none", color: "#555" }} value={form.desc} onChange={e => set("desc", e.target.value)} placeholder="Notes about the work done…" />
        </div>

        {/* Qty / Unit / Price */}
        <div style={{ display: "grid", gridTemplateColumns: "72px 100px 1fr", gap: 10, marginBottom: 12 }}>
          <div>
            <label style={S.label}>Qty</label>
            <input type="number" style={S.input} value={form.qty} onChange={e => set("qty", parseFloat(e.target.value) || 1)} min={1} />
          </div>
          <div>
            <label style={S.label}>Unit</label>
            <select style={S.input} value={form.unit || "ea"} onChange={e => set("unit", e.target.value)}>
              {["ea", "hrs", "days", "flat rate"].map(u => <option key={u} value={u}>{u}</option>)}
            </select>
          </div>
          <div>
            <label style={S.label}>Unit Price</label>
            <input type="number" style={S.input} value={form.price} onChange={e => set("price", parseFloat(e.target.value) || 0)} step={0.01} />
          </div>
        </div>

        {/* Discount */}
        <div style={{ marginBottom: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 5 }}>
            <label style={S.label}>Discount</label>
            <div style={{ display: "flex", background: "#f0f2f8", borderRadius: 6, padding: 2, gap: 2 }}>
              {["%", "$"].map(type => (
                <button key={type} onClick={() => set("discountType", type)} style={{ padding: "3px 12px", borderRadius: 4, border: "none", background: form.discountType === type ? "#fff" : "transparent", fontWeight: 700, fontSize: 13, cursor: "pointer", color: form.discountType === type ? NAVY : "#aaa", boxShadow: form.discountType === type ? "0 1px 3px rgba(0,0,0,0.1)" : "none" }}>{type}</button>
              ))}
            </div>
          </div>
          <input type="number" style={S.input} value={form.discount || 0} onChange={e => set("discount", parseFloat(e.target.value) || 0)} min={0} placeholder="0" />
        </div>

        {/* Line Total */}
        <div style={{ background: "#f8f9fc", borderRadius: 8, padding: "10px 14px", display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <span style={{ fontSize: 13, color: "#888" }}>Line Total</span>
          <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 18, color: ORANGE }}>{fmt(lineTotal)}</span>
        </div>

        {/* Taxable toggle */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderTop: "1px solid #f0f2f8" }}>
          <span style={{ fontSize: 14, color: "#444", fontWeight: 500 }}>Taxable (GET)</span>
          <div onClick={() => set("taxable", !form.taxable)} style={{ width: 44, height: 24, borderRadius: 12, background: form.taxable ? ORANGE : "#dde2ee", cursor: "pointer", position: "relative", transition: "background 0.2s" }}>
            <div style={{ position: "absolute", top: 3, left: form.taxable ? 23 : 3, width: 18, height: 18, borderRadius: "50%", background: "#fff", boxShadow: "0 1px 3px rgba(0,0,0,0.2)", transition: "left 0.2s" }} />
          </div>
        </div>

        {/* Save to My Items toggle */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderTop: "1px solid #f0f2f8", marginBottom: 16 }}>
          <div>
            <span style={{ fontSize: 14, color: "#444", fontWeight: 500 }}>Save to My Items</span>
            <div style={{ fontSize: 11, color: "#aaa", marginTop: 1 }}>Add to saved items library</div>
          </div>
          <div onClick={() => setSaveToItems(!saveToItems)} style={{ width: 44, height: 24, borderRadius: 12, background: saveToItems ? ORANGE : "#dde2ee", cursor: "pointer", position: "relative", transition: "background 0.2s" }}>
            <div style={{ position: "absolute", top: 3, left: saveToItems ? 23 : 3, width: 18, height: 18, borderRadius: "50%", background: "#fff", boxShadow: "0 1px 3px rgba(0,0,0,0.2)", transition: "left 0.2s" }} />
          </div>
        </div>

        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={onDelete} style={{ width: 44, height: 44, background: "#fff0ee", border: "1.5px solid #ffd5cc", borderRadius: 8, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><Icon name="trash" size={17} color="#cc4444" /></button>
          <button onClick={onClose} style={{ ...S.btn("ghost"), flex: 1 }}>Cancel</button>
          <button onClick={handleDone} style={{ ...S.btn("primary"), flex: 2 }}>Done</button>
        </div>
      </div>
    </div>
  );
}

// ─── PDF Preview ──────────────────────────────────────────────────────────────
function PDFPreview({ form, clients }) {
  const t = calcTotals(form);
  const client = clients.find(c => c.name === form.client) || {};
  const addr = [client.address1 || client.address, client.address2, client.address3].filter(Boolean).join(", ");
  const isEstimate = form.type === "estimate";

  return (
    <div style={{ padding: "16px 12px 40px" }}>
      <div style={{ background: "#fff", borderRadius: 12, overflow: "hidden", boxShadow: "0 4px 24px rgba(0,0,0,0.12)", maxWidth: 440, margin: "0 auto" }}>
        <div style={{ background: NAVY, padding: "20px 24px", display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <div style={{ color: "#fff", fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 21, letterSpacing: 1.5, lineHeight: 1.1 }}>HI GRADE PLUMBING</div>
            <div style={{ color: ORANGE, fontSize: 10, letterSpacing: 2.5, fontWeight: 700, marginTop: 2, fontFamily: "'Barlow Condensed', sans-serif" }}>LLC · HONOLULU, HI</div>
            <div style={{ color: "#6677aa", fontSize: 11, marginTop: 6 }}>License #C-39547</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ color: ORANGE, fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 26, letterSpacing: 1, lineHeight: 1 }}>{isEstimate ? "ESTIMATE" : "INVOICE"}</div>
            <div style={{ color: "#fff", fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 17, marginTop: 4 }}>{form.id || "DRAFT"}</div>
          </div>
        </div>
        <div style={{ background: NAVY2, padding: "10px 24px", display: "flex", alignItems: "center", gap: 28 }}>
          {[["Date", form.date], ["Due", form.dueDate]].map(([label, val]) => (
            <div key={label}>
              <div style={{ color: "#6677aa", fontSize: 9, fontWeight: 700, letterSpacing: 1.5, textTransform: "uppercase", fontFamily: "'Barlow Condensed', sans-serif" }}>{label}</div>
              <div style={{ color: "#dde2ee", fontSize: 13, fontWeight: 600 }}>{fmtDate(val)}</div>
            </div>
          ))}
          <div style={{ marginLeft: "auto" }}><span style={S.pill(form.status === "paid" ? "#4ecb71" : ORANGE)}>{form.status || "outstanding"}</span></div>
        </div>
        <div style={{ padding: "16px 24px 14px", borderBottom: "1px solid #f0f2f8" }}>
          <div style={{ fontSize: 9, fontWeight: 700, color: "#6677aa", letterSpacing: 2, textTransform: "uppercase", fontFamily: "'Barlow Condensed', sans-serif", marginBottom: 7 }}>Bill To</div>
          {form.client ? (
            <>
              <div style={{ fontWeight: 700, fontSize: 15, color: "#111", marginBottom: 3 }}>{form.client}</div>
              {addr && <div style={{ fontSize: 13, color: "#555", lineHeight: 1.5 }}>{addr}</div>}
              <div style={{ display: "flex", gap: 16, marginTop: 4, flexWrap: "wrap" }}>
                {client.phone && <div style={{ fontSize: 12, color: "#777" }}>{client.phone}</div>}
                {client.email && <div style={{ fontSize: 12, color: "#999" }}>{client.email}</div>}
              </div>
            </>
          ) : (
            <div style={{ fontSize: 13, color: "#bbb", fontStyle: "italic" }}>No client selected</div>
          )}
        </div>
        <div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 36px 84px", background: "#f8f9fc", padding: "7px 24px", borderBottom: "1px solid #eaecf0" }}>
            {[["Description", "left"], ["Qty", "center"], ["Amount", "right"]].map(([h, align]) => (
              <div key={h} style={{ fontSize: 9, fontWeight: 700, color: "#6677aa", letterSpacing: 1.5, textTransform: "uppercase", fontFamily: "'Barlow Condensed', sans-serif", textAlign: align }}>{h}</div>
            ))}
          </div>
          {form.items.map((item, i) => (
            <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 36px 84px", padding: "11px 24px", borderBottom: "1px solid #f4f6fa" }}>
              <div style={{ paddingRight: 8 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: "#222" }}>{item.name || item.desc || <span style={{ color: "#ccc" }}>—</span>}</div>
                {item.name && item.desc && <div style={{ fontSize: 11, color: "#999", marginTop: 2, lineHeight: 1.4 }}>{item.desc.split("\n").slice(0, 3).join(" · ")}</div>}
                {item.discount > 0 && <div style={{ fontSize: 11, color: "#e74c3c", marginTop: 2 }}>Discount: {item.discountType === "%" ? `${item.discount}%` : fmt(item.discount)}</div>}
              </div>
              <div style={{ fontSize: 13, color: "#666", textAlign: "center" }}>{item.qty}</div>
              <div style={{ fontSize: 13, fontWeight: 600, color: "#222", textAlign: "right" }}>{fmt(calcItemTotal(item))}</div>
            </div>
          ))}
        </div>
        <div style={{ padding: "14px 24px 16px", background: "#f8f9fc", borderTop: "1px solid #eaecf0" }}>
          {[["Subtotal", fmt(t.sub)], ...(t.disc > 0 ? [["Discount", "−" + fmt(t.disc)]] : []), [`GET (${form.tax}%)`, fmt(t.taxAmt)]].map(([label, val]) => (
            <div key={label} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "#666", marginBottom: 6 }}><span>{label}</span><span>{val}</span></div>
          ))}
          <div style={{ display: "flex", justifyContent: "space-between", borderTop: "2px solid #dde2ee", paddingTop: 10, marginTop: 6 }}>
            <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 16, color: "#111" }}>TOTAL DUE</span>
            <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 21, color: ORANGE }}>{fmt(t.total)}</span>
          </div>
          {t.paid > 0 && (
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8, paddingTop: 8, borderTop: "1px solid #eee" }}>
              <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 14, color: "#27ae60" }}>BALANCE DUE</span>
              <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 17, color: "#27ae60" }}>{fmt(Math.max(0, t.balance))}</span>
            </div>
          )}
        </div>
        {form.notes && (
          <div style={{ padding: "13px 24px", borderTop: "1px solid #f0f2f8" }}>
            <div style={{ fontSize: 9, fontWeight: 700, color: "#6677aa", letterSpacing: 1.5, textTransform: "uppercase", fontFamily: "'Barlow Condensed', sans-serif", marginBottom: 6 }}>Notes</div>
            <div style={{ fontSize: 12, color: "#555", lineHeight: 1.65, whiteSpace: "pre-wrap" }}>{form.notes}</div>
          </div>
        )}
        <div style={{ background: NAVY, padding: "13px 24px", textAlign: "center" }}>
          <div style={{ color: "#8899bb", fontSize: 11 }}>Thank you for your business!</div>
          <div style={{ color: "#6677aa", fontSize: 10, marginTop: 3 }}>higradeplumbing.com · (808) 393-0015</div>
        </div>
      </div>
    </div>
  );
}

// ─── Invoice Form ─────────────────────────────────────────────────────────────
function InvoiceForm({ invoice, defaultType, clients, savedItems, gcalAuthed, onSave, onCancel, onDelete, onSaveItem }) {
  const blankItem = { name: "", desc: "", qty: 1, price: 0, unit: "ea", discount: 0, discountType: "%", taxable: true };
  const [form, setForm] = useState(invoice || { type: defaultType || "invoice", client: "", date: today(), dueDate: today(), status: "outstanding", items: [{ ...blankItem }], tax: TAX_RATE, discount: 0, notes: "", payments: [] });
  const [activeTab, setActiveTab] = useState("edit");
  const [showSaved, setShowSaved] = useState(false);
  const [showAI, setShowAI] = useState(false);
  const [showPayment, setShowPayment] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [reordering, setReordering] = useState(false);
  const [dragIdx, setDragIdx] = useState(null);
  const [emailStatus, setEmailStatus] = useState("");
  const [showScheduleJob, setShowScheduleJob] = useState(false);
  const [showFollowUp, setShowFollowUp] = useState(false);

  const t = calcTotals(form);
  const isEstimate = form.type === "estimate";
  const setField = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const updateItem = (i, updated) => setForm(f => ({ ...f, items: f.items.map((it, j) => j === i ? updated : it) }));
  const addItem = (name = "", price = 0) => setForm(f => ({ ...f, items: [...f.items, { ...blankItem, name, price }] }));
  const removeItem = (i) => setForm(f => ({ ...f, items: f.items.filter((_, j) => j !== i) }));
  const moveItem = (from, to) => setForm(f => { const items = [...f.items]; const [moved] = items.splice(from, 1); items.splice(to, 0, moved); return { ...f, items }; });

  const handleAddFromAI = (items, notes) => {
    setForm(f => ({ ...f, items: [...f.items.filter(it => it.name || it.desc || it.price), ...items.map(it => ({ ...blankItem, name: it.name || it.desc || "", desc: it.name ? it.desc || "" : "", qty: it.qty, price: it.price }))], notes: notes ? (f.notes ? f.notes + "\n" + notes : notes) : f.notes }));
    setShowAI(false);
  };

  const selectedClient = clients.find(c => c.name === form.client);
  const categories = [...new Set(savedItems.map(i => i.category))];

  const handleEmail = async () => {
    const client = clients.find(c => c.name === form.client);
    if (!client?.email) { alert("No email on file for this client."); return; }
    setEmailStatus("Sending…");
    try {
      const result = await sendInvoiceEmail(form, client);
      setEmailStatus(result.error ? "Failed" : "✓ Sent!");
    } catch { setEmailStatus("Failed"); }
    setTimeout(() => setEmailStatus(""), 4000);
  };

  const historyEvents = [
    { date: form.date, label: isEstimate ? "Estimate created" : "Invoice created", type: "created", amount: null },
    ...(form.payments || []).map(p => ({ date: p.date, label: `${p.method} payment received`, type: "payment", amount: p.amount })),
  ].sort((a, b) => (a.date < b.date ? 1 : -1));

  const TABS = [{ id: "edit", label: "Edit", icon: "pencil" }, { id: "preview", label: "Preview", icon: "eye" }, { id: "history", label: "History", icon: "clock" }];

  return (
    <div style={{ paddingBottom: 100, background: LIGHT, minHeight: "100vh" }}>
      {showPayment && <PaymentModal invoice={form} onClose={() => setShowPayment(false)} onSave={(updated) => setForm(updated)} />}
      {showScheduleJob && <ScheduleJobModal invoice={form} gcalAuthed={gcalAuthed} onClose={() => setShowScheduleJob(false)} onSave={fields => setForm(f => ({ ...f, ...fields }))} />}
      {showFollowUp && <FollowUpModal invoice={form} gcalAuthed={gcalAuthed} onClose={() => setShowFollowUp(false)} onSave={fields => setForm(f => ({ ...f, ...fields }))} />}
      {editingItem !== null && (
        <ItemModal
          item={form.items[editingItem]}
          onSave={(updated) => updateItem(editingItem, updated)}
          onClose={() => setEditingItem(null)}
          onDelete={() => { removeItem(editingItem); setEditingItem(null); }}
          onSaveToLibrary={onSaveItem}
        />
      )}

      <div style={{ background: NAVY, padding: "14px 16px", display: "flex", alignItems: "center", gap: 12, position: "sticky", top: 0, zIndex: 100, boxShadow: "0 2px 12px rgba(0,0,0,0.3)" }}>
        <button onClick={onCancel} style={{ background: "none", border: "none", color: "#fff", cursor: "pointer", padding: 4 }}><Icon name="back" size={22} color="#fff" /></button>
        <span style={{ color: "#fff", fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 18, letterSpacing: 1, flex: 1 }}>{invoice ? invoice.id : isEstimate ? "New Estimate" : "New Invoice"}</span>
        {invoice && onDelete && <button onClick={() => { if (confirm("Delete this?")) onDelete(invoice.id); }} style={{ background: "none", border: "none", cursor: "pointer", padding: 4 }}><Icon name="trash" size={20} color="#cc4444" /></button>}
        <button onClick={() => onSave(form)} style={S.btn("primary")}>Save</button>
      </div>

      <div style={{ display: "flex", background: "#fff", borderBottom: "2px solid #eaecf0", position: "sticky", top: 54, zIndex: 90 }}>
        {TABS.map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)} style={{ flex: 1, padding: "10px 4px 9px", background: "none", border: "none", borderBottom: activeTab === tab.id ? `3px solid ${ORANGE}` : "3px solid transparent", color: activeTab === tab.id ? ORANGE : "#999", fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 12, letterSpacing: 1, textTransform: "uppercase", cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
            <Icon name={tab.icon} size={15} color={activeTab === tab.id ? ORANGE : "#bbb"} />{tab.label}
          </button>
        ))}
      </div>

      {activeTab === "edit" && (
        <div>
          {/* Bill To */}
          <div style={{ padding: "16px 16px 0" }}>
            <label style={S.label}>Bill To</label>
            <select style={S.input} value={form.client} onChange={e => setField("client", e.target.value)}>
              <option value="">Select client…</option>
              {clients.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
            </select>
            {selectedClient && (
              <div style={{ background: "#fff", borderRadius: 8, padding: "10px 13px", marginTop: 8, border: "1px solid #e8ecf4" }}>
                {(selectedClient.address1 || selectedClient.address) && <div style={{ fontSize: 13, color: "#444", marginBottom: 3 }}>{selectedClient.address1 || selectedClient.address}{selectedClient.address2 ? ", " + selectedClient.address2 : ""}</div>}
                <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
                  {selectedClient.phone && <span style={{ fontSize: 12, color: "#777" }}>{selectedClient.phone}</span>}
                  {selectedClient.email && <span style={{ fontSize: 12, color: "#999" }}>{selectedClient.email}</span>}
                </div>
              </div>
            )}
          </div>

          {/* Dates */}
          <div style={{ padding: "12px 16px 0", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div><label style={S.label}>Invoice Date</label><input type="date" style={S.input} value={form.date} onChange={e => setField("date", e.target.value)} /></div>
            <div><label style={S.label}>Due Date</label><input type="date" style={S.input} value={form.dueDate} onChange={e => setField("dueDate", e.target.value)} /></div>
          </div>

          {/* Line Items */}
          <div style={{ padding: "16px 16px 0" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: "#6677aa", letterSpacing: 1, textTransform: "uppercase", fontFamily: "'Barlow Condensed', sans-serif" }}>Line Items</span>
              <div style={{ display: "flex", gap: 6 }}>
                <button onClick={() => { setReordering(!reordering); setShowAI(false); setShowSaved(false); }} style={{ ...S.btn(reordering ? "primary" : "ghost"), fontSize: 11, padding: "5px 9px", display: "flex", alignItems: "center", gap: 4 }}>
                  <Icon name="grip" size={12} color={reordering ? "#fff" : "#444"} />{reordering ? "Done" : "Reorder"}
                </button>
                {!reordering && <>
                  <button onClick={() => { setShowAI(!showAI); setShowSaved(false); }} style={{ ...S.btn(showAI ? "primary" : "ghost"), fontSize: 12, padding: "6px 10px", display: "flex", alignItems: "center", gap: 5 }}><Icon name="ai" size={13} color={showAI ? "#fff" : "#444"} /> AI</button>
                  <button onClick={() => { setShowSaved(!showSaved); setShowAI(false); }} style={{ ...S.btn(showSaved ? "navy" : "ghost"), fontSize: 12, padding: "6px 12px" }}>Saved</button>
                  <button onClick={() => addItem()} style={{ ...S.btn("primary"), padding: "6px 10px" }}><Icon name="plus" size={16} color="#fff" /></button>
                </>}
              </div>
            </div>

            {showAI && <div style={{ marginBottom: 12 }}><AIChatPanel onAddItems={handleAddFromAI} /></div>}

            {showSaved && (
              <div style={{ background: "#fff", borderRadius: 10, marginBottom: 12, overflow: "hidden", boxShadow: "0 2px 8px rgba(0,0,0,0.08)", maxHeight: 280, overflowY: "auto" }}>
                {categories.map(cat => (
                  <div key={cat}>
                    <div style={{ background: "#f4f6fa", padding: "6px 14px", fontSize: 11, fontWeight: 700, color: ORANGE, letterSpacing: 1, textTransform: "uppercase", fontFamily: "'Barlow Condensed', sans-serif" }}>{cat}</div>
                    {savedItems.filter(i => i.category === cat).map(item => (
                      <div key={item.id} onClick={() => { addItem(item.name, item.price); setShowSaved(false); }} style={{ padding: "10px 14px", display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid #f0f2f8", cursor: "pointer" }}>
                        <span style={{ fontSize: 14 }}>{item.name}</span>
                        <span style={{ color: ORANGE, fontWeight: 700, fontSize: 14 }}>{fmt(item.price)}</span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}

            {/* Item rows */}
            {form.items.map((item, i) => {
              const descPreview = item.desc?.replace(/\n/g, " · ") || "";
              return (
                <div
                  key={i}
                  onClick={() => !reordering && setEditingItem(i)}
                  draggable={reordering}
                  onDragStart={() => setDragIdx(i)}
                  onDragOver={e => e.preventDefault()}
                  onDrop={() => { if (dragIdx !== null && dragIdx !== i) { moveItem(dragIdx, i); setDragIdx(null); } }}
                  style={{ background: "#fff", borderRadius: 10, padding: "11px 12px", marginBottom: 8, boxShadow: "0 1px 4px rgba(0,0,0,0.06)", cursor: reordering ? "grab" : "pointer", display: "flex", alignItems: "center", gap: 8, opacity: dragIdx === i ? 0.5 : 1 }}
                >
                  {reordering && <Icon name="grip" size={16} color="#ccc" />}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: (item.name || item.desc) ? "#1a1a1a" : "#bbb", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {item.name || item.desc || "Tap to add item…"}
                    </div>
                    {descPreview && (
                      <div style={{ fontSize: 12, color: "#888", marginTop: 2, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden", lineHeight: 1.4 }}>{descPreview}</div>
                    )}
                    <div style={{ fontSize: 12, color: "#aaa", marginTop: 3, display: "flex", alignItems: "center", gap: 6 }}>
                      <span>{item.qty > 1 ? `${item.qty} × ${fmt(item.price)}` : `${fmt(item.price)}${item.unit && item.unit !== "ea" ? " / " + item.unit : ""}`}</span>
                      {item.discount > 0 && <span style={{ color: "#e74c3c", fontSize: 11 }}>{item.discountType === "%" ? `−${item.discount}%` : `−${fmt(item.discount)}`}</span>}
                    </div>
                  </div>
                  {reordering ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                      <button onClick={e => { e.stopPropagation(); i > 0 && moveItem(i, i - 1); }} style={{ width: 28, height: 28, background: i > 0 ? "#f0f2f8" : "#f8f9fc", border: "none", borderRadius: 6, cursor: i > 0 ? "pointer" : "default", display: "flex", alignItems: "center", justifyContent: "center" }}><Icon name="arrowUp" size={14} color={i > 0 ? "#555" : "#ddd"} /></button>
                      <button onClick={e => { e.stopPropagation(); i < form.items.length - 1 && moveItem(i, i + 1); }} style={{ width: 28, height: 28, background: i < form.items.length - 1 ? "#f0f2f8" : "#f8f9fc", border: "none", borderRadius: 6, cursor: i < form.items.length - 1 ? "pointer" : "default", display: "flex", alignItems: "center", justifyContent: "center" }}><Icon name="arrowDown" size={14} color={i < form.items.length - 1 ? "#555" : "#ddd"} /></button>
                    </div>
                  ) : (
                    <>
                      <div style={{ flexShrink: 0, textAlign: "right" }}>
                        <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 16, color: NAVY }}>{fmt(calcItemTotal(item))}</div>
                      </div>
                      <Icon name="chevron" size={16} color="#ccc" />
                    </>
                  )}
                </div>
              );
            })}
          </div>

          {/* Tax & Discount */}
          <div style={{ padding: "4px 16px 0", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div><label style={S.label}>Tax %</label><input type="number" style={S.input} value={form.tax} onChange={e => setField("tax", parseFloat(e.target.value) || 0)} step={0.001} /></div>
            <div><label style={S.label}>Discount $</label><input type="number" style={S.input} value={form.discount} onChange={e => setField("discount", parseFloat(e.target.value) || 0)} min={0} /></div>
          </div>

          {/* Notes */}
          <div style={{ padding: "12px 16px 0" }}>
            <label style={S.label}>Notes</label>
            <textarea style={{ ...S.input, height: 72, resize: "none" }} value={form.notes} onChange={e => setField("notes", e.target.value)} placeholder="Job notes, payment instructions…" />
          </div>

          {/* Schedule & Reminders */}
          <div style={{ padding: "12px 16px 0" }}>
            <label style={S.label}>Schedule &amp; Reminders</label>
            <div style={{ background: "#fff", borderRadius: 10, overflow: "hidden", boxShadow: "0 1px 4px rgba(0,0,0,0.06)" }}>
              <div style={{ padding: "12px 14px", borderBottom: "1px solid #f0f2f8", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <Icon name="calendar" size={16} color={form.gcalDate ? ORANGE : "#ccc"} />
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 500, color: "#333" }}>Schedule Job</div>
                    {form.gcalDate && <div style={{ fontSize: 12, color: ORANGE, marginTop: 1 }}>{fmtDate(form.gcalDate.slice(0, 10))} {form.gcalDate.slice(11, 16)}</div>}
                  </div>
                </div>
                <button onClick={() => setShowScheduleJob(true)} style={{ ...S.btn(form.gcalDate ? "primary" : "ghost"), fontSize: 12, padding: "6px 12px" }}>{form.gcalDate ? "Edit" : "Set Date"}</button>
              </div>
              <div style={{ padding: "12px 14px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <Icon name="bell" size={16} color={form.followUpDate ? "#2980b9" : "#ccc"} />
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 500, color: "#333" }}>Follow-Up Reminder</div>
                    {form.followUpDate && <div style={{ fontSize: 12, color: "#2980b9", marginTop: 1 }}>{fmtDate(form.followUpDate)}</div>}
                  </div>
                </div>
                <button onClick={() => setShowFollowUp(true)} style={{ ...S.btn(form.followUpDate ? "navy" : "ghost"), fontSize: 12, padding: "6px 12px" }}>{form.followUpDate ? "Edit" : "Remind"}</button>
              </div>
            </div>
          </div>

          {/* Status */}
          <div style={{ padding: "12px 16px 0" }}>
            <label style={S.label}>Status</label>
            <div style={{ display: "flex", gap: 8 }}>
              {["outstanding", "paid"].map(s => <button key={s} onClick={() => setField("status", s)} style={{ ...S.btn(form.status === s ? "primary" : "ghost"), flex: 1, fontSize: 13 }}>{s.charAt(0).toUpperCase() + s.slice(1)}</button>)}
            </div>
          </div>

          {/* Totals */}
          <div style={{ margin: "16px 16px 0", background: "#fff", borderRadius: 12, padding: 16, boxShadow: "0 1px 6px rgba(0,0,0,0.07)" }}>
            {[["Subtotal", fmt(t.sub)], ...(t.disc > 0 ? [["Discount", "−" + fmt(t.disc)]] : []), ["GET (" + form.tax + "%)", fmt(t.taxAmt)]].map(([label, val]) => (
              <div key={label} style={{ display: "flex", justifyContent: "space-between", marginBottom: 6, fontSize: 14, color: "#666" }}><span>{label}</span><span>{val}</span></div>
            ))}
            <div style={{ display: "flex", justifyContent: "space-between", borderTop: "2px solid #eee", paddingTop: 10, marginTop: 4 }}>
              <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 18 }}>Total</span>
              <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 22, color: ORANGE }}>{fmt(t.total)}</span>
            </div>
            {(form.payments || []).length > 0 && (
              <div>
                <div style={{ marginTop: 10, borderTop: "1px solid #eee", paddingTop: 8 }}>
                  {form.payments.map((p, i) => <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "#27ae60", marginBottom: 3 }}><span>{p.method} · {p.date}</span><span>−{fmt(p.amount)}</span></div>)}
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8, borderTop: "2px solid #eee", paddingTop: 8 }}>
                  <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 16 }}>Balance Due</span>
                  <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 18, color: t.balance <= 0 ? "#27ae60" : ORANGE }}>{fmt(Math.max(0, t.balance))}</span>
                </div>
              </div>
            )}
          </div>

          {/* Actions */}
          <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
            <button onClick={() => onSave(form)} style={{ ...S.btn("primary"), fontSize: 16, padding: 14 }}>{isEstimate ? "Save Estimate" : "Save Invoice"}</button>
            <div style={{ display: "flex", gap: 10 }}>
              {!isEstimate && <button onClick={() => setShowPayment(true)} style={{ ...S.btn("green"), flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}><Icon name="payment" size={16} color="#fff" /> Record Payment</button>}
              <button onClick={handleEmail} style={{ ...S.btn("navy"), flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}><Icon name="mail" size={16} color="#fff" /> {emailStatus || "Send Email"}</button>
            </div>
          </div>
        </div>
      )}

      {activeTab === "preview" && <PDFPreview form={form} clients={clients} />}

      {activeTab === "history" && (
        <div style={{ padding: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: "#6677aa", letterSpacing: 1, textTransform: "uppercase", fontFamily: "'Barlow Condensed', sans-serif" }}>Activity Log</span>
            {!isEstimate && <button onClick={() => setShowPayment(true)} style={{ ...S.btn("green"), fontSize: 12, padding: "7px 14px", display: "flex", alignItems: "center", gap: 6 }}><Icon name="payment" size={14} color="#fff" /> Record Payment</button>}
          </div>
          <div style={{ position: "relative" }}>
            {historyEvents.length > 1 && <div style={{ position: "absolute", left: 17, top: 18, bottom: 18, width: 2, background: "#e8ecf4" }} />}
            {historyEvents.map((ev, i) => (
              <div key={i} style={{ display: "flex", gap: 14, marginBottom: 14, position: "relative" }}>
                <div style={{ width: 36, height: 36, borderRadius: "50%", flexShrink: 0, background: ev.type === "payment" ? "#e8f8ef" : "#eef0fa", border: `2px solid ${ev.type === "payment" ? "#27ae60" : "#8899bb"}`, display: "flex", alignItems: "center", justifyContent: "center", position: "relative", zIndex: 1 }}>
                  <Icon name={ev.type === "payment" ? "payment" : "invoice"} size={15} color={ev.type === "payment" ? "#27ae60" : "#8899bb"} />
                </div>
                <div style={{ flex: 1, background: "#fff", borderRadius: 10, padding: "11px 14px", boxShadow: "0 1px 4px rgba(0,0,0,0.06)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                    <div><div style={{ fontSize: 14, fontWeight: 600, color: "#1a1a1a", marginBottom: 2 }}>{ev.label}</div><div style={{ fontSize: 12, color: "#aaa" }}>{fmtDate(ev.date)}</div></div>
                    {ev.amount != null && <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 17, color: "#27ae60" }}>{fmt(ev.amount)}</div>}
                  </div>
                </div>
              </div>
            ))}
          </div>
          {(form.payments || []).length > 0 && (
            <div style={{ background: "#fff", borderRadius: 12, padding: "14px 16px", marginTop: 8, boxShadow: "0 1px 6px rgba(0,0,0,0.07)" }}>
              {[["Invoice Total", fmt(t.total), "#222"], ["Total Paid", fmt(t.paid), "#27ae60"], ["Balance Due", fmt(Math.max(0, t.balance)), t.balance <= 0 ? "#27ae60" : ORANGE]].map(([label, val, color]) => (
                <div key={label} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid #f4f6fa" }}>
                  <span style={{ fontSize: 13, color: "#777" }}>{label}</span>
                  <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 15, color }}>{val}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Invoice List ─────────────────────────────────────────────────────────────
function InvoiceList({ invoices, onNew, onSelect }) {
  const [tab, setTab] = useState("all");
  const filtered = invoices.filter(inv => tab === "all" ? true : inv.status === tab);
  const years = [...new Set(filtered.map(i => i.year || new Date(i.date).getFullYear()))].sort((a, b) => b - a);
  const yearTotal = yr => filtered.filter(i => (i.year || new Date(i.date).getFullYear()) === yr).reduce((s, i) => s + calcTotals(i).total, 0);
  const outstanding = invoices.filter(i => i.status === "outstanding").reduce((s, i) => s + calcTotals(i).balance, 0);
  const paidThisYear = invoices.filter(i => i.status === "paid" && (i.year === 2026 || i.date?.startsWith("2026"))).reduce((s, i) => s + calcTotals(i).total, 0);

  return (
    <div>
      <div style={{ background: NAVY2, padding: "12px 16px", display: "flex", justifyContent: "space-between" }}>
        <div><div style={{ color: "#8899bb", fontSize: 11, letterSpacing: 1, fontFamily: "'Barlow Condensed', sans-serif", textTransform: "uppercase" }}>Outstanding</div><div style={{ color: ORANGE, fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 20 }}>{fmt(outstanding)}</div></div>
        <div style={{ textAlign: "right" }}><div style={{ color: "#8899bb", fontSize: 11, letterSpacing: 1, fontFamily: "'Barlow Condensed', sans-serif", textTransform: "uppercase" }}>2026 Paid</div><div style={{ color: "#4ecb71", fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 20 }}>{fmt(paidThisYear)}</div></div>
      </div>
      <div style={{ display: "flex", background: "#fff", borderBottom: "1px solid #eee" }}>
        {["all", "outstanding", "paid"].map(t => (
          <button key={t} onClick={() => setTab(t)} style={{ flex: 1, padding: "10px 4px", background: "none", border: "none", borderBottom: tab === t ? `2px solid ${ORANGE}` : "2px solid transparent", color: tab === t ? ORANGE : "#888", fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 13, letterSpacing: 1, textTransform: "uppercase", cursor: "pointer" }}>{t}</button>
        ))}
      </div>
      <div style={{ padding: "12px 12px 0" }}>
        {years.map(yr => (
          <div key={yr}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 4px", marginBottom: 6 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: "#8899bb", letterSpacing: 1, fontFamily: "'Barlow Condensed', sans-serif", textTransform: "uppercase" }}>{yr}</span>
              <span style={{ fontSize: 13, fontWeight: 700, color: "#555" }}>{fmt(yearTotal(yr))}</span>
            </div>
            {filtered.filter(i => (i.year || new Date(i.date).getFullYear()) === yr).map(inv => {
              const t = calcTotals(inv);
              return (
                <div key={inv.id} onClick={() => onSelect(inv)} style={{ ...S.card, padding: "12px 14px", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div><div style={{ fontWeight: 700, fontSize: 15, marginBottom: 2 }}>{inv.client}</div><div style={{ fontSize: 12, color: "#888" }}>{inv.id} · {inv.date}</div></div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 17, color: inv.status === "paid" ? "#4ecb71" : ORANGE }}>{fmt(t.total)}</div>
                    <span style={S.pill(inv.status === "paid" ? "#4ecb71" : "#E8622A")}>{inv.status}</span>
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>
      <button onClick={onNew} style={{ position: "fixed", bottom: 158, right: 20, width: 52, height: 52, borderRadius: "50%", background: ORANGE, border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 4px 16px rgba(232,98,42,0.45)", zIndex: 150 }}>
        <Icon name="plus" size={24} color="#fff" />
      </button>
    </div>
  );
}

// ─── Estimates Tab ────────────────────────────────────────────────────────────
function EstimatesTab({ invoices, onNew, onSelect }) {
  return (
    <div>
      <div style={{ background: NAVY2, padding: "12px 16px" }}>
        <div style={{ color: "#8899bb", fontSize: 11, letterSpacing: 1, fontFamily: "'Barlow Condensed', sans-serif", textTransform: "uppercase" }}>Estimates</div>
        <div style={{ color: ORANGE, fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 20 }}>{invoices.length} total</div>
      </div>
      <div style={{ padding: "12px 12px 0" }}>
        {invoices.length === 0 ? (
          <div style={{ padding: "48px 24px", textAlign: "center" }}>
            <Icon name="estimates" size={48} color="#dde2ee" />
            <div style={{ fontSize: 16, fontWeight: 600, color: "#888", marginTop: 16, marginBottom: 8 }}>No Estimates Yet</div>
            <div style={{ fontSize: 13, color: "#aaa", marginBottom: 24 }}>Tap + to create your first estimate</div>
          </div>
        ) : invoices.map(inv => {
          const t = calcTotals(inv);
          return (
            <div key={inv.id} onClick={() => onSelect(inv)} style={{ ...S.card, padding: "12px 14px", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div><div style={{ fontWeight: 700, fontSize: 15, marginBottom: 2 }}>{inv.client || "No client"}</div><div style={{ fontSize: 12, color: "#888" }}>{inv.id} · {inv.date}</div></div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 17, color: ORANGE }}>{fmt(t.total)}</div>
                <span style={S.pill("#8899bb")}>estimate</span>
              </div>
            </div>
          );
        })}
      </div>
      <button onClick={onNew} style={{ position: "fixed", bottom: 158, right: 20, width: 52, height: 52, borderRadius: "50%", background: ORANGE, border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 4px 16px rgba(232,98,42,0.45)", zIndex: 150 }}>
        <Icon name="plus" size={24} color="#fff" />
      </button>
    </div>
  );
}

// ─── Clients Tab ──────────────────────────────────────────────────────────────
function ClientsTab({ clients, onSave }) {
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({});
  const startEdit = (c) => { setEditing(c?.id || "new"); setForm(c || { name: "", email: "", email2: "", phone: "", fax: "", address1: "", address2: "", address3: "" }); };
  const save = () => { onSave(form, editing); setEditing(null); };

  if (editing !== null) return (
    <div style={{ padding: 16, paddingBottom: 40 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
        <button onClick={() => setEditing(null)} style={{ background: "none", border: "none", cursor: "pointer" }}><Icon name="back" size={22} /></button>
        <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 20 }}>{editing === "new" ? "New Client" : "Edit Client"}</span>
      </div>
      {[["name", "Name"], ["email", "Email"], ["email2", "Secondary Email"], ["phone", "Phone"], ["fax", "Fax"]].map(([k, l]) => (
        <div key={k} style={{ marginBottom: 12 }}>
          <label style={S.label}>{l}</label>
          <input style={S.input} value={form[k] || ""} onChange={e => setForm(f => ({ ...f, [k]: e.target.value }))} type={k === "email" || k === "email2" ? "email" : "text"} />
        </div>
      ))}
      <div style={{ marginBottom: 4 }}><label style={S.label}>Address</label></div>
      {[["address1", "Address Line 1"], ["address2", "Address Line 2"], ["address3", "City, State, Zip"]].map(([k, ph]) => (
        <div key={k} style={{ marginBottom: 8 }}>
          <input style={S.input} value={form[k] || ""} onChange={e => setForm(f => ({ ...f, [k]: e.target.value }))} placeholder={ph} />
        </div>
      ))}
      <button onClick={save} style={{ ...S.btn("primary"), width: "100%", marginTop: 12, fontSize: 16, padding: 14 }}>Save Client</button>
      <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
        <button onClick={() => alert("Import from Contacts — coming soon")} style={{ ...S.btn("ghost"), flex: 1, fontSize: 13 }}>Import from Contacts</button>
        <button onClick={() => alert("Create Statement — coming soon")} style={{ ...S.btn("ghost"), flex: 1, fontSize: 13 }}>Create Statement</button>
      </div>
    </div>
  );

  return (
    <div style={{ padding: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, padding: "0 4px" }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: "#6677aa", letterSpacing: 2, textTransform: "uppercase", fontFamily: "'Barlow Condensed', sans-serif" }}>Clients ({clients.length})</span>
        <button onClick={() => startEdit(null)} style={{ ...S.btn("primary"), padding: "8px 14px", fontSize: 13 }}>+ Add</button>
      </div>
      {clients.map(c => (
        <div key={c.id} onClick={() => startEdit(c)} style={{ ...S.card, padding: "12px 14px", cursor: "pointer" }}>
          <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 2 }}>{c.name}</div>
          {c.phone && <div style={{ fontSize: 13, color: "#666" }}>{c.phone}</div>}
          {c.email && <div style={{ fontSize: 13, color: "#666" }}>{c.email}</div>}
        </div>
      ))}
    </div>
  );
}

// ─── Items Tab ────────────────────────────────────────────────────────────────
function ItemsTab({ savedItems }) {
  const categories = [...new Set(savedItems.map(i => i.category))];
  return (
    <div style={{ padding: 12 }}>
      <div style={{ padding: "0 4px", marginBottom: 12 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: "#6677aa", letterSpacing: 2, textTransform: "uppercase", fontFamily: "'Barlow Condensed', sans-serif" }}>Saved Items</span>
      </div>
      {categories.map(cat => (
        <div key={cat} style={{ marginBottom: 16 }}>
          <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 13, color: ORANGE, letterSpacing: 1.5, textTransform: "uppercase", padding: "0 4px", marginBottom: 6 }}>{cat}</div>
          {savedItems.filter(i => i.category === cat).map(item => (
            <div key={item.id} style={{ ...S.card, padding: "10px 14px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: 14 }}>{item.name}</span>
              <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 16, color: ORANGE }}>{fmt(item.price)}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

// ─── Payments Tab ─────────────────────────────────────────────────────────────
function PaymentsTab({ invoices }) {
  const methodInfo = (m) => ({ Cash: ["$", "#27ae60"], Check: ["✓", "#2980b9"], Venmo: ["V", "#3D95CE"], Zelle: ["Z", "#6B39A8"], PayPal: ["P", "#0070ba"], "Credit Card": ["CC", ORANGE], "Bank Transfer": ["B", "#16a085"] }[m] || ["•", "#888"]);

  const allPayments = [];
  invoices.forEach(inv => {
    (inv.payments || []).forEach(p => allPayments.push({ ...p, invoiceId: inv.id, client: inv.client }));
  });
  allPayments.sort((a, b) => (a.date < b.date ? 1 : -1));

  const totalPaid = allPayments.reduce((s, p) => s + p.amount, 0);

  return (
    <div>
      <div style={{ background: NAVY2, padding: "12px 16px" }}>
        <div style={{ color: "#8899bb", fontSize: 11, letterSpacing: 1, fontFamily: "'Barlow Condensed', sans-serif", textTransform: "uppercase" }}>Total Received</div>
        <div style={{ color: "#4ecb71", fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 20 }}>{fmt(totalPaid)}</div>
      </div>
      <div style={{ padding: "12px 12px 0" }}>
        {allPayments.length === 0 ? (
          <div style={{ padding: "48px 24px", textAlign: "center" }}>
            <Icon name="dollar" size={48} color="#dde2ee" />
            <div style={{ fontSize: 16, fontWeight: 600, color: "#888", marginTop: 16 }}>No Payments Yet</div>
            <div style={{ fontSize: 13, color: "#aaa", marginTop: 8 }}>Payments recorded on invoices will appear here</div>
          </div>
        ) : allPayments.map((p, i) => {
          const [char, color] = methodInfo(p.method);
          return (
            <div key={i} style={{ ...S.card, padding: "12px 14px", display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{ width: 42, height: 42, borderRadius: "50%", background: color + "18", border: `2px solid ${color}`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <span style={{ fontSize: 13, fontWeight: 800, color, fontFamily: "'Barlow Condensed', sans-serif" }}>{char}</span>
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 18, color: "#2980b9" }}>{fmt(p.amount)}</div>
                <div style={{ fontSize: 12, color: "#888", marginTop: 1 }}>{p.invoiceId} · {p.client}</div>
              </div>
              <div style={{ textAlign: "right", flexShrink: 0 }}>
                <div style={{ fontSize: 12, color: "#aaa" }}>{fmtDate(p.date)}</div>
                <div style={{ fontSize: 12, fontWeight: 600, color: "#666", marginTop: 2 }}>{p.method}</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Calendar Tab ─────────────────────────────────────────────────────────────
function CalendarTab({ invoices, gcalAuthed, onAuthChange }) {
  const [currentDate, setCurrentDate] = useState(() => { const d = new Date(); d.setDate(1); return d; });
  const [selectedDay, setSelectedDay] = useState(today());
  const [gcalEvents, setGcalEvents] = useState([]);
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [authError, setAuthError] = useState("");

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const monthStr = `${year}-${String(month + 1).padStart(2, "0")}`;

  useEffect(() => {
    if (!gcalAuthed || !GCal.isConfigured()) return;
    setLoadingEvents(true);
    const start = new Date(year, month, 1);
    const end = new Date(year, month + 1, 0, 23, 59, 59);
    GCal.listEvents(start, end)
      .then(evs => { setGcalEvents(evs); setLoadingEvents(false); })
      .catch(() => setLoadingEvents(false));
  }, [gcalAuthed, year, month]);

  const handleSignIn = async () => {
    setAuthError("");
    try { await GCal.requestToken('consent'); onAuthChange(true); }
    catch (e) { setAuthError(e.message || "Sign-in failed"); }
  };
  const handleSignOut = () => { GCal.signOut(); onAuthChange(false); setGcalEvents([]); };

  // Build event map by date
  const dayEvents = {};
  invoices.forEach(inv => {
    if (inv.gcalDate) {
      const d = inv.gcalDate.slice(0, 10);
      if (!dayEvents[d]) dayEvents[d] = [];
      dayEvents[d].push({ type: "job", label: inv.client || inv.id, invoiceId: inv.id, time: inv.gcalDate.slice(11, 16), color: ORANGE });
    }
    if (inv.followUpDate) {
      if (!dayEvents[inv.followUpDate]) dayEvents[inv.followUpDate] = [];
      dayEvents[inv.followUpDate].push({ type: "followup", label: `Follow-up: ${inv.id}`, invoiceId: inv.id, color: "#2980b9" });
    }
  });
  gcalEvents.forEach(ev => {
    const d = (ev.start?.dateTime || ev.start?.date || "").slice(0, 10);
    if (d) {
      if (!dayEvents[d]) dayEvents[d] = [];
      dayEvents[d].push({ type: "gcal", label: ev.summary || "Event", color: "#27ae60", time: ev.start?.dateTime ? new Date(ev.start.dateTime).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: GCal.TZ }) : "" });
    }
  });

  const firstDayOfMonth = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const DAYS = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
  const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];

  const cells = [];
  for (let i = 0; i < firstDayOfMonth; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  const prevMonth = () => setCurrentDate(d => { const n = new Date(d); n.setMonth(d.getMonth() - 1); return n; });
  const nextMonth = () => setCurrentDate(d => { const n = new Date(d); n.setMonth(d.getMonth() + 1); return n; });

  const selectedEvents = dayEvents[selectedDay] || [];

  return (
    <div style={{ paddingBottom: 20 }}>
      <div style={{ background: NAVY2, padding: "12px 16px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <div style={{ color: "#8899bb", fontSize: 11, letterSpacing: 1, fontFamily: "'Barlow Condensed', sans-serif", textTransform: "uppercase" }}>Calendar</div>
          <div style={{ color: ORANGE, fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 20 }}>{MONTHS[month]} {year}</div>
        </div>
        {GCal.isConfigured() && (gcalAuthed ? (
          <button onClick={handleSignOut} style={{ ...S.btn("ghost"), fontSize: 11, padding: "6px 10px" }}>Disconnect</button>
        ) : (
          <button onClick={handleSignIn} style={{ background: "#4285f4", color: "#fff", border: "none", borderRadius: 8, padding: "8px 12px", fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 12, cursor: "pointer", letterSpacing: 0.5 }}>+ Google Calendar</button>
        ))}
      </div>
      {authError && <div style={{ background: "#fff0ee", padding: "8px 16px", fontSize: 12, color: "#cc4444" }}>{authError}</div>}

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 16px 6px" }}>
        <button onClick={prevMonth} style={{ background: "none", border: "none", cursor: "pointer", padding: 6 }}><Icon name="back" size={18} /></button>
        <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 16, color: NAVY }}>{MONTHS[month]} {year}</span>
        <button onClick={nextMonth} style={{ background: "none", border: "none", cursor: "pointer", padding: 6, transform: "rotate(180deg)" }}><Icon name="back" size={18} /></button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", padding: "0 8px" }}>
        {DAYS.map(d => <div key={d} style={{ textAlign: "center", fontSize: 10, fontWeight: 700, color: "#8899bb", letterSpacing: 0.5, fontFamily: "'Barlow Condensed', sans-serif", padding: "4px 0", textTransform: "uppercase" }}>{d}</div>)}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 2, padding: "0 8px" }}>
        {cells.map((day, i) => {
          if (!day) return <div key={i} />;
          const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
          const evs = dayEvents[dateStr] || [];
          const isToday = dateStr === today();
          const isSel = dateStr === selectedDay;
          return (
            <div key={i} onClick={() => setSelectedDay(dateStr)} style={{ background: isSel ? NAVY : isToday ? "#fff3ee" : "#fff", borderRadius: 8, padding: "5px 3px", minHeight: 46, cursor: "pointer", border: isToday && !isSel ? `1.5px solid ${ORANGE}` : "1.5px solid transparent", display: "flex", flexDirection: "column", alignItems: "center" }}>
              <div style={{ fontSize: 13, fontWeight: isToday ? 700 : 400, color: isSel ? "#fff" : isToday ? ORANGE : "#333", marginBottom: 2 }}>{day}</div>
              <div style={{ display: "flex", gap: 2, flexWrap: "wrap", justifyContent: "center" }}>
                {evs.slice(0, 3).map((ev, j) => <div key={j} style={{ width: 5, height: 5, borderRadius: "50%", background: isSel ? "#fff" : ev.color }} />)}
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ margin: "12px 12px 0" }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: "#6677aa", letterSpacing: 1, textTransform: "uppercase", fontFamily: "'Barlow Condensed', sans-serif", marginBottom: 8, padding: "0 4px" }}>{fmtDate(selectedDay)}</div>
        {selectedEvents.length === 0 ? (
          <div style={{ padding: "20px 16px", textAlign: "center" }}>
            {loadingEvents ? <div style={{ fontSize: 12, color: "#aaa" }}>Loading events…</div> : <div style={{ fontSize: 13, color: "#bbb" }}>No events</div>}
          </div>
        ) : selectedEvents.map((ev, i) => (
          <div key={i} style={{ background: "#fff", borderRadius: 10, padding: "10px 14px", marginBottom: 8, display: "flex", alignItems: "center", gap: 10, boxShadow: "0 1px 4px rgba(0,0,0,0.06)", borderLeft: `3px solid ${ev.color}` }}>
            <Icon name={ev.type === "job" ? "calendar" : ev.type === "followup" ? "bell" : "clock"} size={15} color={ev.color} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: "#1a1a1a" }}>{ev.label}</div>
              <div style={{ fontSize: 11, color: "#aaa", marginTop: 1 }}>
                {ev.time && <span>{ev.time} · </span>}
                {ev.type === "job" ? "Scheduled Job" : ev.type === "followup" ? "Follow-Up Reminder" : "Google Calendar"}
              </div>
            </div>
          </div>
        ))}
        {!GCal.isConfigured() && (
          <div style={{ background: "#f8f9fc", borderRadius: 10, padding: "14px 16px", marginTop: 8, fontSize: 12, color: "#888", textAlign: "center" }}>
            Add <strong>VITE_GOOGLE_CLIENT_ID</strong> to your .env to enable Google Calendar sync
          </div>
        )}
        {GCal.isConfigured() && !gcalAuthed && (
          <div style={{ background: "#f0f7ff", borderRadius: 10, padding: "14px 16px", marginTop: 8, textAlign: "center" }}>
            <div style={{ fontSize: 13, color: "#555", marginBottom: 10 }}>Connect Google Calendar to see all your events and sync scheduled jobs</div>
            <button onClick={handleSignIn} style={{ background: "#4285f4", color: "#fff", border: "none", borderRadius: 8, padding: "9px 22px", fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>Connect Google Calendar</button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────
export default function App() {
  const [data, setData] = useState(loadData);
  const [tab, setTab] = useState("invoices");
  const [view, setView] = useState("list");
  const [selected, setSelected] = useState(null);
  const [newDocType, setNewDocType] = useState("invoice");
  const [showGlobalAI, setShowGlobalAI] = useState(false);
  const [gcalAuthed, setGcalAuthed] = useState(() => !!GCal.getStoredToken());

  useEffect(() => { saveData(data); }, [data]);

  const handleGlobalAIAction = (parsed) => {
    if (parsed.action === "create_invoice" || parsed.action === "create_estimate") {
      const inv = parsed.invoice || {};
      const year = new Date(inv.date || today()).getFullYear();
      const id = `INV${String(data.nextNum).padStart(4, "0")}`;
      const docType = parsed.action === "create_estimate" ? "estimate" : "invoice";
      const newInvoice = { id, year, type: docType, client: inv.client || "", date: inv.date || today(), dueDate: inv.dueDate || today(), status: "outstanding", items: inv.items || [], tax: inv.tax ?? TAX_RATE, discount: inv.discount || 0, notes: inv.notes || "", payments: [] };
      setData(d => ({ ...d, invoices: [newInvoice, ...d.invoices], nextNum: d.nextNum + 1 }));
      return newInvoice;
    }
    if (parsed.action === "add_items") {
      setData(d => ({ ...d, invoices: d.invoices.map(inv => inv.id === parsed.invoiceId ? { ...inv, items: [...(inv.items || []), ...(parsed.items || [])] } : inv) }));
    }
    if (parsed.action === "save_item") {
      const item = parsed.item || {};
      setData(d => {
        const existing = d.savedItems.find(i => i.name.toLowerCase() === item.name.toLowerCase());
        if (existing) {
          return { ...d, savedItems: d.savedItems.map(i => i.id === existing.id ? { ...i, price: item.price, category: item.category || i.category } : i) };
        }
        return { ...d, savedItems: [...d.savedItems, { id: Date.now(), category: item.category || "Custom", name: item.name, price: item.price }] };
      });
    }
  };

  const updateInvoice = (form) => {
    const year = new Date(form.date || today()).getFullYear();
    if (selected) {
      setData(d => ({ ...d, invoices: d.invoices.map(inv => inv.id === selected.id ? { ...form, id: selected.id, year } : inv) }));
    } else {
      const id = `INV${String(data.nextNum).padStart(4, "0")}`;
      setData(d => ({ ...d, invoices: [{ ...form, id, year }, ...d.invoices], nextNum: d.nextNum + 1 }));
    }
    setView("list"); setSelected(null);
  };

  const deleteInvoice = (id) => { setData(d => ({ ...d, invoices: d.invoices.filter(inv => inv.id !== id) })); setView("list"); setSelected(null); };

  const saveClient = (form, editing) => {
    if (editing === "new") setData(d => ({ ...d, clients: [...d.clients, { ...form, id: Date.now() }] }));
    else setData(d => ({ ...d, clients: d.clients.map(c => c.id === editing ? { ...form, id: editing } : c) }));
  };

  const saveItemToLibrary = (item) => {
    const newItem = { id: Date.now(), category: "Custom", name: item.name, price: item.price };
    setData(d => ({ ...d, savedItems: [...d.savedItems, newItem] }));
  };

  const invoices = data.invoices.filter(i => i.type !== "estimate");
  const estimates = data.invoices.filter(i => i.type === "estimate");

  const navItems = [
    { id: "invoices",  label: "Invoices",  icon: "invoice"   },
    { id: "estimates", label: "Estimates", icon: "estimates" },
    { id: "clients",   label: "Clients",   icon: "clients"   },
    { id: "items",     label: "Items",     icon: "items"     },
    { id: "payments",  label: "Payments",  icon: "dollar"    },
    { id: "calendar",  label: "Calendar",  icon: "calendar"  },
  ];

  return (
    <div style={{ fontFamily: "'Barlow', sans-serif", background: LIGHT, minHeight: "100vh", maxWidth: 480, margin: "0 auto", position: "relative", paddingBottom: view === "list" ? 80 : 0 }}>
      {showGlobalAI && <GlobalAIModal data={data} onClose={() => setShowGlobalAI(false)} onAction={handleGlobalAIAction} onOpenDoc={(inv) => { setShowGlobalAI(false); setSelected(inv); setView("form"); }} />}

      {view === "list" && (
        <div style={{ background: NAVY, padding: "16px 20px 12px", display: "flex", alignItems: "center", justifyContent: "space-between", position: "sticky", top: 0, zIndex: 100, boxShadow: "0 2px 12px rgba(0,0,0,0.3)" }}>
          <div>
            <div style={{ color: "#fff", fontSize: 18, fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, letterSpacing: 1.5, lineHeight: 1.1 }}>HI GRADE PLUMBING</div>
            <span style={{ color: ORANGE, fontSize: 10, letterSpacing: 3, fontWeight: 600, textTransform: "uppercase" }}>LLC · HONOLULU</span>
          </div>
          <div style={{ width: 36, height: 36, background: ORANGE, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={2.5}><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>
          </div>
        </div>
      )}

      {view === "form" ? (
        <InvoiceForm
          invoice={selected}
          defaultType={newDocType}
          clients={data.clients}
          savedItems={data.savedItems}
          gcalAuthed={gcalAuthed}
          onSave={updateInvoice}
          onCancel={() => { setView("list"); setSelected(null); }}
          onDelete={deleteInvoice}
          onSaveItem={saveItemToLibrary}
        />
      ) : (
        <>
          {tab === "invoices"  && <InvoiceList invoices={invoices} onNew={() => { setSelected(null); setNewDocType("invoice"); setView("form"); }} onSelect={inv => { setSelected(inv); setView("form"); }} />}
          {tab === "estimates" && <EstimatesTab invoices={estimates} onNew={() => { setSelected(null); setNewDocType("estimate"); setView("form"); }} onSelect={inv => { setSelected(inv); setView("form"); }} />}
          {tab === "clients"   && <ClientsTab clients={data.clients} onSave={saveClient} />}
          {tab === "items"     && <ItemsTab savedItems={data.savedItems} />}
          {tab === "payments"  && <PaymentsTab invoices={data.invoices} />}
          {tab === "calendar"  && <CalendarTab invoices={data.invoices} gcalAuthed={gcalAuthed} onAuthChange={setGcalAuthed} />}
        </>
      )}

      {!showGlobalAI && (
        <button onClick={() => setShowGlobalAI(true)} style={{ position: "fixed", bottom: view === "form" ? 24 : 90, right: 20, width: 52, height: 52, borderRadius: "50%", background: NAVY, border: `2.5px solid ${ORANGE}`, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 4px 20px rgba(10,22,40,0.45)", zIndex: 150 }}>
          <Icon name="ai" size={22} color={ORANGE} />
        </button>
      )}

      {view === "list" && (
        <nav style={{ position: "fixed", bottom: 0, left: "50%", transform: "translateX(-50%)", width: "100%", maxWidth: 480, background: NAVY, display: "flex", borderTop: `2px solid ${ORANGE}`, zIndex: 200 }}>
          {navItems.map(n => (
            <button key={n.id} onClick={() => setTab(n.id)} style={{ flex: 1, padding: "10px 2px 8px", background: "none", border: "none", cursor: "pointer", color: tab === n.id ? ORANGE : "#8899bb", fontSize: 8, fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, letterSpacing: 0.5, textTransform: "uppercase", display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
              <Icon name={n.icon} size={20} color={tab === n.id ? ORANGE : "#8899bb"} />
              {n.label}
            </button>
          ))}
        </nav>
      )}
    </div>
  );
}
