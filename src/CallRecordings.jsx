// Lisa's call recordings, on the estimate and from the Call record email.
//
// The list comes from public.vapi_calls (migration 067), which only admins can
// read. The audio itself stays in Vapi: tapping Play asks
// /api/vapi-call-ended?recording=<callId> for a short-lived link (see
// api/_lib/call-recording.js) and hands it to an <audio> element. Links expire,
// so one is fetched per play and never stored.

import { useEffect, useState } from 'react';
import { supabase } from './supabase.js';
import { api } from './apiBase.js';

const NAVY = '#0a1628';
const BLUE = '#0070ba';

const ERRORS = {
  no_recording: 'No recording for this call. Recording may have been off in Vapi, or Vapi no longer keeps it.',
  unauthorized: 'Only an admin can play call recordings.',
  vapi_key_missing: 'The Vapi key is not set up on the server.',
  vapi_unreachable: 'Could not reach Vapi. Try again in a minute.',
};

export async function getRecordingUrl(callId) {
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;
  if (!token) throw new Error(ERRORS.unauthorized);
  const res = await fetch(api(`/api/vapi-call-ended?recording=${encodeURIComponent(callId)}`), {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = await res.json().catch(() => ({}));
  if (res.ok && body.url) return body.url;
  throw new Error(ERRORS[body.error] || `Could not load the recording (${body.error || res.status}).`);
}

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

// One call: a Play button that turns into the player once the link arrives.
function CallRow({ call }) {
  const [state, setState] = useState({ status: 'idle', url: null, error: null });

  const play = async () => {
    setState({ status: 'loading', url: null, error: null });
    try {
      const url = await getRecordingUrl(call.call_id);
      setState({ status: 'ready', url, error: null });
    } catch (e) {
      setState({ status: 'error', url: null, error: e.message || String(e) });
    }
  };

  const meta = [fmtWhen(call.created_at), fmtLen(call.seconds)].filter(Boolean).join(' · ');

  return (
    <div style={{ padding: '10px 12px', borderTop: '1px solid #f0f2f8' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        <div style={{ fontSize: 13, color: '#333', minWidth: 0 }}>{meta || 'Call'}</div>
        {state.status !== 'ready' && (
          <button
            type="button"
            onClick={play}
            disabled={state.status === 'loading'}
            style={{
              background: BLUE, color: '#fff', border: 'none', borderRadius: 6,
              padding: '8px 14px', fontSize: 13, fontWeight: 700, flexShrink: 0,
              opacity: state.status === 'loading' ? 0.6 : 1,
            }}
          >
            {state.status === 'loading' ? 'Loading…' : 'Play'}
          </button>
        )}
      </div>
      {state.status === 'ready' && (
        <audio controls autoPlay src={state.url} style={{ width: '100%', marginTop: 8 }} />
      )}
      {state.status === 'error' && (
        <div style={{ fontSize: 12, color: '#b03a2e', marginTop: 6 }}>{state.error}</div>
      )}
    </div>
  );
}

// Every call linked to this job. The paired number is included so a converted
// invoice still shows the calls made about its estimate (EST1000 -> INV1000).
export default function CallRecordings({ docId, convertedToId }) {
  const [calls, setCalls] = useState([]);

  useEffect(() => {
    if (!docId) { setCalls([]); return; }
    const ids = [...new Set([
      docId,
      convertedToId,
      String(docId).replace(/^INV/, 'EST'),
    ].filter(Boolean))];
    let cancelled = false;
    supabase
      .from('vapi_calls')
      .select('call_id, created_at, seconds')
      .in('invoice_id', ids)
      .order('created_at', { ascending: false })
      .then(({ data, error }) => {
        // A missing table (067 not yet run) or a non-admin just shows nothing.
        if (!cancelled) setCalls(error ? [] : (data || []));
      });
    return () => { cancelled = true; };
  }, [docId, convertedToId]);

  if (!calls.length) return null;

  return (
    <div style={{ marginTop: 8, background: '#fff', borderRadius: 10, overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
      <div style={{ padding: '10px 12px', fontSize: 12, fontWeight: 700, color: NAVY, letterSpacing: 0.4 }}>
        CALL RECORDINGS · LISA
      </div>
      {calls.map(c => <CallRow key={c.call_id} call={c} />)}
    </div>
  );
}

// Opened from the "Listen to the recording" link in the Call record email,
// which lands on the app as /?call=<callId>.
export function CallRecordingModal({ callId, onClose }) {
  const [state, setState] = useState({ status: 'loading', url: null, error: null });

  useEffect(() => {
    let cancelled = false;
    getRecordingUrl(callId)
      .then(url => { if (!cancelled) setState({ status: 'ready', url, error: null }); })
      .catch(e => { if (!cancelled) setState({ status: 'error', url: null, error: e.message || String(e) }); });
    return () => { cancelled = true; };
  }, [callId]);

  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(10,22,40,0.55)', zIndex: 5000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{ background: '#fff', borderRadius: 12, width: '100%', maxWidth: 420, overflow: 'hidden' }}
      >
        <div style={{ background: NAVY, color: '#fff', padding: '12px 16px', fontSize: 14, fontWeight: 700, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>Call recording</span>
          <button type="button" onClick={onClose} style={{ background: 'none', border: 'none', color: '#fff', fontSize: 14, fontWeight: 700 }}>Close</button>
        </div>
        <div style={{ padding: 16 }}>
          {state.status === 'loading' && <div style={{ fontSize: 14, color: '#666' }}>Loading the recording…</div>}
          {state.status === 'ready' && <audio controls autoPlay src={state.url} style={{ width: '100%' }} />}
          {state.status === 'error' && <div style={{ fontSize: 14, color: '#b03a2e' }}>{state.error}</div>}
        </div>
      </div>
    </div>
  );
}
