import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useToast } from "@/hooks/use-toast";
import { signInWithGoogle, signInWithEmailPassword, supabase } from "@/lib/supabase";
import { Loader2, Zap, LogIn, Eye, EyeOff, Smartphone, ArrowRight, ArrowLeft, CheckCircle2 } from "lucide-react";
import { SiGoogle } from "react-icons/si";
import { Link } from "wouter";

const DEVICE_TOKEN_KEY = "lernory_device_token";
const LERNORY_ID_KEY = "lernory_user_id";

function getDeviceInfo() {
  return {
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    language: navigator.language,
    screenWidth: window.screen.width,
    screenHeight: window.screen.height,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    timestamp: new Date().toISOString(),
  };
}

type LoginView = "checking" | "trusted-device" | "active-session" | "email-login" | "lernory-id";

export default function Login() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const [view, setView] = useState<LoginView>("checking");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [lernoryId, setLernoryId] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
  const [trustedUser, setTrustedUser] = useState<{ firstName?: string; email?: string; lernoryId?: string } | null>(null);
  const [activeSessionUser, setActiveSessionUser] = useState<{ email?: string; firstName?: string } | null>(null);

  // Lernory ID lookup state
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupResult, setLookupResult] = useState<{ maskedEmail: string; firstName?: string } | null>(null);
  const [lernoryPassword, setLernoryPassword] = useState("");

  useEffect(() => {
    checkAuth();
  }, []);

  async function checkAuth() {
    // Check if we have a trusted device token
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
          // We have a trusted device - try to restore session
          const { data: { session } } = await supabase.auth.getSession();
          if (session) {
            // Session still valid + trusted device → show welcome back
            setTrustedUser({
              firstName: data.firstName,
              email: data.email,
              lernoryId: data.lernoryId,
            });
            setView("trusted-device");
            return;
          } else {
            // Session expired, remove device token
            localStorage.removeItem(DEVICE_TOKEN_KEY);
            localStorage.removeItem(LERNORY_ID_KEY);
          }
        } else {
          localStorage.removeItem(DEVICE_TOKEN_KEY);
          localStorage.removeItem(LERNORY_ID_KEY);
        }
      } catch {
        localStorage.removeItem(DEVICE_TOKEN_KEY);
      }
    }

    // Check for active Supabase session (no trusted device)
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

    // No session at all
    setView("email-login");
  }

  async function saveDeviceAndRedirect(accessToken: string) {
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
        if (data.lernoryId) localStorage.setItem(LERNORY_ID_KEY, data.lernoryId);
      }
    } catch {}
    setLocation("/dashboard");
  }

  const handleTrustedContinue = () => {
    setLocation("/dashboard");
  };

  const handleActiveSessionContinue = async () => {
    setIsLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.access_token) {
        await saveDeviceAndRedirect(session.access_token);
      }
    } catch {
      setLocation("/dashboard");
    } finally {
      setIsLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    setIsGoogleLoading(true);
    try {
      const { error } = await signInWithGoogle();
      if (error) {
        toast({ title: "Login Failed", description: error.message, variant: "destructive" });
      }
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
        if (error.message.toLowerCase().includes("invalid login credentials")) {
          toast({
            title: "Login Failed",
            description: "Invalid email or password. New here? Create an account.",
            variant: "destructive",
          });
        } else {
          toast({ title: "Login Failed", description: error.message, variant: "destructive" });
        }
        return;
      }
      if (data?.session?.access_token) {
        toast({ title: "Welcome Back!", description: "Logging you in..." });
        await saveDeviceAndRedirect(data.session.access_token);
      }
    } catch {
      toast({ title: "Error", description: "Something went wrong. Please try again.", variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  };

  const handleLernoryIdLookup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!lernoryId.trim()) {
      toast({ title: "Enter Lernory ID", description: "Please enter your Lernory ID (e.g. LRN-XXXXXXXX)", variant: "destructive" });
      return;
    }
    setLookupLoading(true);
    try {
      const resp = await fetch(`/api/auth/lernory-lookup/${lernoryId.trim().toUpperCase()}`);
      const data = await resp.json();
      if (!data.found) {
        toast({ title: "Not Found", description: "No account found with that Lernory ID. Check and try again.", variant: "destructive" });
        return;
      }
      setLookupResult({ maskedEmail: data.maskedEmail, firstName: data.firstName });
    } catch {
      toast({ title: "Error", description: "Could not look up Lernory ID. Try again.", variant: "destructive" });
    } finally {
      setLookupLoading(false);
    }
  };

  const handleLernoryIdLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!lookupResult || !lernoryPassword) return;
    setIsLoading(true);
    try {
      // Server-side login keeps email private
      const resp = await fetch("/api/auth/lernory-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lernoryId: lernoryId.trim().toUpperCase(), password: lernoryPassword }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        toast({ title: "Login Failed", description: data.message || "Incorrect password.", variant: "destructive" });
        return;
      }
      if (data.accessToken) {
        // Restore session in Supabase client
        await supabase.auth.setSession({
          access_token: data.accessToken,
          refresh_token: data.refreshToken,
        });
        toast({ title: `Welcome back${lookupResult.firstName ? ", " + lookupResult.firstName : ""}!`, description: "Logging you in..." });
        await saveDeviceAndRedirect(data.accessToken);
      }
    } catch {
      toast({ title: "Error", description: "Something went wrong. Please try again.", variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  };

  const handleSwitchAccount = async () => {
    const deviceToken = localStorage.getItem(DEVICE_TOKEN_KEY);
    if (deviceToken) {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.access_token) {
          await fetch("/api/auth/device", {
            method: "DELETE",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${session.access_token}`,
            },
            body: JSON.stringify({ deviceToken }),
          });
        }
      } catch {}
      localStorage.removeItem(DEVICE_TOKEN_KEY);
      localStorage.removeItem(LERNORY_ID_KEY);
    }
    setView("email-login");
  };

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
              <span className="font-display font-bold text-xl">LERNORY</span>
            </div>
          </Link>
          <ThemeToggle />
        </div>
      </header>

      <main className="flex-1 flex items-center justify-center px-4 pt-20 pb-8">

        {/* TRUSTED DEVICE VIEW */}
        {view === "trusted-device" && trustedUser && (
          <Card className="w-full max-w-md">
            <CardHeader className="text-center">
              <div className="mx-auto mb-4 h-14 w-14 rounded-full bg-gradient-to-br from-primary to-chart-2 flex items-center justify-center">
                <CheckCircle2 className="h-8 w-8 text-primary-foreground" />
              </div>
              <CardTitle className="text-2xl font-display">Welcome Back!</CardTitle>
              {trustedUser.firstName && (
                <CardDescription className="text-base">
                  Good to see you again, <span className="font-semibold text-foreground">{trustedUser.firstName}</span>
                </CardDescription>
              )}
              {trustedUser.lernoryId && (
                <div className="mt-2 inline-flex items-center gap-2 bg-primary/10 text-primary text-sm font-mono px-3 py-1 rounded-md mx-auto">
                  <Smartphone className="h-3.5 w-3.5" />
                  {trustedUser.lernoryId}
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
                Continue with Lernory
                <ArrowRight className="h-4 w-4 ml-2" />
              </Button>
              <Button
                variant="ghost"
                size="lg"
                className="w-full"
                onClick={handleSwitchAccount}
                data-testid="button-switch-account"
              >
                Not you? Use a different account
              </Button>
            </CardContent>
          </Card>
        )}

        {/* ACTIVE SESSION (no trusted device) */}
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
                {isLoading ? (
                  <Loader2 className="h-5 w-5 animate-spin mr-2" />
                ) : (
                  <ArrowRight className="h-5 w-5 mr-2" />
                )}
                Continue with Lernory
              </Button>
              <p className="text-center text-xs text-muted-foreground">
                This will also save this device for quick future access.
              </p>
              <Button
                variant="ghost"
                className="w-full"
                onClick={handleSwitchAccount}
                data-testid="button-switch-account"
              >
                Sign in with a different account
              </Button>
            </CardContent>
          </Card>
        )}

        {/* EMAIL LOGIN VIEW */}
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
                {isGoogleLoading ? (
                  <Loader2 className="h-5 w-5 animate-spin mr-2" />
                ) : (
                  <SiGoogle className="h-5 w-5 mr-2" />
                )}
                Continue with Google
              </Button>

              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t" />
                </div>
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
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t" />
                </div>
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
                Use my Lernory ID
              </Button>

              <p className="text-center text-sm text-muted-foreground">
                New to Lernory?{" "}
                <Link href="/signup" className="text-primary hover:underline font-medium" data-testid="link-signup">
                  Create an account
                </Link>
              </p>
            </CardContent>
          </Card>
        )}

        {/* LERNORY ID VIEW */}
        {view === "lernory-id" && (
          <Card className="w-full max-w-md">
            <CardHeader>
              <Button
                variant="ghost"
                size="icon"
                className="absolute left-4 top-4"
                onClick={() => { setView("email-login"); setLookupResult(null); setLernoryId(""); setLernoryPassword(""); }}
                data-testid="button-back"
              >
                <ArrowLeft className="h-4 w-4" />
              </Button>
              <div className="text-center">
                <div className="mx-auto mb-4 h-12 w-12 rounded-xl bg-gradient-to-br from-primary to-chart-2 flex items-center justify-center">
                  <Smartphone className="h-7 w-7 text-primary-foreground" />
                </div>
                <CardTitle className="text-2xl font-display">Lernory ID Login</CardTitle>
                <CardDescription>Enter your unique Lernory ID to sign in</CardDescription>
              </div>
            </CardHeader>
            <CardContent className="space-y-6">
              {!lookupResult ? (
                <form onSubmit={handleLernoryIdLookup} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="lernory-id">Your Lernory ID</Label>
                    <Input
                      id="lernory-id"
                      type="text"
                      placeholder="e.g. LRN-AB12CD34"
                      value={lernoryId}
                      onChange={(e) => setLernoryId(e.target.value.toUpperCase())}
                      className="font-mono text-center tracking-widest"
                      maxLength={12}
                      data-testid="input-lernory-id"
                    />
                    <p className="text-xs text-muted-foreground text-center">
                      Your Lernory ID can be found in your account settings
                    </p>
                  </div>
                  <Button
                    type="submit"
                    size="lg"
                    className="w-full bg-gradient-to-r from-primary to-chart-2 border-primary"
                    disabled={lookupLoading}
                    data-testid="button-lookup-lernory-id"
                  >
                    {lookupLoading ? <Loader2 className="h-5 w-5 animate-spin mr-2" /> : null}
                    Find My Account
                  </Button>
                </form>
              ) : (
                <form onSubmit={handleLernoryIdLogin} className="space-y-4">
                  <div className="bg-primary/10 rounded-md p-4 space-y-1">
                    <p className="text-sm font-medium text-foreground flex items-center gap-2">
                      <CheckCircle2 className="h-4 w-4 text-primary" />
                      Account found
                      {lookupResult.firstName && <span>— {lookupResult.firstName}</span>}
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
                        onChange={(e) => setLernoryPassword(e.target.value)}
                        required
                        className="pr-10"
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
                  <Button
                    type="button"
                    variant="ghost"
                    className="w-full"
                    onClick={() => { setLookupResult(null); setLernoryId(""); }}
                    data-testid="button-change-lernory-id"
                  >
                    Try a different Lernory ID
                  </Button>
                </form>
              )}

              <p className="text-center text-sm text-muted-foreground">
                New to Lernory?{" "}
                <Link href="/signup" className="text-primary hover:underline font-medium" data-testid="link-signup">
                  Create an account
                </Link>
              </p>
            </CardContent>
          </Card>
        )}

      </main>
    </div>
  );
}
