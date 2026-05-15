// src/draftsAutoBridge.js
//
// Side-effect module imported once from main.jsx. It provides a global
// helper window.higradeDrafts.save(form) that the rest of the app can call
// to persist an in-progress invoice to the new invoice_drafts table
// (local-first + Supabase sync) without requiring deep refactors of App.jsx.
//
// It also installs a pagehide / visibilitychange listener that flushes the
// last-known form snapshot so a sudden phone lock or app background does not
// lose work.
//
// The Phase 2 UI wiring (banner mount, More-sheet entry, finalize call) can
// be added incrementally; this bridge is the foundation and is safe to ship
// on its own — it has zero effect until something calls window.higradeDrafts.

import * as drafts from './invoiceDrafts.js';

const state = {
  lastForm: null,
  lastId: null,
  debounceTimer: null,
};

function scheduleSave(form, { immediate = false } = {}) {
  state.lastForm = form;
  if (state.debounceTimer) {
    clearTimeout(state.debounceTimer);
    state.debounceTimer = null;
  }
  const run = async () => {
    state.debounceTimer = null;
    try {
      const id = await drafts.upsertDraft(state.lastForm, { id: state.lastId });
      state.lastId = id;
    } catch (e) {
      console.warn('[draftsAutoBridge] save failed', e);
    }
  };
  if (immediate) {
    run();
  } else {
    state.debounceTimer = setTimeout(run, 800);
  }
}

async function flush() {
  if (state.debounceTimer) {
    clearTimeout(state.debounceTimer);
    state.debounceTimer = null;
  }
  if (state.lastForm) {
    try {
      const id = await drafts.upsertDraft(state.lastForm, { id: state.lastId });
      state.lastId = id;
    } catch (e) {
      console.warn('[draftsAutoBridge] flush failed', e);
    }
  }
}

function setActiveDraft(id) { state.lastId = id || null; }
function clearActiveDraft() {
  state.lastForm = null;
  state.lastId = null;
  if (state.debounceTimer) {
    clearTimeout(state.debounceTimer);
    state.debounceTimer = null;
  }
}

async function finalize(id) {
  const useId = id || state.lastId;
  if (!useId) return;
  try { await drafts.finalizeDraft(useId); } catch (e) { console.warn(e); }
  clearActiveDraft();
}

async function discard(id) {
  const useId = id || state.lastId;
  if (!useId) return;
  try { await drafts.discardDraft(useId); } catch (e) { console.warn(e); }
  clearActiveDraft();
if (typeof window !== 'undefined') {
  window.higradeDrafts = {
    save: (form) => scheduleSave(form),
    saveNow: (form) => scheduleSave(form, { immediate: true }),
    flush,
    setActive: setActiveDraft,
    clear: clearActiveDraft,
    finalize,
    discard,
    list: (opts) => drafts.listDrafts(opts),
    get: (id) => drafts.getDraft(id),
  };

  // Flush on background / page-hide so phone-lock does not lose work.
  window.addEventListener('pagehide', () => { flush(); });
  window.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush();
  });
}

export { scheduleSave, flush, setActiveDraft, clearActiveDraft, finalize, discard };
