// Check in / check out on a contractor's automated phone line (IVR).
//
// A commercial contractor has Jake phone a robot line for every job: it asks
// for a language, his IVR PIN, the job's tracking number, in or out, and how
// many technicians (always 1). This places that call through Vapi with a
// one-off assistant that only presses keypad keys. It is not Lisa and never
// talks to a customer, so there is no approval link, no calling-hours window
// and no outbound_calls_enabled switch: Jake asking in the app IS the approval,
// and these jobs run at night.
//
// Reached through /api/sms-inbound `op: 'ivr_checkin'`, admin session only.
// Jake usually attaches a screenshot with every number on it; the chat reads
// phone, pin, tracking and any other values (extra) off it. settings
// checkin_ivr_phone / checkin_ivr_pin are the fallback when it has none. The
// PIN is never written to call_queue.
//
// The prompt is mirrored in AI-OS scripts/outbound_call.py (`checkin`), which
// Lani on Telegram runs. Change one, change the other. That script's `check`
// cron reconciles the call afterwards and emails the result, as it does for
// every call_queue row; queued_by 'checkin' tells it never to redial.

import { getSetting, supabaseUrl } from './sms.js';

// The advertised line, same as outbound Lisa (AI-OS outbound_call.py).
const PHONE_NUMBER_ID = process.env.VAPI_OUTBOUND_PHONE_NUMBER_ID || '8bba3841-c1bc-4cf9-847f-2e07377fbd73';
const REUSE_HOURS = 16; // "check out" with no tracking number reuses today's check-in

function toE164(raw) {
  const d = String(raw || '').replace(/\D/g, '');
  if (d.length === 10) return `+1${d}`;
  if (d.length === 11 && d.startsWith('1')) return `+${d}`;
  return '';
}

// extra: [{ label, value }] for anything else on Jake's screenshot (store
// number, work order, location code). Values are digits only.
export function cleanExtra(extra) {
  return (Array.isArray(extra) ? extra : [])
    .map(e => ({
      label: String(e?.label || '').replace(/[^\w #/().-]/g, '').trim().slice(0, 40),
      value: String(e?.value || '').replace(/[^\d*#]/g, '').slice(0, 30),
    }))
    .filter(e => e.label && e.value)
    .slice(0, 6);
}

export function checkinPrompt(action, pin, tracking, extra = []) {
  const word = action === 'in' ? 'IN' : 'OUT';
  const other = extra.map(e => `- ${e.label}: ${e.value}`).join('\n');
  return `You are a silent keypad on a phone call with an automated phone system (an IVR robot). You are checking a plumbing technician ${word} of a commercial job. No human is on the line and nobody can hear you.

ABSOLUTE RULE: NEVER SPEAK. Anything you write as text is spoken into the call, and the robot treats any spoken word as an answer, so one word can ruin the call. Every reply you give is exactly one of: a single dtmf tool call, an endCall tool call, or an empty reply with zero characters. When there is nothing to press yet, reply with nothing at all. Never narrate, never describe what you are doing or waiting for, never greet, never say goodbye, never read numbers aloud. If the robot says "say or press", you press.

YOUR VALUES
- Language: English
- Checking: ${word}
- PIN: ${pin}
- Tracking number: ${tracking}
- Number of technicians: 1${other ? `\n${other}` : ''}

HOW TO WORK EACH PROMPT
1. Wait until the robot has finished the whole prompt or menu before pressing anything. Menus list several options; hear them all. Hold music or silence means wait.
2. Work out what it is asking for, match it to one value above, and press exactly that:
   - Language menu: press the key it names for English.
   - PIN, technician PIN, IVR PIN, password, access code: press the PIN.
   - Tracking number, tracking ID, work order number: press the tracking number.
   - Check in or check out, arriving or leaving, start or end work: press the key it names for check ${action}. Never pick the other one.
   - How many technicians, how many techs or people on site: press 1.
   - Any other value listed under YOUR VALUES: press it when that one is asked for.
   - A menu that does not match any of the above (for example "for a new work order press 3"): press nothing and give an empty reply.
3. ONE PROMPT, ONE ENTRY. Answer only the prompt you just heard, with one dtmf call, then stop and let the robot talk. Never send two entries in one turn. Never enter the next answer before the robot asks for it, even after an error; after "please try again", wait to hear which value it asks for first.
4. Send a whole number in one dtmf call. End it with # when the robot says answers end with the pound or hash key (once it says that, end every entry with #, confirmations included). Never use * unless it is the only key offered.
5. When it reads a value back and asks you to confirm: compare it digit by digit with your value. Press its confirm key only if it matches exactly; otherwise press its re-enter key and enter the value again.
6. If the robot says a value is not valid, enter it once more when asked. If it rejects the same value a second time, end the call: the number itself is wrong and retrying will not fix it.
7. If it asks for something you have no value for, do not guess. Give an empty reply and let it repeat once in case there is a skip option, then end the call.
8. Never press 0 or *, and never ask for an operator, agent or representative.
9. When the robot confirms the check ${action} was recorded, let it finish reading any confirmation number, then end the call. If it says goodbye or hangs up, you are done.`;
}

export function checkinAssistant(action, pin, tracking, extra = []) {
  const word = action === 'in' ? 'IN' : 'OUT';
  const prompt = checkinPrompt(action, pin, tracking, extra);
  return {
    name: `HI Grade IVR Check-${action}`,
    firstMessageMode: 'assistant-waits-for-user',
    model: {
      provider: 'openai', model: 'gpt-4.1', temperature: 0,
      messages: [{ role: 'system', content: prompt }],
      // Blank request-start messages: endCall otherwise says "Goodbye".
      tools: [
        { type: 'dtmf', messages: [{ type: 'request-start', content: '' }] },
        { type: 'endCall', messages: [{ type: 'request-start', content: '' }] },
      ],
    },
    voice: { provider: 'vapi', voiceId: 'Clara' },
    transcriber: { provider: 'soniox', model: 'stt-rt-v5' },
    // IVRs pause mid-prompt and read digits slowly. Wait for the full prompt.
    startSpeakingPlan: {
      waitSeconds: 1.5,
      transcriptionEndpointingPlan: { onPunctuationSeconds: 0.8, onNoPunctuationSeconds: 2.5, onNumberSeconds: 2 },
    },
    // Hold music and long pauses are normal on these lines.
    silenceTimeoutSeconds: 45,
    maxDurationSeconds: 300,
    analysisPlan: {
      summaryPlan: {
        enabled: true,
        messages: [
          {
            role: 'system',
            content: `This was an automated call to a contractor's IVR line to check a technician ${word} of job tracking number ${tracking}. ` +
              `In 1-2 plain sentences say whether the system confirmed the check-${action} was recorded, and give any confirmation number it read. ` +
              'If it failed, say exactly at which prompt and why.',
          },
          { role: 'user', content: 'Here is the transcript:\n\n{{transcript}}' },
        ],
      },
    },
  };
}

// Returns { status, body } for the route to send.
export async function placeCheckinCall(user, params) {
  const action = String(params.action || '').toLowerCase();
  if (action !== 'in' && action !== 'out') return { status: 400, body: { error: 'action must be "in" or "out"' } };

  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return { status: 500, body: { error: 'Server not configured' } };
  const headers = { 'Content-Type': 'application/json', apikey: key, Authorization: `Bearer ${key}` };
  const base = `${supabaseUrl()}/rest/v1/call_queue`;

  let tracking = String(params.tracking || '').replace(/\D/g, '');
  let reused = false;
  if (!tracking) {
    const since = new Date(Date.now() - REUSE_HOURS * 3600e3).toISOString();
    const r = await fetch(
      `${base}?queued_by=eq.checkin&created_at=gte.${encodeURIComponent(since)}&select=purpose&order=id.desc&limit=1`,
      { headers });
    const m = r.ok ? String((await r.json().catch(() => []))?.[0]?.purpose || '').match(/tracking (\d+)/) : null;
    if (!m) return { status: 400, body: { error: 'Which tracking number? None given and no check-in today to reuse.' } };
    tracking = m[1];
    reused = true;
  }

  // Values read off Jake's screenshot win; settings are the fallback.
  const phone = toE164(params.phone || (await getSetting('checkin_ivr_phone')));
  const pin = String(params.pin || (await getSetting('checkin_ivr_pin')) || '').replace(/\D/g, '');
  const extra = cleanExtra(params.extra);
  const vapiKey = process.env.VAPI_PRIVATE_KEY || (await getSetting('vapi_private_key'));
  if (!phone) return { status: 409, body: { error: 'Which number do I call? None on the screenshot and none saved (settings.checkin_ivr_phone).' } };
  if (!pin) return { status: 409, body: { error: 'What is the PIN? None on the screenshot and none saved (settings.checkin_ivr_pin).' } };
  if (!vapiKey) return { status: 500, body: { error: 'Vapi key missing' } };

  // Filed as already 'calling' so the queue runner never sees it as queued.
  const note = String(params.note || '').trim().slice(0, 500) || null;
  const ins = await fetch(base, {
    method: 'POST',
    headers: { ...headers, Prefer: 'return=representation' },
    body: JSON.stringify({
      phone, client_name: 'Check-in line', purpose: `IVR check-${action}, tracking ${tracking}`,
      context: note, status: 'calling', attempts: 1, queued_by: 'checkin',
    }),
  });
  const rows = await ins.json().catch(() => null);
  const id = rows?.[0]?.id;
  if (!ins.ok || !id) return { status: 502, body: { error: `Could not log the call: ${JSON.stringify(rows).slice(0, 200)}` } };

  let vapiCallId = null;
  let vapiError = null;
  try {
    const vr = await fetch('https://api.vapi.ai/call', {
      method: 'POST',
      headers: { Authorization: `Bearer ${vapiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        phoneNumberId: PHONE_NUMBER_ID,
        customer: { number: phone, name: 'Check-in line' },
        assistant: checkinAssistant(action, pin, tracking, extra),
      }),
    });
    const vd = await vr.json().catch(() => ({}));
    if (vr.ok && vd.id) vapiCallId = vd.id;
    else vapiError = String(vd.message || vd.error || vr.status).slice(0, 200);
  } catch (e) {
    vapiError = String(e.message || e).slice(0, 200);
  }

  await fetch(`${base}?id=eq.${id}`, {
    method: 'PATCH',
    headers: { ...headers, Prefer: 'return=minimal' },
    body: JSON.stringify(vapiCallId
      ? { vapi_call_id: vapiCallId }
      : { status: 'failed', outcome: `place failed: ${vapiError}` }),
  });
  console.log('[ivr-checkin]', { id, action, by: user?.email || user?.id, vapiCallId, vapiError });

  if (!vapiCallId) return { status: 502, body: { error: `Check-in call did not go out: ${vapiError}`, id } };
  return { status: 200, body: { ok: true, id, action, tracking, reusedTracking: reused, vapiCallId } };
}
