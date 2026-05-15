// src/invoiceDrafts.js
// Invoice draft auto-save / resume API.
// Persists in-progress invoices to localStorage immediately and syncs to
// Supabase (invoice_drafts table) when connectivity is available.
//
// Schema (Supabase table invoice_drafts):
//   id            uuid primary key
//   user_id       uuid (RLS-scoped)
//   invoice_number text
//   client_name    text
//   total          numeric
//   payload        jsonb       full invoice form state
//   finalized      boolean     true once converted to a real invoice
//   created_at     timestamptz
//   updated_at     timestamptz

import { supabase } from './supabase.js';

const LS_KEY = 'higrade_invoice_drafts_v1';

function uuid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'd_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function readLocal() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}
function writeLocal(map) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(map)); } catch {}
}

function summarize(form) {
  return {
    invoice_number: form?.invoice_number || form?.number || '',
    client_name: form?.client_name || form?.client || '',
    total: typeof form?.total === 'number' ? form.total : Number(form?.total) || 0,
  };
}

/**
 * Upsert a draft. Returns the draft id (creates one if not provided).
 * Safe to call frequently (debounced 800ms by the caller).
 */
export async function upsertDraft(form, { id } = {}) {
  const draftId = id || form?.draft_id || uuid();
  const now = new Date().toISOString();
  const summary = summarize(form);
  const record = {
    id: draftId,
    ...summary,
    payload: form,
    finalized: false,
    updated_at: now,
  };

  // 1) Local-first (works offline)
  const map = readLocal();
  map[draftId] = { ...map[draftId], ...record, created_at: map[draftId]?.created_at || now };
  writeLocal(map);

  // 2) Best-effort Supabase sync
  try {
    if (supabase) {
      const { error } = await supabase
        .from('invoice_drafts')
        .upsert(record, { onConflict: 'id' });
      if (error) console.warn('[invoiceDrafts] upsert sync failed', error.message);
    }
  } catch (e) {
    console.warn('[invoiceDrafts] upsert sync threw', e);
  }
  return draftId;
}

/**
 * Mark a draft as finalized (when its invoice is sent/saved as real).
 */
export async function finalizeDraft(id) {
  if (!id) return;
  const map = readLocal();
  if (map[id]) { map[id].finalized = true; writeLocal(map); }
  try {
    if (supabase) {
      await supabase.from('invoice_drafts')
        .update({ finalized: true, updated_at: new Date().toISOString() })
        .eq('id', id);
    }
  } catch (e) { console.warn('[invoiceDrafts] finalize failed', e); }
}

/**
 * Permanently delete a draft (user-initiated discard).
 */
export async function discardDraft(id) {
  if (!id) return;
  const map = readLocal();
  delete map[id];
  writeLocal(map);
  try {
    if (supabase) {
      await supabase.from('invoice_drafts').delete().eq('id', id);
    }
  } catch (e) { console.warn('[invoiceDrafts] discard failed', e); }
}

/**
 * List drafts, merging local + remote, newest first.
 * options.unfinalizedOnly: filter out finalized drafts.
 */
export async function listDrafts({ unfinalizedOnly = true } = {}) {
  const local = Object.values(readLocal());
  let remote = [];
  try {
    if (supabase) {
      const { data, error } = await supabase
        .from('invoice_drafts')
        .select('*')
        .order('updated_at', { ascending: false });
      if (!error && Array.isArray(data)) remote = data;
    }
  } catch (e) { console.warn('[invoiceDrafts] list remote failed', e); }

  const byId = new Map();
  for (const r of local) byId.set(r.id, r);
  for (const r of remote) {
    const cur = byId.get(r.id);
    if (!cur || new Date(r.updated_at) > new Date(cur.updated_at || 0)) {
      byId.set(r.id, r);
    }
  }
  let out = Array.from(byId.values());
  if (unfinalizedOnly) out = out.filter((r) => !r.finalized);
  out.sort((a, b) => new Date(b.updated_at || 0) - new Date(a.updated_at || 0));
  return out;
}

/**
 * Fetch a single draft by id (local first, then remote).
 */
export async function getDraft(id) {
  if (!id) return null;
  const map = readLocal();
  if (map[id]) return map[id];
  try {
    if (supabase) {
      const { data, error } = await supabase
        .from('invoice_drafts').select('*').eq('id', id).maybeSingle();
      if (!error) return data || null;
    }
  } catch (e) { console.warn('[invoiceDrafts] getDraft failed', e); }
  return null;
}
