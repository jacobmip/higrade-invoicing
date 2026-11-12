// The service call fees Lisa may state when asked what it costs to come out
// (Jake, 2026-11-11): a rough estimate over the phone first, then a minimum of
// the service call fee, always credited back if they go ahead with a repair.
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

/** The rule both Lisas follow, in prompt form. */
export function serviceFeeRule(fees, { channel }) {
  const phone = channel === 'text' ? 'give us a call at 808-444-5450' : 'call or text 808-444-5450';
  return `SERVICE CALL FEE (Jake, 2026-11-11). Use this when they ask what it costs to come out, the diagnostic fee, the trip charge or the hourly rate, and for any job you cannot price. Say it in your own short words: we can give them a rough estimate over the phone first (${phone}), and if they still want us to come take a look, it is a minimum of the $${fees.std} service call fee ($${fees.highRise} for a high-rise building), which is always credited back if they go ahead with any repair. Never call it a trip fee, an hourly rate or a deposit.`;
}
