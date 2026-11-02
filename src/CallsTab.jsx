// Calls tab (admin): every row of public.vapi_calls, whether or not it is
// linked to a client or a document. The list reads PostgREST directly under the
// admin's session (vapi_calls is admin-read, migration 067). Names come from
// clients (client_id, migration 108) or, for outbound calls, from call_queue
// via call_queue_id. Audio is fetched per play through getRecordingUrl().

import { useEffect, useState } from 'react';
import { supabase } from './supabase.js';
import { getRecordingUrl } from './CallRecordings.jsx';

const NAVY = '#0a1628';
const BLUE = '#0070ba';

function fmtWhen(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return '';
  return d.toLocaleString('en-US', {
    timeZone: 'Pacific/Honolulu', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

function fmtLen(s) {
  if (!Number.isFinite(s) || s <= 0) return '';
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function DirBadge({ direction }) {
  const outbound = direction === 'outbound';
  return (
    <span style={{
      background: outbound ? '#e8f1fb' : '#fff1e0', color: outbound ? BLUE : '#b85c00',
      borderRadius: 4, padding: '2px 6px', fontSize: 11, fontWeight: 700, flexShrink: 0,
    }}>{outbound ? 'Outbound' : 'Inbound'}</span>
  );
}

const chip = {
  background: '#eef1f8', color: NAVY, border: 'none', borderRadius: 10,
  padding: '3px 9px', fontSize: 11, fontWeight: 700, cursor: 'pointer',
};

function CallSheet({ call, name, onClose, onOpenInvoice, onOpenClient }) {
  const [rec, setRec] = useState({ status: 'idle', url: null, error: null });

  const play = async () => {
    setRec({ status: 'loading', url: null, error: null });
    try {
      setRec({ status: 'ready', url: await getRecordingUrl(call.call_id), error: null });
    } catch (e) {
      setRec({ status: 'error', url: null, error: e.message || String(e) });
    }
  };

  const meta = [fmtWhen(call.created_at), fmtLen(call.seconds), call.phone].filter(Boolean).join(' · ');

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(10,22,40,0.55)', zIndex: 1000, display: 'flex', alignItems: 'flex-end' }}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#fff', width: '100%', maxHeight: '88vh', overflowY: 'auto', borderRadius: '16px 16px 0 0', padding: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
            <DirBadge direction={call.direction} />
            <span style={{ fontWeight: 700, color: NAVY, fontSize: 16, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
          </div>
          <button type="button" onClick={onClose} style={{ background: NAVY, color: '#fff', border: 'none', borderRadius: 6, padding: '8px 14px', fontSize: 13, fontWeight: 700 }}>Close</button>
        </div>
        <div style={{ fontSize: 12, color: '#777', marginTop: 6 }}>{meta}</div>
        <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
          {call.client_id && onOpenClient && <button type="button" style={chip} onClick={() => { onClose(); onOpenClient(call.client_id); }}>Client</button>}
          {call.invoice_id && onOpenInvoice && <button type="button" style={chip} onClick={() => { onClose(); onOpenInvoice(call.invoice_id); }}>Document {call.invoice_id}</button>}
        </div>

        <div style={{ marginTop: 12 }}>
          {rec.status !== 'ready' && (
            <button type="button" onClick={play} disabled={rec.status === 'loading'} style={{ background: BLUE, color: '#fff', border: 'none', borderRadius: 6, padding: '10px 16px', fontSize: 14, fontWeight: 700, opacity: rec.status === 'loading' ? 0.6 : 1 }}>
              {rec.status === 'loading' ? 'Loading…' : 'Play Recording'}
            </button>
          )}
          {rec.status === 'ready' && <audio controls autoPlay src={rec.url} style={{ width: '100%' }} />}
          {rec.status === 'error' && <div style={{ fontSize: 12, color: '#b03a2e', marginTop: 6 }}>{rec.error}</div>}
        </div>

        <div style={{ fontSize: 12, fontWeight: 700, color: NAVY, letterSpacing: 0.4, marginTop: 16 }}>SUMMARY</div>
        <div style={{ fontSize: 14, color: '#333', marginTop: 4, whiteSpace: 'pre-wrap' }}>{call.summary || 'No summary.'}</div>

        <div style={{ fontSize: 12, fontWeight: 700, color: NAVY, letterSpacing: 0.4, marginTop: 16 }}>TRANSCRIPT</div>
        <div style={{ fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 12, color: '#333', background: '#f6f7fb', borderRadius: 8, padding: 10, marginTop: 4, maxHeight: 300, overflowY: 'auto', whiteSpace: 'pre-wrap' }}>
          {call.transcript || 'No transcript stored for this call.'}
        </div>
      </div>
    </div>
  );
}

export default function CallsTab({ isAdmin, onOpenInvoice, onOpenClient, setSubHeader }) {
  const [calls, setCalls] = useState([]);
  const [names, setNames] = useState({ clients: {}, queue: {} });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [open, setOpen] = useState(null);

  useEffect(() => { setSubHeader?.("calls", null); }, [setSubHeader]);

  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    (async () => {
      const { data, error: err } = await supabase
        .from('vapi_calls')
        .select('call_id, invoice_id, client_id, phone, seconds, created_at, direction, summary, transcript, call_queue_id')
        .order('created_at', { ascending: false })
        .limit(200);
      if (cancelled) return;
      if (err) { setError(err.message); setLoading(false); return; }
      const rows = data || [];
      setCalls(rows);
      const clientIds = [...new Set(rows.map(r => r.client_id).filter(Boolean))];
      const queueIds = [...new Set(rows.filter(r => !r.client_id && r.call_queue_id).map(r => r.call_queue_id))];
      const [cl, q] = await Promise.all([
        clientIds.length ? supabase.from('clients').select('id, name').in('id', clientIds) : { data: [] },
        queueIds.length ? supabase.from('call_queue').select('id, client_name').in('id', queueIds) : { data: [] },
      ]);
      if (cancelled) return;
      setNames({
        clients: Object.fromEntries((cl.data || []).map(c => [c.id, c.name])),
        queue: Object.fromEntries((q.data || []).map(c => [c.id, c.client_name])),
      });
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [isAdmin]);

  if (!isAdmin) return null;

  const nameFor = c =>
    (c.client_id && names.clients[c.client_id]) ||
    (c.call_queue_id && names.queue[c.call_queue_id]) ||
    c.phone || 'Unknown caller';

  return (
    <div style={{ padding: 12 }}>
      {loading && <div style={{ color: '#777', fontSize: 13, padding: 12 }}>Loading calls…</div>}
      {error && <div style={{ color: '#b03a2e', fontSize: 13, padding: 12 }}>Could not load calls: {error}</div>}
      {!loading && !error && !calls.length && <div style={{ color: '#777', fontSize: 13, padding: 12 }}>No calls yet.</div>}
      {calls.map(c => {
        const summary = c.summary ? (c.summary.length > 120 ? c.summary.slice(0, 120) + '…' : c.summary) : '';
        return (
          <div key={c.call_id} onClick={() => setOpen(c)} style={{ background: '#fff', border: '1px solid #e3e7f0', borderRadius: 10, padding: '10px 12px', marginBottom: 8, cursor: 'pointer' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <DirBadge direction={c.direction} />
              <span style={{ fontWeight: 700, color: NAVY, fontSize: 14, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{nameFor(c)}</span>
              <span style={{ fontSize: 12, color: '#777', flexShrink: 0 }}>{fmtLen(c.seconds)}</span>
            </div>
            {summary && <div style={{ fontSize: 12, color: '#888', marginTop: 4 }}>{summary}</div>}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 }}>
              <span style={{ fontSize: 11, color: '#777', flex: 1 }}>{fmtWhen(c.created_at)}</span>
              {c.client_id && onOpenClient && (
                <button type="button" style={chip} onClick={e => { e.stopPropagation(); onOpenClient(c.client_id); }}>Client</button>
              )}
              {c.invoice_id && onOpenInvoice && (
                <button type="button" style={chip} onClick={e => { e.stopPropagation(); onOpenInvoice(c.invoice_id); }}>Document</button>
              )}
            </div>
          </div>
        );
      })}
      {open && <CallSheet call={open} name={nameFor(open)} onClose={() => setOpen(null)} onOpenInvoice={onOpenInvoice} onOpenClient={onOpenClient} />}
    </div>
  );
}
