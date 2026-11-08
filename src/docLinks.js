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
// The estimate is frozen at conversion (v1.53.0): its line items, customer
// notes, tax and discount are what the customer approved, so the invoice's
// change orders never rewrite it. Conversion copies them to the invoice once;
// after that only internal notes (never shown to the customer) stay in step.
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
