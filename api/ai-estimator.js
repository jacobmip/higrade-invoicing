// HI Grade AI Estimator — Sonnet 4.6 with native web_search.
// Used ONLY for estimate generation. Conversational ops + simple actions
// continue to run through /api/ai.js on Haiku 4.5.
//
// Node runtime so we get the full 10s function budget; Sonnet + web_search
// can take 4-8s per estimate.

export const config = { runtime: 'nodejs', maxDuration: 90 };

// The client extractor shares this route instead of owning one. See the header
// of ./_lib/extract-client.js for why. Note maxDuration above is aspirational
// on the Hobby plan, which clamps functions to 10s regardless of what is asked
// for here.
import { extractClient } from './_lib/extract-client.js';

import { proposeLeadEstimate, authorizedLeadTask } from './_lib/lead-estimate.js';
import { fetchSavedItems, callEstimator, textOf, parseEstimate } from './_lib/estimator.js';

// The prompt, pricing waterfall, saved-price fetch and the model call live in
// ./_lib/estimator.js so the lead flow (./_lib/lead-estimate.js) runs the very
// same estimator.

// =====================================================================
// CORS helper
// =====================================================================
function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

// Lead ballpark task. Answers 202 at once and does the work under waitUntil, so
// the caller (the SMS webhook) is never held for the model call. Falls back to
// doing the work inline if @vercel/functions is unavailable.
async function leadEstimateTask(req, res, body) {
  if (!(await authorizedLeadTask(req))) return res.status(403).json({ error: 'forbidden' });
  const work = proposeLeadEstimate({ invoiceId: String(body.invoice_id || ''), problem: body.problem })
    .catch(e => console.error('[lead-estimate] failed:', e.message || e));
  let waitUntil = null;
  try { ({ waitUntil } = await import('@vercel/functions')); } catch { /* inline */ }
  if (typeof waitUntil === 'function') {
    waitUntil(work);
    return res.status(202).json({ ok: true, queued: true });
  }
  const result = await work;
  return res.status(200).json({ ok: true, result: result || null });
}

// =====================================================================
// Handler
// =====================================================================
export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Hand off before any estimate-specific work. Both tasks are Anthropic calls
  // with their own prompt and schema; only the entry point is shared.
  let peek = req.body;
  if (typeof peek === 'string') { try { peek = JSON.parse(peek); } catch { peek = {}; } }
  if (peek && peek.task === 'extract_client') return extractClient(req, res);
  // Lead ballpark, dispatched by api/sms-inbound.js. Its own invocation so the
  // estimator gets a fresh function budget instead of sharing the webhook's.
  if (peek && peek.task === 'lead_estimate') return leadEstimateTask(req, res, peek);

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });
  }

  try {
    // Body parsing — Vercel Node runtime gives us req.body already parsed when
    // Content-Type is application/json, but be defensive.
    let body = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch { body = {}; }
    }
    body = body || {};

    const {
      jobDescription,           // string — Jake's natural-language ask
      images = [],              // array of data URLs (data:image/...;base64,...) or {url} objects
      savedItems: bodySavedItems, // optional — if not provided, fetched from DB
      pastInvoiceContext = '',  // optional — recent similar invoices as reference
      messages: convoMessages,  // optional — for multi-turn refinement
    } = body;

    if (!jobDescription && !convoMessages && images.length === 0) {
      return res.status(400).json({ error: 'jobDescription, images, or messages required' });
    }

    // Auto-fetch saved items from Supabase if not provided. Cached per cold-start.
    let savedItems = bodySavedItems;
    if (!savedItems || !Array.isArray(savedItems) || savedItems.length === 0) {
      savedItems = await fetchSavedItems();
    }

    // Build the user message — saved items list inline so the model can match.
    const savedBlock = savedItems.length
      ? `SAVED PRICES (use these as primary match before searching):\n${
          savedItems.map(i => `  ${i.category} | ${i.name} | $${i.price}`).join('\n')
        }`
      : 'SAVED PRICES: none provided.';

    const pastBlock = pastInvoiceContext
      ? `\nRECENT SIMILAR INVOICES (voice + price reference):\n${pastInvoiceContext}`
      : '';

    // Build user content blocks. If images are provided, build a mixed
    // text + image block array; otherwise plain text.
    const userText = `${savedBlock}${pastBlock}\n\nJOB:\n${jobDescription || '(see attached photos)'}`;
    const imageBlocks = images.map(img => {
      // Accept either raw data URLs or {data, mediaType} objects
      if (typeof img === 'string' && img.startsWith('data:')) {
        const m = img.match(/^data:([^;]+);base64,(.+)$/);
        if (!m) return null;
        return {
          type: 'image',
          source: { type: 'base64', media_type: m[1], data: m[2] },
        };
      }
      if (img && img.data && img.mediaType) {
        return {
          type: 'image',
          source: { type: 'base64', media_type: img.mediaType, data: img.data },
        };
      }
      if (img && img.url) {
        return { type: 'image', source: { type: 'url', url: img.url } };
      }
      return null;
    }).filter(Boolean);

    const userContent = imageBlocks.length
      ? [...imageBlocks, { type: 'text', text: userText }]
      : userText;

    const initialMessages = convoMessages || [
      { role: 'user', content: userContent },
    ];

    // Anthropic's web_search resolves server-side inside one call, so a single
    // request returns the final message.
    let finalAssistant;
    try {
      finalAssistant = await callEstimator({ apiKey, messages: [...initialMessages] });
    } catch (e) {
      if (e.status) {
        return res.status(e.status).json({ error: 'Anthropic API error', detail: e.detail });
      }
      throw e;
    }

    // Extract the JSON estimate from the final assistant content blocks.
    const textBlocks = textOf(finalAssistant);
    const parsed = parseEstimate(textBlocks);

    // Pull out web search citations for transparency in the UI.
    const citations = [];
    for (const block of finalAssistant.content || []) {
      if (block.type === 'web_search_tool_result') {
        for (const r of block.content || []) {
          if (r.type === 'web_search_result') {
            citations.push({
              title: r.title,
              url: r.url,
              encrypted_content: undefined,
            });
          }
        }
      }
    }

    return res.status(200).json({
      ok: true,
      estimate: parsed,
      raw_text: textBlocks,
      citations,
      usage: finalAssistant.usage || null,
      stop_reason: finalAssistant.stop_reason || null,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || String(err) });
  }
}
