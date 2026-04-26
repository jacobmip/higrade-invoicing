export const config = { runtime: 'edge' };

export default async function handler(req) {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return new Response(JSON.stringify({ error: 'API key not configured' }), {
    status: 500, headers: { 'Content-Type': 'application/json' }
  });

  try {
    const { imageData, mediaType } = await req.json();

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1024,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: mediaType || 'image/jpeg', data: imageData }
            },
            {
              type: 'text',
              text: 'Extract receipt data and return ONLY a JSON object (no markdown, no explanation): { "merchant": "store name", "date": "YYYY-MM-DD", "total": 0.00, "description": "brief description", "category": "one of: Supplies & Materials, Tools & Equipment, Vehicle & Transportation, Meals & Entertainment, Office & Admin, Insurance, Subcontractors, Permits & Licenses, Marketing & Advertising, Other", "items": [{"desc": "item name", "amount": 0.00}] }. Omit fields you cannot read.'
            }
          ]
        }]
      })
    });

    const data = await response.json();
    const text = data.content?.[0]?.text || '';

    let parsed = {};
    try { const m = text.match(/\{[\s\S]*\}/); if (m) parsed = JSON.parse(m[0]); } catch {}

    return new Response(JSON.stringify(parsed), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { 'Content-Type': 'application/json' }
    });
  }
}
