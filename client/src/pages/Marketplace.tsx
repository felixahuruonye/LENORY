import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ThemeToggle } from "@/components/ThemeToggle";
import { ScrollReveal } from "@/components/ScrollReveal";
import {
  Search,
  Plus,
  DollarSign,
  Download,
  ArrowLeft,
  ShoppingCart,
  TrendingUp,
} from "lucide-react";
import { Link } from "wouter";
import { useEffect, useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

export default function Marketplace() {
  const { user, isLoading: authLoading, refetchUser } = useAuth();
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState("");
  const [verifyingPayment, setVerifyingPayment] = useState(false);

  useEffect(() => {
    if (!authLoading && !user) {
      toast({
        title: "Unauthorized",
        description: "You are logged out. Logging in again...",
        variant: "destructive",
      });
      setTimeout(() => {
        window.location.href = "/api/login";
      }, 500);
    }
  }, [user, authLoading, toast]);

  // Handle the redirect back from Paystack after payment — this was completely
  // missing before, so a successful payment never actually got confirmed here
  // and upgrades relied 100% on the webhook with no visible fallback.
  useEffect(() => {
    if (authLoading || !user) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("payment") !== "success") return;
    const reference = params.get("reference") || params.get("trxref");
    if (!reference) return;

    setVerifyingPayment(true);
    (async () => {
      try {
        const res = await apiRequest("POST", "/api/payments/verify", { reference });
        const data = await res.json();
        if (res.ok && data.success) {
          toast({ title: "Payment confirmed!", description: `You're now on the ${data.tier} plan.` });
          await refetchUser();
          queryClient.invalidateQueries({ queryKey: ["/api/user/credits"] });
        } else {
          toast({
            title: "Payment received, but upgrade didn't apply",
            description: data.message || "Please contact support with your payment reference so we can fix this manually.",
            variant: "destructive",
          });
        }
      } catch {
        toast({
          title: "Couldn't confirm payment",
          description: "If you were charged, contact support with your payment reference — we'll fix it manually.",
          variant: "destructive",
        });
      } finally {
        setVerifyingPayment(false);
        window.history.replaceState({}, "", "/marketplace");
      }
    })();
  }, [authLoading, user]);

  if (authLoading || !user || verifyingPayment) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-pulse text-muted-foreground">{verifyingPayment ? "Confirming your payment..." : "Loading..."}</div>
      </div>
    );
  }

  const isTeacher = user.role === "teacher" || user.role === "lecturer" || user.role === "school";

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b border-border/50 backdrop-blur-lg bg-background/80">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-4">
              <Button variant="ghost" size="icon" asChild className="hover-elevate active-elevate-2">
                <Link href="/dashboard">
                  <a data-testid="link-back">
                    <ArrowLeft className="h-5 w-5" />
                  </a>
                </Link>
              </Button>
              <h1 className="font-display font-semibold text-lg">Marketplace</h1>
            </div>
            <div className="flex items-center gap-2">
              <ThemeToggle />
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Stats (for teachers) */}
        {isTeacher && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
            <ScrollReveal>
              <Card data-testid="card-total-sales">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Total Sales</CardTitle>
                  <DollarSign className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">₦0</div>
                  <p className="text-xs text-muted-foreground">All time earnings</p>
                </CardContent>
              </Card>
            </ScrollReveal>

            <ScrollReveal delay={100}>
              <Card data-testid="card-listings">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Active Listings</CardTitle>
                  <TrendingUp className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">0</div>
                  <p className="text-xs text-muted-foreground">Published materials</p>
                </CardContent>
              </Card>
            </ScrollReveal>

            <ScrollReveal delay={200}>
              <Card data-testid="card-purchases">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Downloads</CardTitle>
                  <Download className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">0</div>
                  <p className="text-xs text-muted-foreground">Total downloads</p>
                </CardContent>
              </Card>
            </ScrollReveal>
          </div>
        )}

        {/* Search and Actions */}
        <div className="flex flex-col sm:flex-row gap-4 mb-8">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search materials..."
              className="pl-10"
              data-testid="input-search"
            />
          </div>
          {isTeacher && (
            <Button className="hover-elevate active-elevate-2" data-testid="button-upload-material">
              <Plus className="h-4 w-4 mr-2" />
              Upload Material
            </Button>
          )}
        </div>

        {/* Empty State */}
        <div className="text-center py-16">
          <ScrollReveal>
            <div className="max-w-md mx-auto">
              <div className="h-20 w-20 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-6">
                <ShoppingCart className="h-10 w-10 text-primary" />
              </div>
              <h2 className="text-2xl font-display font-semibold mb-3">
                {isTeacher ? "Start Selling Your Materials" : "Marketplace Coming Soon"}
              </h2>
              <p className="text-muted-foreground mb-6">
                {isTeacher
                  ? "Upload your books, notes, and course materials to sell to students via Paystack"
                  : "Browse and purchase course materials from experienced educators"}
              </p>
              {isTeacher && (
                <Button
                  size="lg"
                  className="hover-elevate active-elevate-2"
                  data-testid="button-get-started"
                >
                  <Plus className="h-5 w-5 mr-2" />
                  Upload First Material
                </Button>
              )}
            </div>
          </ScrollReveal>
        </div>
      </main>
    </div>
  );
}
