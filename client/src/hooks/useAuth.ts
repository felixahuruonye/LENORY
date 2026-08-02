import { useState, useEffect, useCallback } from 'react';
import { useQueryClient } from "@tanstack/react-query";
import { 
  supabase, 
  signInWithGoogle as supabaseGoogleSignIn, 
  signOut as supabaseSignOut,
  signInWithEmail,
  signUpWithEmail,
  resetPassword,
  getSession,
  getUser
} from '@/lib/supabase';
import type { User } from "@shared/schema";

// Build a User object directly from Supabase Auth session data (no DB call needed)
const ADMIN_EMAIL = "felixahuruonye@gmail.com";
function userFromAuth(authUser: any): User {
  const meta = authUser.user_metadata || {};
  const fullName = meta.full_name || meta.name || '';
  const nameParts = fullName.split(' ');
  const now = new Date();
  const email = authUser.email || '';
  return {
    id: authUser.id,
    email,
    firstName: nameParts[0] || meta.firstName || '',
    lastName: nameParts.slice(1).join(' ') || meta.lastName || '',
    profileImageUrl: meta.avatar_url || meta.picture || '',
    role: 'student',
    schoolId: null,
    // Admin account always sees the Premium experience for testing all tiered features
    subscriptionTier: email === ADMIN_EMAIL ? 'premium' : (meta.subscription_tier || 'free'),
    subscriptionExpiresAt: null,
    paystackCustomerId: null,
    lenoryId: meta.lenory_id || null,
    createdAt: now,
    updatedAt: now,
  };
}

// Fetch the real user record from our database — this is the ONLY source of
// truth for subscriptionTier. Retries once on failure instead of silently
// giving up, since a single failed fetch previously meant the user was stuck
// seeing stale/wrong tier data (from Supabase Auth metadata) for the entire
// session with no way to recover except a hard refresh.
async function fetchServerProfile(userId: string, accessToken: string, attempt = 1): Promise<Partial<User> | null> {
  try {
    const resp = await fetch('/api/auth/user', {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(8000),
    });
    if (resp.ok) {
      const data = await resp.json();
      if (data?.id) return data as Partial<User>;
    }
  } catch {}
  if (attempt < 2) {
    await new Promise((r) => setTimeout(r, 800));
    return fetchServerProfile(userId, accessToken, attempt + 1);
  }
  return null;
}

export function useAuth() {
  const queryClient = useQueryClient();
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;

    const initAuth = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!isMounted) return;
        if (session?.user) {
          // Paint instantly from auth metadata so the UI isn't blank...
          setUser(userFromAuth(session.user));
          // ...but the tier/plan shown is not trustworthy until this resolves.
          // This was the root cause of "payment fixed in the database but the
          // app still shows free everywhere": the old code treated the
          // metadata guess as good enough and only patched it in the
          // background, best-effort, with no retry — so a single slow or
          // failed request left the user permanently stuck on stale data.
          const serverProfile = await fetchServerProfile(session.user.id, session.access_token);
          if (isMounted) {
            if (serverProfile) {
              setUser(prev => prev ? { ...prev, ...serverProfile } : prev);
            }
            setIsLoading(false);
          }
          return;
        }
      } catch (err: any) {
        console.warn('Auth init error:', err?.message);
      } finally {
        if (isMounted) setIsLoading(false);
      }
    };

    initAuth();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (!isMounted) return;

      if ((event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') && session?.user) {
        setUser(userFromAuth(session.user));
        const serverProfile = await fetchServerProfile(session.user.id, session.access_token);
        if (isMounted) {
          if (serverProfile) {
            setUser(prev => prev ? { ...prev, ...serverProfile } : prev);
          }
          setIsLoading(false);
        }
      } else if (event === 'SIGNED_OUT') {
        setUser(null);
        setIsLoading(false);
        queryClient.clear();
      }
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, [queryClient]);

  const signInWithGoogle = useCallback(async () => {
    const { error } = await supabaseGoogleSignIn();
    return { error: error ? new Error(error.message) : null };
  }, []);

  const signOut = useCallback(async () => {
    const { error } = await supabaseSignOut();
    if (!error) {
      setUser(null);
      localStorage.removeItem('lernory_device_token');
      localStorage.removeItem('lernory_user_id');
      queryClient.clear();
    }
    return { error: error ? new Error(error.message) : null };
  }, [queryClient]);

  // ─── NEW: Email/Password Auth Functions ──────────────────
  const signIn = useCallback(async (email: string, password: string) => {
    const { data, error } = await signInWithEmail(email, password);
    if (error) {
      return { user: null, error: new Error(error.message) };
    }
    return { user: data.user, error: null };
  }, []);

  const signUp = useCallback(async (email: string, password: string, metadata?: any) => {
    const { data, error } = await signUpWithEmail(email, password, metadata);
    if (error) {
      return { user: null, error: new Error(error.message) };
    }
    return { user: data.user, error: null };
  }, []);

  const resetPasswordRequest = useCallback(async (email: string) => {
    const { error } = await resetPassword(email);
    return { error: error ? new Error(error.message) : null };
  }, []);

  const refetchUser = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) return;
    const serverProfile = await fetchServerProfile(session.user.id, session.access_token);
    if (serverProfile) {
      setUser(prev => prev ? { ...prev, ...serverProfile } : userFromAuth(session.user));
    }
  }, []);

  return {
    user,
    isLoading,
    isAuthenticated: !!user,
    signInWithGoogle,
    signOut,
    signIn,
    signUp,
    resetPassword: resetPasswordRequest,
    refetchUser,
  };
}
