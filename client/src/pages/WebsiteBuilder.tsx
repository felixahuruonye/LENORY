// client/src/pages/website/WebsiteBuilder.tsx
import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  ChevronLeft, Code2, Search, Mic, Plus, Sparkles, Star,
  FolderOpen, Settings, LogOut, Heart, Clock, Globe,
  Upload, Link2, Figma, Github, Database, LayoutTemplate,
  Rocket, Zap, Crown, Coins, Loader2, ExternalLink,
  MessageSquare, ImageIcon, Brain, Monitor, Home, Users,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { WebsiteSidebar } from "@/components/website/WebsiteSidebar";
import { ModelSelector } from "@/components/website/ModelSelector";
import { ActionButtons } from "@/components/website/ActionButtons";
import { AppCard } from "@/components/website/AppCard";

interface AppProject {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  html_code: string | null;
  css_code: string | null;
  js_code: string | null;
  framework: string;
  is_template: boolean;
  is_published: boolean;
  view_count: number;
  favorite_count: number;
  is_favorite: boolean;
  created_at: string;
  updated_at: string;
}

export default function WebsiteBuilder() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const [prompt, setPrompt] = useState("");
  const [mode, setMode] = useState<"plan" | "build">("plan");
  const [selectedModel, setSelectedModel] = useState("ultra");
  const [showNewDialog, setShowNewDialog] = useState(false);
  const [newAppName, setNewAppName] = useState("");
  const [newAppDescription, setNewAppDescription] = useState("");
  const [showFavorites, setShowFavorites] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const isPro = user?.subscriptionTier === 'pro' || user?.subscriptionTier === 'premium';

  // ─── QUERIES ────────────────────────────────────────────────────────────────

  // Get all apps
  const { data: apps = [], isLoading: appsLoading, refetch: refetchApps } = useQuery<AppProject[]>({
    queryKey: ["/api/website/apps"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/website/apps");
      return res.json();
    },
  });

  // Get favorites
  const { data: favorites = [] } = useQuery<AppProject[]>({
    queryKey: ["/api/website/favorites"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/website/favorites");
      return res.json();
    },
    enabled: showFavorites,
  });

  // ─── MUTATIONS ──────────────────────────────────────────────────────────────

  // Generate app
  const generateMutation = useMutation({
    mutationFn: async ({ prompt, model, mode }: { prompt: string; model: string; mode: string }) => {
      const res = await apiRequest("POST", "/api/website/generate", { prompt, model, mode });
      return res.json();
    },
    onSuccess: (data) => {
      refetchApps();
      toast({ title: "App generated!", description: "Your app is ready to preview." });
      setLocation(`/website-editor/${data.id}`);
      setPrompt("");
    },
    onError: (err: any) => {
      toast({ title: "Generation failed", description: err.message, variant: "destructive" });
    },
  });

  // Toggle favorite
  const favoriteMutation = useMutation({
    mutationFn: async ({ id, favorite }: { id: string; favorite: boolean }) => {
      const res = await apiRequest("PATCH", `/api/website/apps/${id}`, { is_favorite: favorite });
      return res.json();
    },
    onSuccess: () => {
      refetchApps();
    },
  });

  // Delete app
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/website/apps/${id}`);
    },
    onSuccess: () => {
      refetchApps();
      toast({ title: "App deleted" });
    },
    onError: (err: any) => {
      toast({ title: "Failed to delete", description: err.message, variant: "destructive" });
    },
  });

  // ─── HANDLERS ──────────────────────────────────────────────────────────────

  const handleGenerate = () => {
    if (!prompt.trim()) {
      toast({ title: "Prompt required", description: "Please describe what you want to build.", variant: "destructive" });
      return;
    }
    if (mode === "build" && !isPro) {
      toast({ title: "Pro feature", description: "Build mode is available on Pro and Premium plans.", variant: "destructive" });
      return;
    }
    generateMutation.mutate({ prompt: prompt.trim(), model: selectedModel, mode });
  };

  const handleNewApp = () => {
    if (!newAppName.trim()) {
      toast({ title: "Name required", variant: "destructive" });
      return;
    }
    toast({ title: "App created!", description: "Starting your new project..." });
    setShowNewDialog(false);
    setNewAppName("");
    setNewAppDescription("");
  };

  const handleOpenApp = (app: AppProject) => {
    setLocation(`/website-editor/${app.id}`);
  };

  const handleToggleFavorite = (app: AppProject) => {
    favoriteMutation.mutate({ id: app.id, favorite: !app.is_favorite });
  };

  const handleDeleteApp = (app: AppProject) => {
    if (confirm(`Delete "${app.title}"?`)) {
      deleteMutation.mutate(app.id);
    }
  };

  const formatDate = (date: string) => {
    return formatDistanceToNow(new Date(date), { addSuffix: true });
  };

  const displayedApps = showFavorites ? favorites : apps;

  return (
    <div className="min-h-screen bg-background flex">
      {/* ─── SIDEBAR ──────────────────────────────────────────────────────────── */}
      <WebsiteSidebar
        favorites={favorites}
        apps={apps}
        collapsed={sidebarCollapsed}
        onToggle={() => setSidebarCollapsed(!sidebarCollapsed)}
      />

      {/* ─── MAIN CONTENT ────────────────────────────────────────────────────── */}
      <main className="flex-1 min-w-0 overflow-y-auto">
        {/* Header */}
        <header className="sticky top-0 z-10 border-b border-border/50 bg-background/95 backdrop-blur px-6 py-4">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <h1 className="text-xl font-bold">What will you build next?</h1>
              {!isPro && (
                <Badge variant="outline" className="text-amber-500 border-amber-500">
                  Free Plan
                </Badge>
              )}
              {isPro && (
                <Badge variant="default" className="bg-gradient-to-r from-purple-500 to-pink-500">
                  <Crown className="h-3 w-3 mr-1" />
                  {user?.subscriptionTier === 'premium' ? 'Premium' : 'Pro'}
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowFavorites(!showFavorites)}
                className="gap-2"
              >
                <Heart className={`h-4 w-4 ${showFavorites ? "fill-red-500 text-red-500" : ""}`} />
                {showFavorites ? "All Apps" : "Favorites"}
              </Button>
              {!isPro && (
                <Button
                  size="sm"
                  className="gap-2 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600"
                  onClick={() => setLocation("/pricing")}
                >
                  <Crown className="h-4 w-4" />
                  Upgrade
                </Button>
              )}
            </div>
          </div>
        </header>

        <div className="p-6 max-w-5xl mx-auto">
          {/* ─── HERO SECTION ──────────────────────────────────────────────────── */}
          <div className="text-center mb-8">
            <div className="flex items-center justify-center gap-4 mb-4">
              <div className="flex items-center gap-2 bg-muted/50 rounded-full p-1">
                <Button
                  variant={mode === "plan" ? "default" : "ghost"}
                  size="sm"
                  onClick={() => setMode("plan")}
                  className="rounded-full"
                >
                  <Zap className="h-4 w-4 mr-1" />
                  Plan
                </Button>
                <Button
                  variant={mode === "build" ? "default" : "ghost"}
                  size="sm"
                  onClick={() => setMode("build")}
                  className={`rounded-full ${mode === "build" ? "" : "opacity-50"}`}
                  disabled={!isPro}
                >
                  <Rocket className="h-4 w-4 mr-1" />
                  Build
                  {!isPro && <span className="text-[10px] ml-1">(Pro)</span>}
                </Button>
              </div>
            </div>

            <p className="text-muted-foreground text-sm">
              {mode === "plan"
                ? "Plan your app architecture with AI guidance. Free for all users."
                : "Build and deploy full applications with AI assistance. Pro & Premium only."}
            </p>
          </div>

          {/* ─── MAIN INPUT ────────────────────────────────────────────────────── */}
          <Card className="p-6 mb-6 border-2 border-primary/20 shadow-lg">
            <div className="space-y-4">
              <div className="flex items-start gap-4">
                <div className="flex-1">
                  <Textarea
                    placeholder="Describe the app you want to create..."
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    className="min-h-[80px] resize-none text-lg border-0 focus-visible:ring-0 p-0"
                    data-testid="input-app-prompt"
                  />
                </div>
                <Button
                  onClick={handleGenerate}
                  disabled={!prompt.trim() || generateMutation.isPending || (mode === "build" && !isPro)}
                  className="gap-2 hover-elevate px-8 shrink-0"
                  data-testid="button-generate-app"
                >
                  {generateMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : mode === "build" ? (
                    <Rocket className="h-4 w-4" />
                  ) : (
                    <Zap className="h-4 w-4" />
                  )}
                  {generateMutation.isPending ? "Generating..." : mode === "build" ? "Build" : "Plan"}
                </Button>
              </div>

              {/* ─── ACTION BUTTONS ────────────────────────────────────────────── */}
              <ActionButtons
                onNew={() => setShowNewDialog(true)}
                onUpload={() => toast({ title: "Upload", description: "File upload coming soon!" })}
                onUrl={() => toast({ title: "From URL", description: "URL import coming soon!" })}
                onFigma={() => toast({ title: "Figma", description: "Figma import coming soon!" })}
                onGithub={() => toast({ title: "GitHub", description: "GitHub integration coming soon!" })}
                onVoice={() => toast({ title: "Voice", description: "Voice input coming soon!" })}
              />

              {/* ─── MODEL SELECTOR ────────────────────────────────────────────── */}
              <ModelSelector
                selected={selectedModel}
                onSelect={setSelectedModel}
                isPro={isPro}
              />
            </div>
          </Card>

          {/* ─── RECENT APPS ───────────────────────────────────────────────────── */}
          <div className="mb-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <Clock className="h-5 w-5 text-muted-foreground" />
                {showFavorites ? "Favorites" : "Recent Apps"}
                <Badge variant="secondary" className="text-xs">
                  {displayedApps.length}
                </Badge>
              </h2>
              <Button variant="ghost" size="sm" onClick={() => setLocation("/website-builder/apps")}>
                View All <ChevronLeft className="h-4 w-4 rotate-180" />
              </Button>
            </div>

            {appsLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
              </div>
            ) : displayedApps.length === 0 ? (
              <Card className="p-12 text-center text-muted-foreground">
                <Code2 className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>{showFavorites ? "No favorites yet." : "No apps yet. Describe what you want to build to get started."}</p>
                {showFavorites && (
                  <Button variant="outline" className="mt-4" onClick={() => setShowFavorites(false)}>
                    View All Apps
                  </Button>
                )}
              </Card>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {displayedApps.slice(0, 9).map((app: AppProject) => (
                  <AppCard
                    key={app.id}
                    app={app}
                    onOpen={() => handleOpenApp(app)}
                    onFavorite={() => handleToggleFavorite(app)}
                    onDelete={() => handleDeleteApp(app)}
                    formatDate={formatDate}
                  />
                ))}
              </div>
            )}
          </div>

          {/* ─── TEMPLATES PROMO ───────────────────────────────────────────────── */}
          <Card className="p-6 bg-gradient-to-r from-primary/10 to-primary/5 border-primary/20">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                <LayoutTemplate className="h-10 w-10 text-primary" />
                <div>
                  <h3 className="font-semibold">Community Templates</h3>
                  <p className="text-sm text-muted-foreground">Explore templates built by the community</p>
                </div>
              </div>
              <Button onClick={() => setLocation("/website-templates")} className="gap-2 hover-elevate">
                Browse Templates <ChevronLeft className="h-4 w-4 rotate-180" />
              </Button>
            </div>
          </Card>
        </div>
      </main>

      {/* ─── NEW APP DIALOG ──────────────────────────────────────────────────── */}
      <Dialog open={showNewDialog} onOpenChange={setShowNewDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Plus className="h-5 w-5 text-primary" />
              Create New App
            </DialogTitle>
            <DialogDescription>Start building your app from scratch or use a template.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium">App Name *</label>
              <Input
                placeholder="My Amazing App"
                value={newAppName}
                onChange={(e) => setNewAppName(e.target.value)}
                className="mt-1"
              />
            </div>
            <div>
              <label className="text-sm font-medium">Description</label>
              <Textarea
                placeholder="What does your app do?"
                value={newAppDescription}
                onChange={(e) => setNewAppDescription(e.target.value)}
                className="mt-1 resize-none"
                rows={2}
              />
            </div>
            <div className="flex gap-2">
              <Button onClick={handleNewApp} className="flex-1 hover-elevate">
                Create App
              </Button>
              <Button variant="outline" onClick={() => setShowNewDialog(false)}>
                Cancel
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
