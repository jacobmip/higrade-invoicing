// Payment method spellings: one canonical vocabulary, read by every renderer.
//
// payments.method is plain nullable text — no default, no CHECK constraint, no
// trigger (migration 001, line 60) — and for a long time nothing normalized it
// on the way in. By 2026-10-16 the table held fifteen spellings of eight
// methods: "CHECK" on 207 rows, "Check" on 41, "check" on 1, plus "PAYPAL",
// "CASH", "OTHER" and three labels inherited from the old app. The cause was
// free-text writers — the in-app AI chat and the Telegram manager both stored
// whatever string they were handed. Those rows were repaired on 2026-10-16
// (AI-OS commits 4703844 and 456ef22). This module is what stops them drifting
// back, and what makes every reader agree about a spelling it has not seen.
//
// Two rules, and the order matters:
//   1. Match case-insensitively against PAYMENT_METHODS.
//   2. Pass an UNRECOGNISED value through unchanged.
//
// Rule 2 is deliberate. Relabelling a method we do not recognise would quietly
// rewrite what Jake actually recorded, and a payment is money — an unfamiliar
// spelling should look wrong on screen so it gets noticed, never look like
// something else. The same reasoning is why PaymentModal keeps an unknown
// stored value as its own <option> instead of snapping it to the first one.

export const PAYMENT_METHODS = [
  "Cash", "Check", "Venmo", "Zelle", "Credit Card", "PayPal", "Bank Transfer", "Other",
];

// Synonyms with a precedent, not guesses.
//   card / cc  — what the record_payment tool description suggested to the
//                model for months ("Cash, Check, Venmo, Zelle, Card, PayPal"),
//                so the model was being told to write a value no renderer knew.
//   bank       — how the old app labelled a transfer. The 2026-10-16 repair
//                mapped its one "BANK" row to Bank Transfer, so this agrees
//                with what is already in the table.
// Anything else is left alone on purpose. Do not add a mapping here to tidy up
// a label without checking what the stored rows mean first.
//
// Object.create(null), not a plain literal: a literal inherits Object.prototype,
// so ALIASES["constructor"] is the Object constructor and canonicalMethod would
// hand back a function instead of a string. A stored method of "constructor" or
// "__proto__" is exactly the free-text input this module exists to contain, so
// the lookup tables must not have a prototype at all.
const ALIASES = Object.assign(Object.create(null), {
  card: "Credit Card",
  cc: "Credit Card",
  bank: "Bank Transfer",
});

// "" for a missing method, so callers keep their own fallback wording
// ('Payment' on the customer viewer, 'Cash' when opening a new PaymentModal).
export const canonicalMethod = (m) => {
  const stored = String(m ?? "").trim();
  if (!stored) return "";
  const key = stored.toLowerCase();
  return PAYMENT_METHODS.find((x) => x.toLowerCase() === key) || ALIASES[key] || stored;
};

// Colour and badge glyph per method, in one table instead of the three
// near-duplicate palettes that used to live in the invoice form, the Payments
// tab and the Reports tab.
//
// Collapsing them changes no pixel, and it is worth being precise about that:
// only the Reports copy had an explicit "Other" key, but the other two fell
// through to the same "#888" and the same "•" glyph, so Other already rendered
// grey on all three. The reason to have one table is that there was nowhere
// single to add a method, not that the three disagreed on screen.
//
// ORANGE is App.jsx's accent, inlined so this module stays dependency-free.
export const METHOD_STYLE = Object.assign(Object.create(null), {
  "Cash":          { color: "#27ae60", glyph: "$" },
  "Check":         { color: "#2980b9", glyph: "✓" },
  "Venmo":         { color: "#3D95CE", glyph: "V" },
  "Zelle":         { color: "#6B39A8", glyph: "Z" },
  "Credit Card":   { color: "#E8622A", glyph: "CC" },
  "PayPal":        { color: "#0070ba", glyph: "P" },
  "Bank Transfer": { color: "#16a085", glyph: "B" },
  "Other":         { color: "#888",    glyph: "•" },
});

const UNKNOWN_STYLE = { color: "#888", glyph: "•" };

export const methodStyle = (m) => METHOD_STYLE[canonicalMethod(m)] || UNKNOWN_STYLE;
