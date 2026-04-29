import { createClient } from '@supabase/supabase-js'

// In native builds (capacitor://) Vite env vars get baked in at build time.
// If VITE_SUPABASE_ANON_KEY is missing, calling createClient with an empty
// key throws "supabaseKey is required" and crashes the app before it can
// render — producing a white screen on iOS. To stay resilient, return a
// stub client whose every call rejects with a clear error; db.js already
// catches load failures and falls back to localStorage.
const url = import.meta.env.VITE_SUPABASE_URL || 'https://cwhgcxxszyvevjpbnnkc.supabase.co'
const key = import.meta.env.VITE_SUPABASE_ANON_KEY || ''

function stubClient(reason) {
  const err = new Error(reason)
  const queryStub = {
    select() { return this },
    insert() { return this },
    update() { return this },
    upsert() { return this },
    delete() { return this },
    eq() { return this },
    order() { return this },
    then(resolve) { resolve({ data: [], error: err }); return Promise.resolve({ data: [], error: err }) },
    catch() { return Promise.resolve({ data: [], error: err }) },
  }
  return {
    from() { return queryStub },
    auth: { getSession: async () => ({ data: { session: null }, error: err }) },
  }
}

export const supabase = key
  ? createClient(url, key)
  : (console.warn('[supabase] VITE_SUPABASE_ANON_KEY missing — using localStorage fallback only'), stubClient('Supabase not configured'))
