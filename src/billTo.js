// Resolve the "Bill To" address block for an invoice/estimate.
//
// Two distinct addresses can apply to a single job:
//   - Billing address: where the bill is sent — the contractor or property
//     manager being invoiced. Falls back to the client's main/flat address
//     when no dedicated billing address is set.
//   - Job site address: where the work was actually performed.
//
// We only split them into two labeled lines when they genuinely differ (e.g. a
// contractor's office vs. the property worked on). For the common single-
// location client — a homeowner billed at the same place the work happened —
// we collapse to one clean address with no extra labels.

export function linesOf(src) {
  return src ? [src.line1, src.line2, src.line3].filter(Boolean) : [];
}

// Normalize an address (array of lines) for equality comparison: lowercased,
// whitespace-collapsed, so "same place typed twice" reads as identical.
function normAddr(lines) {
  return lines.join(" ").toLowerCase().replace(/\s+/g, " ").trim();
}

// True when a "billing address" is really just the job site wearing a
// different hat, and so should never have been stored as a billing address.
//
// Two shapes, both seen in real data:
//   - the same place typed twice (identical lines)
//   - the SITE NAME on its own, e.g. billing line1 "Makani Kai" against a job
//     site labelled "Makani Kai" at 45-995 Wailele Rd
//
// The second is the one that bites: the lines differ as strings, so resolveBillTo
// splits the document and prints "Billing Address: Makani Kai", which is not an
// address anyone can post a cheque to. A billing address is only real when it
// points somewhere else, like a property manager's office.
export function isJobSiteEcho(billing, jobAddress) {
  const b = linesOf(billing);
  if (!b.length) return false;
  const j = linesOf(jobAddress);
  if (j.length && normAddr(b) === normAddr(j)) return true;
  const label = (jobAddress?.label || "").trim().toLowerCase();
  if (!label) return false;
  // Just the site name, with or without the city/zip line repeated.
  const first = (b[0] || "").trim().toLowerCase();
  return first === label;
}

// form: the invoice form snapshot (jobAddress, billingAddress, clientInfo).
// clientRecord: the matched live client row (billingAddress, address1/2/3) —
//   optional; supplies the flat-field fallback for the billing address.
//
// Returns:
//   { split: boolean, billing: string[], job: string[], single: string[] }
// When split is true, render `billing` under "Billing Address" and `job` under
// "Job Site". When split is false, render `single` as a plain address line.
export function resolveBillTo(form = {}, clientRecord = {}) {
  const jobLines = linesOf(form.jobAddress);

  // Only an *explicitly-set* billing address triggers the split.
  // The legacy flat-field fallback (address1/2/3) is deliberately excluded
  // here: those fields contain job-site addresses for property-manager clients,
  // not billing addresses. Using them caused a job-site address to appear
  // labeled "Billing Address" whenever no real billing address was on file.
  // A billing address that is only the job site restated is dropped here as
  // well as at the point it would be saved, so documents that already carry
  // one stop printing a bogus "Billing Address" block without needing a data fix.
  const formBilling = isJobSiteEcho(form.billingAddress, form.jobAddress) ? [] : linesOf(form.billingAddress);
  const clientBilling = isJobSiteEcho(clientRecord.billingAddress, form.jobAddress) ? [] : linesOf(clientRecord.billingAddress);
  const billingLines =
    (formBilling.length && formBilling) ||
    (clientBilling.length && clientBilling) ||
    [];

  const haveJob = jobLines.length > 0;
  const haveBilling = billingLines.length > 0;
  const differ = haveJob && haveBilling && normAddr(jobLines) !== normAddr(billingLines);
  if (differ) {
    return { split: true, billing: billingLines, job: jobLines, single: [] };
  }
  // Single address: prefer job site, then explicit billing, then the legacy
  // flat fields (homeowner clients who pre-date the addresses[] system).
  const flatFallback = [clientRecord.address1, clientRecord.address2, clientRecord.address3].filter(Boolean);
  const single = haveJob ? jobLines : (haveBilling ? billingLines : flatFallback);
  return { split: false, billing: billingLines, job: jobLines, single };
}
