import { useState } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useToast } from "@/hooks/use-toast";
import { signInWithGoogle, signUpWithEmailPassword, supabase } from "@/lib/supabase";
import { Loader2, Zap, UserPlus, CheckCircle, Eye, EyeOff, Mail } from "lucide-react";
import { SiGoogle } from "react-icons/si";
import { Link } from "wouter";

const DEVICE_TOKEN_KEY = "lernory_device_token";
const LERNORY_ID_KEY = "lernory_user_id";

function getDeviceInfo() {
  return {
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    language: navigator.language,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    timestamp: new Date().toISOString(),
  };
}

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
      const deviceData = await resp.json();
      localStorage.setItem(DEVICE_TOKEN_KEY, deviceData.deviceToken);
      if (deviceData.lernoryId) localStorage.setItem(LERNORY_ID_KEY, deviceData.lernoryId);
    }
  } catch {}
}

type SignupView = "form" | "check-email";

export default function Signup() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [view, setView] = useState<SignupView>("form");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
  const [signupEmail, setSignupEmail] = useState("");

  const features = [
    "AI-powered tutoring for all subjects",
    "Personalized study plans and schedules",
    "Practice exams with detailed feedback",
    "Track your progress with analytics",
  ];

  const handleGoogleSignup = async () => {
    setIsGoogleLoading(true);
    try {
      const { error } = await signInWithGoogle();
      if (error) {
        toast({ title: "Signup Failed", description: error.message, variant: "destructive" });
      }
      // Google OAuth redirects the browser — no further handling needed here
    } catch {
      toast({ title: "Error", description: "Something went wrong. Please try again.", variant: "destructive" });
    } finally {
      setIsGoogleLoading(false);
    }
  };

  const handleEmailSignup = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!email || !password || !confirmPassword) {
      toast({ title: "Missing Fields", description: "Please fill in all fields.", variant: "destructive" });
      return;
    }
    if (password.length < 6) {
      toast({ title: "Password Too Short", description: "Password must be at least 6 characters.", variant: "destructive" });
      return;
    }
    if (password !== confirmPassword) {
      toast({ title: "Passwords Don't Match", description: "Please make sure your passwords match.", variant: "destructive" });
      return;
    }

    setIsLoading(true);
    try {
      const { data, error } = await signUpWithEmailPassword(email, password);

      if (error) {
        if (error.message.toLowerCase().includes('already registered') || error.message.toLowerCase().includes('already been registered')) {
          toast({
            title: "Account Already Exists",
            description: "This email is already registered. Please log in instead.",
            variant: "destructive",
          });
          setTimeout(() => setLocation('/login'), 1500);
        } else {
          toast({ title: "Signup Failed", description: error.message, variant: "destructive" });
        }
        return;
      }

      if (data?.session) {
        // Email confirmation is disabled — user is signed in immediately
        toast({ title: "Welcome to LERNORY!", description: "Your account is ready." });
        saveDeviceInBackground(data.session.access_token);
        setLocation('/dashboard');
      } else if (data?.user) {
        // Email confirmation required — show the check-email screen
        setSignupEmail(email);
        setView("check-email");
      } else {
        toast({ title: "Something went wrong", description: "Please try again.", variant: "destructive" });
      }
    } catch {
      toast({ title: "Error", description: "Something went wrong. Please try again.", variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  };

  // Listen for auth state — handles when user clicks email confirmation link and
  // the tab (or a new tab) gets the session
  const handleResendEmail = async () => {
    if (!signupEmail) return;
    try {
      const { error } = await supabase.auth.resend({
        type: 'signup',
        email: signupEmail,
      });
      if (error) {
        toast({ title: "Could not resend", description: error.message, variant: "destructive" });
      } else {
        toast({ title: "Email resent!", description: "Check your inbox again." });
      }
    } catch {
      toast({ title: "Error", description: "Could not resend confirmation email.", variant: "destructive" });
    }
  };

  // ── Check-email view ─────────────────────────────────────────────────────────
  if (view === "check-email") {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-background via-background to-primary/5 px-4">
        <Card className="w-full max-w-md text-center">
          <CardHeader>
            <div className="mx-auto mb-4 h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center">
              <Mail className="h-8 w-8 text-primary" />
            </div>
            <CardTitle className="text-2xl font-display">Check Your Email</CardTitle>
            <CardDescription className="text-base mt-2">
              We sent a confirmation link to{" "}
              <span className="font-semibold text-foreground">{signupEmail}</span>
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Click the link in that email to confirm your account, then come back here to log in.
            </p>
            <Button
              size="lg"
              className="w-full bg-gradient-to-r from-primary to-chart-2 border-primary"
              onClick={() => setLocation('/login')}
              data-testid="button-go-to-login"
            >
              Go to Login
            </Button>
            <Button
              variant="ghost"
              className="w-full text-sm"
              onClick={handleResendEmail}
              data-testid="button-resend-email"
            >
              Didn't get the email? Resend
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ── Signup form ──────────────────────────────────────────────────────────────
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
        <div className="w-full max-w-4xl grid md:grid-cols-2 gap-8 items-center">
          <div className="hidden md:block space-y-6">
            <h1 className="text-3xl lg:text-4xl font-display font-bold bg-gradient-to-r from-primary to-chart-2 bg-clip-text text-transparent">
              Start Your Learning Journey Today
            </h1>
            <p className="text-lg text-muted-foreground">
              Join thousands of students using AI-powered education to achieve their academic goals.
            </p>
            <ul className="space-y-3">
              {features.map((feature, index) => (
                <li key={index} className="flex items-center gap-3">
                  <CheckCircle className="h-5 w-5 text-primary flex-shrink-0" />
                  <span className="text-muted-foreground">{feature}</span>
                </li>
              ))}
            </ul>
          </div>

          <Card className="w-full">
            <CardHeader className="text-center">
              <div className="mx-auto mb-4 h-12 w-12 rounded-xl bg-gradient-to-br from-primary to-chart-2 flex items-center justify-center">
                <Zap className="h-7 w-7 text-primary-foreground" />
              </div>
              <CardTitle className="text-2xl font-display">Create Account</CardTitle>
              <CardDescription>Sign up to start learning with AI</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <Button
                variant="outline"
                className="w-full"
                size="lg"
                onClick={handleGoogleSignup}
                disabled={isGoogleLoading}
                data-testid="button-google-signup"
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
                  <span className="bg-card px-2 text-muted-foreground">Or sign up with email</span>
                </div>
              </div>

              <form onSubmit={handleEmailSignup} className="space-y-4">
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
                      placeholder="Create a password (min 6 characters)"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      className="pr-10"
                      autoComplete="new-password"
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

                <div className="space-y-2">
                  <Label htmlFor="confirmPassword">Confirm Password</Label>
                  <Input
                    id="confirmPassword"
                    type={showPassword ? "text" : "password"}
                    placeholder="Confirm your password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    required
                    autoComplete="new-password"
                    data-testid="input-confirm-password"
                  />
                </div>

                <Button
                  type="submit"
                  size="lg"
                  className="w-full bg-gradient-to-r from-chart-2 to-primary border-primary"
                  disabled={isLoading}
                  data-testid="button-email-signup"
                >
                  {isLoading ? (
                    <Loader2 className="h-5 w-5 animate-spin mr-2" />
                  ) : (
                    <UserPlus className="h-5 w-5 mr-2" />
                  )}
                  Create Account
                </Button>
              </form>

              <p className="text-center text-sm text-muted-foreground">
                Already have an account?{" "}
                <Link href="/login" className="text-primary hover:underline font-medium" data-testid="link-login">
                  Log in
                </Link>
              </p>
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}
