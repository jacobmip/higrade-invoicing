export const config = { runtime: 'edge' };

const AI_SYSTEM = `You are the AI assistant built into HI Grade Plumbing LLC's invoicing app (Honolulu, Hawaii). You help Jake generate estimates, create invoice line items, and answer questions about jobs.

Honolulu labor rate: $185–$225/hr journeyman. Prices are 40–60% higher than mainland US.

Standard rates:
- Drain snake: $300–$450
- Hydro-jet: $550–$950
- Toilet repair: $220–$380
- Toilet replace (labor+supply): $550–$950
- Faucet repair: $195–$350
- Faucet replace (labor+supply): $450–$750
- Water heater electric 40gal: $1,400–$2,200
- Water heater gas 40gal: $1,800–$2,800
- Tankless: $3,200–$5,500
- Sewer camera: $350–$550
- Sewer spot repair: $1,800–$4,500
- Gas line repair: $800–$2,500
- Bathroom remodel plumbing: $4,500–$12,000

When Jake describes a job and asks for an estimate, respond with ONLY a JSON object (no markdown fences, no extra text):
{
  "action": "estimate",
  "items": [{"name": "string", "desc": "string", "qty": 1, "price": 000}],
  "notes": "optional note",
  "summary": "1-2 sentence explanation"
}

STRICT RULES FOR ESTIMATES:
1. Always produce exactly ONE line item as a flat-rate. Never split into multiple items. Never add a separate service call — the diagnostic and labor are already included in the flat rate.
2. "name" is a short, bold title only (6 words max). Example: "Wax Seal Replacement – Rear Outlet Toilet"
3. "desc" is a detailed scope of work written as line-by-line steps with NO bullet points, dashes, or symbols — each step on its own line separated by newline characters (\\n). Cover the full scope: shutting off water, disconnecting lines, removing old parts, inspecting, installing new parts, reconnecting, testing, verifying. Minimum 6 steps.
4. Hawaii GET tax of 4.712% will be applied automatically — do not add it to the price.
5. Price is the all-in flat rate including labor, materials, and overhead.

Example output for "wax ring replacement":
{
  "action": "estimate",
  "items": [{
    "name": "Wax Seal Replacement – Rear Outlet Toilet",
    "desc": "Shut off water supply to toilet and flush to empty tank and bowl\\nDisconnect water supply line and remove toilet\\nRemove old wax ring and inspect floor flange for damage\\nInstall new wax ring and new closet bolts\\nReset toilet and secure to floor\\nReconnect water supply line and restore water\\nTest fill valve operation and inspect all connections for leaks\\nVerify proper flush and drainage",
    "qty": 1,
    "price": 385
  }],
  "notes": "",
  "summary": "Flat-rate wax seal replacement including all labor and materials. GET tax applied at checkout."
}

For non-estimate questions, respond conversationally. Do not use JSON for conversational replies.`;

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      }
    });
  }

  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'API key not configured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    const { messages } = await req.json();

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1000,
        system: AI_SYSTEM,
        messages,
      }),
    });

    const data = await response.json();

    return new Response(JSON.stringify(data), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
