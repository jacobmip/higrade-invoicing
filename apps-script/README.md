# Lisa's calendar booking webhook

The AI receptionist does not book jobs through this app. She goes
**database → webhook → Google Apps Script**, and that Apps Script is the only
piece of the system that lives outside this repo.

Until 2026-09-14 it existed **only** inside Jake's Google account. If that
account had been lost, nobody could have rebuilt Lisa's calendar booking. This
folder is the mirror that fixes that.

## Where the live code actually is

| | |
|---|---|
| Project | "Untitled project" in Jake's Drive, created 2026-08-26 |
| Open it | https://script.google.com — sign in as jacobmip@gmail.com, it is in **My Projects** |
| Deployed URL | stored in `settings.gcal_webhook_url` in Supabase |
| Runs as | the account owner, which is why it dodges the 7-day refresh-token expiry an unverified OAuth app would hit (see migration 033) |
| Writes to | the shared **Work** calendar, which must match `google_credentials.calendar_id` (migration 046) |

## This folder is a copy, not the source of truth

Editing `Code.gs` here changes nothing. The live script is edited in the Apps
Script web editor. When you change one, change the other, or this mirror rots
into a lie — the same failure mode rule 14 exists to prevent.

Credentials are placeholders here because **this repo is public**. The live
script has the real values inline. Each is recoverable:

| Placeholder | Where the real value lives |
|---|---|
| `SECRET` | `settings.gcal_webhook_secret` in Supabase |
| `ANON_KEY` | the Supabase anon key, also in `src/supabase.js` |
| `CAL_ID` | already the real value; the shared Work calendar |

## How to edit and deploy it

This is the part that is easy to get wrong: **saving the code does nothing.**
An Apps Script web app serves whatever version was last *deployed*, so an edit
without a redeploy is invisible.

1. Open https://script.google.com and sign in as jacobmip@gmail.com
2. Open the project, then `Code.gs`
3. Make the change and save (the disk icon, or Ctrl+S)
4. **Deploy → Manage deployments**
5. Click the pencil (edit) on the existing deployment
6. Version → **New version**
7. **Deploy**

Do not use "New deployment" — that mints a different URL, and
`settings.gcal_webhook_url` still points at the old one. Editing the existing
deployment keeps the URL stable.

## Testing a change

Booking a real call is a slow way to test. Instead, from the Supabase SQL
editor, push an invoice that already has an appointment and no event id:

```sql
select push_invoice_to_calendar('EST0807');
```

It returns `queued` (the POST is fire-and-forget via pg_net), then the event
appears on the Work calendar and `invoices.gcal_event_id` fills in a moment
later via the `set_invoice_gcal_event` callback. If the id never populates, the
script ran but `reportBack` failed — check the Apps Script **Executions** tab.

## Event format

`push_invoice_to_calendar()` builds the whole payload; this script just places
it. The format is the app's, defined by `buildCalendarEvent()` in `src/App.jsx`
and mirrored in migration 052. Change the format there, not here.
