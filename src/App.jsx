import { useState, useEffect, useRef } from "react";

// ─── Constants ───────────────────────────────────────────────────────────────
const NAVY = "#0a1628";
const ORANGE = "#E8622A";
const NAVY2 = "#0f2040";
const LIGHT = "#f4f6fa";
const TAX_RATE = 4.712;

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
  { id: 1, name: "Ace of Spades Management LLC", email: "aosm@gmail.com", phone: "808-555-0101", address: "1234 Kapiolani Blvd, Honolulu HI 96814" },
  { id: 2, name: "Greg Morata", email: "gmorata@gmail.com", phone: "808-555-0192", address: "456 Nuuanu Ave, Honolulu HI 96817" },
  { id: 3, name: "Reid Tatsugucho", email: "", phone: "808-555-0144", address: "" },
  { id: 4, name: "Crystal Knysh", email: "crystal@gmail.com", phone: "808-555-0177", address: "789 Ala Moana Blvd, Honolulu HI 96813" },
];

const DEFAULT_INVOICES = [
  { id: "INV0748", type: "invoice", client: "Ace of Spades Management LLC", date: "2026-04-09", dueDate: "2026-04-09", status: "outstanding", items: [{ desc: "Backflow prevention repair", qty: 1, price: 628.27 }], tax: TAX_RATE, discount: 0, notes: "", year: 2026, payments: [] },
  { id: "INV0747", type: "invoice", client: "Greg Morata", date: "2026-04-09", dueDate: "2026-04-09", status: "paid", items: [{ desc: "Drain clean – snake main line", qty: 1, price: 350 }, { desc: "Service call", qty: 1, price: 225 }], tax: TAX_RATE, discount: 0, notes: "", year: 2026, payments: [{ amount: 575, method: "Cash", date: "2026-04-09" }] },
  { id: "INV0746", type: "invoice", client: "Reid Tatsugucho", date: "2026-04-06", dueDate: "2026-04-06", status: "paid", items: [{ desc: "Water heater replacement – electric", qty: 1, price: 1800 }], tax: TAX_RATE, discount: 0, notes: "", year: 2026, payments: [{ amount: 1884.82, method: "Check", date: "2026-04-06" }] },
  { id: "INV0745", type: "invoice", client: "Crystal Knysh", date: "2026-04-13", dueDate: "2026-04-13", status: "paid", items: [{ desc: "Bathroom remodel – rough in plumbing", qty: 1, price: 2800 }], tax: TAX_RATE, discount: 0, notes: "", year: 2026, payments: [{ amount: 2931.94, method: "Venmo", date: "2026-04-13" }] },
];

// ─── Storage ─────────────────────────────────────────────────────────────────
const KEY = "higrade_v3";
function loadData() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return { invoices: DEFAULT_INVOICES, clients: DEFAULT_CLIENTS, savedItems: SAVED_ITEMS, nextNum: 749 };
}
function saveData(d) {
  try { localStorage.setItem(KEY, JSON.stringify(d)); } catch {}
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function calcTotals(inv) {
  const sub = inv.items.reduce((s, it) => s + it.qty * it.price, 0);
  const disc = inv.discount || 0;
  const afterDisc = sub - disc;
  const taxAmt = afterDisc * (inv.tax / 100);
  const total = afterDisc + taxAmt;
  const paid = (inv.payments || []).reduce((s, p) => s + p.amount, 0);
  return { sub, disc, afterDisc, taxAmt, total, paid, balance: total - paid };
}
function fmt(n) { return "$" + Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function today() { return new Date().toISOString().slice(0, 10); }

// ─── AI Call (via secure backend) ────────────────────────────────────────────
async function callAI(messages) {
  const res = await fetch("/api/ai", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || data.error);
  return data.content?.[0]?.text || "";
}

// ─── Send Email ───────────────────────────────────────────────────────────────
async function sendInvoiceEmail(invoice, client) {
  const t = calcTotals(invoice);
  const itemsHtml = invoice.items.map(it =>
    `<tr><td style="padding:8px;border-bottom:1px solid #eee;">${it.desc}</td><td style="padding:8px;border-bottom:1px solid #eee;text-align:center;">${it.qty}</td><td style="padding:8px;border-bottom:1px solid #eee;text-align:right;">${fmt(it.price * it.qty)}</td></tr>`
  ).join("");
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
    body: JSON.stringify({
      to: client.email,
      clientName: client.name,
      invoiceId: invoice.id,
      total: t.total.toFixed(2),
      invoiceHtml,
    }),
  });
  return res.json();
}

// ─── Icons ────────────────────────────────────────────────────────────────────
const Icon = ({ name, size = 20, color = "currentColor" }) => {
  const p = { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: color, strokeWidth: 2 };
  const icons = {
    invoice: <svg {...p}><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="8" y1="8" x2="16" y2="8"/><line x1="8" y1="12" x2="16" y2="12"/><line x1="8" y1="16" x2="12" y2="16"/></svg>,
    clients: <svg {...p}><circle cx="9" cy="7" r="4"/><path d="M3 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/><path d="M21 21v-2a4 4 0 0 0-3-3.85"/></svg>,
    items: <svg {...p}><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>,
    ai: <svg {...p}><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.22 4.22l2.12 2.12M17.66 17.66l2.12 2.12M2 12h3M19 12h3M4.22 19.78l2.12-2.12M17.66 6.34l2.12-2.12"/></svg>,
    plus: <svg {...p} strokeWidth={2.5}><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>,
    mic: <svg {...p}><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0 0 14 0"/><line x1="12" y1="19" x2="12" y2="22"/><line x1="8" y1="22" x2="16" y2="22"/></svg>,
    send: <svg {...p}><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>,
    trash: <svg {...p}><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>,
    back: <svg {...p}><polyline points="15 18 9 12 15 6"/></svg>,
    mail: <svg {...p}><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>,
    payment: <svg {...p}><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>,
    check: <svg {...p} strokeWidth={2.5}><polyline points="20 6 9 17 4 12"/></svg>,
  };
  return icons[name] || null;
};

// ─── Styles ──────────────────────────────────────────────────────────────────
const S = {
  btn: (v = "primary") => ({
    background: v === "primary" ? ORANGE : v === "navy" ? NAVY : v === "green" ? "#27ae60" : "#e8ecf4",
    color: v === "ghost" ? "#444" : "#fff",
    border: "none", borderRadius: 8,
    padding: "10px 18px",
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
  const [msgs, setMsgs] = useState([
    { role: "assistant", text: "Hey Jake! Describe a job and I'll build the estimate. You can also tap the mic to dictate." }
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [listening, setListening] = useState(false);
  const endRef = useRef(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs, loading]);

  const startListening = () => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { alert("Voice not supported in this browser."); return; }
    const r = new SR();
    r.lang = "en-US";
    r.onresult = (e) => { setInput(prev => (prev + " " + e.results[0][0].transcript).trim()); setListening(false); };
    r.onerror = () => setListening(false);
    r.onend = () => setListening(false);
    r.start(); setListening(true);
  };

  const send = async () => {
    const text = input.trim();
    if (!text || loading) return;
    setInput("");
    const userMsg = { role: "user", text };
    setMsgs(prev => [...prev, userMsg]);
    setLoading(true);
    try {
      const history = [...msgs, userMsg]
        .filter(m => m.text?.trim())
        .map(m => ({ role: m.role === "user" ? "user" : "assistant", content: m.text }));
      const firstUser = history.findIndex(m => m.role === "user");
      const apiHistory = firstUser >= 0 ? history.slice(firstUser) : history;

      const reply = await callAI(apiHistory);

      let parsed = null;
      try {
        const clean = reply.replace(/```json|```/g, "").trim();
        if (clean.startsWith("{")) parsed = JSON.parse(clean);
      } catch {}

      if (parsed?.action === "estimate" && parsed.items?.length) {
        setMsgs(prev => [...prev, { role: "assistant", text: parsed.summary || "Here's your estimate:", estimate: parsed }]);
      } else {
        setMsgs(prev => [...prev, { role: "assistant", text: reply }]);
      }
    } catch (e) {
      setMsgs(prev => [...prev, { role: "assistant", text: "Error: " + e.message }]);
    }
    setLoading(false);
  };

  return (
    <div style={{ position: "relative", height: 400, background: "#f4f6fa", borderRadius: 12, overflow: "hidden", border: "1.5px solid #dde2ee" }}>
      <style>{`@keyframes bounce{0%,80%,100%{transform:translateY(0)}40%{transform:translateY(-8px)}}`}</style>
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 62, overflowY: "auto", padding: 14 }}>
        {msgs.map((m, i) => (
          <div key={i} style={{ marginBottom: 10, display: "flex", justifyContent: m.role === "user" ? "flex-end" : "flex-start" }}>
            <div style={{
              maxWidth: "85%", background: m.role === "user" ? NAVY : "#fff",
              color: m.role === "user" ? "#fff" : "#1a1a1a",
              borderRadius: m.role === "user" ? "14px 14px 4px 14px" : "14px 14px 14px 4px",
              padding: "10px 13px", fontSize: 13, lineHeight: 1.55,
              boxShadow: "0 1px 4px rgba(0,0,0,0.09)",
            }}>
              {m.text}
              {m.estimate && (
                <div style={{ marginTop: 10, borderTop: "1px solid #e8ecf4", paddingTop: 8 }}>
                  {m.estimate.items.map((it, j) => (
                    <div key={j} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 5 }}>
                      <span style={{ color: "#ccd" }}>{it.desc}</span>
                      <strong style={{ color: ORANGE, marginLeft: 8 }}>{fmt(it.price * it.qty)}</strong>
                    </div>
                  ))}
                  {m.estimate.notes && <div style={{ fontSize: 11, color: "#aab", marginTop: 5 }}>{m.estimate.notes}</div>}
                  <button
                    onClick={() => { onAddItems(m.estimate.items, m.estimate.notes); setMsgs(prev => [...prev, { role: "assistant", text: "✓ Items added to your invoice!" }]); }}
                    style={{ ...S.btn("primary"), width: "100%", marginTop: 10, fontSize: 13 }}
                  >+ Add to Invoice</button>
                </div>
              )}
            </div>
          </div>
        ))}
        {loading && (
          <div style={{ display: "flex", justifyContent: "flex-start", marginBottom: 10 }}>
            <div style={{ background: "#fff", borderRadius: "14px 14px 14px 4px", padding: "12px 16px", boxShadow: "0 1px 4px rgba(0,0,0,0.08)", display: "flex", gap: 5 }}>
              {[0,1,2].map(i => <span key={i} style={{ width: 8, height: 8, borderRadius: "50%", background: ORANGE, display: "inline-block", animation: `bounce 1s ${i*0.18}s infinite` }}/>)}
            </div>
          </div>
        )}
        <div ref={endRef} />
      </div>
      <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 62, background: "#fff", borderTop: "1px solid #dde2ee", display: "flex", alignItems: "center", gap: 8, padding: "0 10px" }}>
        <button onClick={startListening} style={{ width: 40, height: 40, borderRadius: 8, border: "none", background: listening ? ORANGE : "#f0f2f8", color: listening ? "#fff" : "#666", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Icon name="mic" size={18} />
        </button>
        <input
          style={{ flex: 1, border: "1.5px solid #dde2ee", borderRadius: 8, padding: "9px 12px", fontSize: 13, fontFamily: "'Barlow', sans-serif", outline: "none", background: "#f8f9fc" }}
          value={input} onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === "Enter" && send()}
          placeholder={listening ? "Listening…" : "Describe a job or ask anything…"}
        />
        <button onClick={send} style={{ width: 40, height: 40, borderRadius: 8, border: "none", background: NAVY, color: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Icon name="send" size={17} />
        </button>
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
    const status = newTotal >= t.total - 0.01 ? "paid" : "partial";
    onSave({ ...invoice, payments, status });
    onClose();
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 500, display: "flex", alignItems: "flex-end" }}>
      <div style={{ background: "#fff", width: "100%", borderRadius: "16px 16px 0 0", padding: 24, maxWidth: 480, margin: "0 auto" }}>
        <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 20, marginBottom: 16 }}>Record Payment</div>
        <div style={{ marginBottom: 12 }}>
          <label style={S.label}>Amount</label>
          <input type="number" style={S.input} value={amount} onChange={e => setAmount(e.target.value)} step="0.01" />
        </div>
        <div style={{ marginBottom: 12 }}>
          <label style={S.label}>Method</label>
          <select style={S.input} value={method} onChange={e => setMethod(e.target.value)}>
            {["Cash", "Check", "Venmo", "Zelle", "Credit Card", "Bank Transfer", "Other"].map(m => <option key={m}>{m}</option>)}
          </select>
        </div>
        <div style={{ marginBottom: 20 }}>
          <label style={S.label}>Date</label>
          <input type="date" style={S.input} value={date} onChange={e => setDate(e.target.value)} />
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={onClose} style={{ ...S.btn("ghost"), flex: 1 }}>Cancel</button>
          <button onClick={save} style={{ ...S.btn("green"), flex: 2 }}>Save Payment</button>
        </div>
      </div>
    </div>
  );
}

// ─── Invoice Form ─────────────────────────────────────────────────────────────
function InvoiceForm({ invoice, clients, savedItems, onSave, onCancel, onDelete }) {
  const [form, setForm] = useState(invoice || {
    type: "invoice", client: "", date: today(), dueDate: today(),
    status: "outstanding", items: [{ desc: "", qty: 1, price: 0 }],
    tax: TAX_RATE, discount: 0, notes: "", payments: [],
  });
  const [showItems, setShowItems] = useState(false);
  const [showAI, setShowAI] = useState(false);
  const [showPayment, setShowPayment] = useState(false);
  const [emailStatus, setEmailStatus] = useState("");

  const t = calcTotals(form);
  const setField = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const setItem = (i, k, v) => setForm(f => ({ ...f, items: f.items.map((it, j) => j === i ? { ...it, [k]: v } : it) }));
  const addItem = (desc = "", price = 0) => setForm(f => ({ ...f, items: [...f.items, { desc, qty: 1, price }] }));
  const removeItem = (i) => setForm(f => ({ ...f, items: f.items.filter((_, j) => j !== i) }));
  const handleAddFromAI = (items, notes) => {
    setForm(f => ({ ...f, items: [...f.items.filter(it => it.desc || it.price), ...items], notes: notes ? (f.notes ? f.notes + "\n" + notes : notes) : f.notes }));
    setShowAI(false);
  };

  const handleEmail = async () => {
    const client = clients.find(c => c.name === form.client);
    if (!client?.email) { alert("No email on file for this client."); return; }
    setEmailStatus("Sending…");
    try {
      await sendInvoiceEmail(form, client);
      setEmailStatus("✓ Sent!");
    } catch { setEmailStatus("Failed to send"); }
    setTimeout(() => setEmailStatus(""), 3000);
  };

  const categories = [...new Set(savedItems.map(i => i.category))];

  return (
    <div style={{ paddingBottom: 100, background: LIGHT, minHeight: "100vh" }}>
      {showPayment && <PaymentModal invoice={form} onClose={() => setShowPayment(false)} onSave={(updated) => { setForm(updated); }} />}

      {/* Header */}
      <div style={{ background: NAVY, padding: "14px 16px", display: "flex", alignItems: "center", gap: 12, position: "sticky", top: 0, zIndex: 100 }}>
        <button onClick={onCancel} style={{ background: "none", border: "none", color: "#fff", cursor: "pointer", padding: 4 }}>
          <Icon name="back" size={22} color="#fff" />
        </button>
        <span style={{ color: "#fff", fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 18, letterSpacing: 1, flex: 1 }}>
          {invoice ? invoice.id : "New Invoice"}
        </span>
        {invoice && onDelete && (
          <button onClick={() => { if (confirm("Delete this invoice?")) onDelete(invoice.id); }} style={{ background: "none", border: "none", color: "#cc4444", cursor: "pointer", padding: 4 }}>
            <Icon name="trash" size={20} color="#cc4444" />
          </button>
        )}
        <button onClick={() => onSave(form)} style={S.btn("primary")}>Save</button>
      </div>

      {/* AI Button */}
      <div style={{ padding: "14px 16px 0" }}>
        <button onClick={() => setShowAI(!showAI)} style={{ ...S.btn("navy"), width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, fontSize: 15 }}>
          <Icon name="ai" size={18} color="#fff" />
          {showAI ? "Close AI Assistant" : "AI Estimate Assistant"}
        </button>
      </div>
      {showAI && <div style={{ margin: "12px 16px 0" }}><AIChatPanel onAddItems={handleAddFromAI} /></div>}

      {/* Client */}
      <div style={{ padding: "16px 16px 0" }}>
        <label style={S.label}>Client</label>
        <select style={S.input} value={form.client} onChange={e => setField("client", e.target.value)}>
          <option value="">Select client…</option>
          {clients.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
        </select>
      </div>

      {/* Dates */}
      <div style={{ padding: "12px 16px 0", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <div>
          <label style={S.label}>Date</label>
          <input type="date" style={S.input} value={form.date} onChange={e => setField("date", e.target.value)} />
        </div>
        <div>
          <label style={S.label}>Due Date</label>
          <input type="date" style={S.input} value={form.dueDate} onChange={e => setField("dueDate", e.target.value)} />
        </div>
      </div>

      {/* Line Items */}
      <div style={{ padding: "16px 16px 0" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: "#6677aa", letterSpacing: 2, textTransform: "uppercase", fontFamily: "'Barlow Condensed', sans-serif" }}>Line Items</span>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => setShowItems(!showItems)} style={{ ...S.btn("ghost"), fontSize: 12, padding: "6px 12px" }}>Saved Items</button>
            <button onClick={() => addItem()} style={{ ...S.btn("primary"), padding: "6px 10px" }}><Icon name="plus" size={16} color="#fff" /></button>
          </div>
        </div>

        {showItems && (
          <div style={{ background: "#fff", borderRadius: 10, marginBottom: 12, overflow: "hidden", boxShadow: "0 2px 8px rgba(0,0,0,0.08)", maxHeight: 280, overflowY: "auto" }}>
            {categories.map(cat => (
              <div key={cat}>
                <div style={{ background: "#f4f6fa", padding: "6px 14px", fontSize: 11, fontWeight: 700, color: ORANGE, letterSpacing: 1, textTransform: "uppercase", fontFamily: "'Barlow Condensed', sans-serif" }}>{cat}</div>
                {savedItems.filter(i => i.category === cat).map(item => (
                  <div key={item.id} onClick={() => { addItem(item.name, item.price); setShowItems(false); }} style={{ padding: "10px 14px", display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid #f0f2f8", cursor: "pointer" }}>
                    <span style={{ fontSize: 14 }}>{item.name}</span>
                    <span style={{ color: ORANGE, fontWeight: 700, fontSize: 14 }}>{fmt(item.price)}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}

        {form.items.map((item, i) => (
          <div key={i} style={{ background: "#fff", borderRadius: 10, padding: 12, marginBottom: 8, boxShadow: "0 1px 4px rgba(0,0,0,0.06)" }}>
            <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
              <input style={{ ...S.input, flex: 1 }} placeholder="Description" value={item.desc} onChange={e => setItem(i, "desc", e.target.value)} />
              <button onClick={() => removeItem(i)} style={{ background: "none", border: "none", cursor: "pointer", color: "#cc4444", padding: 4 }}><Icon name="trash" size={18} color="#cc4444" /></button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "80px 1fr", gap: 8 }}>
              <div>
                <label style={S.label}>Qty</label>
                <input type="number" style={S.input} value={item.qty} onChange={e => setItem(i, "qty", parseFloat(e.target.value) || 1)} min={1} />
              </div>
              <div>
                <label style={S.label}>Unit Price</label>
                <input type="number" style={S.input} value={item.price} onChange={e => setItem(i, "price", parseFloat(e.target.value) || 0)} min={0} step={0.01} />
              </div>
            </div>
            <div style={{ textAlign: "right", marginTop: 6, fontSize: 13, color: "#888" }}>
              Line total: <strong style={{ color: "#222" }}>{fmt(item.qty * item.price)}</strong>
            </div>
          </div>
        ))}
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

      {/* Status */}
      <div style={{ padding: "12px 16px 0" }}>
        <label style={S.label}>Status</label>
        <div style={{ display: "flex", gap: 8 }}>
          {["outstanding", "paid"].map(s => (
            <button key={s} onClick={() => setField("status", s)} style={{ ...S.btn(form.status === s ? "primary" : "ghost"), flex: 1, fontSize: 13 }}>
              {s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Totals */}
      <div style={{ margin: "16px 16px 0", background: "#fff", borderRadius: 12, padding: 16, boxShadow: "0 1px 6px rgba(0,0,0,0.07)" }}>
        {[["Subtotal", fmt(t.sub)], t.disc > 0 && ["Discount", "−" + fmt(t.disc)], ["GET (" + form.tax + "%)", fmt(t.taxAmt)]].filter(Boolean).map(([label, val]) => (
          <div key={label} style={{ display: "flex", justifyContent: "space-between", marginBottom: 6, fontSize: 14, color: "#666" }}>
            <span>{label}</span><span>{val}</span>
          </div>
        ))}
        <div style={{ display: "flex", justifyContent: "space-between", borderTop: "2px solid #eee", paddingTop: 10, marginTop: 4 }}>
          <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 18 }}>Total</span>
          <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 22, color: ORANGE }}>{fmt(t.total)}</span>
        </div>
        {(form.payments || []).length > 0 && (
          <div>
            <div style={{ marginTop: 10, borderTop: "1px solid #eee", paddingTop: 8 }}>
              {(form.payments || []).map((p, i) => (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "#27ae60", marginBottom: 3 }}>
                  <span>{p.method} · {p.date}</span><span>−{fmt(p.amount)}</span>
                </div>
              ))}
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8, borderTop: "2px solid #eee", paddingTop: 8 }}>
              <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 16 }}>Balance Due</span>
              <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 18, color: t.balance <= 0 ? "#27ae60" : ORANGE }}>{fmt(Math.max(0, t.balance))}</span>
            </div>
          </div>
        )}
      </div>

      {/* Action Buttons */}
      <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
        <button onClick={() => onSave(form)} style={{ ...S.btn("primary"), fontSize: 16, padding: 14 }}>Save Invoice</button>
        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={() => setShowPayment(true)} style={{ ...S.btn("green"), flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
            <Icon name="payment" size={16} color="#fff" /> Record Payment
          </button>
          <button onClick={handleEmail} style={{ ...S.btn("navy"), flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
            <Icon name="mail" size={16} color="#fff" /> {emailStatus || "Send Email"}
          </button>
        </div>
      </div>
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
        <div>
          <div style={{ color: "#8899bb", fontSize: 11, letterSpacing: 1, fontFamily: "'Barlow Condensed', sans-serif", textTransform: "uppercase" }}>Outstanding</div>
          <div style={{ color: ORANGE, fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 20 }}>{fmt(outstanding)}</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ color: "#8899bb", fontSize: 11, letterSpacing: 1, fontFamily: "'Barlow Condensed', sans-serif", textTransform: "uppercase" }}>2026 Paid</div>
          <div style={{ color: "#4ecb71", fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 20 }}>{fmt(paidThisYear)}</div>
        </div>
      </div>

      <div style={{ display: "flex", background: "#fff", borderBottom: "1px solid #eee" }}>
        {["all", "outstanding", "paid"].map(t => (
          <button key={t} onClick={() => setTab(t)} style={{ flex: 1, padding: "10px 4px", background: "none", border: "none", borderBottom: tab === t ? `2px solid ${ORANGE}` : "2px solid transparent", color: tab === t ? ORANGE : "#888", fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 13, letterSpacing: 1, textTransform: "uppercase", cursor: "pointer" }}>
            {t}
          </button>
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
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 2 }}>{inv.client}</div>
                    <div style={{ fontSize: 12, color: "#888" }}>{inv.id} · {inv.date}</div>
                  </div>
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

      <button onClick={onNew} style={{ position: "fixed", bottom: 90, right: 20, width: 56, height: 56, borderRadius: "50%", background: ORANGE, border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 4px 16px rgba(232,98,42,0.5)", zIndex: 150 }}>
        <Icon name="plus" size={26} color="#fff" />
      </button>
    </div>
  );
}

// ─── Clients Tab ──────────────────────────────────────────────────────────────
function ClientsTab({ clients, onSave }) {
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({});

  const startEdit = (c) => { setEditing(c?.id || "new"); setForm(c || { name: "", email: "", phone: "", address: "" }); };
  const save = () => { onSave(form, editing); setEditing(null); };

  if (editing !== null) return (
    <div style={{ padding: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
        <button onClick={() => setEditing(null)} style={{ background: "none", border: "none", cursor: "pointer" }}><Icon name="back" size={22} /></button>
        <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 20 }}>{editing === "new" ? "New Client" : "Edit Client"}</span>
      </div>
      {[["name", "Name"], ["email", "Email"], ["phone", "Phone"], ["address", "Address"]].map(([k, l]) => (
        <div key={k} style={{ marginBottom: 12 }}>
          <label style={S.label}>{l}</label>
          <input style={S.input} value={form[k] || ""} onChange={e => setForm(f => ({ ...f, [k]: e.target.value }))} />
        </div>
      ))}
      <button onClick={save} style={{ ...S.btn("primary"), width: "100%", marginTop: 8, fontSize: 16, padding: 14 }}>Save Client</button>
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

// ─── Main App ─────────────────────────────────────────────────────────────────
export default function App() {
  const [data, setData] = useState(loadData);
  const [tab, setTab] = useState("invoices");
  const [view, setView] = useState("list");
  const [selected, setSelected] = useState(null);

  useEffect(() => { saveData(data); }, [data]);

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

  const deleteInvoice = (id) => {
    setData(d => ({ ...d, invoices: d.invoices.filter(inv => inv.id !== id) }));
    setView("list"); setSelected(null);
  };

  const saveClient = (form, editing) => {
    if (editing === "new") {
      setData(d => ({ ...d, clients: [...d.clients, { ...form, id: Date.now() }] }));
    } else {
      setData(d => ({ ...d, clients: d.clients.map(c => c.id === editing ? { ...form, id: editing } : c) }));
    }
  };

  const navItems = [
    { id: "invoices", label: "Invoices", icon: "invoice" },
    { id: "clients", label: "Clients", icon: "clients" },
    { id: "items", label: "Items", icon: "items" },
    { id: "ai", label: "AI", icon: "ai" },
  ];

  return (
    <div style={{ fontFamily: "'Barlow', sans-serif", background: LIGHT, minHeight: "100vh", maxWidth: 480, margin: "0 auto", position: "relative", paddingBottom: view === "list" ? 80 : 0 }}>
      {/* Header */}
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

      {/* Content */}
      {view === "form" ? (
        <InvoiceForm
          invoice={selected}
          clients={data.clients}
          savedItems={data.savedItems}
          onSave={updateInvoice}
          onCancel={() => { setView("list"); setSelected(null); }}
          onDelete={deleteInvoice}
        />
      ) : (
        <>
          {tab === "invoices" && <InvoiceList invoices={data.invoices} onNew={() => { setSelected(null); setView("form"); }} onSelect={(inv) => { setSelected(inv); setView("form"); }} />}
          {tab === "clients" && <ClientsTab clients={data.clients} onSave={saveClient} />}
          {tab === "items" && <ItemsTab savedItems={data.savedItems} />}
          {tab === "ai" && (
            <div style={{ padding: 16 }}>
              <p style={{ fontSize: 13, color: "#666", marginBottom: 14 }}>Use AI to build estimates. Open an invoice to add items directly.</p>
              <AIChatPanel onAddItems={() => {}} />
            </div>
          )}
        </>
      )}

      {/* Bottom Nav */}
      {view === "list" && (
        <nav style={{ position: "fixed", bottom: 0, left: "50%", transform: "translateX(-50%)", width: "100%", maxWidth: 480, background: NAVY, display: "flex", borderTop: `2px solid ${ORANGE}`, zIndex: 200 }}>
          {navItems.map(n => (
            <button key={n.id} onClick={() => setTab(n.id)} style={{ flex: 1, padding: "10px 4px 8px", background: "none", border: "none", cursor: "pointer", color: tab === n.id ? ORANGE : "#8899bb", fontSize: 9, fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, letterSpacing: 1, textTransform: "uppercase", display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
              <Icon name={n.icon} size={22} color={tab === n.id ? ORANGE : "#8899bb"} />
              {n.label}
            </button>
          ))}
        </nav>
      )}
    </div>
  );
}
