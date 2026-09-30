// The app-wide AI chat's agent: its system prompt and tool list.
//
// The chat used to be one model call that had to type its "action" as JSON
// inside a text reply, with a snapshot of 20 invoices pasted into the prompt.
// It could not look anything up, never saw whether an action worked, and could
// not chain steps (create the client, then the estimate, then book it). This
// is the same shape as the HI Grade Manager Telegram agent in AI-OS: real tool
// calls, results fed back, several steps per message.
//
// The tools run in the BROWSER, not here. Reads come from the data the app has
// already loaded (so totals use the app's own calcTotals, late fees included)
// plus a live read-only query under the signed-in user's RLS. Writes go through
// the app's existing save paths, so numbering (mintDocId), the optimistic lock
// and the calendar builder all behave exactly as they do by hand. This route
// only relays one model turn at a time. See src/aiAgent.js for the executors.
//
// Both AGENT_SYSTEM and AGENT_TOOLS are frozen on purpose: they form the
// cached prefix of every request. Anything that changes per message (today's
// date, who is signed in, which screen is open) goes into the user message
// instead. Editing either one mid-session costs a cache miss, nothing more.

// Sonnet, not Opus: lookups, bookkeeping writes and short replies are well
// within its range, at half Opus's price per token. Every write still goes
// through the app's own save paths and email/delete still need Jake's tap, so
// a model mistake cannot skip those gates.
export const AGENT_MODEL = 'claude-sonnet-5-5';

export const AGENT_SYSTEM = `You are the operations agent built into HI Grade Plumbing LLC's invoicing app (Honolulu, Hawaii). The person messaging you is usually Jake, the owner. You run the app for him from a chat: estimates, invoices, clients, payments, the price book and the job schedule.

Each user message starts with a <context> block giving today's date in Hawaii, the time, and who is signed in. Use that date to resolve "tomorrow", "Monday", "next week" into absolute YYYY-MM-DD dates.

## How you work
- Look things up with your tools before you answer. Never state a total, balance, count or date you have not read from a tool in this conversation. If a lookup comes back empty, say so rather than guessing.
- Do the whole job. If Jake asks for an estimate for a client who does not exist yet, find_client first, create the client, then create the estimate. If he also asks to book it, schedule it. Several tool calls per message is normal.
- A change only happened if a tool result says it did. Never tell Jake you created, updated, sent or scheduled something unless the tool returned ok. If a tool returns an error, tell him plainly what failed.
- Act on clear instructions without asking permission first. Ask a short question only when something essential is genuinely missing or ambiguous, like which of two clients named Mike, or no price to go on.
- Photos: you can read text in screenshots and photos (business cards, texts from customers, job sites). Pull every detail you can see into the tool call on the first try.

## Documents
- An estimate is the default. Create an invoice only when Jake says invoice, bill or charge.
- Estimates and invoices share one number sequence (EST1043 converts to INV1043). The app mints the number. Never invent one.
- Pricing: check search_price_book first and use Jake's saved price when the work matches. If nothing matches, use these Honolulu flat rates and pick a sensible point in the range: drain snake $300-450, hydro-jet $550-950, toilet repair $220-380, toilet replace $550-950, faucet repair $195-350, faucet replace $450-750, electric 40gal water heater $1,400-2,200, gas 40gal water heater $1,800-2,800, tankless $3,200-5,500, sewer camera $350-550, sewer spot repair $1,800-4,500, gas line repair $800-2,500, bathroom remodel plumbing $4,500-12,000. Say when a price is a guess rather than from the book.
- Line item style: one flat-rate line item per job unless Jake asks for more. No separate service call; diagnosis and labor are in the flat rate. Name is a short title, 6 words or fewer. Description is the scope of work as separate steps, one per line, joined with newline characters, no bullets or dashes, at least 6 steps (shut off, disconnect, remove, inspect, install, reconnect, test, verify).
- Hawaii GET tax (4.712%) is applied by the app. Never add it to a price.
- Line items are numbered from 1 in get_document. Use those numbers to edit or remove one.
- Recording a payment updates the status automatically once the balance is covered. You do not need to mark it paid separately.

## Clients
- Always find_client before create_client. A duplicate client record is a mess to undo.
- Address fields: address1 is the street, unit is apt/suite, address2 is city and state together ("Honolulu HI"), address3 is the ZIP. That is the billing address. Job-site addresses are listed separately by find_client.

## Scheduling
- Times are Hawaii local, 24-hour HH:MM. Default 09:00 and 2 hours when Jake does not say.
- Put the job-site street address in the address field. Use the one Jake gives, or the client's saved job site when there is one clear choice. If a client has several job sites and it is unclear which, ask which one.

## Things that need Jake's tap
- send_document_email does not send. It puts a confirmation card in the chat and Jake taps Send. Tell him it is ready to send, not that it was sent.
- delete_document pops a confirmation dialog. Delete one document at a time. Bulk deletes are not done from the chat.

## How you reply
- Jake reads this on his phone between jobs. Short, direct, plain language. Lead with the result.
- Plain text only: no markdown headings, tables, bold or code blocks. Short dash lists are fine for several items.
- Money as $1,234.56. Refer to documents by number (EST1043, INV1021).
- No em dashes. No emoji.`;

// Keep these descriptions accurate to what src/aiAgent.js actually does; the
// model believes them.
export const AGENT_TOOLS = [
  // ── Reads ──────────────────────────────────────────────────────────────────
  {
    name: 'search_documents',
    description:
      'Search estimates and invoices already loaded in the app. Every filter is optional; combine them. ' +
      'Returns number, type, client, date, due date, status, total, paid, balance and the first line item names, newest first. ' +
      'Use status "unpaid" for invoices with money still owed.',
    input_schema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Free text matched against the document number, client name, line item names and notes.' },
        client: { type: 'string', description: 'Client name or part of it.' },
        type: { type: 'string', enum: ['estimate', 'invoice', 'any'] },
        status: { type: 'string', enum: ['unpaid', 'paid', 'outstanding', 'partial', 'net30', 'any'] },
        date_from: { type: 'string', description: 'YYYY-MM-DD, inclusive, on the document date.' },
        date_to: { type: 'string', description: 'YYYY-MM-DD, inclusive.' },
        limit: { type: 'integer', description: 'Default 25, max 100.' },
      },
    },
  },
  {
    name: 'get_document',
    description:
      'Full detail of one estimate or invoice: numbered line items with descriptions, payments, scheduled visits, notes, internal notes, job address, totals and balance.',
    input_schema: {
      type: 'object',
      properties: { document_id: { type: 'string', description: 'e.g. EST1043 or INV0878' } },
      required: ['document_id'],
    },
  },
  {
    name: 'find_client',
    description:
      'Find clients by name, phone or email (partial and fuzzy matches). Returns contact info, billing address, saved job sites, and a summary of their documents including open balance.',
    input_schema: {
      type: 'object',
      properties: { query: { type: 'string' } },
      required: ['query'],
    },
  },
  {
    name: 'search_price_book',
    description: "Search Jake's saved price book (saved_items) by name or category. Empty query lists everything.",
    input_schema: {
      type: 'object',
      properties: { query: { type: 'string' } },
    },
  },
  {
    name: 'get_schedule',
    description:
      'Scheduled visits on estimates and invoices between two dates (Hawaii local). Covers jobs booked in the app and by the AI receptionist. ' +
      'Calendar events with no document behind them are not included.',
    input_schema: {
      type: 'object',
      properties: {
        date_from: { type: 'string', description: 'YYYY-MM-DD. Default today.' },
        date_to: { type: 'string', description: 'YYYY-MM-DD inclusive. Default 7 days from date_from.' },
      },
    },
  },
  {
    name: 'business_summary',
    description:
      'Money figures for a date range: invoiced, collected (payments received in the range), estimates written, plus current unpaid balance across all invoices and the biggest open balances.',
    input_schema: {
      type: 'object',
      properties: {
        date_from: { type: 'string', description: 'YYYY-MM-DD. Default first of this month.' },
        date_to: { type: 'string', description: 'YYYY-MM-DD inclusive. Default today.' },
      },
    },
  },
  {
    name: 'query_database',
    description:
      'Live read-only query against the invoicing database as a PostgREST path, under the signed-in user\'s permissions. ' +
      'Use it only when the other tools cannot answer, or to check for records created since the app loaded (a new lead from the receptionist). ' +
      'Tables: invoices (id, type, client_name, date, due_date, status, notes, internal_notes, source, visits, created_at), invoice_items (invoice_id, name, description, qty, price), ' +
      'clients (name, email, phone, address1, address2, address3, addresses), payments (invoice_id, amount, method, date), expenses, saved_items, invoice_events (invoice_id, kind, created_at). ' +
      'Totals are not stored; sum qty*price. Example: invoices?select=id,client_name,date,source&source=eq.ai_receptionist&order=created_at.desc&limit=10',
    input_schema: {
      type: 'object',
      properties: { query: { type: 'string' } },
      required: ['query'],
    },
  },

  // ── Writes ─────────────────────────────────────────────────────────────────
  {
    name: 'create_client',
    description: 'Create a new client. Refuses if a client with the same name already exists; use update_client for that one instead.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        phone: { type: 'string' },
        email: { type: 'string' },
        email2: { type: 'string', description: 'Secondary email, auto-CCed on sends.' },
        address1: { type: 'string', description: 'Street' },
        unit: { type: 'string', description: 'Apt / suite / unit' },
        address2: { type: 'string', description: 'City and state, e.g. "Honolulu HI"' },
        address3: { type: 'string', description: 'ZIP' },
      },
      required: ['name'],
    },
  },
  {
    name: 'update_client',
    description: "Change an existing client's phone, email or billing address. Include only the fields that change. Renaming a client is done in the app, not here.",
    input_schema: {
      type: 'object',
      properties: {
        client_id: { type: 'string', description: 'From find_client.' },
        changes: {
          type: 'object',
          properties: {
            phone: { type: 'string' },
            email: { type: 'string' },
            email2: { type: 'string' },
            address1: { type: 'string' },
            unit: { type: 'string' },
            address2: { type: 'string' },
            address3: { type: 'string' },
          },
        },
      },
      required: ['client_id', 'changes'],
    },
  },
  {
    name: 'create_document',
    description: 'Create a new estimate or invoice for an existing client. Dated today. Returns the new number and total.',
    input_schema: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['estimate', 'invoice'] },
        client_name: { type: 'string', description: 'Exact name as returned by find_client.' },
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              desc: { type: 'string', description: 'Scope steps separated by newline characters.' },
              qty: { type: 'number' },
              price: { type: 'number', description: 'Unit price before tax.' },
            },
            required: ['name', 'price'],
          },
        },
        notes: { type: 'string', description: 'Customer-facing notes printed on the document.' },
      },
      required: ['type', 'client_name', 'items'],
    },
  },
  {
    name: 'add_line_items',
    description: 'Append line items to an existing estimate or invoice.',
    input_schema: {
      type: 'object',
      properties: {
        document_id: { type: 'string' },
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              desc: { type: 'string' },
              qty: { type: 'number' },
              price: { type: 'number' },
            },
            required: ['name', 'price'],
          },
        },
      },
      required: ['document_id', 'items'],
    },
  },
  {
    name: 'update_line_item',
    description: 'Change one line item. item_number is 1-based, as listed by get_document. Include only the fields that change.',
    input_schema: {
      type: 'object',
      properties: {
        document_id: { type: 'string' },
        item_number: { type: 'integer' },
        changes: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            desc: { type: 'string' },
            qty: { type: 'number' },
            price: { type: 'number' },
            taxable: { type: 'boolean' },
          },
        },
      },
      required: ['document_id', 'item_number', 'changes'],
    },
  },
  {
    name: 'remove_line_item',
    description: 'Remove one line item. item_number is 1-based, as listed by get_document.',
    input_schema: {
      type: 'object',
      properties: {
        document_id: { type: 'string' },
        item_number: { type: 'integer' },
      },
      required: ['document_id', 'item_number'],
    },
  },
  {
    name: 'update_document',
    description: 'Change document-level fields: status, customer notes, discount (dollars), tax rate, due date, or which client it is for.',
    input_schema: {
      type: 'object',
      properties: {
        document_id: { type: 'string' },
        changes: {
          type: 'object',
          properties: {
            status: { type: 'string', enum: ['outstanding', 'paid', 'partial', 'net30'] },
            notes: { type: 'string' },
            discount: { type: 'number' },
            tax: { type: 'number', description: 'Percent, normally 4.712.' },
            dueDate: { type: 'string', description: 'YYYY-MM-DD' },
            client: { type: 'string', description: 'Exact client name.' },
          },
        },
      },
      required: ['document_id', 'changes'],
    },
  },
  {
    name: 'record_payment',
    description: 'Record a payment against an invoice. Status becomes partial or paid automatically from the new balance.',
    input_schema: {
      type: 'object',
      properties: {
        document_id: { type: 'string' },
        amount: { type: 'number' },
        method: { type: 'string', description: 'Cash, Check, Venmo, Zelle, Card, PayPal, ...' },
        date: { type: 'string', description: 'YYYY-MM-DD, default today.' },
      },
      required: ['document_id', 'amount'],
    },
  },
  {
    name: 'save_price',
    description: "Save or update a price in Jake's price book. Use when he says save, remember, or \"my price for X is Y\".",
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        category: { type: 'string', enum: ['Drain', 'Toilet', 'Faucet', 'Water Heater', 'Sewer', 'Gas', 'Service', 'Custom'] },
        price: { type: 'number' },
      },
      required: ['name', 'price'],
    },
  },
  {
    name: 'schedule_job',
    description:
      'Put a job on the shared Google Calendar for a client. Requires Google Calendar to be connected in the app.',
    input_schema: {
      type: 'object',
      properties: {
        client_name: { type: 'string' },
        date: { type: 'string', description: 'YYYY-MM-DD' },
        time: { type: 'string', description: 'HH:MM 24-hour Hawaii time. Default 09:00.' },
        duration_hours: { type: 'number', description: 'Default 2.' },
        job_description: { type: 'string', description: 'Short, e.g. "Snake bathtub drain".' },
        address: { type: 'string', description: 'Job-site street address for the event location.' },
      },
      required: ['client_name', 'date', 'job_description'],
    },
  },
  {
    name: 'send_document_email',
    description: 'Prepare to email an estimate or invoice to the client. Shows Jake a confirmation card; nothing is sent until he taps Send.',
    input_schema: {
      type: 'object',
      properties: { document_id: { type: 'string' } },
      required: ['document_id'],
    },
  },
  {
    name: 'delete_document',
    description: 'Delete one estimate or invoice (moves it to Recently Deleted). Jake must confirm in a dialog.',
    input_schema: {
      type: 'object',
      properties: { document_id: { type: 'string' } },
      required: ['document_id'],
    },
  },
];
