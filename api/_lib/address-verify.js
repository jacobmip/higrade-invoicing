// Every service address Lisa records is looked up first (Jake, 2026-11-11).
//
// Before this, whatever a customer typed was saved as typed: "4300 Waialae
// Avenue #A1503. My appointment was for today at 9am." went on file as the
// address, and a prank "69 dick lane" was confirmed back to the sender. Now the
// address goes through Google's geocoder, biased to Oahu, and only a precise,
// full match is recorded, in Google's clean form with the unit kept.
//
//   verified   precise match: record `formatted` (and line1 / unit / city / zip)
//   unsure     Google found something close: ask "is that <suggestion>?"
//   not_found  nothing usable: ask them to double-check it
//   error      the lookup itself failed: keep what they typed, flag it
//
// Plain fetch, no Node APIs, so the edge route (api/geocode.js) can use it too.

const OAHU = { south: 21.24, north: 21.72, west: -158.29, east: -157.64 };
const PRECISE_TYPES = new Set(['street_address', 'premise', 'subpremise']);
// The word may run straight into the number ("Apt1113").
const UNIT_RE = /(?:#\s*|\b(apt|apartment|unit|ste|suite|rm|room|bldg|building|ph)(?=[\s.#\d])\.?\s*#?\s*)([A-Za-z0-9][A-Za-z0-9-]*)/i;
const CHATTER = /\b(my|was|is|are|for|please|thanks|thank|appointment|today|tomorrow|call|text|when|can|will)\b/i;

/** The typed address without HTML, chatter sentences or the unit. */
export function cleanAddress(raw) {
  let t = String(raw || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
    .replace(/^(service )?address\s*:\s*/i, '');
  // "Address: 2328 Waiomao Rd #B Tenant: Ally Morris": stop at the next label.
  t = t.replace(/\s+[A-Z][A-Za-z]+\s*:\s.*$/, '');
  // Keep the first sentence, drop any later one that reads like conversation.
  const parts = t.split(/(?<=\.)\s+(?=[A-Z])/);
  t = [parts[0], ...parts.slice(1).filter((p) => !CHATTER.test(p))].join(' ').trim();
  const m = t.match(UNIT_RE);
  let unit = '';
  if (m) {
    const word = (m[1] || '').toLowerCase();
    const label = !word ? '#' : /^(apt|apartment)$/.test(word) ? 'Apt ' : /^(ste|suite)$/.test(word) ? 'Suite ' : /^(bldg|building)$/.test(word) ? 'Bldg ' : /^(rm|room)$/.test(word) ? 'Room ' : word === 'ph' ? 'PH ' : 'Unit ';
    unit = `${label}${m[2].toUpperCase()}`;
    t = (t.slice(0, m.index) + ' ' + t.slice(m.index + m[0].length)).replace(/\s+,/g, ',').replace(/,\s*,/g, ',').replace(/\s+/g, ' ').trim();
  }
  return { query: t.replace(/[.,\s]+$/, ''), unit };
}

const houseNumber = (s) => (String(s || '').match(/^\s*(\d+(?:-\d+)?[A-Za-z]?)\b/) || [])[1] || '';
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

/** True when two addresses name the same street address (unit ignored). */
export function sameAddress(a, b) {
  const x = cleanAddress(a).query, y = cleanAddress(b).query;
  if (!x || !y) return false;
  const nx = norm(x), ny = norm(y);
  return nx === ny || (houseNumber(x) === houseNumber(y) && (nx.startsWith(ny.slice(0, 12)) || ny.startsWith(nx.slice(0, 12))));
}

/**
 * @param {string} raw    what the customer typed
 * @param {object} [opts]
 * @param {string} [opts.apiKey]  defaults to VITE_GOOGLE_MAPS_API_KEY
 * @returns {Promise<{status:'verified'|'unsure'|'not_found'|'error', formatted?:string, suggestion?:string, line1?:string, unit?:string, city?:string, state?:string, zip?:string, lat?:number, lng?:number, reason?:string}>}
 */
export async function verifyAddress(raw, { apiKey } = {}) {
  const key = apiKey || process.env.VITE_GOOGLE_MAPS_API_KEY || process.env.GOOGLE_MAPS_API_KEY;
  const { query, unit } = cleanAddress(raw);
  if (!/\d/.test(query) || query.length < 6) return { status: 'not_found', reason: 'no street number' };
  if (!key) return { status: 'error', reason: 'maps key not configured' };

  let data;
  try {
    const params = new URLSearchParams({
      address: query,
      key,
      components: 'country:US|administrative_area:HI',
      bounds: `${OAHU.south},${OAHU.west}|${OAHU.north},${OAHU.east}`,
    });
    const res = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?${params}`, {
      headers: { Referer: 'https://higrade-invoicing.vercel.app' },
      signal: AbortSignal.timeout(4000),
    });
    data = await res.json();
  } catch (e) {
    return { status: 'error', reason: `lookup failed: ${e.message || e}` };
  }
  if (data.status === 'ZERO_RESULTS') return { status: 'not_found', reason: 'no match' };
  if (data.status !== 'OK' || !data.results?.[0]) return { status: 'error', reason: `${data.status || 'no status'} ${data.error_message || ''}`.trim() };

  const r = data.results[0];
  const get = (type, short) => r.address_components?.find((c) => c.types.includes(type))?.[short ? 'short_name' : 'long_name'] || '';
  const num = get('street_number');
  const route = get('route', true);
  const city = get('locality') || get('sublocality_level_1') || get('neighborhood');
  const zip = get('postal_code');
  const loc = r.geometry?.location || {};
  const gUnit = get('subpremise');
  const unitOut = unit || (gUnit ? `#${gUnit}` : '');
  const line1 = [num, route].filter(Boolean).join(' ');
  const formatted = line1 ? `${line1}${unitOut ? `, ${unitOut}` : ''}, ${city ? `${city}, ` : ''}HI${zip ? ` ${zip}` : ''}` : r.formatted_address;
  const out = { formatted, line1, unit: unitOut, city, state: 'HI', zip, lat: loc.lat, lng: loc.lng };

  const onOahu = loc.lat >= OAHU.south && loc.lat <= OAHU.north && loc.lng >= OAHU.west && loc.lng <= OAHU.east;
  const precise = (r.types || []).some((t) => PRECISE_TYPES.has(t))
    && ['ROOFTOP', 'RANGE_INTERPOLATED'].includes(r.geometry?.location_type);
  const typedNum = houseNumber(query);
  const numberMatches = !!num && norm(num) === norm(typedNum);

  if (!line1 || !num) return { status: 'not_found', reason: 'no street address match', suggestion: r.formatted_address };
  if (!onOahu) return { status: 'unsure', reason: 'not on Oahu', suggestion: formatted, ...out };
  if (precise && numberMatches && !r.partial_match) return { status: 'verified', ...out };
  return { status: 'unsure', reason: r.partial_match ? 'partial match' : !numberMatches ? 'house number differs' : 'imprecise match', suggestion: formatted, ...out };
}

/** What Lisa says when an address could not be verified. */
export function addressQuestion(v, typed) {
  const shown = String(typed || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().slice(0, 80);
  if (v.status === 'unsure' && v.suggestion) return `Just to make sure we have it right, is the service address ${v.suggestion}?`;
  return `I couldn't find ${shown ? `"${shown}"` : 'that address'} on the map. Could you double-check the street number, street name and city?`;
}

/**
 * A verified address in the clients table's shape: street in address1, the
 * unit in address_unit, "City HI" in address2, zip in address3 (the form the
 * app's client editor writes). Null when there is nothing structured to save.
 */
export function clientAddressFields(parts) {
  if (!parts?.line1) return null;
  return {
    address1: parts.line1,
    address_unit: parts.line2 || parts.unit || null,
    address2: [parts.city, 'HI'].filter(Boolean).join(' '),
    address3: parts.zip || null,
  };
}
