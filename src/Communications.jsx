// Client profile > Communications: every text and call with one client in a
// single newest-first timeline. Admin only (vapi_calls is admin-read).
//
// Texts come from client_messages, matched by client_id else the last 10 digits
// of the number (rows logged before the client existed have no client_id).
// Calls come from vapi_calls, matched by phone digits. Audio is streamed
// through /api/call-recording, which needs the session token, so Play fetches
// the bytes and hands the <audio> a blob URL.

import { useEffect, useRef, useState } from 'react';
import { supabase } from './supabase.js';
import { api } from './apiBase.js';
import { loadMessages, digits10, stamp, mediaList, Media } from './Messages.jsx';

const NAVY = '#0a1628';
const BLUE = '#0070ba';

const ERRORS = {
  no_recording: 'No recording for this call.',
  unauthorized: 'Only an admin can play call recordings.',
  vapi_key_missing: 'The Vapi key is not set up on the server.',
};

const dur = (s) => (Number.isFinite(s) && s > 0 ? `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s` : null);

function Play({ callId }) {
  const [src, setSrc] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const urlRef = useRef('');
  useEffect(() => () => { if (urlRef.current) URL.revokeObjectURL(urlRef.current); }, []);

  const load = async () => {
    setBusy(true); setErr('');
    try {
      const { data } = await supabase.auth.getSession();
      const token = data?.session?.access_token;
      if (!token) throw new Error(ERRORS.unauthorized);
      const res = await fetch(api(`/api/call-recording?id=${encodeURIComponent(callId)}`), {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(ERRORS[body.error] || `Could not load the recording (${res.status}).`);
      }
      urlRef.current = URL.createObjectURL(await res.blob());
      setSrc(urlRef.current);
    } catch (e) { setErr(String(e.message || e)); }
    finally { setBusy(false); }
  };

  if (src) return <audio controls autoPlay src={src} style={{ width: '100%', marginTop: 8 }} />;
  return (
    <div style={{ marginTop: 8 }}>
      <button onClick={load} disabled={busy} style={{ background: BLUE, color: '#fff', border: 'none', borderRadius: 16, padding: '7px 16px', fontWeight: 700, fontSize: 13, cursor: 'pointer', opacity: busy ? 0.6 : 1 }}>
        {busy ? 'Loading...' : '▶ Play'}
      </button>
      {err && <div style={{ color: '#cc3333', fontSize: 12, marginTop: 6 }}>{err}</div>}
    </div>
  );
}

function CallEntry({ call }) {
  const out = call.direction === 'outbound';
  const d = dur(call.seconds);
  return (
    <div style={{ alignSelf: 'center', width: '88%', background: '#f4f6fa', border: '1px solid #e1e5ef', borderRadius: 12, padding: '10px 12px' }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: NAVY }}>
        {out ? '📤 Outgoing call' : '📞 Incoming call'}{d ? ` · ${d}` : ''}
      </div>
      {call.summary && <div style={{ fontSize: 13, color: '#444', marginTop: 4, lineHeight: 1.35 }}>{call.summary}</div>}
      <Play callId={call.call_id} />
    </div>
  );
}

function Bubble({ m }) {
  const out = m.direction === 'outbound';
  const media = mediaList(m);
  return (
    <div style={{
      alignSelf: out ? 'flex-end' : 'flex-start', maxWidth: '80%',
      background: out ? BLUE : '#e5e5ea', color: out ? '#fff' : '#111',
      borderRadius: 18, borderBottomRightRadius: out ? 5 : 18, borderBottomLeftRadius: out ? 18 : 5,
      padding: '8px 12px', fontSize: 15, lineHeight: 1.3, wordBreak: 'break-word', whiteSpace: 'pre-wrap',
    }}>
      {media.map((x, i) => <Media key={i} item={x} />)}
      {typeof m.body === 'string' && m.body.trim() ? <div style={media.length ? { marginTop: 6 } : null}>{m.body}</div> : null}
    </div>
  );
}

export default function ClientCommunications({ client }) {
  const [items, setItems] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setItems(null); setError('');
    (async () => {
      try {
        const digits = [...new Set([client.phone, client.mobile].map(digits10).filter(d => d.length === 10))];
        const [all, callRes] = await Promise.all([
          loadMessages(),
          digits.length
            ? supabase.from('vapi_calls').select('call_id, phone, seconds, direction, summary, created_at')
                .or(digits.map(d => `phone.ilike.%${d}%`).join(',')).order('created_at', { ascending: false }).limit(500)
            : Promise.resolve({ data: [] }),
        ]);
        if (callRes.error) throw callRes.error;
        const texts = all.filter(m => m.client_id === client.id || digits.includes(digits10(m.phone_number)))
          .map(m => ({ kind: 'sms', key: `s${m.id}`, at: m.created_at, m }));
        // The ilike is a coarse filter; confirm on the exact last 10 digits.
        const calls = (callRes.data || []).filter(c => digits.includes(digits10(c.phone)))
          .map(c => ({ kind: 'call', key: `c${c.call_id}`, at: c.created_at, c }));
        if (!cancelled) setItems([...texts, ...calls].sort((a, b) => String(b.at).localeCompare(String(a.at))));
      } catch (e) { if (!cancelled) setError(String(e.message || e)); }
    })();
    return () => { cancelled = true; };
  }, [client.id, client.phone, client.mobile]);

  if (error) return <div style={{ color: '#cc3333', fontSize: 13, padding: 12 }}>{error}</div>;
  if (!items) return <div style={{ color: '#8899bb', fontSize: 13, padding: 12 }}>Loading communications...</div>;
  if (!items.length) return <div style={{ color: '#8899bb', fontSize: 13, textAlign: 'center', padding: 24 }}>No calls or texts with this client yet.</div>;

  return (
    <div style={{ background: '#fff', border: '1px solid #e5e7ee', borderRadius: 12, padding: '4px 12px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
      {items.map(it => (
        <div key={it.key} style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ textAlign: 'center', fontSize: 11, color: '#8899bb', margin: '10px 0 4px' }}>{stamp(it.at)}</div>
          {it.kind === 'sms' ? <Bubble m={it.m} /> : <CallEntry call={it.c} />}
        </div>
      ))}
    </div>
  );
}
