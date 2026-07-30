// client/src/pages/website/WebsiteTemplates.tsx
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
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
  ChevronLeft, Search, LayoutTemplate, Star, Users,
  Rocket, Loader2, Crown, Heart, Code2, Eye, Download,
  TrendingUp, Sparkles, Zap, Clock, Filter,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";

// ─── TYPES ─────────────────────────────────────────────────────────────────────

interface Template {
  id: string;
  creator_id: string;
  title: string;
  description: string | null;
  category: string;
  html_code: string;
  css_code: string;
  js_code: string | null;
  preview_image_url: string | null;
  is_public: boolean;
  uses_count: number;
  earned_credits: number;
  created_at: string;
  updated_at: string;
  creator?: {
    first_name: string;
    last_name: string;
    email: string;
  };
}

// ─── CATEGORIES ──────────────────────────────────────────────────────────────

const categories = [
  { id: "all", label: "All Templates", icon: LayoutTemplate },
  { id: "portfolio", label: "Portfolio", icon: Code2 },
  { id: "ecommerce", label: "E-Commerce", icon: TrendingUp },
  { id: "blog", label: "Blog", icon: FileText },
  { id: "landing", label: "Landing Page", icon: Rocket },
  { id: "dashboard", label: "Dashboard", icon: LayoutTemplate },
  { id: "game", label: "Games", icon: Sparkles },
  { id: "education", label: "Education", icon: BookOpen },
];

// ─── MAIN COMPONENT ──────────────────────────────────────────────────────────

export default function WebsiteTemplates() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null);

  const isPro = user?.subscriptionTier === 'pro' || user?.subscriptionTier === 'premium';

  // ─── QUERIES ────────────────────────────────────────────────────────────────

  // Get templates
  const { data: templates = [], isLoading } = useQuery<Template[]>({
    queryKey: ["/api/website/templates"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/website/templates");
      return res.json();
    },
  });

  // ─── FILTERS ────────────────────────────────────────────────────────────────

  const filteredTemplates = templates.filter((template) => {
    const matchesSearch = template.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         (template.description?.toLowerCase() || "").includes(searchQuery.toLowerCase());
    const matchesCategory = selectedCategory === "all" || template.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  // ─── HANDLERS ──────────────────────────────────────────────────────────────

  const handleUseTemplate = (template: Template) => {
    if (!isPro) {
      toast({
        title: "Pro feature",
        description: "Using templates is available on Pro and Premium plans.",
        variant: "destructive",
      });
      return;
    }
    toast({ title: "Template loaded!", description: "Starting your new project from this template." });
    setLocation(`/website-editor/new?template=${template.id}`);
  };

  const handleViewTemplate = (template: Template) => {
    setSelectedTemplate(template);
  };

  const handleCloseModal = () => {
    setSelectedTemplate(null);
  };

  // ─── RENDER ──────────────────────────────────────────────────────────────────

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
              <LayoutTemplate className="h-6 w-6 text-primary" />
              <h1 className="text-xl font-bold">Templates</h1>
              <Badge variant="secondary" className="text-xs">
                {templates.length} available
              </Badge>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search templates..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 w-48 sm:w-64"
              />
            </div>
            {!isPro && (
              <Button
                size="sm"
                className="gap-2 bg-gradient-to-r from-amber-500 to-orange-500"
                onClick={() => setLocation("/pricing")}
              >
                <Crown className="h-4 w-4" />
                Upgrade
              </Button>
            )}
          </div>
        </div>
      </header>

      <main className="p-6 max-w-7xl mx-auto">
        {/* Categories */}
        <div className="flex flex-wrap gap-2 mb-6">
          {categories.map((category) => {
            const Icon = category.icon;
            const isSelected = selectedCategory === category.id;
            return (
              <Button
                key={category.id}
                variant={isSelected ? "default" : "outline"}
                size="sm"
                className="gap-2"
                onClick={() => setSelectedCategory(category.id)}
              >
                <Icon className="h-4 w-4" />
                {category.label}
              </Button>
            );
          })}
        </div>

        {/* Templates Grid */}
        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : filteredTemplates.length === 0 ? (
          <Card className="p-12 text-center text-muted-foreground">
            <LayoutTemplate className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p>No templates found</p>
            <p className="text-sm mt-1">Try adjusting your search or filters</p>
          </Card>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {filteredTemplates.map((template) => (
              <Card
                key={template.id}
                className="hover-elevate cursor-pointer overflow-hidden"
                onClick={() => handleViewTemplate(template)}
              >
                <div className="aspect-video bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center">
                  {template.preview_image_url ? (
                    <img
                      src={template.preview_image_url}
                      alt={template.title}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="text-center p-4">
                      <LayoutTemplate className="h-12 w-12 mx-auto text-muted-foreground/50" />
                      <p className="text-xs text-muted-foreground mt-2">No preview</p>
                    </div>
                  )}
                </div>
                <div className="p-4">
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="font-semibold truncate">{template.title}</h3>
                      <p className="text-sm text-muted-foreground truncate">
                        {template.description || "No description"}
                      </p>
                    </div>
                    <Badge variant="outline" className="text-xs flex-shrink-0 ml-2">
                      {template.uses_count || 0} uses
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between mt-3">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Users className="h-3 w-3" />
                      <span>{template.creator?.first_name || "Anonymous"}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary" className="text-[10px]">
                        {template.category || "General"}
                      </Badge>
                      <Button
                        size="sm"
                        variant="default"
                        className="h-7 px-3 text-xs gap-1"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleUseTemplate(template);
                        }}
                        disabled={!isPro}
                      >
                        <Download className="h-3 w-3" />
                        Use
                      </Button>
                    </div>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}

        {/* Template Detail Modal */}
        {selectedTemplate && (
          <Dialog open={!!selectedTemplate} onOpenChange={() => setSelectedTemplate(null)}>
            <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <LayoutTemplate className="h-5 w-5 text-primary" />
                  {selectedTemplate.title}
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div className="aspect-video bg-gradient-to-br from-primary/20 to-primary/5 rounded-lg flex items-center justify-center">
                  {selectedTemplate.preview_image_url ? (
                    <img
                      src={selectedTemplate.preview_image_url}
                      alt={selectedTemplate.title}
                      className="w-full h-full object-cover rounded-lg"
                    />
                  ) : (
                    <LayoutTemplate className="h-16 w-16 text-muted-foreground/50" />
                  )}
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">
                    {selectedTemplate.description || "No description available."}
                  </p>
                </div>
                <div className="flex items-center gap-4 text-sm text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <Users className="h-4 w-4" />
                    {selectedTemplate.creator?.first_name || "Anonymous"}
                  </span>
                  <span className="flex items-center gap-1">
                    <Download className="h-4 w-4" />
                    {selectedTemplate.uses_count || 0} uses
                  </span>
                  <span>
                    {formatDistanceToNow(new Date(selectedTemplate.created_at), { addSuffix: true })}
                  </span>
                </div>
                <div className="flex gap-2">
                  <Button
                    onClick={() => handleUseTemplate(selectedTemplate)}
                    disabled={!isPro}
                    className="flex-1 gap-2 hover-elevate"
                  >
                    <Download className="h-4 w-4" />
                    Use This Template
                  </Button>
                  <Button variant="outline" onClick={() => setSelectedTemplate(null)}>
                    Close
                  </Button>
                </div>
                {!isPro && (
                  <p className="text-xs text-amber-500 text-center">
                    <Crown className="h-3 w-3 inline mr-1" />
                    Templates are available on Pro and Premium plans.
                  </p>
                )}
              </div>
            </DialogContent>
          </Dialog>
        )}
      </main>
    </div>
  );
}

// ─── MISSING IMPORTS ──────────────────────────────────────────────────────────

function FileText(props: any) {
  return (
    <svg
      {...props}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
      <polyline points="10 9 9 9 8 9" />
    </svg>
  );
}

function BookOpen(props: any) {
  return (
    <svg
      {...props}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
      <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
    </svg>
  );
}
