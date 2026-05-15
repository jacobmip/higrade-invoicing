import React, { useEffect, useState, useCallback } from 'react';
import * as drafts from './invoiceDrafts.js';

/**
 * DraftsPage
 * Lightweight list view of unfinalized invoice drafts with
 * Resume / Discard actions per row.
 *
 * Props:
 *  - onResume: (draft) => void   open the invoice editor with this draft loaded
 *  - onClose:  () => void        return to previous tab/view
 */
export default function DraftsPage({ onResume, onClose }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await drafts.listDrafts({ unfinalizedOnly: true });
      setRows(Array.isArray(list) ? list : []);
    } catch (e) {
      console.warn('[DraftsPage] listDrafts failed', e);
      setError(e && e.message ? e.message : 'Failed to load drafts');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const handleDiscard = async (id) => {
    if (!confirm('Discard this unfinished invoice? This cannot be undone.')) return;
    try {
      await drafts.discardDraft(id);
      setRows((rs) => rs.filter((r) => r.id !== id));
    } catch (e) {
      alert('Failed to discard: ' + (e && e.message ? e.message : e));
    }
  };

  return (
    <div style={{ padding: 16, maxWidth: 760, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <h2 style={{ margin: 0, color: '#0a1628' }}>Unfinished Drafts</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={refresh} style={btnSecondary}>Refresh</button>
          {onClose ? <button onClick={onClose} style={btnSecondary}>Close</button> : null}
        </div>
      </div>

      {loading && <div style={{ padding: 16, color: '#666' }}>Loading drafts...</div>}
      {error && <div style={{ padding: 12, background: '#fde2e1', color: '#8a1f1c', borderRadius: 4 }}>{error}</div>}
      {!loading && !error && rows.length === 0 && (
        <div style={{ padding: 24, textAlign: 'center', color: '#666' }}>
          No unfinished drafts. You're all caught up.
        </div>
      )}

      {rows.map((r) => {
        const label = r.client_name || r.invoice_number || 'Untitled invoice';
        const when = r.updated_at ? new Date(r.updated_at).toLocaleString() : '';
        const total = typeof r.total === 'number' ? `$${r.total.toFixed(2)}` : '';
        return (
          <div key={r.id} style={rowStyle}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, color: '#0a1628' }}>{label}</div>
              <div style={{ fontSize: 12, color: '#666' }}>
                {when}{total ? ` • ${total}` : ''}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => onResume && onResume(r)} style={btnPrimary}>Resume</button>
              <button onClick={() => handleDiscard(r.id)} style={btnDanger}>Discard</button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

const rowStyle = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  padding: '12px 14px', borderBottom: '1px solid #eee', gap: 12,
};
const btnPrimary = {
  background: '#E8622A', color: '#fff', border: 'none',
  padding: '6px 12px', borderRadius: 4, cursor: 'pointer', fontWeight: 600,
};
const btnSecondary = {
  background: '#f4f6fa', color: '#0a1628', border: '1px solid #d0d4dc',
  padding: '6px 12px', borderRadius: 4, cursor: 'pointer',
};
const btnDanger = {
  background: 'transparent', color: '#8a1f1c', border: '1px solid #8a1f1c',
  padding: '6px 12px', borderRadius: 4, cursor: 'pointer',
};
