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
import { fetchInvoicePhotos, isVideo } from './JobPhotos.jsx';

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

const cleanItems = (items) => (items || [])
  .map(i => ({ name: String(i.name || '').trim(), desc: String(i.desc || '').trim(), qty: Number(i.qty) || 1, price: Number(i.price) || 0, taxable: i.taxable !== false }))
  .filter(i => i.name || i.price);

// ─── Photos ─────────────────────────────────────────────────────────────────
// A change order's photos are [{ url, job_photo_id }]. New ones are uploaded
// to the job-photos bucket and also filed as a job_photos row on the invoice,
// so they show in the job's Photos tab too. Picking an existing job photo just
// references it. Removing one from a change order never deletes the photo.
const PHOTO_BUCKET = 'job-photos';
const MAX_CO_PHOTOS = 12;

function resizeToJpegBlob(src, maxDim = 1600, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onerror = () => reject(new Error('Could not read that image.'));
    img.onload = () => {
      let { width, height } = img;
      if (width > maxDim || height > maxDim) {
        const k = maxDim / Math.max(width, height);
        width = Math.round(width * k); height = Math.round(height * k);
      }
      const c = document.createElement('canvas');
      c.width = width; c.height = height;
      c.getContext('2d').drawImage(img, 0, 0, width, height);
      c.toBlob(b => (b ? resolve(b) : reject(new Error('Could not process that image.'))), 'image/jpeg', quality);
    };
    if (typeof src === 'string') img.src = src;
    else { const r = new FileReader(); r.onerror = reject; r.onload = () => { img.src = r.result; }; r.readAsDataURL(src); }
  });
}

// file: a File from an input, or a data: URL (the AI chat's photos).
export async function uploadChangeOrderPhoto(invoiceId, file, seq) {
  const blob = await resizeToJpegBlob(file);
  const path = `${invoiceId}/co${seq || ''}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}.jpg`;
  const { error: upErr } = await supabase.storage.from(PHOTO_BUCKET).upload(path, blob, { upsert: false, contentType: 'image/jpeg' });
  if (upErr) throw new Error('Photo upload failed: ' + upErr.message);
  const { data: { publicUrl } } = supabase.storage.from(PHOTO_BUCKET).getPublicUrl(path);
  const { data: row, error } = await supabase.from('job_photos')
    .insert({ invoice_id: invoiceId, url: publicUrl, caption: seq ? `Change order ${seq}` : 'Change order', type: 'other' })
    .select('id').maybeSingle();
  if (error) console.warn('[change order] job photo row not saved:', error.message);
  return { url: publicUrl, job_photo_id: row?.id || null };
}

const cleanPhotos = (photos) => {
  const seen = new Set();
  return (photos || []).filter(p => p && p.url && !seen.has(p.url) && seen.add(p.url))
    .slice(0, MAX_CO_PHOTOS).map(p => ({ url: p.url, job_photo_id: p.job_photo_id || p.id || null }));
};

// Tell any open ChangeOrdersCard for this invoice to reload (the AI chat
// creates and sends change orders without going through the card).
export const announceChangeOrders = (invoiceId) => {
  try { window.dispatchEvent(new CustomEvent('higrade:change-orders', { detail: { invoiceId } })); } catch { /* old browsers */ }
};

const tableMsg = (m) => (/does not exist|relation|schema cache/i.test(m || '') ? 'Change orders need database update 111.' : m);

export async function listChangeOrders(invoiceId) {
  const { data, error } = await supabase.from('change_orders').select('*').eq('invoice_id', invoiceId).order('seq');
  if (error) throw new Error(tableMsg(error.message));
  return data || [];
}

// Create (no row) or edit (row) a change order. Only draft or sent ones can
// change; once the customer answers it is final.
export async function saveChangeOrder({ row, invoiceId, items, note, photos }) {
  const clean = cleanItems(items);
  const pics = photos === undefined ? undefined : cleanPhotos(photos);
  if (!clean.length) throw new Error('Add at least one line.');
  if (row) {
    const { data, error } = await supabase.from('change_orders').update({ items: clean, note: (note || '').trim() || null, ...(pics !== undefined ? { photos: pics } : {}), updated_at: new Date().toISOString() })
      .eq('id', row.id).in('status', ['draft', 'sent']).select().maybeSingle();
    if (error) throw new Error(tableMsg(error.message));
    if (!data) throw new Error('This change order was already answered by the customer.');
    announceChangeOrders(invoiceId);
    return data;
  }
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data: last, error: e0 } = await supabase.from('change_orders').select('seq').eq('invoice_id', invoiceId).order('seq', { ascending: false }).limit(1);
    if (e0) throw new Error(tableMsg(e0.message));
    const seq = (last?.[0]?.seq || 0) + 1;
    const { data, error } = await supabase.from('change_orders')
      .insert({ invoice_id: invoiceId, seq, items: clean, note: (note || '').trim() || null, photos: pics || [], status: 'draft', view_token: newToken() })
      .select().single();
    if (!error) { announceChangeOrders(invoiceId); return data; }
    if (!/duplicate|unique/i.test(error.message)) throw new Error(tableMsg(error.message));
  }
  throw new Error('Could not number the change order. Try again.');
}

// Email and/or text it (server: api/_lib/change-order.js sendChangeOrder).
// Returns the server's answer: { ok, sent: { email?, text? }, errors }.
export async function sendChangeOrderTo({ id, invoiceId, phone, email }) {
  const { data: s } = await supabase.auth.getSession();
  const r = await fetch(api('/api/sms-inbound'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${s?.session?.access_token || ''}` },
    body: JSON.stringify({ op: 'send_change_order', change_order_id: id, ...(phone ? { to: phone } : {}), ...(email ? { email } : {}) }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.ok) throw new Error(j.error || `Send failed (${r.status})`);
  announceChangeOrders(invoiceId);
  return j;
}

export const sentSummary = (j) => {
  const parts = [];
  if (j?.sent?.email) parts.push(`emailed to ${j.sent.email}`);
  if (j?.sent?.text) parts.push(`texted to ${j.sent.text}`);
  const fail = (j?.errors || []).length ? ` (not sent: ${j.errors.join('; ')})` : '';
  return (parts.join(' and ') || 'not sent') + fail;
};

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

export function ChangeOrdersCard({ invoiceId, linkedIds, taxPct, clientPhone, clientEmail, loadedUpdatedAt, onApprovedLines }) {
  const [list, setList] = useState([]);
  const [editing, setEditing] = useState(null);
  const [err, setErr] = useState('');
  const pushedRef = useRef(new Set());

  const load = async () => {
    if (!invoiceId) return;
    let data;
    try { data = await listChangeOrders(invoiceId); } catch (e) { setErr(e.message); return; }
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
    const on = (e) => { if (!e.detail?.invoiceId || e.detail.invoiceId === invoiceId) load(); };
    window.addEventListener('higrade:change-orders', on);
    return () => window.removeEventListener('higrade:change-orders', on);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoiceId]);
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
        <div style={{ fontSize: 12, color: '#999', marginTop: 8 }}>Extra work mid-job: email or text the customer a change order. When they approve (sign, or reply YES to the text) it is added to this invoice.</div>
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
                {(c.photos || []).length ? ` · ${c.photos.length} photo${c.photos.length === 1 ? '' : 's'}` : ''}
                {c.status === 'approved' && c.approved_at ? ` · ${c.approved_via === 'sms' ? 'texted YES' : 'signed'} ${fmtDate(c.approved_at)}` : ''}
                {c.status === 'sent' && c.sent_at ? ` · ${[c.sent_email && 'emailed', c.sent_to && 'texted'].filter(Boolean).join(' + ') || 'sent'} ${fmtDate(c.sent_at)}` : ''}
              </div>
            </div>
            <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 10, background: st.bg, color: st.fg, whiteSpace: 'nowrap' }}>{st.label}</span>
          </div>
        );
      })}
      {editing && createPortal(
        <ChangeOrderEditor
          co={editing} invoiceId={invoiceId} linkedIds={linkedIds} taxPct={taxPct} clientPhone={clientPhone} clientEmail={clientEmail}
          onClose={() => { setEditing(null); load(); }}
        />, document.body)}
    </div>
  );
}

function ChangeOrderEditor({ co, invoiceId, linkedIds, taxPct, clientPhone, clientEmail, onClose }) {
  const locked = co.status === 'approved' || co.status === 'declined';
  const [items, setItems] = useState(co.items?.length ? co.items : [{ name: '', desc: '', qty: 1, price: 0, taxable: true }]);
  const [note, setNote] = useState(co.note || '');
  const [photos, setPhotos] = useState(co.photos || []);
  const [picking, setPicking] = useState(false);
  const fileRef = useRef(null);
  const [phone, setPhone] = useState(co.sent_to || clientPhone || '');
  const [email, setEmail] = useState(co.sent_email || clientEmail || '');
  const [viaEmail, setViaEmail] = useState(!!(co.sent_email || clientEmail));
  const [viaText, setViaText] = useState(co.sent_to ? true : !(co.sent_email || clientEmail) && !!clientPhone);
  const [row, setRow] = useState(co.id ? co : null);
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');
  const t = coTotals(items, taxPct);
  const link = row ? `${window.location.origin}/co/${row.view_token}` : '';

  const save = async () => {
    const data = await saveChangeOrder({ row, invoiceId, items, note, photos });
    setRow(data); return data;
  };

  const run = (label, fn) => async () => {
    setBusy(label); setMsg('');
    try { await fn(); } catch (e) { setMsg(e.message || String(e)); } finally { setBusy(''); }
  };

  const send = run('send', async () => {
    if (!viaEmail && !viaText) throw new Error('Pick email, text or both.');
    if (viaText && !String(phone).replace(/\D/g, '').match(/\d{10}$/)) throw new Error('Enter the customer’s mobile number.');
    if (viaEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) throw new Error('Enter the customer’s email address.');
    const saved = await save();
    const j = await sendChangeOrderTo({ id: saved.id, invoiceId, phone: viaText ? phone : null, email: viaEmail ? email.trim() : null });
    setMsg(`Sent: ${sentSummary(j)}. When they approve, it is added to the invoice.`);
    setRow(x => ({ ...(x || saved), status: 'sent', ...(j.sent?.text ? { sent_to: j.sent.text } : {}), ...(j.sent?.email ? { sent_email: j.sent.email } : {}) }));
  });

  const remove = run('delete', async () => {
    if (!row) return onClose();
    if (!window.confirm(`Delete ${invoiceId}-CO${row.seq}? ${row.status === 'sent' ? 'Its link will stop working.' : ''}`)) return;
    const { error } = await supabase.from('change_orders').delete().eq('id', row.id).in('status', ['draft', 'sent']);
    if (error) throw error;
    onClose();
  });

  const addFiles = run('photos', async () => {
    const files = Array.from(fileRef.current?.files || []).filter(f => /^image\//.test(f.type));
    if (fileRef.current) fileRef.current.value = '';
    if (!files.length) return;
    const room = MAX_CO_PHOTOS - photos.length;
    if (room <= 0) throw new Error(`Up to ${MAX_CO_PHOTOS} photos per change order.`);
    const added = [];
    for (const f of files.slice(0, room)) added.push(await uploadChangeOrderPhoto(invoiceId, f, row?.seq || co.seq));
    setPhotos(ps => [...ps, ...added]);
    setMsg(`${added.length} photo${added.length === 1 ? '' : 's'} added. They are also in the job's Photos tab.`);
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
          <div style={{ background: '#fff', borderRadius: 10, padding: 12, marginTop: 10 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#6677aa', letterSpacing: 1, textTransform: 'uppercase', fontFamily: "'Barlow Condensed', sans-serif" }}>Photos{photos.length ? ` (${photos.length})` : ''}</div>
            {photos.length > 0 && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6, marginTop: 8 }}>
                {photos.map(ph => (
                  <div key={ph.url} style={{ position: 'relative', aspectRatio: '1', borderRadius: 6, overflow: 'hidden', background: '#e4e8f0' }}>
                    <img src={ph.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                    {!locked && <button onClick={() => setPhotos(ps => ps.filter(x => x.url !== ph.url))} aria-label="Remove photo from change order"
                      style={{ position: 'absolute', top: 3, right: 3, width: 22, height: 22, borderRadius: '50%', border: 'none', background: 'rgba(0,0,0,0.55)', color: '#fff', fontSize: 14, lineHeight: '22px', padding: 0, cursor: 'pointer' }}>×</button>}
                  </div>
                ))}
              </div>
            )}
            {!locked && (
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <input ref={fileRef} type="file" accept="image/*" multiple onChange={addFiles} style={{ display: 'none' }} />
                <button onClick={() => fileRef.current?.click()} disabled={!!busy} style={{ ...btnS('ghost'), flex: 1, padding: '9px 8px', fontSize: 13 }}>{busy === 'photos' ? 'Uploading…' : 'Add photos'}</button>
                <button onClick={() => setPicking(true)} disabled={!!busy} style={{ ...btnS('ghost'), flex: 1, padding: '9px 8px', fontSize: 13 }}>From job photos</button>
              </div>
            )}
            {locked && photos.length === 0 && <div style={{ fontSize: 12, color: '#999', marginTop: 6 }}>No photos.</div>}
          </div>
          {picking && (
            <JobPhotoPicker ids={[invoiceId, ...(linkedIds || [])]} chosen={photos} onClose={() => setPicking(false)}
              onDone={(picked) => { setPhotos(ps => cleanPhotos([...ps, ...picked])); setPicking(false); }} />
          )}
          <textarea disabled={locked} value={note} onChange={e => setNote(e.target.value)} placeholder="Note to the customer (optional)" rows={2} style={{ ...inputS, marginTop: 10, resize: 'vertical' }} />
          <div style={{ background: '#fff', borderRadius: 10, padding: 12, marginTop: 10, fontSize: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Subtotal</span><span>{money(t.subtotal)}</span></div>
            <div style={{ display: 'flex', justifyContent: 'space-between', color: '#777' }}><span>Tax ({Number(taxPct || 0)}%)</span><span>{money(t.tax)}</span></div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, marginTop: 4 }}><span>Change order total</span><span>{money(t.total)}</span></div>
          </div>
          {!locked && (
            <>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, color: '#333', margin: '14px 0 4px' }}>
                <input type="checkbox" checked={viaEmail} onChange={e => setViaEmail(e.target.checked)} /> Email
              </label>
              <input value={email} onChange={e => setEmail(e.target.value)} inputMode="email" autoCapitalize="none" placeholder="customer@email.com" style={{ ...inputS, opacity: viaEmail ? 1 : 0.5 }} />
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, color: '#333', margin: '12px 0 4px' }}>
                <input type="checkbox" checked={viaText} onChange={e => setViaText(e.target.checked)} /> Text (they can reply YES)
              </label>
              <input value={phone} onChange={e => setPhone(e.target.value)} inputMode="tel" placeholder="(808) 555-1234" style={{ ...inputS, opacity: viaText ? 1 : 0.5 }} />
              <button onClick={send} disabled={!!busy} style={{ ...btnS('primary'), width: '100%', marginTop: 12, opacity: busy ? 0.6 : 1 }}>
                {busy === 'send' ? 'Sending…' : `${row?.status === 'sent' ? 'Save and resend' : 'Send to customer'}${viaEmail && viaText ? ' (email + text)' : viaEmail ? ' by email' : viaText ? ' by text' : ''}`}
              </button>
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <button onClick={run('save', async () => { await save(); setMsg('Saved.'); })} disabled={!!busy} style={{ ...btnS('ghost'), flex: 1 }}>{busy === 'save' ? 'Saving…' : 'Save draft'}</button>
                {row && <button onClick={run('copy', async () => { await save(); await navigator.clipboard.writeText(link); setMsg('Link copied. Anyone with it can approve, so send it only to the customer.'); })} disabled={!!busy} style={{ ...btnS('ghost'), flex: 1 }}>Copy link</button>}
              </div>
              {row && <button onClick={remove} disabled={!!busy} style={{ ...btnS('danger'), width: '100%', marginTop: 8 }}>Delete change order</button>}
            </>
          )}
          {msg && <div style={{ fontSize: 13, color: /fail|error|enter|add at least|already|could not|pick |not sent/i.test(msg) ? '#c0392b' : '#1e8449', marginTop: 10 }}>{msg}</div>}
        </div>
      </div>
    </div>
  );
}

// Pick photos already on the job (this invoice and its estimate).
function JobPhotoPicker({ ids, chosen, onClose, onDone }) {
  const [all, setAll] = useState(null);
  const [sel, setSel] = useState(() => new Set());
  const have = new Set((chosen || []).map(p => p.url));
  useEffect(() => {
    fetchInvoicePhotos(ids).then(ps => setAll((ps || []).filter(p => !isVideo(p)))).catch(() => setAll([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids.join(',')]);
  const toggle = (id) => setSel(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 3100, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#fff', width: '100%', maxWidth: 520, maxHeight: '80vh', borderRadius: '14px 14px 0 0', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '14px 16px', fontWeight: 700, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>Job photos</span>
          <button onClick={onClose} aria-label="Close" style={{ background: 'none', border: 'none', fontSize: 24, color: '#888', cursor: 'pointer' }}>×</button>
        </div>
        <div style={{ overflowY: 'auto', padding: '0 16px 12px' }}>
          {all === null && <div style={{ color: '#888', fontSize: 13 }}>Loading…</div>}
          {all && all.length === 0 && <div style={{ color: '#888', fontSize: 13 }}>No photos on this job yet. Use Add photos instead.</div>}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
            {(all || []).map(p => {
              const on = sel.has(p.id), already = have.has(p.url);
              return (
                <div key={p.id} onClick={() => !already && toggle(p.id)} style={{ position: 'relative', aspectRatio: '1', borderRadius: 6, overflow: 'hidden', background: '#e4e8f0', outline: on ? `3px solid ${ORANGE}` : 'none', outlineOffset: -3, opacity: already ? 0.4 : 1, cursor: already ? 'default' : 'pointer' }}>
                  <img src={p.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                  {already && <div style={{ position: 'absolute', bottom: 3, left: 3, background: 'rgba(0,0,0,0.6)', color: '#fff', fontSize: 9, padding: '1px 4px', borderRadius: 3 }}>ADDED</div>}
                </div>
              );
            })}
          </div>
        </div>
        <div style={{ padding: 12, borderTop: '1px solid #eef1f7' }}>
          <button disabled={!sel.size} onClick={() => onDone((all || []).filter(p => sel.has(p.id)).map(p => ({ url: p.url, job_photo_id: p.id })))}
            style={{ ...btnS('primary'), width: '100%', opacity: sel.size ? 1 : 0.5 }}>{sel.size ? `Add ${sel.size} photo${sel.size === 1 ? '' : 's'}` : 'Tap photos to add'}</button>
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
      {(co.photos || []).length > 0 && (
        <div style={{ background: '#fff', borderRadius: 10, padding: 16, marginBottom: 12 }}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>Photos</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
            {co.photos.map(ph => (
              <a key={ph.url} href={ph.url} target="_blank" rel="noopener noreferrer" style={{ display: 'block', aspectRatio: '1', borderRadius: 6, overflow: 'hidden', background: '#e4e8f0' }}>
                <img src={ph.url} alt="Photo of the work" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
              </a>
            ))}
          </div>
          <div style={{ fontSize: 12, color: '#888', marginTop: 6 }}>Tap a photo to see it full size.</div>
        </div>
      )}

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
          <div style={{ fontSize: 12, color: '#888', marginTop: 10 }}>If we texted you this change order, you can also approve by replying YES.</div>
          <button onClick={() => { if (window.confirm('Decline this change order? Nothing will be added to your invoice.')) submit(true); }} disabled={busy}
            style={{ background: 'none', border: 'none', color: '#c0392b', fontSize: 13, marginTop: 10, cursor: 'pointer', padding: 0 }}>Decline</button>
          {error && <div style={{ color: '#c0392b', fontSize: 13, marginTop: 8 }}>{error}</div>}
        </div>
      )}
    </>
  );
}

// ─── For the invoice's AI chat (App.jsx AIChatPanel) ────────────────────────

// What the model is told about this invoice's change orders.
export function changeOrdersPromptBlock(invoiceId, list, taxPct, contact) {
  const rows = (list || []).map(c => {
    const t = coTotals(c.items, taxPct);
    const how = c.status === 'sent' ? ` (${[c.sent_email && 'emailed ' + c.sent_email, c.sent_to && 'texted ' + c.sent_to].filter(Boolean).join(', ')})` : '';
    return `  CO${c.seq} | ${STATUS[c.status]?.label || c.status}${how} | ${money(t.total)} | ${(c.items || []).map(i => `${i.name} ${money(Number(i.qty ?? 1) * Number(i.price ?? 0))}`).join('; ')}${(c.photos || []).length ? ` | ${c.photos.length} photo(s)` : ''}`;
  }).join('\n');
  return `

CHANGE ORDERS on ${invoiceId} (extra work the CUSTOMER must approve before it is added; approved ones are added to the invoice automatically):
${rows || '  (none yet)'}
Customer contact on file: email ${contact.email || '(none)'} | mobile ${contact.phone || '(none)'}

Change order actions (use these, NOT add_items, whenever Jake says "change order", "needs the customer's approval", "send them the extra work to approve", or similar):
{"action":"create_change_order","items":[{"name":"Short title","desc":"details","qty":1,"price":000,"taxable":true}],"note":"optional note to the customer","send":"none","summary":"one sentence"}
{"action":"update_change_order","seq":1,"items":[...the full new list of lines...],"note":"","summary":"one sentence"}
{"action":"send_change_order","seq":1,"send":"auto","summary":"one sentence"}
Rules:
- "send" is one of "none" (save as a draft), "email", "text", "both", or "auto" (every channel on file: email and text). Only send when Jake says send / email / text it / get it to the customer; "make", "write up" or "draft" a change order means "none".
- Optional "email" and "phone" fields override the contact on file; include them when Jake gives a different address or number.
- Prices follow the same pricing rules as line items. Never add change order lines to the invoice yourself: the customer's approval does that.
- Only draft or sent change orders can be updated or resent; approved and declined ones are final.
- PHOTOS: any photos Jake attaches to his message are put on the change order automatically (the new one, or the one named by seq). Do not describe them as line items; mention them in the summary only.
- Plain add_items is still right when Jake just wants a line on the invoice with no customer approval.`;
}

// Runs one change order action from the AI chat. Returns the text the chat
// shows: what really happened, never the model's own claim.
export async function runChangeOrderAction(a, { invoiceId, isInvoice, phone, email, photos: chatPhotos }) {
  if (!isInvoice) return 'Change orders go on the invoice. Convert this estimate to an invoice first.';
  if (!invoiceId) return 'Save this invoice first (add a client), then I can make the change order.';
  try {
    const list = await listChangeOrders(invoiceId);
    let row;
    // Photos Jake attached to this chat message go on the change order.
    const uploadChat = async (seq) => {
      const out = [];
      for (const d of (chatPhotos || []).slice(0, MAX_CO_PHOTOS)) out.push(await uploadChangeOrderPhoto(invoiceId, d, seq));
      return out;
    };
    let photoNote = '';
    if (a.action === 'create_change_order') {
      const nextSeq = (list.reduce((m, c) => Math.max(m, c.seq), 0)) + 1;
      const pics = await uploadChat(nextSeq);
      row = await saveChangeOrder({ invoiceId, items: a.items, note: a.note, photos: pics });
      if (pics.length) photoNote = ` with ${pics.length} photo${pics.length === 1 ? '' : 's'}`;
    } else {
      const seq = Number(a.seq) || (list.length ? list[list.length - 1].seq : null);
      row = list.find(c => c.seq === seq);
      if (!row) return `There is no change order ${seq ? `CO${seq} ` : ''}on ${invoiceId}.`;
      const pics = (chatPhotos || []).length && row.status !== 'approved' && row.status !== 'declined' ? await uploadChat(row.seq) : [];
      if (a.action === 'update_change_order' || pics.length) {
        row = await saveChangeOrder({ row, invoiceId, items: a.action === 'update_change_order' && a.items?.length ? a.items : row.items, note: a.action === 'update_change_order' ? (a.note ?? row.note) : row.note, photos: [...(row.photos || []), ...pics] });
      }
      if (pics.length) photoNote = ` (${pics.length} photo${pics.length === 1 ? '' : 's'} added)`;
    }
    const label = `${invoiceId}-CO${row.seq}`;
    const total = money(coTotals(row.items, a.taxPct).total);
    const mode = a.action === 'update_change_order' && !a.send ? 'none' : (a.send || (a.action === 'send_change_order' ? 'auto' : 'none'));
    if (mode === 'none') return `${label} ${a.action === 'update_change_order' ? 'updated' : 'saved as a draft'} (${total})${photoNote}. Not sent yet.`;
    const toEmail = (mode === 'email' || mode === 'both' || mode === 'auto') ? (a.email || email || null) : null;
    const toPhone = (mode === 'text' || mode === 'both' || mode === 'auto') ? (a.phone || phone || null) : null;
    if (!toEmail && !toPhone) return `${label} saved (${total}) but not sent: no ${mode === 'text' ? 'mobile number' : mode === 'email' ? 'email address' : 'email or mobile'} on file. Tell me where to send it.`;
    const j = await sendChangeOrderTo({ id: row.id, invoiceId, phone: toPhone, email: toEmail });
    const missing = mode === 'both' && (!toEmail || !toPhone) ? ` No ${!toEmail ? 'email' : 'mobile'} on file, so that part was skipped.` : '';
    return `${label} (${total})${photoNote} ${sentSummary(j)}.${missing} It is added to the invoice when the customer approves.`;
  } catch (e) {
    return `Change order not done: ${e.message || e}`;
  }
}
