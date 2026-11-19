// AI Chats tab (admin-only): every AI chat exchange in the app, from
// public.ai_chat_logs (migration 132). Who asked, on which document, what
// they typed and what the AI answered, so Jake can see how the team uses AI
// to price jobs. The table's RLS lets only an admin read it.

import { useEffect, useMemo, useState } from 'react';
import * as db from './db.js';

const NAVY = '#0a1628';

const SURFACE = { line_items: 'Line items AI', header_chat: 'AI chat', agent: 'AI agent' };

function fmtWhen(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return '';
  return d.toLocaleString('en-US', {
    timeZone: 'Pacific/Honolulu', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

// The raw reply can carry action JSON. Show the prose, then the line items it
// proposed, since prices are the point of this screen.
function itemsOf(actions) {
  const out = [];
  for (const a of Array.isArray(actions) ? actions : []) {
    if (!a || typeof a !== 'object') continue;
    const list = a.items || a.invoice?.items || (a.item ? [a.item] : []);
    for (const it of list || []) if (it?.name) out.push(it);
  }
  return out;
}

function proseOf(reply) {
  let t = String(reply || '');
  t = t.replace(/```(?:json)?[\s\S]*?```/g, '');
  // Drop bare JSON objects/arrays that start a line.
  t = t.replace(/^\s*[[{][\s\S]*?[\]}]\s*$/gm, (m) => { try { JSON.parse(m); return ''; } catch { return m; } });
  return t.trim();
}

const chip = {
  background: '#eef1f8', color: NAVY, border: 'none', borderRadius: 10,
  padding: '3px 9px', fontSize: 11, fontWeight: 700, cursor: 'pointer',
};

export default function AIChatLog({ isAdmin, users, onOpenInvoice }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [who, setWho] = useState('all');
  const [open, setOpen] = useState(null);

  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    (async () => {
      const r = await db.loadAiChatLogs();
      if (cancelled) return;
      setRows(r);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [isAdmin]);

  const nameFor = (id) => (users || []).find(u => u.id === id)?.displayName || 'Unknown';
  const people = useMemo(() => [...new Set(rows.map(r => r.user_id))], [rows]);
  const shown = who === 'all' ? rows : rows.filter(r => r.user_id === who);

  if (!isAdmin) return null;

  return (
    <div style={{ padding: 12 }}>
      <div style={{ fontSize: 12, color: '#8899bb', padding: '0 4px 10px' }}>
        Every AI chat in the app: who asked, on which job, and what it priced. Only admins can see this.
      </div>
      {people.length > 1 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', padding: '0 4px 10px' }}>
          {['all', ...people].map(id => (
            <button key={id} type="button" onClick={() => setWho(id)}
              style={{ ...chip, background: who === id ? NAVY : '#eef1f8', color: who === id ? '#fff' : NAVY }}>
              {id === 'all' ? `Everyone (${rows.length})` : `${nameFor(id)} (${rows.filter(r => r.user_id === id).length})`}
            </button>
          ))}
        </div>
      )}
      {loading && <div style={{ color: '#777', fontSize: 13, padding: 12 }}>Loading…</div>}
      {!loading && !shown.length && <div style={{ color: '#777', fontSize: 13, padding: 12 }}>No AI chats yet.</div>}
      {shown.map(r => {
        const items = itemsOf(r.actions);
        const prose = proseOf(r.reply);
        const isOpen = open === r.id;
        return (
          <div key={r.id} style={{ background: '#fff', border: '1px solid #e3e7f0', borderRadius: 10, padding: '10px 12px', marginBottom: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <span style={{ fontWeight: 700, color: NAVY, fontSize: 14 }}>{nameFor(r.user_id)}</span>
              <span style={{ fontSize: 12, color: '#777' }}>{fmtWhen(r.created_at)}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 11, color: '#8899bb', fontWeight: 700 }}>{SURFACE[r.surface] || r.surface}</span>
              {r.invoice_id && onOpenInvoice && (
                <button type="button" style={chip} onClick={() => onOpenInvoice(r.invoice_id)}>{r.invoice_id}</button>
              )}
              {r.photos > 0 && <span style={{ fontSize: 11, color: '#8899bb' }}>{r.photos} photo{r.photos === 1 ? '' : 's'}</span>}
            </div>
            <div style={{ marginTop: 8, fontSize: 13, color: NAVY, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
              <b>Asked:</b> {r.prompt || '(photo only)'}
            </div>
            {items.length > 0 && (
              <div style={{ marginTop: 6 }}>
                {items.map((it, k) => (
                  <div key={k} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 13, padding: '3px 0', borderTop: k ? '1px solid #f0f2f7' : 'none' }}>
                    <span style={{ color: '#333', overflowWrap: 'anywhere' }}>{it.qty && it.qty !== 1 ? `${it.qty} x ` : ''}{it.name}</span>
                    <span style={{ fontWeight: 700, color: NAVY, whiteSpace: 'nowrap' }}>${Number(it.price || 0).toLocaleString('en-US')}</span>
                  </div>
                ))}
              </div>
            )}
            {typeof r.actions?.[0] === 'string' && (
              <div style={{ marginTop: 6, fontSize: 12, color: '#555', overflowWrap: 'anywhere' }}>Did: {r.actions.join('; ')}</div>
            )}
            {prose && (
              <div style={{ marginTop: 6 }}>
                <div style={{ fontSize: 13, color: '#444', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', ...(isOpen ? {} : { display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }) }}>
                  <b>AI:</b> {prose}
                </div>
                {prose.length > 180 && (
                  <button type="button" onClick={() => setOpen(isOpen ? null : r.id)}
                    style={{ background: 'none', border: 'none', color: '#0070ba', fontSize: 12, padding: '4px 0', cursor: 'pointer' }}>
                    {isOpen ? 'Show less' : 'Show all'}
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
