export const config = { runtime: 'edge' };

export default async function handler(req) {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  try {
    // viewLink takes the customer to the trackable public viewer; from there
    // they click Review & Sign to reach the signing canvas. items kept for
    // legacy callers but no longer rendered (link-only design).
    const { to, clientName, estimateId, total, viewLink, message, attachmentFilename, attachmentBase64 } = await req.json();

    const resendKey = process.env.RESEND_API_KEY;
    if (!resendKey) return new Response(JSON.stringify({ error: 'Email not configured' }), {
      status: 500, headers: { 'Content-Type': 'application/json' }
    });

    const escapeHtml = (s) => String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
    const messageHtml = message && message.trim()
      ? escapeHtml(message).replace(/\n/g, '<br>')
      : `Aloha ${escapeHtml(clientName || '')},<br><br>We've prepared estimate <strong>${escapeHtml(estimateId || '')}</strong> for your review.`;

    const reviewBtn = viewLink
      ? `<div style="text-align: center; margin: 20px 0 8px;">
           <a href="${escapeHtml(viewLink)}" target="_blank" style="display: inline-block; background: #E8622A; color: #ffffff; text-decoration: none; font-size: 17px; font-weight: bold; padding: 16px 40px; border-radius: 8px; letter-spacing: 0.5px;">
             ✍ Review &amp; Sign Estimate
           </a>
           <p style="color: #999; font-size: 12px; margin: 10px 0 0;">Tap above to view the estimate and sign on your phone or computer</p>
         </div>`
      : '';

    const fallbackUrl = viewLink
      ? `<p style="color:#888;font-size:12px;margin:14px 0 0;text-align:center;">Trouble viewing estimate? Copy/paste this URL:<br><span style="color:#3070b8;word-break:break-all;">${escapeHtml(viewLink)}</span></p>`
      : '';

    const body = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: #0a1628; padding: 24px; text-align: center;">
          <h1 style="color: #E8622A; margin: 0; font-size: 24px; letter-spacing: 2px;">HI GRADE PLUMBING LLC</h1>
          <p style="color: #8899bb; margin: 4px 0 0; font-size: 12px; letter-spacing: 1px;">HONOLULU, HAWAII · (808) 393-0015</p>
        </div>
        <div style="padding: 32px 24px; background: #f4f6fa;">
          <div style="background:#fff;border-radius:10px;padding:22px;text-align:center;box-shadow:0 1px 6px rgba(0,0,0,0.06);margin-bottom:20px;">
            <div style="color:#888;font-size:11px;font-weight:bold;letter-spacing:2px;text-transform:uppercase;">Estimate ${escapeHtml(estimateId || '')}</div>
            <div style="color:#0a1628;font-size:30px;font-weight:bold;margin-top:8px;">USD $${total}</div>
            ${reviewBtn}
          </div>
          <div style="color: #444; font-size: 15px; line-height: 1.6; margin-bottom: 16px;">${messageHtml}</div>
          <p style="color: #666; margin-top: 24px; font-size: 13px; line-height: 1.6;">
            Questions? Call or text us at <strong>808-393-0015</strong><br>
            Email: higradeplumbing@gmail.com
          </p>
          ${fallbackUrl}
        </div>
        <div style="background: #0a1628; padding: 16px; text-align: center;">
          <p style="color: #8899bb; font-size: 11px; margin: 0;">HI Grade Plumbing LLC · Honolulu, HI · higradeplumbing.com</p>
        </div>
      </div>
    `;

    // Optional printable PDF attachment for older clients who like a paper copy.
    const resendPayload = {
      from: 'HI Grade Plumbing <invoices@higradeplumbing.com>',
      to: [to],
      subject: `Estimate ${estimateId} from HI Grade Plumbing — Ready to Review`,
      html: body,
    };
    if (attachmentBase64) {
      resendPayload.attachments = [{
        filename: attachmentFilename || `Estimate_${estimateId || 'document'}.pdf`,
        content: attachmentBase64,
      }];
    }

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${resendKey}` },
      body: JSON.stringify(resendPayload),
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
