import { useState, useEffect, useCallback } from 'react';
import { useQueryClient } from "@tanstack/react-query";
import { supabase, signInWithGoogle as supabaseGoogleSignIn, signOut as supabaseSignOut } from '@/lib/supabase';
import type { User } from "@shared/schema";

// Build a User object directly from Supabase Auth session data (no DB call needed)
function userFromAuth(authUser: any): User {
  const meta = authUser.user_metadata || {};
  const fullName = meta.full_name || meta.name || '';
  const nameParts = fullName.split(' ');
  const now = new Date();
  return {
    id: authUser.id,
    email: authUser.email || '',
    firstName: nameParts[0] || meta.firstName || '',
    lastName: nameParts.slice(1).join(' ') || meta.lastName || '',
    profileImageUrl: meta.avatar_url || meta.picture || '',
    role: 'student',
    schoolId: null,
    subscriptionTier: meta.subscription_tier || 'free',
    subscriptionExpiresAt: null,
    paystackCustomerId: null,
    lernoryId: meta.lernory_id || null,
    createdAt: now,
    updatedAt: now,
  };
}

// Attempt to enrich profile from local API (non-blocking, best-effort)
async function tryFetchServerProfile(userId: string, accessToken: string): Promise<Partial<User> | null> {
  try {
    const resp = await fetch('/api/auth/user', {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(4000),
    });
    if (resp.ok) {
      const data = await resp.json();
      if (data?.id) return data as Partial<User>;
    }
  } catch {}
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
          // Set user immediately from auth data
          setUser(userFromAuth(session.user));
          setIsLoading(false);
          // Enrich in background from server profile
          tryFetchServerProfile(session.user.id, session.access_token).then(serverProfile => {
            if (isMounted && serverProfile) {
              setUser(prev => prev ? { ...prev, ...serverProfile } : prev);
            }
          });
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
        // Set user instantly from auth data
        setUser(userFromAuth(session.user));
        setIsLoading(false);
        // Enrich in background
        tryFetchServerProfile(session.user.id, session.access_token).then(serverProfile => {
          if (isMounted && serverProfile) {
            setUser(prev => prev ? { ...prev, ...serverProfile } : prev);
          }
        });
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

  return {
    user,
    isLoading,
    isAuthenticated: !!user,
    signInWithGoogle,
    signOut,
  };
}
