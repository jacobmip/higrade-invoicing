// invoiceDrafts.js
// Standalone helper module for invoice draft auto-save & resume.
// Imported on demand from App.jsx. Safe to ship even if not yet wired in.
//
// Backed by:
//   - public.invoice_drafts (Supabase) for cross-device sync
//   - localStorage for offline / pre-auth scratch
//
// Schema-compatible with supabase/migrations/20260514_invoice_drafts.sql

import { supabase } from './supabase.js';

const LS_PREFIX = 'higrade_invoice_draft_v1::';
const LS_QUEUE  = 'higrade_invoice_draft_queue_v1';
const DEVICE_KEY = 'higrade_device_id_v1';

function getDeviceId() {
  try {
    let id = localStorage.getItem(DEVICE_KEY);
    if (!id) {
      id = (crypto?.randomUUID?.() || String(Date.now()) + '-' + Math.random().toString(36).slice(2));
      localStorage.setItem(DEVICE_KEY, id);
    }
    return id;
  } catch { return 'unknown'; }
}

function lsKey(draftId) { return LS_PREFIX + draftId; }

export function readLocalDraft(draftId) {
  try {
    const raw = localStorage.getItem(lsKey(draftId));
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

export function writeLocalDraft(draftId, draft) {
  try { localStorage.setItem(lsKey(draftId), JSON.stringify(draft)); } catch {}
}

export function listLocalDrafts() {
  const out = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(LS_PREFIX)) {
        const v = JSON.parse(localStorage.getItem(k) || 'null');
        if (v) out.push(v);
      }
    }
  } catch {}
  return out.sort((a,b) => (b.updated_at||0) - (a.updated_at||0));
}

export function deleteLocalDraft(draftId) {
  try { localStorage.removeItem(lsKey(draftId)); } catch {}
}

// Offline queue of pending upserts
function readQueue() {
  try { return JSON.parse(localStorage.getItem(LS_QUEUE) || '[]'); } catch { return []; }
}
function writeQueue(q) {
  try { localStorage.setItem(LS_QUEUE, JSON.stringify(q)); } catch {}
}
function enqueue(item) {
  const q = readQueue();
  // de-dupe by draft id, keep latest
  const filtered = q.filter(x => x.id !== item.id);
  filtered.push(item);
  writeQueue(filtered);
}

export async function flushQueue() {
  const q = readQueue();
  if (!q.length) return { ok: true, flushed: 0 };
  let flushed = 0;
  for (const item of q) {
    try {
      const { error } = await supabase.from('invoice_drafts').upsert(item, { onConflict: 'id' });
      if (!error) flushed++;
    } catch {}
  }
  writeQueue([]);
  return { ok: true, flushed };
}

// upsertDraft: write to Supabase if online, else queue locally.
// Always writes to localStorage as the source-of-truth for the current tab.
export async function upsertDraft({ id, invoice_id = null, client_id = null, title = null, payload, client_rev = 0 }) {
  const now = Date.now();
  const device_id = getDeviceId();
  const row = { id, invoice_id, client_id, title, payload, client_rev, device_id };

  // 1. Local cache
  writeLocalDraft(id, { ...row, updated_at: now });

  // 2. Get user_id (RLS requires it on insert)
  let user_id = null;
  try {
    const { data } = await supabase.auth.getUser();
    user_id = data?.user?.id || null;
  } catch {}

  if (!user_id) {
    // Not signed in yet: just keep local copy.
    return { ok: true, local: true };
  }

  const remoteRow = { ...row, user_id };

  if (!navigator.onLine) {
    enqueue(remoteRow);
    return { ok: true, queued: true };
  }

  try {
    const { error } = await supabase.from('invoice_drafts').upsert(remoteRow, { onConflict: 'id' });
    if (error) {
      enqueue(remoteRow);
      return { ok: false, queued: true, error };
    }
    return { ok: true, remote: true };
  } catch (error) {
    enqueue(remoteRow);
    return { ok: false, queued: true, error };
  }
}

export async function listRemoteDrafts({ limit = 50 } = {}) {
  const { data, error } = await supabase
    .from('invoice_drafts')
    .select('id, invoice_id, client_id, title, payload, client_rev, device_id, updated_at, created_at')
    .order('updated_at', { ascending: false })
    .limit(limit);
  if (error) return { ok: false, error, drafts: [] };
  return { ok: true, drafts: data || [] };
}

export async function getRemoteDraft(id) {
  const { data, error } = await supabase
    .from('invoice_drafts')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) return { ok: false, error };
  return { ok: true, draft: data };
}

export async function deleteDraft(id) {
  deleteLocalDraft(id);
  try {
    const { error } = await supabase.from('invoice_drafts').delete().eq('id', id);
    if (error) return { ok: false, error };
  } catch (error) { return { ok: false, error }; }
  return { ok: true };
}

// Debounced autosave helper. Usage:
//   const save = makeAutosave({ getDraft });
//   save();   // call on every keystroke; will fire ~800ms after the last call.
export function makeAutosave({ getDraft, delay = 800 }) {
  let t = null;
  let rev = 0;
  return function trigger() {
    if (t) clearTimeout(t);
    t = setTimeout(async () => {
      const d = getDraft();
      if (!d || !d.id) return;
      rev += 1;
      await upsertDraft({ ...d, client_rev: rev });
    }, delay);
  };
}

// Wire up window 'online' to flush the queue automatically.
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => { flushQueue(); });
}

export const _internal = { getDeviceId, readQueue, writeQueue };
