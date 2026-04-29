import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useToast } from "@/hooks/use-toast";
import { signInWithGoogle, signInWithEmailPassword, supabase } from "@/lib/supabase";
import { Loader2, Zap, LogIn, Eye, EyeOff, Smartphone, ArrowRight, ArrowLeft, CheckCircle2, Mail } from "lucide-react";
import { SiGoogle } from "react-icons/si";
import { Link } from "wouter";

const DEVICE_TOKEN_KEY = "lernory_device_token";
const LENORY_ID_KEY = "lernory_user_id";

function getDeviceInfo() {
  return {
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    language: navigator.language,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    timestamp: new Date().toISOString(),
  };
}

// Fire-and-forget: save device token in background after successful login
async function saveDeviceInBackground(accessToken: string) {
  try {
    const resp = await fetch("/api/auth/save-device", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ deviceInfo: getDeviceInfo() }),
    });
    if (resp.ok) {
      const data = await resp.json();
      localStorage.setItem(DEVICE_TOKEN_KEY, data.deviceToken);
      if (data.lenoryId) localStorage.setItem(LENORY_ID_KEY, data.lenoryId);
    }
  } catch {}
}

type LoginView = "checking" | "trusted-device" | "active-session" | "email-login" | "lernory-id" | "confirm-email";

export default function Login() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const [view, setView] = useState<LoginView>("checking");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [lenoryId, setLenoryId] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
  const [trustedUser, setTrustedUser] = useState<{ firstName?: string; email?: string; lenoryId?: string } | null>(null);
  const [activeSessionUser, setActiveSessionUser] = useState<{ email?: string; firstName?: string } | null>(null);
  const [unconfirmedEmail, setUnconfirmedEmail] = useState("");

  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupResult, setLookupResult] = useState<{ maskedEmail: string; firstName?: string } | null>(null);
  const [lernoryPassword, setLenoryPassword] = useState("");

  useEffect(() => {
    checkAuth();
  }, []);

  async function checkAuth() {
    // 1. Check trusted device token
    const deviceToken = localStorage.getItem(DEVICE_TOKEN_KEY);
    if (deviceToken) {
      try {
        const resp = await fetch("/api/auth/verify-device", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ deviceToken }),
        });
        const data = await resp.json();
        if (data.valid) {
          const { data: { session } } = await supabase.auth.getSession();
          if (session) {
            setTrustedUser({ firstName: data.firstName, email: data.email, lenoryId: data.lenoryId });
            setView("trusted-device");
            return;
          }
        }
      } catch {}
      localStorage.removeItem(DEVICE_TOKEN_KEY);
      localStorage.removeItem(LENORY_ID_KEY);
    }

    // 2. Check for an existing active session
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
        setActiveSessionUser({
          email: session.user.email,
          firstName: session.user.user_metadata?.full_name?.split(" ")[0] ||
                     session.user.user_metadata?.name?.split(" ")[0],
        });
        setView("active-session");
        return;
      }
    } catch {}

    setView("email-login");
  }

  const handleTrustedContinue = () => setLocation("/dashboard");

  const handleActiveSessionContinue = async () => {
    setIsLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.access_token) {
        saveDeviceInBackground(session.access_token);
      }
    } catch {}
    setIsLoading(false);
    setLocation("/dashboard");
  };

  const handleSwitchAccount = async () => {
    localStorage.removeItem(DEVICE_TOKEN_KEY);
    localStorage.removeItem(LENORY_ID_KEY);
    await supabase.auth.signOut();
    setView("email-login");
  };

  const handleGoogleLogin = async () => {
    setIsGoogleLoading(true);
    try {
      const { error } = await signInWithGoogle();
      if (error) {
        toast({ title: "Login Failed", description: error.message, variant: "destructive" });
      }
      // Browser redirects to OAuth — no further action needed here
    } catch {
      toast({ title: "Error", description: "Something went wrong. Please try again.", variant: "destructive" });
    } finally {
      setIsGoogleLoading(false);
    }
  };

  const handleEmailLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      toast({ title: "Missing Fields", description: "Please enter both email and password.", variant: "destructive" });
      return;
    }
    setIsLoading(true);
    try {
      const { data, error } = await signInWithEmailPassword(email, password);

      if (error) {
        const msg = error.message.toLowerCase();
        if (msg.includes("invalid login credentials") || msg.includes("invalid email or password")) {
          toast({
            title: "Login Failed",
            description: "Incorrect email or password. New here? Create an account.",
            variant: "destructive",
          });
        } else if (msg.includes("email not confirmed")) {
          setUnconfirmedEmail(email);
          setView("confirm-email");
        } else {
          toast({ title: "Login Failed", description: error.message, variant: "destructive" });
        }
        return;
      }

      if (data?.session) {
        toast({ title: "Welcome Back!", description: "Redirecting to your dashboard..." });
        // Redirect immediately — save device in background (non-blocking)
        saveDeviceInBackground(data.session.access_token);
        setLocation("/dashboard");
      }
    } catch {
      toast({ title: "Error", description: "Something went wrong. Please try again.", variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  };

  const handleLenoryIdLookup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!lenoryId.trim()) {
      toast({ title: "Enter Lenory ID", description: "Please enter your Lenory ID (e.g. LRN-XXXXXX)", variant: "destructive" });
      return;
    }
    setLookupLoading(true);
    try {
      const resp = await fetch(`/api/auth/lernory-lookup/${lenoryId.trim().toUpperCase()}`);
      const data = await resp.json();
      if (!data.found) {
        toast({ title: "Not Found", description: "No account found with that Lenory ID.", variant: "destructive" });
        return;
      }
      setLookupResult({ maskedEmail: data.maskedEmail, firstName: data.firstName });
    } catch {
      toast({ title: "Error", description: "Could not look up Lenory ID. Try again.", variant: "destructive" });
    } finally {
      setLookupLoading(false);
    }
  };

  const handleLenoryIdLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!lookupResult || !lernoryPassword) return;
    setIsLoading(true);
    try {
      const resp = await fetch("/api/auth/lernory-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lenoryId: lenoryId.trim().toUpperCase(), password: lernoryPassword }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        toast({ title: "Login Failed", description: data.message || "Incorrect password.", variant: "destructive" });
        return;
      }
      if (data.accessToken) {
        await supabase.auth.setSession({ access_token: data.accessToken, refresh_token: data.refreshToken });
        toast({ title: `Welcome back${lookupResult.firstName ? ", " + lookupResult.firstName : ""}!` });
        saveDeviceInBackground(data.accessToken);
        setLocation("/dashboard");
      }
    } catch {
      toast({ title: "Error", description: "Something went wrong. Please try again.", variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  };

  const handleResendConfirmation = async () => {
    if (!unconfirmedEmail) return;
    try {
      const { error } = await supabase.auth.resend({ type: 'signup', email: unconfirmedEmail });
      if (error) {
        toast({ title: "Could not resend", description: error.message, variant: "destructive" });
      } else {
        toast({ title: "Email resent!", description: "Check your inbox." });
      }
    } catch {
      toast({ title: "Error", description: "Could not resend confirmation email.", variant: "destructive" });
    }
  };

  // ─── Checking session ────────────────────────────────────────────────────────
  if (view === "checking") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background via-background to-primary/5">
        <div className="flex flex-col items-center gap-4">
          <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-primary to-chart-2 flex items-center justify-center animate-pulse">
            <Zap className="h-7 w-7 text-primary-foreground" />
          </div>
          <p className="text-muted-foreground">Checking your session...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-br from-background via-background to-primary/5">
      <header className="fixed top-0 left-0 right-0 z-50 border-b bg-background/80 backdrop-blur-sm">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between">
          <Link href="/">
            <div className="flex items-center gap-2 cursor-pointer">
              <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-primary to-chart-2 flex items-center justify-center">
                <Zap className="h-5 w-5 text-primary-foreground" />
              </div>
              <span className="font-display font-bold text-xl">LENORY</span>
            </div>
          </Link>
          <ThemeToggle />
        </div>
      </header>

      <main className="flex-1 flex items-center justify-center px-4 pt-20 pb-8">

        {/* ── TRUSTED DEVICE ── */}
        {view === "trusted-device" && trustedUser && (
          <Card className="w-full max-w-md">
            <CardHeader className="text-center">
              <div className="mx-auto mb-4 h-14 w-14 rounded-full bg-gradient-to-br from-primary to-chart-2 flex items-center justify-center">
                <CheckCircle2 className="h-8 w-8 text-primary-foreground" />
              </div>
              <CardTitle className="text-2xl font-display">Welcome Back!</CardTitle>
              {trustedUser.firstName && (
                <CardDescription className="text-base">
                  Good to see you again,{" "}
                  <span className="font-semibold text-foreground">{trustedUser.firstName}</span>
                </CardDescription>
              )}
              {trustedUser.lenoryId && (
                <div className="mt-2 inline-flex items-center gap-2 bg-primary/10 text-primary text-sm font-mono px-3 py-1 rounded-md mx-auto">
                  <Smartphone className="h-3.5 w-3.5" />
                  {trustedUser.lenoryId}
                </div>
              )}
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="bg-muted/50 rounded-md px-4 py-3 text-sm text-muted-foreground text-center">
                This device is trusted. Your account is ready.
              </div>
              <Button
                size="lg"
                className="w-full bg-gradient-to-r from-primary to-chart-2 border-primary"
                onClick={handleTrustedContinue}
                data-testid="button-continue-lernory"
              >
                Continue with Lenory
                <ArrowRight className="h-4 w-4 ml-2" />
              </Button>
              <Button variant="ghost" size="lg" className="w-full" onClick={handleSwitchAccount} data-testid="button-switch-account">
                Not you? Sign in with a different account
              </Button>
            </CardContent>
          </Card>
        )}

        {/* ── ACTIVE SESSION ── */}
        {view === "active-session" && activeSessionUser && (
          <Card className="w-full max-w-md">
            <CardHeader className="text-center">
              <div className="mx-auto mb-4 h-12 w-12 rounded-xl bg-gradient-to-br from-primary to-chart-2 flex items-center justify-center">
                <Zap className="h-7 w-7 text-primary-foreground" />
              </div>
              <CardTitle className="text-2xl font-display">You're Signed In</CardTitle>
              {activeSessionUser.email && (
                <CardDescription>{activeSessionUser.email}</CardDescription>
              )}
            </CardHeader>
            <CardContent className="space-y-4">
              <Button
                size="lg"
                className="w-full bg-gradient-to-r from-primary to-chart-2 border-primary"
                onClick={handleActiveSessionContinue}
                disabled={isLoading}
                data-testid="button-continue-lernory"
              >
                {isLoading ? <Loader2 className="h-5 w-5 animate-spin mr-2" /> : <ArrowRight className="h-5 w-5 mr-2" />}
                Continue with Lenory
              </Button>
              <Button variant="ghost" className="w-full" onClick={handleSwitchAccount} data-testid="button-switch-account">
                Sign in with a different account
              </Button>
            </CardContent>
          </Card>
        )}

        {/* ── CONFIRM EMAIL ── */}
        {view === "confirm-email" && (
          <Card className="w-full max-w-md text-center">
            <CardHeader>
              <div className="mx-auto mb-4 h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center">
                <Mail className="h-8 w-8 text-primary" />
              </div>
              <CardTitle className="text-2xl font-display">Confirm Your Email</CardTitle>
              <CardDescription className="text-base mt-1">
                We sent a confirmation link to{" "}
                <span className="font-semibold text-foreground">{unconfirmedEmail}</span>
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Please click the link in that email, then come back here to log in.
              </p>
              <Button
                size="lg"
                className="w-full bg-gradient-to-r from-primary to-chart-2 border-primary"
                onClick={() => setView("email-login")}
                data-testid="button-try-login-again"
              >
                Try Logging In Again
              </Button>
              <Button variant="ghost" className="w-full text-sm" onClick={handleResendConfirmation} data-testid="button-resend-confirm">
                Resend confirmation email
              </Button>
            </CardContent>
          </Card>
        )}

        {/* ── EMAIL LOGIN ── */}
        {view === "email-login" && (
          <Card className="w-full max-w-md">
            <CardHeader className="text-center">
              <div className="mx-auto mb-4 h-12 w-12 rounded-xl bg-gradient-to-br from-primary to-chart-2 flex items-center justify-center">
                <Zap className="h-7 w-7 text-primary-foreground" />
              </div>
              <CardTitle className="text-2xl font-display">Welcome Back</CardTitle>
              <CardDescription>Log in to continue your learning journey</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <Button
                variant="outline"
                className="w-full"
                size="lg"
                onClick={handleGoogleLogin}
                disabled={isGoogleLoading}
                data-testid="button-google-login"
              >
                {isGoogleLoading ? <Loader2 className="h-5 w-5 animate-spin mr-2" /> : <SiGoogle className="h-5 w-5 mr-2" />}
                Continue with Google
              </Button>

              <div className="relative">
                <div className="absolute inset-0 flex items-center"><span className="w-full border-t" /></div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-card px-2 text-muted-foreground">Or</span>
                </div>
              </div>

              <form onSubmit={handleEmailLogin} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="Enter your email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    autoComplete="email"
                    data-testid="input-email"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="password">Password</Label>
                  <div className="relative flex items-center">
                    <Input
                      id="password"
                      type={showPassword ? "text" : "password"}
                      placeholder="Enter your password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      className="pr-10"
                      autoComplete="current-password"
                      data-testid="input-password"
                    />
                    <button
                      type="button"
                      className="absolute right-3 text-muted-foreground hover:text-foreground"
                      onClick={() => setShowPassword(!showPassword)}
                      data-testid="button-toggle-password"
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>
                <Button
                  type="submit"
                  size="lg"
                  className="w-full bg-gradient-to-r from-primary to-chart-2 border-primary"
                  disabled={isLoading}
                  data-testid="button-email-login"
                >
                  {isLoading ? <Loader2 className="h-5 w-5 animate-spin mr-2" /> : <LogIn className="h-5 w-5 mr-2" />}
                  Log In
                </Button>
              </form>

              <div className="relative">
                <div className="absolute inset-0 flex items-center"><span className="w-full border-t" /></div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-card px-2 text-muted-foreground">Or log in with</span>
                </div>
              </div>

              <Button
                variant="outline"
                className="w-full"
                onClick={() => setView("lernory-id")}
                data-testid="button-use-lernory-id"
              >
                <Smartphone className="h-4 w-4 mr-2" />
                Use my Lenory ID
              </Button>

              <p className="text-center text-sm text-muted-foreground">
                New to Lenory?{" "}
                <Link href="/signup" className="text-primary hover:underline font-medium" data-testid="link-signup">
                  Create an account
                </Link>
              </p>
            </CardContent>
          </Card>
        )}

        {/* ── LENORY ID ── */}
        {view === "lernory-id" && (
          <Card className="w-full max-w-md">
            <CardHeader className="relative">
              <Button
                variant="ghost"
                size="icon"
                className="absolute left-2 top-2"
                onClick={() => { setView("email-login"); setLookupResult(null); setLenoryId(""); setLenoryPassword(""); }}
                data-testid="button-back"
              >
                <ArrowLeft className="h-4 w-4" />
              </Button>
              <div className="text-center pt-2">
                <div className="mx-auto mb-4 h-12 w-12 rounded-xl bg-gradient-to-br from-primary to-chart-2 flex items-center justify-center">
                  <Smartphone className="h-7 w-7 text-primary-foreground" />
                </div>
                <CardTitle className="text-2xl font-display">Lenory ID Login</CardTitle>
                <CardDescription>Enter your unique Lenory ID to sign in</CardDescription>
              </div>
            </CardHeader>
            <CardContent className="space-y-6">
              {!lookupResult ? (
                <form onSubmit={handleLenoryIdLookup} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="lernory-id">Your Lenory ID</Label>
                    <Input
                      id="lernory-id"
                      type="text"
                      placeholder="e.g. LRN-AB12CD"
                      value={lenoryId}
                      onChange={(e) => setLenoryId(e.target.value.toUpperCase())}
                      className="font-mono text-center tracking-widest"
                      maxLength={10}
                      data-testid="input-lernory-id"
                    />
                    <p className="text-xs text-muted-foreground text-center">
                      Your Lenory ID can be found in your account settings
                    </p>
                  </div>
                  <Button
                    type="submit"
                    size="lg"
                    className="w-full bg-gradient-to-r from-primary to-chart-2 border-primary"
                    disabled={lookupLoading}
                    data-testid="button-lookup-lernory-id"
                  >
                    {lookupLoading && <Loader2 className="h-5 w-5 animate-spin mr-2" />}
                    Find My Account
                  </Button>
                </form>
              ) : (
                <form onSubmit={handleLenoryIdLogin} className="space-y-4">
                  <div className="bg-primary/10 rounded-md p-4 space-y-1">
                    <p className="text-sm font-medium text-foreground flex items-center gap-2">
                      <CheckCircle2 className="h-4 w-4 text-primary" />
                      Account found{lookupResult.firstName && ` — ${lookupResult.firstName}`}
                    </p>
                    <p className="text-sm text-muted-foreground font-mono pl-6">{lookupResult.maskedEmail}</p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="lernory-password">Password</Label>
                    <div className="relative flex items-center">
                      <Input
                        id="lernory-password"
                        type={showPassword ? "text" : "password"}
                        placeholder="Enter your password"
                        value={lernoryPassword}
                        onChange={(e) => setLenoryPassword(e.target.value)}
                        required
                        className="pr-10"
                        autoComplete="current-password"
                        data-testid="input-lernory-password"
                      />
                      <button
                        type="button"
                        className="absolute right-3 text-muted-foreground hover:text-foreground"
                        onClick={() => setShowPassword(!showPassword)}
                      >
                        {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                  </div>
                  <Button
                    type="submit"
                    size="lg"
                    className="w-full bg-gradient-to-r from-primary to-chart-2 border-primary"
                    disabled={isLoading}
                    data-testid="button-lernory-login"
                  >
                    {isLoading ? <Loader2 className="h-5 w-5 animate-spin mr-2" /> : <LogIn className="h-5 w-5 mr-2" />}
                    Sign In
                  </Button>
                  <Button variant="ghost" className="w-full" onClick={() => setLookupResult(null)} data-testid="button-different-id">
                    Use a different Lenory ID
                  </Button>
                </form>
              )}
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  );
}
