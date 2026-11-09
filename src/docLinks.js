// The estimate and invoice of one job, kept together (v1.52.0).
//
// Two levels of "linked":
//
//   linkedDocIds()  every live document of the same job: the conversion link
//                   in either direction, a down-payment invoice, or the same
//                   number (EST1170 / INV1170, 1000 and up). Used for READS
//                   only: photos and history from all of them show on each.
//
//   syncPartner()   the one document whose INTERNAL NOTES are copied on every
//                   save. Only the conversion link (convertedToId), never a
//                   down-payment invoice, and only for pairs made on or after
//                   SYNC_SINCE.
//
// The invoice never rewrites the estimate (v1.53.0): the estimate's line
// items, customer notes, tax and discount are what the customer approved.
// Conversion copies them to the invoice once; after that internal notes stay
// in step both ways, and since v1.64.1 a line changed on the estimate is
// changed on the invoice too (applyItemDiff below), one way only.
// v1.52.0 synced all of them, which let an invoice change rewrite a signed
// estimate. Payments, status, dates, signature, schedule and the customer link
// were always per document.

export const SYNC_SINCE = Date.parse('2026-11-07T14:00:00-10:00');

const numOf = (id) => {
  const n = parseInt((/^(?:EST|INV)(\d+)$/.exec(id || '') || [])[1], 10);
  return Number.isFinite(n) ? n : null;
};

export function linkedDocIds(doc, all) {
  if (!doc?.id) return [];
  const docs = all || [];
  const out = new Set();
  const add = (id) => { if (id && id !== doc.id && docs.some(d => d.id === id)) out.add(id); };
  add(doc.convertedToId);
  add(doc.downPaymentInvoiceId);
  for (const d of docs) {
    if (d.convertedToId === doc.id || d.downPaymentInvoiceId === doc.id) add(d.id);
  }
  const n = numOf(doc.id);
  if (n != null && n >= 1000) {
    const pad = String(n).padStart(4, '0');
    add(doc.type === 'estimate' ? `INV${pad}` : `EST${pad}`);
  }
  return [...out];
}

export function syncPartner(doc, all) {
  if (!doc?.id) return null;
  const docs = all || [];
  const partner = doc.type === 'estimate'
    ? docs.find(d => d.id === doc.convertedToId && d.type === 'invoice')
    : docs.find(d => d.type === 'estimate' && d.convertedToId === doc.id);
  if (!partner || partner.deletedAt) return null;
  // A document made this session has no createdAt yet: it is new.
  const made = (d) => (d.createdAt ? Date.parse(d.createdAt) : Date.now());
  if (Math.max(made(doc), made(partner)) < SYNC_SINCE) return null;
  return partner;
}

const normItems = (items) => (items || []).map(it => ({
  name: it.name || '', desc: it.desc || '', qty: Number(it.qty ?? 1), price: Number(it.price ?? 0),
  unit: it.unit || 'ea', discount: Number(it.discount ?? 0), discountType: it.discountType || '%',
  taxable: it.taxable !== false,
}));

// The fields that are the same on both documents.
export function sharedPatch(src) {
  return {
    items: normItems(src.items),
    notes: src.notes || '',
    internalNotes: typeof src.internalNotes === 'string' ? src.internalNotes : '',
    tax: Number(src.tax ?? 0),
    discount: Number(src.discount ?? 0),
    discountType: src.discountType || '$',
  };
}

export function sharedEqual(a, b) {
  return JSON.stringify(sharedPatch(a)) === JSON.stringify(sharedPatch(b));
}

// What syncLinkedDoc copies after a save: internal notes only.
export function syncPatch(src) {
  return { internalNotes: typeof src.internalNotes === 'string' ? src.internalNotes : '' };
}

export function syncEqual(a, b) {
  return syncPatch(a).internalNotes === syncPatch(b).internalNotes;
}

// ─── Estimate lines follow onto the invoice (v1.64.1) ───────────────────────
// A line Jake adds, edits or removes on a converted estimate is made the same
// way on its invoice. Only the change is applied (what this save did to the
// estimate), never a copy of the whole list, so the invoice's own lines and
// change order lines stay. One way only: invoice edits never touch the estimate.
// Any conversion link, whatever its age: a diff only carries what Jake just did.
export function itemSyncTarget(doc, all) {
  if (!doc?.id || doc.type !== 'estimate' || !doc.convertedToId) return null;
  const inv = (all || []).find(d => d.id === doc.convertedToId && d.type === 'invoice');
  return inv && !inv.deletedAt ? inv : null;
}

const CO_LINE = /^Change order #\d+, approved /;
const lineKey = (it) => JSON.stringify(normItems([it])[0]);

export function sameItems(a, b) {
  const ka = (a || []).map(lineKey), kb = (b || []).map(lineKey);
  return ka.length === kb.length && ka.every((k, i) => k === kb[i]);
}

// Returns the target's new item list, or null when nothing changes. Blank
// lines (no name, desc or price) are ignored on both sides.
export function applyItemDiff(prevItems, nextItems, targetItems) {
  const real = (it) => it && (it.name || it.desc || Number(it.price));
  const prev = (prevItems || []).filter(real), next = (nextItems || []).filter(real);
  const pool = new Map();
  for (const it of prev) { const k = lineKey(it); pool.set(k, [...(pool.get(k) || []), it]); }
  const added = [];
  for (const it of next) {
    const k = lineKey(it); const left = pool.get(k);
    if (left && left.length) left.shift(); else added.push(it);
  }
  const removed = [...pool.values()].flat();
  if (!added.length && !removed.length) return null;
  const out = [...(targetItems || [])];
  const clean = ({ id, ...it }) => it; // eslint-disable-line no-unused-vars
  for (const r of removed) {
    const k = lineKey(r);
    const idx = out.findIndex(t => !CO_LINE.test(t?.desc || '') && lineKey(t) === k);
    if (idx < 0) continue; // already gone or changed on the invoice
    if (added.length) out[idx] = clean(added.shift()); // an edit: same place
    else out.splice(idx, 1);
  }
  if (added.length) {
    const firstCo = out.findIndex(t => CO_LINE.test(t?.desc || ''));
    out.splice(firstCo < 0 ? out.length : firstCo, 0, ...added.map(clean));
  }
  return out;
}
