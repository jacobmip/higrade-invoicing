// The service call fees Lisa may state when asked what it costs to come out
// (Jake, 2026-11-11): a minimum of the service call fee, always credited back
// if they go ahead with a repair. No estimates over the phone (2026-11-12).
// Read from the price book by name so a price change there reaches her; the
// fallbacks are the book's values on that date.

/** @param {Array<{name:string, price:number}>} prices */
export function serviceFees(prices) {
  const find = (re) => (prices || []).find((x) => re.test(String(x.name || '').trim()))?.price;
  return {
    std: Number(find(/^service call\s*\/\s*diagnostic$/i)) || 185,
    highRise: Number(find(/^high-?rise service call$/i)) || 325,
  };
}

/** The rule every Lisa follows, in prompt form. */
export function serviceFeeRule(fees) {
  // Jake, 2026-11-12: "we don't give estimates over the phone". The Nov 11
  // "rough estimate over the phone first" offer is gone: a price-book job gets
  // its range in the conversation, anything else is the service call.
  return `SERVICE CALL FEE. Use this when they ask what it costs to come out, the diagnostic fee, the trip charge or the hourly rate, and for any job you cannot price. Say it in your own short words: having us come take a look is a minimum of the $${fees.std} service call fee ($${fees.highRise} for a high-rise building), which is always credited back if they go ahead with any repair. We do not give estimates over the phone: never offer one, and never send them to call for a price. Never call it a trip fee, an hourly rate or a deposit.`;
}
