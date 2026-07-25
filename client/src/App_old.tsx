import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/ThemeProvider";
import { useAuth } from "@/hooks/useAuth";
import Landing from "@/pages/Landing";
import Dashboard from "@/pages/Dashboard";
import AdvancedDashboard from "@/pages/AdvancedDashboard";
import Chat from "@/pages/Chat";
import ImageGallery from "@/pages/ImageGallery";
import ImageGenAdvanced from "@/pages/ImageGenAdvanced";
import ProjectWorkspace from "@/pages/ProjectWorkspace";
import MemoryPanel from "@/pages/MemoryPanel";
import SettingsPanel from "@/pages/SettingsPanel";
import LiveSession from "@/pages/LiveSession";
import Courses from "@/pages/Courses";
import Marketplace from "@/pages/Marketplace";
import Exams from "@/pages/Exams";
import WebsiteGenerator from "@/pages/WebsiteGenerator";
import ViewWebsite from "@/pages/ViewWebsite";
import WebsiteMenu from "@/pages/WebsiteMenu";
import WebsiteLearn from "@/pages/WebsiteLearn";
import WebsiteDebug from "@/pages/WebsiteDebug";
import NotFound from "@/pages/NotFound";

function Router() {
  const { isAuthenticated, isLoading } = useAuth();

  return (
    <Switch>
      {isLoading || !isAuthenticated ? (
        <Route path="/" component={Landing} />
      ) : (
        <>
          <Route path="/" component={AdvancedDashboard} />
          <Route path="/dashboard" component={AdvancedDashboard} />
          <Route path="/chat" component={Chat} />
          <Route path="/image-gallery" component={ImageGallery} />
          <Route path="/image-gen" component={ImageGenAdvanced} />
          <Route path="/workspace" component={ProjectWorkspace} />
          <Route path="/memory" component={MemoryPanel} />
          <Route path="/settings" component={SettingsPanel} />
          <Route path="/website-generator" component={WebsiteGenerator} />
          <Route path="/website-menu" component={WebsiteMenu} />
          <Route path="/website-learn/:id" component={WebsiteLearn} />
          <Route path="/website-debug/:id" component={WebsiteDebug} />
          <Route path="/view/:id" component={ViewWebsite} />
          <Route path="/live-session" component={LiveSession} />
          <Route path="/live-session/:id" component={LiveSession} />
          <Route path="/courses" component={Courses} />
          <Route path="/marketplace" component={Marketplace} />
          <Route path="/exams" component={Exams} />
        </>
      )}
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider defaultTheme="dark">
        <TooltipProvider>
          <Toaster />
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
