// client/src/components/website/WebsiteSidebar.tsx
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import {
  Home, Search, LayoutTemplate, Rocket, Users, Settings,
  Heart, Code2, ChevronLeft, LogOut, Crown,
} from "lucide-react";

interface WebsiteSidebarProps {
  favorites: any[];
  apps: any[];
  collapsed: boolean;
  onToggle: () => void;
}

export function WebsiteSidebar({ favorites, apps, collapsed, onToggle }: WebsiteSidebarProps) {
  const [, setLocation] = useLocation();

  const sidebarItems = [
    { icon: Home, label: "Home", href: "/website-builder" },
    { icon: Search, label: "Search", href: "/website-builder/search" },
    { icon: LayoutTemplate, label: "All Apps", href: "/website-builder/apps" },
    { icon: LayoutTemplate, label: "Templates", href: "/website-templates" },
    { icon: Rocket, label: "Launchpad", href: "/website-builder/launchpad" },
    { icon: Users, label: "Partners", href: "/website-builder/partners" },
  ];

  return (
    <aside className={`${collapsed ? "w-16" : "w-64"} border-r border-border/50 bg-background/95 backdrop-blur flex flex-col transition-all duration-300 shrink-0`}>
      <div className="p-4 border-b border-border/50 flex items-center justify-between">
        {!collapsed && (
          <div className="flex items-center gap-2">
            <img src="/favicon.png" alt="LENORY" className="h-8 w-8 rounded-xl" />
            <span className="font-bold text-lg">LENORY</span>
          </div>
        )}
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onToggle}>
          <ChevronLeft className={`h-4 w-4 transition-transform ${collapsed ? "rotate-180" : ""}`} />
        </Button>
      </div>

      <nav className="flex-1 p-2 space-y-1 overflow-y-auto">
        {sidebarItems.map((item) => (
          <Button
            key={item.label}
            variant="ghost"
            className={`w-full justify-start gap-3 ${collapsed ? "px-2" : "px-3"}`}
            onClick={() => setLocation(item.href)}
          >
            <item.icon className="h-5 w-5 flex-shrink-0" />
            {!collapsed && <span>{item.label}</span>}
          </Button>
        ))}

        <div className="my-4 border-t border-border/50" />

        {!collapsed && (
          <p className="px-3 py-2 text-xs text-muted-foreground font-medium">Favorites</p>
        )}
        {favorites.slice(0, 5).map((app: any) => (
          <Button
            key={app.id}
            variant="ghost"
            className={`w-full justify-start gap-3 ${collapsed ? "px-2" : "px-3"}`}
            onClick={() => setLocation(`/website-editor/${app.id}`)}
          >
            <Heart className="h-4 w-4 flex-shrink-0 fill-red-500 text-red-500" />
            {!collapsed && <span className="truncate">{app.title}</span>}
          </Button>
        ))}

        <div className="my-4 border-t border-border/50" />

        {!collapsed && (
          <p className="px-3 py-2 text-xs text-muted-foreground font-medium">Recent</p>
        )}
        {apps.slice(0, 5).map((app: any) => (
          <Button
            key={app.id}
            variant="ghost"
            className={`w-full justify-start gap-3 ${collapsed ? "px-2" : "px-3"}`}
            onClick={() => setLocation(`/website-editor/${app.id}`)}
          >
            <Code2 className="h-4 w-4 flex-shrink-0 text-primary" />
            {!collapsed && <span className="truncate">{app.title}</span>}
          </Button>
        ))}
      </nav>

      <div className="p-4 border-t border-border/50 space-y-1">
        <Button
          variant="ghost"
          className={`w-full justify-start gap-3 ${collapsed ? "px-2" : "px-3"}`}
          onClick={() => setLocation("/settings")}
        >
          <Settings className="h-5 w-5 flex-shrink-0" />
          {!collapsed && <span>Settings</span>}
        </Button>
        <Button
          variant="ghost"
          className={`w-full justify-start gap-3 text-red-500 hover:text-red-600 hover:bg-red-50 ${collapsed ? "px-2" : "px-3"}`}
          onClick={() => {
            // Handle logout
            window.location.href = "/api/logout";
          }}
        >
          <LogOut className="h-5 w-5 flex-shrink-0" />
          {!collapsed && <span>Logout</span>}
        </Button>
      </div>
    </aside>
  );
}
