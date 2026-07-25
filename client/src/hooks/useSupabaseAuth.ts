import { useEffect, useState } from 'react';
import { User } from '@supabase/supabase-js';
import { supabase } from '../../lib/supabase'; // This should be your CLIENT-side Supabase instance

// This file should ONLY use the ANON key client, NEVER the admin client
// The admin client stays in server/ folder only

export function useSupabaseAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      setLoading(false);
    });

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event, session) => {
        setUser(session?.user ?? null);
        setLoading(false);
      }
    );

    return () => subscription.unsubscribe();
  }, []);

  // Sign in with email/password
  const signIn = async (email: string, password: string) => {
    try {
      setError(null);
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (error) throw error;
      return { user: data.user, session: data.session, error: null };
    } catch (err: any) {
      setError(err.message);
      return { user: null, session: null, error: err.message };
    }
  };

  // Sign up with email/password
  const signUp = async (email: string, password: string, metadata?: any) => {
    try {
      setError(null);
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: metadata },
      });
      if (error) throw error;
      return { user: data.user, session: data.session, error: null };
    } catch (err: any) {
      setError(err.message);
      return { user: null, session: null, error: err.message };
    }
  };

  // Sign out
  const signOut = async () => {
    try {
      setError(null);
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
      return { error: null };
    } catch (err: any) {
      setError(err.message);
      return { error: err.message };
    }
  };

  // Reset password
  const resetPassword = async (email: string) => {
    try {
      setError(null);
      const { error } = await supabase.auth.resetPasswordForEmail(email);
      if (error) throw error;
      return { error: null };
    } catch (err: any) {
      setError(err.message);
      return { error: err.message };
    }
  };

  // UPDATE: This is the KEY change - use the ANON client, NOT admin
  // Any admin operations (like checking email existence across all users)
  // should be done via a server API endpoint, NOT client-side!
  const checkEmailExists = async (email: string) => {
    // ❌ DON'T DO THIS CLIENT-SIDE:
    // Use supabaseAdmin - THIS WOULD EXPOSE YOUR SERVICE ROLE KEY!
    
    // ✅ DO THIS INSTEAD:
    // Call your server API endpoint
    try {
      const response = await fetch('/api/auth/check-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = await response.json();
      return { exists: data.exists, error: data.error };
    } catch (err: any) {
      return { exists: false, error: err.message };
    }
  };

  return {
    user,
    loading,
    error,
    signIn,
    signUp,
    signOut,
    resetPassword,
    checkEmailExists, // Calls the server API
  };
}