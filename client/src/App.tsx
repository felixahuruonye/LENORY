import { Switch, Route, Redirect, useLocation } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/ThemeProvider";
import { VoiceCallProvider } from "@/contexts/VoiceCallContext";
import VoiceOrb from "@/components/VoiceOrb";
import UpdateAvailableBanner from "@/components/UpdateAvailableBanner";
import { useAuth } from "@/hooks/useAuth";
import HeyLenoryButton from "@/components/HeyLenoryButton";
import Landing from "@/pages/Landing";
import Dashboard from "@/pages/Dashboard";
import AdvancedDashboard from "@/pages/AdvancedDashboard";
import AdvancedChat from "@/pages/AdvancedChat";
import Chat from "@/pages/Chat";
import ImageGallery from "@/pages/ImageGallery";
import ImageGenAdvanced from "@/pages/ImageGenAdvanced";
import ProjectWorkspace from "@/pages/ProjectWorkspace";
import MemoryPanel from "@/pages/MemoryPanel";
import StudyPlans from "@/pages/StudyPlans";
import Pricing from "@/pages/Pricing";
import SettingsPanel from "@/pages/SettingsPanel";
import AudioSystem from "@/pages/AudioSystem";
import AgentsPanel from "@/pages/AgentsPanel";
import LiveSession from "@/pages/LiveSession";
import Courses from "@/pages/Courses";
import Marketplace from "@/pages/Marketplace";
import Exams from "@/pages/Exams";
import WebsiteGenerator from "@/pages/WebsiteGenerator";
import WebsiteBuilder from "@/pages/WebsiteBuilder";
import WebsiteEditor from "@/pages/WebsiteEditor";
import WebsiteDeploy from "@/pages/WebsiteDeploy";
import WebsiteTemplates from "@/pages/WebsiteTemplates";
import ViewWebsite from "@/pages/ViewWebsite";
import WebsiteMenu from "@/pages/WebsiteMenu";
import WebsiteLearn from "@/pages/WebsiteLearn";
import WebsiteDebug from "@/pages/WebsiteDebug";
import Notifications from "@/pages/Notifications";
import LiveAI from "@/pages/LiveAI";
import CBTMode from "@/pages/CBTMode";
import GeneratedLessons from "@/pages/GeneratedLessons";
import AdminDashboard from "@/pages/AdminDashboard";
import VideoGeneration from "@/pages/VideoGeneration";
import AuthCallback from "@/pages/AuthCallback";
import Notes from "@/pages/Notes";
import SharedFolder from "@/pages/SharedFolder";
import Languages from "@/pages/Languages";
import Login from "@/pages/Login";
import Signup from "@/pages/Signup";
import VoiceGallery from "@/pages/VoiceGallery";

// ─── NEW IMPORTS FOR LEARN TO CODE ──────────────────────────────
import LearnDashboard from "./pages/LearnDashboard";
import LearnEditor from "./pages/LearnEditor";
import EngineeringAgent from "@/pages/admin/EngineeringAgent";
import ComplaintsPage from "@/pages/admin/ComplaintsPage";
import HistoryPage from "@/pages/admin/HistoryPage";

function Router() {
  const { isAuthenticated, isLoading } = useAuth();

  // Show loading state while checking auth
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <img src="/favicon.png" alt="LENORY" className="h-14 w-14 rounded-2xl object-cover animate-pulse" />
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  // Not authenticated - show public routes
  if (!isAuthenticated) {
    return (
      <Switch>
        <Route path="/auth/callback" component={AuthCallback} />
        <Route path="/login" component={Login} />
        <Route path="/signup" component={Signup} />
        <Route path="/pricing" component={Pricing} />
        <Route path="/" component={Landing} />
        <Route>
          <Redirect to="/" />
        </Route>
      </Switch>
    );
  }

  // Authenticated - show all app routes
  return (
    <Switch>
      <Route path="/auth/callback" component={AuthCallback} />
      <Route path="/login">
        <Redirect to="/dashboard" />
      </Route>
      <Route path="/signup">
        <Redirect to="/dashboard" />
      </Route>
      <Route path="/" component={AdvancedDashboard} />
      <Route path="/dashboard" component={AdvancedDashboard} />
      <Route path="/admin" component={AdminDashboard} />
      <Route path="/old-dashboard" component={Dashboard} />
      <Route path="/chat" component={Chat} />
      <Route path="/advanced-chat" component={AdvancedChat} />
      <Route path="/image-gallery" component={ImageGallery} />
      <Route path="/image-gen" component={ImageGenAdvanced} />
      <Route path="/workspace" component={ProjectWorkspace} />
      <Route path="/project-workspace" component={ProjectWorkspace} />
      <Route path="/memory" component={MemoryPanel} />
      <Route path="/study-plans" component={StudyPlans} />
      <Route path="/notes" component={Notes} />
      {/* Alias — AdvancedDashboard's Knowledge Base tile used to link here
          before that route existed, which is why the button didn't open
          anything. Keeping this alias too in case anything else (bookmarks,
          old links) still points at /knowledge-base. */}
      <Route path="/knowledge-base" component={Notes} />
      <Route path="/shared/:code" component={SharedFolder} />
      <Route path="/languages" component={Languages} />
      <Route path="/pricing" component={Pricing} />
      <Route path="/settings" component={SettingsPanel} />
      <Route path="/audio" component={AudioSystem} />
      <Route path="/agents" component={AgentsPanel} />
      <Route path="/website-generator" component={WebsiteGenerator} />
      <Route path="/website-builder" component={WebsiteBuilder} />
      <Route path="/website-builder/search" component={WebsiteBuilder} />
      <Route path="/website-builder/apps" component={WebsiteBuilder} />
      <Route path="/website-builder/launchpad" component={WebsiteBuilder} />
      <Route path="/website-builder/partners" component={WebsiteBuilder} />
      <Route path="/website-templates" component={WebsiteTemplates} />
      <Route path="/website-editor/:id" component={WebsiteEditor} />
      <Route path="/website-deploy" component={WebsiteDeploy} />
      <Route path="/website-menu" component={WebsiteMenu} />
      <Route path="/website-learn/:id" component={WebsiteLearn} />
      <Route path="/website-debug/:id" component={WebsiteDebug} />
      <Route path="/view/:id" component={ViewWebsite} />
      <Route path="/live-session" component={LiveSession} />
      <Route path="/live-session/:id" component={LiveSession} />
      <Route path="/generated-lessons" component={GeneratedLessons} />
      <Route path="/courses" component={Courses} />
      <Route path="/marketplace" component={Marketplace} />
      <Route path="/exams" component={Exams} />
      <Route path="/cbt-mode" component={CBTMode} />
      <Route path="/notifications" component={Notifications} />
      <Route path="/live-ai" component={LiveAI} />
      <Route path="/video-gen" component={VideoGeneration} />
      <Route path="/voice-gallery" component={VoiceGallery} />

      {/* ─── NEW LEARN TO CODE ROUTES ────────────────────────────── */}
      <Route path="/learn" component={LearnDashboard} />
      <Route path="/learn/path/:pathId" component={LearnEditor} />

      {/* Catch-all redirect */}
      <Route>
        <Redirect to="/dashboard" />
      </Route>
    </Switch>
  );
}

function GlobalVoiceButton() {
  const { isAuthenticated } = useAuth();
  const [, navigate] = useLocation();
  if (!isAuthenticated) return null;
  return (
    <HeyLenoryButton
      onTranscript={(text) => {
        navigate(`/chat?voice=${encodeURIComponent(text)}`);
      }}
    />
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider defaultTheme="dark">
        <TooltipProvider>
          {/* VoiceCallProvider sits ABOVE the router — mounted once, never
              torn down by route changes, so a live voice call now genuinely
              survives navigating to a different chat session or page,
              instead of dying when the page that started it unmounts. */}
          <VoiceCallProvider>
            <Toaster />
            <Router />
            <GlobalVoiceButton />
            <VoiceOrb />
            <UpdateAvailableBanner />
          </VoiceCallProvider>
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
