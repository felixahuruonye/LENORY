import { useState, useEffect, useRef } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useCredits } from "@/hooks/useCredits";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useTheme } from "@/components/ThemeProvider";
import { Link } from "wouter";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft, Settings, Bell, Lock, Keyboard, Volume2, User, Coins, 
  Camera, CheckCircle2, Shield, Crown, Zap,
} from "lucide-react";
import { useVoice, AVAILABLE_VOICES } from "@/lib/useVoice";
import { apiRequest } from "@/lib/queryClient";

type TabId = "profile" | "appearance" | "notifications" | "privacy" | "voice" | "shortcuts" | "credits";

export default function SettingsPanel() {
  const { user, isLoading: authLoading } = useAuth();
  const { credits, topup, isTopupPending } = useCredits();
  const { selectedVoice, setSelectedVoice, speak } = useVoice();
  const { theme, setTheme } = useTheme();
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<TabId>("profile");
  const [displayName, setDisplayName] = useState("");
  const [isSavingName, setIsSavingName] = useState(false);
  const [notifications, setNotifications] = useState(() => {
    const saved = localStorage.getItem("notifications");
    return saved ? JSON.parse(saved) : { messages: true, suggestions: true, updates: false };
  });
  const [dataCollection, setDataCollection] = useState(() => localStorage.getItem("dataCollection") !== "false");
  const [sharedLearning, setSharedLearning] = useState(() => localStorage.getItem("sharedLearning") !== "false");

  useEffect(() => { if (user) { setDisplayName(`${user.firstName || ""} ${user.lastName || ""}`.trim() || user.email || ""); } }, [user]);
  useEffect(() => { localStorage.setItem("notifications", JSON.stringify(notifications)); }, [notifications]);
  useEffect(() => { localStorage.setItem("dataCollection", String(dataCollection)); }, [dataCollection]);
  useEffect(() => { localStorage.setItem("sharedLearning", String(sharedLearning)); }, [sharedLearning]);

  const handleSaveProfile = async () => {
    setIsSavingName(true);
    try {
      const [firstName, ...rest] = displayName.trim().split(" ");
      await apiRequest("PATCH", "/api/auth/user", { firstName, lastName: rest.join(" ") });
      toast({ title: "Profile updated", description: "Your name has been saved." });
    } catch {
      toast({ title: "Save failed", description: "Could not save profile.", variant: "destructive" });
    } finally {
      setIsSavingName(false);
    }
  };

  if (authLoading || !user) {
    return <div className="min-h-screen flex items-center justify-center"><div className="animate-pulse text-muted-foreground">Loading...</div></div>;
  }

  const tabs: { id: TabId; label: string; icon: any }[] = [
    { id: "profile", label: "Profile", icon: User },
    { id: "credits", label: "Credits", icon: Coins },
    { id: "appearance", label: "Appearance", icon: Settings },
    { id: "notifications", label: "Notifications", icon: Bell },
    { id: "privacy", label: "Privacy", icon: Lock },
    { id: "voice", label: "Voice", icon: Volume2 },
    { id: "shortcuts", label: "Shortcuts", icon: Keyboard },
  ];

  const initials = [user.firstName?.[0], user.lastName?.[0]].filter(Boolean).join("").toUpperCase() || user.email?.[0]?.toUpperCase() || "U";
  const tierColor = user.subscriptionTier === 'premium' ? 'text-purple-500' : user.subscriptionTier === 'pro' ? 'text-blue-500' : 'text-muted-foreground';
  const creditColor = !credits ? "" : credits.balance > 10 ? "text-green-500" : credits.balance > 3 ? "text-amber-500" : "text-red-500";

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-primary/5">
      <header className="sticky top-0 z-50 backdrop-blur-xl bg-background/80 border-b border-primary/10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-4">
              <Button variant="ghost" size="icon" asChild className="hover-elevate" data-testid="button-back">
                <Link href="/dashboard"><ArrowLeft className="h-5 w-5" /></Link>
              </Button>
              <div className="flex items-center gap-3">
                <Settings className="h-6 w-6 text-primary" />
                <h1 className="text-2xl font-bold">Settings</h1>
              </div>
            </div>
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex flex-col md:flex-row gap-6">
          {/* Sidebar Tabs */}
          <aside className="w-full md:w-56 flex-shrink-0">
            <Card className="p-2">
              <nav className="space-y-1">
                {tabs.map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={`w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-all hover-elevate ${activeTab === tab.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
                    data-testid={`button-settings-tab-${tab.id}`}
                  >
                    <tab.icon className="h-4 w-4 flex-shrink-0" />
                    {tab.label}
                  </button>
                ))}
              </nav>
            </Card>
          </aside>

          {/* Content */}
          <div className="flex-1 space-y-6">
            {activeTab === "profile" && (
              <Card data-testid="card-settings-profile">
                <div className="flex items-center gap-3 p-6 border-b border-border/50">
                  <User className="h-6 w-6 text-primary" />
                  <CardTitle>Profile</CardTitle>
                </div>
                <CardContent className="p-6 space-y-6">
                  {/* Avatar */}
                  <div className="flex items-center gap-6">
                    <div className="relative">
                      <Avatar className="h-20 w-20">
                        <AvatarImage src={user.profileImageUrl || ""} alt={displayName} />
                        <AvatarFallback className="text-2xl bg-primary/10">{initials}</AvatarFallback>
                      </Avatar>
                    </div>
                    <div>
                      <p className="font-semibold text-lg">{displayName || "No name set"}</p>
                      <p className="text-sm text-muted-foreground">{user.email}</p>
                      <div className="flex items-center gap-2 mt-1">
                        <Badge variant="outline" className={tierColor}>
                          {user.subscriptionTier === 'premium' && <Crown className="h-3 w-3 mr-1" />}
                          {user.subscriptionTier === 'pro' && <Zap className="h-3 w-3 mr-1" />}
                          {(user.subscriptionTier || 'free').charAt(0).toUpperCase() + (user.subscriptionTier || 'free').slice(1)}
                        </Badge>
                        {user.lenoryId && (
                          <Badge variant="outline" className="text-xs font-mono">{user.lenoryId}</Badge>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Display Name */}
                  <div>
                    <label className="text-sm font-medium mb-2 block">Display Name</label>
                    <div className="flex gap-2">
                      <Input
                        value={displayName}
                        onChange={(e) => setDisplayName(e.target.value)}
                        placeholder="Your display name"
                        data-testid="input-display-name"
                        className="flex-1"
                      />
                      <Button onClick={handleSaveProfile} disabled={isSavingName} data-testid="button-save-name">
                        {isSavingName ? "Saving..." : "Save"}
                      </Button>
                    </div>
                  </div>

                  {/* Email */}
                  <div>
                    <label className="text-sm font-medium mb-2 block">Email</label>
                    <div className="flex items-center gap-2">
                      <Input value={user.email || ""} readOnly className="flex-1 bg-secondary/30" data-testid="input-email" />
                      <CheckCircle2 className="h-5 w-5 text-green-500 flex-shrink-0" title="Verified" />
                    </div>
                  </div>

                  {/* LENORY ID */}
                  {user.lenoryId && (
                    <div>
                      <label className="text-sm font-medium mb-2 block flex items-center gap-2">
                        <Shield className="h-4 w-4 text-primary" />
                        LENORY ID
                      </label>
                      <div className="flex items-center gap-2">
                        <Input value={user.lenoryId} readOnly className="flex-1 bg-secondary/30 font-mono" data-testid="input-lenory-id" />
                        <Button variant="outline" size="sm" onClick={() => { navigator.clipboard.writeText(user.lenoryId || ""); toast({ title: "Copied!" }); }} data-testid="button-copy-id">Copy</Button>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">Use this to log in without your email</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {activeTab === "credits" && (
              <Card data-testid="card-settings-credits">
                <div className="flex items-center gap-3 p-6 border-b border-border/50">
                  <Coins className="h-6 w-6 text-primary" />
                  <CardTitle>Credits &amp; Billing</CardTitle>
                </div>
                <CardContent className="p-6 space-y-6">
                  {credits ? (
                    <>
                      {/* Balance */}
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                        <Card className="p-4 text-center border-primary/20">
                          <p className={`text-3xl font-bold ${creditColor}`}>{credits.isAdmin ? "∞" : credits.balance}</p>
                          <p className="text-xs text-muted-foreground mt-1">Available Credits</p>
                        </Card>
                        <Card className="p-4 text-center border-primary/20">
                          <p className="text-3xl font-bold text-blue-500">{credits.monthlyUsed}</p>
                          <p className="text-xs text-muted-foreground mt-1">Used This Month</p>
                        </Card>
                        <Card className="p-4 text-center border-primary/20">
                          <p className="text-3xl font-bold text-purple-500">{credits.isAdmin ? "∞" : credits.maxMonthly}</p>
                          <p className="text-xs text-muted-foreground mt-1">Monthly Limit</p>
                        </Card>
                      </div>

                      {/* Credit bar */}
                      {!credits.isAdmin && (
                        <div>
                          <div className="flex justify-between text-sm mb-2">
                            <span className="text-muted-foreground">Monthly usage</span>
                            <span>{credits.monthlyUsed} / {credits.maxMonthly}</span>
                          </div>
                          <div className="h-3 bg-secondary rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full transition-all ${credits.balance > 10 ? "bg-green-500" : credits.balance > 3 ? "bg-amber-500" : "bg-red-500"}`}
                              style={{ width: `${Math.min(100, (credits.balance / credits.maxMonthly) * 100)}%` }}
                            />
                          </div>
                        </div>
                      )}

                      {/* Top-up */}
                      <div className="border border-primary/20 rounded-lg p-4">
                        <h4 className="font-semibold mb-2 flex items-center gap-2">
                          <Zap className="h-4 w-4 text-primary" />
                          Top Up Credits
                        </h4>
                        <p className="text-sm text-muted-foreground mb-4">₦1,000 = 10 AI credits. No subscription required.</p>
                        <div className="grid grid-cols-3 gap-2">
                          {[10, 20, 50].map((amt) => (
                            <Button key={amt} variant="outline" size="sm" onClick={() => topup(amt)} disabled={isTopupPending} data-testid={`button-topup-${amt}`}>
                              {amt} credits<br />
                              <span className="text-xs text-muted-foreground">₦{(amt * 100).toLocaleString()}</span>
                            </Button>
                          ))}
                        </div>
                      </div>

                      {/* How credits work */}
                      <div className="text-sm text-muted-foreground space-y-1">
                        <p className="font-medium text-foreground">How credits work:</p>
                        <p>• Free plan: 10 credits/day (up to 50/month)</p>
                        <p>• Pro plan: 50 credits/day</p>
                        <p>• Premium: Unlimited</p>
                        <p>• Each AI message costs 1 credit</p>
                        <p>• Image generation costs 2 credits</p>
                        <p>• Video generation costs 5 credits</p>
                      </div>

                      <Link href="/pricing">
                        <Button className="w-full gap-2" data-testid="button-upgrade-plan">
                          <Crown className="h-4 w-4" />
                          Upgrade for More Credits
                        </Button>
                      </Link>
                    </>
                  ) : (
                    <div className="animate-pulse space-y-3">
                      <div className="h-20 bg-secondary rounded-lg" />
                      <div className="h-4 bg-secondary rounded w-3/4" />
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {activeTab === "appearance" && (
              <Card data-testid="card-settings-appearance">
                <div className="flex items-center gap-3 p-6 border-b border-border/50">
                  <Settings className="h-6 w-6 text-primary" />
                  <CardTitle>Appearance</CardTitle>
                </div>
                <CardContent className="divide-y divide-border/50">
                  <div className="flex items-center justify-between p-6">
                    <div>
                      <h3 className="font-semibold">Theme</h3>
                      <p className="text-sm text-muted-foreground mt-1">Light, Dark, or Neon mode</p>
                    </div>
                    <div className="flex gap-2" data-testid="select-theme">
                      {["light", "dark", "neon"].map((t) => (
                        <Button key={t} size="sm" variant={theme === t ? "default" : "outline"} onClick={() => setTheme(t as "light" | "dark" | "neon")} data-testid={`button-theme-${t}`}>
                          {t.charAt(0).toUpperCase() + t.slice(1)}
                        </Button>
                      ))}
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {activeTab === "notifications" && (
              <Card data-testid="card-settings-notifications">
                <div className="flex items-center gap-3 p-6 border-b border-border/50">
                  <Bell className="h-6 w-6 text-primary" />
                  <CardTitle>Notifications</CardTitle>
                </div>
                <CardContent className="divide-y divide-border/50">
                  {[
                    { label: "Message Notifications", description: "Get notified when you receive messages", key: "messages" as const, testId: "switch-message-notifications" },
                    { label: "AI Suggestions", description: "Receive suggestions and recommendations", key: "suggestions" as const, testId: "switch-suggestion-notifications" },
                    { label: "Product Updates", description: "Learn about new features", key: "updates" as const, testId: "switch-update-notifications" },
                  ].map((item) => (
                    <div key={item.key} className="flex items-center justify-between p-6">
                      <div>
                        <h3 className="font-semibold">{item.label}</h3>
                        <p className="text-sm text-muted-foreground mt-1">{item.description}</p>
                      </div>
                      <Switch checked={notifications[item.key]} onCheckedChange={(val) => setNotifications({ ...notifications, [item.key]: val })} data-testid={item.testId} />
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}

            {activeTab === "privacy" && (
              <Card data-testid="card-settings-privacy">
                <div className="flex items-center gap-3 p-6 border-b border-border/50">
                  <Lock className="h-6 w-6 text-primary" />
                  <CardTitle>Privacy &amp; Data</CardTitle>
                </div>
                <CardContent className="divide-y divide-border/50">
                  <div className="flex items-center justify-between p-6">
                    <div>
                      <h3 className="font-semibold">Data Collection</h3>
                      <p className="text-sm text-muted-foreground mt-1">Allow LENORY to analyze learning patterns</p>
                    </div>
                    <Switch checked={dataCollection} onCheckedChange={setDataCollection} data-testid="switch-data-collection" />
                  </div>
                  <div className="flex items-center justify-between p-6">
                    <div>
                      <h3 className="font-semibold">Shared Learning</h3>
                      <p className="text-sm text-muted-foreground mt-1">Share insights with teachers (if student)</p>
                    </div>
                    <Switch checked={sharedLearning} onCheckedChange={setSharedLearning} data-testid="switch-shared-learning" />
                  </div>
                </CardContent>
              </Card>
            )}

            {activeTab === "voice" && (
              <Card data-testid="card-settings-voice">
                <div className="flex items-center gap-3 p-6 border-b border-border/50">
                  <Volume2 className="h-6 w-6 text-primary" />
                  <CardTitle>Voice Settings</CardTitle>
                </div>
                <CardContent className="p-6 space-y-4">
                  <div>
                    <label className="text-sm font-medium mb-2 block">AI Response Voice</label>
                    <select
                      value={selectedVoice}
                      onChange={(e) => { setSelectedVoice(e.target.value); speak("Voice changed successfully"); }}
                      className="w-full px-3 py-2 rounded-md border border-border bg-background text-foreground"
                      data-testid="select-voice-dropdown"
                    >
                      {AVAILABLE_VOICES.map((voice) => (
                        <option key={voice.name} value={voice.name}>{voice.name}{voice.nigerian ? " (Nigerian)" : ""}</option>
                      ))}
                    </select>
                  </div>
                  <div className="flex gap-2 flex-wrap">
                    <Button size="sm" variant="outline" onClick={() => speak(`Testing ${selectedVoice} voice`)} data-testid="button-test-voice">
                      Test Voice
                    </Button>
                    <Button size="sm" variant="outline" asChild data-testid="button-open-voice-gallery">
                      <a href="/voice-gallery">Browse Voice Gallery</a>
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Visit Voice Gallery to preview all available LENORY voices and set your default.
                  </p>
                </CardContent>
              </Card>
            )}

            {activeTab === "shortcuts" && (
              <Card data-testid="card-settings-shortcuts">
                <div className="flex items-center gap-3 p-6 border-b border-border/50">
                  <Keyboard className="h-6 w-6 text-primary" />
                  <CardTitle>Keyboard Shortcuts</CardTitle>
                </div>
                <CardContent className="divide-y divide-border/50">
                  {[
                    { label: "Open Search", desc: "Cmd/Ctrl + K", badge: "Cmd K" },
                    { label: "Ask LENORY", desc: "Cmd/Ctrl + N", badge: "Cmd N" },
                    { label: "Open Settings", desc: "Cmd/Ctrl + ,", badge: "Cmd ," },
                  ].map((item) => (
                    <div key={item.label} className="flex items-center justify-between p-6">
                      <div>
                        <h3 className="font-semibold">{item.label}</h3>
                        <p className="text-sm text-muted-foreground mt-1">{item.desc}</p>
                      </div>
                      <Badge>{item.badge}</Badge>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}

            {/* Danger Zone */}
            <Card className="border-red-500/50">
              <CardHeader><CardTitle className="text-red-500">Danger Zone</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <Button variant="destructive" onClick={() => { if (confirm("Reset all settings?")) { localStorage.clear(); toast({ title: "Settings reset" }); window.location.reload(); } }} data-testid="button-reset-account">
                  Reset Settings
                </Button>
                <Button variant="destructive" onClick={() => { if (confirm("Delete account permanently?")) { toast({ title: "Contact support to delete account" }); } }} data-testid="button-delete-account">
                  Delete Account Permanently
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>
      </main>
    </div>
  );
}
