// A draft shown in the AI chats before anything goes to a customer (v1.56.0).
// Nothing is sent until Jake taps Send; Cancel sends nothing.
//
//   draft.kind 'sms'           { phone, message, invoiceId }   the text is editable
//   draft.kind 'change_order'  { coId, invoiceId, label, total, email, phone }
//                              shows the exact email (rendered) and text the
//                              server would send, with Email / Text choices
//
// draft.status: 'draft' | 'sending' | 'sent' | 'cancelled' | 'failed', and
// draft.result is the line shown afterwards. The parent stores both on the
// chat message (onUpdate), so a reopened chat shows what happened.
import { useEffect, useRef, useState } from 'react';
import { previewChangeOrderDraft, sendChangeOrderTo, sentSummary, saveChangeOrder, coTotals, ChangeOrderPhotos } from './ChangeOrders.jsx';

const NAVY = '#0a1628';
const box = { marginTop: 10, background: '#f4f6fa', borderRadius: 8, padding: 12, fontFamily: "'Barlow', sans-serif" };
const label = { fontSize: 11, fontWeight: 700, color: '#6677aa', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 4 };
const input = { width: '100%', boxSizing: 'border-box', padding: '8px 10px', border: '1.5px solid #dde2ee', borderRadius: 8, fontSize: 14, fontFamily: "'Barlow', sans-serif", background: '#fff' };
const btn = (primary) => ({ flex: primary ? 2 : 1, border: primary ? 'none' : '1.5px solid #dde2ee', background: primary ? NAVY : '#fff', color: primary ? '#fff' : NAVY, borderRadius: 8, padding: '9px 0', fontSize: 13, fontWeight: 700, cursor: 'pointer' });

export default function SendDraftCard({ draft, onUpdate, sendSms }) {
  const [phone, setPhone] = useState(draft.phone || '');
  const [message, setMessage] = useState(draft.message || '');
  const [email, setEmail] = useState(draft.email || '');
  const [viaEmail, setViaEmail] = useState(draft.kind === 'change_order' ? !!draft.email : false);
  const [viaText, setViaText] = useState(draft.kind === 'change_order' ? !!draft.phone : true);
  const [preview, setPreview] = useState(null);
  const [err, setErr] = useState('');
  const status = draft.status || 'draft';
  const open = status === 'draft' || status === 'failed';

  useEffect(() => {
    if (draft.kind !== 'change_order' || !open) return;
    previewChangeOrderDraft(draft.coId).then(setPreview).catch(e => setErr(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.coId]);

  if (status === 'sent' || status === 'cancelled') {
    return <div style={{ ...box, fontSize: 13, color: status === 'sent' ? '#1e8449' : '#888' }}>{draft.result || (status === 'sent' ? 'Sent.' : 'Cancelled. Nothing was sent.')}</div>;
  }

  const send = async () => {
    setErr('');
    try {
      if (draft.kind === 'sms') {
        if (!String(phone).replace(/\D/g, '').match(/\d{10}$/)) throw new Error('Enter a mobile number.');
        if (!message.trim()) throw new Error('The message is empty.');
        onUpdate({ status: 'sending' });
        const r = await sendSms({ phone, message: message.trim(), invoiceId: draft.invoiceId });
        onUpdate({ status: 'sent', phone, message: message.trim(), result: r?.text || `Texted ${phone}.` });
      } else {
        if (!viaEmail && !viaText) throw new Error('Pick email, text or both.');
        if (viaEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) throw new Error('Enter an email address.');
        if (viaText && !String(phone).replace(/\D/g, '').match(/\d{10}$/)) throw new Error('Enter a mobile number.');
        onUpdate({ status: 'sending' });
        const j = await sendChangeOrderTo({ id: draft.coId, invoiceId: draft.invoiceId, phone: viaText ? phone : null, email: viaEmail ? email.trim() : null });
        onUpdate({ status: 'sent', result: `${draft.label} ${sentSummary(j)}. It is added to the invoice when the customer approves.` });
      }
    } catch (e) {
      setErr(e.message || String(e));
      onUpdate({ status: 'failed' });
    }
  };

  return (
    <div style={box}>
      <div style={{ fontSize: 13, fontWeight: 700, color: '#1a1a1a', marginBottom: 8 }}>
        Draft, not sent yet{draft.kind === 'change_order' ? ` · ${draft.label}${draft.total ? ` · ${draft.total}` : ''}` : ''}
      </div>
      {draft.kind === 'sms' && (
        <>
          <div style={label}>To (mobile)</div>
          <input value={phone} onChange={e => setPhone(e.target.value)} inputMode="tel" style={input} disabled={!open} />
          <div style={{ ...label, marginTop: 8 }}>Text message</div>
          <textarea aria-label="Draft text message" value={message} onChange={e => setMessage(e.target.value)} rows={4} style={{ ...input, resize: 'vertical' }} disabled={!open} />
          <div style={{ fontSize: 11, color: '#999', marginTop: 2 }}>{message.length} characters. Edit it here before sending.</div>
        </>
      )}
      {draft.kind === 'change_order' && (
        <>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, marginBottom: 4 }}>
            <input type="checkbox" checked={viaEmail} onChange={e => setViaEmail(e.target.checked)} disabled={!open} /> Email
          </label>
          <input value={email} onChange={e => setEmail(e.target.value)} inputMode="email" autoCapitalize="none" placeholder="customer@email.com" style={{ ...input, opacity: viaEmail ? 1 : 0.5 }} disabled={!open} />
          {viaEmail && preview && (
            <>
              <div style={{ ...label, marginTop: 8 }}>Subject</div>
              <div style={{ fontSize: 13, marginBottom: 6 }}>{preview.email.subject}</div>
              <iframe title="Email preview" srcDoc={preview.email.html} sandbox="allow-same-origin" style={{ width: '100%', height: 360, border: '1.5px solid #dde2ee', borderRadius: 8, background: '#fff' }} />
            </>
          )}
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, margin: '10px 0 4px' }}>
            <input type="checkbox" checked={viaText} onChange={e => setViaText(e.target.checked)} disabled={!open} /> Text
          </label>
          <input value={phone} onChange={e => setPhone(e.target.value)} inputMode="tel" placeholder="(808) 555-1234" style={{ ...input, opacity: viaText ? 1 : 0.5 }} disabled={!open} />
          {viaText && preview && <div style={{ whiteSpace: 'pre-wrap', fontSize: 13, background: '#fff', border: '1.5px solid #dde2ee', borderRadius: 8, padding: 10, marginTop: 6 }}>{preview.text}</div>}
          {!preview && !err && <div style={{ fontSize: 12, color: '#888', marginTop: 6 }}>Loading the preview…</div>}
          <div style={{ fontSize: 11, color: '#999', marginTop: 6 }}>To change the lines or note, ask me, or open it in the Change orders card.</div>
        </>
      )}
      {err && <div style={{ fontSize: 12, color: '#c0392b', marginTop: 6 }}>{err}</div>}
      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
        <button onClick={() => onUpdate({ status: 'cancelled', result: 'Cancelled. Nothing was sent.' })} disabled={status === 'sending'} style={btn(false)}>Cancel</button>
        <button onClick={send} disabled={status === 'sending' || (draft.kind === 'change_order' && !preview)} style={{ ...btn(true), opacity: status === 'sending' || (draft.kind === 'change_order' && !preview) ? 0.6 : 1 }}>
          {status === 'sending' ? 'Sending…' : 'Send'}
        </button>
      </div>
    </div>
  );
}


// "Review & send" for change-order mode on the invoice (v1.57.0): the lines
// built with the invoice's own tools, a note and photos, then the exact email
// and text as a SendDraftCard. Nothing goes out until Send.
const fmtMoney = (n) => '$' + (Math.round(Number(n || 0) * 100) / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
export function ChangeOrderSendSheet({ invoiceId, linkedIds, row, items, taxPct, phone, email, onClose, onSaved, onSent, onApproveNow }) {
  const [note, setNote] = useState(row?.note || '');
  const [photos, setPhotos] = useState(row?.photos || []);
  const [saved, setSaved] = useState(null);
  const [draft, setDraft] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const draftRef = useRef(null);
  const t = coTotals(items, taxPct);
  // The preview replaces the button further down the sheet: bring it up.
  useEffect(() => {
    if (draft?.status === 'draft' && draftRef.current) requestAnimationFrame(() => draftRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!draft]);
  const label = `${invoiceId}-CO${(saved || row)?.seq || ''}`;

  const toPreview = async () => {
    setBusy(true); setErr('');
    try {
      const r = await saveChangeOrder({ row: saved || row, invoiceId, items, note, photos });
      setSaved(r); onSaved?.(r);
      setDraft({ kind: 'change_order', coId: r.id, invoiceId, label: `${invoiceId}-CO${r.seq}`, total: fmtMoney(coTotals(r.items, taxPct).total), email: email || '', phone: phone || '', status: 'draft' });
    } catch (e) { setErr(e.message || String(e)); } finally { setBusy(false); }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 3000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', overflowY: 'auto', overscrollBehavior: 'contain', WebkitOverflowScrolling: 'touch' }} onClick={() => !busy && onClose()}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#f4f6fa', width: '100%', maxWidth: 520, minHeight: '100%', paddingBottom: 24, fontFamily: "'Barlow', sans-serif" }}>
        <div style={{ background: NAVY, color: '#fff', padding: '14px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'sticky', top: 0, zIndex: 1 }}>
          <div>
            <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 18 }}>Review change order {label.replace(/^.*-CO/, '')}</div>
            <div style={{ fontSize: 12, color: '#E8622A' }}>{items.length} line{items.length === 1 ? '' : 's'} · {fmtMoney(t.total)}</div>
          </div>
          <button onClick={onClose} aria-label="Close" style={{ background: 'none', border: 'none', color: '#8899bb', fontSize: 26, cursor: 'pointer' }}>×</button>
        </div>
        <div style={{ padding: 16 }}>
          <div style={{ background: '#fff', borderRadius: 10, padding: 12 }}>
            {items.map((it, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '6px 0', borderTop: i ? '1px solid #eef1f7' : 'none', fontSize: 14 }}>
                <span><strong>{it.name || 'Additional work'}</strong>{it.desc ? <span style={{ color: '#777' }}> · {it.desc}</span> : null}{Number(it.qty ?? 1) !== 1 ? <span style={{ color: '#999' }}> ({it.qty} x {fmtMoney(it.price)})</span> : null}</span>
                <span style={{ whiteSpace: 'nowrap' }}>{fmtMoney(Number(it.qty ?? 1) * Number(it.price ?? 0))}</span>
              </div>
            ))}
            <div style={{ borderTop: '2px solid #eef1f7', marginTop: 6, paddingTop: 6, fontSize: 13, color: '#555' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Tax ({Number(taxPct || 0)}%)</span><span>{fmtMoney(t.tax)}</span></div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, fontSize: 15, color: '#1a1a1a' }}><span>Change order total</span><span>{fmtMoney(t.total)}</span></div>
            </div>
          </div>
          {!draft && (
            <>
              <ChangeOrderPhotos invoiceId={invoiceId} linkedIds={linkedIds} seq={(saved || row)?.seq} photos={photos} setPhotos={setPhotos} />
              <textarea value={note} onChange={e => setNote(e.target.value)} placeholder="Note to the customer (optional)" rows={2} style={{ ...input, marginTop: 10, resize: 'vertical' }} />
              {err && <div style={{ fontSize: 12, color: '#c0392b', marginTop: 6 }}>{err}</div>}
              <button onClick={toPreview} disabled={busy || !items.length} style={{ ...btn(true), width: '100%', marginTop: 12, padding: '12px 0', fontSize: 15, opacity: busy || !items.length ? 0.6 : 1 }}>{busy ? 'Saving…' : 'Preview email and text'}</button>
              <div style={{ fontSize: 12, color: '#888', marginTop: 8, textAlign: 'center' }}>Nothing is sent until you tap Send on the next step.</div>
              {/* v1.59.0: extra work that needs no customer sign-off goes
                  straight onto the invoice, still recorded as a change order. */}
              {onApproveNow && (
                <button onClick={async () => { setBusy(true); setErr(''); try { await onApproveNow({ note, photos }); } catch (e) { setErr(e.message || String(e)); } finally { setBusy(false); } }} disabled={busy || !items.length}
                  style={{ ...btn(false), width: '100%', marginTop: 14, padding: '11px 0', fontSize: 14, opacity: busy || !items.length ? 0.6 : 1 }}>Add to invoice without approval</button>
              )}
            </>
          )}
          {draft && (
            <div ref={draftRef} style={{ scrollMarginTop: 72 }}>
            <SendDraftCard draft={draft}
              onUpdate={(patch) => { setDraft(d => ({ ...d, ...patch })); if (patch.status === 'sent') onSent?.(patch.result); }}
              sendSms={async () => { throw new Error('not used'); }} />
            </div>
          )}
          {draft?.status === 'cancelled' && <button onClick={onClose} style={{ ...btn(false), width: '100%', marginTop: 10 }}>Back to the invoice</button>}
          {draft?.status === 'sent' && <button onClick={onClose} style={{ ...btn(true), width: '100%', marginTop: 10 }}>Back to the invoice</button>}
        </div>
      </div>
    </div>
  );
}
