export const config = { runtime: 'edge' };

export default async function handler(req) {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  try {
    const { to, clientName, estimateId, total, signingLink, items } = await req.json();

    const resendKey = process.env.RESEND_API_KEY;
    if (!resendKey) return new Response(JSON.stringify({ error: 'Email not configured' }), {
      status: 500, headers: { 'Content-Type': 'application/json' }
    });

    const itemsHtml = (items || []).map(it =>
      `<tr><td style="padding: 9px 14px; border-bottom: 1px solid #eee; color: #333;">${it.name || it.desc || ''}</td><td style="padding: 9px 14px; border-bottom: 1px solid #eee; text-align: right; font-weight: bold; color: #E8622A;">$${it.total || ''}</td></tr>`
    ).join('');

    const body = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: #0a1628; padding: 24px; text-align: center;">
          <h1 style="color: #E8622A; margin: 0; font-size: 24px; letter-spacing: 2px;">HI GRADE PLUMBING LLC</h1>
          <p style="color: #8899bb; margin: 4px 0 0; font-size: 12px; letter-spacing: 1px;">HONOLULU, HAWAII · (808) 393-0015</p>
        </div>
        <div style="padding: 32px; background: #f4f6fa;">
          <p style="color: #444; font-size: 16px;">Hi ${clientName},</p>
          <p style="color: #444;">We've prepared estimate <strong>${estimateId}</strong> for your review. Please look over the details below and click the button to approve.</p>
          ${itemsHtml ? `<table style="width: 100%; border-collapse: collapse; margin: 20px 0; background: #fff; border-radius: 8px; overflow: hidden;"><tbody>${itemsHtml}</tbody></table>` : ''}
          <div style="background: #0a1628; color: #E8622A; padding: 16px; border-radius: 8px; text-align: center; margin: 24px 0;">
            <div style="color: #8899bb; font-size: 11px; letter-spacing: 1px; text-transform: uppercase; margin-bottom: 4px;">Estimate Total</div>
            <strong style="font-size: 24px;">$${total}</strong>
          </div>
          <div style="text-align: center; margin: 28px 0;">
            <a href="${signingLink}" target="_blank" style="display: inline-block; background: #E8622A; color: #ffffff; text-decoration: none; font-size: 17px; font-weight: bold; padding: 16px 40px; border-radius: 8px; letter-spacing: 0.5px;">
              ✍ Review &amp; Sign Estimate
            </a>
            <p style="color: #999; font-size: 12px; margin: 10px 0 0;">Tap the button above to sign on your phone or computer</p>
          </div>
          <p style="color: #666; margin-top: 24px; font-size: 13px; line-height: 1.6;">
            Questions? Call or text us at <strong>808-393-0015</strong><br>
            Email: higradeplumbing@gmail.com
          </p>
        </div>
        <div style="background: #0a1628; padding: 16px; text-align: center;">
          <p style="color: #8899bb; font-size: 11px; margin: 0;">HI Grade Plumbing LLC · Honolulu, HI · higradeplumbing.com</p>
        </div>
      </div>
    `;

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${resendKey}` },
      body: JSON.stringify({
        from: 'HI Grade Plumbing <invoices@higradeplumbing.com>',
        to: [to],
        subject: `Estimate ${estimateId} from HI Grade Plumbing — Ready to Review`,
        html: body,
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
