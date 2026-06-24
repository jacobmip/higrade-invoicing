export const config = { runtime: 'edge' };

export default async function handler(req) {
  if (req.method !== 'GET') {
    return new Response('Method not allowed', { status: 405 });
  }

  const { searchParams } = new URL(req.url);
  const address = searchParams.get('address');
  if (!address) {
    return new Response(JSON.stringify({ error: 'Missing address' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const apiKey = process.env.VITE_GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'API key not configured' }), {
      status: 500,
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

  return new Response(JSON.stringify({ city, state, zip }), {
    headers: { 'Content-Type': 'application/json' },
  });
}
