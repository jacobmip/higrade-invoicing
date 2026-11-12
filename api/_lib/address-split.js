// Every lead is filed through create_estimate_from_lead / capture_abandoned_call
// with ONE address string, so the client and the estimate came out as
// "364 Seaside Ave, Unit 1510, Honolulu, HI 96815" all in the street box, with
// City / ST / ZIP empty (Dan Miyamoto, Alyssa A., Jake 2026-11-12). This splits
// that string locally (no Google call) and fixes both records right after the
// filing.

import { supabaseUrl } from './sms.js';

const OAHU_TOWNS = ['Ewa Beach', 'Pearl City', 'Honolulu', 'Kailua', 'Kaneohe', 'Waipahu', 'Kapolei', 'Aiea',
  'Mililani', 'Hauula', 'Waianae', 'Wahiawa', 'Haleiwa', 'Kahuku', 'Laie', 'Waimanalo', 'Kaaawa', 'Ewa',
  'Waialua', 'Kunia', 'Makakilo', 'Hawaii Kai', 'Nanakuli', 'Maili', 'Makaha', 'Wheeler Army Airfield',
  'Schofield Barracks', 'Fort Shafter', 'Camp H M Smith', 'Kaneohe Bay'];
const UNIT_RE = /(?:,\s*|\s+)((?:#\s*|\b(?:apt|apartment|unit|ste|suite|rm|room|bldg|building|ph)\.?\s*#?\s*)[A-Za-z0-9][A-Za-z0-9-]*)\s*$/i;

/**
 * "364 Seaside Ave, Unit 1510, Honolulu, HI 96815"
 *   -> { line1: '364 Seaside Ave', unit: 'Unit 1510', city: 'Honolulu', state: 'HI', zip: '96815' }
 * Returns null when there is nothing to split (no city or zip found), so a
 * plain street line is left alone.
 */
export function splitAddress(raw) {
  let t = String(raw || '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim()
    .replace(/,?\s*(united states|usa|us)\.?$/i, '').trim();
  if (!/^\d/.test(t)) return null;
  let zip = '';
  const z = t.match(/[,\s]+(96[78]\d\d)(?:-\d{4})?$/);
  if (z) { zip = z[1]; t = t.slice(0, z.index).trim(); }
  let state = '';
  const st = t.match(/[,\s]+(HI|Hawaii)\.?$/i);
  if (st) { state = 'HI'; t = t.slice(0, st.index).trim(); }
  t = t.replace(/[,\s]+$/, '');
  let city = '';
  const lower = t.toLowerCase();
  const town = OAHU_TOWNS.find((c) => lower.endsWith(c.toLowerCase())
    && /[\s,]/.test(lower[lower.length - c.length - 1] || ''));
  // "1732 Marques StHonolulu": the town typed straight onto the street.
  const glued = !town && OAHU_TOWNS.find((c) => t.endsWith(c) && /[a-z.]/.test(t[t.length - c.length - 1] || ''));
  if (town || glued) { city = town || glued; t = t.slice(0, t.length - city.length).replace(/[,\s]+$/, ''); }
  else if (t.includes(',')) {
    const last = t.slice(t.lastIndexOf(',') + 1).trim();
    if (last && !/\d/.test(last) && !/^(apt|unit|ste|suite)\b/i.test(last)) { city = last; t = t.slice(0, t.lastIndexOf(',')).trim(); }
  }
  if (!city && !zip) return null;
  let unit = '';
  const u = t.match(UNIT_RE);
  if (u) { unit = u[1].replace(/\s+/g, ' ').trim(); t = t.slice(0, u.index).trim(); }
  const line1 = t.replace(/[,\s]+$/, '');
  if (!/^\d/.test(line1) || line1.length < 5) return null;
  return { line1, unit, city, state: state || 'HI', zip };
}

/** One street line that still carries the city or zip. */
export function isOneLine(line1) {
  return !!line1 && !!splitAddress(line1);
}

/** Flat client columns, the shape the client editor writes. */
export function clientFieldsFrom(p) {
  return {
    address1: p.line1,
    address_unit: p.unit || null,
    address2: [p.city, p.state || 'HI'].filter(Boolean).join(' '),
    address3: p.zip || null,
  };
}

/**
 * After a lead is filed: split a one-line address on the estimate's job_address
 * and on its client (flat fields, plus the matching addresses[] entry).
 * Bumps invoices.updated_at so an open form cannot save the old line back.
 * Never throws; returns what it changed.
 */
export async function fixFiledAddress(estimateId) {
  try {
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!key || !estimateId) return null;
    const h = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
    const base = `${supabaseUrl()}/rest/v1`;
    const get = async (p) => { const r = await fetch(`${base}/${p}`, { headers: h }); return r.ok ? r.json() : []; };
    const patch = (p, body) => fetch(`${base}/${p}`, { method: 'PATCH', headers: { ...h, Prefer: 'return=minimal' }, body: JSON.stringify(body) });
    const done = { estimate: false, client: false };

    const [inv] = await get(`invoices?id=eq.${encodeURIComponent(estimateId)}&select=id,client_id,job_address`);
    if (!inv) return null;
    const ja = inv.job_address || {};
    const pj = !ja.city && !ja.zip ? splitAddress(ja.line1) : null;
    if (pj) {
      await patch(`invoices?id=eq.${encodeURIComponent(estimateId)}`, {
        job_address: { ...ja, line1: pj.line1, line2: ja.line2 || pj.unit, city: pj.city, state: pj.state, zip: pj.zip, line3: [pj.city, pj.state, pj.zip].filter(Boolean).join(' ') },
        updated_at: new Date().toISOString(),
      });
      done.estimate = true;
    }

    if (inv.client_id) {
      const [c] = await get(`clients?id=eq.${inv.client_id}&select=address1,address2,address3,address_unit,addresses`);
      if (c) {
        const body = {};
        const pc = !c.address2 && !c.address3 ? splitAddress(c.address1) : null;
        if (pc) Object.assign(body, clientFieldsFrom({ ...pc, unit: c.address_unit || pc.unit }));
        if (Array.isArray(c.addresses) && c.addresses.length) {
          let changed = false;
          const list = c.addresses.map((a) => {
            const pa = a && !a.city && !a.zip ? splitAddress(a.line1) : null;
            if (!pa) return a;
            changed = true;
            return { ...a, line1: pa.line1, line2: a.line2 || pa.unit, city: pa.city, state: pa.state, zip: pa.zip, line3: [pa.city, pa.state, pa.zip].filter(Boolean).join(' ') };
          });
          if (changed) body.addresses = list;
        }
        if (Object.keys(body).length) { await patch(`clients?id=eq.${inv.client_id}`, body); done.client = true; }
      }
    }
    return done;
  } catch (e) {
    console.error('[address-split] fix failed:', e.message || e);
    return null;
  }
}
