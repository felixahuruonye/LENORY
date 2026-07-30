// client/src/pages/website/WebsiteMenu.tsx
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Loader2, ChevronLeft, Eye, BookOpen, Zap, Heart, Trash2, Copy, Rocket, LayoutTemplate, Globe, Settings, Code2 , Circle } from "lucide-react";

export default function WebsiteMenu() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  // Fetch all websites
  const { data: websites = [], isLoading } = useQuery({
    queryKey: ["/api/websites"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/websites");
      return res.json();
    },
  });

  const handleDelete = async (id: string) => {
    try {
      await apiRequest("DELETE", `/api/websites/${id}`);
      toast({
        title: "Deleted",
        description: "Website removed successfully.",
      });
      window.location.reload();
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to delete website",
        variant: "destructive",
      });
    }
  };

  const handleFavorite = async (id: string, isFavorite: boolean) => {
    try {
      await apiRequest("PATCH", `/api/websites/${id}`, { isFavorite: !isFavorite });
      window.location.reload();
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to toggle favorite",
        variant: "destructive",
      });
    }
  };

  const handleCopy = (code: string) => {
    navigator.clipboard.writeText(code);
    toast({
      title: "Copied",
      description: "Code copied to clipboard",
    });
  };

  const features = [
    {
      icon: Rocket,
      label: "New Builder",
      description: "Redesigned app builder with templates",
      href: "/website-builder",
      color: "text-primary",
    },
    {
      icon: LayoutTemplate,
      label: "Templates",
      description: "Browse community templates",
      href: "/website-templates",
      color: "text-purple-500",
    },
    {
      icon: Globe,
      label: "Deploy",
      description: "Deploy to Vercel, GitHub, or mobile",
      href: "/website-deploy",
      color: "text-emerald-500",
    },
  ];

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-b border-border/50 bg-background/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setLocation("/website-generator")}
              data-testid="button-back"
            >
              <ChevronLeft className="h-5 w-5" />
            </Button>
            <h1 className="text-2xl font-bold text-center flex-1">Website Features</h1>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setLocation("/website-builder")}
              className="gap-2 hover-elevate"
            >
              <Rocket className="h-4 w-4" />
              New Builder
            </Button>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Quick Access Features */}
        <div className="mb-8">
          <h2 className="text-lg font-semibold mb-4">Quick Access</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {features.map((feature) => {
              const Icon = feature.icon;
              return (
                <Card
                  key={feature.label}
                  className="p-4 hover-elevate cursor-pointer transition-all hover:border-primary/30"
                  onClick={() => setLocation(feature.href)}
                >
                  <div className="flex items-center gap-4">
                    <div className={`p-2 rounded-lg bg-primary/10 ${feature.color}`}>
                      <Icon className="h-6 w-6" />
                    </div>
                    <div>
                      <h3 className="font-semibold">{feature.label}</h3>
                      <p className="text-xs text-muted-foreground">{feature.description}</p>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        </div>

        {/* Websites List */}
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : websites.length === 0 ? (
          <Card className="p-12 text-center text-muted-foreground">
            <Code2 className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p className="mb-2">No websites created yet</p>
            <p className="text-sm mb-4">Build your first app with the new builder or classic generator.</p>
            <div className="flex justify-center gap-3">
              <Button onClick={() => setLocation("/website-builder")} className="gap-2">
                <Rocket className="h-4 w-4" />
                New Builder
              </Button>
              <Button variant="outline" onClick={() => setLocation("/website-generator")}>
                Classic Generator
              </Button>
            </div>
          </Card>
        ) : (
          <div>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">Your Apps ({websites.length})</h2>
              <Button variant="outline" size="sm" onClick={() => setLocation("/website-builder")} className="gap-2">
                <Rocket className="h-4 w-4" />
                New App
              </Button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {websites.map((website: any) => (
                <Card key={website.id} className="p-6 flex flex-col gap-4 hover-elevate">
                  <div>
                    <div className="flex items-start justify-between">
                      <h3 className="font-semibold text-lg mb-1 truncate">{website.title}</h3>
                      <Badge variant={website.isFavorite ? "default" : "outline"} className="text-[10px]">
                        {website.isFavorite ? "⭐ Favorite" : ""}
                      </Badge>
                    </div>
                    <p className="text-sm text-muted-foreground line-clamp-2">{website.description}</p>
                    <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
                      <span>{website.viewCount || 0} views</span>
                      <span>•</span>
                      <span>{new Date(website.createdAt).toLocaleDateString()}</span>
                    </div>
                  </div>

                  {/* Feature Buttons */}
                  <div className="grid grid-cols-2 gap-2 flex-1">
                    <Button
                      variant="outline"
                      size="sm"
                      className="justify-start hover-elevate active-elevate-2"
                      onClick={() => setLocation(`/view/${website.id}`)}
                      data-testid={`button-view-${website.id}`}
                    >
                      <Eye className="h-4 w-4 mr-2" />
                      View
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="justify-start hover-elevate active-elevate-2"
                      onClick={() => setLocation(`/website-editor/${website.id}`)}
                      data-testid={`button-edit-${website.id}`}
                    >
                      <Code2 className="h-4 w-4 mr-2" />
                      Edit
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="justify-start hover-elevate active-elevate-2"
                      onClick={() => setLocation(`/website-learn/${website.id}`)}
                      data-testid={`button-learn-${website.id}`}
                    >
                      <BookOpen className="h-4 w-4 mr-2" />
                      Learn
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="justify-start hover-elevate active-elevate-2"
                      onClick={() => setLocation(`/website-deploy`)}
                      data-testid={`button-deploy-${website.id}`}
                    >
                      <Globe className="h-4 w-4 mr-2" />
                      Deploy
                    </Button>
                  </div>

                  {/* Management Buttons */}
                  <div className="border-t pt-3 flex gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleFavorite(website.id, website.isFavorite)}
                      className="hover-elevate active-elevate-2"
                      data-testid={`button-favorite-${website.id}`}
                    >
                      <Heart className={`h-4 w-4 ${website.isFavorite ? "fill-red-500 text-red-500" : ""}`} />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleCopy(website.htmlCode)}
                      className="hover-elevate active-elevate-2"
                      data-testid={`button-copy-${website.id}`}
                    >
                      <Copy className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDelete(website.id)}
                      className="hover-elevate active-elevate-2 text-destructive ml-auto"
                      data-testid={`button-delete-${website.id}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </Card>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

