// Change orders (migration 111, v1.53.0).
//
//   ChangeOrdersCard  on an invoice in the app: write extra lines, text the
//                     customer a link, see each one's status.
//   ChangeOrderPage   the customer's /co/<token> page: approve by signing, or
//                     decline. They can also just text YES back.
//
// Approval is handled on the server (api/_lib/change-order.js): the lines are
// added to the invoice straight away, marked "Change order #N, approved <date>".
// An invoice screen that was open from before the approval would save its
// older copy over them, so this card also puts newly approved lines into the
// open form, and App.jsx's save retry merges marked lines it is missing.
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { supabase } from './supabase.js';
import { api } from './apiBase.js';

const NAVY = '#0a1628';
const ORANGE = '#E8622A';
const money = (n) => '$' + (Math.round(Number(n || 0) * 100) / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const fmtDate = (d) => { try { return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'Pacific/Honolulu' }); } catch { return ''; } };

// Same text as coLineMark() in api/_lib/change-order.js.
export const CO_MARK_RE = /^Change order #(\d+), approved /;
const coLineMark = (seq, when) => `Change order #${seq}, approved ${fmtDate(when)}`;

export function coTotals(items, taxPct) {
  let sub = 0, taxable = 0;
  for (const it of items || []) {
    const line = Number(it.qty ?? 1) * Number(it.price ?? 0);
    sub += line;
    if (it.taxable !== false) taxable += line;
  }
  const tax = Math.round(taxable * Number(taxPct || 0)) / 100;
  return { subtotal: Math.round(sub * 100) / 100, tax, total: Math.round((sub + tax) * 100) / 100 };
}

const lineKey = (it) => [it.name || '', it.desc || '', Number(it.qty ?? 1), Number(it.price ?? 0)].join('|');

// Invoice lines a change order added that `formItems` does not have yet.
export function mergeChangeOrderLines(formItems, serverItems) {
  const have = new Set((formItems || []).map(lineKey));
  const missing = (serverItems || []).filter(it => CO_MARK_RE.test(it.desc || '') && !have.has(lineKey(it)));
  return missing.length ? [...(formItems || []), ...missing] : formItems;
}

// The lines a change order put on the invoice, in the form's item shape.
function coInvoiceLines(co) {
  const mark = coLineMark(co.seq, co.applied_at || co.approved_at);
  return (co.items || []).map(it => ({
    name: String(it.name || 'Additional work').slice(0, 200),
    desc: it.desc ? `${mark} - ${it.desc}` : mark,
    qty: Number(it.qty ?? 1), price: Number(it.price ?? 0), unit: it.unit || 'ea',
    discount: 0, discountType: '%', taxable: it.taxable !== false,
  }));
}

function newToken() {
  const b = new Uint8Array(18);
  crypto.getRandomValues(b);
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const STATUS = {
  draft: { label: 'Draft', bg: '#eef1f7', fg: '#667' },
  sent: { label: 'Waiting on customer', bg: '#e8f1fb', fg: '#2471b5' },
  approved: { label: 'Approved', bg: '#e6f6ec', fg: '#1e8449' },
  declined: { label: 'Declined', bg: '#fdecea', fg: '#c0392b' },
};

const inputS = { width: '100%', boxSizing: 'border-box', padding: '9px 10px', border: '1.5px solid #dde2ee', borderRadius: 8, fontSize: 15, fontFamily: "'Barlow', sans-serif", background: '#fff' };
const btnS = (kind) => ({
  border: 'none', borderRadius: 8, padding: '11px 14px', fontSize: 14, fontWeight: 700, cursor: 'pointer',
  fontFamily: "'Barlow', sans-serif",
  ...(kind === 'primary' ? { background: ORANGE, color: '#fff' } : kind === 'navy' ? { background: NAVY, color: '#fff' } : kind === 'danger' ? { background: '#fff', color: '#c0392b', border: '1.5px solid #f1c4bf' } : { background: '#fff', color: NAVY, border: '1.5px solid #dde2ee' }),
});

// ─── In the app ─────────────────────────────────────────────────────────────

export function ChangeOrdersCard({ invoiceId, taxPct, clientPhone, loadedUpdatedAt, onApprovedLines }) {
  const [list, setList] = useState([]);
  const [editing, setEditing] = useState(null);
  const [err, setErr] = useState('');
  const pushedRef = useRef(new Set());

  const load = async () => {
    if (!invoiceId) return;
    const { data, error } = await supabase.from('change_orders').select('*').eq('invoice_id', invoiceId).order('seq');
    if (error) { setErr(/does not exist|relation/i.test(error.message) ? 'Change orders need database update 111.' : error.message); return; }
    setErr('');
    setList(data || []);
    // An approval that landed after this screen loaded the invoice: put its
    // lines into the open form, so leaving the screen does not save them away.
    const since = loadedUpdatedAt ? Date.parse(loadedUpdatedAt) : 0;
    const fresh = (data || []).filter(c => c.status === 'approved' && c.applied_at && Date.parse(c.applied_at) > since && !pushedRef.current.has(c.id));
    if (fresh.length) {
      fresh.forEach(c => pushedRef.current.add(c.id));
      onApprovedLines?.(fresh.flatMap(coInvoiceLines));
    }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [invoiceId]);
  useEffect(() => {
    const onVis = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', onVis);
    const t = setInterval(() => { if (list.some(c => c.status === 'sent')) load(); }, 30000);
    return () => { document.removeEventListener('visibilitychange', onVis); clearInterval(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoiceId, list]);

  if (!invoiceId) return null;
  const nextSeq = list.reduce((m, c) => Math.max(m, c.seq), 0) + 1;

  return (
    <div style={{ background: '#fff', borderRadius: 10, padding: '12px 14px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)', marginTop: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: '#6677aa', letterSpacing: 1, textTransform: 'uppercase', fontFamily: "'Barlow Condensed', sans-serif" }}>Change orders</span>
        <button onClick={() => setEditing({ seq: nextSeq, items: [{ name: '', desc: '', qty: 1, price: 0, taxable: true }], note: '', status: 'draft' })}
          style={{ ...btnS('ghost'), padding: '6px 12px', fontSize: 13 }}>+ Change order</button>
      </div>
      {err && <div style={{ fontSize: 12, color: '#c0392b', marginTop: 8 }}>{err}</div>}
      {!err && list.length === 0 && (
        <div style={{ fontSize: 12, color: '#999', marginTop: 8 }}>Extra work mid-job: text the customer a change order. When they approve (sign or reply YES) it is added to this invoice.</div>
      )}
      {list.map(c => {
        const st = STATUS[c.status] || STATUS.draft;
        const t = coTotals(c.items, taxPct);
        return (
          <div key={c.id} onClick={() => setEditing(c)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderTop: '1px solid #eef1f7', marginTop: 8, cursor: 'pointer' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#1a1a1a' }}>{invoiceId}-CO{c.seq} · {money(t.total)}</div>
              <div style={{ fontSize: 12, color: '#888', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {(c.items || []).map(i => i.name).filter(Boolean).join(', ') || 'No lines yet'}
                {c.status === 'approved' && c.approved_at ? ` · ${c.approved_via === 'sms' ? 'texted YES' : 'signed'} ${fmtDate(c.approved_at)}` : ''}
                {c.status === 'sent' && c.sent_at ? ` · sent ${fmtDate(c.sent_at)}` : ''}
              </div>
            </div>
            <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 10, background: st.bg, color: st.fg, whiteSpace: 'nowrap' }}>{st.label}</span>
          </div>
        );
      })}
      {editing && createPortal(
        <ChangeOrderEditor
          co={editing} invoiceId={invoiceId} taxPct={taxPct} clientPhone={clientPhone}
          onClose={() => { setEditing(null); load(); }}
        />, document.body)}
    </div>
  );
}

function ChangeOrderEditor({ co, invoiceId, taxPct, clientPhone, onClose }) {
  const locked = co.status === 'approved' || co.status === 'declined';
  const [items, setItems] = useState(co.items?.length ? co.items : [{ name: '', desc: '', qty: 1, price: 0, taxable: true }]);
  const [note, setNote] = useState(co.note || '');
  const [phone, setPhone] = useState(co.sent_to || clientPhone || '');
  const [row, setRow] = useState(co.id ? co : null);
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');
  const t = coTotals(items, taxPct);
  const clean = items.map(i => ({ name: String(i.name || '').trim(), desc: String(i.desc || '').trim(), qty: Number(i.qty) || 1, price: Number(i.price) || 0, taxable: i.taxable !== false }))
    .filter(i => i.name || i.price);
  const link = row ? `${window.location.origin}/co/${row.view_token}` : '';

  const save = async () => {
    if (!clean.length) throw new Error('Add at least one line.');
    if (row) {
      const { data, error } = await supabase.from('change_orders').update({ items: clean, note: note.trim() || null, updated_at: new Date().toISOString() })
        .eq('id', row.id).in('status', ['draft', 'sent']).select().maybeSingle();
      if (error) throw error;
      if (!data) throw new Error('This change order was already answered by the customer.');
      setRow(data); return data;
    }
    for (let attempt = 0; attempt < 3; attempt++) {
      const { data: last } = await supabase.from('change_orders').select('seq').eq('invoice_id', invoiceId).order('seq', { ascending: false }).limit(1);
      const seq = (last?.[0]?.seq || 0) + 1;
      const { data, error } = await supabase.from('change_orders')
        .insert({ invoice_id: invoiceId, seq, items: clean, note: note.trim() || null, status: 'draft', view_token: newToken() })
        .select().single();
      if (!error) { setRow(data); return data; }
      if (!/duplicate|unique/i.test(error.message)) throw error;
    }
    throw new Error('Could not number the change order. Try again.');
  };

  const run = (label, fn) => async () => {
    setBusy(label); setMsg('');
    try { await fn(); } catch (e) { setMsg(e.message || String(e)); } finally { setBusy(''); }
  };

  const send = run('send', async () => {
    const saved = await save();
    if (!String(phone).replace(/\D/g, '').match(/\d{10}$/)) throw new Error('Enter the customer’s mobile number.');
    const { data: s } = await supabase.auth.getSession();
    const r = await fetch(api('/api/sms-inbound'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${s?.session?.access_token || ''}` },
      body: JSON.stringify({ op: 'send_change_order', change_order_id: saved.id, to: phone }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.ok) throw new Error(j.error || `Send failed (${r.status})`);
    setMsg(`Sent to ${phone}. When they sign or reply YES, it is added to the invoice.`);
    setRow(x => ({ ...(x || saved), status: 'sent', sent_to: phone }));
  });

  const remove = run('delete', async () => {
    if (!row) return onClose();
    if (!window.confirm(`Delete ${invoiceId}-CO${row.seq}? ${row.status === 'sent' ? 'Its link will stop working.' : ''}`)) return;
    const { error } = await supabase.from('change_orders').delete().eq('id', row.id).in('status', ['draft', 'sent']);
    if (error) throw error;
    onClose();
  });

  const setItem = (i, patch) => setItems(xs => xs.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 3000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', overflowY: 'auto' }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#f4f6fa', width: '100%', maxWidth: 520, minHeight: '100%', padding: '0 0 24px', fontFamily: "'Barlow', sans-serif" }}>
        <div style={{ background: NAVY, color: '#fff', padding: '14px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'sticky', top: 0, zIndex: 1 }}>
          <div>
            <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 18 }}>{invoiceId}-CO{row?.seq || co.seq}</div>
            <div style={{ fontSize: 12, color: ORANGE }}>{(STATUS[row?.status || co.status] || STATUS.draft).label} · {money(t.total)}</div>
          </div>
          <button onClick={onClose} aria-label="Close" style={{ background: 'none', border: 'none', color: '#8899bb', fontSize: 26, cursor: 'pointer' }}>×</button>
        </div>
        <div style={{ padding: 16 }}>
          {locked && (
            <div style={{ background: '#fff', borderRadius: 10, padding: 12, fontSize: 13, color: '#555', marginBottom: 12 }}>
              {co.status === 'approved'
                ? `Approved ${fmtDate(co.approved_at)} ${co.approved_via === 'sms' ? `by text ("${co.approval_message || 'YES'}")` : `by signature${co.approved_name ? ` (${co.approved_name})` : ''}`}. ${co.applied_at ? 'Its lines are on the invoice.' : 'Adding it to the invoice failed: add the lines by hand.'}`
                : `Declined by the customer ${fmtDate(co.declined_at)}. Nothing was added to the invoice.`}
              {co.signature_data && <img src={co.signature_data} alt="Signature" style={{ display: 'block', maxWidth: '100%', height: 70, marginTop: 8, objectFit: 'contain' }} />}
            </div>
          )}
          {items.map((it, i) => (
            <div key={i} style={{ background: '#fff', borderRadius: 10, padding: 12, marginBottom: 10 }}>
              <input disabled={locked} value={it.name || ''} onChange={e => setItem(i, { name: e.target.value })} placeholder="Work to add (e.g. Replace shutoff valve)" style={{ ...inputS, fontWeight: 600 }} />
              <input disabled={locked} value={it.desc || ''} onChange={e => setItem(i, { desc: e.target.value })} placeholder="Details (optional)" style={{ ...inputS, marginTop: 8 }} />
              <div style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center' }}>
                <label style={{ fontSize: 12, color: '#777', flex: '0 0 auto' }}>Qty</label>
                <input disabled={locked} type="number" inputMode="decimal" value={it.qty ?? 1} onChange={e => setItem(i, { qty: e.target.value })} style={{ ...inputS, width: 70 }} />
                <label style={{ fontSize: 12, color: '#777', flex: '0 0 auto' }}>Price</label>
                <input disabled={locked} type="number" inputMode="decimal" value={it.price ?? 0} onChange={e => setItem(i, { price: e.target.value })} style={{ ...inputS, flex: 1 }} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
                <label style={{ fontSize: 13, color: '#555', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <input disabled={locked} type="checkbox" checked={it.taxable !== false} onChange={e => setItem(i, { taxable: e.target.checked })} /> Taxable
                </label>
                {!locked && items.length > 1 && <button onClick={() => setItems(xs => xs.filter((_, j) => j !== i))} style={{ background: 'none', border: 'none', color: '#c0392b', fontSize: 13, cursor: 'pointer' }}>Remove</button>}
              </div>
            </div>
          ))}
          {!locked && <button onClick={() => setItems(xs => [...xs, { name: '', desc: '', qty: 1, price: 0, taxable: true }])} style={{ ...btnS('ghost'), width: '100%' }}>+ Add line</button>}
          <textarea disabled={locked} value={note} onChange={e => setNote(e.target.value)} placeholder="Note to the customer (optional)" rows={2} style={{ ...inputS, marginTop: 10, resize: 'vertical' }} />
          <div style={{ background: '#fff', borderRadius: 10, padding: 12, marginTop: 10, fontSize: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Subtotal</span><span>{money(t.subtotal)}</span></div>
            <div style={{ display: 'flex', justifyContent: 'space-between', color: '#777' }}><span>Tax ({Number(taxPct || 0)}%)</span><span>{money(t.tax)}</span></div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, marginTop: 4 }}><span>Change order total</span><span>{money(t.total)}</span></div>
          </div>
          {!locked && (
            <>
              <label style={{ display: 'block', fontSize: 12, color: '#777', margin: '14px 0 4px' }}>Customer's mobile</label>
              <input value={phone} onChange={e => setPhone(e.target.value)} inputMode="tel" placeholder="(808) 555-1234" style={inputS} />
              <button onClick={send} disabled={!!busy} style={{ ...btnS('primary'), width: '100%', marginTop: 10, opacity: busy ? 0.6 : 1 }}>
                {busy === 'send' ? 'Sending…' : (row?.status === 'sent' ? 'Save and resend text' : 'Send to customer by text')}
              </button>
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <button onClick={run('save', async () => { await save(); setMsg('Saved.'); })} disabled={!!busy} style={{ ...btnS('ghost'), flex: 1 }}>{busy === 'save' ? 'Saving…' : 'Save draft'}</button>
                {row && <button onClick={run('copy', async () => { await save(); await navigator.clipboard.writeText(link); setMsg('Link copied. Anyone with it can approve, so send it only to the customer.'); })} disabled={!!busy} style={{ ...btnS('ghost'), flex: 1 }}>Copy link</button>}
              </div>
              {row && <button onClick={remove} disabled={!!busy} style={{ ...btnS('danger'), width: '100%', marginTop: 8 }}>Delete change order</button>}
            </>
          )}
          {msg && <div style={{ fontSize: 13, color: /fail|error|enter|add at least|already|could not/i.test(msg) ? '#c0392b' : '#1e8449', marginTop: 10 }}>{msg}</div>}
        </div>
      </div>
    </div>
  );
}

// ─── The customer's page: /co/<token> ───────────────────────────────────────

export function ChangeOrderPage({ token }) {
  const [state, setState] = useState({ loading: true });
  const [name, setName] = useState('');
  const [signed, setSigned] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const canvasRef = useRef(null);
  const drawingRef = useRef(false);

  const load = async () => {
    try {
      const r = await fetch(api('/api/public-invoice') + '?co=' + encodeURIComponent(token));
      if (!r.ok) return setState({ loading: false, missing: true });
      setState({ loading: false, ...(await r.json()) });
    } catch { setState({ loading: false, missing: true }); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [token]);

  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    ctx.strokeStyle = NAVY; ctx.lineWidth = 2.5; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  }, [state.changeOrder?.status]);

  const pos = (e) => {
    const c = canvasRef.current, r = c.getBoundingClientRect(), s = e.touches?.[0] || e;
    return { x: (s.clientX - r.left) * (c.width / r.width), y: (s.clientY - r.top) * (c.height / r.height) };
  };
  const start = (e) => { e.preventDefault(); const ctx = canvasRef.current.getContext('2d'); const p = pos(e); ctx.beginPath(); ctx.moveTo(p.x, p.y); drawingRef.current = true; setSigned(true); };
  const move = (e) => { if (!drawingRef.current) return; e.preventDefault(); const ctx = canvasRef.current.getContext('2d'); const p = pos(e); ctx.lineTo(p.x, p.y); ctx.stroke(); };
  const end = () => { drawingRef.current = false; };
  const clear = () => { const c = canvasRef.current, ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); setSigned(false); };

  const submit = async (decline) => {
    setBusy(true); setError('');
    try {
      const body = decline ? { coToken: token, decline: true } : { coToken: token, name: name.trim(), signatureData: canvasRef.current.toDataURL('image/png') };
      const r = await fetch(api('/api/submit-signature'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) throw new Error(j.error === 'declined' ? 'This change order was declined.' : j.error === 'not_open' || j.error === 'not_sent' ? 'This change order is no longer open.' : (j.error || 'Something went wrong. Please try again.'));
      await load();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  const page = (children) => (
    <div style={{ minHeight: '100vh', background: '#f4f6fa', fontFamily: "'Barlow', sans-serif", color: '#1a1a1a' }}>
      <div style={{ background: NAVY, padding: '16px 20px' }}>
        <div style={{ color: ORANGE, fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 20, letterSpacing: 1.5 }}>HI GRADE PLUMBING</div>
      </div>
      <div style={{ maxWidth: 560, margin: '0 auto', padding: 16 }}>{children}</div>
    </div>
  );

  if (state.loading) return page(<div style={{ color: '#888', padding: 20 }}>Loading…</div>);
  if (state.missing || !state.changeOrder) return page(<div style={{ background: '#fff', borderRadius: 10, padding: 20 }}>This change order link is not valid any more. Please contact HI Grade Plumbing.</div>);

  const co = state.changeOrder, job = state.job || {};
  const t = co.totals || coTotals(co.items, job.tax);
  const site = job.job_address && typeof job.job_address === 'object' ? [job.job_address.line1, job.job_address.city].filter(Boolean).join(', ') : '';
  return page(
    <>
      <div style={{ background: '#fff', borderRadius: 10, padding: 16, marginBottom: 12 }}>
        <div style={{ fontSize: 20, fontWeight: 700, fontFamily: "'Barlow Condensed', sans-serif" }}>Change order {co.seq}</div>
        <div style={{ fontSize: 13, color: '#777', marginTop: 2 }}>{co.label}{job.client_name ? ` · ${job.client_name}` : ''}{site ? ` · ${site}` : ''}</div>
        <div style={{ fontSize: 13, color: '#555', marginTop: 8 }}>Additional work for your job. Approving adds it to your invoice; nothing is due until you are invoiced.</div>
      </div>
      <div style={{ background: '#fff', borderRadius: 10, padding: 16, marginBottom: 12 }}>
        {(co.items || []).map((it, i) => (
          <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '8px 0', borderTop: i ? '1px solid #eef1f7' : 'none' }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 600 }}>{it.name}</div>
              {it.desc && <div style={{ fontSize: 13, color: '#777' }}>{it.desc}</div>}
              {Number(it.qty ?? 1) !== 1 && <div style={{ fontSize: 12, color: '#999' }}>{it.qty} x {money(it.price)}</div>}
            </div>
            <div style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{money(Number(it.qty ?? 1) * Number(it.price ?? 0))}</div>
          </div>
        ))}
        <div style={{ borderTop: '2px solid #eef1f7', marginTop: 8, paddingTop: 8, fontSize: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Subtotal</span><span>{money(t.subtotal)}</span></div>
          {t.tax > 0 && <div style={{ display: 'flex', justifyContent: 'space-between', color: '#777' }}><span>Tax</span><span>{money(t.tax)}</span></div>}
          <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, fontSize: 17, marginTop: 4 }}><span>Total</span><span>{money(t.total)}</span></div>
        </div>
        {co.note && <div style={{ fontSize: 13, color: '#555', marginTop: 10, whiteSpace: 'pre-wrap' }}>{co.note}</div>}
      </div>

      {co.status === 'approved' && (
        <div style={{ background: '#e6f6ec', color: '#1e8449', borderRadius: 10, padding: 16, fontWeight: 600 }}>
          Approved {fmtDate(co.approved_at)}{co.approved_name ? ` by ${co.approved_name}` : ''}. Thank you! It has been added to your invoice.
        </div>
      )}
      {co.status === 'declined' && (
        <div style={{ background: '#fdecea', color: '#c0392b', borderRadius: 10, padding: 16, fontWeight: 600 }}>
          Declined {fmtDate(co.declined_at)}. Nothing was added to your invoice.
        </div>
      )}
      {co.status === 'sent' && (
        <div style={{ background: '#fff', borderRadius: 10, padding: 16 }}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>Approve this change order</div>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="Your full name" autoComplete="name" style={inputS} />
          <div style={{ fontSize: 12, color: '#888', margin: '10px 0 4px' }}>Sign below</div>
          <canvas ref={canvasRef} width={600} height={200}
            style={{ width: '100%', height: 150, border: '2px solid #dde2ee', borderRadius: 10, touchAction: 'none', background: '#fff' }}
            onMouseDown={start} onMouseMove={move} onMouseUp={end} onMouseLeave={end}
            onTouchStart={start} onTouchMove={move} onTouchEnd={end} />
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <button onClick={clear} style={{ ...btnS('ghost'), flex: 1 }}>Clear</button>
            <button onClick={() => submit(false)} disabled={busy || !signed || !name.trim()}
              style={{ ...btnS('primary'), flex: 2, opacity: busy || !signed || !name.trim() ? 0.5 : 1 }}>{busy ? 'Saving…' : 'Approve & Sign'}</button>
          </div>
          <div style={{ fontSize: 12, color: '#888', marginTop: 10 }}>You can also approve by replying YES to our text.</div>
          <button onClick={() => { if (window.confirm('Decline this change order? Nothing will be added to your invoice.')) submit(true); }} disabled={busy}
            style={{ background: 'none', border: 'none', color: '#c0392b', fontSize: 13, marginTop: 10, cursor: 'pointer', padding: 0 }}>Decline</button>
          {error && <div style={{ color: '#c0392b', fontSize: 13, marginTop: 8 }}>{error}</div>}
        </div>
      )}
    </>
  );
}
