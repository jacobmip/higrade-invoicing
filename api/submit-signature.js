export const config = { runtime: 'edge' };

export default async function handler(req) {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  try {
    const { estimateId, clientName, total, job, signatureData, signedAt } = await req.json();

    const resendKey = process.env.RESEND_API_KEY;
    if (!resendKey) return new Response(JSON.stringify({ error: 'Email not configured' }), {
      status: 500, headers: { 'Content-Type': 'application/json' }
    });

    const signedTime = signedAt ? new Date(signedAt).toLocaleString('en-US', { timeZone: 'Pacific/Honolulu' }) + ' HST' : 'Unknown';

    const body = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: #0a1628; padding: 24px; text-align: center;">
          <h1 style="color: #E8622A; margin: 0; font-size: 22px; letter-spacing: 2px;">ESTIMATE APPROVED</h1>
          <p style="color: #8899bb; margin: 4px 0 0; font-size: 12px;">HI Grade Plumbing LLC</p>
        </div>
        <div style="padding: 32px; background: #f4f6fa;">
          <p style="color: #444; font-size: 16px;"><strong>${clientName}</strong> has signed and approved estimate <strong>${estimateId}</strong>.</p>
          <table style="width: 100%; border-collapse: collapse; margin: 16px 0; background: #fff; border-radius: 8px; overflow: hidden;">
            <tr style="border-bottom: 1px solid #eee;"><td style="padding: 10px 14px; color: #666;">Estimate</td><td style="padding: 10px 14px; font-weight: bold;">${estimateId}</td></tr>
            <tr style="border-bottom: 1px solid #eee;"><td style="padding: 10px 14px; color: #666;">Client</td><td style="padding: 10px 14px; font-weight: bold;">${clientName}</td></tr>
            <tr style="border-bottom: 1px solid #eee;"><td style="padding: 10px 14px; color: #666;">Total</td><td style="padding: 10px 14px; font-weight: bold; color: #E8622A;">$${total}</td></tr>
            <tr style="border-bottom: 1px solid #eee;"><td style="padding: 10px 14px; color: #666;">Job</td><td style="padding: 10px 14px;">${job || '—'}</td></tr>
            <tr><td style="padding: 10px 14px; color: #666;">Signed</td><td style="padding: 10px 14px;">${signedTime}</td></tr>
          </table>
          ${signatureData ? `<div style="margin-top: 16px; background: #fff; padding: 16px; border-radius: 8px; border: 1px solid #eee;"><p style="color: #666; font-size: 13px; margin: 0 0 10px; font-weight: bold;">Client Signature:</p><img src="${signatureData}" style="max-width: 280px; border: 1px solid #dde; border-radius: 4px; background: #fff; padding: 8px; display: block;" /></div>` : ''}
          <div style="margin-top: 20px; padding: 14px; background: #e8f5e9; border-radius: 8px; border-left: 4px solid #27ae60;">
            <p style="color: #2e7d32; margin: 0; font-size: 14px;">Open your HI Grade app and mark <strong>${estimateId}</strong> as approved to complete the workflow.</p>
          </div>
        </div>
        <div style="background: #0a1628; padding: 16px; text-align: center;">
          <p style="color: #8899bb; font-size: 11px; margin: 0;">HI Grade Plumbing LLC · Honolulu, HI · (808) 393-0015</p>
        </div>
      </div>
    `;

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${resendKey}` },
      body: JSON.stringify({
        from: 'HI Grade Plumbing <invoices@higradeplumbing.com>',
        to: ['jacobmip@gmail.com'],
        subject: `✅ ${estimateId} Signed — ${clientName}`,
        html: body,
      }),
    });

    const data = await res.json();
    return new Response(JSON.stringify({ ok: true, ...data }), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { 'Content-Type': 'application/json' }
    });
  }
}
