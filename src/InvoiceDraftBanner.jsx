import React, { useEffect, useState } from 'react';
import * as drafts from './invoiceDrafts.js';

/**
 * InvoiceDraftBanner
 * Shows a persistent resume prompt at the top of the invoice editor
 * when an unfinalized draft exists in local storage / Supabase.
 *
 * Props:
 *  - currentDraftId: string | null   active draft id being edited (suppresses banner)
 *  - onResume: (draft) => void       called when user taps Resume
 *  - onDiscard: (draftId) => void    called when user taps Discard
 */
export default function InvoiceDraftBanner({ currentDraftId, onResume, onDiscard }) {
  const [latest, setLatest] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await drafts.listDrafts({ unfinalizedOnly: true });
        if (cancelled) return;
        const top = Array.isArray(list) && list.length ? list[0] : null;
        setLatest(top);
      } catch (e) {
        console.warn('[InvoiceDraftBanner] listDrafts failed', e);
      }
    })();
    return () => { cancelled = true; };
  }, [currentDraftId]);

  if (!latest) return null;
  if (currentDraftId && latest.id === currentDraftId) return null;

  const label = latest.client_name || latest.invoice_number || 'Untitled invoice';
  const when = latest.updated_at ? new Date(latest.updated_at).toLocaleString() : '';

  return (
    <div style={{
      background: '#E8622A', color: '#fff', padding: '10px 14px',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      borderRadius: 6, margin: '8px 0', fontSize: 14,
    }}>
      <div>
        <strong>Unfinished invoice:</strong> {label}
        {when ? <span style={{ opacity: 0.85, marginLeft: 8 }}>({when})</span> : null}
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try { onResume && onResume(latest); } finally { setBusy(false); }
          }}
          style={{ background: '#fff', color: '#0a1628', border: 'none', padding: '6px 12px', borderRadius: 4, cursor: 'pointer', fontWeight: 600 }}
        >Resume</button>
        <button
          disabled={busy}
          onClick={async () => {
            if (!confirm('Discard this unfinished invoice?')) return;
            setBusy(true);
            try {
              await drafts.discardDraft(latest.id);
              onDiscard && onDiscard(latest.id);
              setLatest(null);
            } finally { setBusy(false); }
          }}
          style={{ background: 'transparent', color: '#fff', border: '1px solid #fff', padding: '6px 12px', borderRadius: 4, cursor: 'pointer' }}
        >Discard</button>
      </div>
    </div>
  );
}
