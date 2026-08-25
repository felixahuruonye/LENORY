import { useState, useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  Users, DollarSign, TrendingUp, Loader2,
  Coins, Crown, BarChart3, RefreshCcw, Shield,
  Search, ArrowLeft, ExternalLink, AlertTriangle,
  CheckCircle2, XCircle, HelpCircle, Zap, Clock,
  Activity, CreditCard
} from "lucide-react";
import { Link } from "wouter";
import { UserDetailModal } from "@/components/UserDetailModal";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { format } from "date-fns";

export default function AdminDashboard() {
  const { user, isLoading: authLoading } = useAuth();
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<"overview" | "users" | "credits" | "providers">("overview");
  const [searchUser, setSearchUser] = useState("");
  const [creditAction, setCreditAction] = useState<{ userId: string; action: string; amount: string } | null>(null);
  const [userCreditsMap, setUserCreditsMap] = useState<Record<string, number | null>>({});
  const [loadingCreditUserId, setLoadingCreditUserId] = useState<string | null>(null);
  
  // ─── NEW STATE ──────────────────────────────────────────────────────────
  const [activeUsers, setActiveUsers] = useState<{ count: number; users: any[] }>({ count: 0, users: [] });
  const [platformHealth, setPlatformHealth] = useState<any>(null);
  const [totalCredits, setTotalCredits] = useState<any>(null);
  const [showUserDetail, setShowUserDetail] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [selectedUserEmail, setSelectedUserEmail] = useState("");
  const [selectedUserName, setSelectedUserName] = useState("");
  const [selectedLenoryId, setSelectedLenoryId] = useState("");
  const [showTransactions, setShowTransactions] = useState(false);
  const [transactions, setTransactions] = useState<any[]>([]);
  const [transactionsLoading, setTransactionsLoading] = useState(false);
  const [tierConfigDraft, setTierConfigDraft] = useState<Record<string, { dailyAdd: string; maxBalance: string }>>({});

  const isAuthorized = user?.email === "felixahuruonye@gmail.com";

  // ─── QUERIES ──────────────────────────────────────────────────────────────
  const { data: users = [], isLoading: usersLoading, refetch: refetchUsers } = useQuery({
    queryKey: ["/api/admin/users"],
    enabled: isAuthorized,
  });

  const { data: cohorts, isLoading: cohortsLoading } = useQuery<any>({
    queryKey: ["/api/admin/user-cohorts"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/admin/user-cohorts");
      return res.json();
    },
    enabled: isAuthorized && activeTab === "users",
  });

  const { data: stats = { revenue: 0, activeUsers: 0 } } = useQuery({
    queryKey: ["/api/admin/stats"],
    enabled: isAuthorized,
  });

  const {
    data: providerData,
    isLoading: providersLoading,
    refetch: refetchProviders,
  } = useQuery<{
    providers: {
      provider: string;
      displayName: string;
      hasRealApi: boolean;
      balance?: number;
      balanceUnit?: string;
      balanceError?: string;
      dashboardUrl: string;
      weeklyCallCount: number;
      monthlyCallCount: number;
      estimatedWeeklyCostUsd: number;
      estimatedMonthlyCostUsd: number;
      status: "green" | "yellow" | "red" | "unknown";
    }[];
    totalMonthlyBurnUsd: number;
    fetchedAt: string;
    fromCache: boolean;
  }>({
    queryKey: ["/api/admin/provider-balances"],
    enabled: isAuthorized,
    staleTime: 5 * 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });

  // AI chat model cooldown status (which Groq/OpenRouter models are
  // currently rate-limited/over quota and when each resets).
  const { data: aiProviderStatus, isLoading: aiStatusLoading, refetch: refetchAiStatus } = useQuery<{
    cooldowns: { model: string; resetsInSeconds: number; resetsAt: string; reason: string }[];
  }>({
    queryKey: ["/api/admin/ai-provider-status"],
    enabled: isAuthorized,
    staleTime: 15 * 1000,
    refetchInterval: 15 * 1000,
    gcTime: 60 * 1000,
  });

  // ─── MUTATIONS ───────────────────────────────────────────────────────────
  const adjustCreditsMutation = useMutation({
    mutationFn: async ({ userId, action, amount }: { userId: string; action: string; amount: number }) => {
      const res = await apiRequest("POST", `/api/admin/credits/${userId}`, { action, amount });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Credits updated" });
      setCreditAction(null);
      refetchUsers();
    },
    onError: () => toast({ title: "Failed", variant: "destructive" }),
  });

  const resetMonthlyMutation = useMutation({
    mutationFn: async (userId: string) => {
      const res = await apiRequest("POST", `/api/admin/credits/${userId}/reset-monthly`, {});
      return res.json();
    },
    onSuccess: (data) => {
      toast({ title: "Monthly credits reset", description: `New balance: ${data.newBalance}` });
      setCreditAction(null);
      refetchUsers();
    },
    onError: () => toast({ title: "Reset failed", variant: "destructive" }),
  });

  const resetDailyMutation = useMutation({
    mutationFn: async (userId: string) => {
      const res = await apiRequest("POST", `/api/admin/credits/${userId}/reset-daily`, {});
      return res.json();
    },
    onSuccess: (data) => {
      toast({ title: "Daily credits topped up", description: `New balance: ${data.newBalance}` });
      setCreditAction(null);
      refetchUsers();
    },
    onError: () => toast({ title: "Reset failed", variant: "destructive" }),
  });

  // ─── TIER CONFIG (daily/monthly credit amounts, DB-backed) ────────────────
  const { data: tierConfigData, isLoading: tierConfigLoading, refetch: refetchTierConfig } = useQuery({
    queryKey: ["/api/admin/tier-config"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/admin/tier-config");
      return res.json();
    },
    enabled: isAuthorized,
    staleTime: 15 * 1000,
  });

  useEffect(() => {
    if (!tierConfigData?.tiers) return;
    const draft: Record<string, { dailyAdd: string; maxBalance: string }> = {};
    for (const t of ["free", "pro", "premium"]) {
      const limits = tierConfigData.tiers[t];
      draft[t] = { dailyAdd: String(limits?.dailyAdd ?? ""), maxBalance: String(limits?.maxBalance ?? "") };
    }
    setTierConfigDraft(draft);
  }, [tierConfigData]);

  const saveTierConfigMutation = useMutation({
    mutationFn: async (tier: string) => {
      const draft = tierConfigDraft[tier];
      const res = await apiRequest("PUT", `/api/admin/tier-config/${tier}`, {
        dailyAdd: Number(draft.dailyAdd),
        maxBalance: Number(draft.maxBalance),
      });
      return res.json();
    },
    onSuccess: (_data, tier) => {
      toast({ title: `${tier.charAt(0).toUpperCase() + tier.slice(1)} tier updated`, description: "Takes effect within 30 seconds — no redeploy needed." });
      refetchTierConfig();
    },
    onError: (err: any) => {
      let msg = "Save failed";
      try { msg = JSON.parse(String(err?.message || "").replace(/^\d+:\s*/, ""))?.message || msg; } catch {}
      toast({ title: "Save failed", description: msg, variant: "destructive" });
    },
  });

  const [reconcileReference, setReconcileReference] = useState("");
  const reconcilePaymentMutation = useMutation({
    mutationFn: async (reference: string) => {
      const res = await apiRequest("POST", "/api/admin/reconcile-payment", { reference });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Reconcile failed");
      return data;
    },
    onSuccess: (data) => {
      toast({ title: `Fixed! ${data.userEmail} is now on ${data.appliedTier}`, description: data.note });
      setReconcileReference("");
      refetchUsers();
    },
    onError: (err: any) => toast({ title: "Couldn't reconcile", description: err.message, variant: "destructive" }),
  });

  // ─── FETCH FUNCTIONS ────────────────────────────────────────────────────
  const fetchPlatformHealth = async () => {
    try {
      const res = await apiRequest("GET", "/api/admin/platform-health");
      const data = await res.json();
      setPlatformHealth(data);
    } catch (e) {}
  };

  const fetchActiveUsers = async () => {
    try {
      const res = await apiRequest("GET", "/api/admin/active-users");
      const data = await res.json();
      setActiveUsers(data);
    } catch (e) {}
  };

  const fetchTotalCredits = async () => {
    try {
      const res = await apiRequest("GET", "/api/admin/total-credits");
      const data = await res.json();
      setTotalCredits(data);
    } catch (e) {}
  };

  const fetchTransactions = async () => {
    setTransactionsLoading(true);
    try {
      const res = await apiRequest("GET", "/api/admin/paystack-transactions?limit=100");
      const data = await res.json();
      setTransactions(data.transactions || []);
      setShowTransactions(true);
    } catch (error: any) {
      let detail = "Failed to fetch transactions";
      try {
        const parsed = JSON.parse(error?.message?.split(": ").slice(1).join(": ") || "{}");
        if (parsed?.detail) detail = parsed.detail;
      } catch {}
      toast({ title: "Error", description: detail, variant: "destructive" });
    } finally {
      setTransactionsLoading(false);
    }
  };

  // ─── AUTO-REFRESH ──────────────────────────────────────────────────────
  useEffect(() => {
    if (isAuthorized) {
      fetchPlatformHealth();
      fetchActiveUsers();
      fetchTotalCredits();
      const interval = setInterval(() => {
        fetchPlatformHealth();
        fetchActiveUsers();
      }, 30000);
      return () => clearInterval(interval);
    }
  }, [isAuthorized]);

  // ─── HANDLERS ──────────────────────────────────────────────────────────
  const fetchAndShowCredits = async (userId: string) => {
    setLoadingCreditUserId(userId);
    try {
      const res = await apiRequest("GET", `/api/admin/credits/${userId}`);
      const data = await res.json();
      setUserCreditsMap((m) => ({ ...m, [userId]: data.balance ?? 0 }));
    } catch {
      setUserCreditsMap((m) => ({ ...m, [userId]: null }));
    } finally {
      setLoadingCreditUserId(null);
    }
    setCreditAction({ userId, action: "add", amount: "10" });
    setActiveTab("credits");
  };

  // ─── AUTH CHECK ────────────────────────────────────────────────────────
  if (authLoading) {
    return <div className="min-h-screen flex items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  }

  if (!isAuthorized) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <Shield className="h-12 w-12 mx-auto mb-4 text-primary" />
            <CardTitle className="text-2xl">Admin Access</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground text-center">
              This page is only accessible from the LENORY admin account. Sign in with that account to continue.
            </p>
            <Link href="/dashboard" className="block text-center text-sm text-primary hover:underline">
              Return to Dashboard
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  const filteredUsers = (users as any[]).filter((u: any) =>
    !searchUser || u.email?.toLowerCase().includes(searchUser.toLowerCase())
  );

  const totalRevenue = (users as any[]).reduce((acc: number, u: any) => {
    if (u.subscriptionTier === 'pro') return acc + 500000;
    if (u.subscriptionTier === 'premium') return acc + 1500000;
    return acc;
  }, 0);

  const proCount = (users as any[]).filter((u: any) => u.subscriptionTier === 'pro').length;
  const premiumCount = (users as any[]).filter((u: any) => u.subscriptionTier === 'premium').length;

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b border-border bg-background/95 backdrop-blur">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-3">
              <Button variant="ghost" size="icon" asChild>
                <Link href="/dashboard"><ArrowLeft className="h-5 w-5" /></Link>
              </Button>
              <div className="flex items-center gap-2">
                <Shield className="h-6 w-6 text-primary" />
                <h1 className="text-xl font-bold">LENORY Admin</h1>
                <Badge variant="outline" className="text-xs">v2</Badge>
              </div>
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <div className="h-2 w-2 bg-green-500 rounded-full animate-pulse" />
              All systems operational
            </div>
            <div className="flex items-center gap-2 ml-4">
              <Button variant="outline" size="sm" asChild className="text-xs">
                <Link href="/admin/engineering"><Wrench className="h-3 w-3 mr-1" /> Engineering</Link>
              </Button>
              <Button variant="outline" size="sm" asChild className="text-xs">
                <Link href="/admin/complaints"><AlertTriangle className="h-3 w-3 mr-1" /> Complaints</Link>
              </Button>
              <Button variant="outline" size="sm" asChild className="text-xs">
                <Link href="/admin/history"><History className="h-3 w-3 mr-1" /> History</Link>
              </Button>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
        {/* Stats Overview */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <Card data-testid="stat-total-users">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm text-muted-foreground">Total Users</CardTitle>
              <Users className="h-4 w-4 text-blue-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{(users as any[]).length}</div>
              <p className="text-xs text-muted-foreground mt-1">{proCount} Pro · {premiumCount} Premium</p>
            </CardContent>
          </Card>

          <Card data-testid="stat-total-revenue">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm text-muted-foreground">Est. Revenue</CardTitle>
              <DollarSign className="h-4 w-4 text-emerald-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">₦{(stats?.realRevenueNaira || 0).toLocaleString()}</div>
              <p className="text-xs text-muted-foreground mt-1">From subscriptions</p>
              <Button 
                variant="outline" 
                size="sm" 
                className="mt-2 w-full"
                onClick={fetchTransactions}
                disabled={transactionsLoading}
              >
                {transactionsLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : "View Transactions"}
              </Button>
            </CardContent>
          </Card>

          <Card data-testid="stat-platform-health">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm text-muted-foreground">Platform Health</CardTitle>
              <Activity className="h-4 w-4 text-primary" />
            </CardHeader>
            <CardContent>
              {platformHealth ? (
                <>
                  <div className={`text-2xl font-bold ${(platformHealth.uptime ?? 0) >= 95 ? "text-green-500" : (platformHealth.uptime ?? 0) >= 80 ? "text-yellow-500" : "text-red-500"}`}>
                    {platformHealth.uptime !== undefined ? `${platformHealth.uptime}%` : "Unknown"}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {(platformHealth.uptime ?? 0) >= 95 ? "Everything looks fine" : (platformHealth.uptime ?? 0) >= 80 ? "Some recent errors, keep an eye on it" : "Multiple recent errors — worth checking"}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Database: <Badge variant={platformHealth.supabaseStatus === 'healthy' ? 'secondary' : 'destructive'}>
                      {platformHealth.supabaseStatus || "unknown"}
                    </Badge>
                  </p>
                </>
              ) : (
                <div className="text-2xl font-bold text-yellow-500">Loading...</div>
              )}
            </CardContent>
          </Card>

          <Card data-testid="stat-active-users">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm text-muted-foreground">Active Users</CardTitle>
              <Users className="h-4 w-4 text-purple-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{activeUsers.count}</div>
              <p className="text-xs text-muted-foreground mt-1">Live from Supabase</p>
              {activeUsers.users?.length > 0 && (
                <div className="mt-2 text-xs text-muted-foreground truncate">
                  {activeUsers.users.slice(0, 3).map((u: any) => u.email).join(', ')}
                  {activeUsers.users.length > 3 && ` +${activeUsers.users.length - 3} more`}
                </div>
              )}
            </CardContent>
          </Card>

          <Card data-testid="stat-total-credits">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm text-muted-foreground">Total Platform Credits</CardTitle>
              <CreditCard className="h-4 w-4 text-emerald-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{totalCredits?.total || 0}</div>
              <p className="text-xs text-muted-foreground mt-1">Across all providers</p>
            </CardContent>
          </Card>
        </div>

        {/* Navigation Tabs */}
        <div className="flex gap-2 border-b border-border overflow-x-auto">
          {[
            { id: "overview"   as const, label: "Overview",  icon: BarChart3 },
            { id: "users"      as const, label: "Users",     icon: Users },
            { id: "credits"    as const, label: "Credits",   icon: Coins },
            { id: "providers"  as const, label: "Providers", icon: Zap },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab.id
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
              data-testid={`tab-admin-${tab.id}`}
            >
              <tab.icon className="h-4 w-4" />
              {tab.label}
            </button>
          ))}
        </div>

        {/* Users Tab */}
        {activeTab === "users" && (
          <>
          <Card>
            <CardHeader>
              <CardTitle>Signup Cohorts</CardTitle>
            </CardHeader>
            <CardContent>
              {cohortsLoading || !cohorts ? (
                <div className="flex justify-center p-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                  {Object.entries(cohorts.buckets).map(([label, count]: [string, any]) => (
                    <div key={label} className="rounded-lg border border-border p-3 text-center">
                      <div className="text-2xl font-bold">{count}</div>
                      <div className="text-xs text-muted-foreground mt-1">{label}</div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Full User Directory</CardTitle>
            </CardHeader>
            <CardContent>
              {cohortsLoading || !cohorts ? (
                <div className="flex justify-center p-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
              ) : (
                <div className="relative overflow-x-auto rounded-lg border border-border max-h-[500px] overflow-y-auto">
                  <table className="w-full text-sm text-left">
                    <thead className="bg-muted/50 text-muted-foreground sticky top-0">
                      <tr>
                        <th className="px-4 py-3 font-semibold">Name</th>
                        <th className="px-4 py-3 font-semibold">Email</th>
                        <th className="px-4 py-3 font-semibold">ID</th>
                        <th className="px-4 py-3 font-semibold">Joined</th>
                        <th className="px-4 py-3 font-semibold">Last Active</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {cohorts.directory.map((u: any) => (
                        <tr key={u.id} className="hover:bg-muted/20 transition-colors">
                          <td className="px-4 py-3">{u.fullName}</td>
                          <td className="px-4 py-3 text-muted-foreground">{u.email}</td>
                          <td className="px-4 py-3 font-mono text-xs">{u.id?.slice(0, 12)}...</td>
                          <td className="px-4 py-3 text-xs">{new Date(u.joinedAt).toLocaleString()}</td>
                          <td className="px-4 py-3 text-xs text-muted-foreground">
                            {u.lastActive ? new Date(u.lastActive).toLocaleString() : "No activity recorded"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
          </>
        )}

        {activeTab === "users" && (
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between flex-wrap gap-3">
                <CardTitle>User Directory</CardTitle>
                <div className="flex items-center gap-2">
                  <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Search by email..."
                      value={searchUser}
                      onChange={(e) => setSearchUser(e.target.value)}
                      className="pl-8 w-52"
                      data-testid="input-search-users"
                    />
                  </div>
                  <Button variant="outline" size="sm" onClick={() => refetchUsers()} data-testid="button-refresh-users">
                    <RefreshCcw className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {usersLoading ? (
                <div className="flex justify-center p-8"><Loader2 className="h-8 w-8 animate-spin" /></div>
              ) : (
                <div className="relative overflow-x-auto rounded-lg border border-border">
                  <table className="w-full text-sm text-left">
                    <thead className="bg-muted/50 text-muted-foreground">
                      <tr>
                        <th className="px-4 py-3 font-semibold">User</th>
                        <th className="px-4 py-3 font-semibold">Tier</th>
                        <th className="px-4 py-3 font-semibold">LENORY ID</th>
                        <th className="px-4 py-3 font-semibold">Credits</th>
                        <th className="px-4 py-3 font-semibold">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {filteredUsers.length === 0 ? (
                        <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">No users found</td></tr>
                      ) : filteredUsers.map((u: any) => (
                        <tr key={u.id} className="hover:bg-muted/20 transition-colors" data-testid={`row-user-${u.id}`}>
                          <td className="px-4 py-3">
                            <div>
                              <p className="font-medium truncate max-w-48">
                                {u.first_name || u.last_name ? `${u.first_name || ''} ${u.last_name || ''}`.trim() : u.email}
                              </p>
                              <p className="text-xs text-muted-foreground truncate">{u.email}</p>
                              <p className="text-xs text-muted-foreground font-mono truncate">ID: {u.id?.slice(0, 12)}...</p>
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <Badge variant="outline" className={u.subscriptionTier === 'premium' ? 'text-purple-500' : u.subscriptionTier === 'pro' ? 'text-blue-500' : ''}>
                              {u.subscriptionTier === 'premium' && <Crown className="h-3 w-3 mr-1" />}
                              {(u.subscriptionTier || 'free').charAt(0).toUpperCase() + (u.subscriptionTier || 'free').slice(1)}
                            </Badge>
                          </td>
                          <td className="px-4 py-3 font-mono text-xs">{u.lenoryId || "—"}</td>
                          <td className="px-4 py-3 font-mono text-sm">
                            {userCreditsMap[u.id] !== undefined ? (
                              <span className="font-semibold text-yellow-600 dark:text-yellow-400">
                                {userCreditsMap[u.id] ?? "err"}
                              </span>
                            ) : (
                              <span className="text-muted-foreground text-xs">click →</span>
                            )}
                          </td>
                          <td className="px-4 py-3 flex gap-1">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => fetchAndShowCredits(u.id)}
                              disabled={loadingCreditUserId === u.id}
                              data-testid={`button-edit-credits-${u.id}`}
                            >
                              {loadingCreditUserId === u.id ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                <><Coins className="h-3 w-3 mr-1" />Credits</>
                              )}
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => {
                                setSelectedUserId(u.id);
                                setSelectedUserEmail(u.email);
                                setSelectedUserName(`${u.first_name || ''} ${u.last_name || ''}`.trim() || u.email);
                                setSelectedLenoryId(u.lenoryId || '');
                                setShowUserDetail(true);
                              }}
                              data-testid={`button-view-user-${u.id}`}
                            >
                              <Activity className="h-4 w-4" />
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Credits Tab */}
        {activeTab === "credits" && (
          <div className="space-y-6">
            <Card className="border-destructive/40">
              <CardHeader>
                <CardTitle>Fix a Stuck Payment</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  If a user paid but their plan didn't upgrade, paste their Paystack reference (e.g. sub_xxxxx) below.
                  This re-verifies directly with Paystack and applies the correct plan — it will not double-add credits.
                </p>
                <div className="flex gap-2">
                  <Input
                    placeholder="sub_FwQlv7kGK-MlH3GzxFc0C"
                    value={reconcileReference}
                    onChange={(e) => setReconcileReference(e.target.value)}
                    data-testid="input-reconcile-reference"
                  />
                  <Button
                    onClick={() => reconcilePaymentMutation.mutate(reconcileReference)}
                    disabled={reconcilePaymentMutation.isPending || !reconcileReference.trim()}
                    data-testid="button-reconcile-payment"
                  >
                    {reconcilePaymentMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Reconcile"}
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Adjust User Credits</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm text-muted-foreground">Select a user from the Users tab and click Credits to adjust their balance.</p>
                {creditAction && (
                  <div className="border border-primary/20 rounded-lg p-4 space-y-3">
                    <p className="font-medium text-sm">Adjusting credits for: <span className="font-mono text-xs">{creditAction.userId.slice(0, 16)}...</span></p>
                    <div className="flex gap-2 flex-wrap">
                      {["add", "set", "deduct"].map((a) => (
                        <Button
                          key={a}
                          size="sm"
                          variant={creditAction.action === a ? "default" : "outline"}
                          onClick={() => setCreditAction({ ...creditAction, action: a })}
                          data-testid={`button-credit-action-${a}`}
                        >
                          {a.charAt(0).toUpperCase() + a.slice(1)}
                        </Button>
                      ))}
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => resetMonthlyMutation.mutate(creditAction.userId)}
                        disabled={resetMonthlyMutation.isPending}
                        data-testid="button-reset-monthly-credits"
                      >
                        {resetMonthlyMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : "Reset Monthly"}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => resetDailyMutation.mutate(creditAction.userId)}
                        disabled={resetDailyMutation.isPending}
                        data-testid="button-reset-daily-credits"
                      >
                        {resetDailyMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : "Reset Daily"}
                      </Button>
                    </div>
                    <div className="flex gap-2">
                      <Input
                        type="number"
                        value={creditAction.amount}
                        onChange={(e) => setCreditAction({ ...creditAction, amount: e.target.value })}
                        placeholder="Amount"
                        data-testid="input-credit-amount"
                      />
                      <Button
                        onClick={() => adjustCreditsMutation.mutate({ userId: creditAction.userId, action: creditAction.action, amount: Number(creditAction.amount) })}
                        disabled={adjustCreditsMutation.isPending}
                        data-testid="button-apply-credits"
                      >
                        {adjustCreditsMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Apply"}
                      </Button>
                      <Button variant="outline" onClick={() => setCreditAction(null)} data-testid="button-cancel-credits">Cancel</Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Tier Config — Daily/Monthly Credit Amounts</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  Edit how many credits each tier gets per day and their monthly cap. Changes take effect within 30 seconds — no code changes or redeploy needed.
                </p>
                {tierConfigLoading && !Object.keys(tierConfigDraft).length ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" /> Loading tier config...
                  </div>
                ) : (
                  <div className="grid gap-4 sm:grid-cols-3">
                    {["free", "pro", "premium"].map((tier) => (
                      <div key={tier} className="border rounded-lg p-4 space-y-3">
                        <p className="font-medium capitalize flex items-center gap-2">
                          {tier === "premium" && <Crown className="h-4 w-4 text-amber-500" />}
                          {tier}
                        </p>
                        <div className="space-y-1">
                          <label className="text-xs text-muted-foreground">Daily credits added</label>
                          <Input
                            type="number"
                            min={0}
                            value={tierConfigDraft[tier]?.dailyAdd ?? ""}
                            onChange={(e) => setTierConfigDraft((prev) => ({ ...prev, [tier]: { ...prev[tier], dailyAdd: e.target.value } }))}
                            data-testid={`input-tier-${tier}-daily`}
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-xs text-muted-foreground">Monthly cap</label>
                          <Input
                            type="number"
                            min={0}
                            value={tierConfigDraft[tier]?.maxBalance ?? ""}
                            onChange={(e) => setTierConfigDraft((prev) => ({ ...prev, [tier]: { ...prev[tier], maxBalance: e.target.value } }))}
                            data-testid={`input-tier-${tier}-max`}
                          />
                        </div>
                        <Button
                          size="sm"
                          className="w-full"
                          onClick={() => saveTierConfigMutation.mutate(tier)}
                          disabled={saveTierConfigMutation.isPending}
                          data-testid={`button-save-tier-${tier}`}
                        >
                          {saveTierConfigMutation.isPending && saveTierConfigMutation.variables === tier ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            "Save"
                          )}
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        )}

        {/* Providers Tab */}
        {activeTab === "providers" && (
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between flex-wrap gap-3">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      <Zap className="h-5 w-5 text-amber-500" />
                      Chat AI Model Status
                    </CardTitle>
                    <p className="text-xs text-muted-foreground mt-1">
                      Which Groq/OpenRouter chat models are currently rate-limited or over quota, and exactly when each resets. Auto-refreshes every 15s.
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => refetchAiStatus()}
                    disabled={aiStatusLoading}
                    data-testid="button-refresh-ai-provider-status"
                  >
                    {aiStatusLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {aiStatusLoading && !aiProviderStatus ? (
                  <div className="flex items-center gap-3 text-muted-foreground">
                    <Loader2 className="h-5 w-5 animate-spin" />
                    <span className="text-sm">Checking model status…</span>
                  </div>
                ) : !aiProviderStatus?.cooldowns?.length ? (
                  <div className="flex items-center gap-2 text-sm text-emerald-500">
                    <span className="h-2 w-2 rounded-full bg-emerald-500" />
                    All chat models available — nothing on cooldown right now.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {aiProviderStatus.cooldowns.map((c) => (
                      <div key={c.model} className="flex items-center justify-between rounded-lg border border-border p-3 text-sm flex-wrap gap-2">
                        <div className="flex items-center gap-2">
                          <span className="h-2 w-2 rounded-full bg-red-500" />
                          <span className="font-medium">{c.model}</span>
                        </div>
                        <div className="text-xs text-muted-foreground flex items-center gap-3">
                          <span>Resets in {Math.ceil(c.resetsInSeconds / 60)} min ({new Date(c.resetsAt).toLocaleTimeString()})</span>
                          <span className="truncate max-w-[240px]" title={c.reason}>{c.reason}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <div className="flex items-center justify-between flex-wrap gap-3">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      <DollarSign className="h-5 w-5 text-emerald-500" />
                      Total Monthly Burn Estimate
                    </CardTitle>
                    <p className="text-xs text-muted-foreground mt-1">
                      Based on call counts × rough per-call cost averages from <code>api_usage_events</code>. 
                      These are estimates only — actual charges may differ.
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => refetchProviders()}
                    disabled={providersLoading}
                    data-testid="button-refresh-providers"
                  >
                    {providersLoading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <RefreshCcw className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {providersLoading && !providerData ? (
                  <div className="flex items-center gap-3 text-muted-foreground">
                    <Loader2 className="h-5 w-5 animate-spin" />
                    <span className="text-sm">Fetching provider data…</span>
                  </div>
                ) : (
                  <div className="flex items-end gap-4 flex-wrap">
                    <div>
                      <span className="text-4xl font-bold text-emerald-500">
                        ~${providerData?.totalMonthlyBurnUsd?.toFixed(2) ?? "0.00"}
                      </span>
                      <span className="text-sm text-muted-foreground ml-2">USD / month (estimate)</span>
                    </div>
                    <div className="text-xs text-muted-foreground flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {providerData?.fromCache ? "Cached · " : "Live · "}
                      refreshes every 5 min
                      {providerData?.fetchedAt && (
                        <span> · fetched {new Date(providerData.fetchedAt).toLocaleTimeString()}</span>
                      )}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Provider cards */}
            {providersLoading && !providerData ? (
              <div className="flex justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {(providerData?.providers ?? []).map((p) => {
                  const StatusIcon =
                    p.status === "green"   ? CheckCircle2  :
                    p.status === "yellow"  ? AlertTriangle :
                    p.status === "red"     ? XCircle       : HelpCircle;
                  const statusColor =
                    p.status === "green"   ? "text-emerald-500" :
                    p.status === "yellow"  ? "text-yellow-500"  :
                    p.status === "red"     ? "text-red-500"     : "text-muted-foreground";
                  const statusLabel =
                    p.status === "green"   ? "OK"           :
                    p.status === "yellow"  ? "Low"          :
                    p.status === "red"     ? "Critical"     : "Unknown";

                  return (
                    <Card key={p.provider} data-testid={`card-provider-${p.provider}`}>
                      <CardHeader className="flex flex-row items-start justify-between gap-2 pb-3">
                        <div className="min-w-0">
                          <CardTitle className="text-base leading-snug">{p.displayName}</CardTitle>
                          <p className="text-xs text-muted-foreground mt-0.5 font-mono">{p.provider}</p>
                        </div>
                        <div className={`flex items-center gap-1 shrink-0 ${statusColor}`}>
                          <StatusIcon className="h-4 w-4" />
                          <span className="text-xs font-semibold">{statusLabel}</span>
                        </div>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        <div className="rounded-lg bg-muted/40 px-3 py-2">
                          <p className="text-xs text-muted-foreground mb-1 font-medium">Balance</p>
                          {p.hasRealApi ? (
                            p.balance !== undefined ? (
                              <p className="text-lg font-bold">
                                {p.balance.toLocaleString()}
                                <span className="text-xs font-normal text-muted-foreground ml-1">{p.balanceUnit}</span>
                              </p>
                            ) : (
                              <p className="text-sm text-red-500 flex items-center gap-1">
                                <XCircle className="h-3 w-3" />
                                {p.balanceError ?? "Unreachable"}
                              </p>
                            )
                          ) : (
                            <p className="text-sm text-muted-foreground italic">
                              No balance API — check dashboard manually
                            </p>
                          )}
                        </div>

                        <div className="grid grid-cols-2 gap-2 text-sm">
                          <div className="rounded-md bg-muted/20 px-2 py-1.5 text-center">
                            <p className="text-xs text-muted-foreground">This week</p>
                            <p className="font-semibold">{p.weeklyCallCount.toLocaleString()} calls</p>
                            <p className="text-xs text-muted-foreground">
                              ~${p.estimatedWeeklyCostUsd.toFixed(3)}
                            </p>
                          </div>
                          <div className="rounded-md bg-muted/20 px-2 py-1.5 text-center">
                            <p className="text-xs text-muted-foreground">This month</p>
                            <p className="font-semibold">{p.monthlyCallCount.toLocaleString()} calls</p>
                            <p className="text-xs text-muted-foreground">
                              ~${p.estimatedMonthlyCostUsd.toFixed(3)}
                            </p>
                          </div>
                        </div>

                        <a
                          href={p.dashboardUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1.5 text-xs text-primary hover:underline"
                          data-testid={`link-provider-dashboard-${p.provider}`}
                        >
                          <ExternalLink className="h-3 w-3" />
                          Open provider dashboard
                        </a>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}

            <p className="text-xs text-muted-foreground text-center px-4">
              Cost estimates are calculated from call counts in <code>api_usage_events</code> multiplied by fixed per-call 
              averages. Actual billed amounts may differ based on token length, model version, and provider pricing changes.
              Only Stability AI reports a verified credit balance via API. All other providers require manual dashboard checks.
            </p>
          </div>
        )}

        {/* Overview Tab */}
        {activeTab === "overview" && (
          <div className="space-y-6">
            <Card>
              <CardHeader><CardTitle>Platform Overview</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div className="flex justify-between p-3 bg-secondary/20 rounded-lg">
                    <span className="text-muted-foreground">Total Users</span>
                    <span className="font-bold">{(users as any[]).length}</span>
                  </div>
                  <div className="flex justify-between p-3 bg-secondary/20 rounded-lg">
                    <span className="text-muted-foreground">Pro Users</span>
                    <span className="font-bold text-blue-500">{proCount}</span>
                  </div>
                  <div className="flex justify-between p-3 bg-secondary/20 rounded-lg">
                    <span className="text-muted-foreground">Premium Users</span>
                    <span className="font-bold text-purple-500">{premiumCount}</span>
                  </div>
                  <div className="flex justify-between p-3 bg-secondary/20 rounded-lg">
                    <span className="text-muted-foreground">Free Users</span>
                    <span className="font-bold">{(users as any[]).length - proCount - premiumCount}</span>
                  </div>
                </div>
                <div className="p-3 bg-green-50 dark:bg-green-950/20 rounded-lg border border-green-200 dark:border-green-800">
                  <p className="text-xs text-muted-foreground mb-1">✅ System Status</p>
                  <p className="text-sm text-green-700 dark:text-green-400">All data is persisted in Supabase. No data loss on restart.</p>
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </main>

      {/* User Detail Modal */}
      <UserDetailModal
        open={showUserDetail}
        onOpenChange={setShowUserDetail}
        userId={selectedUserId || ''}
        userEmail={selectedUserEmail}
        userName={selectedUserName}
        lenoryId={selectedLenoryId}
      />

      {/* Transactions Dialog */}
      <Dialog open={showTransactions} onOpenChange={setShowTransactions}>
        <DialogContent className="max-w-4xl max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Paystack Transactions</DialogTitle>
          </DialogHeader>
          <ScrollArea className="flex-1 pr-4">
            <table className="w-full text-sm">
              <thead className="bg-muted/30 sticky top-0">
                <tr>
                  <th className="text-left p-2">Date</th>
                  <th className="text-left p-2">Customer</th>
                  <th className="text-right p-2">Amount (₦)</th>
                  <th className="text-left p-2">Status</th>
                  <th className="text-left p-2">Reference</th>
                </tr>
              </thead>
              <tbody>
                {transactions.map((t: any) => (
                  <tr key={t.id} className="border-t">
                    <td className="p-2 text-xs">{format(new Date(t.created_at), "MMM d, HH:mm")}</td>
                    <td className="p-2">{t.customer?.email || t.metadata?.email || 'N/A'}</td>
                    <td className="p-2 text-right">{(t.amount / 100).toLocaleString()}</td>
                    <td className="p-2">
                      <Badge variant={t.status === 'success' ? 'secondary' : 'destructive'}>
                        {t.status}
                      </Badge>
                    </td>
                    <td className="p-2 text-xs font-mono">{t.reference}</td>
                  </tr>
                ))}
                {transactions.length === 0 && (
                  <tr><td colSpan={5} className="text-center p-4 text-muted-foreground">No transactions found</td></tr>
                )}
              </tbody>
            </table>
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </div>
  );
}
