// SMS conversations from public.client_messages: the Messages tab, and the
// thread component reused inside a client profile and an estimate/invoice.
//
// Reads go straight to PostgREST under the signed-in user's JWT (RLS: owner or
// admin). Replies go through /api/sms-inbound with the session token, which
// checks admin, honours settings.sms_outbound_enabled, sends via Twilio and logs
// the row. Everything here is admin-only in the UI.
//
// A row's client is matched by client_id first, then by the last 10 digits of
// its phone number, because rows logged before the client existed have a null
// client_id (see the 079 merge).

import { Component, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from './supabase.js';
import { api } from './apiBase.js';

const NAVY = '#0a1628';
const BLUE = '#0070ba';
const HOUR = 3600 * 1000;
const TZ = 'Pacific/Honolulu';

export const digits10 = (p) => String(p || '').replace(/\D/g, '').slice(-10);

function prettyPhone(p) {
  const d = digits10(p);
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : (p || 'Unknown number');
}

export async function loadMessages() {
  const { data, error } = await supabase
    .from('client_messages')
    .select('id, client_id, phone_number, direction, body, media, created_at, read_at')
    .order('created_at', { ascending: false })
    .limit(1500);
  if (error) throw error;
  return (data || []).reverse();
}

async function markRead(ids) {
  if (!ids.length) return;
  await supabase.from('client_messages').update({ read_at: new Date().toISOString() }).in('id', ids);
}

// Group rows into conversations keyed by client id, else by phone digits.
function groupConversations(rows, clients) {
  const byId = new Map();
  const byDigits = new Map();
  for (const c of clients || []) {
    byId.set(c.id, c);
    for (const p of [c.phone, c.mobile]) {
      const d = digits10(p);
      if (d.length === 10 && !byDigits.has(d)) byDigits.set(d, c);
    }
  }
  const convs = new Map();
  for (const m of rows) {
    const client = byId.get(m.client_id) || byDigits.get(digits10(m.phone_number)) || null;
    const key = client ? client.id : `tel:${digits10(m.phone_number) || m.id}`;
    let cv = convs.get(key);
    if (!cv) {
      cv = { key, client, phone: m.phone_number, messages: [], unread: 0 };
      convs.set(key, cv);
    }
    cv.messages.push(m);
    if (m.direction === 'inbound') cv.phone = m.phone_number || cv.phone;
    if (m.direction === 'inbound' && !m.read_at) cv.unread += 1;
  }
  return [...convs.values()].sort((a, b) =>
    b.messages[b.messages.length - 1].created_at.localeCompare(a.messages[a.messages.length - 1].created_at));
}

// Unread inbound count for the nav badge. Polls lightly; the tab refreshes it
// explicitly after reading a thread.
export function useUnreadMessages(enabled) {
  const [count, setCount] = useState(0);
  const refresh = useCallback(async () => {
    if (!enabled) return;
    try {
      const { count: n } = await supabase
        .from('client_messages').select('id', { count: 'exact', head: true })
        .eq('direction', 'inbound').is('read_at', null);
      setCount(n || 0);
    } catch { /* badge is best effort */ }
  }, [enabled]);
  useEffect(() => {
    refresh();
    if (!enabled) return undefined;
    const t = setInterval(refresh, 60000);
    return () => clearInterval(t);
  }, [enabled, refresh]);
  return [count, refresh];
}

function relTime(iso) {
  const t = new Date(iso).getTime();
  const diff = Date.now() - t;
  if (diff < 60 * 1000) return 'now';
  if (diff < HOUR) return `${Math.floor(diff / 60000)}m`;
  if (diff < 24 * HOUR) return `${Math.floor(diff / HOUR)}h`;
  if (diff < 7 * 24 * HOUR) return new Date(iso).toLocaleDateString('en-US', { weekday: 'short', timeZone: TZ });
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: TZ });
}

export function stamp(iso) {
  const d = new Date(iso);
  const day = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: TZ });
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: TZ });
  return `${day}, ${time}`;
}

export const mediaList = (m) => (Array.isArray(m?.media) ? m.media.filter(x => x && typeof x === 'object') : []);

function previewOf(m) {
  if (m.body && m.body.trim()) return (m.direction === 'outbound' ? 'You: ' : '') + m.body;
  const n = mediaList(m).length;
  if (!n) return '';
  const vid = mediaList(m).some(x => String(x.type || '').startsWith('video'));
  return vid ? 'Video' : 'Photo';
}

export function Media({ item }) {
  const type = String(item.type || '');
  if (item.failed || !item.url) {
    return <div style={{ fontSize: 12, fontStyle: 'italic', opacity: 0.8, padding: '4px 0' }}>Attachment could not be saved</div>;
  }
  if (type.startsWith('video')) {
    return <video src={item.url} controls playsInline preload="metadata" style={{ display: 'block', maxWidth: '100%', borderRadius: 12, marginTop: 4 }} />;
  }
  if (type.startsWith('image')) {
    return (
      <a href={item.url} target="_blank" rel="noreferrer">
        <img src={item.url} alt="" loading="lazy" style={{ display: 'block', maxWidth: '100%', borderRadius: 12, marginTop: 4 }} />
      </a>
    );
  }
  return <a href={item.url} target="_blank" rel="noreferrer" style={{ color: 'inherit', fontSize: 13 }}>Attachment</a>;
}

// The bubbles plus the reply box. `messages` is this conversation, oldest first.
function Thread({ messages: rawMessages, phone, canReply, onSent, height }) {
  const messages = Array.isArray(rawMessages) ? rawMessages.filter(Boolean) : [];
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState('');
  const scrollRef = useRef(null);

  // Scroll the thread's own box only. scrollIntoView also scrolls every
  // ancestor, including the invoice form's overflow:hidden tab track, which
  // slides the whole panel out of view.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  const send = async () => {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true); setErr('');
    try {
      const { data } = await supabase.auth.getSession();
      const token = data?.session?.access_token;
      if (!token) throw new Error('Signed out. Sign in again.');
      const res = await fetch(api('/api/sms-inbound'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ to: phone, body }),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(out.error || `Send failed (${res.status})`);
      setText('');
      onSent?.();
    } catch (e) {
      setErr(String(e.message || e));
    } finally {
      setSending(false);
    }
  };

  let prev = null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: height || 'auto', minHeight: 0 }}>
      <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: '12px 12px 4px', display: 'flex', flexDirection: 'column', gap: 4, background: '#fff' }}>
        {messages.length === 0 && <div style={{ textAlign: 'center', color: '#8899bb', fontSize: 13, padding: 24 }}>No messages yet.</div>}
        {messages.map(m => {
          const out = m.direction === 'outbound';
          const t = new Date(m.created_at).getTime();
          const showStamp = Number.isFinite(t) && (prev === null || t - prev > HOUR);
          if (Number.isFinite(t)) prev = t;
          return (
            <div key={m.id ?? m.created_at} style={{ display: 'flex', flexDirection: 'column' }}>
              {showStamp && <div style={{ textAlign: 'center', fontSize: 11, color: '#8899bb', margin: '10px 0 6px' }}>{stamp(m.created_at)}</div>}
              <div style={{
                alignSelf: out ? 'flex-end' : 'flex-start', maxWidth: '80%',
                background: out ? BLUE : '#e5e5ea', color: out ? '#fff' : '#111',
                borderRadius: 18, borderBottomRightRadius: out ? 5 : 18, borderBottomLeftRadius: out ? 18 : 5,
                padding: '8px 12px', fontSize: 15, lineHeight: 1.3, wordBreak: 'break-word', whiteSpace: 'pre-wrap',
              }}>
                {mediaList(m).map((x, i) => <Media key={i} item={x} />)}
                {typeof m.body === 'string' && m.body.trim() ? <div style={mediaList(m).length ? { marginTop: 6 } : null}>{m.body}</div> : null}
              </div>
            </div>
          );
        })}
      </div>
      {canReply ? (
        <div style={{ borderTop: '1px solid #e5e7ee', background: '#f6f7fa', padding: 8 }}>
          {err && <div style={{ color: '#cc3333', fontSize: 12, padding: '0 4px 6px' }}>{err}</div>}
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
            <textarea
              value={text} onChange={e => setText(e.target.value)} rows={1} placeholder="Text message"
              style={{ flex: 1, resize: 'none', border: '1px solid #cfd4e0', borderRadius: 18, padding: '9px 12px', fontSize: 16, fontFamily: 'inherit', maxHeight: 110, outline: 'none' }}
            />
            <button onClick={send} disabled={sending || !text.trim()} style={{ background: BLUE, color: '#fff', border: 'none', borderRadius: 18, padding: '9px 16px', fontWeight: 700, fontSize: 14, cursor: 'pointer', opacity: sending || !text.trim() ? 0.5 : 1 }}>
              {sending ? '...' : 'Send'}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

// One client's thread, loaded on its own. Used in the client profile and the
// estimate/invoice Messages tab. `client` is the app's client record.
function ClientThreadInner({ client, canReply, height = 420, onRead }) {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');

  const clientRef = useRef(client);
  clientRef.current = client;
  const load = useCallback(async () => {
    const client = clientRef.current;
    if (!client?.id) return;
    try {
      const all = await loadMessages();
      const conv = groupConversations(all, [client]).find(c => c.client?.id === client.id);
      setRows(conv || { messages: [], phone: client.phone || client.mobile, unread: 0 });
      setError('');
      const unread = (conv?.messages || []).filter(m => m.direction === 'inbound' && !m.read_at).map(m => m.id);
      if (unread.length) { await markRead(unread); onRead?.(); }
    } catch (e) { setError(String(e.message || e)); }
  }, [client?.id, onRead]);

  useEffect(() => { load(); }, [load]);

  if (error) return <div style={{ color: '#cc3333', fontSize: 13, padding: 12 }}>{error}</div>;
  if (!rows) return <div style={{ color: '#8899bb', fontSize: 13, padding: 12 }}>Loading messages...</div>;
  const phone = rows.phone || client?.mobile || client?.phone;
  return (
    <div style={{ border: '1px solid #e5e7ee', borderRadius: 12, overflow: 'hidden' }}>
      <Thread messages={rows.messages} phone={phone} canReply={canReply && !!phone} onSent={load} height={height} />
    </div>
  );
}

// A render error in a thread must never blank the app.
class ThreadBoundary extends Component {
  constructor(props) { super(props); this.state = { failed: false }; }
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(e) { console.error('[messages]', e); }
  render() {
    return this.state.failed
      ? <div style={{ color: '#cc3333', fontSize: 13, padding: 12 }}>Messages could not be shown. Close and reopen this tab.</div>
      : this.props.children;
  }
}

export function ClientThread(props) {
  return <ThreadBoundary key={props.client?.id}><ClientThreadInner {...props} /></ThreadBoundary>;
}

export default function MessagesTab({ clients, isAdmin, onUnreadChange, focus }) {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const [openKey, setOpenKey] = useState(null);

  const load = useCallback(async () => {
    try { setRows(await loadMessages()); setError(''); } catch (e) { setError(String(e.message || e)); }
  }, []);
  useEffect(() => { load(); }, [load]);
  // Refresh the open list when the app comes back to the foreground.
  useEffect(() => {
    const onVis = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [load]);

  const convs = useMemo(() => groupConversations(rows || [], clients), [rows, clients]);
  const open = convs.find(c => c.key === openKey) || null;

  const openThread = async (cv) => {
    setOpenKey(cv.key);
    const unread = cv.messages.filter(m => m.direction === 'inbound' && !m.read_at).map(m => m.id);
    if (unread.length) {
      const at = new Date().toISOString();
      setRows(r => r.map(m => unread.includes(m.id) ? { ...m, read_at: at } : m));
      await markRead(unread);
      onUnreadChange?.();
    }
  };

  // A tapped notification asks for one client's thread. Wait for the rows,
  // then open it once per request (focus.n changes on every tap).
  const handledFocus = useRef(null);
  useEffect(() => {
    if (!focus || !rows || handledFocus.current === focus.n) return;
    const d = digits10(focus.phone);
    const cv = convs.find(c => (focus.clientId && c.key === focus.clientId) || (d && digits10(c.phone) === d));
    handledFocus.current = focus.n;
    if (cv) openThread(cv);
  }, [focus, rows, convs]);

  if (!isAdmin) return <div style={{ padding: 24, color: '#8899bb', textAlign: 'center' }}>Messages are available to the owner.</div>;

  if (open) {
    const title = open.client?.name || prettyPhone(open.phone);
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100dvh - 150px)' }}>
        <div style={{ background: NAVY, padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 10 }}>
          <button onClick={() => setOpenKey(null)} style={{ background: 'none', border: 'none', color: '#fff', fontSize: 15, cursor: 'pointer', padding: 4 }}>Back</button>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ color: '#fff', fontWeight: 700, fontSize: 17, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</div>
            {open.client && <div style={{ color: '#8899bb', fontSize: 12 }}>{prettyPhone(open.phone)}</div>}
          </div>
          {open.phone && <a href={`tel:${open.phone}`} style={{ color: '#fff', fontSize: 14, textDecoration: 'none', fontWeight: 600 }}>Call</a>}
        </div>
        <Thread messages={open.messages} phone={open.phone} canReply={isAdmin && !!open.phone} onSent={load} height="100%" />
      </div>
    );
  }

  return (
    <div>
      <div style={{ padding: '14px 16px 8px', fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 22, color: NAVY }}>Messages</div>
      {error && <div style={{ color: '#cc3333', fontSize: 13, padding: '0 16px' }}>{error}</div>}
      {!rows && !error && <div style={{ color: '#8899bb', padding: 16 }}>Loading...</div>}
      {rows && convs.length === 0 && <div style={{ color: '#8899bb', padding: 24, textAlign: 'center' }}>No text conversations yet.</div>}
      {convs.map(cv => {
        const last = cv.messages[cv.messages.length - 1];
        return (
          <button key={cv.key} onClick={() => openThread(cv)} style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', background: '#fff', border: 'none', borderBottom: '1px solid #eef0f5', padding: '12px 16px', textAlign: 'left', cursor: 'pointer' }}>
            <div style={{ width: 10, flexShrink: 0 }}>
              {cv.unread > 0 && <div style={{ width: 10, height: 10, borderRadius: 5, background: BLUE }} />}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <span style={{ fontWeight: cv.unread ? 800 : 600, fontSize: 16, color: NAVY, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {cv.client?.name || prettyPhone(cv.phone)}
                </span>
                <span style={{ fontSize: 12, color: '#8899bb', flexShrink: 0 }}>{relTime(last.created_at)}</span>
              </div>
              <div style={{ fontSize: 14, color: cv.unread ? NAVY : '#778', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginTop: 2 }}>
                {previewOf(last)}
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}
