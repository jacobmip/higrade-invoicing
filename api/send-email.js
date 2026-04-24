export const config = { runtime: 'edge' };

export default async function handler(req) {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const { to, clientName, invoiceId, total, invoiceHtml } = await req.json();

    const resendKey = process.env.RESEND_API_KEY;
    if (!resendKey) {
      return new Response(JSON.stringify({ error: 'Email not configured' }), {
        status: 500, headers: { 'Content-Type': 'application/json' }
      });
    }

    const emailBody = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: #0a1628; padding: 24px; text-align: center;">
          <h1 style="color: #E8622A; margin: 0; font-size: 24px; letter-spacing: 2px;">HI GRADE PLUMBING LLC</h1>
          <p style="color: #8899bb; margin: 4px 0 0; font-size: 12px; letter-spacing: 1px;">HONOLULU, HAWAII · LIC PJ-13579</p>
        </div>
        <div style="padding: 32px; background: #f4f6fa;">
          <p style="color: #444; font-size: 16px;">Hi ${clientName},</p>
          <p style="color: #444;">Please find your invoice <strong>${invoiceId}</strong> attached below.</p>
          ${invoiceHtml}
          <div style="background: #0a1628; color: #E8622A; padding: 16px; border-radius: 8px; text-align: center; margin-top: 24px;">
            <strong style="font-size: 20px;">Total Due: $${total}</strong>
          </div>
          <div style="text-align: center; margin-top: 20px;">
            <a href="https://www.paypal.com/cgi-bin/webscr?cmd=_xclick&business=higradeplumbing%40gmail.com&amount=${total}&currency_code=USD&item_name=Invoice%20${invoiceId}&no_note=1&no_shipping=1" target="_blank" style="display: inline-block; background: #0070ba; color: #ffffff; text-decoration: none; font-size: 16px; font-weight: bold; padding: 14px 36px; border-radius: 6px;">
              Pay $${total} Now
            </a>
            <p style="color: #999; font-size: 12px; margin: 8px 0 0;">Credit card accepted — no PayPal account required</p>
          </div>
          <p style="color: #666; margin-top: 24px; font-size: 13px;">
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
