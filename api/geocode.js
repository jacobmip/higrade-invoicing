export const config = { runtime: 'edge' };

export default async function handler(req) {
  if (req.method !== 'GET') {
    return new Response('Method not allowed', { status: 405 });
  }

  const { searchParams } = new URL(req.url);
  const apiKey = process.env.VITE_GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'API key not configured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // mode=autocomplete: Places Autocomplete suggestions, biased to Oahu. Returns
  // the predictions array (empty on no match). Lives here, not in a new route,
  // to stay inside the 12-function ceiling (this one is edge, so it is free).
  if (searchParams.get('mode') === 'autocomplete') {
    const input = (searchParams.get('input') || '').trim();
    if (input.length < 3) {
      return new Response('[]', { headers: { 'Content-Type': 'application/json' } });
    }
    const params = new URLSearchParams({
      input,
      key: apiKey,
      components: 'country:us',
      location: '21.3069,-157.8583',
      radius: '50000',
      types: 'address',
    });
    const token = searchParams.get('sessiontoken');
    if (token) params.set('sessiontoken', token);
    const pr = await fetch(`https://maps.googleapis.com/maps/api/place/autocomplete/json?${params}`, {
      headers: { Referer: 'https://higrade-invoicing.vercel.app' },
    });
    const pd = await pr.json();
    if (pd.status !== 'OK' && pd.status !== 'ZERO_RESULTS') {
      // Pass Google's own explanation through. Without it a refused key, a
      // billing problem or a disabled API all looked like "no suggestions".
      console.error('[geocode] autocomplete refused:', pd.status, pd.error_message || '');
      return new Response(JSON.stringify({ error: pd.status || 'Autocomplete failed', message: pd.error_message || null }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response(JSON.stringify(pd.predictions || []), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const address = searchParams.get('address');
  if (!address) {
    return new Response(JSON.stringify({ error: 'Missing address' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${apiKey}`;
  const res = await fetch(url, {
    headers: { Referer: 'https://higrade-invoicing.vercel.app' },
  });
  const data = await res.json();

  if (data.status !== 'OK' || !data.results?.[0]) {
    return new Response(JSON.stringify({ error: data.status || 'No results' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const components = data.results[0].address_components;
  const get = (type) => components.find(c => c.types.includes(type))?.long_name || '';
  const getShort = (type) => components.find(c => c.types.includes(type))?.short_name || '';

  const city = get('locality') || get('sublocality_level_1') || get('neighborhood') || '';
  const state = getShort('administrative_area_level_1') || '';
  const zip = get('postal_code') || '';

  // Coordinates, for the clock-in geofence (migration 072). Purely additive —
  // the existing callers destructure city/state/zip and ignore the rest.
  // `location_type` matters: ROOFTOP is the house, APPROXIMATE can be the
  // middle of a zip code, which would make a geofence meaningless. The caller
  // decides what to do with a weak fix rather than being handed a number with
  // no provenance.
  const loc = data.results[0].geometry?.location || null;
  const lat = typeof loc?.lat === 'number' ? loc.lat : null;
  const lng = typeof loc?.lng === 'number' ? loc.lng : null;
  const precision = data.results[0].geometry?.location_type || null;

  return new Response(JSON.stringify({ city, state, zip, lat, lng, precision, formatted: data.results[0].formatted_address || '' }), {
    headers: { 'Content-Type': 'application/json' },
  });
}
