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
// The line's number and the PIN live in settings (checkin_ivr_phone,
// checkin_ivr_pin) and never leave the server.
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

export function checkinAssistant(action, pin, tracking) {
  const word = action === 'in' ? 'IN' : 'OUT';
  const prompt = `You are placing a call to an automated phone system (IVR) to check a plumbing technician ${word} of a job. No human will answer. You navigate the menus by pressing keypad keys with the dtmf tool. You do not speak unless a prompt explicitly asks for a spoken answer and gives no keypad option.

The answers you have:
- Language: English.
- IVR PIN: ${pin}
- Tracking number: ${tracking}
- Checking: ${word}
- Number of technicians on the job: 1

How to behave:
- Listen to the whole prompt before pressing anything. Press only the keys that prompt asks for.
- When it asks for the PIN or tracking number, send the digits in one dtmf call. Add # at the end only if the prompt says to end with pound or #.
- When it asks whether you are checking in or out, press the key it names for ${action === 'in' ? 'check in' : 'check out'}.
- When it asks how many technicians, press 1 (add # only if told to).
- When it reads back a value and asks you to confirm, confirm only if it matches the answers above exactly. If it does not match, choose the option to re-enter it.
- If it asks for something not in your answers, or the same prompt fails twice, end the call. Do not guess.
- Once the system confirms the check-${action} was recorded, listen for any confirmation number, then end the call.
- Never press 0 for an operator.`;
  return {
    name: `HI Grade IVR Check-${action}`,
    firstMessageMode: 'assistant-waits-for-user',
    model: {
      provider: 'openai', model: 'gpt-4.1', temperature: 0,
      messages: [{ role: 'system', content: prompt }],
      tools: [{ type: 'dtmf' }, { type: 'endCall' }],
    },
    voice: { provider: 'vapi', voiceId: 'Clara' },
    transcriber: { provider: 'soniox', model: 'stt-rt-v5' },
    // IVRs pause mid-prompt and read digits slowly. Wait for the full prompt.
    startSpeakingPlan: {
      waitSeconds: 1.5,
      transcriptionEndpointingPlan: { onPunctuationSeconds: 0.8, onNoPunctuationSeconds: 2.5, onNumberSeconds: 2 },
    },
    silenceTimeoutSeconds: 30,
    maxDurationSeconds: 300,
    voicemailDetection: { provider: 'vapi', enabled: false },
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

  const phone = toE164(params.phone || (await getSetting('checkin_ivr_phone')));
  const pin = String((await getSetting('checkin_ivr_pin')) || '').replace(/\D/g, '');
  const vapiKey = process.env.VAPI_PRIVATE_KEY || (await getSetting('vapi_private_key'));
  if (!phone) return { status: 409, body: { error: 'No check-in line number saved (settings.checkin_ivr_phone).' } };
  if (!pin) return { status: 409, body: { error: 'No IVR PIN saved (settings.checkin_ivr_pin).' } };
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
        assistant: checkinAssistant(action, pin, tracking),
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
