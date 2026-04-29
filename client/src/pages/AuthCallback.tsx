import { useEffect, useState } from 'react';
import { useLocation } from 'wouter';
import { supabase } from '@/lib/supabase';
import { Loader2, CheckCircle, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function AuthCallback() {
  const [, setLocation] = useLocation();
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const handleAuthCallback = async () => {
      try {
        const hashParams = new URLSearchParams(window.location.hash.substring(1));
        const accessToken = hashParams.get('access_token');
        const refreshToken = hashParams.get('refresh_token');
        
        if (accessToken && refreshToken) {
          const { error: sessionError } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });
          
          if (sessionError) {
            console.error('Session error:', sessionError);
            setError(sessionError.message);
            setStatus('error');
            return;
          }
        }

        const { data: { session }, error: getSessionError } = await supabase.auth.getSession();
        
        if (getSessionError) {
          console.error('Get session error:', getSessionError);
          setError(getSessionError.message);
          setStatus('error');
          return;
        }

        if (session) {
          // Save device session for future auto-login
          try {
            const resp = await fetch("/api/auth/save-device", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${session.access_token}`,
              },
              body: JSON.stringify({
                deviceInfo: {
                  userAgent: navigator.userAgent,
                  platform: navigator.platform,
                  language: navigator.language,
                  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                  timestamp: new Date().toISOString(),
                }
              }),
            });
            if (resp.ok) {
              const data = await resp.json();
              localStorage.setItem("lernory_device_token", data.deviceToken);
              if (data.lenoryId) localStorage.setItem("lernory_user_id", data.lenoryId);
            }
          } catch {}
          
          setStatus('success');
          setTimeout(() => {
            setLocation('/dashboard');
          }, 1000);
        } else {
          const params = new URLSearchParams(window.location.search);
          const errorParam = params.get('error');
          const errorDescription = params.get('error_description');
          
          if (errorParam) {
            setError(errorDescription || errorParam);
            setStatus('error');
          } else {
            setError('No session found. Please try logging in again.');
            setStatus('error');
          }
        }
      } catch (err) {
        console.error('Auth callback error:', err);
        setError(err instanceof Error ? err.message : 'Authentication failed');
        setStatus('error');
      }
    };

    handleAuthCallback();
  }, [setLocation]);

  if (status === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <Loader2 className="w-12 h-12 animate-spin text-primary mx-auto mb-4" />
          <p className="text-lg font-medium">Completing sign in...</p>
          <p className="text-sm text-muted-foreground mt-2">Please wait while we verify your credentials</p>
        </div>
      </div>
    );
  }

  if (status === 'success') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <CheckCircle className="w-12 h-12 text-green-500 mx-auto mb-4" />
          <p className="text-lg font-medium">Sign in successful!</p>
          <p className="text-sm text-muted-foreground mt-2">Redirecting to dashboard...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="text-center max-w-md px-4">
        <XCircle className="w-12 h-12 text-destructive mx-auto mb-4" />
        <h1 className="text-xl font-bold mb-2">Authentication Error</h1>
        <p className="text-muted-foreground mb-6">{error}</p>
        <div className="flex flex-col gap-3">
          <Button
            onClick={() => setLocation('/login')}
            data-testid="button-try-again"
          >
            Try Again
          </Button>
          <Button
            variant="ghost"
            onClick={() => setLocation('/')}
            data-testid="button-go-home"
          >
            Go to Homepage
          </Button>
        </div>
      </div>
    </div>
  );
}
