export const config = { runtime: 'edge' };

export default async function handler(req) {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const { to, clientName, invoiceId, total, message, viewLink, reviewLinks } = await req.json();

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
    const reviewBtn = viewLink
      ? `<div style="text-align: center; margin: 20px 0 8px;">
           <a href="${escapeHtml(viewLink)}" target="_blank" style="display: inline-block; background: #0070ba; color: #ffffff; text-decoration: none; font-size: 16px; font-weight: bold; padding: 14px 36px; border-radius: 6px;">
             Review &amp; Pay
           </a>
           <p style="color: #999; font-size: 12px; margin: 10px 0 0;">Tap above to view your invoice and pay securely</p>
         </div>`
      : '';

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
            <div style="color:#888;font-size:11px;font-weight:bold;letter-spacing:2px;text-transform:uppercase;">Invoice ${escapeHtml(invoiceId || '')}</div>
            <div style="color:#0a1628;font-size:30px;font-weight:bold;margin-top:8px;">USD $${total}</div>
            ${reviewBtn}
          </div>
          <div style="color: #444; font-size: 15px; line-height: 1.6; margin-bottom: 16px;">${messageHtml}</div>
          <div style="margin-top: 20px; padding: 14px; background: #fff; border-radius: 8px; border: 1px solid #e8ecf4;">
            <p style="color: #666; font-size: 13px; font-weight: bold; margin: 0 0 6px;">Other Payment Options</p>
            <p style="color: #444; font-size: 13px; margin: 0; line-height: 1.7;">
              💚 <strong>Venmo:</strong> @HIGP808<br>
              💙 <strong>Zelle / PayPal:</strong> higradeplumbing@gmail.com<br>
              💵 Cash or Check accepted
            </p>
          </div>
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

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${resendKey}`,
      },
      body: JSON.stringify({
        from: 'HI Grade Plumbing <invoices@higradeplumbing.com>',
        to: [to],
        subject: `Invoice ${invoiceId} from HI Grade Plumbing`,
        html: emailBody,
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
