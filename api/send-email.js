export const config = { runtime: 'edge' };

export default async function handler(req) {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const { to, cc, ccAddresses, bccAdmin = true, subject, template, leadPhone, leadDetails, leadWhen, clientName, invoiceId, total, message, viewLink, reviewLinks, isPaidInFull, lastPayment, transcript, callId, callSeconds, callUrl, matchedClient } = await req.json();
    // ccAddresses is the new multi-recipient field (array). cc is the legacy
    // single-string field. Merge them and deduplicate.
    const ccList = [...new Set([
      ...(Array.isArray(ccAddresses) ? ccAddresses : (ccAddresses ? [ccAddresses] : [])),
      ...(cc && cc.trim() ? [cc.trim()] : []),
    ])].filter(Boolean);

    const resendKey = process.env.RESEND_API_KEY;
    if (!resendKey) {
      return new Response(JSON.stringify({ error: 'Email not configured' }), {
        status: 500, headers: { 'Content-Type': 'application/json' }
      });
    }

    // Escape HTML entities then convert newlines to <br>. The user-edited
    // multi-line message must render as typed without re-introducing XSS.
    const escapeHtml = (s) => String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
    const messageHtml = message && message.trim()
      ? escapeHtml(message).replace(/\n/g, '<br>')
      : `Aloha ${escapeHtml(clientName || '')},<br><br>Please find your invoice <strong>${escapeHtml(invoiceId || '')}</strong> ready for review.`;

    // Link-only design (mirrors Invoice Simple). The customer must click the
    // Review button to see the full invoice — that click is what we track.
    // When the invoice is paid in full, the CTA flips to a "View Receipt"
    // label so the customer doesn't think we're asking them to pay again.
    const ctaLabel = isPaidInFull ? 'View Receipt' : 'Review &amp; Pay';
    const ctaHelper = isPaidInFull
      ? 'Tap above for your full receipt and invoice details'
      : 'Tap above to view your invoice and pay securely';
    const reviewBtn = viewLink
      ? `<div style="text-align: center; margin: 20px 0 8px;">
           <a href="${escapeHtml(viewLink)}" target="_blank" style="display: inline-block; background: #0070ba; color: #ffffff; text-decoration: none; font-size: 16px; font-weight: bold; padding: 14px 36px; border-radius: 6px;">
             ${ctaLabel}
           </a>
           <p style="color: #999; font-size: 12px; margin: 10px 0 0;">${ctaHelper}</p>
         </div>`
      : '';

    // Receipt header pieces — only used when isPaidInFull. Shows a green
    // "PAID IN FULL" pill and the payment method/date underneath the total.
    const fmtPaymentDate = (d) => {
      if (!d) return '';
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(d));
      if (!m) return escapeHtml(String(d));
      const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      return `${months[parseInt(m[2],10)-1]} ${parseInt(m[3],10)}, ${m[1]}`;
    };
    const paidPill = isPaidInFull
      ? `<div style="display:inline-block;margin-top:12px;background:#4ecb71;color:#fff;font-size:13px;font-weight:bold;letter-spacing:1.5px;padding:6px 16px;border-radius:20px;">PAID IN FULL</div>`
      : '';
    const paidMeta = (isPaidInFull && lastPayment)
      ? `<div style="color:#666;font-size:13px;margin-top:14px;">Paid by ${escapeHtml(lastPayment.method || 'payment')}${lastPayment.date ? ' \u00b7 ' + fmtPaymentDate(lastPayment.date) : ''}</div>`
      : '';
    const summaryLabel = isPaidInFull
      ? `Receipt \u00b7 Invoice ${escapeHtml(invoiceId || '')}`
      : `Invoice ${escapeHtml(invoiceId || '')}`;

    // Review request footer. Rendered only when the client passed a
    // non-empty reviewLinks array — estimates always pass [] so they
    // never show this. Each platform gets its own button so the customer
    // doesn't have to pick from a dropdown; tap and go.
    const platformMeta = {
      yelp:   { label: 'Leave a Yelp review',   bg: '#d32323', emoji: '\u2B50' },
      google: { label: 'Leave a Google review', bg: '#4285F4', emoji: '\u2B50' },
    };
    const reviewBlock = (Array.isArray(reviewLinks) && reviewLinks.length > 0)
      ? `<div style="margin-top: 22px; padding: 18px; background: #fff; border-radius: 10px; border: 1px solid #e8ecf4; text-align: center;">
           <p style="color: #0a1628; font-size: 15px; font-weight: 700; margin: 0 0 6px;">Mahalo for choosing HI Grade Plumbing</p>
           <p style="color: #555; font-size: 13px; margin: 0 0 14px; line-height: 1.5;">If we did right by you, would you take 30 seconds to leave a review? It helps a small local business more than you\u2019d believe.</p>
           ${reviewLinks.map(r => {
             const meta = platformMeta[r.platform];
             if (!meta || !r.url) return '';
             return `<a href="${escapeHtml(r.url)}" target="_blank" rel="noopener" style="display: inline-block; background: ${meta.bg}; color: #ffffff; text-decoration: none; font-size: 14px; font-weight: bold; padding: 10px 22px; border-radius: 6px; margin: 4px 4px 0;">${meta.emoji} ${meta.label}</a>`;
           }).join('')}
         </div>`
      : '';

    const fallbackUrl = viewLink
      ? `<p style="color:#888;font-size:12px;margin:14px 0 0;text-align:center;">Trouble viewing invoice? Copy/paste this URL:<br><span style="color:#3070b8;word-break:break-all;">${escapeHtml(viewLink)}</span></p>`
      : '';

    const emailBody = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: #0a1628; padding: 24px; text-align: center;">
          <h1 style="color: #E8622A; margin: 0; font-size: 24px; letter-spacing: 2px;">HI GRADE PLUMBING LLC</h1>
          <p style="color: #8899bb; margin: 4px 0 0; font-size: 12px; letter-spacing: 1px;">HONOLULU, HAWAII · LIC PJ-13579</p>
        </div>
        <div style="padding: 32px 24px; background: #f4f6fa;">
          <div style="background:#fff;border-radius:10px;padding:22px;text-align:center;box-shadow:0 1px 6px rgba(0,0,0,0.06);margin-bottom:20px;">
            <div style="color:#888;font-size:11px;font-weight:bold;letter-spacing:2px;text-transform:uppercase;">${summaryLabel}</div>
            <div style="color:#0a1628;font-size:30px;font-weight:bold;margin-top:8px;">USD $${total}</div>
            ${paidPill}
            ${paidMeta}
            ${reviewBtn}
          </div>
          <div style="color: #444; font-size: 15px; line-height: 1.6; margin-bottom: 16px;">${messageHtml}</div>
          ${isPaidInFull ? '' : `<div style="margin-top: 20px; padding: 14px; background: #fff; border-radius: 8px; border: 1px solid #e8ecf4;">
            <p style="color: #666; font-size: 13px; font-weight: bold; margin: 0 0 6px;">Other Payment Options</p>
            <p style="color: #444; font-size: 13px; margin: 0; line-height: 1.7;">
              💚 <strong>Venmo:</strong> @HIGP808<br>
              💙 <strong>Zelle / PayPal:</strong> higradeplumbing@gmail.com<br>
              💵 Cash or Check accepted
            </p>
          </div>`}
          <p style="color: #666; margin-top: 20px; font-size: 13px;">
            Questions? Call or text us at <strong>808-393-0015</strong><br>
            Email: higradeplumbing@gmail.com
          </p>
          ${reviewBlock}
          ${fallbackUrl}
        </div>
        <div style="background: #0a1628; padding: 16px; text-align: center;">
          <p style="color: #8899bb; font-size: 11px; margin: 0;">HI Grade Plumbing LLC · Honolulu, HI · higradeplumbing.com</p>
        </div>
      </div>
    `;

    // ─── AI receptionist lead alert ──────────────────────────────────────────
    // An internal note to Jake, not a customer document. The invoice template
    // above renders letterhead, a license number, a currency label and a
    // "Review & Pay" button, none of which belong on a lead, and they pushed
    // the name and callback number below the fold. The action that actually
    // matters on a lead is calling the person back, so the phone number is the
    // button. Triggered by template: 'lead' from notify_owner_of_lead().
    const isLead = template === 'lead';

    // ─── Call archive ────────────────────────────────────────────────────────
    // Sent after every AI receptionist call. The transcript lives in the body
    // as plain text on purpose: it is readable on a phone, searchable in
    // Gmail, and reachable by the AIOS assistant through the Gmail connection,
    // none of which is true of a row in the database.
    //
    // The audio link points at the Vapi dashboard, NOT at the raw recording
    // URL. Vapi stores recordings on Cloudflare R2 behind authentication —
    // fetching the recordingUrl directly returns
    // <Error><Code>InvalidArgument</Code><Message>Authorization</Message></Error>
    // so emailing it would ship a dead link.
    const isCall = template === 'call';

    const mmss = (s) => {
      const n = parseInt(s, 10);
      if (!Number.isFinite(n) || n <= 0) return '';
      return `${Math.floor(n / 60)}m ${String(n % 60).padStart(2, '0')}s`;
    };

    const factRow = (label, value) => value
      ? `<tr>
           <td style="padding:3px 12px 3px 0;color:#8894a8;font-size:12px;white-space:nowrap;vertical-align:top;">${escapeHtml(label)}</td>
           <td style="padding:3px 0;color:#243040;font-size:13px;">${value}</td>
         </tr>`
      : '';

    const callHtml = `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;max-width:620px;margin:0 auto;background:#ffffff;border:1px solid #e3e8f0;border-radius:10px;overflow:hidden;">
        <div style="background:#0a1628;padding:14px 20px;">
          <p style="color:#7fd1a3;font-size:11px;font-weight:bold;letter-spacing:2px;margin:0;">CALL RECORD &middot; LISA</p>
        </div>
        <div style="padding:20px;">
          <table style="border-collapse:collapse;margin-bottom:16px;">
            ${factRow('Caller', escapeHtml(clientName || 'Unknown'))}
            ${factRow('Number', leadPhone
                ? `<a href="tel:${escapeHtml(String(leadPhone).replace(/[^\d+]/g, ''))}" style="color:#0070ba;text-decoration:none;font-weight:bold;">${escapeHtml(leadPhone)}</a>`
                : '')}
            ${factRow('Known client', matchedClient ? escapeHtml(matchedClient) : '')}
            ${factRow('Estimate', invoiceId ? escapeHtml(invoiceId) : '')}
            ${factRow('Length', escapeHtml(mmss(callSeconds)))}
          </table>

          ${callUrl ? `<a href="${escapeHtml(callUrl)}" style="display:inline-block;background:#0070ba;color:#fff;text-decoration:none;font-size:14px;font-weight:bold;padding:10px 20px;border-radius:6px;">Listen to the recording</a>
          <p style="color:#8894a8;font-size:11px;margin:8px 0 0;">Opens the call in your Vapi dashboard. Recordings are stored by Vapi, not by us.</p>` : ''}

          ${transcript ? `<div style="margin-top:18px;">
            <p style="color:#66748c;font-size:11px;font-weight:bold;letter-spacing:1px;margin:0 0 8px;">TRANSCRIPT</p>
            <div style="background:#f5f7fa;border:1px solid #e8ecf4;border-radius:8px;padding:14px;color:#333;font-size:13px;line-height:1.65;white-space:pre-wrap;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;">${escapeHtml(transcript)}</div>
          </div>` : `<p style="color:#8894a8;font-size:13px;margin-top:18px;">No transcript captured for this call.</p>`}

          ${callId ? `<p style="color:#b3bccb;font-size:11px;margin:16px 0 0;">Vapi call id: ${escapeHtml(callId)}</p>` : ''}
        </div>
      </div>
    `;

    const digits = String(leadPhone || '').replace(/\D/g, '');
    const telHref = digits ? `tel:${digits.length === 10 ? '+1' : ''}${digits}` : '';
    const prettyPhone = digits.length === 10
      ? `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
      : (leadPhone || 'no number given');

    const callBtn = telHref
      ? `<a href="${escapeHtml(telHref)}" style="display:inline-block;background:#0070ba;color:#ffffff;text-decoration:none;font-size:19px;font-weight:bold;padding:14px 32px;border-radius:6px;">
           ${escapeHtml(prettyPhone)}
         </a>
         <p style="color:#999;font-size:12px;margin:8px 0 0;">Tap to call back</p>`
      : `<p style="color:#c0392b;font-size:16px;font-weight:bold;margin:0;">No callback number captured</p>`;

    const whenBlock = leadWhen
      ? `<div style="margin:18px 0 0;padding:12px 14px;background:#fff8e6;border:1px solid #f0dfae;border-radius:8px;">
           <p style="color:#8a6d1f;font-size:13px;margin:0;"><strong>Requested time:</strong> ${escapeHtml(leadWhen)}</p>
         </div>`
      : '';

    const detailsBlock = leadDetails
      ? `<div style="margin:18px 0 0;padding:14px;background:#f5f7fa;border:1px solid #e8ecf4;border-radius:8px;">
           <p style="color:#66748c;font-size:11px;font-weight:bold;letter-spacing:1px;margin:0 0 8px;">WHAT THEY SAID</p>
           <div style="color:#333;font-size:14px;line-height:1.6;">${escapeHtml(leadDetails).replace(/\n/g, '<br>')}</div>
         </div>`
      : '';

    const leadHtml = `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;max-width:520px;margin:0 auto;background:#ffffff;border-radius:10px;overflow:hidden;border:1px solid #e3e8f0;">
        <div style="background:#0a1628;padding:14px 20px;">
          <p style="color:#7fd1a3;font-size:11px;font-weight:bold;letter-spacing:2px;margin:0;">NEW LEAD &middot; LISA</p>
        </div>
        <div style="padding:22px 20px;text-align:center;">
          <p style="color:#0a1628;font-size:21px;font-weight:bold;margin:0 0 14px;">${escapeHtml(clientName || 'Unknown caller')}</p>
          ${callBtn}
          <div style="text-align:left;">
            ${whenBlock}
            ${detailsBlock}
          </div>
          <p style="color:#8894a8;font-size:12px;margin:20px 0 0;text-align:left;">
            Draft estimate <strong>${escapeHtml(invoiceId || '')}</strong> is waiting in the app.
          </p>
        </div>
      </div>
    `;

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${resendKey}`,
      },
      body: JSON.stringify({
        from: 'HI Grade Plumbing <invoices@higradeplumbing.com>',
        to: Array.isArray(to) ? to : [to],
        ...(ccList.length > 0 ? { cc: ccList } : {}),
        // BCC Jake on every outbound customer email unless he opted out
        // for this specific send (bccAdmin=false in the modal).
        ...(bccAdmin ? { bcc: ['higradeplumbing@gmail.com'] } : {}),
        // Optional subject override. Lead alerts from the AI receptionist pass
        // their own so they don't sit in the inbox looking like a customer
        // invoice. Falls back to the normal invoice/receipt subjects.
        subject: (typeof subject === 'string' && subject.trim())
          ? subject.trim()
          : (isPaidInFull
              ? `Mahalo \u2014 ${invoiceId} paid in full`
              : `Invoice ${invoiceId} from HI Grade Plumbing`),
        html: isCall ? callHtml : (isLead ? leadHtml : emailBody),
      }),
    });

    const data = await res.json();
    return new Response(JSON.stringify(data), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { 'Content-Type': 'application/json' }
    });
  }
}
