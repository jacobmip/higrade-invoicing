import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL || 'https://cwhgcxxszyvevjpbnnkc.supabase.co'
const key = import.meta.env.VITE_SUPABASE_ANON_KEY || ''

export const supabase = createClient(url, key)
