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
import { useEffect, useState } from 'react';
import { previewChangeOrderDraft, sendChangeOrderTo, sentSummary } from './ChangeOrders.jsx';

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
