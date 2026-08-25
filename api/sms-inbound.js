// /api/sms-inbound
// Twilio's inbound-SMS webhook. Point the number's Messaging webhook here.
//
// This is the half of the SMS system that works TODAY. A2P 10DLC blocks
// application-to-person OUTBOUND messages to US numbers; a customer texting
// the business number is person-to-application and is not blocked. So Lisa
// can ask callers to text their service address and photos, and those land
// here even though we cannot text them first yet.
//
// Security: Twilio signs every request with X-Twilio-Signature, an HMAC-SHA1
// over the URL plus sorted params. Validated when TWILIO_AUTH_TOKEN is set.
// Without that, anyone who guessed this URL could inject fake customer
// messages into the client record, so an unsigned request is only accepted
// when a ?k=<secret> matching SMS_WEBHOOK_SECRET is present as a fallback.
//
// Responds with empty TwiML: Twilio requires a 200 with valid XML, and an
// empty <Response/> means "no auto-reply". Auto-replying would be an outbound
// message and would be dropped by carriers anyway.

import {
  rpc, readBody, fullUrl, webhookSecret, secretMatches, validateTwilioSignature,
} from './_lib/sms.js';

export const config = { runtime: 'nodejs', maxDuration: 10 };

function twiml(res, status = 200) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'text/xml');
  res.end('<?xml version="1.0" encoding="UTF-8"?><Response/>');
}

function deny(res, reason) {
  console.warn('[sms-inbound] rejected:', reason);
  res.statusCode = 403;
  res.setHeader('Content-Type', 'text/plain');
  res.end('forbidden');
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.statusCode = 405;
    return res.end('Method not allowed');
  }

  let params;
  try {
    ({ params } = await readBody(req));
  } catch (e) {
    console.error('[sms-inbound] body read failed:', e);
    return twiml(res); // never make Twilio retry over a parse problem
  }

  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const signature = req.headers['x-twilio-signature'];

  let authed = false;
  if (authToken && signature) {
    authed = validateTwilioSignature({
      signature, url: fullUrl(req), params, authToken,
    });
    if (!authed) return deny(res, 'bad twilio signature');
  } else {
    // Fallback for before TWILIO_AUTH_TOKEN is set in Vercel env.
    const url = new URL(fullUrl(req));
    authed = secretMatches(url.searchParams.get('k'), webhookSecret());
    if (!authed) return deny(res, 'no signature and no valid ?k= secret');
    console.warn('[sms-inbound] accepted via ?k= fallback; set TWILIO_AUTH_TOKEN for signature validation');
  }

  const from = params.From || params.from || '';
  const body = params.Body || params.body || '';
  const sid  = params.MessageSid || params.SmsSid || null;

  if (!from || !String(body).trim()) {
    console.warn('[sms-inbound] missing From or Body; ignoring');
    return twiml(res);
  }

  try {
    const result = await rpc('log_client_message', {
      p_secret: webhookSecret(),
      p_phone: from,
      p_direction: 'inbound',
      p_body: String(body),
      p_call_id: sid,
    });
    console.log('[sms-inbound] logged', {
      from, matched: result?.matched, client: result?.client_name || null,
    });
  } catch (e) {
    // Swallow: returning non-200 makes Twilio retry, and a retry storm would
    // duplicate the message once the underlying issue clears.
    console.error('[sms-inbound] log failed:', e.message || e);
  }

  return twiml(res);
}
