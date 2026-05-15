export const config = { runtime: 'edge' };

export default async function handler(req) {
  if (req.method !== 'GET') {
    return new Response('Method not allowed', { status: 405 });
  }

  const { searchParams } = new URL(req.url);
  const origin = searchParams.get('origin');
  const destination = searchParams.get('destination');

  if (!origin || !destination) {
    return new Response(JSON.stringify({ error: 'Missing origin or destination' }), {
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

  const url = `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${encodeURIComponent(origin)}&destinations=${encodeURIComponent(destination)}&key=${apiKey}`;
  const res = await fetch(url, {
    headers: { Referer: 'https://higrade-invoicing.vercel.app' },
  });
  const data = await res.json();

  const element = data?.rows?.[0]?.elements?.[0];
  if (element?.status === 'OK' && element?.duration?.value) {
    const minutes = Math.round(element.duration.value / 60);
    return new Response(JSON.stringify({ minutes }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ error: data?.status || 'No route found' }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
