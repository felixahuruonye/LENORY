// client/src/pages/website/WebsiteDeploy.tsx
import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ChevronLeft, Rocket, Github, Globe, Smartphone,
  Loader2, CheckCircle2, XCircle, ExternalLink,
  Copy, RefreshCw, Clock, Settings, Zap,
  Link2, Share2, Download, FileText, Code2,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";

// ─── TYPES ─────────────────────────────────────────────────────────────────────

interface Deployment {
  id: string;
  project_id: string;
  platform: "vercel" | "github" | "capacitor" | "lenory";
  url: string | null;
  status: "pending" | "success" | "failed";
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

interface AppProject {
  id: string;
  title: string;
  description: string | null;
  html_code: string | null;
  css_code: string | null;
  js_code: string | null;
  created_at: string;
  updated_at: string;
}

// ─── MAIN COMPONENT ──────────────────────────────────────────────────────────

export default function WebsiteDeploy() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const [selectedApp, setSelectedApp] = useState<string | null>(null);
  const [customDomain, setCustomDomain] = useState("");
  const [isDeploying, setIsDeploying] = useState(false);

  const isPro = user?.subscriptionTier === 'pro' || user?.subscriptionTier === 'premium';

  // ─── QUERIES ────────────────────────────────────────────────────────────────

  // Get all apps
  const { data: apps = [], isLoading: appsLoading } = useQuery<AppProject[]>({
    queryKey: ["/api/website/apps"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/website/apps");
      return res.json();
    },
  });

  // Get deployments for an app
  const { data: deployments = [], refetch: refetchDeployments } = useQuery<Deployment[]>({
    queryKey: ["/api/website/deployments", selectedApp],
    queryFn: async () => {
      if (!selectedApp) return [];
      const res = await apiRequest("GET", `/api/website/deployments/${selectedApp}`);
      return res.json();
    },
    enabled: !!selectedApp,
  });

  // ─── MUTATIONS ──────────────────────────────────────────────────────────────

  // Deploy app
  const deployMutation = useMutation({
    mutationFn: async ({ appId, platform, domain }: { appId: string; platform: string; domain?: string }) => {
      const res = await apiRequest("POST", `/api/website/deploy/${appId}`, { platform, domain });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Deployed!", description: "Your app is now live." });
      setIsDeploying(false);
      refetchDeployments();
    },
    onError: (err: any) => {
      toast({ title: "Deploy failed", description: err.message, variant: "destructive" });
      setIsDeploying(false);
    },
  });

  // ─── HANDLERS ──────────────────────────────────────────────────────────────

  const handleDeploy = (appId: string, platform: string) => {
    if (!isPro) {
      toast({
        title: "Pro feature",
        description: "Deployment is available on Pro and Premium plans.",
        variant: "destructive",
      });
      return;
    }
    setIsDeploying(true);
    deployMutation.mutate({ appId, platform, domain: customDomain || undefined });
  };

  const handleCopyUrl = (url: string) => {
    navigator.clipboard.writeText(url);
    toast({ title: "Copied!", description: "URL copied to clipboard." });
  };

  const getStatusIcon = (status: string) => {
    if (status === "success") return <CheckCircle2 className="h-4 w-4 text-green-500" />;
    if (status === "failed") return <XCircle className="h-4 w-4 text-red-500" />;
    return <Loader2 className="h-4 w-4 animate-spin text-yellow-500" />;
  };

  const getPlatformIcon = (platform: string) => {
    const icons: Record<string, any> = {
      vercel: Rocket,
      github: Github,
      capacitor: Smartphone,
      lenory: Globe,
    };
    return icons[platform] || Globe;
  };

  const selectedAppData = apps.find((a) => a.id === selectedApp);

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-10 border-b border-border/50 bg-background/95 backdrop-blur px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => setLocation("/website-builder")}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <div className="flex items-center gap-2">
              <Rocket className="h-6 w-6 text-primary" />
              <h1 className="text-xl font-bold">Deploy</h1>
              <Badge variant="secondary" className="text-xs">
                {isPro ? "Pro" : "Upgrade to deploy"}
              </Badge>
            </div>
          </div>
          {!isPro && (
            <Button
              size="sm"
              className="gap-2 bg-gradient-to-r from-amber-500 to-orange-500"
              onClick={() => setLocation("/pricing")}
            >
              <Zap className="h-4 w-4" />
              Upgrade to Deploy
            </Button>
          )}
        </div>
      </header>

      <main className="p-6 max-w-4xl mx-auto">
        {/* Select App */}
        <Card className="p-6 mb-6">
          <h2 className="font-semibold mb-4">Select App to Deploy</h2>
          {appsLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : apps.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Code2 className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>No apps to deploy. Build one first!</p>
              <Button variant="outline" className="mt-4" onClick={() => setLocation("/website-builder")}>
                Go Build
              </Button>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {apps.map((app) => (
                <Card
                  key={app.id}
                  className={`p-4 cursor-pointer hover-elevate transition-all ${
                    selectedApp === app.id ? "border-primary/50 shadow-primary/20" : ""
                  }`}
                  onClick={() => setSelectedApp(app.id)}
                >
                  <h3 className="font-medium truncate">{app.title}</h3>
                  <p className="text-sm text-muted-foreground truncate">
                    {app.description || "No description"}
                  </p>
                  <p className="text-xs text-muted-foreground mt-2">
                    {formatDistanceToNow(new Date(app.updated_at), { addSuffix: true })}
                  </p>
                </Card>
              ))}
            </div>
          )}
        </Card>

        {/* Deploy Options */}
        {selectedApp && selectedAppData && (
          <div className="space-y-6">
            <Card className="p-6">
              <h2 className="font-semibold mb-4">Deploy {selectedAppData.title}</h2>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {[
                  { id: "vercel", label: "Vercel", icon: Rocket, description: "One-click deploy to Vercel" },
                  { id: "github", label: "GitHub", icon: Github, description: "Push to GitHub repository" },
                  { id: "capacitor", label: "Mobile App", icon: Smartphone, description: "Export as iOS/Android app" },
                  { id: "lenory", label: "LENORY Host", icon: Globe, description: "Deploy on LENORY subdomain" },
                ].map((platform) => (
                  <Card
                    key={platform.id}
                    className="p-4 text-center hover-elevate cursor-pointer transition-all"
                    onClick={() => handleDeploy(selectedApp, platform.id)}
                  >
                    <platform.icon className="h-8 w-8 mx-auto text-primary mb-2" />
                    <h3 className="font-semibold">{platform.label}</h3>
                    <p className="text-xs text-muted-foreground">{platform.description}</p>
                    {!isPro && (
                      <Badge variant="outline" className="mt-2 text-amber-500 border-amber-500">
                        Pro
                      </Badge>
                    )}
                  </Card>
                ))}
              </div>

              {isPro && (
                <div className="mt-4 pt-4 border-t border-border/50">
                  <div className="flex items-center gap-2">
                    <label className="text-sm font-medium">Custom Domain (optional)</label>
                    <Input
                      placeholder="myapp.com"
                      value={customDomain}
                      onChange={(e) => setCustomDomain(e.target.value)}
                      className="max-w-xs"
                    />
                    <Button variant="outline" size="sm" className="gap-2">
                      <Link2 className="h-4 w-4" />
                      Verify
                    </Button>
                  </div>
                </div>
              )}
            </Card>

            {/* Deployment History */}
            <Card className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-semibold">Deployment History</h2>
                <Button variant="outline" size="sm" onClick={() => refetchDeployments()}>
                  <RefreshCw className="h-4 w-4" />
                </Button>
              </div>

              {deployments.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Clock className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p>No deployments yet</p>
                  <p className="text-sm">Deploy your app to see history here.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {deployments.map((deployment) => {
                    const PlatformIcon = getPlatformIcon(deployment.platform);
                    return (
                      <div
                        key={deployment.id}
                        className="flex items-center justify-between p-3 bg-muted/30 rounded-lg"
                      >
                        <div className="flex items-center gap-3">
                          <PlatformIcon className="h-5 w-5 text-muted-foreground" />
                          <div>
                            <p className="font-medium text-sm capitalize">{deployment.platform}</p>
                            <div className="flex items-center gap-2 text-xs text-muted-foreground">
                              {getStatusIcon(deployment.status)}
                              <span>{deployment.status}</span>
                              <span>•</span>
                              <span>{formatDistanceToNow(new Date(deployment.created_at), { addSuffix: true })}</span>
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {deployment.url && (
                            <>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 px-2 text-xs gap-1"
                                onClick={() => handleCopyUrl(deployment.url!)}
                              >
                                <Copy className="h-3 w-3" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 px-2 text-xs gap-1"
                                onClick={() => window.open(deployment.url!, "_blank")}
                              >
                                <ExternalLink className="h-3 w-3" />
                              </Button>
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>
          </div>
        )}
      </main>
    </div>
  );
}
