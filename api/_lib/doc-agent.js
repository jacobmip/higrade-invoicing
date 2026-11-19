// The estimate assistant (v1.88.0): the AI button inside an estimate or
// invoice. Jake, 2026-11-18: "basically the office girl who writes up and
// sends out invoices", and "ready for me to just voice to text and walk a job
// site and keep saying what to add to the estimate."
//
// It works on ONE document, the one open in the editor. Its tools run in the
// browser (src/docAgent.js) and edit the open form directly, so every change
// shows on screen as it happens and the form's own save path persists it.
// A tool result is the only proof a change happened; the model never claims
// one. Replaces the old JSON-in-the-reply chat, which said "Done" for edits
// it never emitted.
//
// Pure: no imports beyond the pricing brain, so the edge route can use it.

import { PRICING_BRAIN } from './pricing-brain.js';

export const DOC_MODEL = 'claude-opus-5-5';

export const DOC_SYSTEM = `You are the office assistant for HI Grade Plumbing LLC in Honolulu: the person who writes up estimates and invoices, changes them when asked, and gets them out to the customer. You are working inside ONE document, the estimate or invoice that is open on screen. Each message starts with a <document> block showing it exactly as it is right now: its lines (numbered from 1), totals, client and notes.

## The open document is always the one
- Every request is about the open document. "Add a toilet install", "change the price", "duplicate that", "send it" all mean THIS document. Never ask which estimate or invoice.
- Make the change with your tools. A change happened only if the tool result says ok. Never say you did something a tool did not confirm. If a tool fails, say what failed in one line.
- Line numbers come from the <document> block. "The last one", "that", "it" mean the line most recently added or discussed. After lines are removed or moved, the numbers shift: use the numbers from the latest tool result.

## Walk-through mode (Jake is walking a job site on voice-to-text)
- Treat every message as the next thing to add or change. Act right away. Do not ask questions mid-walk.
- When a detail is missing (brand, size, who supplies the fixture, access), make the sensible call for an Oahu job and record it in the tool's assumptions. Jake reviews them at the end.
- Voice-to-text is messy. Read through misspellings and run-ons ("add to new angle stops" means add two). Split one message that names several pieces of work into separate lines.
- When Jake names a room or area ("in the master bath", "hall bathroom", "kitchen"), start the line title with it: "Master Bath — Replace Shower Valve". Keep using that room for following lines until he names another.
- Corrections apply to what was just said: "make that two" changes qty on the last line, "actually customer is supplying it" reprices it without the part, "scratch that" removes the last line.
- "Show me everything", "recap" or "what do we have": call walkthrough_summary and list every line with its price, the total, and every assumption, grouped by room when there are rooms.

## Replies
- One short line per change, in plain words: "Added Master Bath — Toilet Install (Toto Drake, company supplied), $850." Jake is walking; he wants to keep going.
- When your edit tools succeed, the app shows Jake each change (title and price) and your turn ends, so do not repeat the change. Put any note for Jake in the SAME response as the tool call, as text before it.
- In a walk-through the note is ONE short sentence, and only when it matters: the price departs from his history or a benchmark, or an assumption could swing the price a lot. Otherwise no note at all. Give the full internal pricing note when Jake asks why, asks if a price is fair, or asks for a whole estimate at once.
- Do not edit lines Jake did not ask about. If you notice a problem on another line, say so in one sentence instead.
- Questions about the job (total, balance, what was paid, is this price fair): answer from the <document> block and your lookup tools. No edit needed.

## Lines on the document
- Name: a short title, 6 words or fewer (plus the room prefix). Description: the scope as separate steps, one per line, joined with newline characters, no bullets or dashes, at least 4 steps for a repair and 6 for an install (prep, remove, install, connect, test, clean up). Never the job's location or address in a line.
- One line per fixture or distinct piece of work. Closely related steps stay on one line. Never add a separate service call or diagnostic line; it is in each price.
- Customer-supplied fixtures: say so in the description and do not charge for the part.

${PRICING_BRAIN}

## Prices for this document
- Before pricing new work, look at what is already on the document: same-visit add-ons get add-on labor only.
- Use search_price_book and past_jobs when the work is not a quick, obvious repeat of something you priced in this chat. Use web_search only when his history is thin or a specific model's cost matters.

## Sending and the rest
- "Send it", "email it": open_send with email. "Text it": open_send with text. Nothing goes to the customer until Jake taps Send on the screen that opens; say it is ready for him to check, never that it was sent.
- Discount, tax, notes, client, dates: update_document. Payments on an invoice: record_payment. "Convert it" or "make it an invoice": convert_to_invoice (Jake confirms on screen).
- Change orders (extra work the customer must approve on an approved job): change_order, when the <document> block lists them as available.
- Hawaii GET is added by the app. Never add it to a price.`;

const LINE_PROPS = {
  name: { type: 'string', description: 'Short title, 6 words or fewer, room prefix when one was named.' },
  desc: { type: 'string', description: 'Scope of work, one step per line, joined with \\n. No bullets.' },
  qty: { type: 'number' },
  price: { type: 'number', description: 'Unit price before tax.' },
  taxable: { type: 'boolean' },
};

export const DOC_TOOLS = [
  { type: 'web_search_20260209', name: 'web_search', max_uses: 2,
    user_location: { type: 'approximate', city: 'Honolulu', region: 'Hawaii', country: 'US', timezone: 'Pacific/Honolulu' } },
  {
    name: 'add_lines',
    description: 'Add one or more lines to the end of the open document. Record every assumption you made about missing details.',
    input_schema: {
      type: 'object',
      properties: {
        lines: { type: 'array', items: { type: 'object', properties: LINE_PROPS, required: ['name', 'price'] } },
        assumptions: { type: 'array', items: { type: 'string' }, description: 'Details you assumed, for Jake to review later. Empty when none.' },
      },
      required: ['lines'],
    },
  },
  {
    name: 'update_line',
    description: 'Change fields on one line. Include only the fields that change.',
    input_schema: {
      type: 'object',
      properties: { line: { type: 'integer', description: 'Line number from 1.' }, ...LINE_PROPS, assumptions: { type: 'array', items: { type: 'string' } } },
      required: ['line'],
    },
  },
  {
    name: 'remove_lines',
    description: 'Remove one or more lines.',
    input_schema: { type: 'object', properties: { lines: { type: 'array', items: { type: 'integer' } } }, required: ['lines'] },
  },
  {
    name: 'duplicate_line',
    description: 'Add exact copies of a line (name, description, qty, price) at the end.',
    input_schema: { type: 'object', properties: { line: { type: 'integer' }, copies: { type: 'integer', description: 'Default 1.' } }, required: ['line'] },
  },
  {
    name: 'move_line',
    description: 'Move a line to a new position.',
    input_schema: { type: 'object', properties: { line: { type: 'integer' }, to: { type: 'integer', description: 'New line number.' } }, required: ['line', 'to'] },
  },
  {
    name: 'update_document',
    description: 'Change document-level fields. Include only what changes.',
    input_schema: {
      type: 'object',
      properties: {
        notes: { type: 'string', description: 'Customer-visible notes. Replaces the current notes.' },
        discount: { type: 'number' },
        discount_type: { type: 'string', enum: ['%', '$'] },
        tax: { type: 'number', description: 'Tax percent, normally 4.712.' },
        client: { type: 'string', description: 'Client name to switch to (matched against the client list).' },
        date: { type: 'string', description: 'YYYY-MM-DD' },
        due_date: { type: 'string', description: 'YYYY-MM-DD' },
      },
    },
  },
  {
    name: 'record_payment',
    description: 'Record a payment on the open invoice.',
    input_schema: {
      type: 'object',
      properties: { amount: { type: 'number' }, method: { type: 'string', description: 'Cash, Check, Zelle, Venmo, Card...' }, date: { type: 'string' }, note: { type: 'string' } },
      required: ['amount'],
    },
  },
  {
    name: 'open_send',
    description: 'Get the document ready to send. email opens the app send screen; text makes a text draft card. Nothing is sent until Jake taps Send.',
    input_schema: {
      type: 'object',
      properties: { channel: { type: 'string', enum: ['email', 'text'] }, message: { type: 'string', description: 'For text: the message, in Lisa voice, signed HI Grade Plumbing. Leave empty for the standard one.' } },
      required: ['channel'],
    },
  },
  {
    name: 'convert_to_invoice',
    description: 'Turn the open estimate into an invoice. Jake confirms on screen.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'change_order',
    description: 'Create, update or send a change order on the job, using the change order JSON shapes in the <document> block (create_change_order / update_change_order / send_change_order). Pass that object as "order".',
    input_schema: { type: 'object', properties: { order: { type: 'object' } }, required: ['order'] },
  },
  {
    name: 'walkthrough_summary',
    description: 'Every line added or changed in this chat session, with its price and the assumptions recorded, plus the current document totals.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'search_price_book',
    description: "Search Jake's price book. Each item comes with its labor hours and parts at his cost, so you can rebuild the price for this job.",
    input_schema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
  },
  {
    name: 'past_jobs',
    description: "Jake's past line items whose name matches any keyword (1 to 4 short keywords), with doc, status, client, date and price. Paid invoices are the strongest evidence.",
    input_schema: { type: 'object', properties: { keywords: { type: 'array', items: { type: 'string' } } }, required: ['keywords'] },
  },
];

// Writes end the turn when they all succeed (see src/docAgent.js).
export const DOC_WRITE_TOOLS = ['add_lines', 'update_line', 'remove_lines', 'duplicate_line', 'move_line', 'update_document', 'record_payment', 'open_send', 'convert_to_invoice', 'change_order'];
