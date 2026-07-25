// client/src/lib/supabase.ts
import { createClient } from '@supabase/supabase-js';

// These are PUBLIC keys - safe to expose in client
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('❌ Missing Supabase environment variables!');
}

// This is the CLIENT-SIDE instance - uses ANON key only
export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// ─── Auth Functions ──────────────────────────────────────────

// Sign in with Google
export const signInWithGoogle = async () => {
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: `${window.location.origin}/auth/callback`,
    },
  });
  return { data, error };
};

// Sign in with email/password
export const signInWithEmail = async (email: string, password: string) => {
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });
  return { data, error };
};

// ═══ FIX: Alias for Login.tsx ════════════════════════════════
export const signInWithEmailPassword = signInWithEmail;
// ═════════════════════════════════════════════════════════════

// Sign out
export const signOut = async () => {
  const { error } = await supabase.auth.signOut();
  return { error };
};

// Sign up with email/password
export const signUpWithEmail = async (email: string, password: string, metadata?: any) => {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: metadata },
  });
  return { data, error };
};

// Reset password
export const resetPassword = async (email: string) => {
  const { data, error } = await supabase.auth.resetPasswordForEmail(email);
  return { data, error };
};

// Get current session
export const getSession = async () => {
  const { data, error } = await supabase.auth.getSession();
  return { data, error };
};

// Get current user
export const getUser = async () => {
  const { data, error } = await supabase.auth.getUser();
  return { data, error };
};

// ─── DO NOT export supabaseAdmin from here! ─────────────────
// The admin client stays in server/ folder ONLY