import { useState, useEffect, useLayoutEffect, useRef, useMemo } from "react";
import { createPortal } from "react-dom";
import * as GCal from './googleCalendar.js';
import * as db from './db.js';
import { supabase } from './supabase.js';
import { api } from './apiBase.js';
import { canImportContacts, pickContact } from './contacts.js';
import * as backup from './backup.js';
import JobPhotos, { fetchInvoicePhotos } from './JobPhotos.jsx';
import OnMyWay from './OnMyWay.jsx';
import PriceBook from './PriceBook.jsx';
// Note: ./printablePdf.js is dynamically imported only when the customer
// taps "Print / Save PDF" on the public viewer page, so the heavy jsPDF
// dependency stays out of the initial bundle.

const NAVY = "#0a1628";
const ORANGE = "#E8622A";
const NAVY2 = "#0f2040";
const CACHE_KEY = "higrade_v6";
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
  { id: 1, name: "Jacob Petersen", email: "jacobmip@gmail.com", email2: "", phone: "", fax: "", address1: "", address2: "", address3: "" },
];

const EXPENSE_CATEGORIES = [
  "Supplies & Materials",
  "Tools & Equipment",
  "Vehicle & Transportation",
  "Meals & Entertainment",
  "Office & Admin",
  "Insurance",
  "Subcontractors",
  "Permits & Licenses",
  "Marketing & Advertising",
  "Other",
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


function calcItemTotal(it) {
  const gross = (it.qty || 1) * (it.price || 0);
  if (!it.discount) return gross;
  return it.discountType === "%" ? gross * (1 - it.discount / 100) : Math.max(0, gross - it.discount);
}
function calcTotals(inv) {
  const sub = inv.items.reduce((s, it) => s + calcItemTotal(it), 0);
  const discVal = inv.discount || 0;
  const disc = inv.discountType === "%" ? sub * (discVal / 100) : discVal;
  const afterDisc = sub - disc;
  const taxAmt = afterDisc * (inv.tax / 100);
  const total = afterDisc + taxAmt;
  const paid = (inv.payments || []).reduce((s, p) => s + p.amount, 0);
  return { sub, disc, afterDisc, taxAmt, total, paid, balance: total - paid };
}
function fmt(n) { return "$" + Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function today() { return new Date().toISOString().slice(0, 10); }
function statusDisplay(inv) {
  if (inv.status === "paid") return { label: "Paid", color: "#4ecb71" };
  if (inv.status === "partial") return { label: "Partial", color: "#f39c12" };
  const t = today();
  const isOverdue = inv.dueDate && inv.dueDate < t;
  const isPending = inv.dueDate && inv.dueDate > t;
  if (inv.status === "net30") return { label: isOverdue ? "Overdue" : "Net 30", color: isOverdue ? "#e74c3c" : "#2980b9" };
  if (isOverdue) return { label: "Overdue", color: "#e74c3c" };
  if (isPending) return { label: "Pending", color: "#2980b9" };
  return { label: "Outstanding", color: ORANGE };
}
function fmtDate(d) { if (!d) return "—"; const [y, m, day] = d.split("-"); return `${m}/${day}/${y}`; }

// Persists component state to localStorage as a safety net for iOS Safari
// backgrounding. Restores the draft on mount if it is newer than the last
// server-saved version. Saving is debounced 500 ms. Returns a clearDraft()
// function to call after a successful explicit save.
//
// Usage:
//   const clearDraft = useDraftPersistence(key, state, setState, serverUpdatedAt);
//
// • state = null/undefined → immediately removes the draft (edit closed).
// • serverUpdatedAt → ISO string; draft is skipped if server version is newer.
function useDraftPersistence(key, state, setState, serverUpdatedAt) {
  const timerRef = useRef(null);
  // skipSaveRef starts true so the first render does not overwrite an existing
  // draft before the restore check in useLayoutEffect has a chance to run.
  const skipSaveRef = useRef(true);
  const stateRef = useRef(state);
  stateRef.current = state;

  useLayoutEffect(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw) {
        const { state: draft, savedAt } = JSON.parse(raw);
        const serverMs = serverUpdatedAt ? new Date(serverUpdatedAt).getTime() : 0;
        if (savedAt > serverMs) setState(draft);
      }
    } catch {}
    skipSaveRef.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Flush to localStorage immediately when iOS backgrounds the page so we
  // never lose edits that are still inside the 500 ms debounce window.
  useEffect(() => {
    const flush = () => {
      if (document.visibilityState !== 'hidden') return;
      if (skipSaveRef.current || stateRef.current == null) return;
      if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
      try { localStorage.setItem(key, JSON.stringify({ state: stateRef.current, savedAt: Date.now() })); } catch {}
    };
    document.addEventListener('visibilitychange', flush);
    return () => document.removeEventListener('visibilitychange', flush);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (skipSaveRef.current) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    if (state == null) {
      try { localStorage.removeItem(key); } catch {}
      return;
    }
    timerRef.current = setTimeout(() => {
      try {
        localStorage.setItem(key, JSON.stringify({ state, savedAt: Date.now() }));
      } catch {}
    }, 500);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  return function clearDraft() {
    if (timerRef.current) clearTimeout(timerRef.current);
    try { localStorage.removeItem(key); } catch {}
  };
}

// Match an invoice/estimate against a search query. Searches across:
//   - invoice ID (e.g. "INV0753")
//   - client name
//   - line item names and descriptions
//   - notes
//   - job-site address (label + lines) and billing address
// All terms (whitespace-separated) must match somewhere. Case-insensitive.
function matchesSearch(inv, query) {
  const q = (query || "").trim().toLowerCase();
  if (!q) return true;
  const terms = q.split(/\s+/).filter(Boolean);
  const ja = inv.jobAddress || {};
  const ba = inv.billingAddress || {};
  const haystackParts = [
    inv.id || "",
    inv.client || "",
    inv.notes || "",
    ja.label || "", ja.line1 || "", ja.line2 || "", ja.line3 || "",
    ba.line1 || "", ba.line2 || "", ba.line3 || "",
  ];
  for (const it of (inv.items || [])) {
    haystackParts.push(it.name || "", it.desc || "");
  }
  const haystack = haystackParts.join(" ").toLowerCase();
  return terms.every(t => haystack.includes(t));
}

// Compact search-bar component reused on the Invoices and Estimates tabs.
function SearchBar({ value, onChange, placeholder }) {
  return (
    <div style={{ background: "#fff", padding: "8px 12px", borderBottom: "1px solid #eee", position: "relative" }}>
      <input
        type="search"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder || "Search"}
        style={{
          width: "100%",
          background: "#f4f6fa",
          border: "1px solid #dde2ee",
          borderRadius: 8,
          padding: "9px 32px 9px 34px",
          fontSize: 14,
          outline: "none",
          boxSizing: "border-box",
          WebkitAppearance: "none",
        }}
      />
      <span style={{ position: "absolute", left: 22, top: "50%", transform: "translateY(-50%)", color: "#8899bb", fontSize: 14, pointerEvents: "none" }}>⌕</span>
      {value && (
        <button
          onClick={() => onChange("")}
          aria-label="Clear search"
          style={{ position: "absolute", right: 18, top: "50%", transform: "translateY(-50%)", background: "#dde2ee", border: "none", borderRadius: "50%", width: 20, height: 20, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "#666", fontSize: 12, lineHeight: 1, padding: 0 }}
        >×</button>
      )}
    </div>
  );
}

function buildGlobalSystemPrompt(data) {
  // Split docs by type so invoices and estimates aren't lumped together in
  // the model's context. Each list is capped at 20 to keep the prompt small.
  const realInvoices = data.invoices.filter(i => i.type !== "estimate");
  const realEstimates = data.invoices.filter(i => i.type === "estimate");
  const fmtLine = (inv) => {
    const t = calcTotals(inv);
    return `  ${inv.id} | ${inv.client} | ${fmt(t.total)} | ${inv.status} | ${inv.date}`;
  };
  const invoiceLines = realInvoices.slice(0, 20).map(fmtLine).join("\n");
  const estimateLines = realEstimates.slice(0, 20).map(fmtLine).join("\n");
  const clientLines = data.clients.map(c =>
    `  ${c.name}${c.email ? " | " + c.email : ""}${c.phone ? " | " + c.phone : ""}`
  ).join("\n");
  const savedItemLines = (data.savedItems || []).map(i => `  ${i.name}: $${i.price}`).join("\n");

  return `You are Jake's AI assistant for HI Grade Plumbing LLC's invoicing app (Honolulu, Hawaii). You have full control over the app.

COUNTS: ${realInvoices.length} invoices, ${realEstimates.length} estimates, ${data.clients.length} clients. Invoices and estimates are SEPARATE — never combine the totals.

CURRENT INVOICES (ID | Client | Total | Status | Date) — these are billable invoices, NOT estimates:
${invoiceLines || "  (none)"}

CURRENT ESTIMATES (ID | Client | Total | Status | Date) — these are quotes/bids, NOT invoices:
${estimateLines || "  (none)"}

CLIENTS (Name | Email | Phone):
${clientLines || "  (none)"}

JAKE'S SAVED PRICES — always use these exact prices when generating estimates or invoices for matching jobs:
${savedItemLines || "  (none saved yet)"}

FALLBACK HONOLULU PRICING (only use if no saved price matches):
Drain snake $300–$450 | Hydro-jet $550–$950 | Toilet repair $220–$380 | Toilet replace $550–$950
Faucet repair $195–$350 | Faucet replace $450–$750 | Water heater elec 40gal $1,400–$2,200
Water heater gas 40gal $1,800–$2,800 | Tankless $3,200–$5,500 | Sewer camera $350–$550
Sewer spot repair $1,800–$4,500 | Gas line repair $800–$2,500 | Bathroom remodel $4,500–$12,000

ACTIONS — respond with ONLY JSON, no markdown fences, no extra text.
For a SINGLE action use a JSON object. For MULTIPLE actions use a JSON array:

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

Create a new client:
{"action":"create_client","client":{"name":"Full Name","email":"","email2":"","phone":"","address1":"","address2":"","address3":""},"summary":"one sentence"}

Update an existing invoice (set client, dates, status, notes — only include the fields you want to change):
{"action":"update_invoice","invoiceId":"INV0000","changes":{"client":"exact name","date":"YYYY-MM-DD","dueDate":"YYYY-MM-DD","status":"outstanding|paid|partial|net30","notes":"text","discount":0,"tax":4.712},"summary":"one sentence"}

Delete an invoice or estimate:
{"action":"delete_invoice","invoiceId":"INV0000","summary":"one sentence"}

Record a payment on an invoice:
{"action":"add_payment","invoiceId":"INV0000","payment":{"amount":000,"method":"Cash|Check|Venmo|Zelle|Card|Other","date":"YYYY-MM-DD"},"summary":"one sentence"}

Remove a line item from an invoice (1-based index as it appears in the invoice):
{"action":"remove_item","invoiceId":"INV0000","itemIndex":1,"summary":"one sentence"}

Update an existing line item on an invoice (1-based index; only include fields to change). USE THIS for ANY change to an existing line — description rewrites, name changes, qty/price tweaks, marking taxable. "Adjust the description", "rewrite the desc", "change the price", "tweak line 1", "add a step to the description", "include that I'm replacing the 1 inch drain" → ALL update_item:
{"action":"update_item","invoiceId":"INV0000","itemIndex":1,"changes":{"name":"...","desc":"...","qty":1,"price":000,"taxable":true},"summary":"one sentence"}

Example — Jake says "adjust the invoice so the description includes that I'm replacing the 1 inch drain":
{"action":"update_item","invoiceId":"INV0000","itemIndex":1,"changes":{"desc":"Cut out failing 1 inch PVC section below drain\nRemove elbow fitting from existing line\nReplace 1 inch drain pipe (the failing leaking part)\nInstall new 1 inch female adapter\nGlue and prime new fittings\nPressure test repair for leaks"},"summary":"Updated description to call out the 1 inch drain replacement."}

Update a client's contact info (only include fields to change):
{"action":"update_client","clientName":"exact name","changes":{"email":"","email2":"","phone":"","address1":"","address2":"","address3":""},"summary":"one sentence"}

Delete a client:
{"action":"delete_client","clientName":"exact name","summary":"one sentence"}

RULES:
- Match client names exactly as they appear in CLIENTS above. Always include the client field.
- When generating an estimate or invoice, check JAKE'S SAVED PRICES first — if a match exists, use that exact price.
- One flat-rate line item per job. Never add a separate service call.
- Item name: short title, 6 words max. Item desc: newline-separated work steps, no bullets or dashes, minimum 6 steps.
- Category for save_item must be one of: Drain, Toilet, Faucet, Water Heater, Sewer, Gas, Service, Custom.
- For plain questions or conversation, reply in plain text without JSON.
- CRITICAL: If Jake asks you to change, edit, adjust, tweak, rewrite, modify, or update ANY field on an existing line item — name, description, qty, price, taxable — you MUST emit an update_item action JSON. NEVER reply in plain text saying you updated something. The app only changes when it sees the JSON. If you reply "I've updated..." or "Updated the description..." without emitting the JSON action, the change does NOT happen and Jake sees a lie. Always emit the JSON.
- When asked to create multiple invoices or estimates (e.g. "create 10 invoices", "make 5 sample estimates", "create 10 invoices and 10 estimates"), you MUST return ONE single JSON array containing one action object per document — never just one. If asked for 10 invoices, the array MUST have exactly 10 create_invoice objects. If asked for "10 invoices and 10 estimates", return ONE array with 20 objects total (10 create_invoice + 10 create_estimate). Do not split across multiple turns; do not stop after the first object. Vary clients, dates, and items across the documents. Keep desc concise (6 short steps) when generating in bulk so the full array fits in your response. Example shape: [{"action":"create_invoice",...},{"action":"create_invoice",...}, ...]
- IMPORTANT: To save an estimate use action "create_estimate". Never use action "estimate" — that is not a valid action in this context.
- NO BULK DELETES: You can delete ONE invoice or estimate at a time using delete_invoice. Never delete more than one in a single turn. If Jake asks to "delete all invoices", "wipe everything", "clear them all", or anything similar, refuse politely and tell him bulk deletes are handled outside the chat for safety — he should ask Computer (the agent that built this app) to do it directly.`;
}

async function callAI(messages, systemPrompt = null, opts = {}) {
  // Heuristic: bulk-doc requests need lots of tokens. Look at the latest user
  // message for numbers like "10 invoices" or "create 5 estimates" and bump
  // the limit so the response doesn't truncate to a single doc.
  let maxTokens = opts.maxTokens;
  if (!maxTokens) {
    try {
      const lastUser = [...(messages || [])].reverse().find(m => m.role === "user");
      const txt = typeof lastUser?.content === "string"
        ? lastUser.content
        : (Array.isArray(lastUser?.content) ? lastUser.content.map(c => c?.text || "").join(" ") : "");
      const nums = [...txt.matchAll(/(\d{1,3})\s*(invoice|estimate|quote|bid|sample|doc)/gi)].map(m => parseInt(m[1], 10));
      const total = nums.reduce((a, b) => a + b, 0);
      if (total >= 3) maxTokens = 8192; // ceiling — server clamps anyway
    } catch {}
  }
  const res = await fetch(api("/api/ai"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messages,
      ...(systemPrompt ? { systemPrompt } : {}),
      ...(maxTokens ? { maxTokens } : {}),
    }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || data.error);
  return data.content?.[0]?.text || "";
}

function extractActionsJSON(text) {
  const stripped = text.replace(/```(?:json)?\s*/gi, '').replace(/```/g, '').trim();
  // Try direct parse (array or object)
  try {
    const p = JSON.parse(stripped);
    if (Array.isArray(p)) return p.filter(a => a?.action);
    if (p?.action) return [p];
  } catch {}
  // Try extracting a JSON array from surrounding text
  const arrMatch = stripped.match(/\[[\s\S]*\]/);
  if (arrMatch) {
    try {
      const p = JSON.parse(arrMatch[0]);
      if (Array.isArray(p)) return p.filter(a => a?.action);
    } catch {}
  }
  // Scan for individual JSON objects with balanced braces
  const actions = [];
  let depth = 0, start = -1;
  for (let i = 0; i < stripped.length; i++) {
    if (stripped[i] === '{') { if (depth === 0) start = i; depth++; }
    else if (stripped[i] === '}') {
      depth--;
      if (depth === 0 && start !== -1) {
        try { const p = JSON.parse(stripped.slice(start, i + 1)); if (p?.action) actions.push(p); } catch {}
        start = -1;
      }
    }
  }
  return actions;
}
function extractActionJSON(text) { return extractActionsJSON(text)[0] || null; }

function stripActionBlocks(text) {
  if (!text) return text;
  let t = text.replace(/```(?:json)?[ \t]*\r?\n?([\s\S]*?)```/g, (match, inner) => {
    try { const p = JSON.parse(inner.trim()); if (p?.action || (Array.isArray(p) && p[0]?.action)) return ''; } catch {}
    return match;
  });
  let result = '', i = 0;
  while (i < t.length) {
    if (t[i] === '{') {
      let depth = 0, start = i, j = i;
      while (j < t.length) { if (t[j] === '{') depth++; else if (t[j] === '}') { depth--; if (depth === 0) break; } j++; }
      let isAction = false;
      try { const p = JSON.parse(t.slice(start, j + 1)); if (p?.action) isAction = true; } catch {}
      if (isAction) { i = j + 1; } else { result += t[i]; i++; }
    } else { result += t[i]; i++; }
  }
  return result.replace(/\n{3,}/g, '\n\n').trim();
}

async function sendInvoiceEmail(invoice, client, message, viewLink) {
  const t = calcTotals(invoice);
  // Review-request links are only attached to invoice emails (estimates
  // get sent before the job is done, so we never ask for a review there).
  // Server-side, the email template only renders the footer when the
  // array has at least one entry, so passing [] is safe.
  const reviewLinks = invoice?.type === 'estimate' ? [] : resolveReviewLinks();
  // When the invoice is paid in full, the server flips the subject to a
  // "Mahalo — paid in full" receipt line and changes the CTA button from
  // "Review & Pay" to "View Receipt".
  const isPaidInFull = invoice?.type !== 'estimate' && t.paid > 0 && t.balance <= 0.01;
  // Find the latest payment for the receipt header (method + date).
  let lastPayment = null;
  if (isPaidInFull && Array.isArray(invoice.payments) && invoice.payments.length > 0) {
    const sorted = [...invoice.payments].sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
    const p = sorted[0];
    lastPayment = { method: p.method || 'payment', date: p.date || null };
  }
  // Link-only email: server renders a Review & Pay button and minimal
  // summary. We no longer pass a full items table so the customer is
  // motivated to click the link (which is what we track). Customers can
  // print a letter-sized PDF copy from the public viewer page itself —
  // no attachment needed in the email.
  const res = await fetch(api("/api/send-email"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      to: client.email,
      cc: client.email2 || "",
      clientName: client.name,
      invoiceId: invoice.id,
      total: t.total.toFixed(2),
      message: message || "",
      viewLink: viewLink || "",
      reviewLinks,
      isPaidInFull,
      lastPayment,
    }),
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
    paperclip: <svg {...p}><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>,
    send:      <svg {...p}><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>,
    trash:     <svg {...p}><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>,
    back:      <svg {...p}><polyline points="15 18 9 12 15 6"/></svg>,
    mail:      <svg {...p}><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>,
    phone:     <svg {...p}><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.37 1.9.72 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.35 1.85.59 2.81.72A2 2 0 0 1 22 16.92z"/></svg>,
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
    chart:     <svg {...p}><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>,
    pen:       <svg {...p}><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>,
    receipt:   <svg {...p}><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>,
    camera:    <svg {...p}><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>,
    person:    <svg {...p}><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>,
    speaker:   <svg {...p}><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>,
    speakerOff:<svg {...p}><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>,
    more:      <svg {...p}><circle cx="5" cy="12" r="1.6" fill={color} stroke="none"/><circle cx="12" cy="12" r="1.6" fill={color} stroke="none"/><circle cx="19" cy="12" r="1.6" fill={color} stroke="none"/></svg>,
    print:     <svg {...p}><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/><line x1="9" y1="17" x2="15" y2="17"/></svg>,
    swap:      <svg {...p}><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>,
    history:   <svg {...p}><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><polyline points="3 3 3 8 8 8"/><polyline points="12 7 12 12 15 14"/></svg>,
    settings:  <svg {...p}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>,
  };
  return icons[name] || null;
};

// When a numeric field's value is the placeholder "0" (or any value really)
// the cursor lands AFTER the digit on tap, so typing produces "01", "02" etc.
// Selecting the contents on focus lets the user just start typing to replace.
// Use a tiny timeout because iOS Safari resets the selection right after
// focusing if you don't.
const selectOnFocus = (e) => {
  const el = e.target;
  setTimeout(() => { try { el.select(); } catch {} }, 0);
};

// Long-press handler for iOS-style "hold to delete" interactions. Returns
// the props you spread onto the target element. The handler fires only if
// the user actually holds for the full duration without moving (cancels on
// scroll). When it fires, we also suppress the next click so a long-press
// doesn't double-trigger the tap action that's wired to the same element.
function useLongPress(onLongPress, { ms = 500, moveTolerance = 8 } = {}) {
  const timerRef = useRef(null);
  const startRef = useRef({ x: 0, y: 0 });
  const firedRef = useRef(false);

  const cancel = () => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
  };

  const start = (e) => {
    firedRef.current = false;
    const t = e.touches ? e.touches[0] : e;
    startRef.current = { x: t.clientX, y: t.clientY };
    cancel();
    timerRef.current = setTimeout(() => {
      firedRef.current = true;
      // iOS haptic-ish: a 12ms vibration if the device supports it.
      try { navigator.vibrate?.(12); } catch {}
      onLongPress();
    }, ms);
  };

  const move = (e) => {
    if (!timerRef.current) return;
    const t = e.touches ? e.touches[0] : e;
    const dx = t.clientX - startRef.current.x;
    const dy = t.clientY - startRef.current.y;
    if (Math.abs(dx) > moveTolerance || Math.abs(dy) > moveTolerance) cancel();
  };

  return {
    onPointerDown: start,
    onPointerMove: move,
    onPointerUp: cancel,
    onPointerCancel: cancel,
    onPointerLeave: cancel,
    // Suppress the click that follows a successful long-press so the tap
    // handler on the same element doesn't fire (e.g. opening the invoice).
    onClickCapture: (e) => {
      if (firedRef.current) {
        e.preventDefault();
        e.stopPropagation();
        firedRef.current = false;
      }
    },
  };
}

const S = {
  btn: (v = "primary") => ({
    background: v === "primary" ? ORANGE : v === "navy" ? NAVY : v === "green" ? "#27ae60" : "#e8ecf4",
    color: v === "ghost" ? "#444" : "#fff",
    border: "none", borderRadius: 8, padding: "10px 18px",
    fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 14, letterSpacing: 1,
    cursor: "pointer",
  }),
  input: {
    width: "100%", minWidth: 0, maxWidth: "100%", border: "1.5px solid #dde2ee", borderRadius: 8,
    padding: "9px 12px", fontSize: 14, fontFamily: "'Barlow', sans-serif",
    outline: "none", background: "#fff", boxSizing: "border-box",
    touchAction: "manipulation",
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

// ─── AI Chat Panel (per-invoice with full app control) ───────────────────────
// Resize an image File to a max dimension and return a base64 data URL.
// Used by the AI chat to keep payloads sane for the Vercel function body
// limit (~4.5MB) and to cap per-photo token cost (~1500 tokens).
function resizeImageToDataUrl(file, maxDim = 1600, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          const scale = maxDim / Math.max(width, height);
          width = Math.round(width * scale);
          height = Math.round(height * scale);
        }
        const canvas = document.createElement("canvas");
        canvas.width = width; canvas.height = height;
        canvas.getContext("2d").drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

function AIChatPanel({ msgs, setMsgs, onResetChat, onAddItems, data, currentInvoice, onLocalAction, onGlobalAction }) {
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [listening, setListening] = useState(false);
  // Pending photos waiting to be sent with the next message.
  // Each entry: { dataUrl, name }.
  const [pendingPhotos, setPendingPhotos] = useState([]);
  const endRef = useRef(null);
  const panelRef = useRef(null);
  const inputElRef = useRef(null);
  const fileInputRef = useRef(null);
  // Only auto-scroll when new messages arrive or the loading indicator
  // toggles. Earlier this also fired on every visualViewport change, which
  // meant every keystroke (iOS keyboard animation tweaks the viewport)
  // re-scrolled the panel and made the chat feel like it was jumping.
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }); }, [msgs, loading]);

  // Hold the active recognition instance so we can stop a stuck one and
  // toggle the mic button off without crashing the whole app. iOS Safari
  // throws synchronously from start() if a recognizer is already running
  // or if mic permission is denied — both have to be caught.
  const recRef = useRef(null);
  const startListening = () => {
    // Toggle off if already listening.
    if (recRef.current) {
      try { recRef.current.stop(); } catch {}
      recRef.current = null;
      setListening(false);
      return;
    }
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { alert("Voice dictation isn\u2019t supported in this browser. Try Safari on iPhone or Chrome on desktop."); return; }
    let r;
    try { r = new SR(); } catch (err) { alert("Couldn\u2019t start voice: " + (err?.message || err)); return; }
    r.lang = "en-US";
    r.onresult = e => {
      try {
        const transcript = e.results?.[0]?.[0]?.transcript || "";
        setInput(p => {
          const next = (p + " " + transcript).trim();
          if (inputElRef.current) inputElRef.current.innerText = next;
          return next;
        });
      } catch {}
    };
    r.onerror = (e) => {
      setListening(false); recRef.current = null;
      const code = e?.error;
      if (code === "not-allowed" || code === "service-not-allowed") {
        alert("Microphone permission denied. Enable it in Settings \u2192 Safari \u2192 Microphone.");
      } else if (code && code !== "aborted" && code !== "no-speech") {
        console.warn("speech recognition error:", code);
      }
    };
    r.onend = () => { setListening(false); recRef.current = null; };
    try {
      r.start();
      recRef.current = r;
      setListening(true);
    } catch (err) {
      // start() throws if called twice or before user gesture / on insecure origin.
      console.warn("speech start() threw:", err);
      recRef.current = null;
      setListening(false);
      alert("Couldn\u2019t start voice. If this keeps happening, reload the page.");
    }
  };

  // Photo handling — paperclip button picks files, we resize and stash
  // until the user hits send. Each send call includes any pending photos
  // as image content blocks, then clears the queue.
  const onPickPhotos = async (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = ""; // allow re-picking the same file later
    if (!files.length) return;
    const added = [];
    for (const f of files) {
      try {
        const dataUrl = await resizeImageToDataUrl(f, 1600, 0.82);
        added.push({ dataUrl, name: f.name });
      } catch (err) {
        // Skip files that won't decode — don't fail the whole pick.
      }
    }
    if (added.length) setPendingPhotos(p => [...p, ...added]);
  };
  const removePendingPhoto = (idx) => {
    setPendingPhotos(p => p.filter((_, i) => i !== idx));
  };

  const send = async () => {
    const text = input.trim();
    const hasPhotos = pendingPhotos.length > 0;
    if ((!text && !hasPhotos) || loading) return;
    setInput("");
    // The contenteditable div is uncontrolled — React's setInput("") doesn't
    // touch the DOM, so manually clear its innerText after sending.
    if (inputElRef.current) inputElRef.current.innerText = "";
    // Snapshot photos for this send and clear the input queue.
    const photosForSend = pendingPhotos;
    setPendingPhotos([]);
    const userMsg = {
      role: "user",
      text: text || (hasPhotos ? `[${photosForSend.length} photo${photosForSend.length === 1 ? "" : "s"} attached]` : ""),
      photos: photosForSend.length ? photosForSend.map(p => p.dataUrl) : undefined,
    };
    setMsgs(p => [...p, userMsg]); setLoading(true);
    try {
      // Context-aware system prompt: global knowledge + the open invoice.
      const systemBase = data ? buildGlobalSystemPrompt(data) : null;
      let invoiceContext = "";
      if (currentInvoice) {
        const itemList = (currentInvoice.items || []).map((it, i) =>
          `  ${i + 1}. ${it.name || it.desc || "(unnamed)"} — qty ${it.qty || 1} @ $${it.price || 0}`
        ).join("\n");
        invoiceContext = `\n\nCURRENT OPEN ${(currentInvoice.type || 'invoice').toUpperCase()} (Jake is editing this one right now):\n  ID: ${currentInvoice.id || '(unsaved)'}\n  Client: ${currentInvoice.client || '(none)'}\n  Date: ${currentInvoice.date}\n  Due: ${currentInvoice.dueDate}\n  Status: ${currentInvoice.status}\n  Notes: ${currentInvoice.notes || '(none)'}\n  Line items:\n${itemList || '  (none)'}\n\nIMPORTANT: When Jake says "this invoice", "the invoice", "this estimate", "change the client", "add an item", "add a line", "add a service call", etc. without specifying an ID — he means THIS one. ALWAYS set invoiceId to "${currentInvoice.id || 'unsaved'}" on add_items / update_invoice / add_payment / remove_item / update_item actions when he refers to the current document. NEVER tell Jake how to do something manually — always emit the JSON action that does it for him. NEVER claim you added or changed something without emitting the action JSON — the app only changes when it sees the JSON.`;
      }
      const systemPrompt = systemBase ? systemBase + invoiceContext : null;
      // Build history. Past user messages with photos get converted to
      // text-only references ("[photo from earlier]") so we don't blow
      // the token budget by re-sending every prior image. Only the
      // CURRENT send includes raw image blocks.
      const history = [...msgs, userMsg]
        .filter(m => m.text?.trim() || m.photos?.length)
        .map((m, i, arr) => {
          const isLatest = i === arr.length - 1;
          if (m.role === "user" && isLatest && m.photos?.length) {
            // Multimodal content: image blocks + text block.
            const blocks = m.photos.map(dataUrl => {
              const match = String(dataUrl).match(/^data:([^;]+);base64,(.+)$/);
              if (!match) return null;
              return {
                type: "image",
                source: { type: "base64", media_type: match[1], data: match[2] },
              };
            }).filter(Boolean);
            blocks.push({ type: "text", text: m.text || "(see attached photo)" });
            return { role: "user", content: blocks };
          }
          return { role: m.role === "user" ? "user" : "assistant", content: m.text || "" };
        });
      const first = history.findIndex(m => m.role === "user");
      const reply = await callAI(first >= 0 ? history.slice(first) : history, systemPrompt);
      const actions = extractActionsJSON(reply);
      const cleanText = stripActionBlocks(reply);

      // Defensive guard: the model sometimes claims it updated a line item
      // ("I've updated the description...") without emitting the action JSON.
      // If we detect that pattern with no actions, retry once forcing JSON.
      const claimsChange = /\b(i'?ve\s+updated|i\s+updated|i'?ve\s+changed|i\s+changed|updated\s+the\s+(description|line|item|price|qty|name)|changed\s+the\s+(description|line|item|price|qty|name))\b/i.test(cleanText || "");
      if (actions.length === 0 && claimsChange && currentInvoice) {
        const retryReply = await callAI(
          [...(first >= 0 ? history.slice(first) : history), { role: "assistant", content: reply }, { role: "user", content: "You replied in plain text but the app only applies changes when you emit JSON. Re-send the SAME change as a proper update_item action JSON now. Reply with ONLY the JSON, nothing else." }],
          systemPrompt
        );
        const retryActions = extractActionsJSON(retryReply);
        if (retryActions.length) {
          actions.push(...retryActions);
        } else {
          setMsgs(p => [...p, { role: "assistant", text: "⚠️ I claimed to update something but didn't emit the action. Try rephrasing, e.g. \"update line 1 description to: <new text>\"." }]);
          setLoading(false); return;
        }
      }

      // The legacy 'estimate' action stays as a preview-then-confirm card.
      const previewEstimate = actions.find(a => a.action === "estimate" && a.items?.length);
      const otherActions = actions.filter(a => a !== previewEstimate);

      // Actions that operate on a single invoice. When the chat is open
      // inside an invoice, Jake almost always means "this invoice" — even
      // if the model forgot to echo invoiceId, sent "unsaved", or sent the
      // wrong id. We force-route those to the local handler (which mutates
      // the open form for instant feedback) so "add a service call line"
      // never silently no-ops on a draft invoice.
      const INVOICE_OPS = new Set([
        'add_items', 'update_invoice', 'add_payment',
        'remove_item', 'update_item',
      ]);
      if (otherActions.length && onGlobalAction) {
        for (const a of otherActions) {
          const isInvoiceOp = INVOICE_OPS.has(a.action);
          const idMatches = currentInvoice && a.invoiceId && a.invoiceId === currentInvoice.id;
          // Treat "no id", "unsaved", or any id when the open invoice has no
          // id yet, as referring to the current invoice. This is the fix for
          // the bug where adding a line to an unsaved/open invoice claimed
          // success but never actually persisted.
          const looksLikeCurrent = currentInvoice && isInvoiceOp && (
            idMatches
            || !a.invoiceId
            || a.invoiceId === 'unsaved'
            || a.invoiceId === '(unsaved)'
            || !currentInvoice.id
          );
          let handledLocally = false;
          if (looksLikeCurrent && onLocalAction) {
            handledLocally = !!(await onLocalAction(a));
          }
          if (!handledLocally) await onGlobalAction(a);
        }
      }

      const summaryFromActions = otherActions.map(a => a.summary).filter(Boolean).join("\n");
      const replyText = previewEstimate
        ? (previewEstimate.summary || "Here's your estimate:")
        : (cleanText || summaryFromActions || (otherActions.length ? "✓ Done" : reply));

      setMsgs(p => [...p, { role: "assistant", text: replyText, estimate: previewEstimate || undefined }]);
    } catch (e) { setMsgs(p => [...p, { role: "assistant", text: "Error: " + e.message }]); }
    setLoading(false);
  };

  // Keep the chat panel in normal page flow at a stable height. iOS handles
  // scrolling the focused input into view on its own. Earlier versions tried
  // to promote the panel to a fixed overlay tied to visualViewport metrics
  // and lock body scroll on focus — that combination made the box visibly
  // shift around on every keystroke as the keyboard animated.
  const containerStyle = { position: "relative", height: 400, background: "#f4f6fa", borderRadius: 12, overflow: "hidden", border: "1.5px solid #dde2ee" };

  return (
    <div ref={panelRef} data-no-swipe="true" style={containerStyle}>
      <style>{`@keyframes bounce{0%,80%,100%{transform:translateY(0)}40%{transform:translateY(-8px)}}`}</style>
      {msgs.length > 1 && onResetChat && (
        <button
          onClick={() => { if (confirm("Clear this invoice's chat history?")) onResetChat(); }}
          title="Clear chat"
          style={{ position: "absolute", top: 8, right: 10, zIndex: 5, background: "rgba(255,255,255,0.92)", border: "1px solid #dde2ee", borderRadius: 16, padding: "4px 10px", fontSize: 11, fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, color: "#888", letterSpacing: 1, cursor: "pointer", textTransform: "uppercase", boxShadow: "0 1px 4px rgba(0,0,0,0.08)" }}
        >Clear</button>
      )}
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 62, overflowY: "auto", padding: 14 }}>
        {msgs.map((m, i) => (
          <div key={i} style={{ marginBottom: 10, display: "flex", justifyContent: m.role === "user" ? "flex-end" : "flex-start" }}>
            <div style={{ maxWidth: "85%", background: m.role === "user" ? NAVY : "#fff", color: m.role === "user" ? "#fff" : "#1a1a1a", borderRadius: m.role === "user" ? "14px 14px 4px 14px" : "14px 14px 14px 4px", padding: "10px 13px", fontSize: 13, lineHeight: 1.55, boxShadow: "0 1px 4px rgba(0,0,0,0.09)" }}>
              {m.photos?.length > 0 && (
                <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: m.text ? 6 : 0 }}>
                  {m.photos.map((src, j) => (
                    <img key={j} src={src} alt="" style={{ width: 80, height: 80, borderRadius: 6, objectFit: "cover" }} />
                  ))}
                </div>
              )}
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
      {/* Pending-photos thumbnail strip, shown above the input bar when
          Jake has attached photos but hasn't sent yet. */}
      {pendingPhotos.length > 0 && (
        <div style={{ position: "absolute", bottom: 62, left: 0, right: 0, background: "#fff", borderTop: "1px solid #dde2ee", padding: "8px 10px", display: "flex", gap: 6, flexWrap: "wrap", maxHeight: 90, overflowY: "auto" }}>
          {pendingPhotos.map((p, i) => (
            <div key={i} style={{ position: "relative", width: 56, height: 56, borderRadius: 8, backgroundImage: `url('${p.dataUrl}')`, backgroundSize: "cover", backgroundPosition: "center", border: "1px solid #dde2ee" }}>
              <button
                onClick={() => removePendingPhoto(i)}
                aria-label="Remove photo"
                style={{ position: "absolute", top: -6, right: -6, width: 20, height: 20, borderRadius: "50%", background: "#c33", color: "#fff", border: "none", cursor: "pointer", fontSize: 13, lineHeight: 1, padding: 0 }}
              >×</button>
            </div>
          ))}
        </div>
      )}
      <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, minHeight: 62, background: "#fff", borderTop: "1px solid #dde2ee", display: "flex", alignItems: "flex-end", gap: 8, padding: "12px 10px" }}>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          style={{ display: "none" }}
          onChange={onPickPhotos}
        />
        <button
          onClick={() => fileInputRef.current?.click()}
          aria-label="Attach photos"
          title="Attach photos"
          style={{ width: 40, height: 40, flexShrink: 0, borderRadius: 8, border: "none", background: "#f0f2f8", color: "#666", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
        ><Icon name="paperclip" size={18} /></button>
        <button onClick={startListening} style={{ width: 40, height: 40, flexShrink: 0, borderRadius: 8, border: "none", background: listening ? ORANGE : "#f0f2f8", color: listening ? "#fff" : "#666", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}><Icon name="mic" size={18} /></button>
        {/*
          Use a contenteditable div instead of <input>/<textarea> so iOS
          Safari doesn't render its contact-autofill suggestion bar (with
          the user's email and the up/down/checkmark form-navigation
          arrows). Safari only shows that bar for true form fields; a
          contenteditable element is treated as rich text and gets a clean
          keyboard with just the standard predictions row.
        */}
        <div
          ref={inputElRef}
          contentEditable
          suppressContentEditableWarning
          role="textbox"
          aria-label="Job description"
          aria-multiline="true"
          spellCheck={true}
          data-placeholder={listening ? "Listening…" : "Describe a job…"}
          style={{ flex: 1, minHeight: 38, maxHeight: 120, border: "1.5px solid #dde2ee", borderRadius: 8, padding: "9px 12px", fontSize: 16, fontFamily: "'Barlow', sans-serif", outline: "none", background: "#f8f9fc", minWidth: 0, lineHeight: "20px", overflowY: "auto", overflowX: "hidden", whiteSpace: "pre-wrap", overflowWrap: "anywhere", WebkitUserModify: "read-write-plaintext-only" }}
          onFocus={() => {
            // After Safari's auto-scroll settles, pull the whole chat
            // panel into view so the LINE ITEMS header sits at the top and
            // the chat history is visible above the input.
            setTimeout(() => { panelRef.current?.scrollIntoView({ block: "start", behavior: "smooth" }); }, 350);
          }}
          onInput={e => setInput(e.currentTarget.innerText)}
          // No Enter-to-send. Enter inserts a newline; the Send button is the
          // only way to submit. Mobile-friendly since Shift+Enter doesn't
          // exist on iOS keyboards.
          onPaste={e => {
            // Force plaintext paste so rich content (e.g. styled text from
            // Notes) doesn't bring HTML formatting into the chat input.
            e.preventDefault();
            const text = (e.clipboardData || window.clipboardData).getData("text");
            document.execCommand("insertText", false, text);
          }}
        />
        <style>{`
          [contenteditable][data-placeholder]:empty::before {
            content: attr(data-placeholder);
            color: #aab1bf;
            pointer-events: none;
          }
        `}</style>
        <button onClick={send} style={{ width: 40, height: 40, flexShrink: 0, borderRadius: 8, border: "none", background: NAVY, color: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}><Icon name="send" size={17} /></button>
      </div>
    </div>
  );
}

// ─── Payment Modal ────────────────────────────────────────────────────────────
function PaymentModal({ invoice, onClose, onSave }) {
  const t = calcTotals(invoice);
  const isEstimate = invoice.type === "estimate";
  // Estimates default the amount field to empty (deposits are usually a
  // partial sum) — invoices default to the full remaining balance.
  const [amount, setAmount] = useState(isEstimate ? "" : Math.max(0, t.balance).toFixed(2));
  const [method, setMethod] = useState("Cash");
  const [date, setDate] = useState(today());
  const [note, setNote] = useState(isEstimate ? "Down payment" : "");
  const parsedAmt = parseFloat(amount) || 0;
  const newPaid = (invoice.payments || []).reduce((s, p) => s + p.amount, 0) + parsedAmt;
  const willOverpay = newPaid > t.total + 0.01;
  const save = () => {
    const payment = { id: Date.now(), amount: parsedAmt, method, date, note: note.trim() };
    const payments = [...(invoice.payments || []), payment];
    const totalPaid = payments.reduce((s, p) => s + p.amount, 0);
    // For estimates, status stays as-is (deposit doesn't "pay" an estimate —
    // it just gets carried over when converted). For invoices, flip to
    // paid/partial as before.
    const newStatus = isEstimate
      ? invoice.status
      : (totalPaid >= t.total - 0.01 ? "paid" : totalPaid > 0 ? "partial" : (invoice.status === "net30" ? "net30" : "outstanding"));
    onSave({ ...invoice, payments, status: newStatus });
    onClose();
  };
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 500, display: "flex", alignItems: "flex-end" }}>
      <div style={{ background: "#fff", width: "100%", borderRadius: "16px 16px 0 0", padding: 24, maxWidth: 480, margin: "0 auto", boxSizing: "border-box" }}>
        <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 20, marginBottom: 4 }}>{isEstimate ? "Record Down Payment" : "Record Payment"}</div>
        <div style={{ fontSize: 13, color: "#888", marginBottom: 16 }}>{invoice.id} · {isEstimate ? `Estimate Total: ${fmt(t.total)} · Remaining: ${fmt(Math.max(0, t.balance))}` : `Balance: ${fmt(Math.max(0, t.balance))}`}</div>
        <div style={{ marginBottom: 12 }}>
          <label style={S.label}>Amount</label>
          <input type="number" style={{ ...S.input, borderColor: willOverpay ? "#cc4444" : undefined }} value={amount} onChange={e => setAmount(e.target.value)} onFocus={selectOnFocus} step="0.01" />
          {willOverpay && <div style={{ fontSize: 11, color: "#cc4444", marginTop: 3 }}>⚠ Overpayment — exceeds balance by {fmt(newPaid - t.total)}</div>}
        </div>
        <div style={{ marginBottom: 12 }}><label style={S.label}>Method</label><select style={S.input} value={method} onChange={e => setMethod(e.target.value)}>{["Cash","Check","Venmo","Zelle","Credit Card","PayPal","Bank Transfer","Other"].map(m => <option key={m}>{m}</option>)}</select></div>
        <div style={{ marginBottom: 12 }}><label style={S.label}>Date</label><input type="date" style={S.input} value={date} onChange={e => setDate(e.target.value)} /></div>
        <div style={{ marginBottom: 20 }}><label style={S.label}>Note <span style={{ fontWeight: 400, color: "#aaa", textTransform: "none", letterSpacing: 0 }}>(optional)</span></label><input style={S.input} value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. Check #1042" /></div>
        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={onClose} style={{ ...S.btn("ghost"), flex: 1 }}>Cancel</button>
          <button onClick={save} style={{ ...S.btn("green"), flex: 2 }}>Save Payment</button>
        </div>
      </div>
    </div>
  );
}

// ─── Send Method Sheet ──────────────────────────────────────────────────────
// Small bottom sheet shown when Jake taps Send. Lets him pick Email (opens
// ConfirmSendModal) or Text Message (opens iOS Messages with the public
// trackable link prefilled). On the Text path we also record a "sent" event.
function SendMethodSheet({ kind, invoice, client, onClose, onPickEmail, onPickText }) {
  const isEstimate = kind === "estimate";
  const phone = client?.phone || "";
  const hasPhone = !!phone.replace(/\D/g, "");
  return createPortal(
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(10,22,40,0.55)", zIndex: 400, display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
      <div onClick={e => e.stopPropagation()} style={{ width: "100%", maxWidth: 480, background: "#fff", borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: "6px 0 max(20px, env(safe-area-inset-bottom))" }}>
        <div style={{ width: 40, height: 4, background: "#dde2ee", borderRadius: 2, margin: "6px auto 14px" }} />
        <div style={{ padding: "0 20px 4px", fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 18, color: NAVY, letterSpacing: 1, textTransform: "uppercase" }}>
          Send {isEstimate ? "estimate" : "invoice"}
        </div>
        <div style={{ padding: "0 20px", fontSize: 12, color: "#888", marginBottom: 14 }}>
          How would you like to send this to {client?.name || "the client"}?
        </div>
        <div style={{ padding: "0 16px", display: "flex", flexDirection: "column", gap: 10 }}>
          <button onClick={onPickEmail} style={{ ...S.btn("navy"), display: "flex", alignItems: "center", gap: 12, padding: "14px 16px", justifyContent: "flex-start" }}>
            <Icon name="mail" size={18} color="#fff" />
            <div style={{ textAlign: "left" }}>
              <div style={{ fontWeight: 700, fontSize: 14 }}>Email</div>
              <div style={{ fontSize: 11, opacity: 0.85, fontWeight: 500 }}>{client?.email || "Add an email address"}</div>
            </div>
          </button>
          <button onClick={onPickText} disabled={!hasPhone} style={{ ...S.btn(hasPhone ? "green" : "ghost"), display: "flex", alignItems: "center", gap: 12, padding: "14px 16px", justifyContent: "flex-start", opacity: hasPhone ? 1 : 0.55 }}>
            <Icon name="phone" size={18} color={hasPhone ? "#fff" : "#888"} />
            <div style={{ textAlign: "left" }}>
              <div style={{ fontWeight: 700, fontSize: 14 }}>Text Message</div>
              <div style={{ fontSize: 11, opacity: 0.85, fontWeight: 500 }}>{hasPhone ? phone : "No phone on file for this client"}</div>
            </div>
          </button>
          <button onClick={onClose} style={{ ...S.btn("ghost"), padding: "12px 16px", marginTop: 4 }}>Cancel</button>
        </div>
      </div>
    </div>,
    document.body
  );
}

// ─── Confirm Send Modal ──────────────────────────────────────────────────────────
// Default email & text message templates. These can be overridden per-user
// from the Settings tab — the override is stored in the Supabase `settings`
// table by key. The renderTemplate helper below substitutes variables:
//   {name}  → recipient name
//   {id}    → invoice/estimate id (e.g. INV0756)
//   {total} → formatted total ($1,234.56)
//   {link}  → trackable public viewer URL
//   {type}  → "invoice" or "estimate"
const DEFAULT_INVOICE_MESSAGE = `Aloha {name},

Please find your invoice attached for the completed work. Payment is due upon receipt. Kindly submit payment at your earliest convenience.

If you have any questions or need assistance with payment, please feel free to reach out.

Mahalo,
HI Grade Plumbing`;

// Default body when the invoice is already paid in full — sending becomes a
// receipt + thank-you instead of a payment request. The send modal swaps to
// this template automatically when calcTotals(invoice).balance <= 0.01 and
// at least one payment row exists.
const DEFAULT_INVOICE_PAID_MESSAGE = `Aloha {name},

Mahalo for your payment. This email confirms that your invoice {id} has been paid in full.

We truly appreciate the opportunity to work with you and your trust in HI Grade Plumbing. If you ever need anything else — a repair, a quote, or just a question — we're a phone call away.

Mahalo,
HI Grade Plumbing`;

const DEFAULT_ESTIMATE_MESSAGE = `Aloha {name},

Mahalo for the opportunity to provide an estimate for your project. Please review the details below and tap "Review & Sign" when you're ready to approve the work.

Let me know if you have any questions or would like to discuss any adjustments.

Mahalo,
HI Grade Plumbing`;

const DEFAULT_INVOICE_TEXT = `Aloha {name},

Here is your invoice {id} from HI Grade Plumbing for {total}. Tap the link to view and pay:
{link}

Mahalo,
HI Grade Plumbing`;

const DEFAULT_ESTIMATE_TEXT = `Aloha {name},

Here is your estimate {id} from HI Grade Plumbing for {total}. Tap the link to review and sign:
{link}

Mahalo,
HI Grade Plumbing`;

// Payment instructions printed on every invoice and estimate (public viewer +
// printable PDF). Customizable in Settings. Mirrors the wording Jake had on
// his old InvoiceSimple invoices.
const DEFAULT_PAYMENT_INSTRUCTIONS = `Payment is due upon receipt unless otherwise agreed in writing. Accepted forms of payment include cash, check, or electronic payment.

Any unpaid balance exceeding 30 days from the invoice date will be subject to a finance charge of {rate}% per month ({rateAnnual}% annually) applied to the outstanding balance until paid in full.

Customer agrees to pay all costs associated with the collection of unpaid balances, including administrative fees, collection agency fees, and legal expenses if applicable.

BY CHECK
HI Grade Plumbing LLC

VENMO
@HIGP808`;

// Default monthly finance-charge rate when an invoice goes >30 days past due.
const DEFAULT_LATE_FEE_RATE = 1.5; // percent per month

// Online payment surcharge defaults. Mirrors PayPal's standard processing
// fee for US business accounts (3.49% + $0.49 per transaction). Hawaii
// allows merchants to surcharge credit card payments as long as the rate
// doesn't exceed actual cost of acceptance, the surcharge is disclosed up
// front, and debit cards are excluded — all of which we do.
const DEFAULT_SURCHARGE_PCT = 3.49;   // percent of balance
const DEFAULT_SURCHARGE_FLAT = 0.49;  // flat fee in dollars
const DEFAULT_SURCHARGE_ENABLED = true;

// Substitute the supported template variables. Missing values fall back to
// sensible blanks so customer-facing copy never shows raw placeholders.
function renderTemplate(tpl, vars) {
  if (!tpl) return "";
  const rate = vars.rate != null ? Number(vars.rate).toString() : "";
  const rateAnnual = vars.rate != null ? (Number(vars.rate) * 12).toString() : "";
  return tpl
    .replaceAll("{name}",  vars.name  || "there")
    .replaceAll("{id}",    vars.id    || "")
    .replaceAll("{total}", vars.total || "")
    .replaceAll("{link}",  vars.link  || "")
    .replaceAll("{type}",  vars.type  || "document")
    .replaceAll("{rate}",       rate)
    .replaceAll("{rateAnnual}", rateAnnual);
}

// Lightweight global cache of saved template overrides so deep components
// (ConfirmSendModal, sendViaText) can read them without prop-drilling. The
// data layer hydrates this on app load and the SettingsTab updates it when
// the user saves a new template.
const messageTemplates = {
  email_invoice:  null, // null = use default
  email_estimate: null,
  text_invoice:   null,
  text_estimate:  null,
  payment_instructions: null,
  late_fee_rate:  null, // null = use DEFAULT_LATE_FEE_RATE
  surcharge_enabled: null, // null = use DEFAULT_SURCHARGE_ENABLED
  surcharge_pct:     null, // null = use DEFAULT_SURCHARGE_PCT
  surcharge_flat:    null, // null = use DEFAULT_SURCHARGE_FLAT
  // Per-platform review request toggles. When enabled, the bottom of
  // invoice emails (not estimates) gets a friendly "leave us a review"
  // footer with a button per active platform. Google stays off by
  // default until the business is verified on Google.
  review_yelp_enabled:   null, // null = use DEFAULT_REVIEW_YELP_ENABLED
  review_yelp_url:       null, // null = use DEFAULT_REVIEW_YELP_URL
  review_google_enabled: null, // null = use DEFAULT_REVIEW_GOOGLE_ENABLED
  review_google_url:     null, // null = use DEFAULT_REVIEW_GOOGLE_URL
};

// Review-request defaults. Yelp link is the live HI Grade Plumbing page;
// Google stays empty + disabled until the business is verified on Google.
const DEFAULT_REVIEW_YELP_ENABLED = false;
const DEFAULT_REVIEW_YELP_URL = 'https://www.yelp.com/biz/hi-grade-plumbing-honolulu';
const DEFAULT_REVIEW_GOOGLE_ENABLED = false;
const DEFAULT_REVIEW_GOOGLE_URL = '';

// Resolve the active set of review platforms to advertise in invoice
// emails. Returns an array of { platform, url } in display order, only
// including platforms that are both enabled AND have a usable URL.
function resolveReviewLinks() {
  const out = [];
  const yEn = messageTemplates.review_yelp_enabled;
  const yEnabled = yEn == null ? DEFAULT_REVIEW_YELP_ENABLED : !!yEn;
  const yUrl = String(messageTemplates.review_yelp_url ?? DEFAULT_REVIEW_YELP_URL ?? '').trim();
  if (yEnabled && yUrl) out.push({ platform: 'yelp', url: yUrl });

  const gEn = messageTemplates.review_google_enabled;
  const gEnabled = gEn == null ? DEFAULT_REVIEW_GOOGLE_ENABLED : !!gEn;
  const gUrl = String(messageTemplates.review_google_url ?? DEFAULT_REVIEW_GOOGLE_URL ?? '').trim();
  if (gEnabled && gUrl) out.push({ platform: 'google', url: gUrl });

  return out;
}

// Resolve the active online-payment surcharge config (saved override or
// built-in default). Returns { enabled, pct, flat }.
function resolveSurchargeConfig() {
  const en = messageTemplates.surcharge_enabled;
  const pct = messageTemplates.surcharge_pct;
  const flat = messageTemplates.surcharge_flat;
  return {
    enabled: en == null ? DEFAULT_SURCHARGE_ENABLED : !!en,
    pct:     pct == null  ? DEFAULT_SURCHARGE_PCT  : Number(pct),
    flat:    flat == null ? DEFAULT_SURCHARGE_FLAT : Number(flat),
  };
}

// Compute the surcharge for paying `amount` online. Returns 0 fee when the
// surcharge is disabled or the amount is non-positive. The fee is rounded
// to two decimals so the customer-facing total matches what we send to
// PayPal exactly (no penny drift between display and charge).
function calcSurcharge(amount, cfg) {
  const c = cfg || resolveSurchargeConfig();
  if (!c.enabled) return { enabled: false, pct: c.pct, flat: c.flat, fee: 0, total: Number(amount) || 0 };
  const base = Math.max(0, Number(amount) || 0);
  if (base <= 0) return { enabled: true, pct: c.pct, flat: c.flat, fee: 0, total: 0 };
  const fee = +(base * (c.pct / 100) + c.flat).toFixed(2);
  return { enabled: true, pct: c.pct, flat: c.flat, fee, total: +(base + fee).toFixed(2) };
}

// Resolve the active payment-instructions template (saved override or
// built-in default) with variables substituted. Used everywhere we render
// the instructions: PDFPreview, public viewer, printable PDF.
function resolvePaymentInstructions() {
  const tpl = messageTemplates.payment_instructions || DEFAULT_PAYMENT_INSTRUCTIONS;
  const rate = messageTemplates.late_fee_rate != null ? Number(messageTemplates.late_fee_rate) : DEFAULT_LATE_FEE_RATE;
  return renderTemplate(tpl, { rate });
}

// Compute the late-fee surcharge for an invoice. Returns 0 unless the invoice
// is past-due AND has an outstanding balance. We charge one full monthly
// period for every 30 days past the due date (matches "per month" wording on
// the instructions). Estimates never accrue a fee.
function calcLateFee(form, t) {
  if (!form || form.type === 'estimate') return { months: 0, fee: 0 };
  if (!form.dueDate) return { months: 0, fee: 0 };
  const baseBalance = Math.max(0, (t?.total || 0) - (t?.paid || 0));
  if (baseBalance <= 0) return { months: 0, fee: 0 };
  const due = new Date(form.dueDate);
  if (isNaN(due)) return { months: 0, fee: 0 };
  const now = new Date();
  const ms = now - due;
  if (ms <= 30 * 24 * 60 * 60 * 1000) return { months: 0, fee: 0 }; // grace 30 days
  const months = Math.floor(ms / (30 * 24 * 60 * 60 * 1000));
  const rate = messageTemplates.late_fee_rate != null ? Number(messageTemplates.late_fee_rate) : DEFAULT_LATE_FEE_RATE;
  const fee = +(baseBalance * (rate / 100) * months).toFixed(2);
  return { months, fee, rate };
}

// Sync the in-memory cache from the freshly loaded settings map. Called
// after every db.loadAll() so the modals & SMS path always see the latest.
function hydrateTemplatesFromSettings(settings) {
  if (!settings) return;
  messageTemplates.email_invoice  = settings.email_invoice_template  || null;
  messageTemplates.email_estimate = settings.email_estimate_template || null;
  messageTemplates.text_invoice   = settings.text_invoice_template   || null;
  messageTemplates.text_estimate  = settings.text_estimate_template  || null;
  messageTemplates.payment_instructions = settings.payment_instructions_template || null;
  // Late-fee rate is stored as a numeric string. Empty/missing falls back to
  // the built-in default so older backups still render correctly.
  const r = settings.late_fee_rate;
  messageTemplates.late_fee_rate = (r != null && r !== "" && !isNaN(Number(r))) ? Number(r) : null;
  // Surcharge config — stored as strings ("true"/"false" or numeric).
  const se = settings.surcharge_enabled;
  messageTemplates.surcharge_enabled = (se == null || se === "") ? null : (se === "true" || se === true);
  const sp = settings.surcharge_pct;
  messageTemplates.surcharge_pct = (sp != null && sp !== "" && !isNaN(Number(sp))) ? Number(sp) : null;
  const sf = settings.surcharge_flat;
  messageTemplates.surcharge_flat = (sf != null && sf !== "" && !isNaN(Number(sf))) ? Number(sf) : null;
  // Review request toggles + URLs. Stored as plain strings ("true"/"false"
  // for booleans, raw URL for the link). Missing/empty falls back to the
  // built-in default in resolveReviewLinks().
  const ryEn = settings.review_yelp_enabled;
  messageTemplates.review_yelp_enabled = (ryEn == null || ryEn === "") ? null : (ryEn === "true" || ryEn === true);
  messageTemplates.review_yelp_url = (settings.review_yelp_url == null || settings.review_yelp_url === "") ? null : String(settings.review_yelp_url);
  const rgEn = settings.review_google_enabled;
  messageTemplates.review_google_enabled = (rgEn == null || rgEn === "") ? null : (rgEn === "true" || rgEn === true);
  messageTemplates.review_google_url = (settings.review_google_url == null || settings.review_google_url === "") ? null : String(settings.review_google_url);
}

function ConfirmSendModal({ kind, invoice, client, onClose, onConfirm, sending }) {
  // kind: "invoice" | "estimate"
  const [email, setEmail] = useState(client?.email || "");
  const [name, setName]   = useState(client?.name  || invoice?.client || "");
  const t = calcTotals(invoice);
  const isEstimate = kind === "estimate";
  const valid = /\S+@\S+\.\S+/.test(email);
  const docNum = invoice?.id || (isEstimate ? "EST0000" : "INV0000");
  // Down-payment percentage (estimates only). 0 = no down payment requested.
  // When > 0, the customer's signature on the public viewer auto-creates a
  // new invoice for that portion of the estimate total.
  const [downPct, setDownPct] = useState(typeof invoice?.downPaymentPct === 'number' ? invoice.downPaymentPct : 0);
  const downAmt = Math.round(t.total * (downPct / 100) * 100) / 100;
  // Use the user's saved template from Settings if they have one, otherwise
  // the built-in default. Either is run through renderTemplate so all the
  // {name}/{id}/{total}/{link} variables get filled in.
  // Detect paid-in-full so we can auto-swap the template (and the email
  // subject / button on the server side) to a receipt-style message.
  const isPaidInFull = !isEstimate && t.paid > 0 && t.balance <= 0.01;
  const savedTemplate = isEstimate
    ? messageTemplates.email_estimate
    : (isPaidInFull
        ? (messageTemplates.email_invoice_paid || DEFAULT_INVOICE_PAID_MESSAGE)
        : messageTemplates.email_invoice);
  const defaultTemplate = savedTemplate || (isEstimate
    ? DEFAULT_ESTIMATE_MESSAGE
    : (isPaidInFull ? DEFAULT_INVOICE_PAID_MESSAGE : DEFAULT_INVOICE_MESSAGE));
  const renderVars = { name, id: docNum, total: fmt(t.total), link: "", type: isEstimate ? "estimate" : "invoice" };
  // Track whether the user has manually edited the message. Until they do,
  // we keep regenerating the template with the latest recipient name.
  const [message, setMessage] = useState(renderTemplate(defaultTemplate, renderVars));
  const [edited, setEdited] = useState(false);
  // When the recipient name changes and the user hasn't customized the
  // message yet, refresh the salutation. Once they edit the textarea, we
  // stop touching it so we don't blow away their edits.
  useEffect(() => {
    if (!edited) setMessage(renderTemplate(defaultTemplate, { ...renderVars, name }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, edited, defaultTemplate]);

  // Portal to document.body — InvoiceForm's carousel uses CSS transform,
  // which would otherwise capture our position:fixed and shift the modal.
  return createPortal(
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(10,22,40,0.55)", zIndex: 400, display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
      <div onClick={e => e.stopPropagation()} style={{ width: "100%", maxWidth: 480, background: "#fff", borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: "6px 0 max(20px, env(safe-area-inset-bottom))", maxHeight: "92vh", overflowY: "auto" }}>
        <div style={{ width: 40, height: 4, background: "#dde2ee", borderRadius: 2, margin: "6px auto 14px" }} />
        <div style={{ padding: "0 20px 6px", fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 18, color: NAVY, letterSpacing: 1, textTransform: "uppercase" }}>
          Confirm send
        </div>
        <div style={{ padding: "0 20px", fontSize: 12, color: "#888", marginBottom: 14 }}>
          Double-check the recipient before {isEstimate ? "sending the estimate" : "emailing the invoice"}.
        </div>

        <div style={{ padding: "0 20px" }}>
          <div style={{ background: LIGHT, borderRadius: 10, padding: 12, marginBottom: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
              <span style={{ fontSize: 11, color: "#8899bb", fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, letterSpacing: 1, textTransform: "uppercase" }}>{isEstimate ? "Estimate" : "Invoice"}</span>
              <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 13, color: "#555", fontWeight: 700, letterSpacing: 1 }}>{docNum}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 18, fontWeight: 700, color: NAVY, letterSpacing: 0.5, textTransform: "uppercase" }}>{name || "—"}</span>
              <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 18, color: ORANGE }}>{fmt(t.total)}</span>
            </div>
          </div>

          {isEstimate && (
            <div style={{ marginBottom: 14 }}>
              <label style={S.label}>Down payment</label>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 6 }}>
                {[0, 25, 33, 50, 75, 100].map(pct => (
                  <button
                    key={pct}
                    type="button"
                    onClick={() => setDownPct(pct)}
                    style={{
                      padding: "7px 12px",
                      borderRadius: 8,
                      border: `1.5px solid ${downPct === pct ? ORANGE : "#dde2ee"}`,
                      background: downPct === pct ? ORANGE : "#fff",
                      color: downPct === pct ? "#fff" : "#444",
                      fontFamily: "'Barlow Condensed', sans-serif",
                      fontWeight: 700,
                      fontSize: 13,
                      letterSpacing: 0.5,
                      cursor: "pointer",
                      flex: "0 0 auto",
                    }}
                  >{pct === 0 ? "None" : `${pct}%`}</button>
                ))}
              </div>
              {downPct > 0 ? (
                <div style={{ fontSize: 12, color: "#666" }}>
                  The customer will be able to pay <strong>{fmt(downAmt)}</strong> ({downPct}% of {fmt(t.total)}) right from the estimate link. When they pay, the estimate auto-converts to an invoice with the down payment applied.
                </div>
              ) : (
                <div style={{ fontSize: 12, color: "#888" }}>
                  No down payment will be requested. The customer just gets the estimate to review and sign.
                </div>
              )}
            </div>
          )}

          <label style={S.label}>Recipient name</label>
          <input value={name} onChange={e => setName(e.target.value)} style={S.input} placeholder="Client name" />

          <label style={{ ...S.label, marginTop: 10 }}>Send to email</label>
          {client?.email2 && (
            <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
              {[client.email, client.email2].filter(Boolean).map(addr => (
                <button
                  key={addr}
                  type="button"
                  onClick={() => setEmail(addr)}
                  style={{ flex: 1, padding: "7px 10px", borderRadius: 8, border: `1.5px solid ${email === addr ? ORANGE : "#dde2ee"}`, background: email === addr ? ORANGE : "#fff", color: email === addr ? "#fff" : "#444", fontFamily: "'Barlow', sans-serif", fontSize: 12, fontWeight: 600, cursor: "pointer", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                >{addr}</button>
              ))}
            </div>
          )}
          <input value={email} onChange={e => setEmail(e.target.value)} style={S.input} placeholder="name@example.com" type="email" autoCapitalize="none" autoCorrect="off" />
          {!valid && email.length > 0 && <div style={{ fontSize: 11, color: "#cc4444", marginTop: 4 }}>That doesn't look like a valid email.</div>}

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 12, marginBottom: 4 }}>
            <label style={{ ...S.label, marginBottom: 0 }}>Message</label>
            {edited && (
              <button
                type="button"
                onClick={() => { setEdited(false); setMessage(renderTemplate(defaultTemplate, { ...renderVars, name })); }}
                style={{ background: "none", border: "none", color: ORANGE, fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase", cursor: "pointer", padding: 0, fontFamily: "'Barlow Condensed', sans-serif" }}
              >Reset to default</button>
            )}
          </div>
          <textarea
            value={message}
            onChange={e => { setEdited(true); setMessage(e.target.value); }}
            rows={9}
            style={{ ...S.input, resize: "vertical", minHeight: 160, fontFamily: "'Barlow', sans-serif", lineHeight: 1.5, fontSize: 14, whiteSpace: "pre-wrap" }}
          />
          <div style={{ fontSize: 11, color: "#888", marginTop: 4 }}>This appears at the top of the email.</div>
        </div>

        <div style={{ display: "flex", gap: 10, padding: "16px 20px 0" }}>
          <button onClick={onClose} disabled={sending} style={{ ...S.btn("ghost"), flex: 1 }}>Cancel</button>
          <button onClick={() => valid && onConfirm({ name, email, message, downPaymentPct: downPct })} disabled={!valid || sending} style={{ ...S.btn("primary"), flex: 2, opacity: (!valid || sending) ? 0.5 : 1 }}>
            {sending ? "Sending…" : (isEstimate ? "Send Estimate" : "Send Invoice")}
          </button>
        </div>
      </div>
    </div>,
    document.body
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
      <div style={{ background: "#fff", width: "100%", borderRadius: "16px 16px 0 0", padding: 24, maxWidth: 480, margin: "0 auto", boxSizing: "border-box" }}>
        <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 20, marginBottom: 4, color: NAVY }}>Schedule Job</div>
        <div style={{ fontSize: 13, color: "#888", marginBottom: 16 }}>{invoice.client || "No client"} · {jobTitle}</div>
        <div style={{ marginBottom: 12 }}><label style={S.label}>Date</label><input type="date" style={S.input} value={date} onChange={e => setDate(e.target.value)} /></div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 20 }}>
          <div style={{ minWidth: 0 }}><label style={S.label}>Start Time</label><input type="time" style={S.input} value={time} onChange={e => setTime(e.target.value)} /></div>
          <div style={{ minWidth: 0 }}><label style={S.label}>Duration</label>
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
      <div style={{ background: "#fff", width: "100%", borderRadius: "16px 16px 0 0", padding: 24, maxWidth: 480, margin: "0 auto", boxSizing: "border-box" }}>
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
function GlobalAIModal({ data, msgs, setMsgs, onResetChat, onClose, onAction, onOpenDoc, onOpenClient }) {
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [listening, setListening] = useState(false);
  // Pending photos waiting to be sent with the next message. Same shape
  // and behavior as AIChatPanel: paperclip button picks files, we resize
  // and stash, send() includes them on the latest user message.
  const [pendingPhotos, setPendingPhotos] = useState([]);
  const fileInputRef = useRef(null);
  const onPickPhotos = async (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    if (!files.length) return;
    const added = [];
    for (const f of files) {
      try {
        const dataUrl = await resizeImageToDataUrl(f, 1600, 0.82);
        added.push({ dataUrl, name: f.name });
      } catch {}
    }
    if (added.length) setPendingPhotos(p => [...p, ...added]);
  };
  const removePendingPhoto = (idx) => {
    setPendingPhotos(p => p.filter((_, i) => i !== idx));
  };
  // TTS defaults to OFF — only speaks when user explicitly taps the speaker button
  const [ttsOn, setTtsOn] = useState(false);
  const ttsRef = useRef(false);
  const lastSpokenIdxRef = useRef(-1);
  const endRef = useRef(null);
  // Resize the modal to fit exactly inside the visible viewport so when the
  // iOS keyboard opens the chat shrinks (instead of being pushed off-screen).
  // We track both the viewport height AND its offsetTop because iOS shifts the
  // visual viewport down a bit when the address bar is visible.
  const [vv, setVV] = useState(() => ({
    height: typeof window !== "undefined" ? window.innerHeight : 0,
    top: 0,
  }));
  useEffect(() => {
    const v = window.visualViewport;
    if (!v) return;
    const update = () => setVV({ height: v.height, top: v.offsetTop || 0 });
    update();
    v.addEventListener("resize", update);
    v.addEventListener("scroll", update);
    return () => { v.removeEventListener("resize", update); v.removeEventListener("scroll", update); };
  }, []);

  // Lock the underlying page scroll while the chat is open so iOS can't
  // scroll the body when the input is focused.
  useEffect(() => {
    const prev = {
      overflow: document.body.style.overflow,
      position: document.body.style.position,
      width: document.body.style.width,
      top: document.body.style.top,
    };
    const scrollY = window.scrollY;
    document.body.style.overflow = "hidden";
    document.body.style.position = "fixed";
    document.body.style.width = "100%";
    document.body.style.top = `-${scrollY}px`;
    return () => {
      document.body.style.overflow = prev.overflow;
      document.body.style.position = prev.position;
      document.body.style.width = prev.width;
      document.body.style.top = prev.top;
      window.scrollTo(0, scrollY);
    };
  }, []);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }); }, [msgs, loading, vv.height]);

  // Pick the most natural-sounding English voice available. iOS exposes
  // "Samantha", "Ava", "Allison", "Karen" — Apple's enhanced/premium voices —
  // which sound far less robotic than the default fallback.
  const pickVoice = () => {
    const voices = window.speechSynthesis?.getVoices() || [];
    const en = voices.filter(v => v.lang && v.lang.toLowerCase().startsWith("en"));
    const prefer = [
      /Ava \(Premium\)/i, /Ava \(Enhanced\)/i, /Ava/i,
      /Allison \(Premium\)/i, /Allison \(Enhanced\)/i, /Allison/i,
      /Samantha \(Premium\)/i, /Samantha \(Enhanced\)/i, /Samantha/i,
      /Karen/i, /Moira/i, /Tessa/i,
      /\(Premium\)/i, /\(Enhanced\)/i, /natural/i,
      /Google US English/i, /Microsoft.*Natural/i,
    ];
    for (const re of prefer) {
      const v = en.find(v => re.test(v.name));
      if (v) return v;
    }
    return en.find(v => v.lang === "en-US") || en[0] || null;
  };

  const speak = (text) => {
    if (!ttsRef.current || !window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const clean = stripActionBlocks(text)
      .replace(/\*+/g, '').replace(/#+\s*/g, '').replace(/`+/g, '').replace(/[_~>]/g, '')
      .replace(/\$([0-9,]+(\.[0-9]{2})?)/g, (_, n) => n.replace(/,/g, '') + ' dollars')
      .replace(/INV(\d+)/g, 'Invoice $1')
      .replace(/\s{2,}/g, ' ').trim();
    if (!clean) return;
    const utt = new SpeechSynthesisUtterance(clean);
    utt.voice = pickVoice();
    utt.rate = 0.95;   // slightly slower than default — easier to follow
    utt.pitch = 1.0;   // neutral pitch
    utt.volume = 1.0;
    window.speechSynthesis.speak(utt);
  };

  const toggleTts = () => {
    const next = !ttsRef.current;
    ttsRef.current = next;
    setTtsOn(next);
    if (!next) {
      window.speechSynthesis?.cancel();
    } else {
      // User just turned TTS ON — speak the most recent assistant message so
      // they hear something immediately, then continue speaking new replies.
      const last = [...msgs].reverse().find(m => m.role === "assistant" && m.text);
      if (last) speak(last.text);
      lastSpokenIdxRef.current = msgs.length - 1;
    }
  };

  // Speak NEW assistant messages only while TTS is on. Never auto-speak on mount.
  useEffect(() => {
    if (!ttsRef.current) { lastSpokenIdxRef.current = msgs.length - 1; return; }
    const lastIdx = msgs.length - 1;
    if (lastIdx > lastSpokenIdxRef.current) {
      const last = msgs[lastIdx];
      if (last?.role === "assistant" && last.text) speak(last.text);
      lastSpokenIdxRef.current = lastIdx;
    }
  }, [msgs]);

  // Some browsers load voices asynchronously — refresh once they arrive.
  useEffect(() => {
    if (!window.speechSynthesis) return;
    const handler = () => {};
    window.speechSynthesis.addEventListener?.("voiceschanged", handler);
    return () => window.speechSynthesis.removeEventListener?.("voiceschanged", handler);
  }, []);

  useEffect(() => { return () => window.speechSynthesis?.cancel(); }, []);

  // Same protected mic flow as AIChatPanel — see comments there. The
  // earlier version threw synchronously from r.start() on iOS Safari and
  // crashed the React tree.
  const recRef = useRef(null);
  const startListening = () => {
    if (recRef.current) {
      try { recRef.current.stop(); } catch {}
      recRef.current = null;
      setListening(false);
      return;
    }
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { alert("Voice dictation isn\u2019t supported in this browser. Try Safari on iPhone or Chrome on desktop."); return; }
    let r;
    try { r = new SR(); } catch (err) { alert("Couldn\u2019t start voice: " + (err?.message || err)); return; }
    r.lang = "en-US";
    r.onresult = e => {
      try {
        const transcript = e.results?.[0]?.[0]?.transcript || "";
        setInput(p => (p + " " + transcript).trim());
      } catch {}
    };
    r.onerror = (e) => {
      setListening(false); recRef.current = null;
      const code = e?.error;
      if (code === "not-allowed" || code === "service-not-allowed") {
        alert("Microphone permission denied. Enable it in Settings \u2192 Safari \u2192 Microphone.");
      } else if (code && code !== "aborted" && code !== "no-speech") {
        console.warn("speech recognition error:", code);
      }
    };
    r.onend = () => { setListening(false); recRef.current = null; };
    try {
      r.start();
      recRef.current = r;
      setListening(true);
    } catch (err) {
      console.warn("speech start() threw:", err);
      recRef.current = null;
      setListening(false);
      alert("Couldn\u2019t start voice. If this keeps happening, reload the page.");
    }
  };

  const send = async () => {
    const text = input.trim();
    const hasPhotos = pendingPhotos.length > 0;
    if ((!text && !hasPhotos) || loading) return;
    setInput("");
    const photosForSend = pendingPhotos;
    setPendingPhotos([]);
    const userMsg = {
      role: "user",
      text: text || (hasPhotos ? `[${photosForSend.length} photo${photosForSend.length === 1 ? "" : "s"} attached]` : ""),
      photos: photosForSend.length ? photosForSend.map(p => p.dataUrl) : undefined,
    };
    setMsgs(p => [...p, userMsg]); setLoading(true);
    try {
      // Past photos are dropped from history to save tokens — only the
      // current send carries raw image blocks.
      const history = [...msgs, userMsg]
        .filter(m => m.text?.trim() || m.photos?.length)
        .map((m, i, arr) => {
          const isLatest = i === arr.length - 1;
          if (m.role === "user" && isLatest && m.photos?.length) {
            const blocks = m.photos.map(dataUrl => {
              const match = String(dataUrl).match(/^data:([^;]+);base64,(.+)$/);
              if (!match) return null;
              return { type: "image", source: { type: "base64", media_type: match[1], data: match[2] } };
            }).filter(Boolean);
            blocks.push({ type: "text", text: m.text || "(see attached photo)" });
            return { role: "user", content: blocks };
          }
          return { role: m.role === "user" ? "user" : "assistant", content: m.text || "" };
        });
      const first = history.findIndex(m => m.role === "user");
      const reply = await callAI(first >= 0 ? history.slice(first) : history, buildGlobalSystemPrompt(data));
      console.log('[AI reply]', reply);
      const actions = extractActionsJSON(reply);
      console.log('[AI actions]', actions);

      if (actions.length === 0) {
        setMsgs(p => [...p, { role: "assistant", text: reply }]);
        setLoading(false); return;
      }

      let invoicesCreated = 0, estimatesCreated = 0, itemsSaved = 0;
      const createdDocs = [];

      let failed = 0;
      for (const action of actions) {
        if (action.action === "create_invoice" || action.action === "create_estimate") {
          try {
            const newInv = await onAction(action);
            if (newInv) { createdDocs.push(newInv); action.action === "create_estimate" ? estimatesCreated++ : invoicesCreated++; }
          } catch (e) { console.error('create failed', e); failed++; }
        } else if (action.action === "save_item") {
          onAction(action); itemsSaved++;
        } else if (action.action === "add_items") {
          onAction(action);
          setMsgs(p => [...p, { role: "assistant", text: action.summary || "Items added.", card: { type: "added", invoiceId: action.invoiceId, count: action.items?.length || 0 } }]);
        } else if (action.action === "send_email") {
          const inv = data.invoices.find(i => i.id === action.invoiceId);
          const client = data.clients.find(c => c.name === inv?.client);
          if (!inv || !client?.email) {
            setMsgs(p => [...p, { role: "assistant", text: `Couldn't find ${action.invoiceId} or no email on file.` }]);
          } else {
            setMsgs(p => [...p, { role: "assistant", text: action.summary || `Ready to send ${action.invoiceId}.`, card: { type: "confirm_email", invoiceId: action.invoiceId, email: client.email, total: calcTotals(inv).total } }]);
          }
        } else if (action.action === "estimate") {
          // AI used preview format instead of create_estimate — normalize and save
          console.log('[AI] "estimate" action received in GlobalAI — converting to create_estimate');
          const normalized = { action: "create_estimate", invoice: { client: action.client || "", date: today(), dueDate: today(), items: action.items || [], notes: action.notes || "", tax: TAX_RATE, discount: 0 }, summary: action.summary };
          try {
            const newInv = await onAction(normalized);
            if (newInv) { createdDocs.push(newInv); estimatesCreated++; }
          } catch (e) { console.error('estimate create failed', e); failed++; }
        } else if (action.action === "create_client") {
          const newClient = await onAction(action);
          if (newClient) {
            setMsgs(p => [...p, { role: "assistant", text: action.summary || `Client "${newClient.name}" added.`, card: { type: "created_client", client: newClient } }]);
          }
        } else {
          // Catch-all for the remaining action types that the App-level
          // handler knows about: delete_invoice, update_invoice, add_payment,
          // remove_item, update_item, update_client, delete_client. These
          // were previously falling through silently.
          try { await onAction(action); }
          catch (e) { console.error("action failed", action.action, e); failed++; }
          if (action.summary) {
            setMsgs(p => [...p, { role: "assistant", text: action.summary }]);
          }
        }
      }

      if (invoicesCreated || estimatesCreated || itemsSaved) {
        const parts = [];
        if (invoicesCreated) parts.push(`${invoicesCreated} invoice${invoicesCreated !== 1 ? "s" : ""}`);
        if (estimatesCreated) parts.push(`${estimatesCreated} estimate${estimatesCreated !== 1 ? "s" : ""}`);
        if (itemsSaved) parts.push(`${itemsSaved} price${itemsSaved !== 1 ? "s" : ""} saved`);
        const isSingle = actions.length === 1;
        let summaryText = isSingle
          ? (actions[0].summary || `${parts[0].charAt(0).toUpperCase() + parts[0].slice(1)} created.`)
          : `Created ${parts.join(" and ")} successfully.`;
        if (failed > 0) summaryText += ` (${failed} failed to save \u2014 check connection.)`;
        const card = createdDocs.length === 1
          ? { type: "created", invoice: createdDocs[0] }
          : createdDocs.length > 1 ? { type: "batch_created", invoices: createdDocs } : undefined;
        setMsgs(p => [...p, { role: "assistant", text: summaryText, ...(card ? { card } : {}) }]);
      } else if (failed > 0) {
        setMsgs(p => [...p, { role: "assistant", text: `Couldn't save ${failed} document${failed !== 1 ? "s" : ""} \u2014 check your connection and try again.` }]);
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
      let viewToken = inv?.viewToken;
      if (inv && !viewToken) {
        try { viewToken = await db.ensureViewToken(inv); inv.viewToken = viewToken; }
        catch (e) { console.warn('ensureViewToken failed:', e); }
      }
      const viewLink = viewToken ? `${window.location.origin}/v/${viewToken}` : '';
      await sendInvoiceEmail(inv, client, '', viewLink);
      if (inv?.id) {
        try { await db.recordInvoiceEvent(inv.id, 'sent', client?.email, { kind: 'invoice', via: 'assistant' }); }
        catch (e) { console.warn('recordInvoiceEvent failed:', e); }
      }
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
    <div style={{ position: "fixed", left: 0, right: 0, top: vv.top, height: vv.height, zIndex: 300, display: "flex", flexDirection: "column", background: LIGHT, maxWidth: 480, margin: "0 auto", overflow: "hidden" }}>
      <style>{`@keyframes bounce{0%,80%,100%{transform:translateY(0)}40%{transform:translateY(-8px)}}`}</style>
      <div style={{ background: NAVY, padding: "14px 16px", display: "flex", alignItems: "center", gap: 12, flexShrink: 0, boxShadow: "0 2px 12px rgba(0,0,0,0.3)" }}>
        <div style={{ width: 36, height: 36, background: ORANGE, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center" }}><Icon name="ai" size={20} color="#fff" /></div>
        <div style={{ flex: 1 }}>
          <div style={{ color: "#fff", fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 17, letterSpacing: 1 }}>AI ASSISTANT</div>
          <div style={{ color: "#8899bb", fontSize: 11 }}>{data.invoices.filter(i => i.type !== "estimate").length} invoices · {data.invoices.filter(i => i.type === "estimate").length} estimates · {data.clients.length} clients</div>
        </div>
        <button onClick={toggleTts} title={ttsOn ? "Mute" : "Unmute"} style={{ width: 34, height: 34, borderRadius: 8, border: "none", background: ttsOn ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.04)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}><Icon name={ttsOn ? "speaker" : "speakerOff"} size={16} color={ttsOn ? "#fff" : "#556688"} /></button>
        <button onClick={() => { if (confirm("Clear all chat history?")) { window.speechSynthesis?.cancel(); onResetChat?.(); } }} title="Clear chat" style={{ width: 34, height: 34, borderRadius: 8, border: "none", background: "rgba(255,255,255,0.04)", cursor: "pointer", color: "#8899bb", fontSize: 11, fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, letterSpacing: 1 }}>CLR</button>
        <button onClick={() => { window.speechSynthesis?.cancel(); onClose(); }} style={{ background: "none", border: "none", color: "#8899bb", cursor: "pointer", fontSize: 28, lineHeight: 1, padding: "0 4px" }}>×</button>
      </div>
      <div style={{ flex: 1, overflowY: "auto", WebkitOverflowScrolling: "touch", padding: "14px 14px 0", minHeight: 0 }}>
        {msgs.map((m, i) => (
          <div key={i} style={{ marginBottom: 12, display: "flex", justifyContent: m.role === "user" ? "flex-end" : "flex-start" }}>
            <div style={bubble(m.role === "user")}>
              {m.photos?.length > 0 && (
                <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: m.text ? 6 : 0 }}>
                  {m.photos.map((src, j) => (
                    <img key={j} src={src} alt="" style={{ width: 80, height: 80, borderRadius: 6, objectFit: "cover" }} />
                  ))}
                </div>
              )}
              {m.role === "assistant" ? stripActionBlocks(m.text) : m.text}
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
              {m.card?.type === "batch_created" && <div style={{ marginTop: 10, background: "#edfaf3", borderRadius: 8, padding: "10px 12px", border: "1.5px solid #b8f0d0" }}>{m.card.invoices.map((inv, j) => <div key={j} onClick={() => onOpenDoc?.(inv)} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0", cursor: "pointer", borderBottom: j < m.card.invoices.length - 1 ? "1px solid #d4f5e4" : "none" }}><Icon name="check" size={13} color="#27ae60" /><span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 13, color: "#27ae60", flex: 1 }}>{inv.id} · {inv.type === "estimate" ? "Estimate" : "Invoice"}</span><span style={{ fontSize: 12, color: "#27ae60", fontWeight: 700 }}>{fmt(calcTotals(inv).total)}</span><span style={{ fontSize: 10, color: "#27ae60" }}>Open →</span></div>)}</div>}
              {m.card?.type === "added" && <div style={{ marginTop: 10, background: "#edfaf3", borderRadius: 8, padding: "10px 12px", display: "flex", alignItems: "center", gap: 10 }}><Icon name="check" size={16} color="#27ae60" /><div style={{ fontSize: 13, fontWeight: 600, color: "#27ae60" }}>{m.card.count} item{m.card.count !== 1 ? "s" : ""} added to {m.card.invoiceId}</div></div>}
              {m.card?.type === "saved_item" && <div style={{ marginTop: 10, background: "#edf4ff", borderRadius: 8, padding: "10px 12px", display: "flex", alignItems: "center", gap: 10, border: "1.5px solid #c0d8ff" }}><Icon name="items" size={15} color="#2980b9" /><div><div style={{ fontSize: 13, fontWeight: 700, color: "#2980b9" }}>{m.card.item?.name}</div><div style={{ fontSize: 12, color: "#555" }}>{fmt(m.card.item?.price)} saved to My Items</div></div></div>}
              {m.card?.type === "confirm_email" && <div style={{ marginTop: 10, background: "#f4f6fa", borderRadius: 8, padding: 12 }}><div style={{ fontSize: 13, fontWeight: 600, marginBottom: 2 }}>{m.card.invoiceId} · {fmt(m.card.total)}</div><div style={{ fontSize: 12, color: "#666", marginBottom: 10 }}>Send to: {m.card.email}</div><div style={{ display: "flex", gap: 8 }}><button onClick={() => setMsgs(p => p.map((x, j) => j === i ? { ...x, card: { ...x.card, type: "email_cancelled" } } : x))} style={{ ...S.btn("ghost"), flex: 1, fontSize: 12, padding: "7px 0" }}>Cancel</button><button onClick={() => confirmEmail(i)} style={{ ...S.btn("navy"), flex: 2, fontSize: 12, padding: "7px 0", display: "flex", alignItems: "center", justifyContent: "center", gap: 5 }}><Icon name="mail" size={13} color="#fff" /> Confirm Send</button></div></div>}
              {m.card?.type === "email_sending" && <div style={{ marginTop: 10, background: "#f4f6fa", borderRadius: 8, padding: "10px 12px", display: "flex", alignItems: "center", gap: 8 }}>{[0,1,2].map(k => <span key={k} style={{ width: 7, height: 7, borderRadius: "50%", background: ORANGE, display: "inline-block", animation: `bounce 1s ${k*0.18}s infinite` }}/>)}<span style={{ fontSize: 12, color: "#888", marginLeft: 4 }}>Sending…</span></div>}
              {m.card?.type === "email_sent" && <div style={{ marginTop: 10, background: "#edfaf3", borderRadius: 8, padding: "10px 12px", display: "flex", alignItems: "center", gap: 8 }}><Icon name="check" size={15} color="#27ae60" /><span style={{ fontSize: 12, fontWeight: 600, color: "#27ae60" }}>Sent!</span></div>}
              {m.card?.type === "email_cancelled" && <div style={{ marginTop: 10, background: "#f4f6fa", borderRadius: 8, padding: "10px 12px" }}><span style={{ fontSize: 12, color: "#aaa" }}>Email cancelled</span></div>}
              {m.card?.type === "email_failed" && <div style={{ marginTop: 10, background: "#fff0ee", borderRadius: 8, padding: "10px 12px" }}><span style={{ fontSize: 12, color: "#cc4444" }}>Failed: {m.card.error}</span></div>}
              {m.card?.type === "created_client" && <div onClick={() => onOpenClient?.(m.card.client)} style={{ marginTop: 10, background: "#edf4ff", borderRadius: 8, padding: "10px 12px", display: "flex", alignItems: "center", gap: 10, border: "1.5px solid #c0d8ff", cursor: "pointer" }}><Icon name="person" size={16} color="#2980b9" /><div style={{ flex: 1 }}><div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 15, color: "#2980b9" }}>{m.card.client?.name}</div>{m.card.client?.email && <div style={{ fontSize: 12, color: "#555" }}>{m.card.client.email}</div>}{m.card.client?.phone && <div style={{ fontSize: 12, color: "#555" }}>{m.card.client.phone}</div>}</div><div style={{ fontSize: 11, color: "#2980b9", fontWeight: 600 }}>Open →</div></div>}
            </div>
          </div>
        ))}
        {loading && <div style={{ display: "flex", marginBottom: 12 }}><div style={{ background: "#fff", borderRadius: "16px 16px 16px 4px", padding: "12px 16px", boxShadow: "0 1px 4px rgba(0,0,0,0.08)", display: "flex", gap: 5 }}>{[0,1,2].map(k => <span key={k} style={{ width: 8, height: 8, borderRadius: "50%", background: ORANGE, display: "inline-block", animation: `bounce 1s ${k*0.18}s infinite` }}/>)}</div></div>}
        <div ref={endRef} style={{ height: 14 }} />
      </div>
      {pendingPhotos.length > 0 && (
        <div style={{ background: "#fff", borderTop: "1px solid #dde2ee", padding: "8px 10px", display: "flex", gap: 6, flexWrap: "wrap", maxHeight: 90, overflowY: "auto", flexShrink: 0 }}>
          {pendingPhotos.map((p, i) => (
            <div key={i} style={{ position: "relative", width: 56, height: 56, borderRadius: 8, backgroundImage: `url('${p.dataUrl}')`, backgroundSize: "cover", backgroundPosition: "center", border: "1px solid #dde2ee" }}>
              <button onClick={() => removePendingPhoto(i)} aria-label="Remove photo" style={{ position: "absolute", top: -6, right: -6, width: 20, height: 20, borderRadius: "50%", background: "#c33", color: "#fff", border: "none", cursor: "pointer", fontSize: 13, lineHeight: 1, padding: 0 }}>×</button>
            </div>
          ))}
        </div>
      )}
      <div style={{ background: "#fff", borderTop: "1px solid #dde2ee", padding: "10px 12px", display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
        <input ref={fileInputRef} type="file" accept="image/*" multiple style={{ display: "none" }} onChange={onPickPhotos} />
        <button onClick={() => fileInputRef.current?.click()} aria-label="Attach photos" title="Attach photos" style={{ width: 40, height: 40, borderRadius: 8, border: "none", background: "#f0f2f8", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><Icon name="paperclip" size={18} color="#666" /></button>
        <button onClick={startListening} style={{ width: 40, height: 40, borderRadius: 8, border: "none", background: listening ? ORANGE : "#f0f2f8", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><Icon name="mic" size={18} color={listening ? "#fff" : "#666"} /></button>
        <input
          type="search"
          name="prompt"
          autoComplete="off"
          autoCorrect="on"
          autoCapitalize="sentences"
          spellCheck={true}
          inputMode="text"
          enterKeyHint="send"
          data-form-type="other"
          data-lpignore="true"
          aria-label="Chat message"
          style={{ flex: 1, border: "1.5px solid #dde2ee", borderRadius: 8, padding: "9px 12px", fontSize: 16, fontFamily: "'Barlow', sans-serif", outline: "none", background: "#f8f9fc", minWidth: 0, WebkitAppearance: "none", appearance: "none" }}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === "Enter" && send()}
          placeholder={listening ? "Listening…" : "Create invoice, add items, send email…"}
        />
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
            <input type="number" style={S.input} value={form.qty} onChange={e => set("qty", parseFloat(e.target.value) || 1)} onFocus={selectOnFocus} min={1} />
          </div>
          <div>
            <label style={S.label}>Unit</label>
            <select style={S.input} value={form.unit || "ea"} onChange={e => set("unit", e.target.value)}>
              {["ea", "hrs", "days", "flat rate"].map(u => <option key={u} value={u}>{u}</option>)}
            </select>
          </div>
          <div>
            <label style={S.label}>Unit Price</label>
            <input type="number" style={S.input} value={form.price} onChange={e => set("price", parseFloat(e.target.value) || 0)} onFocus={selectOnFocus} step={0.01} />
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
          <input type="number" style={S.input} value={form.discount || 0} onChange={e => set("discount", parseFloat(e.target.value) || 0)} onFocus={selectOnFocus} min={0} placeholder="0" />
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
function PDFPreview({ form, clients, photos = [] }) {
  const t = calcTotals(form);
  const clientRecord = clients.find(c => c.name === form.client) || {};
  const clientData = form.clientInfo || clientRecord;
  const addr = [clientData.address1, clientData.address2, clientData.address3].filter(Boolean).join(", ");
  const isEstimate = form.type === "estimate";
  const lateFeeInfo = calcLateFee(form, t);
  const balanceWithFee = Math.max(0, t.balance + (lateFeeInfo.fee || 0));
  const paymentInstructionsText = !isEstimate ? resolvePaymentInstructions() : "";
  // Sum any PayPal processing surcharges across this invoice's payments so
  // the receipt can show 'Processing Fee' on its own line. Without this,
  // the customer sees the gross paid amount and thinks they overpaid.
  const totalSurcharge = (form.payments || []).reduce((s, p) => s + (parseFloat(p.surcharge) || 0), 0);
  const beforePhotos = photos.filter(p => p.type === 'before');
  const afterPhotos  = photos.filter(p => p.type === 'after');
  const otherPhotos  = photos.filter(p => p.type === 'other');

  return (
    <div className="print-area" style={{ padding: "16px 12px 40px" }}>
      <div style={{ background: "#fff", borderRadius: 12, overflow: "hidden", boxShadow: "0 4px 24px rgba(0,0,0,0.12)", maxWidth: 440, margin: "0 auto" }}>
        <div style={{ background: NAVY, padding: "20px 24px", display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <div style={{ color: "#fff", fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 21, letterSpacing: 1.5, lineHeight: 1.1 }}>HI GRADE PLUMBING</div>
            <div style={{ color: ORANGE, fontSize: 10, letterSpacing: 2.5, fontWeight: 700, marginTop: 2, fontFamily: "'Barlow Condensed', sans-serif" }}>LLC · HONOLULU, HI</div>
            <div style={{ color: "#6677aa", fontSize: 11, marginTop: 6 }}>License #PJ-13579</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ color: ORANGE, fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 26, letterSpacing: 1, lineHeight: 1 }}>{isEstimate ? "ESTIMATE" : "INVOICE"}</div>
            <div style={{ color: "#fff", fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 17, marginTop: 4 }}>{form.id || "DRAFT"}</div>
          </div>
        </div>
        <div style={{ background: NAVY2, padding: "10px 24px", display: "flex", alignItems: "center", gap: 28 }}>
          {/* Skip the Due column for estimates with no due date — estimates */}
          {/* aren't bills, and the validity note below conveys the timeframe. */}
          {[["Date", form.date], ["Due", form.dueDate]].filter(([_, val]) => !!val).map(([label, val]) => (
            <div key={label}>
              <div style={{ color: "#6677aa", fontSize: 9, fontWeight: 700, letterSpacing: 1.5, textTransform: "uppercase", fontFamily: "'Barlow Condensed', sans-serif" }}>{label}</div>
              <div style={{ color: "#dde2ee", fontSize: 13, fontWeight: 600 }}>{fmtDate(val)}</div>
            </div>
          ))}
          <div style={{ marginLeft: "auto" }}><span style={S.pill(statusDisplay(form).color)}>{statusDisplay(form).label}</span></div>
        </div>
        {/* Estimates carry a standard 30-day validity — surface that here so */}
        {/* customers know the pricing isn't open-ended. */}
        {isEstimate && (
          <div style={{ background: "#fff8ef", borderBottom: "1px solid #f3e6cc", padding: "8px 24px", color: "#a16f1a", fontSize: 12, fontWeight: 600, fontFamily: "'Barlow', sans-serif", display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 14 }}>ⓘ</span>
            <span>This estimate is valid for 30 days from the date above.</span>
          </div>
        )}
        <div style={{ padding: "16px 24px 14px", borderBottom: "1px solid #f0f2f8" }}>
          <div style={{ fontSize: 9, fontWeight: 700, color: "#6677aa", letterSpacing: 2, textTransform: "uppercase", fontFamily: "'Barlow Condensed', sans-serif", marginBottom: 7 }}>Bill To</div>
          {form.client ? (
            <>
              <div style={{ fontWeight: 700, fontSize: 15, color: "#111", marginBottom: 3 }}>{clientData.name || form.client}</div>
              {addr && <div style={{ fontSize: 13, color: "#555", lineHeight: 1.5 }}>{addr}</div>}
              <div style={{ display: "flex", gap: 16, marginTop: 4, flexWrap: "wrap" }}>
                {clientData.phone && <div style={{ fontSize: 12, color: "#777" }}>{clientData.phone}</div>}
                {clientData.email && <div style={{ fontSize: 12, color: "#999" }}>{clientData.email}</div>}
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
              <div style={{ paddingRight: 8, minWidth: 0, overflowWrap: "break-word", wordBreak: "break-word" }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: "#222", overflowWrap: "break-word", wordBreak: "break-word" }}>{item.name || item.desc || <span style={{ color: "#ccc" }}>—</span>}</div>
                {item.name && item.desc && (
                  <div style={{ fontSize: 11, color: "#999", marginTop: 2, lineHeight: 1.45, whiteSpace: "pre-wrap", overflowWrap: "break-word", wordBreak: "break-word" }}>
                    {item.desc}
                  </div>
                )}
                {item.discount > 0 && <div style={{ fontSize: 11, color: "#e74c3c", marginTop: 2 }}>Discount: {item.discountType === "%" ? `${item.discount}%` : fmt(item.discount)}</div>}
              </div>
              <div style={{ fontSize: 13, color: "#666", textAlign: "center" }}>{item.qty}</div>
              <div style={{ fontSize: 13, fontWeight: 600, color: "#222", textAlign: "right" }}>{fmt(calcItemTotal(item))}</div>
            </div>
          ))}
        </div>
        <div style={{ padding: "14px 24px 16px", background: "#f8f9fc", borderTop: "1px solid #eaecf0" }}>
          {[["Subtotal", fmt(t.sub)], ...(t.disc > 0 ? [[form.discountType === "%" ? `Discount (${form.discount}%)` : "Discount", "−" + fmt(t.disc)]] : []), [`GET (${form.tax}%)`, fmt(t.taxAmt)]].map(([label, val]) => (
            <div key={label} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "#666", marginBottom: 6 }}><span>{label}</span><span>{val}</span></div>
          ))}
          <div style={{ display: "flex", justifyContent: "space-between", borderTop: "2px solid #dde2ee", paddingTop: 10, marginTop: 6 }}>
            <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 16, color: "#111" }}>TOTAL DUE</span>
            <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 21, color: ORANGE }}>{fmt(t.total)}</span>
          </div>
          {totalSurcharge > 0 && (
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8, fontSize: 13, color: "#666" }}>
              <span>Processing fee</span>
              <span>+{fmt(totalSurcharge)}</span>
            </div>
          )}
          {t.paid > 0 && (
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8, fontSize: 13, color: "#27ae60" }}>
              <span>Paid</span>
              <span>−{fmt(t.paid + totalSurcharge)}</span>
            </div>
          )}
          {lateFeeInfo.fee > 0 && (
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, fontSize: 13, color: ORANGE, fontWeight: 600 }}>
              <span>Late fee ({lateFeeInfo.months}× {lateFeeInfo.rate}%)</span>
              <span>+{fmt(lateFeeInfo.fee)}</span>
            </div>
          )}
          {(t.paid > 0 || lateFeeInfo.fee > 0) && (
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8, paddingTop: 8, borderTop: "1px solid #eee" }}>
              <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 14, color: balanceWithFee > 0 ? ORANGE : "#27ae60" }}>{balanceWithFee > 0 ? "BALANCE DUE" : "PAID IN FULL"}</span>
              <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 17, color: balanceWithFee > 0 ? ORANGE : "#27ae60" }}>{fmt(balanceWithFee)}</span>
            </div>
          )}
        </div>
        {form.notes && (
          <div style={{ padding: "13px 24px", borderTop: "1px solid #f0f2f8" }}>
            <div style={{ fontSize: 9, fontWeight: 700, color: "#6677aa", letterSpacing: 1.5, textTransform: "uppercase", fontFamily: "'Barlow Condensed', sans-serif", marginBottom: 6 }}>Notes</div>
            <div style={{ fontSize: 12, color: "#555", lineHeight: 1.65, whiteSpace: "pre-wrap" }}>{form.notes}</div>
          </div>
        )}
        {paymentInstructionsText && (
          <div style={{ padding: "13px 24px 16px", borderTop: "1px solid #f0f2f8" }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: NAVY, letterSpacing: 1.5, textTransform: "uppercase", fontFamily: "'Barlow Condensed', sans-serif", marginBottom: 6 }}>Payment Instructions</div>
            <div style={{ fontSize: 12, color: "#555", lineHeight: 1.65, whiteSpace: "pre-wrap" }}>{paymentInstructionsText}</div>
          </div>
        )}
        {photos.length > 0 && (
          <div style={{ padding: '13px 24px 16px', borderTop: '1px solid #f0f2f8' }}>
            <div style={{ fontSize: 9, fontWeight: 700, color: '#6677aa', letterSpacing: 1.5, textTransform: 'uppercase', fontFamily: "'Barlow Condensed', sans-serif", marginBottom: 10 }}>Job Photos</div>
            {(beforePhotos.length > 0 || afterPhotos.length > 0) && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 10 }}>
                <div>
                  <div style={{ fontSize: 9, fontWeight: 700, color: NAVY, letterSpacing: 1, textTransform: 'uppercase', fontFamily: "'Barlow Condensed', sans-serif", marginBottom: 6 }}>Before</div>
                  {beforePhotos.map(p => (
                    <div key={p.id} style={{ marginBottom: 8 }}>
                      <img src={p.url} alt={p.caption || 'before'} style={{ maxWidth: '100%', borderRadius: 6, display: 'block' }} />
                      {p.caption && <div style={{ fontSize: 10, color: '#888', marginTop: 3 }}>{p.caption}</div>}
                    </div>
                  ))}
                </div>
                <div>
                  <div style={{ fontSize: 9, fontWeight: 700, color: NAVY, letterSpacing: 1, textTransform: 'uppercase', fontFamily: "'Barlow Condensed', sans-serif", marginBottom: 6 }}>After</div>
                  {afterPhotos.map(p => (
                    <div key={p.id} style={{ marginBottom: 8 }}>
                      <img src={p.url} alt={p.caption || 'after'} style={{ maxWidth: '100%', borderRadius: 6, display: 'block' }} />
                      {p.caption && <div style={{ fontSize: 10, color: '#888', marginTop: 3 }}>{p.caption}</div>}
                    </div>
                  ))}
                </div>
              </div>
            )}
            {otherPhotos.length > 0 && (
              <div>
                <div style={{ fontSize: 9, fontWeight: 700, color: NAVY, letterSpacing: 1, textTransform: 'uppercase', fontFamily: "'Barlow Condensed', sans-serif", marginBottom: 6 }}>Additional Photos</div>
                {otherPhotos.map(p => (
                  <div key={p.id} style={{ marginBottom: 8 }}>
                    <img src={p.url} alt={p.caption || 'photo'} style={{ maxWidth: '100%', borderRadius: 6, display: 'block' }} />
                    {p.caption && <div style={{ fontSize: 10, color: '#888', marginTop: 3 }}>{p.caption}</div>}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        <div style={{ background: NAVY, padding: "13px 24px", textAlign: "center" }}>
          <div style={{ color: "#8899bb", fontSize: 11 }}>Thank you for your business!</div>
          <div style={{ color: "#6677aa", fontSize: 10, marginTop: 3 }}>higradeplumbing.com · (808) 393-0015</div>
          <div style={{ color: "#6677aa", fontSize: 10, marginTop: 2 }}>Pay via Venmo: @HIGP808 · PayPal · Cash · Check</div>
        </div>
      </div>
    </div>
  );
}

// ─── Client Picker Modal ──────────────────────────────────────────────────────
// Bottom-sheet modal for selecting a client on the invoice form.
// Search, edit, create new, and import from iPhone/Android Contacts.
function ClientPickerModal({ clients, selectedName, onClose, onSelect, onSave, onOpenEdit }) {
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [newForm, setNewForm] = useState({ name: "", email: "", email2: "", phone: "", address1: "", address2: "", address3: "" });
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState("");
  const clearNewClientDraft = useDraftPersistence(
    'higrade_quick_add_client',
    creating ? newForm : null,
    (draft) => { setNewForm(draft); setCreating(true); },
    null
  );

  const q = search.trim().toLowerCase();
  const filtered = q
    ? clients.filter(c => (c.name || "").toLowerCase().includes(q) || (c.email || "").toLowerCase().includes(q) || (c.phone || "").toLowerCase().includes(q))
    : clients;
  const sorted = [...filtered].sort((a, b) => (a.name || "").localeCompare(b.name || ""));

  const handleImport = async () => {
    setImportError("");
    if (!canImportContacts()) {
      setImportError("Contacts import is only available in the iPhone or Android app. Open the installed app to use this.");
      return;
    }
    setImporting(true);
    try {
      const c = await pickContact();
      if (!c) { setImporting(false); return; }
      // Pre-fill the new-client form with the picked contact, let user confirm + save
      setNewForm({
        name: c.name || "",
        email: c.email || "",
        email2: c.email2 || "",
        phone: c.phone || "",
        address1: c.address1 || "",
        address2: c.address2 || "",
        address3: c.address3 || "",
      });
      setCreating(true);
    } catch (e) {
      setImportError(e.message || "Failed to import");
    }
    setImporting(false);
  };

  const handleSaveNew = async () => {
    if (!newForm.name?.trim()) { alert("Name is required"); return; }
    const saved = await onSave(newForm);
    if (saved) {
      clearNewClientDraft();
      onSelect(saved);
      onClose();
    }
  };

  // Render through a portal to document.body. The InvoiceForm carousel uses
  // `transform` + `will-change`, which creates a containing block for any
  // descendant `position: fixed` elements — that pinned this modal to one
  // carousel column instead of the viewport, pushing it off-screen when
  // the iOS keyboard appeared.
  if (creating) {
    return createPortal(
      <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 600, display: "flex", alignItems: "flex-start", justifyContent: "center" }} onClick={onClose}>
        <div onClick={e => e.stopPropagation()} style={{ background: "#fff", width: "100%", maxWidth: 480, borderRadius: "0 0 16px 16px", padding: "20px 18px 28px", maxHeight: "90vh", overflowY: "auto" }}>
          <div style={{ display: "flex", alignItems: "center", marginBottom: 14, gap: 10 }}>
            <button onClick={() => { clearNewClientDraft(); setCreating(false); }} style={{ background: "none", border: "none", cursor: "pointer", padding: 4 }}><Icon name="back" size={20} /></button>
            <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 18, letterSpacing: 1, flex: 1 }}>NEW CLIENT</span>
            <button onClick={onClose} style={{ background: "none", border: "none", color: "#888", cursor: "pointer", fontSize: 26, lineHeight: 1, padding: "0 4px" }}>×</button>
          </div>
          {[["name", "Name"], ["email", "Email", "email"], ["email2", "Secondary Email", "email"], ["phone", "Phone", "tel"], ["address1", "Address"], ["address2", "City, State"], ["address3", "ZIP"]].map(([k, label, type]) => (
            <div key={k} style={{ marginBottom: 10 }}>
              <label style={{ ...S.label, marginBottom: 3 }}>{label}</label>
              <input style={S.input} type={type || "text"} value={newForm[k] || ""} onChange={e => setNewForm(f => ({ ...f, [k]: e.target.value }))} />
            </div>
          ))}
          <button onClick={handleSaveNew} style={{ ...S.btn("primary"), width: "100%", marginTop: 8, fontSize: 15, padding: 12 }}>Save Client</button>
        </div>
      </div>,
      document.body
    );
  }

  return createPortal(
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 600, display: "flex", alignItems: "flex-start", justifyContent: "center" }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ background: "#fff", width: "100%", maxWidth: 480, borderRadius: "0 0 16px 16px", padding: "18px 16px 24px", maxHeight: "82vh", display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 18, letterSpacing: 1 }}>SELECT CLIENT</span>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "#888", cursor: "pointer", fontSize: 26, lineHeight: 1, padding: "0 4px" }}>×</button>
        </div>

        <input
          autoFocus
          style={{ ...S.input, marginBottom: 10 }}
          placeholder="Search clients…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />

        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          <button onClick={() => { setNewForm({ name: search, email: "", email2: "", phone: "", address1: "", address2: "", address3: "" }); setCreating(true); }} style={{ ...S.btn("primary"), flex: 1, fontSize: 13, padding: "10px 0", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
            <Icon name="plus" size={14} color="#fff" /> New Client
          </button>
          <button onClick={handleImport} disabled={importing} style={{ ...S.btn("navy"), flex: 1, fontSize: 13, padding: "10px 0", display: "flex", alignItems: "center", justifyContent: "center", gap: 6, opacity: importing ? 0.6 : 1 }}>
            <Icon name="person" size={14} color="#fff" /> {importing ? "Opening…" : "From Contacts"}
          </button>
        </div>

        {importError && <div style={{ background: "#fff4f0", border: "1px solid #ffd6c2", color: "#a44222", borderRadius: 8, padding: "8px 10px", fontSize: 12, marginBottom: 10 }}>{importError}</div>}

        <div style={{ flex: 1, overflowY: "auto", borderTop: "1px solid #eee", margin: "0 -16px", padding: "0 16px" }}>
          {sorted.length === 0 && (
            <div style={{ padding: "24px 8px", textAlign: "center", color: "#888", fontSize: 13 }}>
              {clients.length === 0 ? "No clients yet — create one above." : "No matches."}
            </div>
          )}
          {sorted.map(c => {
            const isSelected = c.name === selectedName;
            return (
              <div key={c.id} style={{ display: "flex", alignItems: "center", borderBottom: "1px solid #f1f3f8", padding: "10px 0", gap: 8 }}>
                <div onClick={() => { onSelect(c); onClose(); }} style={{ flex: 1, minWidth: 0, cursor: "pointer" }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: isSelected ? ORANGE : "#1a1a1a", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {c.name}{isSelected && <span style={{ fontSize: 11, marginLeft: 8, color: ORANGE }}>✓ selected</span>}
                  </div>
                  {(c.phone || c.email) && (
                    <div style={{ fontSize: 12, color: "#888", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {c.phone}{c.phone && c.email ? " · " : ""}{c.email}
                    </div>
                  )}
                </div>
                <button onClick={() => { onOpenEdit(c); onClose(); }} style={{ background: "none", border: "none", cursor: "pointer", color: ORANGE, fontSize: 12, fontWeight: 700, padding: "6px 8px" }}>Edit</button>
              </div>
            );
          })}
        </div>
      </div>
    </div>,
    document.body
  );
}

// Single line-item row inside the invoice form. Extracted so we can call
// the useLongPress hook per-row (hooks can't be called inside .map). Long-
// press = confirm + remove. Long-press is disabled while reordering so it
// doesn't conflict with the drag handles.
function LineItemRow({ item, i, reordering, dragIdx, setDragIdx, setEditingItem, moveItem, removeItem, descPreview, itemsLength }) {
  const longPress = useLongPress(() => {
    if (reordering) return;
    if (confirm("Delete this line item?")) removeItem(i);
  });
  // Only attach the long-press handlers when not reordering, so the drag
  // handles aren't blocked by pointer-down listeners on the parent.
  const lpProps = reordering ? {} : longPress;
  return (
    <div
      onClick={() => !reordering && setEditingItem(i)}
      {...lpProps}
      draggable={reordering}
      onDragStart={() => setDragIdx(i)}
      onDragOver={e => e.preventDefault()}
      onDrop={() => { if (dragIdx !== null && dragIdx !== i) { moveItem(dragIdx, i); setDragIdx(null); } }}
      style={{ background: "#fff", borderRadius: 10, padding: "11px 12px", marginBottom: 8, boxShadow: "0 1px 4px rgba(0,0,0,0.06)", cursor: reordering ? "grab" : "pointer", display: "flex", alignItems: "center", gap: 8, opacity: dragIdx === i ? 0.5 : 1, userSelect: "none", WebkitUserSelect: "none", WebkitTouchCallout: "none" }}
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
          <button onClick={e => { e.stopPropagation(); i < itemsLength - 1 && moveItem(i, i + 1); }} style={{ width: 28, height: 28, background: i < itemsLength - 1 ? "#f0f2f8" : "#f8f9fc", border: "none", borderRadius: 6, cursor: i < itemsLength - 1 ? "pointer" : "default", display: "flex", alignItems: "center", justifyContent: "center" }}><Icon name="arrowDown" size={14} color={i < itemsLength - 1 ? "#555" : "#ddd"} /></button>
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
}

function InvoiceForm({ invoice, defaultType, clients, savedItems, gcalAuthed, onSave, onPartialSave, onAutoSave, onCancel, onDelete, onSaveItem, onUpdateClient, onCreateClient, onOpenClient, onConvert, data, onAIAction, autoSendKind, onAutoSendConsumed, isAdmin }) {
  const blankItem = { name: "", desc: "", qty: 1, price: 0, unit: "ea", discount: 0, discountType: "%", taxable: true };
  // Estimates default to no due date — they're proposals, not bills.
  // The PDF preview will surface a separate "Valid for 30 days" note instead.
  const [form, setForm] = useState(invoice ? { discountType: "$", ...invoice } : { type: defaultType || "invoice", client: "", date: today(), dueDate: defaultType === "estimate" ? "" : today(), status: "outstanding", items: [{ ...blankItem }], tax: TAX_RATE, discount: 0, discountType: "$", notes: "", payments: [] });
  const [activeTab, setActiveTab] = useState("edit");
  const [showSaved, setShowSaved] = useState(false);
  const [showPriceBook, setShowPriceBook] = useState(false);
  const [showAI, setShowAI] = useState(false);
  const [showPayment, setShowPayment] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [reordering, setReordering] = useState(false);
  const [dragIdx, setDragIdx] = useState(null);
  const [emailStatus, setEmailStatus] = useState("");
  const [showScheduleJob, setShowScheduleJob] = useState(false);
  const [showFollowUp, setShowFollowUp] = useState(false);
  const [showSignature, setShowSignature] = useState(false);
  const [editingClient, setEditingClient] = useState(false);
  const [clientEditVisible, setClientEditVisible] = useState(false);
  const SLIDE_MS = 300;
  useEffect(() => {
    if (!editingClient) return;
    const id = requestAnimationFrame(() => setClientEditVisible(true));
    return () => cancelAnimationFrame(id);
  }, [editingClient]);
  // Inline "+ Add new property" flow on the invoice/estimate form. When set,
  // we render a tiny address form below the Job Site dropdown so the user can
  // add a property without leaving the invoice. On save, we persist to the
  // client and select the new address as the job site.
  const [addingProperty, setAddingProperty] = useState(false);
  const [propertyDraft, setPropertyDraft] = useState(null);
  const [savingProperty, setSavingProperty] = useState(false);
  // Working draft of the client record while editing inline. The full client
  // shape (name/email/phone/addresses[]/billingAddress) so we can reuse the
  // same ClientEditFields component the Clients page uses. Only saved on
  // Done so the user can cancel out by collapsing the editor.
  const [clientDraft, setClientDraft] = useState(null);
  const [savingClient, setSavingClient] = useState(false);
  // Draft persistence for the inline client editor. null state auto-clears the draft.
  // Key is scoped to this invoice so a draft from Invoice A can never bleed into Invoice B.
  const clientDraftKey = 'higrade_client_draft_' + (invoice?.id || 'new');
  const clearClientDraft = useDraftPersistence(
    clientDraftKey,
    clientDraft,
    (draft) => { setClientDraft(draft); setEditingClient(true); },
    null
  );
  const [showClientPicker, setShowClientPicker] = useState(false);
  const [confirmSend, setConfirmSend] = useState(null); // null | "invoice" | "estimate"
  const [sendMethodFor, setSendMethodFor] = useState(null); // null | "invoice" | "estimate"
  // When the user picks Send from the long-press quick-actions menu on the
  // list, the parent opens the form with autoSendKind set. Pop the same
  // send-method sheet the in-form Send Email button uses, exactly once.
  const autoSendConsumedRef = useRef(false);
  useEffect(() => {
    if (!autoSendKind) { autoSendConsumedRef.current = false; return; }
    if (autoSendConsumedRef.current) return;
    autoSendConsumedRef.current = true;
    setSendMethodFor(autoSendKind);
    onAutoSendConsumed?.();
  }, [autoSendKind]);
  const [sending, setSending] = useState(false);
  const [autoSavedId, setAutoSavedId] = useState(invoice?.id || null);
  // Keep a context entry so iOS-reload can navigate back to this invoice if the
  // client editor was open when the app was evicted.
  useEffect(() => {
    const id = invoice?.id || autoSavedId;
    if (clientDraft != null && id) {
      try { localStorage.setItem('higrade_client_draft_ctx', JSON.stringify({ invoiceId: id, key: clientDraftKey })); } catch {}
    } else {
      try { localStorage.removeItem('higrade_client_draft_ctx'); } catch {}
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientDraft, invoice?.id, autoSavedId]);
  const [invoicePhotos, setInvoicePhotos] = useState([]);
  // Per-invoice AI chat history. Lives on the form so toggling the panel
  // closed/open preserves the conversation. Each invoice gets its own bucket
  // in localStorage keyed by id; an unsaved draft uses "draft" until autosave
  // assigns a real id, then we migrate the history to that id's bucket.
  const aiChatGreeting = { role: "assistant", text: "Hey Jake! Describe a job and I'll build the estimate, or tell me to change the client, set the date, mark this paid, etc." };
  const aiChatKey = `higrade_inv_chat_${autoSavedId || "draft"}`;
  const [aiMsgs, setAiMsgs] = useState(() => {
    try {
      const raw = localStorage.getItem(aiChatKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length) return parsed;
      }
    } catch {}
    return [aiChatGreeting];
  });
  // When the form switches to a different invoice (autoSavedId changes), load
  // that invoice's chat history. This also handles the draft → saved-id
  // transition: if there's no history under the new id but there IS under
  // "draft", carry the draft history over so the user doesn't lose context
  // the first time their invoice is autosaved.
  const aiChatKeyRef = useRef(aiChatKey);
  useEffect(() => {
    if (aiChatKeyRef.current === aiChatKey) return;
    const prevKey = aiChatKeyRef.current;
    aiChatKeyRef.current = aiChatKey;
    try {
      const raw = localStorage.getItem(aiChatKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length) { setAiMsgs(parsed); return; }
      }
      // No history under the new key. If we just got an id for what was a
      // draft, migrate the draft history to the new id-keyed slot.
      if (prevKey === "higrade_inv_chat_draft" && aiChatKey !== "higrade_inv_chat_draft") {
        const draftRaw = localStorage.getItem("higrade_inv_chat_draft");
        if (draftRaw) {
          localStorage.setItem(aiChatKey, draftRaw);
          localStorage.removeItem("higrade_inv_chat_draft");
          setAiMsgs(JSON.parse(draftRaw));
          return;
        }
      }
    } catch {}
    setAiMsgs([aiChatGreeting]);
  }, [aiChatKey]);
  // Persist this invoice's chat history on every change. Cap at 200 messages.
  useEffect(() => {
    if (!Array.isArray(aiMsgs)) return;
    try {
      const trimmed = aiMsgs.length > 200 ? aiMsgs.slice(-200) : aiMsgs;
      localStorage.setItem(aiChatKey, JSON.stringify(trimmed));
    } catch {}
  }, [aiMsgs, aiChatKey]);
  const resetAiChat = () => setAiMsgs([aiChatGreeting]);
  // The optimistic-lock token. Tracked in a ref (not state) so the latest
  // value is always available inside flushAutoSaveRef without re-creating
  // the ref on every render. Initialized from the loaded invoice and
  // refreshed after every successful save.
  const updatedAtRef = useRef(invoice?.updatedAt || null);
  // When set, suppresses the unmount-flush autosave. Used by Delete so the
  // form doesn't re-create the row we just deleted.
  const skipFlushRef = useRef(false);
  // Fixed header (NAVY bar + tab bar). useLayoutEffect measures before paint
  // so paddingTop is correct on first render — no content hidden on load.
  const formHeaderRef = useRef(null);
  const [formHeaderH, setFormHeaderH] = useState(0);
  useLayoutEffect(() => {
    const el = formHeaderRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setFormHeaderH(el.offsetHeight));
    ro.observe(el);
    setFormHeaderH(el.offsetHeight);
    return () => ro.disconnect();
  }, []);
  // Activity events from invoice_events (sent, opened, etc.)
  const [events, setEvents] = useState([]);
  const [refreshingEvents, setRefreshingEvents] = useState(false);
  const [versions, setVersions] = useState([]);
  const [savingSnapshot, setSavingSnapshot] = useState(false);
  const refreshHistory = async () => {
    if (!form.id) return;
    setRefreshingEvents(true);
    try {
      const [evs, vers] = await Promise.all([
        db.loadInvoiceEvents(form.id),
        db.loadInvoiceVersions(form.id),
      ]);
      setEvents(evs);
      setVersions(vers);
    } catch (e) { console.warn('loadHistory failed:', e); }
    setTimeout(() => setRefreshingEvents(false), 450);
  };
  // Keep old name as alias so existing call-sites don't need to change.
  const refreshEvents = refreshHistory;
  useEffect(() => { refreshHistory(); /* eslint-disable-next-line */ }, [form.id]);
  useEffect(() => { if (activeTab === 'history') refreshHistory(); /* eslint-disable-next-line */ }, [activeTab]);
  useEffect(() => { const id = form.id || autoSavedId; if (id) fetchInvoicePhotos(id).then(setInvoicePhotos); /* eslint-disable-next-line */ }, [form.id, autoSavedId]);
  useEffect(() => { if (activeTab !== 'preview') return; const id = form.id || autoSavedId; if (id) fetchInvoicePhotos(id).then(setInvoicePhotos); /* eslint-disable-next-line */ }, [activeTab]);
  const [autoSaving, setAutoSaving] = useState(false);
  // Debounced auto-save — persists silently while the user edits so the back
  // button and the Save button are interchangeable. We skip the very first
  // render so we don't write the unchanged initial state back to the DB.
  const formRef = useRef(form);
  formRef.current = form;
  const autoSaveTimerRef = useRef(null);
  const skipFirstRef = useRef(true);
  // When the parent swaps in a different invoice/estimate (e.g. after Convert
  // or after the AI creates a new doc), reset the form to the new record so we
  // don't keep editing the previous doc's data — which would otherwise get
  // auto-saved back into the new record's row and clobber its type/fields.
  useEffect(() => {
    if (invoice?.id && invoice.id !== autoSavedId) {
      setForm({ discountType: "$", ...invoice });
      setAutoSavedId(invoice.id);
      updatedAtRef.current = invoice.updatedAt || null;
      skipFirstRef.current = true; // suppress the auto-save triggered by this reset
      setEditingClient(false);
      setClientDraft(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoice?.id]);
  // If an invoice loaded without a job_address but has a billing_address,
  // copy billing into job so ETA / address display always has something to use.
  useEffect(() => {
    setForm(f => {
      if (!f.jobAddress && f.billingAddress?.line1) {
        return { ...f, jobAddress: f.billingAddress };
      }
      return f;
    });
    // Run once on mount; the client-picker onSelect handles the live case.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Draft persistence — saves form to localStorage on every change so that
  // iOS Safari backgrounding / reload doesn't lose unsaved edits.
  const _invoiceDraftKey = 'higrade_invoice_draft_' + (invoice?.id || 'new');
  const clearInvoiceDraft = useDraftPersistence(_invoiceDraftKey, form, setForm, invoice?.updatedAt);

  const flushAutoSaveRef = useRef(async () => {});
  flushAutoSaveRef.current = async () => {
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = null;
    }
    if (!onAutoSave) return null;
    if (skipFlushRef.current) return null; // Delete in progress — don't re-create
    setAutoSaving(true);
    try {
      // Always send the freshest updatedAt token we know about so the RPC's
      // optimistic-lock check passes after the very first save.
      // Also snapshot the currently-selected job site + billing address from
      // the client onto the invoice so it stays correct even if the client's
      // addresses are edited later.
      const f = formRef.current;
      const c = clients.find(x => x.name === f.client);
      const cAddrs = Array.isArray(c?.addresses) ? c.addresses : [];
      const pickedJob = (f.jobAddressId && cAddrs.find(a => a.id === f.jobAddressId)) || f.jobAddress || cAddrs[0] || null;
      const billing = f.billingAddress || c?.billingAddress || null;
      const saved = await onAutoSave({
        ...f,
        jobAddress: pickedJob,
        billingAddress: billing,
        id: autoSavedId || f.id,
        updatedAt: updatedAtRef.current,
      });
      if (saved?.id && saved.id !== autoSavedId) setAutoSavedId(saved.id);
      if (saved?.updatedAt) updatedAtRef.current = saved.updatedAt;
      if (saved) clearInvoiceDraft();
      return saved;
    } catch (e) {
      console.error('Auto-save failed (kept local):', e);
      return null;
    } finally {
      setAutoSaving(false);
    }
  };
  useEffect(() => {
    if (skipFirstRef.current) { skipFirstRef.current = false; return; }
    if (!onAutoSave) return;
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    autoSaveTimerRef.current = setTimeout(() => { flushAutoSaveRef.current(); }, 800);
    return () => { if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form]);
  // On unmount (back button, navigation away), flush any pending changes and
  // clear the client draft so it can't bleed into a different invoice.
  useEffect(() => {
    return () => { flushAutoSaveRef.current(); clearClientDraft(); try { localStorage.removeItem('higrade_client_draft_ctx'); } catch {} };
  }, []);
  // Also flush to Supabase immediately when iOS sends the page to background.
  useEffect(() => {
    const flush = () => { if (document.visibilityState === 'hidden') flushAutoSaveRef.current(); };
    document.addEventListener('visibilitychange', flush);
    return () => document.removeEventListener('visibilitychange', flush);
  }, []);

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

  // AI "local action" handler — mutates the open form for instant feedback
  // without round-tripping through the DB. Returns true if handled.
  const handleLocalAIAction = async (action) => {
    const a = action || {};
    const validStatus = (s) => ["outstanding", "paid", "partial", "net30"].includes(s);
    switch (a.action) {
      case "add_items": {
        if (Array.isArray(a.items) && a.items.length) {
          handleAddFromAI(a.items, a.notes);
          return true;
        }
        return false;
      }
      case "update_invoice": {
        const c = a.changes || {};
        setForm(f => {
          const next = { ...f };
          if (typeof c.client === "string") {
            // Fuzzy-match against existing clients (case-insensitive, partial)
            const q = c.client.trim().toLowerCase();
            const exact = clients.find(cl => cl.name.toLowerCase() === q);
            const partial = !exact ? clients.find(cl => cl.name.toLowerCase().includes(q) || q.includes(cl.name.toLowerCase())) : null;
            const matched = exact || partial;
            if (matched) {
              next.client = matched.name;
              next.clientInfo = { name: matched.name, email: matched.email || "", phone: matched.phone || matched.mobile || "", address1: matched.address1 || "", address2: matched.address2 || "", address3: matched.address3 || "" };
            } else {
              next.client = c.client;
              next.clientInfo = null;
            }
          }
          if (typeof c.date === "string") next.date = c.date;
          if (typeof c.dueDate === "string") next.dueDate = c.dueDate;
          if (typeof c.status === "string" && validStatus(c.status)) next.status = c.status;
          if (typeof c.notes === "string") next.notes = c.notes;
          if (typeof c.discount === "number") next.discount = c.discount;
          if (typeof c.tax === "number") next.tax = c.tax;
          return next;
        });
        return true;
      }
      case "add_payment": {
        const p = a.payment;
        if (!p || typeof p.amount !== "number") return false;
        setForm(f => {
          const payments = [...(f.payments || []), { amount: p.amount, method: p.method || "Cash", date: p.date || today() }];
          const totals = calcTotals({ ...f, payments });
          const newStatus = totals.balance <= 0.005 ? "paid" : (totals.paid > 0 ? "partial" : f.status);
          return { ...f, payments, status: newStatus };
        });
        return true;
      }
      case "remove_item": {
        const idx = (a.itemIndex || 0) - 1;
        if (idx < 0) return false;
        setForm(f => ({ ...f, items: f.items.filter((_, i) => i !== idx) }));
        return true;
      }
      case "update_item": {
        const idx = (a.itemIndex || 0) - 1;
        const c = a.changes || {};
        if (idx < 0) return false;
        setForm(f => ({
          ...f,
          items: f.items.map((it, i) => i === idx ? {
            ...it,
            ...(typeof c.name === "string" ? { name: c.name } : {}),
            ...(typeof c.desc === "string" ? { desc: c.desc } : {}),
            ...(typeof c.qty === "number" ? { qty: c.qty } : {}),
            ...(typeof c.price === "number" ? { price: c.price } : {}),
            ...(typeof c.taxable === "boolean" ? { taxable: c.taxable } : {}),
          } : it),
        }));
        return true;
      }
      default:
        return false;
    }
  };

  const selectedClient = clients.find(c => c.name === form.client);
  const clientAddresses = Array.isArray(selectedClient?.addresses) ? selectedClient.addresses : [];
  // Resolve which job-site address applies to this invoice. Prefer the
  // explicitly picked id, then the snapshot already saved on the invoice,
  // then the client's first address.
  const resolvedJobAddress = (() => {
    if (form.jobAddressId && clientAddresses.length) {
      const found = clientAddresses.find(a => a.id === form.jobAddressId);
      if (found) return found;
    }
    if (form.jobAddress) return form.jobAddress;
    if (clientAddresses.length) return clientAddresses[0];
    return null;
  })();
  const effectiveClientInfo = form.clientInfo || (selectedClient ? {
    name: selectedClient.name,
    email: selectedClient.email || "",
    phone: selectedClient.phone || selectedClient.mobile || "",
    // When a job-site address is resolved, surface its lines as the displayed
    // address so the rest of the form (PDF, email body, etc.) reflects the
    // property the user picked. Falls back to legacy flat fields otherwise.
    address1: resolvedJobAddress?.line1 || selectedClient.address1 || "",
    address2: resolvedJobAddress?.line2 || selectedClient.address2 || "",
    address3: resolvedJobAddress?.line3 || selectedClient.address3 || "",
  } : null);
  const setClientInfoField = (k, v) => setField("clientInfo", { ...(effectiveClientInfo || {}), [k]: v });
  const categories = [...new Set(savedItems.map(i => i.category))];

  // Pop the send-method sheet first (Email vs Text). The chosen method then
  // either opens ConfirmSendModal (email) or sendViaText (sms link).
  const handleEmail = () => {
    setSendMethodFor("invoice");
  };

  const handleSendEstimate = () => {
    setSendMethodFor("estimate");
  };

  // Text-message path. Builds an sms: URL with the trackable public link
  // and a short prefilled message, then hands off to the OS Messages app.
  // We mint/reuse the view token first so the link in the SMS works, and
  // record a "sent" event with channel=sms.
  const sendViaText = async (kind) => {
    const client = { ...(selectedClient || {}), ...(effectiveClientInfo || {}) };
    const phone = (client?.phone || "").replace(/[^0-9+]/g, "");
    if (!phone) {
      alert("No phone number on file for this client. Add one in the client record first.");
      return;
    }
    setSendMethodFor(null);
    try {
      let viewToken = form.viewToken || null;
      if (form.id && !viewToken) {
        try {
          viewToken = await db.ensureViewToken(form);
          form.viewToken = viewToken;
        } catch (e) { console.warn('ensureViewToken failed:', e); }
      }
      const viewLink = viewToken ? `${window.location.origin}/v/${viewToken}` : '';
      const t = calcTotals(form);
      const isEst = kind === "estimate";
      const docNum = form.id || (isEst ? "EST0000" : "INV0000");
      const name = client?.name || form.client || "";
      // Honor any custom text template the user saved in Settings, otherwise
      // fall back to the built-in default. All {variables} get filled in.
      const tpl = isEst
        ? (messageTemplates.text_estimate || DEFAULT_ESTIMATE_TEXT)
        : (messageTemplates.text_invoice  || DEFAULT_INVOICE_TEXT);
      const body = renderTemplate(tpl, {
        name,
        id: docNum,
        total: fmt(t.total),
        link: viewLink,
        type: isEst ? "estimate" : "invoice",
      });
      // iOS uses & as the separator after the number; this also works on Android.
      const smsHref = `sms:${phone}${/iPad|iPhone|iPod/.test(navigator.userAgent) ? "&" : "?"}body=${encodeURIComponent(body)}`;
      window.location.href = smsHref;
      if (form.id) {
        try { await db.recordInvoiceEvent(form.id, 'sent', phone, { kind: isEst ? 'estimate' : 'invoice', channel: 'sms' }); }
        catch (e) { console.warn('recordInvoiceEvent failed:', e); }
        try { await db.recordInvoiceVersion(form, phone, isEst ? "Estimate texted" : "Invoice texted"); }
        catch (e) { console.warn('Version snapshot failed:', e); }
        refreshEvents?.();
      }
      setEmailStatus("✓ Opened Messages");
      setTimeout(() => setEmailStatus(""), 4000);
    } catch (e) {
      alert("Failed to open Messages: " + (e.message || e));
    }
  };

  // Called after user confirms recipient details in ConfirmSendModal.
  // For estimates, downPaymentPct is the share of the total to bill when the
  // customer signs (0 = none). We persist it on the estimate row before
  // sending so submit-signature.js can read it back when the customer signs.
  const handleConfirmedSend = async ({ name, email, message, downPaymentPct }) => {
    const client = { ...(selectedClient || {}), ...(effectiveClientInfo || {}), email, name };
    setSending(true);
    // Persist the chosen down-payment percent on the estimate. Best-effort:
    // if this fails we still send the email, but the customer's signature
    // won't trigger an auto-invoice.
    if (confirmSend === 'estimate' && form.id && typeof downPaymentPct === 'number' && downPaymentPct !== form.downPaymentPct) {
      const updatedForm = { ...form, downPaymentPct };
      setForm(updatedForm);
      try { await onPartialSave?.(updatedForm); }
      catch (e) { console.warn('persist downPaymentPct failed:', e); }
    }
    try {
      // Mint (or reuse) a public view-token so the email link is trackable.
      // Best-effort: if the DB write fails we still send the email, just
      // without a tracked link.
      let viewToken = form.viewToken || null;
      if (form.id && !viewToken) {
        try {
          viewToken = await db.ensureViewToken(form);
          form.viewToken = viewToken; // mutate so subsequent sends reuse it
        } catch (e) { console.warn('ensureViewToken failed:', e); }
      }
      const viewLink = viewToken ? `${window.location.origin}/v/${viewToken}` : '';

      if (confirmSend === "estimate") {
        const t2 = calcTotals(form);
        const items = form.items.map(it => ({ name: it.name, total: calcItemTotal(it).toFixed(2) }));
        await fetch(api("/api/send-estimate"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ to: email, clientName: name, estimateId: form.id || "EST0000", total: t2.total.toFixed(2), viewLink, items, message: message || "" }) });
        // Log a "sent" activity event + snapshot version (both best-effort).
        if (form.id) {
          try { await db.recordInvoiceEvent(form.id, 'sent', email, { kind: 'estimate' }); }
          catch (e) { console.warn('recordInvoiceEvent failed:', e); }
          try { await db.recordInvoiceVersion(form, email, "Estimate sent"); }
          catch (e) { console.warn('Version snapshot failed:', e); }
        }
        alert("Estimate sent. The link in the email will be tracked when opened.");
      } else {
        const result = await sendInvoiceEmail(form, client, message, viewLink);
        if (result?.error) {
          setEmailStatus("Failed");
        } else {
          setEmailStatus("✓ Sent!");
          if (form.id) {
            try { await db.recordInvoiceEvent(form.id, 'sent', email, { kind: 'invoice' }); }
            catch (e) { console.warn('recordInvoiceEvent failed:', e); }
            try { await db.recordInvoiceVersion(form, email, "Invoice sent"); }
            catch (e) { console.warn('Version snapshot failed:', e); }
          }
        }
        setTimeout(() => setEmailStatus(""), 4000);
      }
      // Reload events for the History tab so the new "sent" entry shows up.
      if (form.id) refreshEvents?.();
      setConfirmSend(null);
    } catch (e) {
      alert("Failed to send: " + (e.message || e));
      setEmailStatus("Failed");
      setTimeout(() => setEmailStatus(""), 4000);
    } finally {
      setSending(false);
    }
  };

  // Print / Save as PDF — uses native browser print on the Preview tab.
  const handlePrint = () => {
    setActiveTab("preview");
    // Wait a tick for the preview to render before opening the print dialog.
    setTimeout(() => window.print(), 250);
  };

  // Convert estimate ↔ invoice (creates a copy, doesn't replace original).
  const handleConvert = () => {
    const targetType = isEstimate ? "invoice" : "estimate";
    const msg = targetType === "estimate"
      ? `Convert this invoice back to an estimate? The original invoice will be DELETED — only the new estimate will remain.`
      : `Create a copy of this as an invoice? The original estimate will be kept (and marked as closed).`;
    if (!confirm(msg)) return;
    onConvert?.({ ...form, updatedAt: updatedAtRef.current }, targetType);
  };

  const saveSnapshot = async (note) => {
    const id = form.id || autoSavedId;
    if (!id) return;
    setSavingSnapshot(true);
    try {
      await flushAutoSaveRef.current();
      await db.recordInvoiceVersion({ ...formRef.current, id }, null, note || "Manual snapshot");
      await refreshHistory();
    } catch (e) { console.warn('saveSnapshot failed:', e); }
    setSavingSnapshot(false);
  };

  // Save button now means "save and exit". Auto-save already handles the
  // persistence on its own — we just flush any pending change and close.
  const handleSave = async () => {
    if (onAutoSave) {
      await flushAutoSaveRef.current();
      // Record a version snapshot each time the user explicitly saves so
      // the history tab has something to restore from even if never sent.
      const id = form.id || autoSavedId;
      if (id) db.recordInvoiceVersion({ ...formRef.current, id }, null, "Saved").catch(() => {});
      onCancel?.();
    } else {
      onSave(form);
      clearInvoiceDraft();
    }
  };
  // Back arrow flushes pending edits then navigates away.
  const handleBack = async () => {
    await flushAutoSaveRef.current();
    onCancel?.();
  };
  // Edge-swipe-from-left back gesture. App dispatches 'app-back-form'
  // when the form is the active back-able view.
  const closeClientEdit = () => {
    setClientEditVisible(false);
    setTimeout(() => {
      setEditingClient(false);
      setClientDraft(null);
      clearClientDraft();
      try { localStorage.removeItem('higrade_client_draft_ctx'); } catch {}
    }, SLIDE_MS);
  };
  const editingClientRef = useRef(editingClient);
  useEffect(() => { editingClientRef.current = editingClient; }, [editingClient]);
  useEffect(() => {
    const onSwipeBack = () => {
      if (editingClientRef.current) {
        closeClientEdit();
      } else {
        handleBack();
      }
    };
    window.addEventListener('app-back-form', onSwipeBack);
    return () => window.removeEventListener('app-back-form', onSwipeBack);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Merge: created → payments → server-side events (sent/opened). Server
  // events use full ISO timestamps; created+payments are just YYYY-MM-DD,
  // so we sort by a unified `sortKey` (timestamp ms).
  const dayMs = (d) => d ? new Date(d + (d.length === 10 ? 'T00:00:00' : '')).getTime() : 0;
  const historyEvents = [
    { date: form.date, label: isEstimate ? "Estimate created" : "Invoice created", type: "created", amount: null, sortKey: dayMs(form.date) },
    ...(form.payments || []).map(p => ({ date: p.date, label: `${p.method} payment received`, type: "payment", amount: p.amount, sortKey: dayMs(p.date) + 1 })),
    ...events.map(ev => {
      const when = ev.created_at;
      if (ev.kind === 'sent') {
        const isText = ev.meta?.channel === 'sms';
        const verb = isText ? 'Texted' : 'Sent';
        return {
          date: when,
          label: ev.recipient ? `${verb} to ${ev.recipient}` : (isEstimate ? `Estimate ${verb.toLowerCase()}` : `Invoice ${verb.toLowerCase()}`),
          type: 'sent',
          channel: isText ? 'sms' : 'email',
          amount: null,
          sortKey: new Date(when).getTime(),
        };
      }
      if (ev.kind === 'opened') {
        return {
          date: when,
          label: isEstimate ? 'Estimate opened by client' : 'Invoice opened by client',
          type: 'opened',
          amount: null,
          sortKey: new Date(when).getTime(),
        };
      }
      return null;
    }).filter(Boolean),
  ].sort((a, b) => b.sortKey - a.sortKey);

  const TABS = [{ id: "edit", label: "Edit", icon: "pencil" }, { id: "preview", label: "Preview", icon: "eye" }, { id: "history", label: "History", icon: "clock" }, { id: "photos", label: "Photos", icon: "camera" }];
  const tabIdx = Math.max(0, TABS.findIndex(t => t.id === activeTab));

  // Real carousel swipe between Edit / Preview / History. All three panels
  // render side-by-side in a 300%-wide flex track that translates by pixel
  // amounts (pixel-based is more reliable than %, see InvoiceList).
  const [dragX, setDragX] = useState(0);
  const [animating, setAnimating] = useState(false);
  const [viewportW, setViewportW] = useState(0);
  const trackRef = useRef(null);
  const swipeRef = useRef({ x: 0, y: 0, active: false, locked: null, width: 0 });

  useEffect(() => {
    const measure = () => { if (trackRef.current) setViewportW(trackRef.current.offsetWidth); };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  const goToTab = (nextId) => {
    if (nextId === activeTab) { setDragX(0); return; }
    setShowPriceBook(false);
    setAnimating(true);
    setActiveTab(nextId);
    setDragX(0);
    setTimeout(() => setAnimating(false), 260);
  };

  const onTabsTouchStart = (e) => {
    if (animating) return;
    // If the touch started inside an element opted out of horizontal swiping
    // (e.g. the AI chat panel, modals), don't engage the tab swiper at all.
    // Without this guard, tapping the chat input and dragging the caret
    // (or even tiny iOS auto-scroll movements while the keyboard opens)
    // gets interpreted as a tab swipe, which translates the whole track
    // horizontally and visibly shoves the chat box around.
    if (e.target?.closest?.('[data-no-swipe="true"]')) {
      swipeRef.current = { x: 0, y: 0, active: false, locked: null, width: 0 };
      return;
    }
    // Don't engage the swiper when the user touches a text field — they
    // need to tap, drag to select text, and scroll without swiping tabs.
    const tag = e.target?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
      swipeRef.current = { x: 0, y: 0, active: false, locked: null, width: 0 };
      return;
    }
    const t = e.touches[0];
    const width = trackRef.current?.offsetWidth || window.innerWidth;
    swipeRef.current = { x: t.clientX, y: t.clientY, active: true, locked: null, width };
    setDragX(0);
  };
  const onTabsTouchMove = (e) => {
    if (!swipeRef.current.active) return;
    const t = e.touches[0];
    const dx = t.clientX - swipeRef.current.x;
    const dy = t.clientY - swipeRef.current.y;
    if (swipeRef.current.locked === null && (Math.abs(dx) > 10 || Math.abs(dy) > 10)) {
      swipeRef.current.locked = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
    }
    if (swipeRef.current.locked === "x") {
      let clamped = dx;
      if ((tabIdx === 0 && dx > 0) || (tabIdx === TABS.length - 1 && dx < 0)) {
        clamped = dx * 0.3; // rubber-band past edges
      }
      setDragX(clamped);
    }
  };
  const onTabsTouchEnd = () => {
    if (swipeRef.current.locked === "x") {
      const width = swipeRef.current.width || 1;
      const ratio = dragX / width;
      const threshold = 0.18;
      let nextIdx = tabIdx;
      if (ratio < -threshold && tabIdx < TABS.length - 1) nextIdx = tabIdx + 1;
      else if (ratio > threshold && tabIdx > 0) nextIdx = tabIdx - 1;
      goToTab(TABS[nextIdx].id);
    } else {
      setDragX(0);
    }
    swipeRef.current = { x: 0, y: 0, active: false, locked: null, width: 0 };
  };

  const trackTransform = `translate3d(${-tabIdx * viewportW + dragX}px, 0, 0)`;
  const trackTransition = animating ? "transform 0.26s cubic-bezier(0.22, 0.61, 0.36, 1)" : (swipeRef.current.locked === "x" ? "none" : "transform 0.2s ease-out");

  return (
    <>
    <div onTouchStart={onTabsTouchStart} onTouchMove={onTabsTouchMove} onTouchEnd={onTabsTouchEnd} onTouchCancel={onTabsTouchEnd} style={{ paddingBottom: 100, paddingTop: formHeaderH, background: LIGHT, minHeight: "100vh" }}>
      {showPayment && <PaymentModal invoice={form} onClose={() => setShowPayment(false)} onSave={(updated) => { setForm(updated); onPartialSave?.(updated); }} />}
      {sendMethodFor && <SendMethodSheet
        kind={sendMethodFor}
        invoice={form}
        client={{ ...(selectedClient || {}), ...(effectiveClientInfo || {}) }}
        onClose={() => setSendMethodFor(null)}
        onPickEmail={() => { const k = sendMethodFor; setSendMethodFor(null); setConfirmSend(k); }}
        onPickText={() => sendViaText(sendMethodFor)}
      />}
      {confirmSend && <ConfirmSendModal kind={confirmSend} invoice={form} client={{ ...(selectedClient || {}), ...(effectiveClientInfo || {}) }} sending={sending} onClose={() => !sending && setConfirmSend(null)} onConfirm={handleConfirmedSend} />}
      {showScheduleJob && <ScheduleJobModal invoice={form} gcalAuthed={gcalAuthed} onClose={() => setShowScheduleJob(false)} onSave={fields => { const updated = { ...form, ...fields }; setForm(updated); onPartialSave?.(updated); }} />}
      {showFollowUp && <FollowUpModal invoice={form} gcalAuthed={gcalAuthed} onClose={() => setShowFollowUp(false)} onSave={fields => { const updated = { ...form, ...fields }; setForm(updated); onPartialSave?.(updated); }} />}
      {showSignature && <InPersonSignatureModal estimate={form} onClose={() => setShowSignature(false)} onSave={sigData => { const updated = { ...form, signatureData: sigData, signedAt: new Date().toISOString(), status: "approved" }; setForm(updated); setShowSignature(false); onPartialSave?.(updated); }} />}
      {editingItem !== null && (
        <ItemModal
          item={form.items[editingItem]}
          onSave={(updated) => updateItem(editingItem, updated)}
          onClose={() => setEditingItem(null)}
          onDelete={() => { removeItem(editingItem); setEditingItem(null); }}
          onSaveToLibrary={onSaveItem}
        />
      )}
      {showPriceBook && activeTab === "edit" && (
        <PriceBook
          items={savedItems}
          onSelect={item => {
            setForm(f => ({ ...f, items: [...f.items, { ...blankItem, name: item.name, desc: item.desc || "", price: item.price, taxable: item.taxable ?? true }] }));
            setShowPriceBook(false);
          }}
          onClose={() => setShowPriceBook(false)}
        />
      )}

      <div ref={formHeaderRef} style={{ position: "fixed", top: 0, left: "50%", transform: "translateX(-50%)", width: "100%", maxWidth: 480, zIndex: 100 }}>
      <div style={{ background: NAVY, padding: "14px 16px", display: "flex", alignItems: "center", gap: 12, boxShadow: "0 2px 12px rgba(0,0,0,0.3)" }}>
        <button onClick={handleBack} style={{ background: "none", border: "none", color: "#fff", cursor: "pointer", padding: 4 }}><Icon name="back" size={22} color="#fff" /></button>
        <span style={{ color: "#fff", fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 18, letterSpacing: 1, flex: 1, display: "flex", alignItems: "center", gap: 8 }}>
          {invoice ? invoice.id : autoSavedId || (isEstimate ? "New Estimate" : "New Invoice")}
          {autoSaving && <span style={{ fontSize: 10, fontWeight: 500, color: "#8899bb", letterSpacing: 0.5, textTransform: "none" }}>Saving…</span>}
        </span>
        {(invoice || autoSavedId) && onDelete && <button onClick={() => {
          if (!confirm("Delete this?")) return;
          // Cancel any pending debounced autosave AND block the unmount-flush.
          // Without this, the unmount handler would re-insert the row we're
          // about to delete, which is exactly what made delete look broken.
          skipFlushRef.current = true;
          if (autoSaveTimerRef.current) { clearTimeout(autoSaveTimerRef.current); autoSaveTimerRef.current = null; }
          onDelete((invoice && invoice.id) || autoSavedId);
        }} style={{ background: "none", border: "none", cursor: "pointer", padding: 4 }}><Icon name="trash" size={20} color="#cc4444" /></button>}
        <button onClick={handleSave} style={S.btn("primary")}>Done</button>
      </div>

      <div style={{ display: "flex", background: "#fff", borderBottom: "2px solid #eaecf0" }}>
        {TABS.map(tab => (
          <button key={tab.id} onClick={() => goToTab(tab.id)} style={{ flex: 1, padding: "10px 4px 9px", background: "none", border: "none", borderBottom: activeTab === tab.id ? `3px solid ${ORANGE}` : "3px solid transparent", color: activeTab === tab.id ? ORANGE : "#999", fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 12, letterSpacing: 1, textTransform: "uppercase", cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
            <Icon name={tab.icon} size={15} color={activeTab === tab.id ? ORANGE : "#bbb"} />{tab.label}
          </button>
        ))}
      </div>
      </div>

      <div ref={trackRef} style={{ overflow: "hidden", touchAction: "pan-y" }}>
      <div style={{ display: "flex", width: viewportW ? viewportW * TABS.length : "300%", transform: trackTransform, transition: trackTransition, willChange: "transform", alignItems: "flex-start" }}>
      {/* Non-active tabs collapse to maxHeight 0 at rest so the track only
          grows to fit the active panel's natural height (eliminates the dead
          space that the much-taller History panel would otherwise leave on the
          shorter Edit panel). During a swipe drag or settle animation, all
          panels expand back to natural height so the user actually sees the
          neighboring tab slide in horizontally. */}
      <div style={{ width: viewportW || `${100 / TABS.length}%`, flexShrink: 0, maxHeight: (tabIdx === 0 || dragX !== 0 || animating) ? "none" : 0, overflow: (tabIdx === 0 || dragX !== 0 || animating) ? "visible" : "hidden" }}>
        <div>
          {/* Bill To */}
          <div style={{ padding: "16px 16px 0" }}>
            <label style={S.label}>Bill To</label>
            <button
              type="button"
              onClick={() => setShowClientPicker(true)}
              style={{ ...S.input, textAlign: "left", display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer", background: "#fff" }}
            >
              <span style={{ color: form.client ? "#1a1a1a" : "#999" }}>{form.client || "Select client…"}</span>
              <Icon name="chevron" size={16} color="#888" />
            </button>
            {showClientPicker && (
              <ClientPickerModal
                clients={clients}
                selectedName={form.client}
                onClose={() => setShowClientPicker(false)}
                onSelect={(c) => {
                  // Pick the client's first job-site address by default. The
                  // resolvedJobAddress logic above will fall back to legacy
                  // flat fields if addresses[] is empty.
                  const cAddresses = Array.isArray(c.addresses) ? c.addresses : [];
                  const defaultAddr = cAddresses[0] || null;
                  const displayLine1 = defaultAddr?.line1 || c.address1 || "";
                  const displayLine2 = defaultAddr?.line2 || c.address2 || "";
                  const displayLine3 = defaultAddr?.line3 || c.address3 || "";
                  const billing = c.billingAddress || null;
                  setForm(f => ({
                    ...f,
                    client: c.name,
                    clientInfo: { name: c.name, email: c.email || "", phone: c.phone || c.mobile || "", address1: displayLine1, address2: displayLine2, address3: displayLine3 },
                    jobAddressId: defaultAddr?.id || null,
                    jobAddress: defaultAddr || billing || null,
                    billingAddress: billing,
                  }));
                  setEditingClient(false);
                  setClientDraft(null);
                }}
                onSave={async (newClient) => {
                  if (!onCreateClient) return null;
                  return await onCreateClient(newClient);
                }}
                onOpenEdit={(c) => onOpenClient?.(c)}
              />
            )}
            {selectedClient && !editingClient && (
              <div style={{ background: "#fff", borderRadius: 8, padding: "10px 13px", marginTop: 8, border: "1px solid #e8ecf4", display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  {effectiveClientInfo?.address1 && <div style={{ fontSize: 13, color: "#444", marginBottom: 3 }}>{effectiveClientInfo.address1}{effectiveClientInfo.address2 ? ", " + effectiveClientInfo.address2 : ""}{effectiveClientInfo.address3 ? " " + effectiveClientInfo.address3 : ""}</div>}
                  <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
                    {effectiveClientInfo?.phone && <span style={{ fontSize: 12, color: "#777" }}>{effectiveClientInfo.phone}</span>}
                    {effectiveClientInfo?.email && <span style={{ fontSize: 12, color: "#999" }}>{effectiveClientInfo.email}</span>}
                  </div>
                </div>
                <button onClick={() => {
                  // Seed the draft from the selected client (or, when only an
                  // ad-hoc clientInfo exists, from that). This keeps the
                  // working state separate so the user can cancel without
                  // dirtying the invoice.
                  if (selectedClient) {
                    setClientDraft({
                      ...emptyClient(),
                      ...selectedClient,
                      addresses: Array.isArray(selectedClient.addresses) ? [...selectedClient.addresses] : [],
                    });
                  } else if (effectiveClientInfo) {
                    setClientDraft({
                      ...emptyClient(),
                      name: effectiveClientInfo.name || "",
                      email: effectiveClientInfo.email || "",
                      phone: effectiveClientInfo.phone || "",
                      addresses: (effectiveClientInfo.address1 || effectiveClientInfo.address2 || effectiveClientInfo.address3) ? [{
                        id: newAddressId(),
                        label: "",
                        line1: effectiveClientInfo.address1 || "",
                        line2: effectiveClientInfo.address2 || "",
                        line3: effectiveClientInfo.address3 || "",
                      }] : [],
                    });
                  } else {
                    setClientDraft(emptyClient());
                  }
                  setEditingClient(true);
                }} style={{ background: "none", border: "none", cursor: "pointer", color: ORANGE, fontSize: 12, fontWeight: 700, padding: "0 0 0 10px", flexShrink: 0 }}>Edit</button>
              </div>
            )}
            {selectedClient && !editingClient && clientAddresses.length >= 1 && !addingProperty && (
              <div style={{ marginTop: 8 }}>
                <label style={{ ...S.label, marginBottom: 4 }}>Job Site</label>
                <select
                  style={{ ...S.input, background: "#fff", cursor: "pointer" }}
                  value={form.jobAddressId || clientAddresses[0]?.id || ""}
                  onChange={e => {
                    const newId = e.target.value;
                    if (newId === "__add_property__") {
                      setPropertyDraft({ id: newAddressId(), label: "", line1: "", line2: "", line3: "" });
                      setAddingProperty(true);
                      return;
                    }
                    const picked = clientAddresses.find(a => a.id === newId) || null;
                    setForm(f => ({
                      ...f,
                      jobAddressId: newId,
                      jobAddress: picked,
                      // Refresh the displayed address lines on the form's
                      // clientInfo snapshot so the rest of the UI (PDFs, email
                      // bodies, line on the bill-to card) follows the pick.
                      clientInfo: {
                        ...(f.clientInfo || {}),
                        name: f.clientInfo?.name || selectedClient.name,
                        email: f.clientInfo?.email ?? (selectedClient.email || ""),
                        phone: f.clientInfo?.phone ?? (selectedClient.phone || selectedClient.mobile || ""),
                        address1: picked?.line1 || "",
                        address2: picked?.line2 || "",
                        address3: picked?.line3 || "",
                      },
                    }));
                  }}
                >
                  {clientAddresses.map(a => {
                    const label = a.label || a.line1 || "Address";
                    const sub = [a.line1, a.line2].filter(Boolean).join(", ");
                    const display = a.label && sub ? `${label} — ${sub}` : (label || sub);
                    return <option key={a.id} value={a.id}>{display}</option>;
                  })}
                  <option value="__add_property__">+ Add new property…</option>
                </select>
              </div>
            )}
            {addingProperty && propertyDraft && (
              <div style={{ background: "#fff", borderRadius: 8, padding: "14px 13px", marginTop: 8, border: "1px solid #e8ecf4" }}>
                <div style={{ ...S.label, marginBottom: 8 }}>Add Property</div>
                <input
                  style={{ ...S.input, marginBottom: 8 }}
                  placeholder="Nickname (optional, e.g. Unit 4B)"
                  value={propertyDraft.label}
                  onChange={e => setPropertyDraft(p => ({ ...p, label: e.target.value }))}
                />
                <input
                  style={{ ...S.input, marginBottom: 8 }}
                  placeholder="Street address"
                  value={propertyDraft.line1}
                  onChange={e => setPropertyDraft(p => ({ ...p, line1: e.target.value }))}
                />
                <input
                  style={{ ...S.input, marginBottom: 8 }}
                  placeholder="Apt / Suite (optional)"
                  value={propertyDraft.line2}
                  onChange={e => setPropertyDraft(p => ({ ...p, line2: e.target.value }))}
                />
                <input
                  style={{ ...S.input, marginBottom: 8 }}
                  placeholder="City, State ZIP"
                  value={propertyDraft.line3}
                  onChange={e => setPropertyDraft(p => ({ ...p, line3: e.target.value }))}
                />
                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    type="button"
                    onClick={() => { setAddingProperty(false); setPropertyDraft(null); }}
                    style={{ ...S.btn("ghost"), fontSize: 13, flex: 1, padding: "9px 0" }}
                    disabled={savingProperty}
                  >Cancel</button>
                  <button
                    type="button"
                    disabled={savingProperty || !(propertyDraft.line1 || propertyDraft.label)}
                    onClick={async () => {
                      // Append the new property to the client's addresses, save
                      // it, then select it as the job site on this invoice.
                      setSavingProperty(true);
                      try {
                        const newProp = { ...propertyDraft };
                        const updatedAddresses = [...(selectedClient.addresses || []), newProp];
                        const updated = { ...selectedClient, addresses: updatedAddresses };
                        if (selectedClient.id && onUpdateClient) {
                          await onUpdateClient(updated);
                        }
                        setForm(f => ({
                          ...f,
                          jobAddressId: newProp.id,
                          jobAddress: newProp,
                          clientInfo: {
                            ...(f.clientInfo || {}),
                            name: f.clientInfo?.name || selectedClient.name,
                            email: f.clientInfo?.email ?? (selectedClient.email || ""),
                            phone: f.clientInfo?.phone ?? (selectedClient.phone || selectedClient.mobile || ""),
                            address1: newProp.line1 || "",
                            address2: newProp.line2 || "",
                            address3: newProp.line3 || "",
                          },
                        }));
                        setAddingProperty(false);
                        setPropertyDraft(null);
                      } catch (e) {
                        console.error("Failed to add property:", e);
                        alert("Could not add property. Please try again.");
                      } finally {
                        setSavingProperty(false);
                      }
                    }}
                    style={{ ...S.btn("primary"), fontSize: 13, flex: 1, padding: "9px 0", opacity: savingProperty ? 0.7 : 1 }}
                  >{savingProperty ? "Saving…" : "Save"}</button>
                </div>
              </div>
            )}
            {/* client-edit overlay rendered at bottom of InvoiceForm return */}
          </div>

          {form.client && (
            <div style={{ padding: "12px 16px 0" }}>
              <OnMyWay
                clientName={effectiveClientInfo?.name || form.client || ""}
                clientPhone={selectedClient?.mobile || selectedClient?.phone || effectiveClientInfo?.phone || ""}
                jobAddress={form.jobAddress || null}
                billingAddress={form.billingAddress || null}
              />
            </div>
          )}

          {/* Dates — estimates have no due date by default. Show a single full-width */}
          {/* date picker for estimates and the usual two-column grid for invoices. */}
          <div style={{ padding: "12px 16px 0", display: "grid", gridTemplateColumns: isEstimate ? "1fr" : "1fr 1fr", gap: 10 }}>
            <div style={{ minWidth: 0 }}><label style={S.label}>{isEstimate ? "Estimate Date" : "Invoice Date"}</label><input type="date" style={S.input} value={form.date} onChange={e => setField("date", e.target.value)} /></div>
            {!isEstimate && (
              <div style={{ minWidth: 0 }}><label style={S.label}>Due Date</label><input type="date" style={S.input} value={form.dueDate} onChange={e => setField("dueDate", e.target.value)} /></div>
            )}
          </div>

          {/* Line Items */}
          <div style={{ padding: "16px 16px 0" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, gap: 6 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: "#6677aa", letterSpacing: 1, textTransform: "uppercase", fontFamily: "'Barlow Condensed', sans-serif", flexShrink: 0 }}>Line Items</span>
              <div style={{ display: "flex", gap: 6, overflowX: "auto", flexShrink: 1, minWidth: 0 }}>
                <button onClick={() => { setReordering(!reordering); setShowAI(false); setShowSaved(false); setShowPriceBook(false); }} style={{ ...S.btn(reordering ? "primary" : "ghost"), fontSize: 11, padding: "5px 9px", display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
                  <Icon name="grip" size={12} color={reordering ? "#fff" : "#444"} />{reordering ? "Done" : "Reorder"}
                </button>
                {!reordering && <>
                  <button onClick={() => { setShowAI(!showAI); setShowSaved(false); setShowPriceBook(false); }} style={{ ...S.btn(showAI ? "primary" : "ghost"), fontSize: 12, padding: "6px 10px", display: "flex", alignItems: "center", gap: 5, flexShrink: 0 }}><Icon name="ai" size={13} color={showAI ? "#fff" : "#444"} /> AI</button>
                  <button onClick={() => { setShowSaved(!showSaved); setShowAI(false); setShowPriceBook(false); }} style={{ ...S.btn(showSaved ? "navy" : "ghost"), fontSize: 12, padding: "6px 12px", flexShrink: 0 }}>Saved</button>
                  <button onClick={() => { setShowPriceBook(!showPriceBook); setShowAI(false); setShowSaved(false); }} style={{ ...S.btn(showPriceBook ? "navy" : "ghost"), fontSize: 12, padding: "6px 12px", flexShrink: 0 }}>Price Book</button>
                  <button onClick={() => addItem()} style={{ ...S.btn("primary"), padding: "6px 10px", flexShrink: 0 }}><Icon name="plus" size={16} color="#fff" /></button>
                </>}
              </div>
            </div>

            {showAI && <div style={{ marginBottom: 12 }}><AIChatPanel msgs={aiMsgs} setMsgs={setAiMsgs} onResetChat={resetAiChat} onAddItems={handleAddFromAI} data={data} currentInvoice={form} onLocalAction={handleLocalAIAction} onGlobalAction={onAIAction} /></div>}

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
                <LineItemRow
                  key={i}
                  item={item}
                  i={i}
                  reordering={reordering}
                  dragIdx={dragIdx}
                  setDragIdx={setDragIdx}
                  setEditingItem={setEditingItem}
                  moveItem={moveItem}
                  removeItem={removeItem}
                  descPreview={descPreview}
                  itemsLength={form.items.length}
                />
              );
            })}
          </div>

          {/* Tax & Discount */}
          <div style={{ padding: "4px 16px 0", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div style={{ minWidth: 0 }}>
              {/* Match the height of the Discount label+toggle row so inputs
                  line up across columns. */}
              <div style={{ display: "flex", alignItems: "center", height: 24, marginBottom: 4 }}>
                <label style={S.label}>Tax %</label>
              </div>
              <input type="number" style={S.input} value={form.tax} onChange={e => setField("tax", parseFloat(e.target.value) || 0)} onFocus={selectOnFocus} step={0.001} />
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", height: 24, marginBottom: 4 }}>
                <label style={S.label}>Discount</label>
                <div style={{ display: "flex", background: "#f0f2f8", borderRadius: 6, padding: 2, gap: 2 }}>
                  {["%", "$"].map(type => (
                    <button key={type} onClick={() => setField("discountType", type)} style={{ padding: "3px 10px", borderRadius: 4, border: "none", background: (form.discountType || "$") === type ? "#fff" : "transparent", fontWeight: 700, fontSize: 12, cursor: "pointer", color: (form.discountType || "$") === type ? NAVY : "#aaa", boxShadow: (form.discountType || "$") === type ? "0 1px 3px rgba(0,0,0,0.1)" : "none" }}>{type}</button>
                  ))}
                </div>
              </div>
              <input type="number" style={S.input} value={form.discount} onChange={e => setField("discount", parseFloat(e.target.value) || 0)} onFocus={selectOnFocus} min={0} />
            </div>
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
              {[["outstanding", "Outstanding"], ["net30", "Net 30"], ["paid", "Paid"]].map(([s, label]) => (
                <button key={s} onClick={() => {
                  // Selecting Net 30 also bumps the due date to invoice date + 30 days.
                  // We only auto-set when transitioning INTO net30 so users who tweaked
                  // the due date manually after selecting net30 don't get clobbered.
                  if (s === "net30" && form.status !== "net30") {
                    const base = form.date ? new Date(form.date + "T00:00:00") : new Date();
                    if (!isNaN(base)) {
                      base.setDate(base.getDate() + 30);
                      const yyyy = base.getFullYear();
                      const mm = String(base.getMonth() + 1).padStart(2, "0");
                      const dd = String(base.getDate()).padStart(2, "0");
                      setForm(f => ({ ...f, status: "net30", dueDate: `${yyyy}-${mm}-${dd}` }));
                      return;
                    }
                  }
                  setField("status", s);
                }} style={{ ...S.btn(form.status === s ? "primary" : "ghost"), flex: 1, fontSize: 13 }}>{label}</button>
              ))}
            </div>
          </div>

          {/* Totals */}
          <div style={{ margin: "16px 16px 0", background: "#fff", borderRadius: 12, padding: 16, boxShadow: "0 1px 6px rgba(0,0,0,0.07)" }}>
            {[["Subtotal", fmt(t.sub)], ...(t.disc > 0 ? [[form.discountType === "%" ? `Discount (${form.discount}%)` : "Discount", "−" + fmt(t.disc)]] : []), ["GET (" + form.tax + "%)", fmt(t.taxAmt)]].map(([label, val]) => (
              <div key={label} style={{ display: "flex", justifyContent: "space-between", marginBottom: 6, fontSize: 14, color: "#666" }}><span>{label}</span><span>{val}</span></div>
            ))}
            <div style={{ display: "flex", justifyContent: "space-between", borderTop: "2px solid #eee", paddingTop: 10, marginTop: 4 }}>
              <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 18 }}>Total</span>
              <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 22, color: ORANGE }}>{fmt(t.total)}</span>
            </div>
            {(form.payments || []).length > 0 && (
              <div>
                <div style={{ marginTop: 10, borderTop: "1px solid #eee", paddingTop: 8 }}>
                  {form.payments.map((p, i) => {
                    const methodColors = { Cash: "#27ae60", Check: "#2980b9", Venmo: "#3D95CE", Zelle: "#6B39A8", PayPal: "#0070ba", "Credit Card": ORANGE, "Bank Transfer": "#16a085" };
                    const mc = methodColors[p.method] || "#888";
                    return (
                      <div key={p.id || i} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                        <div style={{ width: 6, height: 6, borderRadius: "50%", background: mc, flexShrink: 0 }} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <span style={{ fontSize: 13, fontWeight: 600, color: mc }}>{p.method}</span>
                          <span style={{ fontSize: 12, color: "#aaa", marginLeft: 6 }}>{fmtDate(p.date)}</span>
                          {p.note && <div style={{ fontSize: 11, color: "#999", marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.note}</div>}
                        </div>
                        <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 14, color: mc, flexShrink: 0 }}>−{fmt(p.amount)}</span>
                      </div>
                    );
                  })}
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8, borderTop: "2px solid #eee", paddingTop: 8 }}>
                  <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 16 }}>Balance Due</span>
                  <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 18, color: t.balance < -0.01 ? "#cc4444" : t.balance <= 0 ? "#27ae60" : ORANGE }}>{fmt(Math.max(0, t.balance))}</span>
                </div>
                {t.balance < -0.01 && <div style={{ fontSize: 11, color: "#cc4444", textAlign: "right", marginTop: 2 }}>⚠ Overpaid by {fmt(Math.abs(t.balance))}</div>}
              </div>
            )}
          </div>

          {/* Signature Section (estimates only) */}
          {isEstimate && (
            <div style={{ padding: "12px 16px 0" }}>
              <label style={S.label}>Client Signature</label>
              {form.signatureData ? (
                <div style={{ background: "#fff", borderRadius: 10, padding: 14, boxShadow: "0 1px 4px rgba(0,0,0,0.06)" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={S.pill("#27ae60")}>✓ Approved</span>
                      {form.signedAt && <span style={{ fontSize: 11, color: "#aaa" }}>{new Date(form.signedAt).toLocaleDateString()}</span>}
                    </div>
                    <button onClick={() => { if (confirm("Void this signature? This cannot be undone.")) { setField("signatureData", null); setField("signedAt", null); setField("status", "outstanding"); }}} style={{ background: "none", border: "1px solid #e74c3c", color: "#e74c3c", borderRadius: 6, padding: "4px 10px", fontSize: 11, cursor: "pointer", fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, letterSpacing: 0.5 }}>Void</button>
                  </div>
                  <img src={form.signatureData} style={{ maxWidth: "100%", border: "1px solid #eee", borderRadius: 6, background: "#fafafa" }} alt="Signature" />
                </div>
              ) : (
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={() => setShowSignature(true)} style={{ ...S.btn("navy"), flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
                    <Icon name="pen" size={15} color="#fff" /> Get Signature
                  </button>
                  <button onClick={handleSendEstimate} style={{ ...S.btn("ghost"), flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
                    <Icon name="mail" size={15} color="#444" /> Send for Sig
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Actions */}
          <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
            <button onClick={handleSave} style={{ ...S.btn("primary"), fontSize: 16, padding: 14 }}>{isEstimate ? "Done — Save Estimate" : "Done — Save Invoice"}</button>
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={() => setShowPayment(true)} style={{ ...S.btn("green"), flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}><Icon name="payment" size={16} color="#fff" /> {isEstimate ? "Down Payment" : "Record Payment"}</button>
              <button onClick={isEstimate ? handleSendEstimate : handleEmail} style={{ ...S.btn("navy"), flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}><Icon name="mail" size={16} color="#fff" /> {emailStatus || "Send Email"}</button>
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={handlePrint} style={{ ...S.btn("ghost"), flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}><Icon name="print" size={16} color="#444" /> Print / PDF</button>
              {invoice && onConvert && (
                <button onClick={handleConvert} style={{ ...S.btn("ghost"), flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
                  <Icon name="swap" size={16} color="#444" /> {isEstimate ? "→ Invoice" : "→ Estimate"}
                </button>
              )}
            </div>
            {/* TODO PayPal integration — add a "Send via PayPal" button here */}
          </div>
        </div>

      </div>
      <div style={{ width: viewportW || `${100 / TABS.length}%`, flexShrink: 0, maxHeight: (tabIdx === 1 || dragX !== 0 || animating) ? "none" : 0, overflow: (tabIdx === 1 || dragX !== 0 || animating) ? "visible" : "hidden" }}>
        <PDFPreview form={form} clients={clients} photos={invoicePhotos} />
      </div>
      <div style={{ width: viewportW || `${100 / TABS.length}%`, flexShrink: 0, maxHeight: (tabIdx === 2 || dragX !== 0 || animating) ? "none" : 0, overflow: (tabIdx === 2 || dragX !== 0 || animating) ? "visible" : "hidden" }}>
        <div style={{ padding: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20, gap: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: "#6677aa", letterSpacing: 1, textTransform: "uppercase", fontFamily: "'Barlow Condensed', sans-serif" }}>Activity Log</span>
              <button
                onClick={refreshEvents}
                aria-label="Refresh"
                style={{ background: "#fff", border: "1px solid #e8ecf4", borderRadius: 999, width: 28, height: 28, padding: 0, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}
              >
                <span style={{ display: "inline-flex", animation: refreshingEvents ? "spin 0.7s linear infinite" : "none" }}>
                  <Icon name="history" size={14} color="#6677aa" />
                </span>
              </button>
            </div>
            <button onClick={() => setShowPayment(true)} style={{ ...S.btn("green"), fontSize: 12, padding: "7px 14px", display: "flex", alignItems: "center", gap: 6 }}><Icon name="payment" size={14} color="#fff" /> {isEstimate ? "Down Payment" : "Record Payment"}</button>
          </div>
          <div style={{ position: "relative" }}>
            {historyEvents.length > 1 && <div style={{ position: "absolute", left: 17, top: 18, bottom: 18, width: 2, background: "#e8ecf4" }} />}
            {historyEvents.map((ev, i) => {
              const palette = ev.type === 'payment' ? { bg: '#e8f8ef', stroke: '#27ae60', icon: 'payment' }
                : ev.type === 'sent'    ? (ev.channel === 'sms'
                    ? { bg: '#e8f8ef', stroke: '#27ae60', icon: 'phone' }
                    : { bg: '#eaf2ff', stroke: '#2c6ed4', icon: 'mail' })
                : ev.type === 'opened'  ? { bg: '#fff1e0', stroke: '#E8622A', icon: 'eye' }
                : { bg: '#eef0fa', stroke: '#8899bb', icon: 'invoice' };
              // For sent/opened we have full timestamps; show "Apr 30, 12:42 AM".
              const fmtTime = (iso) => {
                try { return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); }
                catch { return fmtDate(iso); }
              };
              const dateLabel = (ev.type === 'sent' || ev.type === 'opened') ? fmtTime(ev.date) : fmtDate(ev.date);
              return (
                <div key={i} style={{ display: "flex", gap: 14, marginBottom: 14, position: "relative" }}>
                  <div style={{ width: 36, height: 36, borderRadius: "50%", flexShrink: 0, background: palette.bg, border: `2px solid ${palette.stroke}`, display: "flex", alignItems: "center", justifyContent: "center", position: "relative", zIndex: 1 }}>
                    <Icon name={palette.icon} size={15} color={palette.stroke} />
                  </div>
                  <div style={{ flex: 1, background: "#fff", borderRadius: 10, padding: "11px 14px", boxShadow: "0 1px 4px rgba(0,0,0,0.06)" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                      <div><div style={{ fontSize: 14, fontWeight: 600, color: "#1a1a1a", marginBottom: 2 }}>{ev.label}</div><div style={{ fontSize: 12, color: "#aaa" }}>{dateLabel}</div></div>
                      {ev.amount != null && <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 17, color: "#27ae60" }}>{fmt(ev.amount)}</div>}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          {(form.payments || []).length > 0 && (
            <div style={{ background: "#fff", borderRadius: 12, padding: "14px 16px", marginTop: 8, boxShadow: "0 1px 6px rgba(0,0,0,0.07)" }} data-marker="history-totals">
              {[[isEstimate ? "Estimate Total" : "Invoice Total", fmt(t.total), "#222"], [isEstimate ? "Down Payment" : "Total Paid", fmt(t.paid), "#27ae60"], [isEstimate ? "Remaining" : "Balance Due", fmt(Math.max(0, t.balance)), t.balance <= 0 ? "#27ae60" : ORANGE]].map(([label, val, color]) => (
                <div key={label} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid #f4f6fa" }}>
                  <span style={{ fontSize: 13, color: "#777" }}>{label}</span>
                  <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 15, color }}>{val}</span>
                </div>
              ))}
            </div>
          )}

          {/* Version snapshots */}
          {(form.id || autoSavedId) && (
            <div style={{ marginTop: 24 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: "#6677aa", letterSpacing: 1, textTransform: "uppercase", fontFamily: "'Barlow Condensed', sans-serif" }}>Saved Versions</span>
                <button
                  onClick={() => saveSnapshot()}
                  disabled={savingSnapshot}
                  style={{ ...S.btn("ghost"), fontSize: 12, padding: "6px 12px", border: "1px solid #dde2ee", opacity: savingSnapshot ? 0.6 : 1 }}
                >{savingSnapshot ? "Saving…" : "Save snapshot"}</button>
              </div>
              {versions.length === 0 && (
                <div style={{ background: "#fff", borderRadius: 10, padding: "14px 16px", boxShadow: "0 1px 4px rgba(0,0,0,0.06)", fontSize: 13, color: "#aaa" }}>
                  No snapshots yet. Versions are saved each time you send or save.
                </div>
              )}
              {versions.map((v) => {
                const snap = v.snapshot || {};
                const snapTotals = calcTotals(snap);
                const fmtTs = (ts) => { try { return new Date(ts).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }); } catch { return ts; } };
                const itemCount = (snap.items || []).length;
                return (
                  <div key={v.id} style={{ background: "#fff", borderRadius: 10, padding: "12px 14px", marginBottom: 10, boxShadow: "0 1px 4px rgba(0,0,0,0.06)" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: "#1a1a1a" }}>
                          v{v.version_number} — {v.note || "Snapshot"}
                        </div>
                        <div style={{ fontSize: 12, color: "#aaa", marginTop: 2 }}>{fmtTs(v.created_at)}</div>
                        <div style={{ fontSize: 12, color: "#777", marginTop: 4 }}>
                          {itemCount} line item{itemCount !== 1 ? "s" : ""} · Total {fmt(snapTotals.total)}
                        </div>
                        {v.sent_to && <div style={{ fontSize: 11, color: "#aaa", marginTop: 2 }}>Sent to {v.sent_to}</div>}
                      </div>
                      <button
                        onClick={() => {
                          if (!confirm(`Restore v${v.version_number}? Your current edits will be replaced.`)) return;
                          setForm({ discountType: "$", ...snap });
                          goToTab("edit");
                        }}
                        style={{ ...S.btn("ghost"), fontSize: 12, padding: "6px 12px", border: "1px solid #dde2ee", flexShrink: 0 }}
                      >Restore</button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
      <div style={{ width: viewportW || `${100 / TABS.length}%`, flexShrink: 0, maxHeight: (tabIdx === 3 || dragX !== 0 || animating) ? "none" : 0, overflow: (tabIdx === 3 || dragX !== 0 || animating) ? "visible" : "hidden" }}>
        <div style={{ padding: 16 }}>
          <JobPhotos invoiceId={form.id || autoSavedId} />
        </div>
      </div>
      </div>
      </div>
    </div>

    {/* Full-screen client-edit overlay — slides in from the right like a native page */}
    {editingClient && clientDraft && (
      <div style={{ position: "fixed", top: 0, bottom: 0, left: "50%", width: "100%", maxWidth: 480, zIndex: 600, background: LIGHT, overflowY: "auto", transform: clientEditVisible ? "translateX(-50%)" : "translateX(calc(-50% + 100vw))", transition: `transform ${SLIDE_MS}ms cubic-bezier(0.25, 0.46, 0.45, 0.94)` }}>
        <div style={{ background: NAVY, padding: "12px 16px", display: "flex", alignItems: "center", gap: 12, position: "sticky", top: 0, zIndex: 1 }}>
          <button
            type="button"
            onClick={closeClientEdit}
            style={{ background: "none", border: "none", cursor: "pointer", padding: 4 }}
          ><Icon name="back" size={22} color="#fff" /></button>
          <span style={{ color: "#fff", fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 20 }}>
            {selectedClient?.id ? "Edit Client" : "New Client"}
          </span>
        </div>
        <div style={{ padding: 16, paddingBottom: 40 }}>
          <ClientEditFields value={clientDraft} onChange={setClientDraft} isAdmin={isAdmin} />
          <button
            type="button"
            disabled={savingClient}
            onClick={async () => {
              const cleaned = normalizeClientDraft({ ...clientDraft, name: clientDraft.name || form.client || "" });
              setSavingClient(true);
              try {
                let saved = cleaned;
                if (selectedClient?.id) {
                  await onUpdateClient?.({ ...cleaned, id: selectedClient.id });
                  saved = { ...cleaned, id: selectedClient.id };
                } else if (cleaned.name && onCreateClient) {
                  const created = await onCreateClient(cleaned);
                  if (created?.id) saved = { ...cleaned, id: created.id };
                }
                const addrs = saved.addresses || [];
                const stillThere = form.jobAddressId && addrs.find(a => a.id === form.jobAddressId);
                const pickedJob = stillThere || addrs[0] || null;
                setForm(f => ({
                  ...f,
                  client: saved.name || f.client,
                  jobAddressId: pickedJob?.id || null,
                  jobAddress: pickedJob || null,
                  billingAddress: saved.billingAddress || null,
                  clientInfo: {
                    name: saved.name || f.clientInfo?.name || "",
                    email: saved.email || "",
                    phone: saved.phone || "",
                    address1: pickedJob?.line1 || "",
                    address2: pickedJob?.line2 || "",
                    address3: pickedJob?.line3 || "",
                  },
                }));
                closeClientEdit();
              } catch (e) {
                console.error('Failed to save client profile:', e);
                alert('Could not save client. Please try again.');
              } finally {
                setSavingClient(false);
              }
            }}
            style={{ ...S.btn("primary"), width: "100%", marginTop: 12, fontSize: 16, padding: 14, opacity: savingClient ? 0.7 : 1 }}
          >{savingClient ? "Saving…" : "Save Client"}</button>
        </div>
      </div>
    )}
    </>
  );
}

// Quick-actions sheet shown when the user long-presses an invoice or
// estimate card on the list. Mirrors Invoice Simple's iOS action sheet.
// Buttons differ by document type:
//   invoice:  Delete · Share · Send · Print · Get link · Mark paid/unpaid · Duplicate
//   estimate: Delete · Share · Send · Print · Get link · Convert to invoice · Duplicate
// Stays a controlled component so the parent owns dismissal and can
// chain follow-up UI (e.g. opening the form after Duplicate).
function InvoiceQuickActionsMenu({ inv, onClose, onDelete, onShare, onSend, onPrint, onGetLink, onTogglePaid, onConvert, onDuplicate }) {
  if (!inv) return null;
  const isEstimate = inv.type === 'estimate';
  const isPaid = inv.status === 'paid';
  // Each action wraps onClose so the sheet dismisses immediately on tap,
  // even if the underlying action does async work.
  const wrap = (fn) => () => { onClose?.(); setTimeout(() => fn?.(), 0); };
  const itemBase = {
    width: '100%',
    background: '#fff',
    border: 'none',
    borderTop: '0.5px solid #e8ecf4',
    padding: '16px 18px',
    fontSize: 17,
    fontFamily: "'Barlow', sans-serif",
    fontWeight: 600,
    color: NAVY,
    textAlign: 'center',
    cursor: 'pointer',
    WebkitTapHighlightColor: 'rgba(0,0,0,0.06)',
  };
  const sheet = {
    background: '#fff',
    borderRadius: 14,
    overflow: 'hidden',
    width: 'min(360px, calc(100vw - 32px))',
    boxShadow: '0 24px 60px rgba(10,22,40,0.35)',
  };
  const heading = { ...itemBase, borderTop: 'none', color: '#888', fontSize: 13, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', padding: '14px 18px 10px', cursor: 'default' };
  const cancelBtn = { ...itemBase, marginTop: 10, borderTop: 'none', borderRadius: 14, fontWeight: 700 };
  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(10,22,40,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}
    >
      <div onClick={(e) => e.stopPropagation()} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', maxHeight: 'calc(100vh - 32px)', overflowY: 'auto' }}>
        <div style={sheet}>
          <div style={heading}>{inv.id}</div>
          <button onClick={wrap(onDelete)} style={{ ...itemBase, color: '#cc4444', fontWeight: 700 }}>Delete</button>
          <button onClick={wrap(onShare)}    style={itemBase}>Share</button>
          <button onClick={wrap(onSend)}     style={itemBase}>Send</button>
          <button onClick={wrap(onPrint)}    style={itemBase}>Print</button>
          <button onClick={wrap(onGetLink)}  style={itemBase}>Get link</button>
          {isEstimate
            ? <button onClick={wrap(onConvert)} style={itemBase}>Convert to invoice</button>
            : <button onClick={wrap(onTogglePaid)} style={itemBase}>{isPaid ? 'Mark unpaid' : 'Mark paid'}</button>}
          <button onClick={wrap(onDuplicate)} style={itemBase}>Duplicate</button>
        </div>
        <button onClick={onClose} style={{ ...sheet, ...cancelBtn }}>Cancel</button>
      </div>
    </div>
  );
}

// ─── Invoice List ─────────────────────────────────────────────────────────────
// Single invoice card on the list screen. Extracted into its own component
// so we can call the useLongPress hook per-card (hooks can't be called inside
// a .map() callback). Long-press opens the quick-actions sheet; tap opens
// the invoice.
function InvoiceListCard({ inv, onSelect, onLongPress, statusLabel, pillColor, lastMethod, amountColor, displayAmt }) {
  const longPress = useLongPress(() => {
    if (onLongPress) onLongPress(inv);
  });
  return (
    <div
      onClick={() => onSelect(inv)}
      {...longPress}
      style={{ ...S.card, padding: "12px 14px", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center", userSelect: "none", WebkitUserSelect: "none", WebkitTouchCallout: "none" }}
    >
      <div>
        <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 2 }}>{inv.client}</div>
        <div style={{ fontSize: 12, color: "#888" }}>{inv.id} · {inv.date}</div>
      </div>
      <div style={{ textAlign: "right" }}>
        <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 17, color: amountColor }}>{displayAmt}</div>
        <div style={{ display: "flex", gap: 4, justifyContent: "flex-end", alignItems: "center", marginTop: 2 }}>
          {lastMethod && <span style={{ fontSize: 9, fontWeight: 700, color: "#8899bb", letterSpacing: 0.5, fontFamily: "'Barlow Condensed', sans-serif", textTransform: "uppercase" }}>{lastMethod}</span>}
          <span style={S.pill(pillColor)}>{statusLabel}</span>
        </div>
      </div>
    </div>
  );
}

// Single estimate card on the list screen. Same long-press treatment as
// invoices: hold to open the quick-actions sheet, tap to open the form.
function EstimateListCard({ inv, onSelect, onLongPress, pillLabel, pillColor, total }) {
  const longPress = useLongPress(() => {
    if (onLongPress) onLongPress(inv);
  });
  return (
    <div
      onClick={() => onSelect(inv)}
      {...longPress}
      style={{ ...S.card, padding: "12px 14px", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center", userSelect: "none", WebkitUserSelect: "none", WebkitTouchCallout: "none" }}
    >
      <div>
        <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 2 }}>{inv.client || "No client"}</div>
        <div style={{ fontSize: 12, color: "#888" }}>{inv.id} · {inv.date}</div>
      </div>
      <div style={{ textAlign: "right" }}>
        <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 17, color: ORANGE }}>{fmt(total)}</div>
        <span style={S.pill(pillColor)}>{pillLabel}</span>
      </div>
    </div>
  );
}

function InvoiceList({ invoices, onNew, onSelect, onDelete, onShare, onSend, onPrint, onGetLink, onTogglePaid, onRecordPayment, onDuplicate, setSubHeader }) {
  const TABS = ["all", "outstanding", "paid"];
  const [tab, setTab] = useState("all");
  const [search, setSearch] = useState("");
  // Active invoice for the long-press quick-actions sheet. null means closed.
  const [menuInv, setMenuInv] = useState(null);
  // When set, opens the PaymentModal so the user can pick a payment method
  // for the "Mark paid" quick action instead of recording a synthetic Other payment.
  const [payInv, setPayInv] = useState(null);
  const tabIndex = TABS.indexOf(tab);
  // Native CSS scroll-snap carousel. Each column is `width: 100%` of the
  // scroll container, and the container has `scroll-snap-type: x mandatory`
  // so swipes snap exactly to the next column. No JS measurement, no manual
  // translate math — the browser handles everything correctly regardless of
  // page scroll position or sticky-header state.
  const trackRef = useRef(null);
  const programmaticScrollRef = useRef(false);
  // After mount, do a layout-effect scroll to the active column without
  // animation so column 0 always starts visible (avoids browsers restoring
  // a stale scrollLeft on remount).
  useLayoutEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    el.scrollLeft = el.clientWidth * tabIndex;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // When the active tab changes (e.g. user tapped a tab button), scroll the
  // container to that column. Smooth scroll triggers the native snap.
  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    const target = el.clientWidth * tabIndex;
    if (Math.abs(el.scrollLeft - target) < 2) return;
    programmaticScrollRef.current = true;
    el.scrollTo({ left: target, behavior: "smooth" });
    setTimeout(() => { programmaticScrollRef.current = false; }, 400);
  }, [tabIndex]);

  // When the user manually swipes, the container's scrollLeft changes. Detect
  // which column is most-visible and update `tab` so the highlighted indicator
  // tracks the swipe.
  const onScroll = () => {
    if (programmaticScrollRef.current) return;
    const el = trackRef.current;
    if (!el) return;
    const idx = Math.round(el.scrollLeft / el.clientWidth);
    const clamped = Math.max(0, Math.min(TABS.length - 1, idx));
    if (TABS[clamped] !== tab) setTab(TABS[clamped]);
  };

  const goToTab = (next) => {
    if (next === tab) return;
    setTab(next); // useEffect above will scroll to the new column
  };

  // Always sort by invoice date descending so newly inserted rows (e.g. from
  // an estimate-to-invoice convert) land in the correct chronological slot
  // regardless of how App's in-memory array was mutated. ID is the tiebreaker
  // when two invoices share a date.
  const byDateDesc = (a, b) => {
    const ad = a.date || ""; const bd = b.date || "";
    if (ad !== bd) return ad < bd ? 1 : -1;
    return (a.id || "") < (b.id || "") ? 1 : -1;
  };
  const filterFor = (key) => invoices
    .filter(inv => key === "all" ? true : key === "outstanding" ? (inv.status === "outstanding" || inv.status === "net30" || inv.status === "partial") : inv.status === key)
    .filter(inv => matchesSearch(inv, search))
    .sort(byDateDesc);
  const outstanding = invoices.filter(i => i.status === "outstanding" || i.status === "net30" || i.status === "partial").reduce((s, i) => s + calcTotals(i).balance, 0);
  const paidThisYear = invoices.filter(i => i.status === "paid" && (i.year === 2026 || i.date?.startsWith("2026"))).reduce((s, i) => s + calcTotals(i).total, 0);

  // Render KPI strip + filter tabs into the App-level sticky slot. Slot is
  // keyed by tab name ("invoices") so stale pushes can't blank a new tab.
  useEffect(() => {
    setSubHeader?.("invoices",
      <>
        <div style={{ background: NAVY2, padding: "12px 16px", display: "flex", justifyContent: "space-between" }}>
          <div><div style={{ color: "#8899bb", fontSize: 11, letterSpacing: 1, fontFamily: "'Barlow Condensed', sans-serif", textTransform: "uppercase" }}>Outstanding</div><div style={{ color: ORANGE, fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 20 }}>{fmt(outstanding)}</div></div>
          <div style={{ textAlign: "right" }}><div style={{ color: "#8899bb", fontSize: 11, letterSpacing: 1, fontFamily: "'Barlow Condensed', sans-serif", textTransform: "uppercase" }}>2026 Paid</div><div style={{ color: "#4ecb71", fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 20 }}>{fmt(paidThisYear)}</div></div>
        </div>
        <SearchBar value={search} onChange={setSearch} placeholder="Search invoices, clients, line items" />
        <div style={{ display: "flex", background: "#fff", borderBottom: "1px solid #eee" }}>
          {TABS.map(t => (
            <button key={t} onClick={() => goToTab(t)} style={{ flex: 1, padding: "10px 4px", background: "none", border: "none", borderBottom: tab === t ? `2px solid ${ORANGE}` : "2px solid transparent", color: tab === t ? ORANGE : "#888", fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 13, letterSpacing: 1, textTransform: "uppercase", cursor: "pointer", transition: "border-color 0.15s, color 0.15s" }}>{t}</button>
          ))}
        </div>
      </>
    );
  }, [tab, outstanding, paidThisYear, search, setSubHeader]);

  // Render one column per tab inside a flex track, then translate the track.
  // This produces a real carousel feel: the next/previous tab visibly slides
  // in from the side as you drag, and snaps with a smooth animation on release.
  const renderColumn = (key) => {
    const list = filterFor(key);
    const yrs = [...new Set(list.map(i => i.year || new Date(i.date).getFullYear()))].sort((a, b) => b - a);
    const yrTotal = (yr) => list.filter(i => (i.year || new Date(i.date).getFullYear()) === yr).reduce((s, i) => s + calcTotals(i).total, 0);
    if (list.length === 0) {
      return (
        <div style={{ padding: "48px 24px", textAlign: "center" }}>
          <Icon name="invoice" size={48} color="#dde2ee" />
          <div style={{ fontSize: 16, fontWeight: 600, color: "#888", marginTop: 16, marginBottom: 8 }}>No {key === "all" ? "" : key + " "}invoices</div>
          <div style={{ fontSize: 13, color: "#aaa" }}>{key === "paid" ? "Paid invoices will show up here." : key === "outstanding" ? "Unpaid invoices will show up here." : "Tap + to create your first invoice"}</div>
        </div>
      );
    }
    return yrs.map(yr => (
      <div key={yr}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 4px", marginBottom: 6 }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: "#8899bb", letterSpacing: 1, fontFamily: "'Barlow Condensed', sans-serif", textTransform: "uppercase" }}>{yr}</span>
          <span style={{ fontSize: 13, fontWeight: 700, color: "#555" }}>{fmt(yrTotal(yr))}</span>
        </div>
        {list.filter(i => (i.year || new Date(i.date).getFullYear()) === yr).map(inv => {
          const t = calcTotals(inv);
          const { label: statusLabel, color: pillColor } = statusDisplay(inv);
          const lastMethod = inv.status === "paid" && (inv.payments || []).length > 0 ? inv.payments[inv.payments.length - 1].method : null;
          const amountColor = inv.status === "paid" ? "#4ecb71" : inv.status === "partial" ? "#f39c12" : ORANGE;
          const displayAmt = inv.status !== "paid" && t.paid > 0 ? fmt(Math.max(0, t.balance)) : fmt(t.total);
          return (
            <InvoiceListCard key={inv.id} inv={inv} onSelect={onSelect} onLongPress={setMenuInv} statusLabel={statusLabel} pillColor={pillColor} lastMethod={lastMethod} amountColor={amountColor} displayAmt={displayAmt} />
          );
        })}
      </div>
    ));
  };

  return (
    <div>
      <div
        ref={trackRef}
        onScroll={onScroll}
        style={{
          display: "flex",
          overflowX: "auto",
          overflowY: "hidden",
          scrollSnapType: "x mandatory",
          WebkitOverflowScrolling: "touch",
          scrollbarWidth: "none",
          minHeight: "calc(100vh - 280px)",
        }}
      >
        {TABS.map(key => (
          <div
            key={key}
            style={{
              flex: "0 0 100%",
              width: "100%",
              scrollSnapAlign: "start",
              scrollSnapStop: "always",
              padding: "12px 12px 0",
              boxSizing: "border-box",
              minHeight: "calc(100vh - 280px)",
            }}
          >
            {renderColumn(key)}
          </div>
        ))}
      </div>
      {menuInv && (
        <InvoiceQuickActionsMenu
          inv={menuInv}
          onClose={() => setMenuInv(null)}
          onDelete={() => { if (confirm(`Delete invoice ${menuInv.id}?\n\nThis cannot be undone.`)) onDelete?.(menuInv.id); }}
          onShare={() => onShare?.(menuInv)}
          onSend={() => onSend?.(menuInv)}
          onPrint={() => onPrint?.(menuInv)}
          onGetLink={() => onGetLink?.(menuInv)}
          onTogglePaid={() => {
            // Mark unpaid → reuse the existing toggle which strips synthetic rows.
            // Mark paid → open the payment modal so the user can pick a method.
            if (menuInv.status === 'paid') onTogglePaid?.(menuInv);
            else setPayInv(menuInv);
          }}
          onDuplicate={() => onDuplicate?.(menuInv)}
        />
      )}
      {payInv && (
        <PaymentModal
          invoice={payInv}
          onClose={() => setPayInv(null)}
          onSave={(updated) => { onRecordPayment?.(updated); setPayInv(null); }}
        />
      )}
    </div>
  );
}

// ─── Estimates Tab ────────────────────────────────────────────────────────────
function EstimatesTab({ invoices, onNew, onSelect, onDelete, onShare, onSend, onPrint, onGetLink, onConvert, onDuplicate, setSubHeader }) {
  const TABS = ["all", "open", "closed"];
  const [tab, setTab] = useState("all");
  const [search, setSearch] = useState("");
  // Active estimate for the long-press quick-actions sheet. null means closed.
  const [menuInv, setMenuInv] = useState(null);
  const tabIndex = TABS.indexOf(tab);
  // Year filter for the KPI strip + list. Defaults to the current year so
  // the close-rate metric reflects this year's pipeline (years of historical
  // estimates would otherwise drown out current performance). "all" is also
  // an option for users who want the lifetime view.
  const yearOf = (i) => i.year || (i.date ? new Date(i.date).getFullYear() : null);
  const availableYears = useMemo(() => {
    const ys = new Set();
    for (const i of invoices) { const y = yearOf(i); if (y) ys.add(y); }
    return [...ys].sort((a, b) => b - a);
  }, [invoices]);
  const [yearFilter, setYearFilter] = useState(new Date().getFullYear());
  // Native scroll-snap carousel — same pattern as InvoiceList.
  const trackRef = useRef(null);
  const programmaticScrollRef = useRef(false);

  useLayoutEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    el.scrollLeft = el.clientWidth * tabIndex;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    const target = el.clientWidth * tabIndex;
    if (Math.abs(el.scrollLeft - target) < 2) return;
    programmaticScrollRef.current = true;
    el.scrollTo({ left: target, behavior: "smooth" });
    setTimeout(() => { programmaticScrollRef.current = false; }, 400);
  }, [tabIndex]);

  const onScroll = () => {
    if (programmaticScrollRef.current) return;
    const el = trackRef.current;
    if (!el) return;
    const idx = Math.round(el.scrollLeft / el.clientWidth);
    const clamped = Math.max(0, Math.min(TABS.length - 1, idx));
    if (TABS[clamped] !== tab) setTab(TABS[clamped]);
  };

  const goToTab = (next) => {
    if (next === tab) return;
    setTab(next);
  };

  // Closed = signed/approved OR converted to invoice (Jake's definition)
  const isClosed = (inv) => inv.status === "approved" || !!inv.convertedToId;
  // Apply the year filter consistently to both the list and the KPI metrics
  // so the numbers always match what the user is currently looking at.
  const inYear = (inv) => yearFilter === "all" || yearOf(inv) === yearFilter;
  // Sort by date desc so converted/new estimates always land in the right
  // chronological slot (matches InvoiceList behavior).
  const byDateDescEst = (a, b) => {
    const ad = a.date || ""; const bd = b.date || "";
    if (ad !== bd) return ad < bd ? 1 : -1;
    return (a.id || "") < (b.id || "") ? 1 : -1;
  };
  const filterFor = (key) => invoices
    .filter(inYear)
    .filter(inv => key === "all" ? true : key === "open" ? !isClosed(inv) : isClosed(inv))
    .filter(inv => matchesSearch(inv, search))
    .sort(byDateDescEst);

  const yearScoped = invoices.filter(inYear);
  const openTotal = yearScoped.filter(i => !isClosed(i)).reduce((s, i) => s + calcTotals(i).total, 0);
  const closedTotal = yearScoped.filter(isClosed).reduce((s, i) => s + calcTotals(i).total, 0);
  const closeRate = yearScoped.length === 0 ? 0 : Math.round(yearScoped.filter(isClosed).length / yearScoped.length * 100);

  // Render KPI strip + filter tabs into the App-level sticky slot. Slot is
  // keyed by tab name ("estimates") so stale pushes can't blank a new tab.
  useEffect(() => {
    setSubHeader?.("estimates",
      <>
        <div style={{ background: NAVY2, padding: "10px 16px 12px" }}>
          {/* Year selector. Sits just above the KPIs so it's clear the
              numbers below are scoped to the chosen year. */}
          <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
            <select
              value={yearFilter}
              onChange={e => {
                const v = e.target.value;
                setYearFilter(v === "all" ? "all" : parseInt(v, 10));
              }}
              style={{ background: "rgba(255,255,255,0.08)", color: "#fff", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 6, padding: "4px 10px", fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 13, letterSpacing: 0.5, cursor: "pointer" }}
            >
              {availableYears.map(y => <option key={y} value={y} style={{ color: "#222" }}>{y}</option>)}
              <option value="all" style={{ color: "#222" }}>All years</option>
            </select>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <div><div style={{ color: "#8899bb", fontSize: 11, letterSpacing: 1, fontFamily: "'Barlow Condensed', sans-serif", textTransform: "uppercase" }}>Open</div><div style={{ color: ORANGE, fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 20 }}>{fmt(openTotal)}</div></div>
            <div style={{ textAlign: "center" }}><div style={{ color: "#8899bb", fontSize: 11, letterSpacing: 1, fontFamily: "'Barlow Condensed', sans-serif", textTransform: "uppercase" }}>Close Rate</div><div style={{ color: "#4ecb71", fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 20 }}>{closeRate}%</div></div>
            <div style={{ textAlign: "right" }}><div style={{ color: "#8899bb", fontSize: 11, letterSpacing: 1, fontFamily: "'Barlow Condensed', sans-serif", textTransform: "uppercase" }}>Closed</div><div style={{ color: "#4ecb71", fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 20 }}>{fmt(closedTotal)}</div></div>
          </div>
        </div>
        <SearchBar value={search} onChange={setSearch} placeholder="Search estimates, clients, line items" />
        <div style={{ display: "flex", background: "#fff", borderBottom: "1px solid #eee" }}>
          {TABS.map(t => (
            <button key={t} onClick={() => goToTab(t)} style={{ flex: 1, padding: "10px 4px", background: "none", border: "none", borderBottom: tab === t ? `2px solid ${ORANGE}` : "2px solid transparent", color: tab === t ? ORANGE : "#888", fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 13, letterSpacing: 1, textTransform: "uppercase", cursor: "pointer", transition: "border-color 0.15s, color 0.15s" }}>{t}</button>
          ))}
        </div>
      </>
    );
  }, [tab, openTotal, closedTotal, closeRate, search, setSubHeader, yearFilter, availableYears]);

  const renderColumn = (key) => {
    const list = filterFor(key);
    const yrs = [...new Set(list.map(i => i.year || new Date(i.date).getFullYear()))].sort((a, b) => b - a);
    const yrTotal = (yr) => list.filter(i => (i.year || new Date(i.date).getFullYear()) === yr).reduce((s, i) => s + calcTotals(i).total, 0);
    if (list.length === 0) {
      return (
        <div style={{ padding: "48px 24px", textAlign: "center" }}>
          <Icon name="estimates" size={48} color="#dde2ee" />
          <div style={{ fontSize: 16, fontWeight: 600, color: "#888", marginTop: 16, marginBottom: 8 }}>No {key === "all" ? "" : key + " "}estimates</div>
          <div style={{ fontSize: 13, color: "#aaa" }}>{key === "closed" ? "Approved or converted estimates will show up here." : key === "open" ? "Pending estimates will show up here." : "Tap + to create your first estimate"}</div>
        </div>
      );
    }
    return yrs.map(yr => (
      <div key={yr}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 4px", marginBottom: 6 }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: "#8899bb", letterSpacing: 1, fontFamily: "'Barlow Condensed', sans-serif", textTransform: "uppercase" }}>{yr}</span>
          <span style={{ fontSize: 13, fontWeight: 700, color: "#555" }}>{fmt(yrTotal(yr))}</span>
        </div>
        {list.filter(i => (i.year || new Date(i.date).getFullYear()) === yr).map(inv => {
          const t = calcTotals(inv);
          const closed = isClosed(inv);
          const pillLabel = inv.convertedToId ? "→ Invoice" : inv.status === "approved" ? "✓ Approved" : "Open";
          const pillColor = closed ? "#27ae60" : "#8899bb";
          return (
            <EstimateListCard key={inv.id} inv={inv} onSelect={onSelect} onLongPress={setMenuInv} pillLabel={pillLabel} pillColor={pillColor} total={t.total} />
          );
        })}
      </div>
    ));
  };

  return (
    <div>
      <div
        ref={trackRef}
        onScroll={onScroll}
        style={{
          display: "flex",
          overflowX: "auto",
          overflowY: "hidden",
          scrollSnapType: "x mandatory",
          WebkitOverflowScrolling: "touch",
          scrollbarWidth: "none",
          minHeight: "calc(100vh - 280px)",
        }}
      >
        {TABS.map(key => (
          <div
            key={key}
            style={{
              flex: "0 0 100%",
              width: "100%",
              scrollSnapAlign: "start",
              scrollSnapStop: "always",
              padding: "12px 12px 0",
              boxSizing: "border-box",
              minHeight: "calc(100vh - 280px)",
            }}
          >
            {renderColumn(key)}
          </div>
        ))}
      </div>
      {menuInv && (
        <InvoiceQuickActionsMenu
          inv={menuInv}
          onClose={() => setMenuInv(null)}
          onDelete={() => { if (confirm(`Delete estimate ${menuInv.id}?\n\nThis cannot be undone.`)) onDelete?.(menuInv.id); }}
          onShare={() => onShare?.(menuInv)}
          onSend={() => onSend?.(menuInv)}
          onPrint={() => onPrint?.(menuInv)}
          onGetLink={() => onGetLink?.(menuInv)}
          onConvert={() => onConvert?.(menuInv)}
          onDuplicate={() => onDuplicate?.(menuInv)}
        />
      )}
    </div>
  );
}

// ─── Clients Tab ──────────────────────────────────────────────────────────────
// Generate a stable-ish unique id for a job-site address. Doesn't need to be
// cryptographically random — just unique within a single client.
function newAddressId() {
  return "a_" + Math.random().toString(36).slice(2, 10);
}

function emptyClient() {
  return {
    name: "", email: "", email2: "", phone: "", fax: "", contact: "",
    notes: "",
    addresses: [],
    billingAddress: null,
    // Legacy flat fields kept blank
    address1: "", address2: "", address3: "",
  };
}

// Shared client editor — used by both ClientsTab and InvoiceForm so adding a
// new property from inside an invoice goes through the same UI as editing on
// the Clients page. Pure controlled component: render the working draft and
// emit changes upward via `onChange`.
function ClientEditFields({ value, onChange, compact, isAdmin }) {
  const form = value || emptyClient();
  const setField = (k, v) => onChange({ ...form, [k]: v });
  const addresses = Array.isArray(form.addresses) ? form.addresses : [];
  const setAddrField = (idx, field, val) => {
    const next = [...addresses];
    next[idx] = { ...next[idx], [field]: val };
    onChange({ ...form, addresses: next });
  };
  const addAddress = () => {
    onChange({ ...form, addresses: [...addresses, { id: newAddressId(), label: "", line1: "", line2: "", line3: "" }] });
  };
  const removeAddress = (idx) => {
    onChange({ ...form, addresses: addresses.filter((_, i) => i !== idx) });
  };
  const billing = form.billingAddress || {};
  const setBillingField = (field, val) => {
    onChange({ ...form, billingAddress: { ...billing, [field]: val } });
  };
  // In compact mode (used inside the invoice form) we drop the heavier
  // padding and tighten the section labels so the editor fits cleanly
  // inside the bill-to card.
  const sectionLabelStyle = { fontSize: 11, fontWeight: 700, color: "#6677aa", letterSpacing: 2, textTransform: "uppercase", fontFamily: "'Barlow Condensed', sans-serif" };
  return (
    <div>
      {[["name", "Name"], ["email", "Email"], ["email2", "Secondary Email"], ["phone", "Phone"], ["fax", "Fax"]].map(([k, l]) => (
        <div key={k} style={{ marginBottom: compact ? 9 : 12 }}>
          <label style={{ ...S.label, marginBottom: compact ? 3 : 4 }}>{l}</label>
          <input style={S.input} value={form[k] || ""} onChange={e => setField(k, e.target.value)} type={k === "email" || k === "email2" ? "email" : "text"} />
        </div>
      ))}

      {/* Job sites — for property managers, multiple sites per client */}
      <div style={{ marginTop: compact ? 14 : 18, marginBottom: 8, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={sectionLabelStyle}>Job Sites / Properties</span>
        <button type="button" onClick={addAddress} style={{ ...S.btn("primary"), padding: "6px 12px", fontSize: 12 }}>+ Add</button>
      </div>
      {addresses.length === 0 && (
        <div style={{ background: "#f4f6fa", borderRadius: 8, padding: "14px 12px", fontSize: 12, color: "#888", marginBottom: 12 }}>
          No job sites yet. Tap + Add to enter the first property address. For a property manager, add one entry per property and give each a nickname (e.g. “Kaimuki Duplex”).
        </div>
      )}
      {addresses.map((a, idx) => (
        <div key={a.id || idx} style={{ background: "#fafbfd", border: "1px solid #dde2ee", borderRadius: 8, padding: 12, marginBottom: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
            <span style={{ ...sectionLabelStyle, letterSpacing: 1 }}>Property {idx + 1}</span>
            <button type="button" onClick={() => { if (confirm("Remove this property?")) removeAddress(idx); }} style={{ background: "none", border: "none", color: "#cc4444", fontSize: 12, cursor: "pointer", padding: 4 }}>Remove</button>
          </div>
          <input style={{ ...S.input, marginBottom: 6 }} value={a.label || ""} onChange={e => setAddrField(idx, "label", e.target.value)} placeholder="Nickname (e.g. Kaimuki Duplex)" />
          <input style={{ ...S.input, marginBottom: 6 }} value={a.line1 || ""} onChange={e => setAddrField(idx, "line1", e.target.value)} placeholder="Address Line 1" />
          <input style={{ ...S.input, marginBottom: 6 }} value={a.line2 || ""} onChange={e => setAddrField(idx, "line2", e.target.value)} placeholder="Address Line 2 (optional)" />
          <input style={{ ...S.input, marginBottom: isAdmin ? 6 : 0 }} value={a.line3 || ""} onChange={e => setAddrField(idx, "line3", e.target.value)} placeholder="City, State, Zip" />
          {isAdmin && (
            <textarea
              style={{ ...S.input, height: 60, resize: "none", fontSize: 12 }}
              value={a.notes || ""}
              onChange={e => setAddrField(idx, "notes", e.target.value)}
              placeholder="Admin notes — gate code, water shutoff, tenant info…"
            />
          )}
        </div>
      ))}

      {/* Billing address — single, separate from job sites */}
      <div style={{ marginTop: compact ? 14 : 18, marginBottom: 8 }}>
        <span style={sectionLabelStyle}>Billing Address</span>
      </div>
      <div style={{ background: "#fafbfd", border: "1px solid #dde2ee", borderRadius: 8, padding: 12, marginBottom: 4 }}>
        <div style={{ fontSize: 11, color: "#888", marginBottom: 8 }}>Where invoices and statements are mailed/emailed. Leave blank to use the first job site.</div>
        <input style={{ ...S.input, marginBottom: 6 }} value={billing.line1 || ""} onChange={e => setBillingField("line1", e.target.value)} placeholder="Address Line 1" />
        <input style={{ ...S.input, marginBottom: 6 }} value={billing.line2 || ""} onChange={e => setBillingField("line2", e.target.value)} placeholder="Address Line 2 (optional)" />
        <input style={S.input} value={billing.line3 || ""} onChange={e => setBillingField("line3", e.target.value)} placeholder="City, State, Zip" />
      </div>

      {isAdmin && (
        <div style={{ marginTop: compact ? 14 : 18 }}>
          <div style={{ ...sectionLabelStyle, marginBottom: 6 }}>Admin Notes</div>
          <textarea
            style={{ ...S.input, height: 72, resize: "none" }}
            value={form.notes || ""}
            onChange={e => setField("notes", e.target.value)}
            placeholder="Internal notes — visible to admin only. Gate codes, account history, special instructions…"
          />
        </div>
      )}
    </div>
  );
}

// Normalize a draft client before save: ensure every address has an id and
// fall back to empty strings for missing label/line fields.
function normalizeClientDraft(draft) {
  return {
    ...draft,
    addresses: (draft.addresses || []).map(a => ({
      id: a.id || newAddressId(),
      label: a.label || "",
      line1: a.line1 || "",
      line2: a.line2 || "",
      line3: a.line3 || "",
      notes: a.notes || "",
    })),
  };
}

// ─── CSV Importer (Invoice Simple → HI Grade) ─────────────────────────────────
// RFC 4180-ish CSV parser. Handles quoted fields, escaped quotes (""),
// CRLF line endings, and commas inside quotes. Returns { headers, rows }.
function parseCSV(text) {
  const rows = [];
  let cur = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  // Strip BOM
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  while (i < text.length) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      field += c; i++; continue;
    }
    if (c === '"') { inQuotes = true; i++; continue; }
    if (c === ',') { cur.push(field); field = ""; i++; continue; }
    if (c === '\r') { i++; continue; }
    if (c === '\n') { cur.push(field); rows.push(cur); cur = []; field = ""; i++; continue; }
    field += c; i++;
  }
  // Flush last field/row
  if (field.length > 0 || cur.length > 0) { cur.push(field); rows.push(cur); }
  // Drop trailing empty rows
  while (rows.length && rows[rows.length - 1].every(f => !f.trim())) rows.pop();
  if (rows.length === 0) return { headers: [], rows: [] };
  const headers = rows[0].map(h => h.trim());
  const data = rows.slice(1).map(r => {
    const obj = {};
    headers.forEach((h, idx) => { obj[h] = (r[idx] || "").trim(); });
    return obj;
  });
  return { headers, rows: data };
}

// Find the first matching column name (case-insensitive, trimmed) from a list
// of candidate names. Returns the actual header string from `headers` or "".
function matchHeader(headers, candidates) {
  const lower = headers.map(h => h.toLowerCase().trim());
  for (const cand of candidates) {
    const idx = lower.indexOf(cand.toLowerCase());
    if (idx >= 0) return headers[idx];
  }
  return "";
}

// Auto-detect column mapping from CSV headers. Covers Invoice Simple's
// likely column names plus common variants from QuickBooks, Bookipi, etc.
function autoMapColumns(headers) {
  return {
    name:    matchHeader(headers, ["name", "client name", "customer name", "customer", "client", "contact name", "company name", "company", "display name", "display_name", "displayname", "full name"]),
    email:   matchHeader(headers, ["email", "email address", "primary email", "e-mail"]),
    email2:  matchHeader(headers, ["email 2", "secondary email", "alt email", "email2", "other email"]),
    phone:   matchHeader(headers, ["phone", "phone number", "primary phone", "mobile", "mobile phone", "telephone", "contact phone", "phonenumber"]),
    fax:     matchHeader(headers, ["fax", "fax number", "faxnumber"]),
    line1:   matchHeader(headers, ["address", "address 1", "address1", "street", "street address", "address line 1", "billing address", "billing address 1", "billing street", "shipping address", "shipping street"]),
    line2:   matchHeader(headers, ["address 2", "address2", "address line 2", "billing address 2", "shipping address 2", "unit", "apt", "suite"]),
    city:    matchHeader(headers, ["city", "town", "billing city", "shipping city"]),
    state:   matchHeader(headers, ["state", "province", "region", "billing state", "billing state or province", "shipping state"]),
    zip:     matchHeader(headers, ["zip", "zip code", "postal code", "post code", "postcode", "billing zip", "billing postal code", "shipping zip", "shipping postal code"]),
    country: matchHeader(headers, ["country", "billing country", "shipping country"]),
    notes:   matchHeader(headers, ["notes", "note", "memo", "comments"]),
  };
}

// Build a HI Grade client object from a parsed CSV row + the chosen mapping.
// City/State/Zip are folded into a single "line3" (matches the existing schema).
function csvRowToClient(row, m) {
  const get = (k) => (m[k] && row[m[k]]) ? row[m[k]].trim() : "";
  const line1 = get("line1");
  const line2 = get("line2");
  const city = get("city");
  const state = get("state");
  const zip = get("zip");
  // Compose "City, ST Zip" — only include parts present.
  let line3 = "";
  if (city || state || zip) {
    const cs = [city, state].filter(Boolean).join(", ");
    line3 = [cs, zip].filter(Boolean).join(" ").trim();
  }
  const addresses = [];
  if (line1 || line2 || line3) {
    addresses.push({ id: newAddressId(), label: "", line1, line2, line3 });
  }
  return {
    name: get("name"),
    email: get("email"),
    email2: get("email2"),
    phone: get("phone"),
    fax: get("fax"),
    contact: "",
    addresses,
    billingAddress: null,
    address1: "", address2: "", address3: "",
  };
}

function ImportClientsModal({ existingClients, onClose, onImport }) {
  // step: "pick" → choose file, "map" → review/adjust column mapping + preview,
  //       "importing" → progress bar, "done" → summary
  const [step, setStep] = useState("pick");
  const [headers, setHeaders] = useState([]);
  const [rows, setRows] = useState([]);
  const [mapping, setMapping] = useState({});
  const [error, setError] = useState("");
  const [progress, setProgress] = useState({ done: 0, total: 0, errors: [] });
  const [skipDuplicates, setSkipDuplicates] = useState(true);

  const fileRef = useRef(null);

  const onFile = async (file) => {
    setError("");
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { setError("File is over 5 MB. Try a smaller export."); return; }
    try {
      const text = await file.text();
      const { headers: hs, rows: rs } = parseCSV(text);
      if (hs.length === 0 || rs.length === 0) {
        setError("No rows found in this CSV. Make sure the first line is column headers.");
        return;
      }
      setHeaders(hs);
      setRows(rs);
      setMapping(autoMapColumns(hs));
      setStep("map");
    } catch (e) {
      setError("Could not read this file: " + (e.message || e));
    }
  };

  // Invoice Simple's only CSV export is the Invoice Summary — one row per
  // invoice with the client name/email/phone/address embedded as columns.
  // Same client appears N times if they have N invoices. Dedupe by
  // case-insensitive name, keeping the first non-blank value for each
  // contact field (so an empty cell on a later invoice doesn't wipe out
  // a real value from an earlier one).
  const previewClients = useMemo(() => {
    const all = rows.map(r => csvRowToClient(r, mapping));
    const byName = new Map();
    for (const c of all) {
      const key = (c.name || "").trim().toLowerCase();
      if (!key) continue;
      const prev = byName.get(key);
      if (!prev) { byName.set(key, c); continue; }
      // Merge: prefer first non-empty value for each scalar field, and
      // keep the first address that has any line populated.
      prev.email = prev.email || c.email;
      prev.email2 = prev.email2 || c.email2;
      prev.phone = prev.phone || c.phone;
      prev.fax = prev.fax || c.fax;
      if ((!prev.addresses || prev.addresses.length === 0) && c.addresses && c.addresses.length) {
        prev.addresses = c.addresses;
      }
    }
    return Array.from(byName.values());
  }, [rows, mapping]);
  const validPreview = previewClients.filter(c => c.name && c.name.trim());
  // Count of rows that had no name in the chosen Name column — separate from
  // dedupe collapse, so the user knows if rows fell through entirely.
  const skippedNoName = rows.filter(r => {
    const n = mapping.name ? (r[mapping.name] || "").trim() : "";
    return !n;
  }).length;

  const existingNames = useMemo(() => new Set((existingClients || []).map(c => (c.name || "").trim().toLowerCase())), [existingClients]);
  const duplicates = validPreview.filter(c => existingNames.has(c.name.trim().toLowerCase()));
  const toImport = skipDuplicates ? validPreview.filter(c => !existingNames.has(c.name.trim().toLowerCase())) : validPreview;

  const runImport = async () => {
    setStep("importing");
    setProgress({ done: 0, total: toImport.length, errors: [] });
    const errors = [];
    let done = 0;
    for (const c of toImport) {
      try {
        await onImport(c);
      } catch (e) {
        errors.push({ name: c.name, message: e.message || String(e) });
      }
      done++;
      setProgress({ done, total: toImport.length, errors: [...errors] });
    }
    setStep("done");
  };

  const fieldLabels = {
    name: "Name *",
    email: "Email",
    email2: "Secondary Email",
    phone: "Phone",
    fax: "Fax",
    line1: "Address Line 1",
    line2: "Address Line 2",
    city: "City",
    state: "State",
    zip: "Zip",
    country: "Country (ignored)",
    notes: "Notes (ignored)",
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 1000, display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
      <div style={{ background: "#fff", width: "100%", maxWidth: 480, maxHeight: "92vh", borderTopLeftRadius: 14, borderTopRightRadius: 14, overflow: "hidden", display: "flex", flexDirection: "column" }}>
        {/* Header */}
        <div style={{ background: NAVY2, color: "#fff", padding: "14px 16px", display: "flex", alignItems: "center", gap: 10 }}>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "#fff", fontSize: 22, cursor: "pointer", padding: 0, lineHeight: 1 }}>×</button>
          <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 18 }}>Import Clients from CSV</span>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: 14 }}>
          {step === "pick" && (
            <div>
              <div style={{ fontSize: 13, color: "#444", marginBottom: 10, lineHeight: 1.45 }}>
                Export your data from Invoice Simple, then choose the CSV file here.
              </div>
              <div style={{ background: "#fafbfd", border: "1px solid #dde2ee", borderRadius: 8, padding: 12, marginBottom: 14, fontSize: 12, color: "#555", lineHeight: 1.5 }}>
                <div style={{ fontWeight: 700, color: "#222", marginBottom: 6 }}>How to export from Invoice Simple</div>
                Invoice Simple has no client-only export, but their <b>Invoice Summary</b> CSV includes each client’s name, email, phone, and address on every invoice row. We’ll dedupe by name and pull out the unique clients automatically.
                <div style={{ marginTop: 8 }}>
                  In the Invoice Simple app: <b>Settings → Export Invoice Summary</b>, pick the widest date range it offers, choose <b>CSV</b>, then save the file and pick it here.
                </div>
              </div>
              <button onClick={() => fileRef.current?.click()} style={{ ...S.btn("primary"), width: "100%", padding: 14, fontSize: 15 }}>Choose CSV File</button>
              <input ref={fileRef} type="file" accept=".csv,text/csv" style={{ display: "none" }} onChange={e => onFile(e.target.files?.[0])} />
              {error && <div style={{ marginTop: 12, padding: 10, background: "#fdecec", color: "#cc4444", borderRadius: 6, fontSize: 13 }}>{error}</div>}
            </div>
          )}

          {step === "map" && (
            <div>
              <div style={{ fontSize: 12, color: "#666", marginBottom: 10 }}>Found <b>{rows.length}</b> rows · <b>{headers.length}</b> columns · deduped to <b>{validPreview.length}</b> client{validPreview.length === 1 ? "" : "s"} by name. Review the mapping below.</div>

              <div style={{ marginBottom: 14 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: "#6677aa", letterSpacing: 2, textTransform: "uppercase", fontFamily: "'Barlow Condensed', sans-serif" }}>Column Mapping</span>
              </div>
              {Object.keys(fieldLabels).map(field => (
                <div key={field} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                  <div style={{ width: 130, fontSize: 12, color: "#444" }}>{fieldLabels[field]}</div>
                  <select value={mapping[field] || ""} onChange={e => setMapping({ ...mapping, [field]: e.target.value })} style={{ ...S.input, flex: 1, fontSize: 13, padding: "8px 10px" }}>
                    <option value="">— skip —</option>
                    {headers.map(h => <option key={h} value={h}>{h}</option>)}
                  </select>
                </div>
              ))}

              <div style={{ marginTop: 18, marginBottom: 8 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: "#6677aa", letterSpacing: 2, textTransform: "uppercase", fontFamily: "'Barlow Condensed', sans-serif" }}>Preview ({validPreview.length} valid)</span>
              </div>
              <div style={{ background: "#fafbfd", border: "1px solid #dde2ee", borderRadius: 8, padding: 8, maxHeight: 240, overflowY: "auto" }}>
                {validPreview.slice(0, 10).map((c, i) => {
                  const isDup = existingNames.has(c.name.trim().toLowerCase());
                  const a = c.addresses[0];
                  return (
                    <div key={i} style={{ padding: "8px 6px", borderBottom: i < Math.min(9, validPreview.length - 1) ? "1px solid #eef0f5" : "none", fontSize: 12 }}>
                      <div style={{ fontWeight: 700, color: isDup ? "#cc8844" : "#222" }}>
                        {c.name} {isDup && <span style={{ fontSize: 10, color: "#cc8844", fontWeight: 600 }}>(already exists)</span>}
                      </div>
                      {(c.email || c.phone) && <div style={{ color: "#666", marginTop: 1 }}>{[c.email, c.phone].filter(Boolean).join(" · ")}</div>}
                      {a && (a.line1 || a.line3) && <div style={{ color: "#888", marginTop: 1 }}>{[a.line1, a.line3].filter(Boolean).join(", ")}</div>}
                    </div>
                  );
                })}
                {validPreview.length === 0 && <div style={{ padding: 12, color: "#888", fontSize: 12, textAlign: "center" }}>No rows have a Name yet. Map the Name column above.</div>}
                {validPreview.length > 10 && <div style={{ padding: "6px 6px", color: "#888", fontSize: 11, fontStyle: "italic" }}>…and {validPreview.length - 10} more.</div>}
              </div>

              {(skippedNoName > 0 || duplicates.length > 0) && (
                <div style={{ marginTop: 10, fontSize: 12, color: "#888" }}>
                  {skippedNoName > 0 && <div>{skippedNoName} row{skippedNoName === 1 ? "" : "s"} skipped (no name).</div>}
                  {duplicates.length > 0 && <div>{duplicates.length} duplicate{duplicates.length === 1 ? "" : "s"} found.</div>}
                </div>
              )}
              {duplicates.length > 0 && (
                <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10, fontSize: 13, color: "#444" }}>
                  <input type="checkbox" checked={skipDuplicates} onChange={e => setSkipDuplicates(e.target.checked)} />
                  Skip clients whose name already exists
                </label>
              )}

              <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
                <button onClick={() => { setStep("pick"); setHeaders([]); setRows([]); }} style={{ ...S.btn("ghost"), flex: 1, fontSize: 13 }}>Back</button>
                <button onClick={runImport} disabled={toImport.length === 0} style={{ ...S.btn("primary"), flex: 2, fontSize: 14, opacity: toImport.length === 0 ? 0.5 : 1 }}>
                  Import {toImport.length} client{toImport.length === 1 ? "" : "s"}
                </button>
              </div>
            </div>
          )}

          {step === "importing" && (
            <div style={{ padding: 20, textAlign: "center" }}>
              <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 18, marginBottom: 12 }}>Importing…</div>
              <div style={{ background: "#eef0f5", borderRadius: 8, height: 12, overflow: "hidden", marginBottom: 8 }}>
                <div style={{ background: ORANGE, height: "100%", width: progress.total ? `${Math.round((progress.done / progress.total) * 100)}%` : "0%", transition: "width 0.2s" }} />
              </div>
              <div style={{ fontSize: 13, color: "#666" }}>{progress.done} of {progress.total}</div>
            </div>
          )}

          {step === "done" && (
            <div style={{ padding: 14 }}>
              <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 20, color: "#27ae60", marginBottom: 8 }}>Import complete</div>
              <div style={{ fontSize: 14, marginBottom: 12 }}>
                <b>{progress.done - progress.errors.length}</b> clients added.
                {progress.errors.length > 0 && <span style={{ color: "#cc4444" }}> {progress.errors.length} failed.</span>}
              </div>
              {progress.errors.length > 0 && (
                <div style={{ background: "#fdecec", border: "1px solid #f5c6cb", borderRadius: 8, padding: 10, fontSize: 12, color: "#7a2222", marginBottom: 12, maxHeight: 180, overflowY: "auto" }}>
                  {progress.errors.slice(0, 20).map((e, i) => (
                    <div key={i} style={{ marginBottom: 4 }}>{e.name}: {e.message}</div>
                  ))}
                </div>
              )}
              <button onClick={onClose} style={{ ...S.btn("primary"), width: "100%", padding: 12 }}>Done</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ClientsTab({ clients, invoices, onSave, onDelete, onImportClient, onSelectInvoice, openClientId, onOpenedClient, isAdmin }) {
  // Three modes: "list" (default), "detail" (viewing one client),
  // "edit" (form). detailId / editId hold the client id (or "new" for edit).
  const [mode, setMode] = useState("list");
  const [detailId, setDetailId] = useState(null);
  const [editId, setEditId] = useState(null);
  const [form, setForm] = useState(emptyClient());
  const [search, setSearch] = useState("");
  const [showImport, setShowImport] = useState(false);

  const clientTabDraftKey = `higrade_client_edit_${editId || "none"}`;
  const clearClientTabDraft = useDraftPersistence(
    clientTabDraftKey,
    mode === "edit" ? form : null,
    setForm,
    null
  );

  const startEdit = (c) => {
    const eid = c?.id ?? "new";
    setEditId(eid);
    setForm(c ? {
      ...emptyClient(),
      ...c,
      addresses: Array.isArray(c.addresses) ? c.addresses : [],
    } : emptyClient());
    setMode("edit");
  };
  const openDetail = (c) => {
    setDetailId(c.id);
    setMode("detail");
  };

  // Auto-open a client when navigated in via AI assistant or invoice client picker
  useEffect(() => {
    if (openClientId == null) return;
    const c = clients.find(cl => cl.id === openClientId);
    if (c) openDetail(c);
    onOpenedClient?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openClientId]);

  // Edge-swipe-from-left back gesture. Steps back through modes the same
  // way the in-screen back arrows do: edit → detail (or list for new),
  // detail → list. Stays out of the way when already on the list.
  useEffect(() => {
    const onSwipeBack = () => {
      if (mode === "edit") {
        clearClientTabDraft();
        setMode(detailId ? "detail" : "list");
        setEditId(null);
      } else if (mode === "detail") {
        setMode("list");
        setDetailId(null);
      }
    };
    window.addEventListener('app-back', onSwipeBack);
    return () => window.removeEventListener('app-back', onSwipeBack);
  }, [mode, detailId]);

  const save = () => {
    clearClientTabDraft();
    // Make sure each address has an id and a label so dropdowns work later.
    onSave(normalizeClientDraft(form), editId);
    // After save, slide back to detail (or list for new clients).
    if (editId === "new") { setMode("list"); setEditId(null); }
    else { setDetailId(editId); setMode("detail"); setEditId(null); }
  };
  const handleDelete = () => {
    if (!confirm(`Delete ${form.name}?`)) return;
    clearClientTabDraft();
    onDelete(editId);
    setMode("list"); setEditId(null); setDetailId(null);
  };

  // ─── Edit mode ──────────────────────────────────────────────────────────
  if (mode === "edit") {
    return (
      <div style={{ padding: 16, paddingBottom: 40 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
          <button onClick={() => { clearClientTabDraft(); setMode(detailId ? "detail" : "list"); setEditId(null); }} style={{ background: "none", border: "none", cursor: "pointer" }}><Icon name="back" size={22} /></button>
          <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 20 }}>{editId === "new" ? "New Client" : "Edit Client"}</span>
        </div>
        <ClientEditFields value={form} onChange={setForm} isAdmin={isAdmin} />
        <button onClick={save} style={{ ...S.btn("primary"), width: "100%", marginTop: 12, fontSize: 16, padding: 14 }}>Save Client</button>
        <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
          <button onClick={() => alert("Import from Contacts \u2014 coming soon")} style={{ ...S.btn("ghost"), flex: 1, fontSize: 13 }}>Import from Contacts</button>
          <button onClick={() => alert("Create Statement \u2014 coming soon")} style={{ ...S.btn("ghost"), flex: 1, fontSize: 13 }}>Create Statement</button>
        </div>
        {editId !== "new" && <button onClick={handleDelete} style={{ ...S.btn("ghost"), width: "100%", marginTop: 10, fontSize: 13, color: "#cc4444" }}>Delete Client</button>}
      </div>
    );
  }

  // ─── Detail mode ────────────────────────────────────────────────────────
  if (mode === "detail") {
    const c = clients.find(cl => cl.id === detailId);
    if (!c) {
      // Client was deleted while we were viewing it — fall back to list.
      setMode("list"); setDetailId(null);
      return null;
    }
    const docs = (invoices || []).filter(i => i.client === c.name);
    const realInvoices = docs.filter(d => d.type !== "estimate");
    const realEstimates = docs.filter(d => d.type === "estimate");
    const sortByDate = (a, b) => (a.date < b.date ? 1 : -1);
    realInvoices.sort(sortByDate);
    realEstimates.sort(sortByDate);
    const outstanding = realInvoices
      .filter(i => i.status === "outstanding" || i.status === "net30" || i.status === "partial")
      .reduce((s, i) => s + calcTotals(i).balance, 0);
    const totalBilled = realInvoices.reduce((s, i) => s + calcTotals(i).total, 0);
    const billing = c.billingAddress || {};

    return (
      <div style={{ paddingBottom: 40 }}>
        {/* Header bar */}
        <div style={{ background: NAVY2, padding: "14px 16px", display: "flex", alignItems: "center", gap: 10 }}>
          <button onClick={() => { setMode("list"); setDetailId(null); }} style={{ background: "none", border: "none", cursor: "pointer", padding: 4 }}><Icon name="back" size={22} color="#fff" /></button>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 18, color: "#fff", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.name}</div>
            {c.phone && <div style={{ fontSize: 12, color: "#8899bb" }}>{c.phone}</div>}
          </div>
          <button onClick={() => startEdit(c)} style={{ ...S.btn("primary"), padding: "8px 14px", fontSize: 12 }}>Edit</button>
        </div>

        {/* KPI strip */}
        <div style={{ background: NAVY2, padding: "0 16px 12px", display: "flex", justifyContent: "space-between", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
          <div><div style={{ color: "#8899bb", fontSize: 11, letterSpacing: 1, fontFamily: "'Barlow Condensed', sans-serif", textTransform: "uppercase" }}>Outstanding</div><div style={{ color: ORANGE, fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 18 }}>{fmt(outstanding)}</div></div>
          <div style={{ textAlign: "right" }}><div style={{ color: "#8899bb", fontSize: 11, letterSpacing: 1, fontFamily: "'Barlow Condensed', sans-serif", textTransform: "uppercase" }}>Total Billed</div><div style={{ color: "#4ecb71", fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 18 }}>{fmt(totalBilled)}</div></div>
        </div>

        <div style={{ padding: 12 }}>
          {/* Contact card */}
          {(c.email || c.email2 || c.phone || c.fax) && (
            <div style={{ ...S.card, padding: "12px 14px", marginBottom: 12 }}>
              {c.email && <div style={{ fontSize: 13, color: "#444" }}>{c.email}</div>}
              {c.email2 && <div style={{ fontSize: 13, color: "#444" }}>{c.email2}</div>}
              {c.phone && <div style={{ fontSize: 13, color: "#444" }}>{c.phone}</div>}
              {c.fax && <div style={{ fontSize: 13, color: "#444" }}>fax {c.fax}</div>}
            </div>
          )}

          {/* Job sites list */}
          {(c.addresses || []).length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#6677aa", letterSpacing: 2, textTransform: "uppercase", fontFamily: "'Barlow Condensed', sans-serif", padding: "0 4px", marginBottom: 6 }}>Job Sites ({c.addresses.length})</div>
              {c.addresses.map(a => (
                <div key={a.id} style={{ ...S.card, padding: "10px 14px", marginBottom: 6 }}>
                  {a.label && <div style={{ fontWeight: 700, fontSize: 13, color: NAVY }}>{a.label}</div>}
                  {a.line1 && <div style={{ fontSize: 13, color: "#444" }}>{a.line1}</div>}
                  {a.line2 && <div style={{ fontSize: 13, color: "#444" }}>{a.line2}</div>}
                  {a.line3 && <div style={{ fontSize: 13, color: "#444" }}>{a.line3}</div>}
                </div>
              ))}
            </div>
          )}

          {/* Billing address */}
          {(billing.line1 || billing.line2 || billing.line3) && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#6677aa", letterSpacing: 2, textTransform: "uppercase", fontFamily: "'Barlow Condensed', sans-serif", padding: "0 4px", marginBottom: 6 }}>Billing Address</div>
              <div style={{ ...S.card, padding: "10px 14px" }}>
                {billing.line1 && <div style={{ fontSize: 13, color: "#444" }}>{billing.line1}</div>}
                {billing.line2 && <div style={{ fontSize: 13, color: "#444" }}>{billing.line2}</div>}
                {billing.line3 && <div style={{ fontSize: 13, color: "#444" }}>{billing.line3}</div>}
              </div>
            </div>
          )}

          {/* Invoices */}
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#6677aa", letterSpacing: 2, textTransform: "uppercase", fontFamily: "'Barlow Condensed', sans-serif", padding: "0 4px", marginBottom: 6 }}>Invoices ({realInvoices.length})</div>
            {realInvoices.length === 0 ? (
              <div style={{ background: "#f4f6fa", borderRadius: 8, padding: "14px 12px", fontSize: 13, color: "#888" }}>No invoices yet for this client.</div>
            ) : realInvoices.map(inv => {
              const t = calcTotals(inv);
              const { label: statusLabel, color: pillColor } = statusDisplay(inv);
              const lastMethod = inv.status === "paid" && (inv.payments || []).length > 0 ? inv.payments[inv.payments.length - 1].method : null;
              const amountColor = inv.status === "paid" ? "#4ecb71" : inv.status === "partial" ? "#f39c12" : ORANGE;
              const displayAmt = inv.status !== "paid" && t.paid > 0 ? fmt(Math.max(0, t.balance)) : fmt(t.total);
              return (
                <InvoiceListCard key={inv.id} inv={inv} onSelect={onSelectInvoice} statusLabel={statusLabel} pillColor={pillColor} lastMethod={lastMethod} amountColor={amountColor} displayAmt={displayAmt} />
              );
            })}
          </div>

          {/* Estimates */}
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#6677aa", letterSpacing: 2, textTransform: "uppercase", fontFamily: "'Barlow Condensed', sans-serif", padding: "0 4px", marginBottom: 6 }}>Estimates ({realEstimates.length})</div>
            {realEstimates.length === 0 ? (
              <div style={{ background: "#f4f6fa", borderRadius: 8, padding: "14px 12px", fontSize: 13, color: "#888" }}>No estimates yet for this client.</div>
            ) : realEstimates.map(inv => {
              const t = calcTotals(inv);
              const closed = inv.status === "approved" || !!inv.convertedToId;
              const pillLabel = inv.convertedToId ? "\u2192 Invoice" : inv.status === "approved" ? "\u2713 Approved" : "Open";
              const pillColor = closed ? "#27ae60" : "#8899bb";
              return (
                <EstimateListCard key={inv.id} inv={inv} onSelect={onSelectInvoice} pillLabel={pillLabel} pillColor={pillColor} total={t.total} />
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  // ─── List mode ──────────────────────────────────────────────────────────
  const filtered = clients.filter(c => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    const hay = [c.name, c.email, c.email2, c.phone, ...(c.addresses || []).map(a => `${a.label} ${a.line1} ${a.line2} ${a.line3}`)].join(" ").toLowerCase();
    return hay.includes(q);
  });
  return (
    <div>
      <SearchBar value={search} onChange={setSearch} placeholder="Search clients" />
      {showImport && (
        <ImportClientsModal
          existingClients={clients}
          onClose={() => setShowImport(false)}
          onImport={(c) => onImportClient ? onImportClient(c) : onSave(c, "new")}
        />
      )}
      <div style={{ padding: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, padding: "0 4px" }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: "#6677aa", letterSpacing: 2, textTransform: "uppercase", fontFamily: "'Barlow Condensed', sans-serif" }}>Clients ({filtered.length}{filtered.length !== clients.length ? ` of ${clients.length}` : ""})</span>
          <div style={{ display: "flex", gap: 6 }}>
            <button onClick={() => setShowImport(true)} style={{ ...S.btn("ghost"), padding: "8px 12px", fontSize: 12 }}>Import</button>
            <button onClick={() => startEdit(null)} style={{ ...S.btn("primary"), padding: "8px 14px", fontSize: 13 }}>+ Add</button>
          </div>
        </div>
        {filtered.map(c => {
          const propCount = (c.addresses || []).length;
          return (
            <div key={c.id} onClick={() => openDetail(c)} style={{ ...S.card, padding: "12px 14px", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 2 }}>{c.name}</div>
                {c.phone && <div style={{ fontSize: 13, color: "#666" }}>{c.phone}</div>}
                {c.email && <div style={{ fontSize: 13, color: "#666", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.email}</div>}
              </div>
              {propCount > 1 && (
                <span style={{ ...S.pill("#2980b9"), marginLeft: 10 }}>{propCount} sites</span>
              )}
            </div>
          );
        })}
        {filtered.length === 0 && search && (
          <div style={{ padding: "32px 16px", textAlign: "center", color: "#888", fontSize: 13 }}>No clients match “{search}”.</div>
        )}
      </div>
    </div>
  );
}

// ─── Items Tab ────────────────────────────────────────────────────────────────
function ItemsTab({ savedItems, onDelete }) {
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
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 16, color: ORANGE }}>{fmt(item.price)}</span>
                {onDelete && <button onClick={() => { if (confirm(`Remove "${item.name}"?`)) onDelete(item.id); }} style={{ background: "none", border: "none", cursor: "pointer", padding: "2px 4px", color: "#cc4444", fontSize: 16, lineHeight: 1 }}>×</button>}
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

// ─── Payments Tab ─────────────────────────────────────────────────────────────
// ─── Notifications Bell ───────────────────────────────────────────────────────────
// Header bell + dropdown panel listing recent notifications. Subscribes
// to a Supabase realtime channel so the badge updates the moment a
// payment lands while the app is open. Tapping a notification marks it
// read and (if it has an invoice_id) navigates the app to that invoice.
function NotificationsBell({ onOpenInvoice }) {
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);
  // If the notifications table doesn't exist yet (migration 011 not applied),
  // we hide the bell entirely instead of spamming the console + showing a
  // useless empty bell. The first refresh detects this and flips the flag.
  const [available, setAvailable] = useState(true);
  const unread = items.filter(n => !n.read_at).length;

  const refresh = async () => {
    try { setItems(await db.listNotifications(50)); }
    catch (e) {
      // PGRST205 = table not in schema cache. Treat as "feature not yet enabled"
      // and silently disable the bell so it doesn't crash the rest of the UI.
      if (e?.code === 'PGRST205' || /notifications/i.test(e?.message || '')) {
        setAvailable(false);
      } else {
        console.error('listNotifications failed:', e);
      }
    }
  };

  useEffect(() => {
    refresh();
    let channel;
    try {
      channel = db.subscribeNotifications((row) => {
        setItems(prev => {
          if (prev.some(n => n.id === row.id)) return prev;
          return [row, ...prev].slice(0, 50);
        });
      });
    } catch {}
    const t = setInterval(refresh, 60000);
    return () => { try { db.unsubscribeChannel(channel); } catch {} clearInterval(t); };
  }, []);

  if (!available) return null;

  const handleClick = async (n) => {
    if (!n.read_at) {
      try { await db.markNotificationRead(n.id); } catch {}
      setItems(prev => prev.map(x => x.id === n.id ? { ...x, read_at: new Date().toISOString() } : x));
    }
    if (n.invoice_id) onOpenInvoice?.(n.invoice_id);
    setOpen(false);
  };

  const handleMarkAllRead = async () => {
    try { await db.markAllNotificationsRead(); } catch {}
    setItems(prev => prev.map(x => x.read_at ? x : { ...x, read_at: new Date().toISOString() }));
  };

  const fmtTime = (iso) => {
    const t = new Date(iso);
    const diff = (Date.now() - t.getTime()) / 1000;
    if (diff < 60) return 'just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
    return t.toLocaleDateString();
  };

  const iconForType = (type) => {
    if (type === 'payment') return { name: 'payment', color: '#27ae60' };
    if (type === 'estimate_signed') return { name: 'pen', color: ORANGE };
    if (type === 'invoice_open') return { name: 'eye', color: '#2980b9' };
    return { name: 'bell', color: '#888' };
  };

  return (
    <>
      <button
        onClick={() => setOpen(o => !o)}
        aria-label="Notifications"
        style={{ position: 'relative', width: 36, height: 36, background: 'transparent', borderRadius: 8, border: `2px solid ${ORANGE}`, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}
      >
        <Icon name="bell" size={18} color={ORANGE} />
        {unread > 0 && (
          <span style={{ position: 'absolute', top: -4, right: -4, background: ORANGE, color: '#fff', fontSize: 10, fontWeight: 700, minWidth: 18, height: 18, borderRadius: 9, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 5px', border: `2px solid ${NAVY}` }}>
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, background: 'transparent', zIndex: 200 }} />
          <div style={{ position: 'absolute', top: 56, right: 16, width: 'min(360px, calc(100vw - 32px))', maxHeight: 'min(70vh, 520px)', background: '#fff', borderRadius: 12, boxShadow: '0 8px 32px rgba(0,0,0,0.25)', zIndex: 201, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: '12px 14px', borderBottom: '1px solid #eaecf0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#f8f9fc' }}>
              <div style={{ fontWeight: 700, color: NAVY, fontSize: 14 }}>Notifications</div>
              {unread > 0 && (
                <button onClick={handleMarkAllRead} style={{ background: 'none', border: 'none', color: ORANGE, fontSize: 12, fontWeight: 600, cursor: 'pointer', padding: 0 }}>
                  Mark all read
                </button>
              )}
            </div>
            <div style={{ overflowY: 'auto', flex: 1 }}>
              {items.length === 0 ? (
                <div style={{ padding: '32px 16px', textAlign: 'center', color: '#888', fontSize: 13 }}>
                  No notifications yet.
                </div>
              ) : items.map(n => {
                const ic = iconForType(n.type);
                return (
                  <button
                    key={n.id}
                    onClick={() => handleClick(n)}
                    style={{ width: '100%', display: 'flex', gap: 10, padding: '12px 14px', background: n.read_at ? '#fff' : '#fff8f3', border: 'none', borderBottom: '1px solid #f0f2f6', cursor: 'pointer', textAlign: 'left' }}
                  >
                    <div style={{ width: 32, height: 32, borderRadius: 16, background: `${ic.color}22`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <Icon name={ic.name} size={16} color={ic.color} />
                    </div>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: NAVY, display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n.title}</span>
                        <span style={{ fontSize: 11, color: '#888', fontWeight: 400, flexShrink: 0 }}>{fmtTime(n.created_at)}</span>
                      </div>
                      <div style={{ fontSize: 12, color: '#556', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n.body}</div>
                    </div>
                    {!n.read_at && <div style={{ width: 8, height: 8, borderRadius: 4, background: ORANGE, alignSelf: 'center', flexShrink: 0 }} />}
                  </button>
                );
              })}
            </div>
          </div>
        </>
      )}
    </>
  );
}

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

// ─── In-Person Signature Modal ────────────────────────────────────────────────
function InPersonSignatureModal({ estimate, onClose, onSave }) {
  const canvasRef = useRef(null);
  const [drawing, setDrawing] = useState(false);
  const [isEmpty, setIsEmpty] = useState(true);
  const t = calcTotals(estimate);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = "#0a1628";
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
  }, []);

  const getPos = (e) => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const src = e.touches?.[0] || e;
    return {
      x: (src.clientX - rect.left) * (canvas.width / rect.width),
      y: (src.clientY - rect.top) * (canvas.height / rect.height),
    };
  };

  const startDraw = (e) => { e.preventDefault(); const ctx = canvasRef.current.getContext("2d"); const p = getPos(e); ctx.beginPath(); ctx.moveTo(p.x, p.y); setDrawing(true); setIsEmpty(false); };
  const draw = (e) => { if (!drawing) return; e.preventDefault(); const ctx = canvasRef.current.getContext("2d"); const p = getPos(e); ctx.lineTo(p.x, p.y); ctx.stroke(); };
  const endDraw = (e) => { e.preventDefault(); setDrawing(false); };

  const clear = () => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    setIsEmpty(true);
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "#fff", zIndex: 9999, display: "flex", flexDirection: "column", fontFamily: "'Barlow', sans-serif" }}>
      <div style={{ background: NAVY, padding: "16px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
        <div>
          <div style={{ color: "#fff", fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 17 }}>{estimate.client || "Client"}</div>
          <div style={{ color: ORANGE, fontSize: 12 }}>{estimate.id || "Estimate"} · {fmt(t.total)}</div>
        </div>
        <button onClick={onClose} style={{ background: "none", border: "none", color: "#8899bb", cursor: "pointer", fontSize: 26, lineHeight: 1 }}>✕</button>
      </div>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", padding: 20, gap: 12, overflow: "hidden" }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: "#333" }}>Sign to Approve Estimate</div>
          <div style={{ fontSize: 12, color: "#888", marginTop: 3 }}>Draw your signature in the box below</div>
        </div>
        <canvas
          ref={canvasRef}
          width={600}
          height={240}
          style={{ width: "100%", flex: 1, border: "2px solid #dde2ee", borderRadius: 10, touchAction: "none", background: "#fff", cursor: "crosshair", maxHeight: 300 }}
          onMouseDown={startDraw}
          onMouseMove={draw}
          onMouseUp={endDraw}
          onMouseLeave={endDraw}
          onTouchStart={startDraw}
          onTouchMove={draw}
          onTouchEnd={endDraw}
        />
        <div style={{ textAlign: "center", color: "#bbb", fontSize: 12, marginTop: -6 }}>× Sign above the line</div>
        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={clear} style={{ ...S.btn("ghost"), flex: 1, fontSize: 14 }}>Clear</button>
          <button onClick={() => onSave(canvasRef.current.toDataURL("image/png"))} disabled={isEmpty} style={{ ...S.btn(isEmpty ? "ghost" : "primary"), flex: 2, fontSize: 15, opacity: isEmpty ? 0.5 : 1 }}>
            ✓ Approve Estimate
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── PayPal Smart Buttons ─────────────────────────────────────────────────────
// Renders the official PayPal Smart Buttons inline. Server-driven flow:
// createOrder hits /api/paypal-create-order which derives the balance +
// surcharge from Supabase (so the customer can't tamper with the amount),
// then onApprove hits /api/paypal-capture-order which captures the payment
// and inserts a `payments` row. We invalidate the parent's data on success
// so the page flips to "Paid in full" without a manual refresh.
//
// The PayPal SDK is pulled from the CDN once per page mount; if it fails
// to load (offline, ad-blocker), we render a graceful fallback that links
// to the legacy _xclick checkout so the customer can still pay.
function PayPalCheckout({ token, invoiceId, balance, onPaid, clientId }) {
  const containerRef = useRef(null);
  const [status, setStatus] = useState('idle'); // idle | loading | ready | paid | error | unconfigured
  const [errorMsg, setErrorMsg] = useState('');
  const renderedRef = useRef(false);

  useEffect(() => {
    if (!clientId) { setStatus('unconfigured'); return; }
    if (renderedRef.current) return;
    renderedRef.current = true;
    setStatus('loading');

    // Reuse an existing SDK script tag if a prior mount already loaded it.
    const existing = document.querySelector('script[data-paypal-sdk="1"]');
    const onReady = () => {
      if (!window.paypal || !containerRef.current) {
        setStatus('error');
        setErrorMsg('PayPal failed to load. Please try again or pay by another method below.');
        return;
      }
      try {
        window.paypal.Buttons({
          style: { layout: 'vertical', color: 'gold', shape: 'rect', label: 'pay', height: 48 },

          createOrder: async () => {
            const res = await fetch('/api/paypal-create-order', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ token }),
            });
            const data = await res.json();
            if (!res.ok || !data.id) throw new Error(data.error || 'create_order_failed');
            return data.id;
          },

          onApprove: async (data) => {
            try {
              const res = await fetch('/api/paypal-capture-order', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ orderID: data.orderID }),
              });
              const out = await res.json();
              if (!res.ok || !out.ok) throw new Error(out.error || 'capture_failed');
              setStatus('paid');
              if (onPaid) onPaid(out);
            } catch (e) {
              setStatus('error');
              setErrorMsg('Payment captured but the receipt could not be saved. Please contact us at 808-393-0015 with your PayPal receipt.');
            }
          },

          onError: (err) => {
            console.error('[PayPal] error', err);
            setStatus('error');
            setErrorMsg('Something went wrong with PayPal. Please try again.');
          },
        }).render(containerRef.current).then(() => {
          if (status !== 'paid') setStatus('ready');
        });
      } catch (e) {
        console.error('[PayPal] render failed', e);
        setStatus('error');
        setErrorMsg(String(e?.message || e));
      }
    };

    if (existing && window.paypal) { onReady(); return; }
    if (existing) { existing.addEventListener('load', onReady); return; }

    const s = document.createElement('script');
    s.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(clientId)}&currency=USD&intent=capture&enable-funding=venmo&disable-funding=credit,paylater`;
    s.async = true;
    s.dataset.paypalSdk = '1';
    s.onload = onReady;
    s.onerror = () => { setStatus('error'); setErrorMsg('PayPal could not be loaded.'); };
    document.head.appendChild(s);
  // We intentionally only run this once per mount.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (status === 'unconfigured') {
    // Fall back to legacy redirect link so the page stays usable until the
    // PayPal client ID is set in Vercel env.
    return (
      <a
        href={`https://www.paypal.com/cgi-bin/webscr?cmd=_xclick&business=higradeplumbing%40gmail.com&amount=${balance.toFixed(2)}&currency_code=USD&item_name=Invoice%20${encodeURIComponent(invoiceId)}&no_note=1&no_shipping=1`}
        target="_blank" rel="noopener noreferrer"
        style={{ display: 'inline-block', background: '#0070ba', color: '#fff', textDecoration: 'none', fontSize: 16, fontWeight: 700, padding: '12px 24px', borderRadius: 8, whiteSpace: 'nowrap' }}
      >Pay ${balance.toFixed(2)} with PayPal</a>
    );
  }

  if (status === 'paid') {
    return (
      <div style={{ background: '#e8f8ef', color: '#1f7a3a', borderRadius: 8, padding: '14px 18px', fontSize: 14, fontWeight: 600, textAlign: 'center' }}>
        ✓ Payment received — mahalo!
      </div>
    );
  }

  return (
    <div>
      <div ref={containerRef} style={{ minHeight: status === 'loading' ? 56 : 0 }} />
      {status === 'loading' && (
        <div style={{ color: '#888', fontSize: 13, textAlign: 'center', padding: '8px 0' }}>Loading PayPal…</div>
      )}
      {status === 'error' && (
        <div style={{ color: '#a3231b', background: '#fdecec', borderRadius: 8, padding: 10, fontSize: 13, marginTop: 6 }}>{errorMsg}</div>
      )}
    </div>
  );
}

// ─── Public Viewer (trackable invoice/estimate link) ─────────────────────────
// Customers receive an email containing a link like /v/<token>. This page
// loads the invoice from /api/public-invoice (which runs server-side with
// the service-role key and is scoped to view_token only). The serverless
// route is required because RLS now blocks anon reads on the invoices
// table — we don't want random visitors fishing in our data.
//
// /api/track-open is also pinged once per mount so the activity log gets
// an "opened" entry.
function PublicViewerPage({ token }) {
  const [state, setState] = useState({ loading: true, error: null, invoice: null, items: [], payments: [], photos: [], company: null });
  const trackedRef = useRef(false);

  // Reactive viewport-width detection so the page switches between the
  // mobile-optimized layout and a desktop "paper" layout (modeled after the
  // printable PDF) whenever the window is resized or the device rotates.
  // IMPORTANT: this hook must live above any early returns so the hook count
  // stays stable between the initial "loading" render and the data render.
  // Otherwise React throws #310 ("rendered more hooks than during the
  // previous render") and the page goes blank.
  const [vw, setVw] = useState(typeof window !== 'undefined' ? window.innerWidth : 1024);
  useEffect(() => {
    const onResize = () => setVw(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(api(`/api/public-invoice?token=${encodeURIComponent(token)}`));
        if (r.status === 404) {
          if (!cancelled) setState(s => ({ ...s, loading: false, error: 'Link not found' }));
          return;
        }
        if (!r.ok) throw new Error(`Server returned ${r.status}`);
        const { invoice, items, payments, photos } = await r.json();
        if (cancelled) return;
        setState({ loading: false, error: null, invoice, items: items || [], payments: payments || [], photos: photos || [] });
        // Fire-and-forget open tracker. Guarded so React StrictMode double
        // mount doesn't double-log; the server also de-dupes by IP/hour.
        if (!trackedRef.current) {
          trackedRef.current = true;
          fetch(api(`/api/track-open?token=${encodeURIComponent(token)}`), { method: 'POST' }).catch(() => {});
        }
      } catch (e) {
        if (!cancelled) setState({ loading: false, error: e.message || 'Error loading', invoice: null, items: [], payments: [], photos: [] });
      }
    })();
    return () => { cancelled = true; };
  }, [token]);

  if (state.loading) return (
    <div style={{ fontFamily: "'Barlow', sans-serif", display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: LIGHT, color: '#888' }}>Loading…</div>
  );
  if (state.error || !state.invoice) return (
    <div style={{ fontFamily: "'Barlow', sans-serif", display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: LIGHT, padding: 24, textAlign: 'center' }}>
      <div style={{ width: 64, height: 64, borderRadius: '50%', background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 12, boxShadow: '0 2px 8px rgba(0,0,0,0.08)' }}>
        <Icon name="invoice" size={28} color="#aaa" />
      </div>
      <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 22, color: NAVY, marginBottom: 6 }}>Link not available</div>
      <div style={{ color: '#888', fontSize: 14, maxWidth: 320 }}>This invoice link is no longer valid. Please contact HI Grade Plumbing for a fresh copy.</div>
      <div style={{ color: '#aaa', fontSize: 12, marginTop: 16 }}>808-393-0015 · higradeplumbing@gmail.com</div>
    </div>
  );

  // Adapt the row + child rows back to the in-app shape so we can reuse PDFPreview.
  const invForm = {
    id: state.invoice.id,
    type: state.invoice.type,
    client: state.invoice.client_name || '',
    date: state.invoice.date,
    dueDate: state.invoice.due_date,
    status: state.invoice.status,
    tax: parseFloat(state.invoice.tax ?? 4.712),
    discount: parseFloat(state.invoice.discount ?? 0),
    discountType: state.invoice.discount_type || '$',
    notes: state.invoice.notes || '',
    clientInfo: state.invoice.client_info || null,
    items: (state.items || []).sort((a, b) => a.sort_order - b.sort_order).map(it => ({
      name: it.name || '',
      desc: it.description ?? it.desc ?? '',
      qty: parseFloat(it.qty ?? 1),
      price: parseFloat(it.price ?? 0),
      unit: it.unit || 'ea',
      discount: parseFloat(it.discount ?? 0),
      discountType: it.discount_type || '%',
      taxable: it.taxable !== false,
    })),
    payments: (state.payments || []).map(p => ({
      id: p.id, amount: parseFloat(p.amount), method: p.method || '', date: p.date, note: p.note || '',
      surcharge: parseFloat(p.surcharge || 0),
    })),
  };
  const totals = calcTotals(invForm);
  const isEstimate = invForm.type === 'estimate';
  const lateFeeInfo = calcLateFee(invForm, totals);
  // Estimates with a down-payment % are payable on the public viewer:
  // the customer pays total * (pct/100) and the estimate auto-converts to
  // an INV#### (server-side). Estimates with pct === 0 stay non-payable.
  const downPaymentPct = Math.max(0, Math.min(100, parseInt(state.invoice.down_payment_pct, 10) || 0));
  const isPayableEstimate = isEstimate && downPaymentPct > 0 && !state.invoice.converted_to_id;
  const downPaymentAmount = isPayableEstimate ? +(totals.total * (downPaymentPct / 100)).toFixed(2) : 0;
  const balance = isEstimate
    ? (isPayableEstimate ? downPaymentAmount : 0)
    : Math.max(0, totals.balance + (lateFeeInfo.fee || 0));
  const paymentInstructionsText = resolvePaymentInstructions();
  const showPay = (!isEstimate && balance > 0) || isPayableEstimate;
  // True when the invoice has fully been paid — used to swap the viewer
  // into receipt mode (green banner up top, payment-history block, no pay
  // card). Estimates and unpaid invoices are unaffected.
  const totalPaid = (invForm.payments || []).reduce((s, p) => s + (Number(p.amount) || 0), 0);
  const isPaidInFull = !isEstimate && totalPaid > 0 && balance <= 0.01;
  // Friendlier date formatter for receipt rows ("May 4, 2026").
  const fmtPaidDate = (s) => {
    if (!s) return '';
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s));
    if (!m) return s;
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return `${months[parseInt(m[2],10)-1]} ${parseInt(m[3],10)}, ${m[1]}`;
  };
  const surcharge = showPay ? calcSurcharge(balance) : { enabled: false, fee: 0, total: balance, pct: 0, flat: 0 };
  const paypalClientId = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_PAYPAL_CLIENT_ID) || '';

  // After a successful PayPal capture, refresh the invoice + payments
  // from /api/public-invoice so the page flips to "Paid in full" (or
  // redirects to the freshly-created INV#### viewer when the capture
  // converted an estimate). The capture endpoint has already inserted
  // the row; we just re-read.
  const refreshAfterPayment = async (captureResult) => {
    // If the capture converted this estimate into an INV####, take the
    // customer to the new invoice's public viewer so they see their
    // receipt + remaining balance for the rest of the job.
    const newToken = captureResult?.convertedViewToken;
    if (newToken && newToken !== token) {
      window.location.assign(`/v/${newToken}`);
      return;
    }
    try {
      const r = await fetch(api(`/api/public-invoice?token=${encodeURIComponent(token)}`));
      if (!r.ok) return;
      const { invoice, items, payments } = await r.json();
      if (!invoice) return;
      setState(s => ({ ...s, invoice, items: items || [], payments: payments || [] }));
    } catch (e) { console.error('refresh after payment failed', e); }
  };

  const isDesktop = vw >= 900;

  const handlePrintPdf = async () => {
    try {
      const mod = await import('./printablePdf.js');
      const photos = invForm.id ? await fetchInvoicePhotos(invForm.id) : [];
      const blob = await mod.buildPrintablePdf(invForm, {
        lateFee: lateFeeInfo,
        paymentInstructions: paymentInstructionsText,
        photos,
      });
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank', 'noopener,noreferrer');
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (err) {
      console.error('PDF generation failed', err);
      alert('Could not generate the PDF. Please try again.');
    }
  };

  if (isDesktop) {
    // ---------- DESKTOP LAYOUT ----------
    // Mirrors the printable PDF: full-bleed navy header, a centered
    // letter-sized white "paper" sheet with orange invoice banner, items
    // table, totals stack, notes, and a navy Mahalo footer. Typography is
    // tuned for big screens (15-16px base, larger headings) so it stays
    // easy to read.
    const payStatus = isEstimate ? (invForm.status || 'pending').toUpperCase() : (balance > 0 ? 'OUTSTANDING' : 'PAID IN FULL');
    const statusColor = isEstimate ? ORANGE : (balance > 0 ? ORANGE : '#2ea66a');
    const ci = invForm.clientInfo || {};
    const fmtDate = (s) => {
      if (!s) return '';
      const d = new Date(s);
      if (isNaN(d)) return s;
      return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}/${d.getFullYear()}`;
    };
    return (
      <div style={{ fontFamily: "'Barlow', sans-serif", background: LIGHT, minHeight: '100vh', paddingBottom: 40 }}>
        {/* Top navy bar */}
        <div style={{ background: NAVY, padding: '22px 32px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ color: ORANGE, fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 24, letterSpacing: 2.5 }}>HI GRADE PLUMBING LLC</div>
            <div style={{ color: '#8899bb', fontSize: 12, letterSpacing: 1.5, marginTop: 3 }}>HONOLULU, HAWAII · LIC PJ-13579 · GET 4.712%</div>
          </div>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            {isEstimate && (
              <a
                href={`/sign?id=${encodeURIComponent(invForm.id)}&client=${encodeURIComponent(invForm.client)}&total=${totals.total.toFixed(2)}&job=${encodeURIComponent(invForm.items[0]?.name || 'Plumbing Work')}`}
                style={{ background: ORANGE, color: '#fff', textDecoration: 'none', fontSize: 16, fontWeight: 700, padding: '12px 24px', borderRadius: 8, whiteSpace: 'nowrap' }}
              >Review &amp; Sign</a>
            )}
            <button
              type="button"
              onClick={handlePrintPdf}
              style={{ background: 'transparent', color: '#fff', border: '1.5px solid #fff', fontSize: 15, fontWeight: 700, padding: '11px 22px', borderRadius: 8, cursor: 'pointer', fontFamily: "'Barlow', sans-serif", whiteSpace: 'nowrap' }}
            >🖨 Print / Save PDF</button>
          </div>
        </div>

        {/* Paid-in-full banner (desktop) — green stripe between the navy
            top bar and the paper sheet, only when the invoice has been paid
            fully. Replaces the pay card visually. */}
        {isPaidInFull && (
          <div style={{ maxWidth: 850, margin: '24px auto 0', background: '#4ecb71', borderRadius: 6, padding: '18px 28px', display: 'flex', alignItems: 'center', gap: 16, boxShadow: '0 4px 24px rgba(0,0,0,0.10)' }}>
            <div style={{ background: 'rgba(255,255,255,0.22)', width: 42, height: 42, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 24, fontWeight: 700, flexShrink: 0 }}>✓</div>
            <div style={{ color: '#fff' }}>
              <div style={{ fontSize: 18, fontWeight: 700, letterSpacing: 0.5 }}>PAID IN FULL</div>
              <div style={{ fontSize: 13, opacity: 0.92, marginTop: 2 }}>Mahalo{invForm.client ? `, ${invForm.client}` : ''} — thank you for your payment</div>
            </div>
          </div>
        )}

        {/* Pay-online card (desktop) — prominent above the paper sheet so the
            customer's first scroll lands on a clear pay action. Hidden on
            estimates with no down-payment % and on already-paid invoices.
            For estimates with a down-payment, this charges the down-payment
            amount and triggers server-side conversion to an INV####. */}
        {showPay && (
          <div style={{ maxWidth: 850, margin: '24px auto 0', background: '#fff', borderRadius: 6, padding: '20px 28px', boxShadow: '0 4px 24px rgba(0,0,0,0.10)' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 24, flexWrap: 'wrap' }}>
              <div style={{ flex: '1 1 260px' }}>
                <div style={{ color: NAVY, fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 18, letterSpacing: 1.5 }}>{isPayableEstimate ? `PAY ${downPaymentPct}% DOWN PAYMENT` : 'PAY ONLINE'}</div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 10, fontSize: 14, color: '#555' }}>
                  <span>{isPayableEstimate ? `Down payment (${downPaymentPct}% of $${totals.total.toFixed(2)})` : 'Balance due'}</span><span>${balance.toFixed(2)}</span>
                </div>
                {surcharge.enabled && surcharge.fee > 0 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4, fontSize: 13, color: '#888' }}>
                    <span>Online payment fee ({surcharge.pct}% + ${surcharge.flat.toFixed(2)})</span>
                    <span>+${surcharge.fee.toFixed(2)}</span>
                  </div>
                )}
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, paddingTop: 8, borderTop: '1px solid #eef0f5', fontSize: 16, fontWeight: 700, color: NAVY }}>
                  <span>Pay total</span><span style={{ color: ORANGE }}>${surcharge.total.toFixed(2)}</span>
                </div>
                {surcharge.enabled && surcharge.fee > 0 && (
                  <div style={{ fontSize: 12, color: '#888', marginTop: 8, lineHeight: 1.5 }}>
                    A {surcharge.pct}% + ${surcharge.flat.toFixed(2)} processing fee is added to online payments (PayPal, card, or Venmo). Pay by check, cash, or Zelle to avoid this fee.
                  </div>
                )}
              </div>
              <div style={{ flex: '1 1 240px', minWidth: 240, maxWidth: 320 }}>
                <PayPalCheckout
                  token={token}
                  invoiceId={invForm.id}
                  balance={surcharge.total}
                  clientId={paypalClientId}
                  onPaid={refreshAfterPayment}
                />
              </div>
            </div>
          </div>
        )}

        {/* Letter-sized paper sheet */}
        <div style={{ maxWidth: 850, margin: '32px auto', background: '#fff', boxShadow: '0 4px 24px rgba(0,0,0,0.10)', borderRadius: 6, overflow: 'hidden' }}>
          {/* Orange/navy invoice banner */}
          <div style={{ background: NAVY, padding: '28px 40px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div style={{ color: '#fff', fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 30, letterSpacing: 2 }}>HI GRADE PLUMBING</div>
              <div style={{ color: ORANGE, fontSize: 12, letterSpacing: 2, marginTop: 4, fontWeight: 600 }}>LLC · HONOLULU, HI</div>
              <div style={{ color: '#8899bb', fontSize: 12, marginTop: 6 }}>License #PJ-13579</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ color: ORANGE, fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 38, letterSpacing: 3 }}>{isEstimate ? 'ESTIMATE' : 'INVOICE'}</div>
              <div style={{ color: '#fff', fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 20, letterSpacing: 1.5, marginTop: 2 }}>{invForm.id}</div>
            </div>
          </div>

          {/* Date / Due / Status sub-strip */}
          <div style={{ background: '#0e2238', padding: '14px 40px', display: 'flex', gap: 40, alignItems: 'center' }}>
            <div>
              <div style={{ color: '#8899bb', fontSize: 10, letterSpacing: 1.5, fontWeight: 700 }}>DATE</div>
              <div style={{ color: '#fff', fontSize: 15, fontWeight: 600, marginTop: 2 }}>{fmtDate(invForm.date)}</div>
            </div>
            {invForm.dueDate && !isEstimate && (
              <div>
                <div style={{ color: '#8899bb', fontSize: 10, letterSpacing: 1.5, fontWeight: 700 }}>DUE</div>
                <div style={{ color: '#fff', fontSize: 15, fontWeight: 600, marginTop: 2 }}>{fmtDate(invForm.dueDate)}</div>
              </div>
            )}
            <div style={{ marginLeft: 'auto', background: statusColor, color: '#fff', fontSize: 11, fontWeight: 700, letterSpacing: 1.5, padding: '6px 14px', borderRadius: 20 }}>{payStatus}</div>
          </div>

          {/* Bill To */}
          <div style={{ padding: '24px 40px 8px', display: 'flex', gap: 40, flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 240px' }}>
              <div style={{ color: '#888', fontSize: 11, letterSpacing: 2, fontWeight: 700 }}>BILL TO</div>
              <div style={{ color: NAVY, fontSize: 18, fontWeight: 700, marginTop: 4 }}>{invForm.client || '—'}</div>
              {(ci.address || ci.city || ci.state || ci.zip) && (
                <div style={{ color: '#555', fontSize: 14, marginTop: 4 }}>
                  {[ci.address, [ci.city, ci.state].filter(Boolean).join(', '), ci.zip].filter(Boolean).join(' · ')}
                </div>
              )}
              {(ci.phone || ci.email) && (
                <div style={{ color: '#555', fontSize: 14, marginTop: 2 }}>
                  {[ci.phone, ci.email].filter(Boolean).join('  ·  ')}
                </div>
              )}
            </div>
            {(() => {
              const ja = invForm.jobAddress || null;
              if (!ja) return null;
              const jobLines = [ja.line1, ja.line2, ja.line3].filter(Boolean);
              if (!jobLines.length && !ja.label) return null;
              return (
                <div style={{ flex: '1 1 240px' }}>
                  <div style={{ color: '#888', fontSize: 11, letterSpacing: 2, fontWeight: 700 }}>JOB SITE</div>
                  {ja.label && (
                    <div style={{ color: NAVY, fontSize: 16, fontWeight: 700, marginTop: 4 }}>{ja.label}</div>
                  )}
                  {jobLines.length > 0 && (
                    <div style={{ color: '#555', fontSize: 14, marginTop: 4, lineHeight: 1.5 }}>
                      {jobLines.map((l, i) => <div key={i}>{l}</div>)}
                    </div>
                  )}
                </div>
              );
            })()}
          </div>

          {/* Items table */}
          <div style={{ padding: '16px 40px 8px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px 120px', padding: '10px 0', borderBottom: `2px solid ${NAVY}`, color: '#888', fontSize: 11, letterSpacing: 1.5, fontWeight: 700 }}>
              <div>DESCRIPTION</div>
              <div style={{ textAlign: 'center' }}>QTY</div>
              <div style={{ textAlign: 'right' }}>AMOUNT</div>
            </div>
            {invForm.items.map((it, idx) => {
              const lineSubtotal = (parseFloat(it.qty) || 0) * (parseFloat(it.price) || 0);
              const disc = parseFloat(it.discount) || 0;
              const lineDisc = it.discountType === '%' ? lineSubtotal * (disc / 100) : disc;
              const lineTotal = Math.max(0, lineSubtotal - lineDisc);
              return (
                <div key={idx} style={{ display: 'grid', gridTemplateColumns: '1fr 80px 120px', padding: '14px 0', borderBottom: '1px solid #eef0f5', background: idx % 2 ? '#fafbfd' : '#fff' }}>
                  <div>
                    <div style={{ color: NAVY, fontSize: 15, fontWeight: 700 }}>{it.name || '—'}</div>
                    {it.desc && (
                      <div style={{ color: '#888', fontSize: 13, marginTop: 4, whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{it.desc}</div>
                    )}
                  </div>
                  <div style={{ textAlign: 'center', color: '#555', fontSize: 14, fontWeight: 600 }}>{it.qty}</div>
                  <div style={{ textAlign: 'right', color: NAVY, fontSize: 15, fontWeight: 700 }}>${lineTotal.toFixed(2)}</div>
                </div>
              );
            })}
          </div>

          {/* Totals stack */}
          <div style={{ padding: '16px 40px 24px', display: 'flex', justifyContent: 'flex-end' }}>
            <div style={{ minWidth: 280 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', color: '#555', fontSize: 14 }}>
                <span>Subtotal</span>
                <span>${totals.sub.toFixed(2)}</span>
              </div>
              {totals.disc > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', color: '#555', fontSize: 14 }}>
                  <span>Discount</span>
                  <span>-${totals.disc.toFixed(2)}</span>
                </div>
              )}
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', color: '#555', fontSize: 14 }}>
                <span>GET ({(invForm.tax || 0).toFixed(3)}%)</span>
                <span>${totals.taxAmt.toFixed(2)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 0', borderTop: `2px solid ${NAVY}`, marginTop: 6, color: NAVY, fontSize: 18, fontWeight: 700, fontFamily: "'Barlow Condensed', sans-serif", letterSpacing: 1 }}>
                <span>TOTAL</span>
                <span>${totals.total.toFixed(2)}</span>
              </div>
              {!isEstimate && (() => {
                const surchargeSum = (invForm.payments || []).reduce((s, p) => s + (parseFloat(p.surcharge) || 0), 0);
                return (
                  <>
                    {surchargeSum > 0 && (
                      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', color: '#666', fontSize: 14 }}>
                        <span>Processing fee</span>
                        <span>+${surchargeSum.toFixed(2)}</span>
                      </div>
                    )}
                    {totals.paid > 0 && (
                      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', color: '#2ea66a', fontSize: 14, fontWeight: 600 }}>
                        <span>Paid</span>
                        <span>-${(totals.paid + surchargeSum).toFixed(2)}</span>
                      </div>
                    )}
                  </>
                );
              })()}
              {!isEstimate && lateFeeInfo.fee > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', color: ORANGE, fontSize: 14, fontWeight: 600 }}>
                  <span>Late fee ({lateFeeInfo.months}× {lateFeeInfo.rate}%)</span>
                  <span>+${lateFeeInfo.fee.toFixed(2)}</span>
                </div>
              )}
              {!isEstimate && (totals.paid > 0 || lateFeeInfo.fee > 0) && (
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderTop: '1px solid #eef0f5', color: balance > 0 ? ORANGE : '#2ea66a', fontSize: 17, fontWeight: 700, fontFamily: "'Barlow Condensed', sans-serif", letterSpacing: 1 }}>
                  <span>{balance > 0 ? 'BALANCE DUE' : 'PAID IN FULL'}</span>
                  <span>${balance.toFixed(2)}</span>
                </div>
              )}
            </div>
          </div>

          {/* Notes */}
          {invForm.notes && (
            <div style={{ padding: '8px 40px 16px' }}>
              <div style={{ color: '#888', fontSize: 11, letterSpacing: 2, fontWeight: 700, marginBottom: 6 }}>NOTES</div>
              <div style={{ color: '#555', fontSize: 14, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{invForm.notes}</div>
            </div>
          )}

          {/* Payment History (desktop) — only on fully-paid invoices.
              Renders one row per recorded payment with method, date, and
              amount so the customer has a clear receipt. */}
          {isPaidInFull && (invForm.payments || []).length > 0 && (
            <div style={{ padding: '8px 40px 24px', borderTop: '1px solid #eef0f5', marginTop: 8 }}>
              <div style={{ color: NAVY, fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 16, letterSpacing: 1.5, marginBottom: 10, marginTop: 12 }}>PAYMENT HISTORY</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {(invForm.payments || []).slice().sort((a, b) => String(a.date || '').localeCompare(String(b.date || ''))).map((p, i) => (
                  <div key={p.id || i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', background: '#f4f9f5', border: '1px solid #d8ebde', borderRadius: 6, fontSize: 14 }}>
                    <div style={{ color: NAVY, fontWeight: 600 }}>
                      {(p.method || 'Payment')}
                      <span style={{ color: '#888', fontWeight: 500, marginLeft: 8 }}>{fmtPaidDate(p.date)}</span>
                    </div>
                    <div style={{ color: '#2ea66a', fontWeight: 700 }}>${(Number(p.amount) || 0).toFixed(2)}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Payment Instructions — hidden on fully-paid invoices since
              there's no balance left to collect. */}
          {!isPaidInFull && paymentInstructionsText && (
            <div style={{ padding: '8px 40px 24px', borderTop: '1px solid #eef0f5', marginTop: 8 }}>
              <div style={{ color: NAVY, fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 16, letterSpacing: 1.5, marginBottom: 8, marginTop: 12 }}>PAYMENT INSTRUCTIONS</div>
              <div style={{ color: '#555', fontSize: 13, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{paymentInstructionsText}</div>
            </div>
          )}

          {/* Navy Mahalo footer */}
          <div style={{ background: NAVY, padding: '24px 40px', textAlign: 'center' }}>
            <div style={{ color: ORANGE, fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 20, letterSpacing: 2 }}>MAHALO FOR YOUR BUSINESS</div>
            <div style={{ color: '#8899bb', fontSize: 13, marginTop: 8, lineHeight: 1.6 }}>
              {isEstimate
                ? 'Click Review & Sign above to approve this estimate.'
                : (balance > 0 ? 'Pay online with the button above, or by check, Venmo, or Zelle.' : 'This invoice has been paid in full. Mahalo!')}
            </div>
            <div style={{ color: '#fff', fontSize: 13, marginTop: 12 }}>808-393-0015 · higradeplumbing@gmail.com</div>
          </div>
        </div>
      </div>
    );
  }

  // ---------- MOBILE LAYOUT (unchanged) ----------
  return (
    <div style={{ fontFamily: "'Barlow', sans-serif", background: LIGHT, minHeight: '100vh' }}>
      <div style={{ background: NAVY, padding: '18px 20px', textAlign: 'center' }}>
        <div style={{ color: ORANGE, fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 19, letterSpacing: 2 }}>HI GRADE PLUMBING LLC</div>
        <div style={{ color: '#8899bb', fontSize: 11, letterSpacing: 1, marginTop: 2 }}>HONOLULU, HAWAII · LIC PJ-13579</div>
      </div>
      <div style={{ maxWidth: 480, margin: '0 auto', padding: '20px 0 24px' }}>
        {/* Paid-in-full banner (mobile) — mirrors the desktop green stripe.
            Sits above the top summary card so the receipt state is the
            first thing the customer sees on their phone. */}
        {isPaidInFull && (
          <div style={{ margin: '0 12px 16px', background: '#4ecb71', borderRadius: 10, padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12, boxShadow: '0 2px 12px rgba(0,0,0,0.08)' }}>
            <div style={{ background: 'rgba(255,255,255,0.22)', width: 36, height: 36, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 20, fontWeight: 700, flexShrink: 0 }}>✓</div>
            <div style={{ color: '#fff' }}>
              <div style={{ fontSize: 15, fontWeight: 700, letterSpacing: 0.5 }}>PAID IN FULL</div>
              <div style={{ fontSize: 12, opacity: 0.92, marginTop: 1 }}>Mahalo{invForm.client ? `, ${invForm.client}` : ''} — thank you</div>
            </div>
          </div>
        )}
        {/* Top summary card */}
        <div style={{ background: '#fff', margin: '0 12px 16px', borderRadius: 12, padding: '20px 18px', boxShadow: '0 2px 12px rgba(0,0,0,0.08)', textAlign: 'center' }}>
          <div style={{ color: '#888', fontSize: 11, letterSpacing: 1.5, fontWeight: 700, textTransform: 'uppercase', fontFamily: "'Barlow Condensed', sans-serif" }}>{isEstimate ? `Estimate ${invForm.id}` : `Invoice ${invForm.id}`}</div>
          <div style={{ color: NAVY, fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 38, letterSpacing: 1, lineHeight: 1.1, marginTop: 8 }}>${(isPayableEstimate ? downPaymentAmount : balance).toFixed(2)}</div>
          <div style={{ color: '#888', fontSize: 12, marginTop: 4 }}>{isPayableEstimate ? `${downPaymentPct}% down payment due` : (isEstimate ? 'Estimate total' : (balance > 0 ? 'Balance due' : 'Paid in full'))}</div>
          {!isEstimate && lateFeeInfo.fee > 0 && (
            <div style={{ color: ORANGE, fontSize: 12, marginTop: 4, fontWeight: 600 }}>Includes ${lateFeeInfo.fee.toFixed(2)} late fee ({lateFeeInfo.months}× {lateFeeInfo.rate}%)</div>
          )}
          {isPayableEstimate && (
            <div style={{ color: '#666', fontSize: 12, marginTop: 6 }}>Estimate total: ${balance.toFixed(2)}</div>
          )}
          {showPay && (
            <div style={{ marginTop: 16, textAlign: 'left' }}>
              {isPayableEstimate && (
                <div style={{ color: ORANGE, fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 15, letterSpacing: 1.5, textAlign: 'center', marginBottom: 10, textTransform: 'uppercase' }}>
                  Pay {downPaymentPct}% Down Payment
                </div>
              )}
              {surcharge.enabled && surcharge.fee > 0 && (
                <div style={{ background: '#f4f6fa', borderRadius: 8, padding: '10px 12px', marginBottom: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: '#555' }}>
                    <span>{isPayableEstimate ? 'Down payment due' : 'Balance due'}</span><span>${(isPayableEstimate ? downPaymentAmount : balance).toFixed(2)}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 3, fontSize: 12, color: '#888' }}>
                    <span>Online fee ({surcharge.pct}% + ${surcharge.flat.toFixed(2)})</span><span>+${surcharge.fee.toFixed(2)}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, paddingTop: 6, borderTop: '1px solid #dde2ee', fontSize: 14, fontWeight: 700, color: NAVY }}>
                    <span>Pay total</span><span style={{ color: ORANGE }}>${surcharge.total.toFixed(2)}</span>
                  </div>
                </div>
              )}
              <PayPalCheckout
                token={token}
                invoiceId={invForm.id}
                balance={surcharge.total}
                clientId={paypalClientId}
                onPaid={refreshAfterPayment}
              />
              {surcharge.enabled && surcharge.fee > 0 && (
                <div style={{ fontSize: 11, color: '#888', textAlign: 'center', marginTop: 8, lineHeight: 1.5 }}>
                  Pay by check, cash, or Zelle to avoid the {surcharge.pct}% + ${surcharge.flat.toFixed(2)} online processing fee.
                </div>
              )}
            </div>
          )}
          {isEstimate && !isPayableEstimate && (
            <a href={`/sign?id=${encodeURIComponent(invForm.id)}&client=${encodeURIComponent(invForm.client)}&total=${totals.total.toFixed(2)}&job=${encodeURIComponent(invForm.items[0]?.name || 'Plumbing Work')}`} style={{ display: 'inline-block', marginTop: 16, background: ORANGE, color: '#fff', textDecoration: 'none', fontSize: 15, fontWeight: 700, padding: '13px 30px', borderRadius: 8 }}>
              Review &amp; Sign
            </a>
          )}
          {/* Print / Save PDF — lazy-loads jsPDF and opens the printable letter-sized PDF in a new tab */}
          <div style={{ marginTop: 14 }}>
            <button
              type="button"
              onClick={handlePrintPdf}
              style={{ display: 'inline-block', background: '#fff', color: NAVY, border: `1.5px solid ${NAVY}`, fontSize: 14, fontWeight: 700, padding: '10px 22px', borderRadius: 8, cursor: 'pointer', fontFamily: "'Barlow', sans-serif" }}
            >
              🖨 Print / Save PDF
            </button>
          </div>
        </div>
        {/* Payment History (mobile) — only on fully-paid invoices. */}
        {isPaidInFull && (invForm.payments || []).length > 0 && (
          <div style={{ background: '#fff', margin: '0 12px 16px', borderRadius: 12, padding: '16px 16px', boxShadow: '0 2px 12px rgba(0,0,0,0.08)' }}>
            <div style={{ color: NAVY, fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 14, letterSpacing: 1.5, marginBottom: 10 }}>PAYMENT HISTORY</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {(invForm.payments || []).slice().sort((a, b) => String(a.date || '').localeCompare(String(b.date || ''))).map((p, i) => (
                <div key={p.id || i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 12px', background: '#f4f9f5', border: '1px solid #d8ebde', borderRadius: 6, fontSize: 13 }}>
                  <div style={{ color: NAVY, fontWeight: 600, minWidth: 0, flex: 1 }}>
                    <div>{p.method || 'Payment'}</div>
                    <div style={{ color: '#888', fontWeight: 500, fontSize: 12, marginTop: 2 }}>{fmtPaidDate(p.date)}</div>
                  </div>
                  <div style={{ color: '#2ea66a', fontWeight: 700, marginLeft: 12 }}>${(Number(p.amount) || 0).toFixed(2)}</div>
                </div>
              ))}
            </div>
          </div>
        )}
        {/* Reuse the in-app PDF preview for full details */}
        <PDFPreview form={invForm} clients={[]} photos={state.photos || []} />
        {/* Footer */}
        <div style={{ textAlign: 'center', color: '#aaa', fontSize: 12, padding: '20px 16px 0' }}>
          Questions? Call or text 808-393-0015<br />higradeplumbing@gmail.com
        </div>
      </div>
    </div>
  );
}

// ─── Sign Page (remote signing) ───────────────────────────────────────────────
function SignaturePage() {
  const params = new URLSearchParams(window.location.search);
  const estimateId = params.get("id") || "EST";
  const clientName = params.get("client") || "Client";
  const total = params.get("total") || "0.00";
  const job = params.get("job") || "Plumbing Work";

  const canvasRef = useRef(null);
  const [drawing, setDrawing] = useState(false);
  const [isEmpty, setIsEmpty] = useState(true);
  const [status, setStatus] = useState("idle");

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = "#0a1628";
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
  }, []);

  const getPos = (e) => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const src = e.touches?.[0] || e;
    return { x: (src.clientX - rect.left) * (canvas.width / rect.width), y: (src.clientY - rect.top) * (canvas.height / rect.height) };
  };

  const startDraw = (e) => { e.preventDefault(); const ctx = canvasRef.current.getContext("2d"); const p = getPos(e); ctx.beginPath(); ctx.moveTo(p.x, p.y); setDrawing(true); setIsEmpty(false); };
  const draw = (e) => { if (!drawing) return; e.preventDefault(); const ctx = canvasRef.current.getContext("2d"); const p = getPos(e); ctx.lineTo(p.x, p.y); ctx.stroke(); };
  const endDraw = (e) => { e.preventDefault(); setDrawing(false); };

  const clear = () => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    setIsEmpty(true);
  };

  const submit = async () => {
    if (isEmpty) return;
    setStatus("submitting");
    try {
      const sig = canvasRef.current.toDataURL("image/png");
      const res = await fetch(api("/api/submit-signature"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ estimateId, clientName, total, job, signatureData: sig, signedAt: new Date().toISOString() }),
      });
      const d = await res.json();
      if (d.ok) setStatus("done");
      else throw new Error("server error");
    } catch { setStatus("error"); }
  };

  if (status === "done") return (
    <div style={{ fontFamily: "'Barlow', sans-serif", display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh", background: LIGHT, textAlign: "center", padding: 24 }}>
      <div>
        <div style={{ width: 72, height: 72, background: "#e8f8ef", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px", fontSize: 32 }}>✓</div>
        <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 26, color: NAVY, marginBottom: 8 }}>Estimate Approved!</div>
        <div style={{ color: "#888", fontSize: 14 }}>Thank you, {clientName}. Jake will be in touch to schedule your job.</div>
      </div>
    </div>
  );

  return (
    <div style={{ fontFamily: "'Barlow', sans-serif", background: "#fff", minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      <div style={{ background: NAVY, padding: "16px 20px" }}>
        <div style={{ color: "#fff", fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 18, letterSpacing: 1.5 }}>HI GRADE PLUMBING LLC</div>
        <div style={{ color: ORANGE, fontSize: 10, letterSpacing: 3, fontWeight: 600, textTransform: "uppercase" }}>Estimate Approval</div>
      </div>
      <div style={{ padding: 20, flex: 1, display: "flex", flexDirection: "column", gap: 16, maxWidth: 480, margin: "0 auto", width: "100%" }}>
        <div style={{ background: LIGHT, borderRadius: 10, padding: 16 }}>
          <div style={{ fontSize: 11, color: "#8899bb", textTransform: "uppercase", letterSpacing: 1, fontFamily: "'Barlow Condensed', sans-serif", marginBottom: 6 }}>Estimate Details</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            {[["Estimate #", estimateId], ["Client", clientName], ["Job", job], ["Total", "$" + total]].map(([l, v]) => (
              <div key={l}>
                <div style={{ fontSize: 10, color: "#aaa", textTransform: "uppercase", letterSpacing: 0.5 }}>{l}</div>
                <div style={{ fontSize: 14, fontWeight: 600, color: l === "Total" ? ORANGE : "#222" }}>{v}</div>
              </div>
            ))}
          </div>
        </div>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: "#333", marginBottom: 8 }}>Your Signature</div>
          <canvas
            ref={canvasRef}
            width={600}
            height={200}
            style={{ width: "100%", height: 180, border: "2px solid #dde2ee", borderRadius: 10, touchAction: "none", background: "#fff", cursor: "crosshair", display: "block" }}
            onMouseDown={startDraw}
            onMouseMove={draw}
            onMouseUp={endDraw}
            onMouseLeave={endDraw}
            onTouchStart={startDraw}
            onTouchMove={draw}
            onTouchEnd={endDraw}
          />
          <div style={{ textAlign: "center", color: "#bbb", fontSize: 11, marginTop: 4 }}>× Sign above</div>
        </div>
        {status === "error" && <div style={{ background: "#fff0f0", color: "#cc4444", padding: 10, borderRadius: 8, fontSize: 13, textAlign: "center" }}>Something went wrong. Please try again.</div>}
        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={clear} style={{ ...S.btn("ghost"), flex: 1 }}>Clear</button>
          <button onClick={submit} disabled={isEmpty || status === "submitting"} style={{ ...S.btn(isEmpty || status === "submitting" ? "ghost" : "primary"), flex: 2, opacity: isEmpty ? 0.5 : 1 }}>
            {status === "submitting" ? "Submitting…" : "Approve Estimate"}
          </button>
        </div>
        <div style={{ fontSize: 11, color: "#bbb", textAlign: "center" }}>By approving, you agree to the scope of work described in estimate {estimateId}.</div>
      </div>
    </div>
  );
}

// ─── Expense Modal ────────────────────────────────────────────────────────────
function ExpenseModal({ expense, onClose, onSave }) {
  const [form, setForm] = useState(expense || { date: today(), merchant: "", amount: "", category: "Supplies & Materials", description: "", receiptData: null });
  const [scanning, setScanning] = useState(false);
  const fileRef = useRef(null);

  const handleFile = (file) => {
    if (!file) return;
    setScanning(true);
    const reader = new FileReader();
    reader.onload = async (e) => {
      const base64 = e.target.result.split(",")[1];
      try {
        const res = await fetch(api("/api/extract-receipt"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ imageData: base64, mediaType: file.type || "image/jpeg" }),
        });
        const data = await res.json();
        setForm(f => ({
          ...f,
          merchant: data.merchant || f.merchant,
          date: data.date || f.date,
          amount: data.total != null ? String(data.total) : f.amount,
          category: data.category || f.category,
          description: data.description || f.description,
          receiptData: e.target.result,
        }));
      } catch {}
      setScanning(false);
    };
    reader.readAsDataURL(file);
  };

  const save = () => {
    if (!form.amount || !form.merchant) { alert("Enter merchant and amount."); return; }
    onSave({ ...form, amount: parseFloat(form.amount) || 0, id: form.id || Date.now() });
  };

  const isHalf = form.category === "Meals & Entertainment";

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 9000, display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
      <div style={{ background: "#fff", borderRadius: "16px 16px 0 0", width: "100%", maxWidth: 480, maxHeight: "90vh", overflowY: "auto", paddingBottom: 40 }}>
        <div style={{ background: NAVY, padding: "14px 16px", borderRadius: "16px 16px 0 0", display: "flex", alignItems: "center", justifyContent: "space-between", position: "sticky", top: 0 }}>
          <span style={{ color: "#fff", fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 16 }}>{expense ? "Edit Expense" : "New Expense"}</span>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "#8899bb", cursor: "pointer", fontSize: 22, lineHeight: 1 }}>✕</button>
        </div>
        <div style={{ padding: 16 }}>
          <input ref={fileRef} type="file" accept="image/*" capture="environment" style={{ display: "none" }} onChange={e => handleFile(e.target.files[0])} />
          <div style={{ display: "flex", gap: 10, marginBottom: 16, alignItems: "center" }}>
            <button onClick={() => fileRef.current?.click()} disabled={scanning} style={{ ...S.btn("navy"), flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 7 }}>
              <Icon name="camera" size={16} color="#fff" />{scanning ? "Scanning AI…" : "Scan Receipt"}
            </button>
            {form.receiptData && <img src={form.receiptData} style={{ width: 52, height: 52, objectFit: "cover", borderRadius: 8, border: "1px solid #eee", flexShrink: 0 }} alt="Receipt" />}
          </div>
          <div style={{ marginBottom: 12 }}>
            <label style={S.label}>Merchant / Store</label>
            <input style={S.input} value={form.merchant} onChange={e => setForm(f => ({ ...f, merchant: e.target.value }))} placeholder="Store or vendor name" />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
            <div><label style={S.label}>Date</label><input type="date" style={S.input} value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} /></div>
            <div><label style={S.label}>Amount $</label><input type="number" style={S.input} value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} onFocus={selectOnFocus} step="0.01" min="0" placeholder="0.00" /></div>
          </div>
          <div style={{ marginBottom: 12 }}>
            <label style={S.label}>Category</label>
            <select style={S.input} value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}>
              {EXPENSE_CATEGORIES.map(c => <option key={c} value={c}>{c}{c === "Meals & Entertainment" ? " (50% deductible)" : ""}</option>)}
            </select>
            {isHalf && <div style={{ fontSize: 11, color: "#f39c12", marginTop: 4 }}>⚠ Meals & Entertainment: only 50% is tax deductible</div>}
          </div>
          <div style={{ marginBottom: 16 }}>
            <label style={S.label}>Description</label>
            <input style={S.input} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="What was this for?" />
          </div>
          <button onClick={save} style={{ ...S.btn("primary"), width: "100%", fontSize: 16, padding: 14 }}>Save Expense</button>
        </div>
      </div>
    </div>
  );
}

// ─── Expenses Tab ─────────────────────────────────────────────────────────────
function ExpensesTab({ expenses, onSave, onDelete, newToken }) {
  const [showModal, setShowModal] = useState(false);
  const [editExp, setEditExp] = useState(null);
  // Header "+" button bumps newToken, which we treat as a request to open
  // the expense entry modal. We skip the initial mount value so the modal
  // doesn't auto-open on first render.
  const firstRunRef = useRef(true);
  useEffect(() => {
    if (firstRunRef.current) { firstRunRef.current = false; return; }
    setEditExp(null);
    setShowModal(true);
  }, [newToken]);

  const sorted = [...expenses].sort((a, b) => (b.date > a.date ? 1 : -1));
  const total = expenses.reduce((s, e) => s + (e.amount || 0), 0);
  const deductible = expenses.reduce((s, e) => s + (e.category === "Meals & Entertainment" ? (e.amount || 0) * 0.5 : (e.amount || 0)), 0);

  const exportCSV = () => {
    const rows = [["Date", "Merchant", "Amount", "Category", "Description", "Deductible"]];
    expenses.forEach(e => {
      const ded = e.category === "Meals & Entertainment" ? (e.amount * 0.5).toFixed(2) : (e.amount || 0).toFixed(2);
      rows.push([e.date, e.merchant, (e.amount || 0).toFixed(2), e.category, e.description || "", ded]);
    });
    const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "higrade-expenses.csv"; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      {showModal && (
        <ExpenseModal
          expense={editExp}
          onClose={() => { setShowModal(false); setEditExp(null); }}
          onSave={exp => { onSave(exp); setShowModal(false); setEditExp(null); }}
        />
      )}
      <div style={{ background: NAVY2, padding: "12px 16px" }}>
        <div style={{ color: "#8899bb", fontSize: 11, letterSpacing: 1, fontFamily: "'Barlow Condensed', sans-serif", textTransform: "uppercase" }}>Business Expenses</div>
        <div style={{ color: "#cc4444", fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 24 }}>{fmt(total)}</div>
        <div style={{ color: "#8899bb", fontSize: 11, marginTop: 1 }}>{fmt(deductible)} deductible · {expenses.length} receipt{expenses.length !== 1 ? "s" : ""}</div>
      </div>
      {expenses.length > 0 && (
        <div style={{ padding: "10px 12px 0", display: "flex", justifyContent: "flex-end" }}>
          <button onClick={exportCSV} style={{ ...S.btn("ghost"), fontSize: 12, padding: "7px 14px", display: "flex", alignItems: "center", gap: 5 }}>
            <Icon name="arrowDown" size={13} color="#444" /> Export CSV
          </button>
        </div>
      )}
      <div style={{ padding: "8px 12px 0" }}>
        {sorted.length === 0 ? (
          <div style={{ padding: "48px 24px", textAlign: "center" }}>
            <Icon name="receipt" size={48} color="#dde2ee" />
            <div style={{ fontSize: 16, fontWeight: 600, color: "#888", marginTop: 16, marginBottom: 8 }}>No Expenses Yet</div>
            <div style={{ fontSize: 13, color: "#aaa", marginBottom: 24 }}>Tap + to add or scan a receipt with AI</div>
          </div>
        ) : sorted.map(exp => {
          const isHalf = exp.category === "Meals & Entertainment";
          return (
            <div key={exp.id} onClick={() => { setEditExp(exp); setShowModal(true); }} style={{ ...S.card, padding: "12px 14px", cursor: "pointer", display: "flex", alignItems: "center", gap: 12 }}>
              {exp.receiptData
                ? <img src={exp.receiptData} style={{ width: 42, height: 42, objectFit: "cover", borderRadius: 8, border: "1px solid #eee", flexShrink: 0 }} alt="" />
                : <div style={{ width: 42, height: 42, borderRadius: 8, background: "#f4f6fa", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><Icon name="receipt" size={18} color="#ccc" /></div>}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{exp.merchant || "Unknown"}</div>
                <div style={{ fontSize: 11, color: "#888", marginTop: 1 }}>{exp.date} · {exp.category}</div>
                {isHalf && <div style={{ fontSize: 10, color: "#f39c12", marginTop: 1 }}>50% deductible</div>}
              </div>
              <div style={{ textAlign: "right", flexShrink: 0 }}>
                <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 16, color: "#cc4444" }}>{fmt(exp.amount || 0)}</div>
                <button onClick={e => { e.stopPropagation(); if (confirm("Delete this expense?")) onDelete(exp.id); }} style={{ background: "none", border: "none", cursor: "pointer", padding: "3px 0", marginTop: 2 }}>
                  <Icon name="trash" size={13} color="#cc4444" />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Reports Tab ──────────────────────────────────────────────────────────────
function ReportsTab({ invoices, expenses }) {
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth();
  const [selYear, setSelYear] = useState(currentYear);
  const todayStr = today();
  const YEARS = [2024, 2025, 2026, 2027];
  const MONTHS_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

  const yearStart = `${selYear}-01-01`;
  const yearEnd = selYear === currentYear ? todayStr : `${selYear}-12-31`;
  const mtdStart = `${selYear}-${String(currentMonth+1).padStart(2,"0")}-01`;
  const mtdEnd = selYear === currentYear ? todayStr : `${selYear}-${String(currentMonth+1).padStart(2,"0")}-${String(new Date(selYear, currentMonth+1, 0).getDate()).padStart(2,"0")}`;

  const sumPayments = (filterFn) => invoices.reduce((s, inv) => {
    if (inv.type === "estimate") return s;
    return s + (inv.payments||[]).filter(filterFn).reduce((x, p) => x + p.amount, 0);
  }, 0);

  const mtdCollected = sumPayments(p => p.date >= mtdStart && p.date <= mtdEnd);
  const ytdCollected = sumPayments(p => p.date >= yearStart && p.date <= yearEnd);

  const outstanding = invoices.filter(i => i.type !== "estimate" && (i.status === "outstanding" || i.status === "partial"))
    .reduce((s, i) => s + Math.max(0, calcTotals(i).balance), 0);
  const overdue = invoices.filter(i => i.type !== "estimate" && (i.status === "outstanding" || i.status === "partial") && i.dueDate < todayStr)
    .reduce((s, i) => s + Math.max(0, calcTotals(i).balance), 0);

  const paidInYear = invoices.filter(i => i.type !== "estimate" && i.status === "paid" && i.date >= yearStart && i.date <= yearEnd);
  const avgJobValue = paidInYear.length > 0 ? paidInYear.reduce((s, i) => s + calcTotals(i).total, 0) / paidInYear.length : 0;

  const monthInvoiceCount = invoices.filter(i => i.type !== "estimate" && i.date >= mtdStart && i.date <= mtdEnd).length;

  const qStartMonth = Math.floor(currentMonth / 3) * 3;
  const currentQuarter = Math.floor(currentMonth / 3) + 1;
  const qStart = `${selYear}-${String(qStartMonth+1).padStart(2,"0")}-01`;
  const qEnd = selYear === currentYear ? todayStr : `${selYear}-${String(qStartMonth+3).padStart(2,"0")}-${String(new Date(selYear, qStartMonth+3, 0).getDate()).padStart(2,"0")}`;
  const getOwed = invoices.filter(i => i.type !== "estimate" && i.status === "paid" && i.date >= qStart && i.date <= qEnd)
    .reduce((s, i) => s + calcTotals(i).taxAmt, 0);

  const monthlyRevenue = Array(12).fill(0);
  invoices.forEach(inv => {
    if (inv.type === "estimate") return;
    (inv.payments||[]).forEach(p => {
      if (p.date?.startsWith(String(selYear))) {
        const m = parseInt(p.date.slice(5,7)) - 1;
        if (m >= 0 && m < 12) monthlyRevenue[m] += p.amount;
      }
    });
  });
  const maxMonthly = Math.max(...monthlyRevenue, 1);

  const clientData = {};
  invoices.forEach(inv => {
    if (inv.type === "estimate") return;
    (inv.payments||[]).forEach(p => {
      if (p.date >= yearStart && p.date <= yearEnd) {
        const c = inv.client || "Unknown";
        if (!clientData[c]) clientData[c] = { jobs: new Set(), total: 0 };
        clientData[c].jobs.add(inv.id);
        clientData[c].total += p.amount;
      }
    });
  });
  const topClients = Object.entries(clientData).map(([n,d]) => ({ name: n, jobs: d.jobs.size, total: d.total })).sort((a,b) => b.total-a.total).slice(0, 5);

  const methodColors = { Cash: "#27ae60", Check: "#2980b9", Venmo: "#3D95CE", Zelle: "#6B39A8", PayPal: "#0070ba", "Credit Card": ORANGE, "Bank Transfer": "#16a085", Other: "#888" };
  const methodTotals = {};
  invoices.forEach(inv => {
    if (inv.type === "estimate") return;
    (inv.payments||[]).forEach(p => {
      if (p.date >= yearStart && p.date <= yearEnd) { const m = p.method || "Other"; methodTotals[m] = (methodTotals[m]||0) + p.amount; }
    });
  });
  const methodEntries = Object.entries(methodTotals).sort((a,b) => b[1]-a[1]);

  const yearExpenses = (expenses||[]).filter(e => e.date >= yearStart && e.date <= yearEnd);
  const totalExpenses = yearExpenses.reduce((s, e) => s + (e.amount||0), 0);
  const totalDeductible = yearExpenses.reduce((s, e) => s + (e.category === "Meals & Entertainment" ? (e.amount||0)*0.5 : (e.amount||0)), 0);
  const expByCategory = {};
  yearExpenses.forEach(e => {
    const cat = e.category || "Other";
    if (!expByCategory[cat]) expByCategory[cat] = { total: 0, deductible: 0 };
    expByCategory[cat].total += e.amount || 0;
    expByCategory[cat].deductible += cat === "Meals & Entertainment" ? (e.amount||0)*0.5 : (e.amount||0);
  });

  const kpi = (label, value, color = ORANGE, note = null) => (
    <div style={{ background: "#fff", borderRadius: 12, padding: "10px 8px", boxShadow: "0 1px 6px rgba(0,0,0,0.07)", flex: 1, minWidth: 0 }}>
      <div style={{ fontSize: 8, fontWeight: 700, color: "#8899bb", letterSpacing: 0.7, textTransform: "uppercase", fontFamily: "'Barlow Condensed', sans-serif", marginBottom: 3, lineHeight: 1.2 }}>{label}</div>
      <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 16, color, lineHeight: 1 }}>{value}</div>
      {note && <div style={{ fontSize: 8, color: "#aaa", marginTop: 2, lineHeight: 1.2 }}>{note}</div>}
    </div>
  );

  return (
    <div style={{ paddingBottom: 20 }}>
      <div style={{ background: NAVY2, padding: "12px 16px" }}>
        <div style={{ color: "#8899bb", fontSize: 11, letterSpacing: 1, fontFamily: "'Barlow Condensed', sans-serif", textTransform: "uppercase" }}>Financial Reports</div>
        <div style={{ color: "#4ecb71", fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 24 }}>{fmt(ytdCollected)}</div>
        <div style={{ color: "#8899bb", fontSize: 11, marginTop: 1 }}>collected YTD · {selYear}</div>
      </div>
      <div style={{ padding: "12px 12px 0" }}>
        <div style={{ display: "flex", background: "#fff", borderRadius: 10, overflow: "hidden", boxShadow: "0 1px 4px rgba(0,0,0,0.07)" }}>
          {YEARS.map(yr => (
            <button key={yr} onClick={() => setSelYear(yr)} style={{ flex: 1, padding: "11px 0", background: selYear === yr ? NAVY : "transparent", color: selYear === yr ? "#fff" : "#888", border: "none", fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 14, cursor: "pointer", transition: "background 0.15s" }}>{yr}</button>
          ))}
        </div>
      </div>
      <div style={{ padding: "12px 12px 0", display: "flex", gap: 6 }}>
        {kpi("MTD", fmt(mtdCollected), "#4ecb71", MONTHS_SHORT[currentMonth])}
        {kpi("YTD", fmt(ytdCollected), ORANGE, String(selYear))}
        {kpi("Outstanding", fmt(outstanding), "#e67e22", "unpaid")}
        {kpi("Overdue", fmt(overdue), "#cc4444", "past due")}
      </div>
      <div style={{ padding: "6px 12px 0", display: "flex", gap: 6 }}>
        {kpi("Avg Job", fmt(avgJobValue), "#2980b9", `${paidInYear.length} paid`)}
        {kpi(`Inv ${MONTHS_SHORT[currentMonth]}`, String(monthInvoiceCount), NAVY, "this month")}
        {kpi(`GET Q${currentQuarter}`, fmt(getOwed), "#6B39A8", "owed")}
      </div>
      <div style={{ margin: "12px 12px 0", background: "#fff", borderRadius: 12, padding: "16px 14px 10px", boxShadow: "0 1px 6px rgba(0,0,0,0.07)" }}>
        <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 13, color: NAVY, letterSpacing: 1, textTransform: "uppercase", marginBottom: 10 }}>Monthly Revenue — {selYear}</div>
        <svg viewBox="0 0 340 115" style={{ width: "100%", height: 115, display: "block" }}>
          {monthlyRevenue.map((val, i) => {
            const bw = 20, gap = 8.5, x = i * (bw + gap) + 2, maxH = 76, baseY = 88;
            const bh = val > 0 ? Math.max(5, (val / maxMonthly) * maxH) : 0;
            const y = baseY - bh;
            const isCurrent = i === currentMonth && selYear === currentYear;
            return (
              <g key={i}>
                {bh > 0 ? <rect x={x} y={y} width={bw} height={bh} rx={2} fill={isCurrent ? ORANGE : "#3D95CE"} />
                         : <rect x={x} y={baseY-2} width={bw} height={2} rx={1} fill="#f0f2f8" />}
                <text x={x+bw/2} y={102} textAnchor="middle" fontSize="7" fill={isCurrent ? ORANGE : "#8899bb"} fontFamily="Barlow Condensed,sans-serif" fontWeight={isCurrent ? "bold" : "normal"}>{MONTHS_SHORT[i]}</text>
                {val > 0 && bh > 12 && <text x={x+bw/2} y={y+10} textAnchor="middle" fontSize="6" fill="#fff" fontFamily="Barlow Condensed,sans-serif" fontWeight="bold">{val>=1000?`$${(val/1000).toFixed(1)}k`:`$${Math.round(val)}`}</text>}
              </g>
            );
          })}
        </svg>
      </div>
      <div style={{ margin: "12px 12px 0", background: "#fff", borderRadius: 12, padding: "16px 14px", boxShadow: "0 1px 6px rgba(0,0,0,0.07)" }}>
        <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 13, color: NAVY, letterSpacing: 1, textTransform: "uppercase", marginBottom: 10 }}>Top Clients — {selYear}</div>
        {topClients.length === 0 ? <div style={{ fontSize: 13, color: "#bbb", textAlign: "center", padding: "14px 0" }}>No data for {selYear}</div>
          : topClients.map((c, i) => (
            <div key={c.name} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: i < topClients.length-1 ? "1px solid #f4f6fa" : "none" }}>
              <div style={{ width: 22, height: 22, borderRadius: "50%", background: i === 0 ? ORANGE : NAVY, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <span style={{ color: "#fff", fontSize: 10, fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700 }}>{i+1}</span>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: "#1a1a1a", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</div>
                <div style={{ fontSize: 11, color: "#aaa" }}>{c.jobs} job{c.jobs !== 1 ? "s" : ""}</div>
              </div>
              <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 15, color: ORANGE, flexShrink: 0 }}>{fmt(c.total)}</div>
            </div>
          ))}
      </div>
      <div style={{ margin: "12px 12px 0", background: "#fff", borderRadius: 12, padding: "16px 14px", boxShadow: "0 1px 6px rgba(0,0,0,0.07)" }}>
        <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 13, color: NAVY, letterSpacing: 1, textTransform: "uppercase", marginBottom: 10 }}>Revenue by Method — {selYear}</div>
        {methodEntries.length === 0 ? <div style={{ fontSize: 13, color: "#bbb", textAlign: "center", padding: "14px 0" }}>No payments for {selYear}</div>
          : methodEntries.map(([method, amount]) => {
            const pct = ytdCollected > 0 ? amount / ytdCollected * 100 : 0;
            const color = methodColors[method] || "#888";
            return (
              <div key={method} style={{ marginBottom: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: "#333" }}>{method}</span>
                  <div>
                    <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 14, color }}>{fmt(amount)}</span>
                    <span style={{ fontSize: 11, color: "#aaa", marginLeft: 5 }}>{pct.toFixed(0)}%</span>
                  </div>
                </div>
                <div style={{ height: 7, background: "#f0f2f8", borderRadius: 4 }}>
                  <div style={{ height: 7, background: color, borderRadius: 4, width: `${Math.max(pct,1)}%` }} />
                </div>
              </div>
            );
          })}
      </div>
      {yearExpenses.length > 0 && (
        <div style={{ margin: "12px 12px 0", background: "#fff", borderRadius: 12, padding: "16px 14px", boxShadow: "0 1px 6px rgba(0,0,0,0.07)" }}>
          <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 13, color: NAVY, letterSpacing: 1, textTransform: "uppercase", marginBottom: 10 }}>Expenses — {selYear}</div>
          <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
            <div style={{ flex: 1, background: "#fff0f0", borderRadius: 8, padding: "8px 10px", border: "1px solid #fdd" }}>
              <div style={{ fontSize: 9, color: "#cc4444", textTransform: "uppercase", letterSpacing: 1, fontFamily: "'Barlow Condensed', sans-serif", marginBottom: 2 }}>Total</div>
              <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 16, color: "#cc4444" }}>{fmt(totalExpenses)}</div>
            </div>
            <div style={{ flex: 1, background: "#f0f8f4", borderRadius: 8, padding: "8px 10px", border: "1px solid #c8e8d8" }}>
              <div style={{ fontSize: 9, color: "#27ae60", textTransform: "uppercase", letterSpacing: 1, fontFamily: "'Barlow Condensed', sans-serif", marginBottom: 2 }}>Deductible</div>
              <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 16, color: "#27ae60" }}>{fmt(totalDeductible)}</div>
            </div>
          </div>
          {Object.entries(expByCategory).sort((a,b) => b[1].total-a[1].total).map(([cat, d]) => (
            <div key={cat} style={{ padding: "7px 0", borderBottom: "1px solid #f4f6fa" }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: "#333" }}>{cat}</span>
                <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 14, color: "#cc4444" }}>{fmt(d.total)}</span>
              </div>
              {cat === "Meals & Entertainment" && <div style={{ fontSize: 10, color: "#f39c12", marginTop: 2 }}>50% deductible: {fmt(d.deductible)}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Settings Tab (Backup / Restore) ───────────────────────────────────────────
// Payment Instructions card — controls the boilerplate payment terms that
// print on every invoice and the monthly finance-charge rate that kicks in
// 30 days after the due date. The {rate} and {rateAnnual} variables in the
// instructions text are swapped out at render time using the saved rate, so
// editing the rate updates the wording everywhere automatically.
function PaymentInstructionsCard() {
  const [text, setText] = useState(messageTemplates.payment_instructions || DEFAULT_PAYMENT_INSTRUCTIONS);
  const [rate, setRate] = useState(
    messageTemplates.late_fee_rate != null ? String(messageTemplates.late_fee_rate) : String(DEFAULT_LATE_FEE_RATE)
  );
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState(null);
  const taRef = useRef(null);

  const variables = [
    { token: "{rate}",       hint: "Monthly rate (e.g., 1.5)" },
    { token: "{rateAnnual}", hint: "Annual rate (rate × 12)" },
  ];

  const insertVar = (token) => {
    const ta = taRef.current;
    if (!ta) return;
    const start = ta.selectionStart ?? text.length;
    const end = ta.selectionEnd ?? start;
    const next = text.slice(0, start) + token + text.slice(end);
    setText(next);
    setTimeout(() => {
      ta.focus();
      ta.setSelectionRange(start + token.length, start + token.length);
    }, 0);
  };

  const resetToDefault = () => { setText(DEFAULT_PAYMENT_INSTRUCTIONS); setRate(String(DEFAULT_LATE_FEE_RATE)); setStatus(null); };

  const save = async () => {
    setSaving(true); setStatus(null);
    try {
      const isUnchangedText = text.trim() === DEFAULT_PAYMENT_INSTRUCTIONS.trim();
      const parsedRate = Number(rate);
      if (isNaN(parsedRate) || parsedRate < 0) throw new Error("Rate must be a positive number");
      const isDefaultRate = parsedRate === DEFAULT_LATE_FEE_RATE;
      await db.setSetting("payment_instructions_template", isUnchangedText ? null : text);
      await db.setSetting("late_fee_rate", isDefaultRate ? null : String(parsedRate));
      messageTemplates.payment_instructions = isUnchangedText ? null : text;
      messageTemplates.late_fee_rate = isDefaultRate ? null : parsedRate;
      setStatus({ kind: "ok", text: "Saved. New invoices will use these instructions." });
    } catch (e) {
      setStatus({ kind: "err", text: "Save failed: " + (e.message || e) });
    }
    setSaving(false);
  };

  const card = { background: "#fff", borderRadius: 12, padding: 16, marginBottom: 12, boxShadow: "0 1px 3px rgba(10,22,40,0.06)" };
  const heading = { fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 14, letterSpacing: 1, color: "#8899bb", textTransform: "uppercase", marginBottom: 8 };
  const body = { fontSize: 13, color: "#445", lineHeight: 1.5, marginBottom: 12 };

  return (
    <div style={card}>
      <div style={heading}>Payment instructions</div>
      <div style={body}>
        Boilerplate terms that print at the bottom of every invoice. Includes the monthly finance charge that auto-applies 30 days after the due date — the rate below flows into the {"{rate}"} and {"{rateAnnual}"} placeholders in the text.
      </div>

      {/* Late-fee rate */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <label style={{ fontSize: 13, color: "#445", fontWeight: 600 }}>Late fee rate</label>
        <input
          type="number"
          step="0.1"
          min="0"
          value={rate}
          onChange={e => { setRate(e.target.value); setStatus(null); }}
          style={{ ...S.input, width: 90, textAlign: "right" }}
        />
        <span style={{ fontSize: 13, color: "#666" }}>% per month</span>
        <span style={{ fontSize: 12, color: "#999", marginLeft: "auto" }}>{rate ? `${(Number(rate) * 12).toFixed(1)}% annually` : ""}</span>
      </div>

      {/* Variable chips */}
      <div style={{ fontSize: 11, color: "#888", letterSpacing: 1, fontWeight: 700, textTransform: "uppercase", fontFamily: "'Barlow Condensed', sans-serif", marginBottom: 6 }}>Tap to insert</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
        {variables.map(v => (
          <button
            key={v.token}
            type="button"
            onClick={() => insertVar(v.token)}
            title={v.hint}
            style={{ background: LIGHT, border: "1px solid #dde2ee", borderRadius: 14, padding: "4px 10px", fontSize: 12, color: NAVY, fontFamily: "'Barlow', sans-serif", cursor: "pointer", fontWeight: 600 }}
          >{v.token} <span style={{ color: "#888", fontWeight: 400, marginLeft: 4 }}>· {v.hint}</span></button>
        ))}
      </div>

      <textarea
        ref={taRef}
        value={text}
        onChange={e => { setText(e.target.value); setStatus(null); }}
        rows={12}
        style={{ ...S.input, resize: "vertical", minHeight: 220, fontFamily: "'Barlow', sans-serif", lineHeight: 1.5, fontSize: 14, whiteSpace: "pre-wrap" }}
      />

      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <button onClick={resetToDefault} disabled={saving} style={{ ...S.btn("ghost"), flex: 1 }}>Reset to default</button>
        <button onClick={save} disabled={saving} style={{ ...S.btn("primary"), flex: 2, opacity: saving ? 0.5 : 1 }}>
          {saving ? "Saving…" : "Save instructions"}
        </button>
      </div>

      {status && (
        <div style={{ marginTop: 10, padding: 10, borderRadius: 8, background: status.kind === "ok" ? "#eaf7ee" : "#fdecec", color: status.kind === "ok" ? "#1f7a3a" : "#a3231b", fontSize: 13 }}>{status.text}</div>
      )}
    </div>
  );
}

// Online payment surcharge card. Lets the user toggle the fee on/off and
// tune both the percent and the flat dollar amount so the customer-facing
// surcharge always matches the merchant's actual cost of accepting a card
// payment (Hawaii's surcharge law caps the fee at acceptance cost).
function OnlinePaymentFeeCard() {
  const initialCfg = resolveSurchargeConfig();
  const [enabled, setEnabled] = useState(initialCfg.enabled);
  const [pct, setPct]   = useState(String(initialCfg.pct));
  const [flat, setFlat] = useState(String(initialCfg.flat));
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState(null);

  // Live preview using a $500 example invoice so the user can see the
  // dollar impact of the rate they're typing without having to math it.
  const sampleBase = 500;
  const sampleFee = enabled ? +(sampleBase * (Number(pct || 0) / 100) + Number(flat || 0)).toFixed(2) : 0;
  const sampleTotal = +(sampleBase + sampleFee).toFixed(2);

  const resetToDefault = () => {
    setEnabled(DEFAULT_SURCHARGE_ENABLED);
    setPct(String(DEFAULT_SURCHARGE_PCT));
    setFlat(String(DEFAULT_SURCHARGE_FLAT));
    setStatus(null);
  };

  const save = async () => {
    setSaving(true); setStatus(null);
    try {
      const parsedPct  = Number(pct);
      const parsedFlat = Number(flat);
      if (isNaN(parsedPct)  || parsedPct  < 0) throw new Error("Percent rate must be a positive number");
      if (isNaN(parsedFlat) || parsedFlat < 0) throw new Error("Flat fee must be a positive number");
      const isDefaultEnabled = enabled === DEFAULT_SURCHARGE_ENABLED;
      const isDefaultPct  = parsedPct  === DEFAULT_SURCHARGE_PCT;
      const isDefaultFlat = parsedFlat === DEFAULT_SURCHARGE_FLAT;
      // Persist nulls when the value matches the built-in default so the
      // settings table stays clean and future default changes flow through.
      await db.setSetting("surcharge_enabled", isDefaultEnabled ? null : (enabled ? "true" : "false"));
      await db.setSetting("surcharge_pct",  isDefaultPct  ? null : String(parsedPct));
      await db.setSetting("surcharge_flat", isDefaultFlat ? null : String(parsedFlat));
      messageTemplates.surcharge_enabled = isDefaultEnabled ? null : enabled;
      messageTemplates.surcharge_pct  = isDefaultPct  ? null : parsedPct;
      messageTemplates.surcharge_flat = isDefaultFlat ? null : parsedFlat;
      setStatus({ kind: "ok", text: "Saved. New invoices will show this online payment fee." });
    } catch (e) {
      setStatus({ kind: "err", text: "Save failed: " + (e.message || e) });
    }
    setSaving(false);
  };

  const card = { background: "#fff", borderRadius: 12, padding: 16, marginBottom: 12, boxShadow: "0 1px 3px rgba(10,22,40,0.06)" };
  const heading = { fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 14, letterSpacing: 1, color: "#8899bb", textTransform: "uppercase", marginBottom: 8 };
  const body = { fontSize: 13, color: "#445", lineHeight: 1.5, marginBottom: 12 };

  return (
    <div style={card}>
      <div style={heading}>Online payment fee</div>
      <div style={body}>
        Pass the PayPal processing fee on to customers who pay online (PayPal, card, or Venmo through the button). Defaults to PayPal’s standard {DEFAULT_SURCHARGE_PCT}% + ${DEFAULT_SURCHARGE_FLAT.toFixed(2)} so the deposit you receive matches the invoice total. Cash, check, and Zelle never see this fee.
      </div>

      {/* Enable / disable toggle */}
      <label style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14, cursor: "pointer" }}>
        <input
          type="checkbox"
          checked={enabled}
          onChange={e => { setEnabled(e.target.checked); setStatus(null); }}
          style={{ width: 18, height: 18, cursor: "pointer" }}
        />
        <span style={{ fontSize: 14, color: NAVY, fontWeight: 600 }}>Charge customers an online payment fee</span>
      </label>

      {/* Percent + flat fields */}
      <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 12, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <label style={{ fontSize: 13, color: "#445", fontWeight: 600 }}>Percent</label>
          <input
            type="number"
            step="0.01"
            min="0"
            disabled={!enabled}
            value={pct}
            onChange={e => { setPct(e.target.value); setStatus(null); }}
            style={{ ...S.input, width: 90, textAlign: "right", opacity: enabled ? 1 : 0.5 }}
          />
          <span style={{ fontSize: 13, color: "#666" }}>%</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <label style={{ fontSize: 13, color: "#445", fontWeight: 600 }}>+ Flat</label>
          <span style={{ fontSize: 13, color: "#666" }}>$</span>
          <input
            type="number"
            step="0.01"
            min="0"
            disabled={!enabled}
            value={flat}
            onChange={e => { setFlat(e.target.value); setStatus(null); }}
            style={{ ...S.input, width: 90, textAlign: "right", opacity: enabled ? 1 : 0.5 }}
          />
        </div>
      </div>

      {/* Live preview */}
      <div style={{ background: LIGHT, borderRadius: 8, padding: "10px 12px", marginBottom: 12, fontSize: 13 }}>
        <div style={{ color: "#888", fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase", fontFamily: "'Barlow Condensed', sans-serif", marginBottom: 6 }}>Preview — $500 invoice</div>
        <div style={{ display: "flex", justifyContent: "space-between", color: "#555" }}>
          <span>Balance</span><span>${sampleBase.toFixed(2)}</span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", color: "#888", marginTop: 2 }}>
          <span>Online fee</span><span>+${sampleFee.toFixed(2)}</span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, paddingTop: 6, borderTop: "1px solid #dde2ee", fontWeight: 700, color: NAVY }}>
          <span>Customer pays</span><span style={{ color: ORANGE }}>${sampleTotal.toFixed(2)}</span>
        </div>
      </div>

      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={resetToDefault} disabled={saving} style={{ ...S.btn("ghost"), flex: 1 }}>Reset to default</button>
        <button onClick={save} disabled={saving} style={{ ...S.btn("primary"), flex: 2, opacity: saving ? 0.5 : 1 }}>
          {saving ? "Saving…" : "Save fee"}
        </button>
      </div>

      {status && (
        <div style={{ marginTop: 10, padding: 10, borderRadius: 8, background: status.kind === "ok" ? "#eaf7ee" : "#fdecec", color: status.kind === "ok" ? "#1f7a3a" : "#a3231b", fontSize: 13 }}>{status.text}</div>
      )}
    </div>
  );
}

// Review request settings card. Per-platform toggle so Jake can switch on
// Yelp now and Google later (after his business is verified there).
// When enabled, the matching platform gets a button at the bottom of
// invoice emails — estimates never include the footer.
function ReviewRequestCard() {
  // Pull current values out of the in-memory settings cache so the card
  // reflects whatever was last saved.
  const yEnInit = messageTemplates.review_yelp_enabled;
  const yUrlInit = messageTemplates.review_yelp_url;
  const gEnInit = messageTemplates.review_google_enabled;
  const gUrlInit = messageTemplates.review_google_url;

  const [yelpEnabled, setYelpEnabled] = useState(yEnInit == null ? DEFAULT_REVIEW_YELP_ENABLED : !!yEnInit);
  const [yelpUrl, setYelpUrl] = useState(yUrlInit == null ? DEFAULT_REVIEW_YELP_URL : yUrlInit);
  const [googleEnabled, setGoogleEnabled] = useState(gEnInit == null ? DEFAULT_REVIEW_GOOGLE_ENABLED : !!gEnInit);
  const [googleUrl, setGoogleUrl] = useState(gUrlInit == null ? DEFAULT_REVIEW_GOOGLE_URL : gUrlInit);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState(null);

  const resetToDefault = () => {
    setYelpEnabled(DEFAULT_REVIEW_YELP_ENABLED);
    setYelpUrl(DEFAULT_REVIEW_YELP_URL);
    setGoogleEnabled(DEFAULT_REVIEW_GOOGLE_ENABLED);
    setGoogleUrl(DEFAULT_REVIEW_GOOGLE_URL);
    setStatus(null);
  };

  const save = async () => {
    setSaving(true); setStatus(null);
    try {
      const yUrlTrim = (yelpUrl || "").trim();
      const gUrlTrim = (googleUrl || "").trim();
      // Light sanity check — don't let a typo silently disable the link.
      if (yelpEnabled && yUrlTrim && !/^https?:\/\//i.test(yUrlTrim)) {
        throw new Error("Yelp URL should start with https://");
      }
      if (googleEnabled && !gUrlTrim) {
        throw new Error("Add a Google review URL before enabling Google reviews");
      }
      if (googleEnabled && gUrlTrim && !/^https?:\/\//i.test(gUrlTrim)) {
        throw new Error("Google URL should start with https://");
      }

      // Persist nulls when the value matches the built-in default so the
      // settings table stays clean (mirrors the surcharge/late-fee pattern).
      const isDefaultYEn  = yelpEnabled === DEFAULT_REVIEW_YELP_ENABLED;
      const isDefaultYUrl = yUrlTrim === DEFAULT_REVIEW_YELP_URL;
      const isDefaultGEn  = googleEnabled === DEFAULT_REVIEW_GOOGLE_ENABLED;
      const isDefaultGUrl = gUrlTrim === DEFAULT_REVIEW_GOOGLE_URL;

      await db.setSetting("review_yelp_enabled",  isDefaultYEn  ? null : (yelpEnabled ? "true" : "false"));
      await db.setSetting("review_yelp_url",      isDefaultYUrl ? null : yUrlTrim);
      await db.setSetting("review_google_enabled",isDefaultGEn  ? null : (googleEnabled ? "true" : "false"));
      await db.setSetting("review_google_url",    isDefaultGUrl ? null : gUrlTrim);

      messageTemplates.review_yelp_enabled   = isDefaultYEn  ? null : yelpEnabled;
      messageTemplates.review_yelp_url       = isDefaultYUrl ? null : yUrlTrim;
      messageTemplates.review_google_enabled = isDefaultGEn  ? null : googleEnabled;
      messageTemplates.review_google_url     = isDefaultGUrl ? null : gUrlTrim;

      const enabledCount = (yelpEnabled && yUrlTrim ? 1 : 0) + (googleEnabled && gUrlTrim ? 1 : 0);
      setStatus({
        kind: "ok",
        text: enabledCount === 0
          ? "Saved. Review requests are off \u2014 invoice emails will not ask for a review."
          : `Saved. New invoice emails will ask customers to leave a review on ${enabledCount === 2 ? "Yelp and Google" : (yelpEnabled ? "Yelp" : "Google")}.`,
      });
    } catch (e) {
      setStatus({ kind: "err", text: "Save failed: " + (e.message || e) });
    }
    setSaving(false);
  };

  const card = { background: "#fff", borderRadius: 12, padding: 16, marginBottom: 12, boxShadow: "0 1px 3px rgba(10,22,40,0.06)" };
  const heading = { fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 14, letterSpacing: 1, color: "#8899bb", textTransform: "uppercase", marginBottom: 8 };
  const body = { fontSize: 13, color: "#445", lineHeight: 1.5, marginBottom: 12 };
  const platformBlock = { border: "1px solid #e8ecf4", borderRadius: 8, padding: 12, marginBottom: 10 };
  const platformLabel = { fontSize: 14, color: NAVY, fontWeight: 700 };
  const subLabel = { fontSize: 12, color: "#888", marginTop: 2 };

  return (
    <div style={card}>
      <div style={heading}>Request reviews</div>
      <div style={body}>
        Add a friendly review request to the bottom of invoice emails. Estimates never include the request — it only fires once the job’s done and the invoice goes out.
      </div>

      {/* Yelp */}
      <div style={platformBlock}>
        <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={yelpEnabled}
            onChange={e => { setYelpEnabled(e.target.checked); setStatus(null); }}
            style={{ width: 18, height: 18, cursor: "pointer" }}
          />
          <div>
            <div style={platformLabel}>Yelp</div>
            <div style={subLabel}>Ask customers to review HI Grade Plumbing on Yelp</div>
          </div>
        </label>
        <div style={{ marginTop: 10 }}>
          <label style={{ fontSize: 12, color: "#666", fontWeight: 600 }}>Yelp page URL</label>
          <input
            type="url"
            value={yelpUrl}
            disabled={!yelpEnabled}
            onChange={e => { setYelpUrl(e.target.value); setStatus(null); }}
            placeholder="https://www.yelp.com/biz/..."
            style={{ ...S.input, width: "100%", marginTop: 4, opacity: yelpEnabled ? 1 : 0.5 }}
          />
        </div>
      </div>

      {/* Google */}
      <div style={platformBlock}>
        <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={googleEnabled}
            onChange={e => { setGoogleEnabled(e.target.checked); setStatus(null); }}
            style={{ width: 18, height: 18, cursor: "pointer" }}
          />
          <div>
            <div style={platformLabel}>Google</div>
            <div style={subLabel}>Verify your business on Google, then paste your review link below</div>
          </div>
        </label>
        <div style={{ marginTop: 10 }}>
          <label style={{ fontSize: 12, color: "#666", fontWeight: 600 }}>Google review URL</label>
          <input
            type="url"
            value={googleUrl}
            disabled={!googleEnabled}
            onChange={e => { setGoogleUrl(e.target.value); setStatus(null); }}
            placeholder="https://g.page/r/..."
            style={{ ...S.input, width: "100%", marginTop: 4, opacity: googleEnabled ? 1 : 0.5 }}
          />
        </div>
      </div>

      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={resetToDefault} disabled={saving} style={{ ...S.btn("ghost"), flex: 1 }}>Reset to default</button>
        <button onClick={save} disabled={saving} style={{ ...S.btn("primary"), flex: 2, opacity: saving ? 0.5 : 1 }}>
          {saving ? "Saving\u2026" : "Save review settings"}
        </button>
      </div>

      {status && (
        <div style={{ marginTop: 10, padding: 10, borderRadius: 8, background: status.kind === "ok" ? "#eaf7ee" : "#fdecec", color: status.kind === "ok" ? "#1f7a3a" : "#a3231b", fontSize: 13 }}>{status.text}</div>
      )}
    </div>
  );
}

// Settings card: lets the user customize the email & text message templates
// that pre-fill the Send modal and the Text Message handoff. Variables in
// curly braces ({name}, {id}, {total}, {link}) are substituted at send time
// so each customer gets a personalized message.
function MessageTemplatesCard() {
  const [emailInvoice,  setEmailInvoice]  = useState(messageTemplates.email_invoice  || DEFAULT_INVOICE_MESSAGE);
  const [emailEstimate, setEmailEstimate] = useState(messageTemplates.email_estimate || DEFAULT_ESTIMATE_MESSAGE);
  const [textInvoice,   setTextInvoice]   = useState(messageTemplates.text_invoice   || DEFAULT_INVOICE_TEXT);
  const [textEstimate,  setTextEstimate]  = useState(messageTemplates.text_estimate  || DEFAULT_ESTIMATE_TEXT);
  const [activeKind, setActiveKind] = useState("email_invoice"); // tab
  const [savingKey, setSavingKey] = useState(null);
  const [status, setStatus] = useState(null); // {kind:'ok'|'err', text}

  const tabs = [
    { id: "email_invoice",  label: "Email · Invoice"  },
    { id: "email_estimate", label: "Email · Estimate" },
    { id: "text_invoice",   label: "Text · Invoice"   },
    { id: "text_estimate",  label: "Text · Estimate"  },
  ];

  const valueFor = (k) => k === "email_invoice" ? emailInvoice : k === "email_estimate" ? emailEstimate : k === "text_invoice" ? textInvoice : textEstimate;
  const setValueFor = (k, v) => {
    if (k === "email_invoice")  setEmailInvoice(v);
    if (k === "email_estimate") setEmailEstimate(v);
    if (k === "text_invoice")   setTextInvoice(v);
    if (k === "text_estimate")  setTextEstimate(v);
  };
  const defaultFor = (k) => ({
    email_invoice:  DEFAULT_INVOICE_MESSAGE,
    email_estimate: DEFAULT_ESTIMATE_MESSAGE,
    text_invoice:   DEFAULT_INVOICE_TEXT,
    text_estimate:  DEFAULT_ESTIMATE_TEXT,
  })[k];
  const settingKeyFor = (k) => `${k}_template`; // e.g. email_invoice_template

  const save = async () => {
    const k = activeKind;
    const value = valueFor(k);
    const isUnchangedFromDefault = value.trim() === defaultFor(k).trim();
    setSavingKey(k); setStatus(null);
    try {
      // Saving the unmodified default just clears the override so we keep
      // the table tidy and future tweaks to defaults flow through.
      await db.setSetting(settingKeyFor(k), isUnchangedFromDefault ? null : value);
      const cacheKey = k; // matches messageTemplates property name
      messageTemplates[cacheKey] = isUnchangedFromDefault ? null : value;
      setStatus({ kind: "ok", text: isUnchangedFromDefault ? "Reset to default." : "Saved. New messages will use this template." });
    } catch (e) {
      setStatus({ kind: "err", text: "Save failed: " + (e.message || e) });
    }
    setSavingKey(null);
  };

  const resetToDefault = () => setValueFor(activeKind, defaultFor(activeKind));

  // Insert a {variable} at the current caret position. Makes the chips below
  // the textarea feel like a friendly cheat sheet instead of just a legend.
  const taRef = useRef(null);
  const insertVar = (token) => {
    const ta = taRef.current;
    if (!ta) return;
    const start = ta.selectionStart ?? valueFor(activeKind).length;
    const end = ta.selectionEnd ?? start;
    const cur = valueFor(activeKind);
    const next = cur.slice(0, start) + token + cur.slice(end);
    setValueFor(activeKind, next);
    setTimeout(() => {
      ta.focus();
      ta.setSelectionRange(start + token.length, start + token.length);
    }, 0);
  };

  const card = { background: "#fff", borderRadius: 12, padding: 16, marginBottom: 12, boxShadow: "0 1px 3px rgba(10,22,40,0.06)" };
  const heading = { fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 14, letterSpacing: 1, color: "#8899bb", textTransform: "uppercase", marginBottom: 8 };
  const body = { fontSize: 13, color: "#445", lineHeight: 1.5, marginBottom: 12 };

  const variables = [
    { token: "{name}",  hint: "Customer's name" },
    { token: "{id}",    hint: "INV0756 / EST0712" },
    { token: "{total}", hint: "$1,234.56" },
    { token: "{link}",  hint: "Trackable view link" },
    { token: "{type}",  hint: "\"invoice\" or \"estimate\"" },
  ];

  return (
    <div style={card}>
      <div style={heading}>Message templates</div>
      <div style={body}>
        Customize the default message that pre-fills when you send an invoice or estimate by email or text. Drop in a curly-brace variable and we’ll swap in the real value at send time — so every message reads like you wrote it for that customer.
      </div>

      {/* Kind tabs */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => { setActiveKind(t.id); setStatus(null); }}
            style={{
              flex: "1 1 calc(50% - 3px)", padding: "9px 8px", borderRadius: 8, cursor: "pointer",
              border: activeKind === t.id ? `2px solid ${ORANGE}` : "1.5px solid #dde2ee",
              background: activeKind === t.id ? "#fff5ef" : "#fff",
              color: activeKind === t.id ? ORANGE : "#445",
              fontWeight: 700, fontFamily: "'Barlow Condensed', sans-serif",
              letterSpacing: 1, textTransform: "uppercase", fontSize: 12,
            }}
          >{t.label}</button>
        ))}
      </div>

      {/* Variable chips — tap to insert at the caret */}
      <div style={{ fontSize: 11, color: "#888", letterSpacing: 1, fontWeight: 700, textTransform: "uppercase", fontFamily: "'Barlow Condensed', sans-serif", marginBottom: 6 }}>Tap to insert</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
        {variables.map(v => (
          <button
            key={v.token}
            type="button"
            onClick={() => insertVar(v.token)}
            title={v.hint}
            style={{ background: LIGHT, border: "1px solid #dde2ee", borderRadius: 14, padding: "4px 10px", fontSize: 12, color: NAVY, fontFamily: "'Barlow', sans-serif", cursor: "pointer", fontWeight: 600 }}
          >{v.token} <span style={{ color: "#888", fontWeight: 400, marginLeft: 4 }}>· {v.hint}</span></button>
        ))}
      </div>

      <textarea
        ref={taRef}
        value={valueFor(activeKind)}
        onChange={e => { setValueFor(activeKind, e.target.value); setStatus(null); }}
        rows={9}
        style={{ ...S.input, resize: "vertical", minHeight: 180, fontFamily: "'Barlow', sans-serif", lineHeight: 1.5, fontSize: 14, whiteSpace: "pre-wrap" }}
      />

      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <button onClick={resetToDefault} disabled={savingKey === activeKind} style={{ ...S.btn("ghost"), flex: 1 }}>Reset to default</button>
        <button onClick={save} disabled={savingKey === activeKind} style={{ ...S.btn("primary"), flex: 2, opacity: savingKey === activeKind ? 0.5 : 1 }}>
          {savingKey === activeKind ? "Saving…" : "Save template"}
        </button>
      </div>

      {status && (
        <div style={{ marginTop: 10, padding: 10, borderRadius: 8, background: status.kind === "ok" ? "#eaf7ee" : "#fdecec", color: status.kind === "ok" ? "#1f7a3a" : "#a3231b", fontSize: 13 }}>{status.text}</div>
      )}
    </div>
  );
}

function SettingsTab({ onAfterRestore, profile, isAdmin, allUsers, viewAsUserId, setViewAsUserId, refreshUsers }) {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(null); // {kind:'ok'|'err', text}
  const [importMode, setImportMode] = useState("merge"); // 'merge' | 'replace'
  const [pendingFile, setPendingFile] = useState(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const fileInputRef = useRef(null);

  const handleExport = async () => {
    setBusy(true); setStatus(null);
    try {
      const r = await backup.downloadBackup();
      setStatus({ kind: "ok", text: `Exported ${r.rows} rows (${(r.bytes/1024).toFixed(1)} KB). Save the JSON file somewhere safe — iCloud Drive, Files app, or email it to yourself.` });
    } catch (e) {
      setStatus({ kind: "err", text: "Export failed: " + (e.message || e) });
    }
    setBusy(false);
  };

  const handleFilePicked = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow reselecting same file
    if (!file) return;
    try {
      const snap = await backup.readBackupFile(file);
      setPendingFile({ file, snap });
      setShowConfirm(true);
    } catch (err) {
      setStatus({ kind: "err", text: err.message });
    }
  };

  const handleConfirmRestore = async () => {
    if (!pendingFile) return;
    setShowConfirm(false);
    setBusy(true); setStatus(null);
    try {
      const r = await backup.importBackup(pendingFile.snap, { mode: importMode });
      const total = Object.values(r.restored).reduce((s, n) => s + n, 0);
      const errs = r.errors.length;
      setStatus({
        kind: errs ? "err" : "ok",
        text: errs
          ? `Restored ${total} rows. ${errs} table${errs !== 1 ? "s" : ""} had errors: ${r.errors.map(e => e.table + " (" + e.message + ")").join("; ")}`
          : `Restored ${total} rows successfully. Reloading…`,
      });
      if (!errs && onAfterRestore) setTimeout(onAfterRestore, 1200);
    } catch (e) {
      setStatus({ kind: "err", text: "Restore failed: " + (e.message || e) });
    }
    setBusy(false);
    setPendingFile(null);
  };

  const card = { background: "#fff", borderRadius: 12, padding: 16, marginBottom: 12, boxShadow: "0 1px 3px rgba(10,22,40,0.06)" };
  const heading = { fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 14, letterSpacing: 1, color: "#8899bb", textTransform: "uppercase", marginBottom: 8 };
  const body = { fontSize: 13, color: "#445", lineHeight: 1.5, marginBottom: 12 };

  return (
    <div style={{ padding: "16px", paddingBottom: 100 }}>
      {isAdmin && (
        <div style={card}>
          <div style={heading}>Users (admin)</div>
          <div style={body}>
            You are signed in as <b>{profile?.display_name || "admin"}</b>. As admin you see every user's data. Pick a user below to filter the entire app to just their work — useful for auditing a journeyman's invoices without him seeing yours. Choose <b>All users</b> to see everything together.
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 10 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: 8, border: viewAsUserId === "" ? `2px solid ${ORANGE}` : "1px solid #dde2ee", background: viewAsUserId === "" ? "#fff7f1" : "#fff", cursor: "pointer" }}>
              <input type="radio" name="viewas" checked={viewAsUserId === ""} onChange={() => setViewAsUserId("")} style={{ accentColor: ORANGE }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 14, color: NAVY }}>All users</div>
                <div style={{ fontSize: 12, color: "#778" }}>Combined view across everyone</div>
              </div>
            </label>
            {(allUsers || []).map(u => {
              const selected = viewAsUserId === u.id;
              return (
                <label key={u.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: 8, border: selected ? `2px solid ${ORANGE}` : "1px solid #dde2ee", background: selected ? "#fff7f1" : "#fff", cursor: "pointer" }}>
                  <input type="radio" name="viewas" checked={selected} onChange={() => setViewAsUserId(u.id)} style={{ accentColor: ORANGE }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 14, color: NAVY, display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{u.displayName || "(no name)"}</span>
                      {u.role === "admin" && <span style={{ background: ORANGE, color: "#fff", fontSize: 9, fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, letterSpacing: 1, padding: "1px 5px", borderRadius: 3 }}>ADMIN</span>}
                    </div>
                    <div style={{ fontSize: 12, color: "#778" }}>{u.invoiceCount} invoices · {u.estimateCount} estimates</div>
                  </div>
                </label>
              );
            })}
          </div>
          <button onClick={refreshUsers} style={{ ...S.btn("navy"), width: "100%" }}>Refresh user list</button>
          <div style={{ marginTop: 10, fontSize: 11, color: "#889", lineHeight: 1.5 }}>
            To add a journeyman: open the <a href="https://supabase.com/dashboard/project/cwhgcxxszyvevjpbnnkc/auth/users" target="_blank" rel="noreferrer" style={{ color: ORANGE, fontWeight: 600 }}>Supabase Auth dashboard</a>, click <b>Add user → Create new user</b>, set their email and password, save. Their profile is auto-created with role <code>plumber</code>. They land in an empty workspace; you keep seeing everything.
          </div>
        </div>
      )}
      <MessageTemplatesCard />
      <PaymentInstructionsCard />
      <OnlinePaymentFeeCard />
      <ReviewRequestCard />
      <div style={card}>
        <div style={heading}>Backup</div>
        <div style={body}>
          Download every client, invoice, line item, payment, expense, and saved item as a single JSON file you can keep on iCloud, your Mac mini, or your NAS. Re-import it anytime to restore everything.
        </div>
        <button onClick={handleExport} disabled={busy} style={{ ...S.btn("primary"), width: "100%" }}>
          {busy ? "Working…" : "Export everything to JSON"}
        </button>
      </div>

      <div style={card}>
        <div style={heading}>Restore</div>
        <div style={body}>
          Pick a previously-exported backup file. <b>Merge</b> adds rows from the backup without deleting anything new. <b>Replace</b> wipes the cloud database and reinstates the backup exactly — use only if data is corrupted or you want to roll back.
        </div>
        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          {[
            { id: "merge",   label: "Merge"   },
            { id: "replace", label: "Replace" },
          ].map(opt => (
            <button
              key={opt.id}
              onClick={() => setImportMode(opt.id)}
              style={{
                flex: 1, padding: "10px 12px", borderRadius: 8, cursor: "pointer",
                border: importMode === opt.id ? `2px solid ${ORANGE}` : "1.5px solid #dde2ee",
                background: importMode === opt.id ? "#fff5ef" : "#fff",
                color: importMode === opt.id ? ORANGE : "#445",
                fontWeight: 700, fontFamily: "'Barlow Condensed', sans-serif",
                letterSpacing: 1, textTransform: "uppercase", fontSize: 13,
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <input ref={fileInputRef} type="file" accept="application/json,.json" onChange={handleFilePicked} style={{ display: "none" }} />
        <button onClick={() => fileInputRef.current?.click()} disabled={busy} style={{ ...S.btn("primary"), width: "100%" }}>
          {busy ? "Working…" : "Choose backup file…"}
        </button>
      </div>

      {status && (
        <div style={{
          ...card,
          background: status.kind === "ok" ? "#eaf6ee" : "#fdecec",
          color: status.kind === "ok" ? "#1f6f3a" : "#8a1f1f",
          border: `1px solid ${status.kind === "ok" ? "#bfe2c8" : "#f3c4c4"}`,
        }}>
          {status.text}
        </div>
      )}

      <div style={{ ...card, background: "#f5f7fb", color: "#556" }}>
        <div style={heading}>Tip</div>
        <div style={{ ...body, marginBottom: 0 }}>
          For peace of mind, export a fresh backup at the end of every workday and keep the last few. The file is portable Postgres-shape JSON, so it stays useful if you ever migrate the app off Supabase to your own NAS / VPS.
        </div>
      </div>

      <div style={card}>
        <div style={heading}>Sign out</div>
        <div style={body}>
          Signs you out of this device. You'll need your email and password to get back in. Customers viewing public links are not affected.
        </div>
        <button
          onClick={async () => {
            if (!confirm("Sign out of HI Grade Invoicing on this device?")) return;
            try { await supabase.auth.signOut(); }
            catch (e) { alert("Sign-out failed: " + (e?.message || e)); }
          }}
          style={{ ...S.btn("ghost"), borderColor: "#c0392b", color: "#c0392b" }}
        >
          Sign out
        </button>
      </div>

      {showConfirm && pendingFile && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(10,22,40,0.6)", zIndex: 400, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
          <div style={{ background: "#fff", borderRadius: 14, padding: 22, width: "100%", maxWidth: 380, boxSizing: "border-box" }}>
            <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 18, color: NAVY, marginBottom: 6 }}>
              {importMode === "replace" ? "Replace all data?" : "Merge backup into current data?"}
            </div>
            <div style={{ fontSize: 13, color: "#445", lineHeight: 1.5, marginBottom: 16 }}>
              {(() => {
                const t = pendingFile.snap.tables || {};
                const rows = Object.values(t).reduce((s, r) => s + (r?.length || 0), 0);
                const exported = pendingFile.snap.exportedAt ? new Date(pendingFile.snap.exportedAt).toLocaleString() : "unknown date";
                return `Backup contains ${rows} rows, exported ${exported}.`;
              })()}
              {importMode === "replace" && <div style={{ marginTop: 8, color: "#8a1f1f", fontWeight: 600 }}>This will delete every existing row before importing. Cannot be undone.</div>}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => { setShowConfirm(false); setPendingFile(null); }} style={{ ...S.btn("ghost"), flex: 1 }}>Cancel</button>
              <button
                onClick={handleConfirmRestore}
                style={{
                  ...S.btn("primary"),
                  flex: 2,
                  background: importMode === "replace" ? "#c0392b" : ORANGE,
                }}
              >
                {importMode === "replace" ? "Replace all" : "Merge"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────
// ─── Login Screen ──────────────────────────────────────────────────────────────────────
// Gates the entire authenticated UI. Shown when supabase.auth.getSession()
// returns no active session. The /v/<token> public viewer + /sign signature
// page bypass this entirely (handled in App() below the auth check).
function LoginScreen({ onSuccess }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e) => {
    e?.preventDefault?.();
    setError("");
    if (!email || !password) { setError("Email and password are required."); return; }
    setBusy(true);
    try {
      const { error: e1 } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (e1) throw e1;
      onSuccess?.();
    } catch (err) {
      // Supabase returns "Invalid login credentials" for wrong email or password.
      // Don't leak which one was wrong.
      setError(err?.message || "Sign in failed. Please try again.");
      setBusy(false);
    }
  };

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 24, background: NAVY, fontFamily: "'Barlow', sans-serif" }}>
      <div style={{ width: "100%", maxWidth: 380, background: "#fff", borderRadius: 16, padding: 32, boxShadow: "0 12px 40px rgba(0,0,0,0.4)" }}>
        <div style={{ textAlign: "center", marginBottom: 24 }}>
          <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 26, color: NAVY, letterSpacing: 1.5 }}>HI GRADE PLUMBING</div>
          <div style={{ fontSize: 11, color: "#888", letterSpacing: 2, marginTop: 2 }}>LLC · HONOLULU</div>
        </div>
        <form onSubmit={submit}>
          <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: NAVY, marginBottom: 4, letterSpacing: 0.4 }}>EMAIL</label>
          <input
            type="email"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={busy}
            autoFocus
            style={{ width: "100%", padding: "10px 12px", border: "1.5px solid #d8dbe2", borderRadius: 8, fontSize: 15, marginBottom: 14, boxSizing: "border-box", outline: "none" }}
          />
          <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: NAVY, marginBottom: 4, letterSpacing: 0.4 }}>PASSWORD</label>
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={busy}
            style={{ width: "100%", padding: "10px 12px", border: "1.5px solid #d8dbe2", borderRadius: 8, fontSize: 15, marginBottom: 18, boxSizing: "border-box", outline: "none" }}
          />
          {error && (
            <div style={{ background: "#fdecea", color: "#c0392b", borderRadius: 8, padding: "8px 12px", fontSize: 13, marginBottom: 14, lineHeight: 1.4 }}>
              {error}
            </div>
          )}
          <button
            type="submit"
            disabled={busy}
            style={{ width: "100%", padding: "12px 16px", background: ORANGE, color: "#fff", border: "none", borderRadius: 8, fontSize: 15, fontWeight: 700, letterSpacing: 0.5, cursor: busy ? "default" : "pointer", opacity: busy ? 0.7 : 1 }}
          >
            {busy ? "SIGNING IN\u2026" : "SIGN IN"}
          </button>
        </form>
        <div style={{ textAlign: "center", color: "#888", fontSize: 11, marginTop: 18 }}>
          Trouble signing in? Reset your password from the Supabase dashboard or call (808) 393-0015.
        </div>
      </div>
    </div>
  );
}

export default function App() {
  // Auth gate state. session === undefined means we haven't checked yet (show
  // a quick splash). null means logged out (show LoginScreen). An object
  // means signed in (render the app).
  const [session, setSession] = useState(undefined);
  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(({ data }) => {
      if (mounted) setSession(data?.session || null);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      if (!mounted) return;
      setSession(s || null);
    });
    return () => { mounted = false; sub?.subscription?.unsubscribe?.(); };
  }, []);

  const [data, setData] = useState({ invoices: [], clients: [], savedItems: [], expenses: [], nextNum: 753, nextEstimateNum: 712 });
  const [dbLoading, setDbLoading] = useState(true);

  // Multi-user state. profile is the row from the `profiles` table for the
  // signed-in user — { id, display_name, role }. role is 'admin' or 'plumber'.
  // viewAsUserId, when set by an admin, narrows the visible data to that
  // user's owned rows. Persists in localStorage so reload preserves the view.
  const [profile, setProfile] = useState(null);
  const [allUsers, setAllUsers] = useState([]); // admin-only directory
  // Per-user View-as selection — keyed by the signed-in admin's id so it
  // doesn't leak between accounts on the same device. Initial state stays
  // empty until the session loads, then the load effect below populates it.
  const [viewAsUserId, setViewAsUserId] = useState("");
  const viewAsStorageKey = useMemo(() => {
    const uid = session?.user?.id;
    return uid ? `higrade_view_as:${uid}` : null;
  }, [session?.user?.id]);
  useEffect(() => {
    if (!viewAsStorageKey) { setViewAsUserId(""); return; }
    try { setViewAsUserId(localStorage.getItem(viewAsStorageKey) || ""); } catch { setViewAsUserId(""); }
  }, [viewAsStorageKey]);
  useEffect(() => {
    if (!viewAsStorageKey) return;
    try {
      if (viewAsUserId) localStorage.setItem(viewAsStorageKey, viewAsUserId);
      else localStorage.removeItem(viewAsStorageKey);
    } catch {}
  }, [viewAsUserId, viewAsStorageKey]);
  const isAdmin = profile?.role === "admin";
  // Effective owner filter — admins can View As another user, everyone else
  // sees only their own rows (RLS already enforces this server-side; the
  // client-side filter only matters for admins narrowing what they see).
  const effectiveOwnerId = isAdmin && viewAsUserId ? viewAsUserId : null;
  // Load profile + (if admin) the full user list any time the session changes.
  useEffect(() => {
    if (!session) { setProfile(null); setAllUsers([]); return; }
    let cancelled = false;
    (async () => {
      try {
        const p = await db.getMyProfile();
        if (cancelled) return;
        setProfile(p);
        if (p?.role === "admin") {
          try { const users = await db.listAllUsers(); if (!cancelled) setAllUsers(users); } catch {}
        } else {
          setAllUsers([]);
          // Plumbers can never view-as anyone — clear any stale localStorage flag.
          setViewAsUserId("");
        }
      } catch (e) {
        console.warn("profile load failed:", e);
      }
    })();
    return () => { cancelled = true; };
  }, [session]);
  // Refresh user list (with invoice counts) on demand — SettingsTab uses this.
  const refreshUsers = async () => {
    if (!isAdmin) return;
    try { setAllUsers(await db.listAllUsers()); } catch (e) { console.warn(e); }
  };
  // Apply the View-as filter to in-memory data. Admins viewing themselves or
  // "All" see the full set. Plumbers always see everything they loaded (RLS
  // already filtered to their own rows).
  const filteredData = useMemo(() => {
    if (!effectiveOwnerId) return data;
    const match = (r) => r?.ownerId === effectiveOwnerId;
    return {
      ...data,
      invoices:   (data.invoices   || []).filter(match),
      clients:    (data.clients    || []).filter(match),
      savedItems: (data.savedItems || []).filter(match),
      expenses:   (data.expenses   || []).filter(match),
    };
  }, [data, effectiveOwnerId]);
  const [tab, setTabRaw] = useState(() => { try { return localStorage.getItem('higrade_nav_tab') || "invoices"; } catch { return "invoices"; } });
  const setTab = (t) => { try { localStorage.setItem('higrade_nav_tab', t); } catch {} setTabRaw(t); };
  // Clean up the stale nav-restore key written by a bad deploy — if left in
  // localStorage it could re-open client edit forms unexpectedly.
  useEffect(() => { try { localStorage.removeItem('higrade_clients_nav'); } catch {} }, []);
  const [view, setView] = useState("list");
  const [selected, setSelected] = useState(null);
  const FORM_SLIDE_MS = 300;
  const [formMounted, setFormMounted] = useState(false);
  const [formVisible, setFormVisible] = useState(false);
  useEffect(() => {
    if (view === 'form') {
      setFormMounted(true);
      const id = requestAnimationFrame(() => setFormVisible(true));
      return () => cancelAnimationFrame(id);
    } else {
      setFormVisible(false);
      const timer = setTimeout(() => setFormMounted(false), FORM_SLIDE_MS);
      return () => clearTimeout(timer);
    }
  }, [view]);
  const [newDocType, setNewDocType] = useState("invoice");
  // When the user picks Send from the long-press quick-actions menu on the
  // list, we route them into the invoice form AND tell the form to pop its
  // send-method sheet automatically. The form clears this back to null after
  // it consumes it (see onAutoSendConsumed).
  const [autoSendKind, setAutoSendKind] = useState(null); // null | 'invoice' | 'estimate'
  const [showGlobalAI, setShowGlobalAI] = useState(false);
  // Persistent chat history for the global AI Assistant. Lives on the App
  // so closing/reopening the modal preserves history. Also mirrored to
  // localStorage so it survives a page reload. The greeting is added on
  // first mount only when there's no saved history.
  // Per-user chat history. The storage key is suffixed with the signed-in
  // user's id so two accounts on the same device (e.g. you and your
  // journeyman both signing in on your Mac) never see each other's chat.
  // We also one-time migrate any pre-existing global key onto your account
  // so your existing history isn't lost when this lands.
  const chatStorageKey = useMemo(() => {
    const uid = session?.user?.id;
    return uid ? `higrade_global_ai_chat:${uid}` : null;
  }, [session?.user?.id]);
  const [globalAIMsgs, setGlobalAIMsgs] = useState(null);
  // Reload chat history every time the active account changes. Source of
  // truth is the ai_chat_history table on Supabase. localStorage is now
  // only an offline cache so the chat shows up instantly while the network
  // request is in flight, and so an offline reload still works.
  useEffect(() => {
    if (!chatStorageKey) { setGlobalAIMsgs(null); return; }
    let cancelled = false;

    // 1) Hydrate immediately from localStorage cache so the UI doesn't blink.
    try {
      const raw = localStorage.getItem(chatStorageKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length) setGlobalAIMsgs(parsed);
      }
    } catch {}

    // 2) Then fetch the authoritative copy from Supabase.
    (async () => {
      const remote = await db.loadChatHistory();
      if (cancelled) return;
      if (remote === null) {
        // Network/permission error — keep whatever the cache gave us.
        return;
      }
      if (Array.isArray(remote) && remote.length > 0) {
        // Filter out the legacy empty-greeting message if it slipped in.
        const filtered = remote.filter(m => !(m.role === "assistant" && /I can see \d+ invoices and \d+ clients/.test(m.text || "")));
        setGlobalAIMsgs(filtered.length ? filtered : null);
        try { localStorage.setItem(chatStorageKey, JSON.stringify(filtered)); } catch {}
        return;
      }
      // No server-side history yet. If localStorage has something, push it
      // up so we don't lose it (one-shot migration per device per user).
      try {
        const cached = localStorage.getItem(chatStorageKey);
        if (cached) {
          const parsed = JSON.parse(cached);
          if (Array.isArray(parsed) && parsed.length) {
            await db.saveChatHistory(parsed);
            return;
          }
        }
      } catch {}
      setGlobalAIMsgs(null);
    })();

    return () => { cancelled = true; };
  }, [chatStorageKey]);
  const [showMore, setShowMore] = useState(false);
  const [showPriceBook, setShowPriceBook] = useState(false);
  const [openClientId, setOpenClientId] = useState(null);
  // Counter bumped by the header "+" button when on the Expenses tab. The
  // ExpensesTab watches this with useEffect and opens its modal in response.
  // (Invoices/Estimates have direct onNew handlers, so they don't need this.)
  const [expenseNewToken, setExpenseNewToken] = useState(0);
  const [gcalAuthed, setGcalAuthed] = useState(() => !!GCal.getStoredToken());
  // Per-tab sub-header slot. Tab components render their KPI strip / filter
  // tabs into this so brand header + sub-header sit together inside a single
  // sticky container at App level (no offset math, no jitter on iOS Safari).
  // Slot is keyed by tab name so stale pushes from a previous tab can't blank
  // out the new tab's header. We render `content` only when `key` matches the
  // currently active tab. (Previously: a parent useEffect on [tab] nulled the
  // slot AFTER children's mount effects ran, which blanked the new header.)
  const [subHeader, setSubHeaderState] = useState({ key: null, content: null });
  const setSubHeader = (key, content) => {
    if (content === null || content === undefined) setSubHeaderState({ key: null, content: null });
    else setSubHeaderState({ key, content });
  };
  // Sticky-header layout uses a CSS-only stack: brand header + tab sub-header
  // are siblings inside one sticky container, both with `top: 0`, glued
  // together by `display: flex; flex-direction: column`. No JS measurement —
  // measurement-based offsets caused micro-jitter on iOS Safari during scroll
  // because the brand header's getBoundingClientRect height changes by ~1px
  // when transitioning to sticky.
  const rootRef = useRef(null);
  // Edge-swipe-from-left back gesture. Mirrors iOS: starting a touch within
  // the leftmost ~22px of the viewport and dragging right by >70px (and
  // mostly horizontal) fires a window 'app-back' custom event. Active
  // "back-able" views (InvoiceForm, ClientsTab in detail/edit) listen for
  // it and step back. We also render a thin orange bar that grows with the
  // drag to give visual feedback.
  const [edgeSwipeX, setEdgeSwipeX] = useState(0);
  useEffect(() => {
    const EDGE_PX = 22;       // only start when finger lands this close to the left edge
    const TRIGGER_PX = 70;    // horizontal distance that fires app-back on release
    const LOCK_PX = 8;        // movement required before locking horizontal vs vertical
    let startX = 0, startY = 0;
    let active = false;       // true once we've seen a valid edge touchstart
    let locked = null;        // 'h' | 'v' | null — direction lock after first move
    let dx = 0;

    const onStart = (e) => {
      // Only single-finger swipes from the left edge.
      if (e.touches.length !== 1) { active = false; return; }
      const t = e.touches[0];
      if (t.clientX > EDGE_PX) { active = false; return; }
      startX = t.clientX;
      startY = t.clientY;
      dx = 0;
      active = true;
      locked = null;
    };
    const onMove = (e) => {
      if (!active) return;
      const t = e.touches[0];
      const ddx = t.clientX - startX;
      const ddy = t.clientY - startY;
      if (locked == null) {
        if (Math.abs(ddx) < LOCK_PX && Math.abs(ddy) < LOCK_PX) return;
        locked = Math.abs(ddx) > Math.abs(ddy) ? 'h' : 'v';
        if (locked === 'v') { active = false; setEdgeSwipeX(0); return; }
      }
      if (locked === 'h') {
        // Only show indicator while pulling rightward.
        dx = Math.max(0, ddx);
        setEdgeSwipeX(dx);
        // Suppress browser back swipe + page scroll while we own the gesture.
        if (e.cancelable) e.preventDefault();
      }
    };
    const onEnd = () => {
      if (active && locked === 'h' && dx > TRIGGER_PX) {
        window.dispatchEvent(new CustomEvent('app-back'));
      }
      active = false;
      locked = null;
      dx = 0;
      setEdgeSwipeX(0);
    };

    // touchmove must be non-passive so preventDefault() works on iOS Safari.
    document.addEventListener('touchstart', onStart, { passive: true });
    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('touchend', onEnd, { passive: true });
    document.addEventListener('touchcancel', onEnd, { passive: true });
    return () => {
      document.removeEventListener('touchstart', onStart);
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('touchend', onEnd);
      document.removeEventListener('touchcancel', onEnd);
    };
  }, []);

  // Pull-to-refresh: when the user is at the very top of the page in list
  // view and drags downward past a threshold, reload everything from
  // Supabase. Mirrors the native iOS/Android refresh gesture.
  const [ptrPull, setPtrPull] = useState(0);     // visual pull distance (px)
  const [ptrRefreshing, setPtrRefreshing] = useState(false);
  const ptrViewRef = useRef('list');             // current view (synced via effect)
  const ptrRefreshingRef = useRef(false);

  const refreshAll = async () => {
    if (ptrRefreshingRef.current) return;
    ptrRefreshingRef.current = true;
    setPtrRefreshing(true);
    try {
      const fresh = await db.loadAll();
      hydrateTemplatesFromSettings(fresh.settings);
      setData(fresh);
      nextNumRef.current = fresh.nextNum || nextNumRef.current;
      nextEstimateNumRef.current = fresh.nextEstimateNum || nextEstimateNumRef.current;
      try { localStorage.setItem(CACHE_KEY, JSON.stringify(fresh)); } catch {}
    } catch (e) {
      console.error('Refresh failed:', e);
    } finally {
      ptrRefreshingRef.current = false;
      setPtrRefreshing(false);
    }
  };

  useEffect(() => {
    const TOP_TOLERANCE = 2;     // window.scrollY must be within this of 0
    const TRIGGER_PX = 80;       // pull distance that fires a refresh
    const MAX_PX = 140;          // cap on visual pull (rubber-band)
    const LOCK_PX = 8;
    let startX = 0, startY = 0;
    let active = false;
    let locked = null;           // 'h' | 'v' | null
    let dy = 0;

    const onStart = (e) => {
      // Only when sitting at the top of the list view, no modals open.
      if (ptrViewRef.current !== 'list') { active = false; return; }
      if ((window.scrollY || document.documentElement.scrollTop || 0) > TOP_TOLERANCE) { active = false; return; }
      if (e.touches.length !== 1) { active = false; return; }
      const t = e.touches[0];
      startX = t.clientX;
      startY = t.clientY;
      dy = 0;
      active = true;
      locked = null;
    };
    const onMove = (e) => {
      if (!active) return;
      const t = e.touches[0];
      const ddx = t.clientX - startX;
      const ddy = t.clientY - startY;
      if (locked == null) {
        if (Math.abs(ddx) < LOCK_PX && Math.abs(ddy) < LOCK_PX) return;
        // Only lock vertical if drag is mostly down. Up or horizontal -> bail.
        if (ddy > 0 && Math.abs(ddy) > Math.abs(ddx)) {
          locked = 'v';
        } else {
          active = false;
          setPtrPull(0);
          return;
        }
      }
      if (locked === 'v') {
        // Resistance curve: linear up to MAX_PX, soft cap beyond.
        const raw = Math.max(0, ddy);
        dy = raw < MAX_PX ? raw : MAX_PX + (raw - MAX_PX) * 0.2;
        setPtrPull(dy);
        if (e.cancelable) e.preventDefault();
      }
    };
    const onEnd = () => {
      if (active && locked === 'v' && dy > TRIGGER_PX) {
        refreshAll();
      }
      active = false;
      locked = null;
      dy = 0;
      setPtrPull(0);
    };

    document.addEventListener('touchstart', onStart, { passive: true });
    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('touchend', onEnd, { passive: true });
    document.addEventListener('touchcancel', onEnd, { passive: true });
    return () => {
      document.removeEventListener('touchstart', onStart);
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('touchend', onEnd);
      document.removeEventListener('touchcancel', onEnd);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the PTR view-ref synced so the touch handler (which closes over
  // an empty deps array) always sees the current view.
  useEffect(() => { ptrViewRef.current = view; }, [view]);

  // Synchronous counter for invoice IDs. setData's functional updater is
  // deferred, so when handleGlobalAIAction runs 20 times in a tight loop
  // (bulk-create) the closure-captured `newInvoice` race-conditions and only
  // one ends up persisted. Using a ref lets each call grab a unique ID and
  // build the full record up-front, before any state update or DB write.
  const nextNumRef = useRef(753);
  // Estimates use their own counter (EST####). Same race-avoidance pattern.
  const nextEstimateNumRef = useRef(712);
  // Keep the synchronous counter aligned with state whenever state advances
  // (e.g. after a load from Supabase or after a single-doc create updates state).
  useEffect(() => {
    if (typeof data.nextNum === "number" && data.nextNum > nextNumRef.current) {
      nextNumRef.current = data.nextNum;
    }
  }, [data.nextNum]);
  useEffect(() => {
    if (typeof data.nextEstimateNum === "number" && data.nextEstimateNum > nextEstimateNumRef.current) {
      nextEstimateNumRef.current = data.nextEstimateNum;
    }
  }, [data.nextEstimateNum]);

  useEffect(() => {
    // Don't fire the heavy loadAll until we know the user is signed in.
    // Without this, RLS would reject every query on a fresh page load.
    if (!session) return;

    // Hydrate from localStorage cache immediately so the app renders
    // without a loading screen on every iOS background/foreground cycle.
    let hasCached = false;
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (raw) {
        const cached = JSON.parse(raw);
        setData(cached);
        nextNumRef.current = cached.nextNum || 753;
        nextEstimateNumRef.current = cached.nextEstimateNum || 712;
        hydrateTemplatesFromSettings(cached.settings);
        hasCached = true;
      }
    } catch {}
    // If we have cached data, skip the loading screen and refresh silently
    // in the background. First-ever load still shows the splash.
    if (hasCached) setDbLoading(false);
    else setDbLoading(true);

    db.loadAll()
      .then(d => {
        setData(d);
        nextNumRef.current = d.nextNum || 753;
        nextEstimateNumRef.current = d.nextEstimateNum || 712;
        hydrateTemplatesFromSettings(d.settings);
        setDbLoading(false);
        try { localStorage.setItem(CACHE_KEY, JSON.stringify(d)); } catch {}
      })
      .catch(e => {
        console.error('Supabase load failed:', e);
        if (!hasCached) {
          try {
            const raw = localStorage.getItem(CACHE_KEY);
            if (raw) { setData(JSON.parse(raw)); } else { setData({ invoices: [], clients: [], savedItems: [], expenses: [], nextNum: 753, nextEstimateNum: 712 }); }
          } catch { setData({ invoices: [], clients: [], savedItems: [], expenses: [], nextNum: 753, nextEstimateNum: 712 }); }
        }
        setDbLoading(false);
      });
  }, [session]);

  useEffect(() => {
    if (!dbLoading) try { localStorage.setItem(CACHE_KEY, JSON.stringify(data)); } catch {}
  }, [data, dbLoading]);

  // App-level handler for the edge-swipe 'app-back' event. Priority:
  //   1. Close global AI modal if open
  //   2. Close "More" sheet if open
  //   3. Exit invoice form (mirrors the form's own back button)
  //   4. ClientsTab handles its own modes via its own listener
  useEffect(() => {
    const onBack = () => {
      if (showGlobalAI) { setShowGlobalAI(false); return; }
      if (showMore) { setShowMore(false); return; }
      if (view === "form") {
        // Tell InvoiceForm to flush autosave then unmount. The form listens
        // for 'app-back-form' and calls its own handleBack so pending edits
        // aren't lost.
        window.dispatchEvent(new CustomEvent('app-back-form'));
        return;
      }
      // ClientsTab listens directly when in detail/edit mode.
    };
    window.addEventListener('app-back', onBack);
    return () => window.removeEventListener('app-back', onBack);
  }, [view, showGlobalAI, showMore]);

  // Seed the global AI greeting once data has loaded for the first time, but
  // only if there's no saved chat history. After this, the user's full chat
  // history is preserved across closes and reloads.
  useEffect(() => {
    if (globalAIMsgs == null && !dbLoading) {
      setGlobalAIMsgs([{ role: "assistant", text: "Aloha Jake. What can I help you with today?" }]);
    }
  }, [globalAIMsgs, dbLoading]);

  // After iOS evicts the PWA and the user returns, the app reloads to the list.
  // If there was a client editor open on a specific invoice, navigate back to it
  // so the draft persistence hook can restore the editor.
  const clientDraftNavRestoredRef = useRef(false);
  useEffect(() => {
    if (dbLoading) return;
    if (clientDraftNavRestoredRef.current) return;
    clientDraftNavRestoredRef.current = true;
    if (view !== 'list') return;
    try {
      const ctxRaw = localStorage.getItem('higrade_client_draft_ctx');
      if (!ctxRaw) return;
      const { invoiceId, key } = JSON.parse(ctxRaw);
      if (!invoiceId || !key) return;
      if (!localStorage.getItem(key)) return; // draft itself gone — skip
      const inv = data.invoices.find(i => i.id === invoiceId);
      if (!inv) return;
      setSelected(inv);
      setView('form');
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dbLoading, data.invoices]);

  // Persist the global AI chat history to localStorage on every change so it
  // survives page reloads. Cap at 200 messages to keep the payload small.
  useEffect(() => {
    if (!Array.isArray(globalAIMsgs)) return;
    const trimmed = globalAIMsgs.length > 200 ? globalAIMsgs.slice(-200) : globalAIMsgs;
    // Mirror to localStorage immediately so an offline reload still has it.
    try { if (chatStorageKey) localStorage.setItem(chatStorageKey, JSON.stringify(trimmed)); } catch {}
    // Debounced server save so we're not hammering Supabase on every
    // keystroke-driven render. 600 ms after the last change wins.
    const handle = setTimeout(() => { db.saveChatHistory(trimmed); }, 600);
    return () => clearTimeout(handle);
  }, [globalAIMsgs, chatStorageKey]);

  // Reset the global AI chat: clears history and restores the greeting.
  const resetGlobalAIChat = () => {
    setGlobalAIMsgs([{ role: "assistant", text: "Aloha Jake. What can I help you with today?" }]);
  };

  const addExpense = async (exp) => {
    const id = await db.upsertExpense(exp);
    const saved = { ...exp, id };
    setData(d => {
      const idx = (d.expenses||[]).findIndex(e => e.id === exp.id);
      if (idx >= 0) return { ...d, expenses: d.expenses.map(e => e.id === exp.id ? saved : e) };
      return { ...d, expenses: [saved, ...(d.expenses||[])] };
    });
  };
  const deleteExpense = async (id) => {
    try {
      await db.deleteExpense(id);
    } catch (e) {
      console.error('Delete expense failed:', e);
      alert('Could not delete this expense: ' + (e.message || e));
      return;
    }
    setData(d => ({ ...d, expenses: (d.expenses||[]).filter(e => e.id !== id) }));
  };

  const handleGlobalAIAction = async (parsed) => {
    console.log('[handleGlobalAIAction]', parsed.action, parsed);
    if (parsed.action === "create_invoice" || parsed.action === "create_estimate") {
      const inv = parsed.invoice || {};
      const year = new Date(inv.date || today()).getFullYear();
      const docType = parsed.action === "create_estimate" ? "estimate" : "invoice";
      const isEst = docType === "estimate";
      // Reserve a unique ID synchronously so rapid back-to-back calls (bulk
      // create) don't collide. Estimates and invoices use independent
      // counters so EST and INV numbers never share a sequence.
      const counterRef = isEst ? nextEstimateNumRef : nextNumRef;
      const idPrefix = isEst ? "EST" : "INV";
      const num = counterRef.current++;
      const id = `${idPrefix}${String(num).padStart(4, "0")}`;
      const newInvoice = { id, year, type: docType, client: inv.client || "", date: inv.date || today(), dueDate: inv.dueDate || today(), status: "outstanding", items: inv.items || [], tax: inv.tax ?? TAX_RATE, discount: inv.discount || 0, discountType: inv.discountType || "$", notes: inv.notes || "", payments: [] };
      // Persist FIRST so we don't show success in the UI for records that fail
      // to land in Supabase. If the write throws we surface the error.
      let saveResult;
      try {
        saveResult = await db.upsertInvoice(newInvoice, true);
      } catch (e) {
        console.error('DB write failed for', id, e);
        // Roll back the synchronous counter so the next call reuses this number
        if (counterRef.current === num + 1) counterRef.current = num;
        throw e;
      }
      const stamped = { ...newInvoice, updatedAt: saveResult?.updatedAt || null };
      setData(d => ({
        ...d,
        invoices: [stamped, ...d.invoices],
        nextNum: isEst ? d.nextNum : Math.max(d.nextNum, num + 1),
        nextEstimateNum: isEst ? Math.max(d.nextEstimateNum || 712, num + 1) : (d.nextEstimateNum || 712),
      }));
      return stamped;
    }
    if (parsed.action === "add_items") {
      const inv = data.invoices.find(i => i.id === parsed.invoiceId);
      if (inv) {
        const updated = { ...inv, items: [...(inv.items || []), ...(parsed.items || [])] };
        setData(d => ({ ...d, invoices: d.invoices.map(i => i.id === parsed.invoiceId ? updated : i) }));
        await db.upsertInvoice(updated, false);
      }
    }
    if (parsed.action === "save_item") {
      const item = parsed.item || {};
      const existing = data.savedItems.find(i => i.name.toLowerCase() === item.name.toLowerCase());
      if (existing) {
        const updated = { ...existing, price: item.price, category: item.category || existing.category };
        setData(d => ({ ...d, savedItems: d.savedItems.map(i => i.id === existing.id ? updated : i) }));
        await db.updateSavedItem(updated);
      } else {
        const id = await db.insertSavedItem({ category: item.category || "Custom", name: item.name, price: item.price });
        setData(d => ({ ...d, savedItems: [...d.savedItems, { id, category: item.category || "Custom", name: item.name, price: item.price }] }));
      }
    }
    if (parsed.action === "create_client") {
      const c = parsed.client || {};
      const form = { name: c.name || "", email: c.email || "", email2: c.email2 || "", mobile: c.mobile || c.phone || "", phone: c.phone || c.mobile || "", fax: c.fax || "", address1: c.address1 || "", address2: c.address2 || "", address3: c.address3 || "" };
      const id = await db.insertClient(form);
      const newClient = { ...form, id };
      setData(d => ({ ...d, clients: [...d.clients, newClient] }));
      return newClient;
    }
    if (parsed.action === "update_invoice") {
      const inv = data.invoices.find(i => i.id === parsed.invoiceId);
      if (!inv) return;
      const c = parsed.changes || {};
      const validStatus = (s) => ["outstanding", "paid", "partial", "net30"].includes(s);
      const updated = {
        ...inv,
        ...(typeof c.client === "string" ? { client: c.client } : {}),
        ...(typeof c.date === "string" ? { date: c.date } : {}),
        ...(typeof c.dueDate === "string" ? { dueDate: c.dueDate } : {}),
        ...(typeof c.status === "string" && validStatus(c.status) ? { status: c.status } : {}),
        ...(typeof c.notes === "string" ? { notes: c.notes } : {}),
        ...(typeof c.discount === "number" ? { discount: c.discount } : {}),
        ...(typeof c.tax === "number" ? { tax: c.tax } : {}),
      };
      setData(d => ({ ...d, invoices: d.invoices.map(i => i.id === parsed.invoiceId ? updated : i) }));
      try { await db.upsertInvoice(updated, false); } catch (e) { console.error(e); }
    }
    if (parsed.action === "delete_invoice") {
      const inv = data.invoices.find(i => i.id === parsed.invoiceId);
      if (!inv) return;
      try { await db.deleteInvoice(parsed.invoiceId); } catch (e) { console.error(e); }
      setData(d => ({ ...d, invoices: d.invoices.filter(i => i.id !== parsed.invoiceId) }));
    }
    if (parsed.action === "add_payment") {
      const inv = data.invoices.find(i => i.id === parsed.invoiceId);
      const p = parsed.payment;
      if (!inv || !p || typeof p.amount !== "number") return;
      const payments = [...(inv.payments || []), { amount: p.amount, method: p.method || "Cash", date: p.date || today() }];
      const totals = calcTotals({ ...inv, payments });
      const updated = { ...inv, payments, status: totals.balance <= 0.005 ? "paid" : (totals.paid > 0 ? "partial" : inv.status) };
      setData(d => ({ ...d, invoices: d.invoices.map(i => i.id === inv.id ? updated : i) }));
      try { await db.upsertInvoice(updated, false); } catch (e) { console.error(e); }
    }
    if (parsed.action === "remove_item") {
      const inv = data.invoices.find(i => i.id === parsed.invoiceId);
      const idx = (parsed.itemIndex || 0) - 1;
      if (!inv || idx < 0) return;
      const updated = { ...inv, items: inv.items.filter((_, i) => i !== idx) };
      setData(d => ({ ...d, invoices: d.invoices.map(i => i.id === inv.id ? updated : i) }));
      try { await db.upsertInvoice(updated, false); } catch (e) { console.error(e); }
    }
    if (parsed.action === "update_item") {
      const inv = data.invoices.find(i => i.id === parsed.invoiceId);
      const idx = (parsed.itemIndex || 0) - 1;
      const c = parsed.changes || {};
      if (!inv || idx < 0) return;
      const updated = {
        ...inv,
        items: inv.items.map((it, i) => i === idx ? {
          ...it,
          ...(typeof c.name === "string" ? { name: c.name } : {}),
          ...(typeof c.desc === "string" ? { desc: c.desc } : {}),
          ...(typeof c.qty === "number" ? { qty: c.qty } : {}),
          ...(typeof c.price === "number" ? { price: c.price } : {}),
          ...(typeof c.taxable === "boolean" ? { taxable: c.taxable } : {}),
        } : it),
      };
      setData(d => ({ ...d, invoices: d.invoices.map(i => i.id === inv.id ? updated : i) }));
      try { await db.upsertInvoice(updated, false); } catch (e) { console.error(e); }
    }
    if (parsed.action === "update_client") {
      const target = data.clients.find(c => c.name === parsed.clientName);
      if (!target) return;
      const c = parsed.changes || {};
      const updated = {
        ...target,
        ...(typeof c.email === "string" ? { email: c.email } : {}),
        ...(typeof c.email2 === "string" ? { email2: c.email2 } : {}),
        ...(typeof c.phone === "string" ? { phone: c.phone, mobile: c.phone } : {}),
        ...(typeof c.address1 === "string" ? { address1: c.address1 } : {}),
        ...(typeof c.address2 === "string" ? { address2: c.address2 } : {}),
        ...(typeof c.address3 === "string" ? { address3: c.address3 } : {}),
      };
      try { await db.updateClient(updated); db.recordClientVersion(updated, "AI updated").catch(() => {}); } catch (e) { console.error(e); }
      setData(d => ({ ...d, clients: d.clients.map(cc => cc.id === target.id ? updated : cc) }));
    }
    if (parsed.action === "delete_client") {
      const target = data.clients.find(c => c.name === parsed.clientName);
      if (!target) return;
      try { await db.deleteClient(target.id); } catch (e) { console.error(e); }
      setData(d => ({ ...d, clients: d.clients.filter(cc => cc.id !== target.id) }));
    }
  };

  const updateInvoice = async (form) => {
    const year = new Date(form.date || today()).getFullYear();
    if (selected) {
      const updated = { ...form, id: selected.id, year };
      // Update local state first so the UI is always responsive,
      // even if the Supabase write later throws.
      setData(d => ({ ...d, invoices: d.invoices.map(inv => inv.id === selected.id ? updated : inv) }));
      try { await db.upsertInvoice(updated, false); }
      catch (e) { console.error('Save failed (kept local copy):', e); alert('Saved locally. Cloud sync failed: ' + (e.message || e)); }
    } else {
      // Estimates and invoices use independent counters: EST#### vs INV####.
      const isEst = form.type === "estimate";
      const num = isEst ? nextEstimateNumRef.current++ : nextNumRef.current++;
      const id = `${isEst ? "EST" : "INV"}${String(num).padStart(4, "0")}`;
      const newInv = { ...form, id, year };
      setData(d => ({
        ...d,
        invoices: [newInv, ...d.invoices],
        nextNum: isEst ? d.nextNum : Math.max(d.nextNum, num + 1),
        nextEstimateNum: isEst ? Math.max(d.nextEstimateNum || 712, num + 1) : (d.nextEstimateNum || 712),
      }));
      try { await db.upsertInvoice(newInv, true); }
      catch (e) { console.error('Save failed (kept local copy):', e); alert('Saved locally. Cloud sync failed: ' + (e.message || e)); }
    }
    // Always return to the list, regardless of cloud sync result.
    setView("list"); setSelected(null);
  };

  const deleteInvoice = async (id) => {
    try {
      await db.deleteInvoice(id);
    } catch (e) {
      console.error('Delete invoice failed:', e);
      alert('Could not delete this invoice: ' + (e.message || e));
      return;
    }
    // Clean up the per-invoice AI chat history so we don't accumulate
    // orphan localStorage keys for invoices that no longer exist.
    try { localStorage.removeItem(`higrade_inv_chat_${id}`); } catch {}
    setData(d => ({ ...d, invoices: d.invoices.filter(inv => inv.id !== id) }));
    setView("list"); setSelected(null);
  };

  // ─── Quick-action handlers (used by the long-press action sheet on the
  // invoice list). All accept the full invoice object so they don't need
  // to look it up themselves.

  // Build a PDF Blob via the same helper the public viewer uses, so the
  // shared/printed file matches what the customer would see.
  const buildInvoicePdfBlob = async (inv) => {
    const mod = await import('./printablePdf.js');
    const t = calcTotals(inv);
    const lateFee = calcLateFee(inv, t);
    const paymentInstructions = inv.type === 'estimate' ? '' : resolvePaymentInstructions();
    const photos = inv.id ? await fetchInvoicePhotos(inv.id) : [];
    return await mod.buildPrintablePdf(inv, { lateFee, paymentInstructions, photos });
  };

  const shareInvoice = async (inv) => {
    try {
      const blob = await buildInvoicePdfBlob(inv);
      const filename = `${inv.id || 'invoice'}.pdf`;
      const file = new File([blob], filename, { type: 'application/pdf' });
      // navigator.share with files works on iOS Safari + Chrome Android.
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: inv.id, text: `${inv.id} - ${inv.client || ''}` });
        return;
      }
      // Fallback: open the PDF in a new tab so the user can use the browser's
      // own share/save controls.
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank', 'noopener,noreferrer');
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (err) {
      if (err && err.name === 'AbortError') return; // user cancelled
      console.error('Share failed:', err);
      alert('Could not share this invoice: ' + (err.message || err));
    }
  };

  const sendInvoice = (inv) => {
    // The send flow lives inside the invoice form (which has its own
    // email-vs-text picker). Open the form AND tell it to pop the same
    // send-method sheet the Send Email button triggers, so the long-press
    // Send action behaves identically to opening the invoice and tapping Send.
    setSelected(inv);
    setView('form');
    setAutoSendKind(inv?.type === 'estimate' ? 'estimate' : 'invoice');
  };

  const printInvoice = async (inv) => {
    try {
      const blob = await buildInvoicePdfBlob(inv);
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank', 'noopener,noreferrer');
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (err) {
      console.error('Print failed:', err);
      alert('Could not generate the PDF. Please try again.');
    }
  };

  const copyInvoiceLink = async (inv) => {
    try {
      let token = inv.viewToken;
      if (!token) {
        token = await db.ensureViewToken(inv);
        // Persist the token onto the in-memory invoice so the next call is a
        // no-op and the form's share button shows the same URL.
        const updated = { ...inv, viewToken: token };
        setData(d => ({ ...d, invoices: d.invoices.map(i => i.id === inv.id ? updated : i) }));
      }
      const link = `${window.location.origin}/v/${token}`;
      await navigator.clipboard.writeText(link);
      alert(`Link copied:\n${link}`);
    } catch (err) {
      console.error('Copy link failed:', err);
      alert('Could not copy the link: ' + (err.message || err));
    }
  };

  // Toggle paid/unpaid via a synthetic payment row tagged with note
  // "Marked paid" so the action is reversible without nuking real payments.
  const toggleInvoicePaid = async (inv) => {
    const isPaid = inv.status === 'paid';
    let updated;
    if (isPaid) {
      // Strip only synthetic rows — preserve any real payments the user logged.
      const payments = (inv.payments || []).filter(p => p.note !== 'Marked paid');
      const t = calcTotals({ ...inv, payments });
      const status = payments.length === 0
        ? (inv.status === 'net30' ? 'net30' : 'outstanding')
        : (t.balance <= 0.01 ? 'paid' : 'partial');
      updated = { ...inv, payments, status };
    } else {
      const t = calcTotals(inv);
      const balance = Math.max(0, t.balance);
      const synthetic = {
        id: Date.now() + Math.floor(Math.random() * 100000),
        amount: balance,
        method: 'Other',
        date: today(),
        note: 'Marked paid',
      };
      const payments = [...(inv.payments || []), synthetic];
      updated = { ...inv, payments, status: 'paid' };
    }
    setData(d => ({ ...d, invoices: d.invoices.map(i => i.id === inv.id ? updated : i) }));
    try { await db.upsertInvoice(updated, false); }
    catch (e) { console.error('Toggle paid failed (kept local copy):', e); alert('Saved locally. Cloud sync failed: ' + (e.message || e)); }
  };

  // Persist a payment recorded via PaymentModal from the quick-actions menu.
  // The modal already builds the updated invoice (new payment row + status).
  const recordPayment = async (updated) => {
    setData(d => ({ ...d, invoices: d.invoices.map(i => i.id === updated.id ? updated : i) }));
    try { await db.upsertInvoice(updated, false); }
    catch (e) { console.error('Record payment failed (kept local copy):', e); alert('Saved locally. Cloud sync failed: ' + (e.message || e)); }
  };

  const duplicateInvoice = async (inv) => {
    const isEst = inv.type === 'estimate';
    const idPrefix = isEst ? 'EST' : 'INV';
    const counterRef = isEst ? nextEstimateNumRef : nextNumRef;
    const num = counterRef.current++;
    const newId = `${idPrefix}${String(num).padStart(4, '0')}`;
    const copy = {
      ...inv,
      id: newId,
      date: today(),
      year: new Date().getFullYear(),
      payments: [],
      viewToken: undefined,
      signature: undefined,
      signatureDate: undefined,
      status: isEst ? 'outstanding' : 'outstanding',
    };
    setData(d => ({
      ...d,
      invoices: [copy, ...d.invoices],
      nextNum: isEst ? d.nextNum : Math.max(d.nextNum, num + 1),
      nextEstimateNum: isEst ? Math.max(d.nextEstimateNum || 712, num + 1) : (d.nextEstimateNum || 712),
    }));
    try { await db.upsertInvoice(copy, true); }
    catch (e) { console.error('Duplicate failed (kept local copy):', e); alert('Saved locally. Cloud sync failed: ' + (e.message || e)); }
    setSelected(copy);
    setView('form');
  };

  const saveClient = async (form, editing) => {
    if (editing === "new") {
      const id = await db.insertClient(form);
      const saved = { ...form, id };
      setData(d => ({ ...d, clients: [...d.clients, saved] }));
      db.recordClientVersion(saved, "Created").catch(() => {});
    } else {
      const saved = { ...form, id: editing };
      await db.updateClient(saved);
      setData(d => ({ ...d, clients: d.clients.map(c => c.id === editing ? saved : c) }));
      db.recordClientVersion(saved, "Saved").catch(() => {});
    }
  };

  // Bulk-insert path used by the CSV importer. Same as saveClient(form, "new")
  // but exposed as its own handler so the importer can call it per-row
  // sequentially. Each call updates state immediately, so the Clients list
  // animates as rows land.
  const importClient = async (form) => {
    const id = await db.insertClient(form);
    setData(d => ({ ...d, clients: [...d.clients, { ...form, id }] }));
    return id;
  };

  const saveItemToLibrary = async (item) => {
    const id = await db.insertSavedItem({ category: "Custom", name: item.name, price: item.price });
    setData(d => ({ ...d, savedItems: [...d.savedItems, { id, category: "Custom", name: item.name, price: item.price }] }));
  };

  // Convert estimate ↔ invoice. Creates a NEW document (separate ID) so the
  // original is preserved (change-order friendly).
  const convertInvoice = async (form, targetType) => {
    const year = new Date(form.date || today()).getFullYear();
    // Pick the right counter based on what we're minting. Belt-and-suspenders:
    // also clamp to highest existing id of that type so we never collide.
    const isEstTarget = targetType === "estimate";
    const idPrefix = isEstTarget ? "EST" : "INV";
    const idRegex = isEstTarget ? /^EST(\d+)$/ : /^INV(\d+)$/;
    const highestExisting = data.invoices.reduce((mx, inv) => {
      if (inv.type !== targetType) return mx;
      const m = idRegex.exec(inv.id || "");
      return m ? Math.max(mx, parseInt(m[1], 10)) : mx;
    }, 0);
    const counterRef = isEstTarget ? nextEstimateNumRef : nextNumRef;
    const num = Math.max(counterRef.current, highestExisting + 1);
    counterRef.current = num + 1;
    const newId = `${idPrefix}${String(num).padStart(4, "0")}`;
    // Carry payments forward (e.g. a down payment recorded on an estimate
    // becomes the opening paid balance on the new invoice). Stamp each
    // copied payment with a fresh id so the DB doesn't see a primary-key
    // collision against the source document's payment rows.
    const carriedPayments = (form.payments || []).map(p => ({
      ...p,
      id: Date.now() + Math.floor(Math.random() * 100000),
      note: p.note || (targetType === "invoice" ? "Down payment (from estimate)" : ""),
    }));
    const totals = calcTotals(form);
    const carriedPaid = carriedPayments.reduce((s, p) => s + p.amount, 0);
    // Status of the new doc:
    //   estimate → invoice: "paid" if deposit covers it, "partial" if some,
    //                       "outstanding" if none.
    //   invoice  → estimate: always "outstanding".
    const initialStatus = targetType === "invoice"
      ? (carriedPaid >= totals.total - 0.01 ? "paid" : carriedPaid > 0 ? "partial" : "outstanding")
      : "outstanding";
    const copy = {
      ...form,
      id: newId,
      type: targetType,
      year,
      // Carry payments over; reset only signature + scheduling state.
      payments: carriedPayments,
      signatureData: null,
      signedAt: null,
      status: initialStatus,
      gcalEventId: null,
      gcalDate: null,
      followUpEventId: null,
      followUpDate: null,
      // Don't carry the convertedToId or viewToken from the source — the copy
      // is brand new and viewToken must be unique across all invoices.
      convertedToId: null,
      viewToken: null,
      notes: form.notes ? form.notes : "",
    };
    // Two flows:
    //   estimate → invoice: KEEP the source estimate, stamp it with
    //                       convertedToId so the Estimates list counts it
    //                       as "closed" (records of every signed estimate).
    //   invoice  → estimate: DELETE the source invoice. Going back to an
    //                       estimate means the invoice was sent prematurely
    //                       — we don't want two competing copies.
    const deleteSource = targetType === "estimate";
    if (deleteSource) {
      setData(d => ({
        ...d,
        invoices: [copy, ...d.invoices.filter(inv => inv.id !== form.id)],
        nextNum: isEstTarget ? d.nextNum : Math.max(d.nextNum, num + 1),
        nextEstimateNum: isEstTarget ? Math.max(d.nextEstimateNum || 712, num + 1) : (d.nextEstimateNum || 712),
      }));
    } else {
      const sourceUpdated = { ...form, convertedToId: newId };
      setData(d => ({
        ...d,
        invoices: [copy, ...d.invoices.map(inv => inv.id === form.id ? sourceUpdated : inv)],
        nextNum: isEstTarget ? d.nextNum : Math.max(d.nextNum, num + 1),
        nextEstimateNum: isEstTarget ? Math.max(d.nextEstimateNum || 712, num + 1) : (d.nextEstimateNum || 712),
      }));
    }
    try {
      await db.upsertInvoice(copy, true);
      if (deleteSource) {
        await db.deleteInvoice(form.id);
      } else {
        // Before stamping convertedToId on the source estimate, delete any
        // invoices that share its viewToken. Those are orphans left by a
        // previous failed conversion (step 1 succeeded but step 2 threw),
        // and they block the unique constraint on view_token.
        if (form.viewToken) {
          const orphanIds = await db.deleteOrphansByViewToken(form.viewToken, form.id);
          if (orphanIds.length) {
            setData(d => ({ ...d, invoices: d.invoices.filter(inv => !orphanIds.includes(inv.id)) }));
          }
        }
        await db.upsertInvoice({ ...form, convertedToId: newId }, false);
      }
    } catch (e) { console.error('Convert/save failed (kept local copy):', e); alert('Conversion saved locally. Cloud sync failed: ' + (e.message || e)); }
    // Open the new doc immediately.
    setSelected(copy);
    setView("form");
    setTab(targetType === "estimate" ? "estimates" : "invoices");
  };

  const partialSaveInvoice = async (updated) => {
    if (!selected?.id) return;
    const year = new Date(updated.date || today()).getFullYear();
    // Carry updatedAt from the loaded copy so the RPC's optimistic-lock check
    // can detect concurrent edits from another device.
    const withMeta = { ...updated, id: selected.id, year, updatedAt: updated.updatedAt ?? selected.updatedAt };
    try {
      const res = await db.upsertInvoice(withMeta, false);
      const stamped = { ...withMeta, updatedAt: res?.updatedAt || withMeta.updatedAt };
      setData(d => ({ ...d, invoices: d.invoices.map(inv => inv.id === selected.id ? stamped : inv) }));
    } catch (e) {
      if (e?.code === 'CONCURRENT_EDIT') {
        // Self-heal: a concurrent write touched updated_at (often it's our
        // own auto-save still in flight, or a bulk backend script). Re-fetch
        // the freshest token and retry once — only show the alert if the
        // retry also fails. Without this retry, signing on iPhone almost
        // always tripped the "updated on another device" message because
        // the signature modal save raced the autosave triggered by the
        // status flip.
        try {
          const freshUpdatedAt = await db.fetchInvoiceUpdatedAt(selected.id);
          const retried = { ...withMeta, updatedAt: freshUpdatedAt };
          const res2 = await db.upsertInvoice(retried, false);
          const stamped = { ...retried, updatedAt: res2?.updatedAt || freshUpdatedAt };
          setData(d => ({ ...d, invoices: d.invoices.map(inv => inv.id === selected.id ? stamped : inv) }));
        } catch (e2) {
          if (e2?.code === 'CONCURRENT_EDIT') {
            alert('This invoice was updated on another device. Pull down to refresh, then re-apply your changes.');
          } else {
            console.error('Partial-save retry failed:', e2);
          }
        }
      } else {
        console.error('Auto-save failed:', e);
      }
    }
  };

  // Silent auto-save — persists the form without navigating away. Creates a
  // new invoice on first call (assigning the next ID) and updates in place
  // thereafter. Returns the saved record so the form can lock onto its ID.
  const autoSaveInvoice = async (form) => {
    const year = new Date(form.date || today()).getFullYear();
    // Existing record — just update.
    if (form.id || selected?.id) {
      const id = form.id || selected.id;
      // Preserve the updatedAt token from whichever copy has the freshest one.
      const carriedUpdatedAt = form.updatedAt ?? selected?.updatedAt ?? null;
      const updated = { ...form, id, year, updatedAt: carriedUpdatedAt };
      setData(d => ({
        ...d,
        invoices: d.invoices.some(inv => inv.id === id)
          ? d.invoices.map(inv => inv.id === id ? updated : inv)
          : [updated, ...d.invoices],
      }));
      let stamped = updated;
      try {
        const res = await db.upsertInvoice(updated, false);
        stamped = { ...updated, updatedAt: res?.updatedAt || updated.updatedAt };
        setData(d => ({ ...d, invoices: d.invoices.map(inv => inv.id === id ? stamped : inv) }));
      } catch (e) {
        if (e?.code === 'CONCURRENT_EDIT') {
          // Self-heal: the row was touched outside this client (could be a
          // genuine concurrent edit, or a backend-side bulk script bumped
          // updated_at). Re-fetch the freshest token and retry once. Only
          // surface the alert if the second attempt also fails — then it's
          // almost certainly a real concurrent edit.
          try {
            const freshUpdatedAt = await db.fetchInvoiceUpdatedAt(id);
            const retried = { ...updated, updatedAt: freshUpdatedAt };
            const res2 = await db.upsertInvoice(retried, false);
            stamped = { ...retried, updatedAt: res2?.updatedAt || freshUpdatedAt };
            setData(d => ({ ...d, invoices: d.invoices.map(inv => inv.id === id ? stamped : inv) }));
          } catch (e2) {
            if (e2?.code === 'CONCURRENT_EDIT') {
              alert('This invoice was updated on another device. Pull down to refresh, then re-apply your changes.');
            } else {
              console.error('Auto-save retry failed (kept local copy):', e2);
            }
          }
        } else {
          console.error('Auto-save failed (kept local copy):', e);
        }
      }
      if (!selected || selected.id !== id) setSelected(stamped);
      return stamped;
    }
    // New record — mint an ID. Estimates and invoices use independent counters.
    const isEst = form.type === "estimate";
    const counterRef = isEst ? nextEstimateNumRef : nextNumRef;
    const num = counterRef.current++;
    const id = `${isEst ? "EST" : "INV"}${String(num).padStart(4, "0")}`;
    const created = { ...form, id, year };
    setData(d => ({
      ...d,
      invoices: [created, ...d.invoices],
      nextNum: isEst ? d.nextNum : Math.max(d.nextNum, num + 1),
      nextEstimateNum: isEst ? Math.max(d.nextEstimateNum || 712, num + 1) : (d.nextEstimateNum || 712),
    }));
    setSelected(created);
    let stamped = created;
    try {
      const res = await db.upsertInvoice(created, true);
      stamped = { ...created, updatedAt: res?.updatedAt || null };
      setData(d => ({ ...d, invoices: d.invoices.map(inv => inv.id === id ? stamped : inv) }));
      setSelected(stamped);
    } catch (e) {
      console.error('Auto-save (create) failed (kept local copy):', e);
    }
    return stamped;
  };

  const removeClient = async (id) => {
    try {
      await db.deleteClient(id);
    } catch (e) {
      console.error('Delete client failed:', e);
      // 23503 = foreign key violation. Should be impossible after migration
      // 007, but keep a friendly message in case someone is on an old schema.
      if (String(e?.code) === '23503' || /foreign key/i.test(e?.message || '')) {
        alert('Cannot delete this client — they still have invoices linked to them. Update the database to allow this (run migration 007).');
      } else {
        alert('Could not delete this client: ' + (e.message || e));
      }
      return;
    }
    // Locally clear the client_id on any cached invoices so the list view stays consistent.
    setData(d => ({
      ...d,
      clients: d.clients.filter(c => c.id !== id),
      invoices: d.invoices.map(inv => inv.client_id === id ? { ...inv, client_id: null } : inv),
    }));
  };

  const removeSavedItem = async (id) => {
    try {
      await db.deleteSavedItem(id);
    } catch (e) {
      console.error('Delete saved item failed:', e);
      alert('Could not delete this item: ' + (e.message || e));
      return;
    }
    setData(d => ({ ...d, savedItems: d.savedItems.filter(i => i.id !== id) }));
  };

  // Public routes — must come before the auth + dbLoading gates so customers
  // can view/sign/pay invoices without an owner account.
  if (window.location.pathname === "/sign") return <SignaturePage />;
  if (window.location.pathname.startsWith("/v/")) {
    const token = window.location.pathname.slice(3);
    return <PublicViewerPage token={token} />;
  }

  // Auth gate. While we're still resolving the session, show the same
  // navy splash so the page doesn't flicker through a flash of LoginScreen
  // for already-signed-in users.
  if (session === undefined) return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", background: NAVY }}>
      <div style={{ color: ORANGE, fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 22, letterSpacing: 2 }}>HI GRADE PLUMBING</div>
    </div>
  );
  if (!session) return <LoginScreen onSuccess={() => { /* auth listener flips session */ }} />;

  if (dbLoading) return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", background: NAVY, flexDirection: "column", gap: 16 }}>
      <div style={{ color: ORANGE, fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 22, letterSpacing: 2 }}>HI GRADE PLUMBING</div>
      <div style={{ color: "#8899bb", fontSize: 13 }}>Loading…</div>
    </div>
  );

  // Local memos kept for any leftover uses; both honor the View-as filter so
  // counts stay consistent with what the user actually sees in tab content.
  const invoices = (filteredData.invoices || []).filter(i => i.type !== "estimate");
  const estimates = (filteredData.invoices || []).filter(i => i.type === "estimate");

  // 4 main tabs visible in the bottom bar; the rest live inside a “More” sheet.
  const mainNavItems = [
    { id: "invoices",  label: "Invoices",  icon: "invoice"   },
    { id: "estimates", label: "Estimates", icon: "estimates" },
    { id: "expenses",  label: "Expenses",  icon: "receipt"   },
    { id: "clients",   label: "Clients",   icon: "clients"   },
  ];
  const moreNavItems = [
    { id: "payments",  label: "Payments",   icon: "dollar"   },
    { id: "pricebook", label: "Price Book", icon: "items"    },
    { id: "reports",   label: "Reports",    icon: "chart"    },
    { id: "calendar", label: "Calendar", icon: "calendar" },
    { id: "settings", label: "Settings", icon: "settings" },
  ];
  // Highlight “More” when the active tab lives inside the sheet.
  const isMoreTab = moreNavItems.some(n => n.id === tab);

  return (
    <div ref={rootRef} style={{ fontFamily: "'Barlow', sans-serif", background: LIGHT, minHeight: "100vh", maxWidth: 480, width: "100%", margin: "0 auto", position: "relative", paddingBottom: view === "list" ? 80 : 0 }}>
      {/* Edge-swipe-back visual indicator: a thin orange bar on the left
          edge that grows with the drag. Only renders while a swipe is in
          progress (edgeSwipeX > 0). Pointer-events: none so it can't
          intercept touches. */}
      {edgeSwipeX > 0 && (
        <div style={{ position: "fixed", top: 0, left: 0, height: "100vh", width: Math.min(edgeSwipeX, 120), background: `linear-gradient(90deg, ${ORANGE}cc 0%, ${ORANGE}33 70%, transparent 100%)`, pointerEvents: "none", zIndex: 9999, transition: "none" }} />
      )}

      {/* Pull-to-refresh indicator: a circular spinner that descends from
          the top of the viewport as the user pulls down. Goes solid orange
          past the trigger threshold, and animates while a refresh is in
          flight. Pointer-events:none so it never blocks touch. */}
      {(ptrPull > 0 || ptrRefreshing) && (
        <div style={{
          position: "fixed", top: 0, left: "50%",
          transform: `translate(-50%, ${ptrRefreshing ? 24 : Math.min(ptrPull * 0.45, 60)}px)`,
          width: 36, height: 36, borderRadius: "50%",
          background: "#fff",
          boxShadow: "0 2px 8px rgba(10,22,40,0.25)",
          display: "flex", alignItems: "center", justifyContent: "center",
          zIndex: 9999, pointerEvents: "none",
          transition: ptrRefreshing ? "transform 0.2s ease" : "none",
          opacity: ptrRefreshing ? 1 : Math.min(1, ptrPull / 60),
        }}>
          <div style={{
            width: 20, height: 20, borderRadius: "50%",
            border: `2.5px solid ${ORANGE}`,
            borderTopColor: ptrRefreshing ? "transparent" : (ptrPull > 80 ? ORANGE : "#ffd6bf"),
            animation: ptrRefreshing ? "hi-spin 0.7s linear infinite" : "none",
            transform: ptrRefreshing ? "none" : `rotate(${ptrPull * 4}deg)`,
          }} />
        </div>
      )}
      <style>{`@keyframes hi-spin { to { transform: rotate(360deg); } }`}</style>
      {showGlobalAI && <GlobalAIModal data={data} msgs={globalAIMsgs || []} setMsgs={setGlobalAIMsgs} onResetChat={resetGlobalAIChat} onClose={() => setShowGlobalAI(false)} onAction={handleGlobalAIAction} onOpenDoc={(inv) => { setShowGlobalAI(false); setSelected(inv); setView("form"); }} onOpenClient={(cl) => { setShowGlobalAI(false); setView("list"); setTab("clients"); setOpenClientId(cl.id); }} />}

      {view === "list" && (
        <div style={{ position: "sticky", top: 0, zIndex: 100, boxShadow: "0 2px 12px rgba(0,0,0,0.3)" }}>
          <div style={{ background: NAVY, padding: "16px 20px 12px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ color: "#fff", fontSize: 18, fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, letterSpacing: 1.5, lineHeight: 1.1, display: "flex", alignItems: "center", gap: 8 }}>
                HI GRADE PLUMBING
                {isAdmin && <span style={{ background: ORANGE, color: "#fff", fontSize: 9, fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, letterSpacing: 1.2, padding: "2px 6px", borderRadius: 4 }}>ADMIN</span>}
              </div>
              <span style={{ color: ORANGE, fontSize: 10, letterSpacing: 3, fontWeight: 600, textTransform: "uppercase" }}>
                {effectiveOwnerId
                  ? `Viewing as · ${(allUsers.find(u => u.id === effectiveOwnerId)?.displayName) || "user"}`
                  : (profile?.display_name ? `${profile.display_name.toUpperCase()}` : "LLC · HONOLULU")}
              </span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              {(tab === "invoices" || tab === "estimates" || tab === "expenses") && (
                <button
                  onClick={() => {
                    if (tab === "invoices")  { setSelected(null); setNewDocType("invoice");  setView("form"); }
                    else if (tab === "estimates") { setSelected(null); setNewDocType("estimate"); setView("form"); }
                    else if (tab === "expenses") { setExpenseNewToken(t => t + 1); }
                  }}
                  aria-label="New"
                  style={{ width: 36, height: 36, background: ORANGE, borderRadius: 8, border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", padding: 0 }}
                >
                  <Icon name="plus" size={20} color="#fff" />
                </button>
              )}
              <NotificationsBell
                onOpenInvoice={(invoiceId) => {
                  const inv = data.invoices.find(i => i.id === invoiceId);
                  if (inv) { setSelected(inv); setView("form"); }
                }}
              />
              <button
                onClick={() => setShowGlobalAI(true)}
                aria-label="AI assistant"
                style={{ width: 36, height: 36, background: "transparent", borderRadius: 8, border: `2px solid ${ORANGE}`, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", padding: 0 }}
              >
                <Icon name="ai" size={18} color={ORANGE} />
              </button>
            </div>
          </div>
          {subHeader.key === tab ? subHeader.content : null}
        </div>
      )}

      <>
        {tab === "invoices"  && <InvoiceList invoices={(filteredData.invoices || []).filter(i => i.type !== "estimate")} setSubHeader={setSubHeader} onNew={() => { setSelected(null); setNewDocType("invoice"); setView("form"); }} onSelect={inv => { setSelected(inv); setView("form"); }} onDelete={deleteInvoice} onShare={shareInvoice} onSend={sendInvoice} onPrint={printInvoice} onGetLink={copyInvoiceLink} onTogglePaid={toggleInvoicePaid} onRecordPayment={recordPayment} onDuplicate={duplicateInvoice} />}
        {tab === "estimates" && <EstimatesTab invoices={(filteredData.invoices || []).filter(i => i.type === "estimate")} setSubHeader={setSubHeader} onNew={() => { setSelected(null); setNewDocType("estimate"); setView("form"); }} onSelect={inv => { setSelected(inv); setView("form"); }} onDelete={deleteInvoice} onShare={shareInvoice} onSend={sendInvoice} onPrint={printInvoice} onGetLink={copyInvoiceLink} onConvert={(inv) => convertInvoice(inv, "invoice")} onDuplicate={duplicateInvoice} />}
        {tab === "clients"   && <ClientsTab clients={filteredData.clients} invoices={filteredData.invoices} onSave={saveClient} onDelete={removeClient} onImportClient={importClient} onSelectInvoice={inv => { setSelected(inv); setView("form"); }} openClientId={openClientId} onOpenedClient={() => setOpenClientId(null)} isAdmin={isAdmin} />}
        {tab === "items"     && <ItemsTab savedItems={filteredData.savedItems} onDelete={removeSavedItem} />}
        {tab === "payments"  && <PaymentsTab invoices={filteredData.invoices} />}
        {tab === "expenses"  && <ExpensesTab expenses={filteredData.expenses || []} onSave={addExpense} onDelete={deleteExpense} newToken={expenseNewToken} />}
        {tab === "reports"   && <ReportsTab invoices={filteredData.invoices} expenses={filteredData.expenses || []} />}
        {tab === "calendar"  && <CalendarTab invoices={filteredData.invoices} gcalAuthed={gcalAuthed} onAuthChange={setGcalAuthed} />}
        {tab === "settings"  && <SettingsTab onAfterRestore={() => window.location.reload()} profile={profile} isAdmin={isAdmin} allUsers={allUsers} viewAsUserId={viewAsUserId} setViewAsUserId={setViewAsUserId} refreshUsers={refreshUsers} />}
      </>

      {formMounted && (
        <div style={{ position: "fixed", top: 0, bottom: 0, left: "50%", width: "100%", maxWidth: 480, zIndex: 300, overflowY: "auto", background: NAVY, transform: formVisible ? "translateX(-50%)" : "translateX(calc(-50% + 100vw))", transition: `transform ${FORM_SLIDE_MS}ms cubic-bezier(0.25, 0.46, 0.45, 0.94)` }}>
          <InvoiceForm
            invoice={selected}
            defaultType={newDocType}
            clients={data.clients}
            savedItems={data.savedItems}
            gcalAuthed={gcalAuthed}
            data={data}
            onAIAction={handleGlobalAIAction}
            autoSendKind={autoSendKind}
            onAutoSendConsumed={() => setAutoSendKind(null)}
            onSave={updateInvoice}
            onPartialSave={partialSaveInvoice}
            onAutoSave={autoSaveInvoice}
            onCancel={() => { setView("list"); setSelected(null); }}
            onDelete={deleteInvoice}
            onSaveItem={saveItemToLibrary}
            onUpdateClient={async (updated) => {
              await db.updateClient(updated);
              db.recordClientVersion(updated, "Saved").catch(() => {});
              setData(d => ({ ...d, clients: d.clients.map(c => c.id === updated.id ? { ...c, ...updated } : c) }));
            }}
            onCreateClient={async (form) => {
              const id = await db.insertClient(form);
              const newClient = { ...form, id };
              db.recordClientVersion(newClient, "Created").catch(() => {});
              setData(d => ({ ...d, clients: [...d.clients, newClient] }));
              return newClient;
            }}
            onOpenClient={(c) => { setView("list"); setTab("clients"); setOpenClientId(c.id); }}
            onConvert={convertInvoice}
            isAdmin={isAdmin}
          />
        </div>
      )}

      {view === "list" && (
        <nav style={{ position: "fixed", bottom: 0, left: "50%", transform: "translateX(-50%)", width: "100%", maxWidth: 480, background: NAVY, display: "flex", borderTop: `2px solid ${ORANGE}`, zIndex: 200, paddingBottom: "env(safe-area-inset-bottom)" }}>
          {mainNavItems.map(n => (
            <button key={n.id} onClick={() => setTab(n.id)} style={{ flex: 1, padding: "10px 2px 8px", background: "none", border: "none", cursor: "pointer", color: tab === n.id ? ORANGE : "#8899bb", fontSize: 9, fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, letterSpacing: 0.5, textTransform: "uppercase", display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
              <Icon name={n.icon} size={20} color={tab === n.id ? ORANGE : "#8899bb"} />
              {n.label}
            </button>
          ))}
          <button onClick={() => setShowMore(true)} style={{ flex: 1, padding: "10px 2px 8px", background: "none", border: "none", cursor: "pointer", color: isMoreTab ? ORANGE : "#8899bb", fontSize: 9, fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, letterSpacing: 0.5, textTransform: "uppercase", display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
            <Icon name="more" size={20} color={isMoreTab ? ORANGE : "#8899bb"} />
            More
          </button>
        </nav>
      )}

      {showPriceBook && (
        <PriceBook
          items={data.savedItems}
          onSelect={async item => {
            setShowPriceBook(false);
            try {
              const newInv = await handleGlobalAIAction({
                action: "create_invoice",
                invoice: { date: today(), dueDate: today(), items: [{ name: item.name, desc: item.desc || "", qty: 1, price: item.price, taxable: item.taxable, unit: item.unit || "ea", discount: 0, discountType: "%" }], tax: TAX_RATE, discount: 0 },
              });
              if (newInv) { setSelected(newInv); setView("form"); setNewDocType("invoice"); }
            } catch (e) { alert("Could not create invoice: " + (e.message || e)); }
          }}
          onClose={() => setShowPriceBook(false)}
        />
      )}
      {showMore && (
        <div onClick={() => setShowMore(false)} style={{ position: "fixed", inset: 0, background: "rgba(10,22,40,0.55)", zIndex: 300, display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
          <div onClick={e => e.stopPropagation()} style={{ width: "100%", maxWidth: 480, background: "#fff", borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: "10px 0 max(20px, env(safe-area-inset-bottom))", boxShadow: "0 -8px 24px rgba(0,0,0,0.18)" }}>
            <div style={{ width: 40, height: 4, background: "#dde2ee", borderRadius: 2, margin: "4px auto 12px" }} />
            <div style={{ padding: "0 18px 8px", fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 13, color: "#8899bb", letterSpacing: 1.5, textTransform: "uppercase" }}>More</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 4, padding: "4px 8px 8px" }}>
              {moreNavItems.map(n => (
                <button key={n.id} onClick={() => { if (n.id === "pricebook") { setShowPriceBook(true); setShowMore(false); } else { setTab(n.id); setShowMore(false); } }} style={{ background: tab === n.id ? "#fff5ef" : "none", border: "none", cursor: "pointer", padding: "14px 4px", borderRadius: 12, display: "flex", flexDirection: "column", alignItems: "center", gap: 6, color: tab === n.id ? ORANGE : NAVY, fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 11, letterSpacing: 0.5, textTransform: "uppercase" }}>
                  <Icon name={n.icon} size={26} color={tab === n.id ? ORANGE : NAVY} />
                  {n.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
