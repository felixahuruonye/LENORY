// client/src/lib/supabase.ts
import { createClient } from '@supabase/supabase-js';

// These are PUBLIC keys - safe to expose in client
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('Missing Supabase environment variables!');
}

// This is the CLIENT-SIDE instance - uses ANON key only
export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// DO NOT export supabaseAdmin from here!
// The admin client stays in server/ folder ONLY