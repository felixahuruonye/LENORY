import { useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useCredits } from "@/hooks/useCredits";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Link } from "wouter";
import { ArrowLeft, Check, Zap, Crown, Coins, RefreshCcw, Star } from "lucide-react";

const PRICING_TIERS = [
  {
    id: "free",
    name: "Free",
    description: "Get started with LENORY",
    priceNaira: 0,
    credits: "10/day (50/month)",
    features: [
      "10 AI credits per day",
      "50 credits per month max",
      "Basic AI tutor chat",
      "5 image generations/month",
      "2 projects",
      "Study memory",
      "CBT practice",
    ],
    popular: false,
    cta: "Current Plan",
  },
  {
    id: "pro",
    name: "Pro",
    description: "Serious learners & exam prep",
    priceNaira: 5000,
    credits: "50/day (unlimited)",
    features: [
      "50 AI credits per day",
      "Unlimited monthly credits",
      "Advanced AI tutor with Gemini",
      "50 image generations/month",
      "20 projects",
      "Website generator",
      "Voice features",
      "CBT simulation (JAMB/WAEC/NECO)",
      "Priority support",
    ],
    popular: true,
    cta: "Get Pro",
  },
  {
    id: "premium",
    name: "Premium",
    description: "For schools & institutions",
    priceNaira: 15000,
    credits: "Unlimited",
    features: [
      "Unlimited AI credits",
      "Everything in Pro",
      "Unlimited projects & generations",
      "Team management (5 users)",
      "Advanced learning analytics",
      "Custom branding",
      "API access",
      "Dedicated support",
      "Video generation",
    ],
    popular: false,
    cta: "Get Premium",
  },
];

const TOPUP_PACKS = [
  { amount: 10, naira: 1000, label: "Starter", color: "border-blue-500/30 bg-blue-500/5" },
  { amount: 25, naira: 2500, label: "Popular", color: "border-primary/50 bg-primary/5", badge: true },
  { amount: 50, naira: 5000, label: "Power Pack", color: "border-purple-500/30 bg-purple-500/5" },
  { amount: 100, naira: 10000, label: "Pro Bundle", color: "border-amber-500/30 bg-amber-500/5" },
];

const TIER_RANK: Record<string, number> = { free: 0, pro: 1, premium: 2 };

export default function Pricing() {
  const { user } = useAuth();
  const { credits, topup, isTopupPending } = useCredits();
  const { toast } = useToast();
  const [loading, setLoading] = useState("");

  const currentTier = (user as any)?.subscriptionTier || "free";

  const handleUpgrade = async (tierId: string) => {
    setLoading(tierId);
    try {
      const response = await apiRequest("POST", "/api/payments/initialize", { tierId, email: user?.email });
      const data = await response.json();
      if (data.authorizationUrl) {
        window.location.href = data.authorizationUrl;
      } else {
        toast({ title: "Error", description: "Failed to initialize payment", variant: "destructive" });
      }
    } catch {
      toast({ title: "Error", description: "Payment initialization failed", variant: "destructive" });
    } finally {
      setLoading("");
    }
  };

  const handleDowngrade = async (tierId: string) => {
    setLoading(tierId);
    try {
      const response = await apiRequest("POST", "/api/subscription/downgrade", { targetTier: tierId });
      const data = await response.json();
      if (data.success) {
        toast({ title: "Plan changed", description: `You are now on the ${tierId} plan. Changes take effect immediately.` });
        // Force a page reload so useAuth reflects the new tier
        setTimeout(() => window.location.reload(), 1200);
      } else {
        toast({ title: "Error", description: data.message || "Failed to downgrade", variant: "destructive" });
      }
    } catch {
      toast({ title: "Error", description: "Downgrade failed", variant: "destructive" });
    } finally {
      setLoading("");
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-primary/5">
      {/* Header */}
      <div className="sticky top-0 z-50 backdrop-blur-xl bg-background/80 border-b border-primary/10">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Button variant="ghost" size="icon" asChild className="hover-elevate">
                <Link href="/dashboard"><ArrowLeft className="h-5 w-5" /></Link>
              </Button>
              <div>
                <h1 className="text-2xl font-bold">Plans &amp; Credits</h1>
                <p className="text-sm text-muted-foreground">Choose your LENORY plan</p>
              </div>
            </div>
            {credits && (
              <div className="flex items-center gap-2 px-3 py-1.5 bg-secondary/50 rounded-full border border-primary/20" data-testid="badge-current-credits">
                <Coins className="h-4 w-4 text-primary" />
                <span className="text-sm font-bold">{credits.isAdmin ? "∞" : credits.balance}</span>
                <span className="text-xs text-muted-foreground">credits left</span>
              </div>
            )}
          </div>
        </div>
      </div>

      <main className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        {/* Credit Top-Up Section */}
        <div className="mb-16">
          <div className="text-center mb-8">
            <div className="inline-flex items-center gap-2 px-3 py-1 bg-primary/10 rounded-full text-primary text-sm font-medium mb-4">
              <Coins className="h-4 w-4" />
              No Subscription? No Problem.
            </div>
            <h2 className="text-2xl font-bold">Buy Credits On-Demand</h2>
            <p className="text-muted-foreground mt-2">₦100 per credit. Use for AI chats, image generation, and more.</p>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {TOPUP_PACKS.map((pack) => (
              <Card key={pack.amount} className={`relative cursor-pointer hover-elevate border-2 ${pack.color}`} data-testid={`card-topup-${pack.amount}`}>
                {pack.badge && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                    <Badge className="bg-primary text-primary-foreground">
                      <Star className="h-3 w-3 mr-1" />
                      Popular
                    </Badge>
                  </div>
                )}
                <CardContent className="p-4 text-center">
                  <p className="text-3xl font-bold mb-1">{pack.amount}</p>
                  <p className="text-xs text-muted-foreground mb-3">credits</p>
                  <p className="font-semibold text-primary">₦{pack.naira.toLocaleString()}</p>
                  <p className="text-xs text-muted-foreground mb-4">{pack.label}</p>
                  <Button
                    className="w-full"
                    size="sm"
                    onClick={() => topup(pack.amount)}
                    disabled={isTopupPending}
                    data-testid={`button-buy-credits-${pack.amount}`}
                  >
                    {isTopupPending ? <RefreshCcw className="h-4 w-4 animate-spin" /> : "Buy Now"}
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>

        {/* Subscription Plans */}
        <div className="mb-8 text-center">
          <h2 className="text-3xl font-bold mb-2">Or Subscribe for More Power</h2>
          <p className="text-muted-foreground">Monthly plans with higher daily credit limits</p>
        </div>

        <div className="grid md:grid-cols-3 gap-6 mb-16">
          {PRICING_TIERS.map((tier) => (
            <Card
              key={tier.id}
              className={`relative transition-all border-primary/20 ${tier.popular ? "ring-2 ring-primary scale-105 shadow-xl shadow-primary/20" : ""}`}
              data-testid={`card-pricing-${tier.id}`}
            >
              {tier.popular && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                  <Badge className="bg-primary text-primary-foreground" data-testid={`badge-popular-${tier.id}`}>
                    Most Popular
                  </Badge>
                </div>
              )}

              <CardHeader className="pb-4">
                <div className="flex items-center gap-2 mb-2">
                  {tier.id === "premium" && <Crown className="h-5 w-5 text-purple-500" />}
                  {tier.id === "pro" && <Zap className="h-5 w-5 text-blue-500" />}
                  {tier.id === "free" && <Coins className="h-5 w-5 text-muted-foreground" />}
                  <CardTitle className="text-2xl">{tier.name}</CardTitle>
                </div>
                <CardDescription>{tier.description}</CardDescription>
                <div className="mt-4">
                  <div className="flex items-baseline gap-1">
                    <span className="text-4xl font-bold">
                      {tier.priceNaira === 0 ? "Free" : `₦${tier.priceNaira.toLocaleString()}`}
                    </span>
                    {tier.priceNaira > 0 && <span className="text-muted-foreground">/month</span>}
                  </div>
                  <div className="flex items-center gap-1.5 mt-2">
                    <Coins className="h-4 w-4 text-primary" />
                    <span className="text-sm font-medium text-primary">{tier.credits}</span>
                  </div>
                </div>
              </CardHeader>

              <CardContent className="space-y-6">
                {(() => {
                  const isCurrent = tier.id === currentTier;
                  const isLower = (TIER_RANK[tier.id] ?? 0) < (TIER_RANK[currentTier] ?? 0);
                  const isHigher = (TIER_RANK[tier.id] ?? 0) > (TIER_RANK[currentTier] ?? 0);
                  if (isCurrent) {
                    return (
                      <Button className="w-full" variant="outline" disabled data-testid={`button-subscribe-${tier.id}`}>
                        Current Plan
                      </Button>
                    );
                  }
                  if (isLower) {
                    return (
                      <Button
                        className="w-full"
                        variant="ghost"
                        onClick={() => handleDowngrade(tier.id)}
                        disabled={loading !== ""}
                        data-testid={`button-subscribe-${tier.id}`}
                      >
                        {loading === tier.id ? "Switching..." : `Downgrade to ${tier.name}`}
                      </Button>
                    );
                  }
                  // isHigher — upgrade via Paystack
                  return (
                    <Button
                      className="w-full"
                      variant="default"
                      onClick={() => handleUpgrade(tier.id)}
                      disabled={loading !== ""}
                      data-testid={`button-subscribe-${tier.id}`}
                    >
                      {loading === tier.id ? "Processing..." : tier.cta}
                    </Button>
                  );
                })()}

                <div className="space-y-2">
                  {tier.features.map((feature, idx) => (
                    <div key={idx} className="flex items-start gap-2" data-testid={`feature-${tier.id}-${idx}`}>
                      <Check className="w-4 h-4 text-primary flex-shrink-0 mt-0.5" />
                      <span className="text-sm text-foreground">{feature}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Feature Comparison */}
        <div className="mb-16">
          <h2 className="text-2xl font-bold mb-6">Feature Comparison</h2>
          <div className="rounded-lg border border-primary/10 overflow-hidden">
            <div className="grid grid-cols-4 bg-secondary/30">
              <div className="p-4 font-semibold border-r border-primary/10 text-sm">Feature</div>
              <div className="p-4 font-semibold border-r border-primary/10 text-sm text-center">Free</div>
              <div className="p-4 font-semibold border-r border-primary/10 text-sm text-center text-primary">Pro</div>
              <div className="p-4 font-semibold text-sm text-center">Premium</div>
            </div>
            {[
              { feature: "Daily AI Credits", free: "10", pro: "50", premium: "Unlimited" },
              { feature: "Monthly Credits", free: "50 max", pro: "1,500", premium: "Unlimited" },
              { feature: "AI Chat", free: "Basic", pro: "Advanced", premium: "Advanced" },
              { feature: "Image Generation", free: "5/month", pro: "50/month", premium: "Unlimited" },
              { feature: "Website Builder", free: "No", pro: "Yes", premium: "Yes" },
              { feature: "CBT Practice", free: "Basic", pro: "Full", premium: "Full" },
              { feature: "Voice Features", free: "No", pro: "Yes", premium: "Yes" },
              { feature: "Video Generation", free: "No", pro: "No", premium: "Yes" },
              { feature: "Team Access", free: "No", pro: "No", premium: "5 users" },
            ].map((row, idx) => (
              <div key={idx} className={`grid grid-cols-4 border-t border-primary/10 ${idx % 2 === 0 ? "" : "bg-secondary/10"}`}>
                <div className="p-3 text-sm font-medium border-r border-primary/10">{row.feature}</div>
                <div className="p-3 text-sm text-center border-r border-primary/10 text-muted-foreground">{row.free}</div>
                <div className="p-3 text-sm text-center border-r border-primary/10 text-primary font-medium">{row.pro}</div>
                <div className="p-3 text-sm text-center">{row.premium}</div>
              </div>
            ))}
          </div>
        </div>

        {/* FAQ */}
        <div>
          <h2 className="text-2xl font-bold mb-6">Frequently Asked Questions</h2>
          <div className="space-y-4">
            {[
              { q: "What are credits?", a: "Credits power all AI features on LENORY. Each AI message costs 1 credit. Image generation costs 2, video costs 5. Credits refresh daily based on your plan." },
              { q: "Do credits expire?", a: "Free plan: unused credits don't carry over the monthly limit. Pro & Premium: credits accumulate up to their limits. Purchased credits never expire." },
              { q: "Can I change my plan anytime?", a: "Yes! Upgrade or downgrade at any time. Changes take effect immediately." },
              { q: "What payment methods are accepted?", a: "All Paystack methods: cards, bank transfers, and mobile money." },
              { q: "Do you offer student discounts?", a: "Contact support@lenory.ai for special pricing for students and schools." },
            ].map((faq, idx) => (
              <div key={idx} className="p-4 rounded-lg border border-primary/10 hover-elevate">
                <h3 className="font-semibold mb-2">{faq.q}</h3>
                <p className="text-muted-foreground text-sm">{faq.a}</p>
              </div>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}
