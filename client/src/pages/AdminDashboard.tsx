import { useState } from "react";
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
} from "lucide-react";
import { Link } from "wouter";

export default function AdminDashboard() {
  const { user, isLoading: authLoading } = useAuth();
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<"overview" | "users" | "credits" | "providers">("overview");
  const [searchUser, setSearchUser] = useState("");
  const [editingUser, setEditingUser] = useState<any>(null);
  const [creditAction, setCreditAction] = useState<{ userId: string; action: string; amount: string } | null>(null);
  const [userCreditsMap, setUserCreditsMap] = useState<Record<string, number | null>>({});
  const [loadingCreditUserId, setLoadingCreditUserId] = useState<string | null>(null);

  const isAuthorized = user?.email === "felixahuruonye@gmail.com";

  const { data: users = [], isLoading: usersLoading, refetch: refetchUsers } = useQuery({
    queryKey: ["/api/admin/users"],
    enabled: isAuthorized,
  });

  const { data: stats = { revenue: 0, activeUsers: 0 } } = useQuery({
    queryKey: ["/api/admin/stats"],
    enabled: isAuthorized,
  });

  const {
    data: providerData,
    isLoading: providersLoading,
    refetch: refetchProviders,
    dataUpdatedAt: providersUpdatedAt,
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

  const handleAuthorize = () => {
    // Real auth is enforced server-side by email check on every /api/admin/* call.
    // This client-side gate is just for UI — no bypass code exists or should exist here.
  };

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
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
        {/* Stats Overview */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
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
              <div className="text-2xl font-bold">₦{(totalRevenue / 100).toLocaleString()}</div>
              <p className="text-xs text-muted-foreground mt-1">From subscriptions</p>
            </CardContent>
          </Card>

          <Card data-testid="stat-platform-health">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm text-muted-foreground">Platform Health</CardTitle>
              <TrendingUp className="h-4 w-4 text-primary" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-green-500">99.9%</div>
              <p className="text-xs text-muted-foreground mt-1">Uptime this month</p>
            </CardContent>
          </Card>

          <Card data-testid="stat-active-users">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm text-muted-foreground">Active Users</CardTitle>
              <BarChart3 className="h-4 w-4 text-purple-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{(users as any[]).length}</div>
              <p className="text-xs text-muted-foreground mt-1">In-memory session</p>
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
                              <p className="font-medium truncate max-w-48">{u.email}</p>
                              <p className="text-xs text-muted-foreground truncate">{u.id?.slice(0, 12)}...</p>
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
                          <td className="px-4 py-3">
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
            <Card>
              <CardHeader>
                <CardTitle>Adjust User Credits</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm text-muted-foreground">Select a user from the Users tab and click Credits to adjust their balance.</p>
                {creditAction && (
                  <div className="border border-primary/20 rounded-lg p-4 space-y-3">
                    <p className="font-medium text-sm">Adjusting credits for: <span className="font-mono text-xs">{creditAction.userId.slice(0, 16)}...</span></p>
                    <div className="flex gap-2">
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
          </div>
        )}

        {/* Providers Tab */}
        {activeTab === "providers" && (
          <div className="space-y-6">
            {/* Burn estimate header */}
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
                        {/* Balance row */}
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

                        {/* Usage this week / this month */}
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

                        {/* Dashboard link */}
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

            {/* Disclaimer */}
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
                <div className="p-3 bg-primary/5 rounded-lg border border-primary/20">
                  <p className="text-xs text-muted-foreground mb-1">Storage Note</p>
                  <p className="text-sm">Data is stored in-memory. Supabase REST persistence is attempted but may fail. Data resets on server restart.</p>
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </main>
    </div>
  );
}
