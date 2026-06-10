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
  return lines.join("|").toLowerCase().replace(/\s+/g, " ").trim();
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
  const billingLines =
    (linesOf(form.billingAddress).length && linesOf(form.billingAddress)) ||
    (linesOf(clientRecord.billingAddress).length && linesOf(clientRecord.billingAddress)) ||
    [clientRecord.address1, clientRecord.address2, clientRecord.address3].filter(Boolean);
  const haveJob = jobLines.length > 0;
  const haveBilling = billingLines.length > 0;
  const differ = haveJob && haveBilling && normAddr(jobLines) !== normAddr(billingLines);
  if (differ) {
    return { split: true, billing: billingLines, job: jobLines, single: [] };
  }
  // Single address: prefer the job site (most specific) when present, else the
  // billing address.
  const single = haveJob ? jobLines : billingLines;
  return { split: false, billing: billingLines, job: jobLines, single };
}
