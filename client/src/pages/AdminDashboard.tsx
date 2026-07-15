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
  Users, DollarSign, TrendingUp, ShieldAlert, Loader2, Lock,
  Coins, Crown, MessageSquare, BarChart3, RefreshCcw, Shield,
  Search, UserCheck, Edit3, ChevronDown, ArrowLeft,
} from "lucide-react";
import { Link } from "wouter";

export default function AdminDashboard() {
  const { user, isLoading: authLoading } = useAuth();
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<"overview" | "users" | "credits">("overview");
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
        <div className="flex gap-2 border-b border-border">
          {[
            { id: "overview" as const, label: "Overview", icon: BarChart3 },
            { id: "users" as const, label: "Users", icon: Users },
            { id: "credits" as const, label: "Credits", icon: Coins },
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
