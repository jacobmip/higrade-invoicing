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
  rpc, readBody, fullUrl, webhookSecret, secretMatches, validateTwilioSignature, twilioAuthToken,
  rehostTwilioMedia, getSetting,
} from './_lib/sms.js';

export const config = { runtime: 'nodejs', maxDuration: 30 };

// Same origin this route is served from; hardcoded so a Twilio retry hitting a
// preview deployment still mails through production.
const APP_URL = process.env.APP_URL || 'https://higrade-invoicing.vercel.app';

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

  const authToken = await twilioAuthToken();
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
    authed = secretMatches(url.searchParams.get('k'), await webhookSecret());
    if (!authed) return deny(res, 'no signature and no valid ?k= secret');
    console.warn('[sms-inbound] accepted via ?k= fallback; set TWILIO_AUTH_TOKEN for signature validation');
  }

  const from = params.From || params.from || '';
  const body = params.Body || params.body || '';
  const sid  = params.MessageSid || params.SmsSid || null;

  // A photo with no caption is the single most likely thing a customer sends
  // after being asked to text a picture of the problem, so an empty body is
  // only grounds for ignoring the message when there is no media either.
  // Rejecting on body alone silently discarded exactly the messages this
  // whole flow exists to collect.
  const mediaCount = parseInt(params.NumMedia || '0', 10) || 0;

  if (!from || (!String(body).trim() && mediaCount === 0)) {
    console.warn('[sms-inbound] no From, and no body or media; ignoring');
    return twiml(res);
  }

  try {
    const secret = await webhookSecret();

    // Re-host any attachments before logging, so the stored row points at a URL
    // that will still work in six months.
    const media = await rehostTwilioMedia(params);

    const result = await rpc('log_client_message', {
      p_secret: secret,
      p_phone: from,
      p_direction: 'inbound',
      p_body: String(body),
      p_call_id: sid,
      p_media: media.length ? media : null,
    });

    // Put texted photos on the job they belong to, not just in the thread.
    let attached = null;
    if (media.length && result?.client_id) {
      try {
        attached = await rpc('attach_media_to_recent_estimate', {
          p_secret: secret,
          p_client_id: result.client_id,
          p_media: media,
          p_caption: String(body).slice(0, 200) || null,
        });
      } catch (e) {
        console.error('[sms-inbound] attach to estimate failed:', e.message || e);
      }
    }

    // Tell Jake. Without this the message lands in a table nobody reads --
    // which is exactly what happened on 2026-09-07 when a customer texted
    // their address and it went nowhere anyone could see.
    try {
      const recipients = String(await getSetting('lead_notify_to') || '')
        .split(',').map(s => s.trim()).filter(Boolean);
      if (recipients.length) {
        await fetch(`${APP_URL}/api/send-email`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            to: recipients,
            bccAdmin: false,
            template: 'sms',
            subject: `Text from ${result?.client_name || from}`,
            clientName: result?.client_name || 'Unknown number',
            leadPhone: from,
            transcript: String(body),
            smsMedia: media,
            invoiceId: attached?.estimate_id || null,
          }),
        });
      }
    } catch (e) {
      console.error('[sms-inbound] alert email failed:', e.message || e);
    }

    console.log('[sms-inbound] logged', {
      from, matched: result?.matched, client: result?.client_name || null,
      media: media.length, attachedTo: attached?.estimate_id || null,
    });
  } catch (e) {
    // Swallow: returning non-200 makes Twilio retry, and a retry storm would
    // duplicate the message once the underlying issue clears.
    console.error('[sms-inbound] log failed:', e.message || e);
  }

  return twiml(res);
}
