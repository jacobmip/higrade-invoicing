// GE half tax: the 0.5% GET rate billed to clients flagged as general
// contractors we work under (clients.ge_half_tax, migration 059).
//
// An invoice has no flag of its own. It is a GE half tax invoice exactly
// when its tax rate is 0.5%, so the per-invoice toggle just flips the rate
// between GE_HALF_RATE and the standard rate, and every renderer (form
// preview, customer viewer, PDF) decides whether to print the GE license
// number from the rate alone. No invoice column, nothing for
// save_invoice_with_items to carry.

export const GE_LICENSE = "GE-187-330-7136-01";
export const GE_HALF_RATE = 0.5;
export const STANDARD_TAX_RATE = 4.712;

export const isGeHalfTax = (inv) =>
  Math.abs((Number(inv?.tax) || 0) - GE_HALF_RATE) < 1e-9;

// Default rate for a new document billed to this client.
export const defaultTaxFor = (client) =>
  client?.geHalfTax ? GE_HALF_RATE : STANDARD_TAX_RATE;
