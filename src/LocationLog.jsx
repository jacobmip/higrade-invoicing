// Location tab (admin-only): every row of public.on_my_way_pings, a one-shot
// GPS stamp logged whenever a tech presses "On My Way" (migration 131). Not
// live tracking — see TeamMap.jsx / ActivityBits.jsx for that. This is a
// per-press audit log: where was he, and when, for this specific dispatch.

import { useEffect, useState } from 'react';
import * as db from './db.js';

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

const chip = {
  background: '#eef1f8', color: NAVY, border: 'none', borderRadius: 10,
  padding: '3px 9px', fontSize: 11, fontWeight: 700, cursor: 'pointer',
};

export default function LocationLog({ isAdmin, users, onOpenInvoice }) {
  const [pings, setPings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    (async () => {
      const rows = await db.loadOnMyWayPings();
      if (cancelled) return;
      setPings(rows);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [isAdmin]);

  if (!isAdmin) return null;

  const nameFor = (techId) => (users || []).find(u => u.id === techId)?.displayName || 'Unknown';

  return (
    <div style={{ padding: 12 }}>
      <div style={{ fontSize: 12, color: '#8899bb', padding: '0 4px 10px' }}>
        Logged every time a tech presses "On My Way" — where he was, at that moment. Not live tracking.
      </div>
      {loading && <div style={{ color: '#777', fontSize: 13, padding: 12 }}>Loading…</div>}
      {error && <div style={{ color: '#b03a2e', fontSize: 13, padding: 12 }}>Could not load: {error}</div>}
      {!loading && !error && !pings.length && <div style={{ color: '#777', fontSize: 13, padding: 12 }}>No pings yet.</div>}
      {pings.map(p => (
        <div key={p.id} style={{ background: '#fff', border: '1px solid #e3e7f0', borderRadius: 10, padding: '10px 12px', marginBottom: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <span style={{ fontWeight: 700, color: NAVY, fontSize: 14 }}>{nameFor(p.tech_id)}</span>
            <span style={{ fontSize: 12, color: '#777' }}>{fmtWhen(p.created_at)}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 }}>
            {p.invoice_id && onOpenInvoice && (
              <button type="button" style={chip} onClick={() => onOpenInvoice(p.invoice_id)}>{p.invoice_id}</button>
            )}
            <a
              href={`https://www.google.com/maps?q=${p.lat},${p.lng}`}
              target="_blank" rel="noreferrer"
              style={{ ...chip, textDecoration: 'none', display: 'inline-block', background: '#e8f1fb', color: BLUE }}
            >
              View on Map
            </a>
          </div>
        </div>
      ))}
    </div>
  );
}
