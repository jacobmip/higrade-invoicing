// HI Grade AI — Screenshot/photo to client extractor.
// Takes one or more images (contact card, business card, text thread,
// email signature, screenshot of any contact info) and extracts a
// structured client record matching the existing `clients` schema.
//
// Schema (verified): clients { name, phone, email, company, addresses[],
//                              notes }
//   addresses[] = [{ id, label, line1, line2, line3 }]

export const config = { runtime: 'nodejs', maxDuration: 30 };

const EXTRACT_SYSTEM = `You extract customer contact info from screenshots, photos of business cards, text threads, email signatures, and other contact sources. Output is used to create a new client record in HI Grade Plumbing's invoicing app.

EXTRACT THESE FIELDS:
- name: full name of the person (best guess if multiple appear)
- phone: primary phone, formatted "(808) 555-1234"
- email: primary email
- company: business name if applicable (property management firm, employer, etc.)
- address: parse into:
    line1: street number + street name
    line2: unit/apt/suite/floor (if any)
    line3: city, state, zip (e.g., "Honolulu, HI 96814")
- notes: PERSISTENT property/client info ONLY — things that will still matter on the 10th job for this client. Examples: gate code, lock combo, dog on property, park in driveway not street, tenant access only, building has no elevator, property is uphill from gate, prefers texts not calls, owner lives on mainland (manager handles all work).

  STRICT RULES for notes:
  - DO NOT include the current job request ("reported clogged sewer line", "needs faucet repair"). That belongs on the invoice, not the client record.
  - DO NOT include extraction meta ("Extracted from voicemail screenshot", "Phone call received 11:46 AM", "Contact appears as 'Maybe: ...'", "Saved as new contact").
  - DO NOT include the date or time of when the screenshot was taken.
  - DO NOT include relationship guesses unless explicitly stated ("likely a referral" — no).
  - If there's nothing persistent worth saving, set notes to null. Empty is better than noise.
  - Keep notes terse: "Gate code 1234. Dog on property." not full sentences.

RULES:
- If a field isn't present in the image, set it to null. Do NOT guess.
- For addresses, if it's just a city or partial, put what you have in line3.
- Phone numbers: strip extensions, format as "(808) 555-1234" for Hawaii numbers, "(area) prefix-line" for mainland.
- Multiple phones: pick the mobile/primary, list others in notes.
- Multiple emails: pick the personal/primary, list others in notes.
- Hawaii addresses: city is usually Honolulu, Kailua, Kaneohe, etc. State is HI. Zips are 967xx.

OUTPUT: JSON only, no markdown fences:
{
  "action": "extracted",
  "client": {
    "name": "Sarah Chen" | null,
    "phone": "(808) 555-1234" | null,
    "email": "sarah@example.com" | null,
    "company": "Pacific Property Management" | null,
    "address": {
      "line1": "1234 Ala Moana Blvd" | null,
      "line2": "Suite 500" | null,
      "line3": "Honolulu, HI 96814" | null
    },
    "notes": "Gate code 1234. Park in driveway, not street. Prefers texts." | null
  },
  "confidence": "high" | "medium" | "low",
  "concerns": ["Phone partially obscured", "Address might be wrong unit number"]
}

If the image doesn't contain extractable contact info at all (e.g., photo of a leaky pipe), respond:
{
  "action": "no_contact_info",
  "message": "This looks like a photo of [what you see]. No contact information visible. For client extraction, share a screenshot of a contact card, text thread, business card, or email signature."
}

If the image is too blurry/dark to extract:
{
  "action": "unreadable",
  "message": "Image too unclear to extract reliably. Please retake or share a different screenshot."
}`;

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });

  try {
    let body = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch { body = {}; }
    }
    body = body || {};

    const { images = [], extraContext = '' } = body;
    if (!images.length) {
      return res.status(400).json({ error: 'images required' });
    }

    const imageBlocks = images.map(img => {
      if (typeof img === 'string' && img.startsWith('data:')) {
        const m = img.match(/^data:([^;]+);base64,(.+)$/);
        if (!m) return null;
        return { type: 'image', source: { type: 'base64', media_type: m[1], data: m[2] } };
      }
      if (img && img.data && img.mediaType) {
        return { type: 'image', source: { type: 'base64', media_type: img.mediaType, data: img.data } };
      }
      return null;
    }).filter(Boolean);

    if (!imageBlocks.length) {
      return res.status(400).json({ error: 'no valid images in payload' });
    }

    const userContent = [
      ...imageBlocks,
      { type: 'text', text: extraContext
          ? `Extra context from Jake: ${extraContext}\n\nExtract contact info.`
          : 'Extract contact info from these images.'
      },
    ];

    const apiResp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: 1024,
        system: EXTRACT_SYSTEM,
        messages: [{ role: 'user', content: userContent }],
      }),
    });

    if (!apiResp.ok) {
      const errText = await apiResp.text();
      return res.status(apiResp.status).json({ error: 'Anthropic API error', detail: errText });
    }

    const data = await apiResp.json();
    const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n');

    let parsed = null;
    try {
      const cleaned = text
        .replace(/^```json\s*/i, '')
        .replace(/^```\s*/i, '')
        .replace(/```\s*$/i, '')
        .trim();
      parsed = JSON.parse(cleaned);
    } catch {
      parsed = null;
    }

    return res.status(200).json({
      ok: true,
      result: parsed,
      raw_text: text,
      usage: data.usage || null,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || String(err) });
  }
}
