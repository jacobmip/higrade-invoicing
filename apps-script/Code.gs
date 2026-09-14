// Lisa's calendar booking webhook — mirror of the live Apps Script.
//
// THIS FILE IS A COPY. The running code lives in a Google Apps Script project
// in Jake's own Google account, not here. Editing this file changes nothing on
// its own. See README.md in this folder for where it is and how to deploy it.
//
// Credentials are placeholders. The live script has the real values inline;
// this repo is PUBLIC, so they are not committed. Where each one comes from:
//
//   SECRET        settings.gcal_webhook_secret in Supabase
//   ANON_KEY      the Supabase anon key, also in src/supabase.js
//   CAL_ID        the shared Work calendar, see migration 046
//
// What it does: push_invoice_to_calendar() POSTs here when the AI receptionist
// books a lead. This creates the event on the Work calendar, then calls
// set_invoice_gcal_event() back with the id so invoices.gcal_event_id is
// populated — which is what makes moving or cancelling the job possible later.

const SECRET       = 'REPLACE_WITH_settings.gcal_webhook_secret';
const SUPABASE_URL = 'https://cwhgcxxszyvevjpbnnkc.supabase.co';
const ANON_KEY     = 'REPLACE_WITH_SUPABASE_ANON_KEY';
const CAL_ID       = 'fcqqtdsa77rru3ikdqno2hiims@group.calendar.google.com';

function doPost(e) {
  try {
    const p = JSON.parse(e.postData.contents);
    if (p.secret !== SECRET) return json({ error: 'forbidden' });

    // start arrives as "2026-09-01T13:00" with its zone sent separately.
    // Parsing it with that zone is what stops a 1pm job booking at 3am.
    const tz    = p.timezone || 'Pacific/Honolulu';
    const start = Utilities.parseDate(String(p.start).replace('T', ' '), tz, 'yyyy-MM-dd HH:mm');
    const end   = new Date(start.getTime() + (p.minutes || 90) * 60000);

    const cal = CalendarApp.getCalendarById(CAL_ID);
    if (!cal) return json({ error: 'calendar not found' });

    const ev = cal.createEvent(p.title || 'Job', start, end, {
      description: p.description || '',
      location:    p.location || '',
    });

    // Migration 052 sends a colorId so a booking is coloured by kind. The app
    // repairs the colour itself during reconciliation (v1.11.1), so this line
    // is an optimisation, not a requirement: without it the event is simply
    // uncoloured until the app next syncs.
    if (p.colorId) ev.setColor(String(p.colorId));

    reportBack(p.invoiceId, ev.getId());
    return json({ ok: true, eventId: ev.getId() });
  } catch (err) {
    return json({ error: String(err) });
  }
}

function reportBack(invoiceId, eventId) {
  UrlFetchApp.fetch(SUPABASE_URL + '/rest/v1/rpc/set_invoice_gcal_event', {
    method: 'post',
    contentType: 'application/json',
    headers: { apikey: ANON_KEY, Authorization: 'Bearer ' + ANON_KEY },
    payload: JSON.stringify({ p_secret: SECRET, p_id: invoiceId, p_event_id: eventId }),
    muteHttpExceptions: true,
  });
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
