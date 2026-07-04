import { useState, useEffect, useRef } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useCredits } from "@/hooks/useCredits";
import { useDashboardStats, useSubscription, useUnreadNotifications, useChatSessions } from "@/hooks/useSupabaseData";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Skeleton } from "@/components/ui/skeleton";
import { Link, useLocation } from "wouter";
import {
  Search, Sparkles, MessageSquare, Code2, Mic, ImageIcon, Brain, Zap, Clock,
  FolderOpen, Settings, LogOut, Monitor, Bell, X, History, ArrowRight,
  BookOpen, Crown, TrendingUp, Coins, ChevronRight, FileText,
} from "lucide-react";

function getGreeting(name: string): { greeting: string; subtitle: string } {
  const hour = new Date().getHours();
  const day = new Date().toLocaleDateString("en-US", { weekday: "long" });
  const firstName = (name || "Learner").split(" ")[0];

  let greeting: string;
  if (hour >= 5 && hour < 12) greeting = `Good morning, ${firstName}`;
  else if (hour >= 12 && hour < 17) greeting = `Good afternoon, ${firstName}`;
  else if (hour >= 17 && hour < 21) greeting = `Good evening, ${firstName}`;
  else greeting = `Hey, night owl ${firstName}`;

  const subtitles: Record<number, string[]> = {
    1: ["Start your week strong — every lesson counts!", "Monday motivation: make today count."],
    2: ["Tuesday is perfect for deep study sessions.", "Keep the momentum going this Tuesday!"],
    3: ["Wednesday wisdom: review what you've learned.", "Halfway through the week — you're doing great!"],
    4: ["Thursday means one step closer to the weekend.", "Power through — your exam prep is on track!"],
    5: ["Friday focus — end the week on a high note!", "One last push before the weekend!"],
    6: ["Saturday learning — future you says thank you.", "Weekend warriors learn faster. Let's go!"],
    0: ["Sunday sessions set you up for a strong week.", "Rest and review go hand in hand on Sundays."],
  };
  const dayIndex = new Date().getDay();
  const dayOptions = subtitles[dayIndex] || ["Keep going — every session makes you smarter!"];
  const subtitle = dayOptions[Math.floor(Date.now() / 86400000) % dayOptions.length];
  return { greeting, subtitle };
}

const fuzzyMatch = (query: string, text: string): number => {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  if (t.includes(q)) return 100;
  let score = 0, queryIdx = 0;
  for (let i = 0; i < t.length && queryIdx < q.length; i++) {
    if (t[i] === q[queryIdx]) { score += 10; queryIdx++; } else score -= 1;
  }
  return queryIdx === q.length ? Math.max(0, score) : -1;
};

export default function AdvancedDashboard() {
  const { user, isLoading: authLoading, signOut } = useAuth();
  const { credits, isLoading: creditsLoading } = useCredits();
  const [, navigate] = useLocation();
  const [searchQuery, setSearchQuery] = useState("");
  const [searchHistory, setSearchHistory] = useState<string[]>([]);
  const [showSearchDropdown, setShowSearchDropdown] = useState(false);
  const [hoveredCard, setHoveredCard] = useState<string | null>(null);
  const [selectedImage, setSelectedImage] = useState<any>(null);
  const [showAllCategories, setShowAllCategories] = useState(false);
  const [showChatHistoryModal, setShowChatHistoryModal] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const { data: chatSessions = [], isLoading: sessionsLoading } = useChatSessions();
  const { data: dashboardStats, isLoading: statsLoading } = useDashboardStats();
  const { data: subscription } = useSubscription();
  const { data: unreadNotifications = [] } = useUnreadNotifications();
  const categoryScrollRef = useRef<HTMLDivElement>(null);

  const aiTools = [
    { id: "chat", name: "LENORY Chat", icon: MessageSquare, description: "Multi-mode conversational AI", color: "from-blue-500 to-cyan-500", href: "/chat", keywords: ["chat", "ask", "ai", "tutor", "help"] },
    { id: "website", name: "Build|Learn App", icon: Code2, description: "AI-powered code & web generation", color: "from-green-500 to-emerald-500", href: "/website-generator", keywords: ["website", "code", "generate", "build", "web", "app"] },
    { id: "live", name: "Write My Note", icon: Mic, description: "Record, transcribe & format notes", color: "from-rose-500 to-pink-500", href: "/live-session", keywords: ["live", "session", "voice", "record", "transcribe", "note", "write"] },
    { id: "image", name: "Image Generation", icon: ImageIcon, description: "DALL-E & image tools", color: "from-orange-500 to-red-500", href: "/image-gen", keywords: ["image", "generate", "photo", "visual", "art"] },
    { id: "memory", name: "Memory Panel", icon: Brain, description: "Learning memory system", color: "from-teal-500 to-cyan-500", href: "/memory", keywords: ["memory", "learn", "remember", "notes", "history"] },
    { id: "cbt", name: "CBT Mode", icon: Monitor, description: "Exam simulation (JAMB/WAEC/NECO)", color: "from-amber-500 to-yellow-500", href: "/cbt-mode", keywords: ["exam", "test", "cbt", "jamb", "waec", "practice"] },
    { id: "workspace", name: "Project Workspace", icon: FolderOpen, description: "Organize your projects", color: "from-purple-500 to-pink-500", href: "/project-workspace", keywords: ["project", "workspace", "organize", "folder", "task"] },
    { id: "settings", name: "Settings", icon: Settings, description: "Customize your experience", color: "from-indigo-500 to-blue-500", href: "/settings", keywords: ["settings", "config", "preferences", "customize"] },
  ];

  const quickActions = [
    { label: "Ask LENORY", icon: MessageSquare, href: "/chat", color: "bg-blue-500/10" },
    { label: "Write My Note", icon: Mic, href: "/live-session", color: "bg-rose-500/10" },
    { label: "Build|Learn App", icon: Code2, href: "/website-generator", color: "bg-emerald-500/10" },
    { label: "CBT Practice", icon: Sparkles, href: "/cbt-mode", color: "bg-amber-500/10" },
  ];

  const searchCategories = [
    { label: "All", value: "all", icon: Search },
    { label: "Chat History", value: "chat", icon: MessageSquare },
    { label: "Notes", value: "notes", icon: FileText },
    { label: "Memory", value: "memory", icon: Brain },
    { label: "Study Plans", value: "study_plan", icon: BookOpen },
    { label: "Exams", value: "exam", icon: Monitor },
    { label: "Websites", value: "website", icon: Code2 },
    { label: "Images", value: "image", icon: ImageIcon },
    { label: "Projects", value: "project", icon: FolderOpen },
    { label: "Lessons", value: "lesson", icon: BookOpen },
  ];

  useEffect(() => {
    try {
      const saved = localStorage.getItem("dashboardSearchHistory");
      if (saved) { const parsed = JSON.parse(saved); if (Array.isArray(parsed)) setSearchHistory(parsed); }
    } catch {}
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") { e.preventDefault(); searchInputRef.current?.focus(); }
      if (e.key === "Escape") { setShowSearchDropdown(false); searchInputRef.current?.blur(); }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const handleSearchChange = (value: string) => {
    setSearchQuery(value);
    setShowSearchDropdown(!!value || searchHistory.length > 0);
  };

  const addToSearchHistory = (query: string) => {
    if (query.trim()) {
      const updated = [query, ...searchHistory.filter((q) => q !== query)].slice(0, 5);
      setSearchHistory(updated);
      try { localStorage.setItem("dashboardSearchHistory", JSON.stringify(updated)); } catch {}
    }
  };

  const clearSearchHistory = () => {
    setSearchHistory([]);
    try { localStorage.removeItem("dashboardSearchHistory"); } catch {}
  };

  const filteredTools = searchQuery
    ? aiTools.map((tool) => {
        const score = Math.max(
          fuzzyMatch(searchQuery, tool.name),
          fuzzyMatch(searchQuery, tool.description),
          tool.keywords.some((kw) => fuzzyMatch(searchQuery, kw) > 0) ? 50 : -1,
        );
        return { ...tool, score };
      }).filter((t) => t.score > 0).sort((a, b) => b.score - a.score)
    : [];

  const handleToolClick = (toolName: string) => {
    addToSearchHistory(toolName);
    setSearchQuery("");
    setShowSearchDropdown(false);
  };

  const handleLogout = async () => {
    await signOut();
    navigate("/");
  };

  const getIconComponent = (iconName: string) => {
    const iconMap: Record<string, any> = { MessageSquare, Brain, BookOpen, Monitor, Code2, ImageIcon, FolderOpen, Search };
    return iconMap[iconName] || Search;
  };

  const { greeting, subtitle } = getGreeting(user?.firstName || user?.email?.split("@")[0] || "");
  const creditPercent = credits ? Math.min(100, Math.round((credits.balance / Math.max(1, credits.maxMonthly)) * 100)) : 0;
  const creditColor = !credits || credits.balance > 10 ? "text-green-500" : credits.balance > 3 ? "text-amber-500" : "text-red-500";

  if (authLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-background via-background to-primary/5">
        <header className="sticky top-0 z-50 backdrop-blur-xl bg-background/80 border-b border-primary/10">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex items-center justify-between h-16">
              <div className="flex items-center gap-3"><Sparkles className="h-6 w-6 text-primary" /><Skeleton className="h-6 w-32" /></div>
              <div className="flex gap-3"><Skeleton className="h-9 w-20" /><Skeleton className="h-9 w-9 rounded-full" /></div>
            </div>
          </div>
        </header>
        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <Skeleton className="h-10 w-64 mb-4" />
          <Skeleton className="h-5 w-48 mb-12" />
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-12">{[1,2,3,4].map(i => <Skeleton key={i} className="h-24 rounded-lg" />)}</div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">{[1,2,3,4,5,6,7,8].map(i => <Skeleton key={i} className="h-48 rounded-lg" />)}</div>
        </main>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background via-background to-primary/5">
        <div className="text-muted-foreground">Please log in to access the dashboard</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-primary/5 transition-all duration-1000 ease-in-out animate-in fade-in zoom-in-95">
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-20 right-20 w-72 h-72 bg-primary/10 rounded-full blur-3xl animate-pulse"></div>
        <div className="absolute bottom-20 left-20 w-96 h-96 bg-chart-2/10 rounded-full blur-3xl animate-pulse delay-1000"></div>
      </div>

      <header className="sticky top-0 z-50 backdrop-blur-xl bg-background/80 border-b border-primary/10 glassmorphism transition-all duration-500">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0">
              <img src="/favicon.png" alt="LENORY" className="h-8 w-8 rounded-xl object-cover" />
              <h1 className="text-base sm:text-xl font-bold bg-gradient-to-r from-primary to-chart-2 bg-clip-text text-transparent">
                LENORY
              </h1>
            </div>

            <div className="hidden md:flex flex-1 max-w-md mx-8 relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
              <Input
                ref={searchInputRef}
                placeholder="Search everything... (Cmd+K)"
                value={searchQuery}
                onChange={(e) => handleSearchChange(e.target.value)}
                onFocus={() => setShowSearchDropdown(true)}
                className="pl-10 pr-8 bg-secondary/50 border-primary/20 focus:border-primary/50"
                data-testid="input-search-dashboard"
              />
              {searchQuery && (
                <button onClick={() => { setSearchQuery(""); setShowSearchDropdown(false); }} className="absolute right-3 top-1/2 transform -translate-y-1/2 hover-elevate" data-testid="button-clear-search">
                  <X className="h-4 w-4 text-muted-foreground" />
                </button>
              )}
              {showSearchDropdown && (
                <Card className="absolute top-full left-0 right-0 mt-2 shadow-xl border-primary/20 max-h-96 overflow-y-auto z-50">
                  {searchQuery && filteredTools.length > 0 && (
                    <div>
                      <div className="px-3 py-2 border-b border-primary/10"><p className="text-xs font-semibold text-muted-foreground">Tools</p></div>
                      <div className="divide-y divide-primary/10">
                        {filteredTools.map((tool) => (
                          <Link key={tool.id} href={tool.href} onClick={() => handleToolClick(tool.name)}>
                            <button className="w-full px-3 py-2 hover:bg-secondary/50 transition-colors text-left flex items-center gap-3 group" data-testid={`button-search-tool-${tool.id}`}>
                              <tool.icon className="h-4 w-4 text-muted-foreground group-hover:text-foreground" />
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium text-foreground truncate">{tool.name}</p>
                                <p className="text-xs text-muted-foreground truncate">{tool.description}</p>
                              </div>
                              <ArrowRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
                            </button>
                          </Link>
                        ))}
                      </div>
                    </div>
                  )}
                  {searchQuery && filteredTools.length === 0 && (
                    <div className="px-4 py-8 text-center">
                      <Search className="h-8 w-8 text-muted-foreground/40 mx-auto mb-2" />
                      <p className="text-sm text-muted-foreground">No results for "{searchQuery}"</p>
                    </div>
                  )}
                  {!searchQuery && searchHistory.length > 0 && (
                    <div>
                      <div className="px-3 py-2 flex items-center justify-between border-b border-primary/10">
                        <p className="text-xs font-semibold text-muted-foreground flex items-center gap-1"><History className="h-3 w-3" />Recent searches</p>
                        <button onClick={clearSearchHistory} className="text-xs text-muted-foreground hover:text-foreground transition-colors" data-testid="button-clear-search-history">Clear</button>
                      </div>
                      <div className="divide-y divide-primary/10">
                        {searchHistory.map((query, idx) => (
                          <button key={idx} onClick={() => { setSearchQuery(query); handleToolClick(query); }} className="w-full px-3 py-2 hover:bg-secondary/50 transition-colors text-left flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground" data-testid={`button-history-${idx}`}>
                            <History className="h-3 w-3" />{query}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </Card>
              )}
            </div>

            <div className="flex items-center gap-1 sm:gap-2 flex-shrink-0">
              {/* Credits Badge */}
              {!creditsLoading && credits && (
                <Link href="/pricing">
                  <div className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-secondary/70 border border-primary/20 cursor-pointer hover-elevate transition-all" data-testid="badge-credits" title="Your AI credits">
                    <Coins className="h-3.5 w-3.5 text-primary" />
                    <span className={`text-xs font-bold ${creditColor}`}>
                      {credits.isAdmin ? "∞" : credits.balance}
                    </span>
                    <span className="text-xs text-muted-foreground hidden lg:inline">credits</span>
                  </div>
                </Link>
              )}
              {subscription?.pricing_tiers?.name && subscription.pricing_tiers.name !== 'free' && (
                <div className="hidden sm:flex items-center gap-1 px-2 py-1 rounded-full bg-primary/10 border border-primary/20 text-xs" data-testid="badge-subscription">
                  <Crown className="h-3 w-3 text-primary" />
                  <span className="font-medium text-primary capitalize">{subscription.pricing_tiers.name}</span>
                </div>
              )}
              <Link href="/pricing">
                <Button variant="outline" size="sm" className="gap-1 sm:gap-2 px-2 sm:px-3" data-testid="button-upgrade">
                  <Zap className="h-4 w-4" />
                  <span className="hidden sm:inline">Upgrade</span>
                </Button>
              </Link>
              <ThemeToggle />
              <Button variant="ghost" size="icon" asChild className="hover-elevate relative" data-testid="link-notifications">
                <Link href="/notifications">
                  <Bell className="h-5 w-5" />
                  {unreadNotifications.length > 0 && (
                    <span className="absolute top-1 right-1 w-2 h-2 bg-red-500 rounded-full"></span>
                  )}
                </Link>
              </Button>
              <Button variant="ghost" size="icon" asChild className="hover-elevate hidden sm:flex" data-testid="link-settings">
                <Link href="/settings"><Settings className="h-5 w-5" /></Link>
              </Button>
              <Button variant="ghost" size="icon" className="hover-elevate active-elevate-2" onClick={handleLogout} data-testid="button-logout">
                <LogOut className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      </header>

      <main className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Greeting Section */}
        <div className="mb-8 sm:mb-12">
          <div className="flex items-start justify-between flex-wrap gap-4">
            <div>
              <div className="flex items-center gap-2 sm:gap-3 mb-1 flex-wrap">
                <h2 className="text-2xl sm:text-4xl font-bold">{greeting}!</h2>
                <Sparkles className="h-6 w-6 sm:h-8 sm:w-8 text-primary animate-bounce" />
              </div>
              <p className="text-muted-foreground flex items-center gap-2 text-sm sm:text-base">
                <Clock className="h-4 w-4" />
                {subtitle}
              </p>
              <p className="text-xs text-muted-foreground mt-1 hidden sm:block">
                {new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}
                {" • "}Press Cmd+K to search everything
              </p>
            </div>

            {/* Credit Summary Card */}
            {!creditsLoading && credits && (
              <Link href="/pricing">
                <Card className="hover-elevate cursor-pointer border-primary/20 px-4 py-3 min-w-40" data-testid="card-credits-summary">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
                      <Coins className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">AI Credits</p>
                      <p className={`text-2xl font-bold ${creditColor}`}>
                        {credits.isAdmin ? "∞" : credits.balance}
                      </p>
                      {!credits.isAdmin && (
                        <p className="text-xs text-muted-foreground">{credits.monthlyUsed}/{credits.maxMonthly} used</p>
                      )}
                    </div>
                  </div>
                  {!credits.isAdmin && (
                    <div className="mt-2 h-1.5 bg-secondary rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${credits.balance > 10 ? "bg-green-500" : credits.balance > 3 ? "bg-amber-500" : "bg-red-500"}`}
                        style={{ width: `${Math.min(100, (credits.balance / 50) * 100)}%` }}
                      />
                    </div>
                  )}
                  {!credits.isAdmin && credits.balance <= 5 && (
                    <p className="text-xs text-amber-500 mt-1 font-medium">Low! Top up →</p>
                  )}
                </Card>
              </Link>
            )}
          </div>
        </div>

        {/* Quick Actions */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 sm:gap-3 mb-6 sm:mb-8">
          {quickActions.map((action) => (
            <Link key={action.label} href={action.href}>
              <Card className={`${action.color} hover-elevate cursor-pointer h-full transition-all`} data-testid={`card-action-${action.label.toLowerCase().replace(/\s+/g, "-")}`}>
                <div className="p-3 sm:p-6 text-center">
                  <action.icon className="h-6 w-6 sm:h-8 sm:w-8 mx-auto mb-1 sm:mb-2 text-foreground" />
                  <p className="font-semibold text-xs sm:text-sm">{action.label}</p>
                </div>
              </Card>
            </Link>
          ))}
        </div>

        {/* Learning Stats */}
        <div className="mb-12">
          <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-primary" />
            Your Learning Progress
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
            {statsLoading ? (
              <>{[1,2,3,4,5,6].map(i => <Skeleton key={i} className="h-20 rounded-lg" />)}</>
            ) : (
              <>
                <Card className="p-4 text-center border-primary/20" data-testid="stat-chats">
                  <MessageSquare className="h-5 w-5 mx-auto mb-1 text-blue-500" />
                  <p className="text-2xl font-bold">{dashboardStats?.chatSessionsCount || 0}</p>
                  <p className="text-xs text-muted-foreground">Chat Sessions</p>
                </Card>
                <Card className="p-4 text-center border-primary/20" data-testid="stat-exams">
                  <Monitor className="h-5 w-5 mx-auto mb-1 text-amber-500" />
                  <p className="text-2xl font-bold">{dashboardStats?.examResultsCount || 0}</p>
                  <p className="text-xs text-muted-foreground">Exams Taken</p>
                </Card>
                <Card className="p-4 text-center border-primary/20" data-testid="stat-plans">
                  <BookOpen className="h-5 w-5 mx-auto mb-1 text-green-500" />
                  <p className="text-2xl font-bold">{dashboardStats?.studyPlansCount || 0}</p>
                  <p className="text-xs text-muted-foreground">Study Plans</p>
                </Card>
                <Card className="p-4 text-center border-primary/20" data-testid="stat-websites">
                  <Code2 className="h-5 w-5 mx-auto mb-1 text-emerald-500" />
                  <p className="text-2xl font-bold">{dashboardStats?.websitesCount || 0}</p>
                  <p className="text-xs text-muted-foreground">Websites</p>
                </Card>
                <Card className="p-4 text-center border-primary/20" data-testid="stat-images">
                  <ImageIcon className="h-5 w-5 mx-auto mb-1 text-orange-500" />
                  <p className="text-2xl font-bold">{dashboardStats?.imagesCount || 0}</p>
                  <p className="text-xs text-muted-foreground">Images</p>
                </Card>
                <Card className="p-4 text-center border-primary/20" data-testid="stat-lessons">
                  <Brain className="h-5 w-5 mx-auto mb-1 text-purple-500" />
                  <p className="text-2xl font-bold">{dashboardStats?.lessonsCount || 0}</p>
                  <p className="text-xs text-muted-foreground">Lessons</p>
                </Card>
              </>
            )}
          </div>
        </div>

        {/* Search Categories */}
        <div className="mb-12">
          <h3 className="text-2xl font-bold mb-4 flex items-center gap-2">
            <Search className="h-6 w-6 text-primary" />
            What do you want to search today?
          </h3>
          <div className="flex gap-3 overflow-x-auto pb-2" ref={categoryScrollRef} data-testid="scroll-categories">
            {searchCategories.map((cat) => {
              if (cat.value !== 'all' && !showAllCategories) return null;
              const CatIcon = cat.icon;
              const categoryLinks: Record<string, string> = {
                all: "/chat", chat: "/chat", memory: "/memory", notes: "/notes",
                study_plan: "/study-plans", exam: "/cbt-mode", website: "/website-generator",
                image: "/image-gen", project: "/project-workspace", lesson: "/chat",
              };
              return (
                <Link key={cat.value} href={categoryLinks[cat.value] || "/chat"}>
                  <button
                    className="flex items-center gap-2 px-4 py-2 bg-secondary/50 hover:bg-secondary border border-primary/20 rounded-full whitespace-nowrap hover-elevate transition-all"
                    data-testid={`button-category-${cat.value}`}
                    onClick={(e) => {
                      if (cat.value === 'all') { e.preventDefault(); setShowAllCategories(true); }
                      else if (cat.value === 'chat') { e.preventDefault(); setShowChatHistoryModal(true); }
                    }}
                  >
                    <CatIcon className="h-4 w-4" />
                    {cat.label}
                  </button>
                </Link>
              );
            })}
          </div>
        </div>

        {/* AI Tools Hub */}
        <div className="mb-12">
          <h3 className="text-2xl font-bold mb-6 flex items-center gap-2">
            <Zap className="h-6 w-6 text-primary" />
            AI Tools Hub
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {aiTools.map((tool) => (
              <Link key={tool.id} href={tool.href || "/chat"} className="block">
                <Card
                  className="hover-elevate cursor-pointer h-full transition-all group relative overflow-hidden glassmorphism border-primary/10 hover:border-primary/30 shadow-lg hover:shadow-primary/20 hover:-translate-y-2"
                  onMouseEnter={() => setHoveredCard(tool.id)}
                  onMouseLeave={() => setHoveredCard(null)}
                  data-testid={`card-tool-${tool.id}`}
                >
                  <div className={`absolute inset-0 bg-gradient-to-br ${tool.color} opacity-0 group-hover:opacity-10 transition-opacity`}></div>
                  <CardHeader className="relative">
                    <div className={`inline-flex p-3 rounded-lg bg-gradient-to-br ${tool.color} mb-3`}>
                      <tool.icon className="h-6 w-6 text-white" />
                    </div>
                    <CardTitle className="text-lg">{tool.name}</CardTitle>
                  </CardHeader>
                  <CardContent className="relative">
                    <p className="text-sm text-muted-foreground mb-4">{tool.description}</p>
                    <Button size="sm" className="w-full hover-elevate" asChild data-testid={`button-open-${tool.id}`}>
                      <div className="flex items-center justify-center gap-2">
                        Open <ArrowRight className="h-4 w-4" />
                      </div>
                    </Button>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        </div>

        <div className="mt-12">
          <Link href="/chat">
            <Button className="gap-2" size="lg" data-testid="button-get-started">
              <Sparkles className="h-5 w-5" />
              Start Learning Now
            </Button>
          </Link>
        </div>
      </main>

      {/* Image Gallery Modal */}
      {selectedImage && (
        <Dialog open={!!selectedImage} onOpenChange={() => setSelectedImage(null)}>
          <DialogContent className="max-w-2xl" data-testid="dialog-image-gallery">
            <div className="flex flex-col gap-4">
              <img src={selectedImage.imageUrl} alt={selectedImage.title} className="w-full rounded-lg object-cover max-h-96" data-testid="img-gallery-preview" />
              <div>
                <p className="font-semibold mb-2" data-testid="text-image-title">{selectedImage.title}</p>
                <p className="text-sm text-muted-foreground" data-testid="text-image-prompt">{selectedImage.description}</p>
              </div>
              <Link href={selectedImage.href || "/image-gen"}>
                <Button className="w-full" data-testid="button-open-image">View &amp; Edit in Generator</Button>
              </Link>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* Chat History Modal */}
      <Dialog open={showChatHistoryModal} onOpenChange={setShowChatHistoryModal}>
        <DialogContent className="max-w-lg max-h-[80vh] overflow-hidden" data-testid="dialog-chat-history">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <History className="h-5 w-5 text-primary" />
              Chat History
            </DialogTitle>
            <DialogDescription>Select a conversation to continue</DialogDescription>
          </DialogHeader>
          <div className="overflow-y-auto max-h-96 space-y-2 pr-2">
            {sessionsLoading ? (
              <div className="space-y-2">{[1,2,3].map(i => <Skeleton key={i} className="h-16 rounded-lg" />)}</div>
            ) : chatSessions.length === 0 ? (
              <div className="text-center py-8 space-y-4">
                <MessageSquare className="h-12 w-12 mx-auto text-muted-foreground" />
                <p className="text-muted-foreground">No chat history yet</p>
                <Link href="/chat"><Button variant="outline" data-testid="button-start-chat">Start Your First Chat</Button></Link>
              </div>
            ) : (
              chatSessions.map((session: any) => (
                <Link key={session.id} href={`/chat?sessionId=${session.id}`}>
                  <Button variant="outline" className="w-full justify-start gap-3 h-auto p-4 text-left" onClick={() => setShowChatHistoryModal(false)} data-testid={`button-chat-session-${session.id}`}>
                    <MessageSquare className="h-5 w-5 flex-shrink-0 text-primary" />
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">{session.title || "Untitled Chat"}</p>
                      <p className="text-xs text-muted-foreground">{new Date(session.updated_at || session.created_at).toLocaleDateString()}</p>
                    </div>
                    <ArrowRight className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                  </Button>
                </Link>
              ))
            )}
          </div>
          <div className="flex gap-2 mt-4">
            <Link href="/chat" className="flex-1"><Button className="w-full gap-2" data-testid="button-new-chat"><MessageSquare className="h-4 w-4" />New Chat</Button></Link>
            <Link href="/cbt-mode" className="flex-1"><Button variant="outline" className="w-full gap-2" data-testid="button-advanced-chat"><Sparkles className="h-4 w-4" />CBT Practice</Button></Link>
          </div>
        </DialogContent>
      </Dialog>

    </div>
  );
}
