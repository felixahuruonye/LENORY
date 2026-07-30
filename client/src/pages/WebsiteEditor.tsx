// client/src/pages/website/WebsiteEditor.tsx
import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation, useParams } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  ChevronLeft, Loader2, Eye, Code2, Play, Save, Share2,
  Rocket, Github, Smartphone, Monitor, Zap, Copy, Check,
  Settings, Download, ExternalLink, RefreshCw, Terminal,
  FileCode, FileJson, FileText, ImageIcon, FolderOpen,
  Plus, X, Trash2, Edit3, Maximize2, Minimize2,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";

// ─── TYPES ─────────────────────────────────────────────────────────────────────

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

interface FileNode {
  id: string;
  name: string;
  type: "file" | "folder";
  content?: string;
  children?: FileNode[];
  isOpen?: boolean;
}

// ─── MAIN COMPONENT ──────────────────────────────────────────────────────────

export default function WebsiteEditor() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const { id } = useParams<{ id: string }>();
  const [activeTab, setActiveTab] = useState<"preview" | "code" | "split">("preview");
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeploying, setIsDeploying] = useState(false);
  const [showDeployDialog, setShowDeployDialog] = useState(false);
  const [showShareDialog, setShowShareDialog] = useState(false);
  const [shareLink, setShareLink] = useState("");
  const [deployPlatform, setDeployPlatform] = useState<"vercel" | "github" | "capacitor">("vercel");
  const [editorContent, setEditorContent] = useState({
    html: "",
    css: "",
    js: "",
  });
  const [activeFile, setActiveFile] = useState<"html" | "css" | "js">("html");
  const [codeHistory, setCodeHistory] = useState<any[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [isMobilePreview, setIsMobilePreview] = useState(false);
  const [isDarkPreview, setIsDarkPreview] = useState(false);

  const iframeRef = useRef<HTMLIFrameElement>(null);

  // ─── QUERIES ────────────────────────────────────────────────────────────────

  // Get app data
  const { data: app, isLoading, refetch } = useQuery<AppProject>({
    queryKey: [`/api/website/apps/${id}`],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/website/apps/${id}`);
      return res.json();
    },
    enabled: !!id,
  });

  // ─── MUTATIONS ──────────────────────────────────────────────────────────────

  // Save app
  const saveMutation = useMutation({
    mutationFn: async (data: { html: string; css: string; js: string }) => {
      const res = await apiRequest("PATCH", `/api/website/apps/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Saved!", description: "Your changes have been saved." });
      setIsSaving(false);
      refetch();
    },
    onError: (err: any) => {
      toast({ title: "Save failed", description: err.message, variant: "destructive" });
      setIsSaving(false);
    },
  });

  // Deploy app
  const deployMutation = useMutation({
    mutationFn: async (platform: string) => {
      const res = await apiRequest("POST", `/api/website/deploy/${id}`, { platform });
      return res.json();
    },
    onSuccess: (data) => {
      toast({ title: "Deployed!", description: `Your app is live at ${data.url || "the URL provided."}` });
      setIsDeploying(false);
      setShowDeployDialog(false);
    },
    onError: (err: any) => {
      toast({ title: "Deploy failed", description: err.message, variant: "destructive" });
      setIsDeploying(false);
    },
  });

  // ─── EFFECTS ────────────────────────────────────────────────────────────────

  // Update editor content when app loads
  useEffect(() => {
    if (app) {
      setEditorContent({
        html: app.html_code || "",
        css: app.css_code || "",
        js: app.js_code || "",
      });
    }
  }, [app]);

  // Update iframe preview
  useEffect(() => {
    if (iframeRef.current) {
      const doc = iframeRef.current.contentDocument;
      if (doc) {
        const html = editorContent.html || "";
        const css = editorContent.css || "";
        const js = editorContent.js || "";
        doc.open();
        doc.write(`
          <!DOCTYPE html>
          <html>
          <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <style>${css}</style>
          </head>
          <body>
            ${html}
            <script>${js}</script>
          </body>
          </html>
        `);
        doc.close();
      }
    }
  }, [editorContent, isMobilePreview, isDarkPreview]);

  // ─── HANDLERS ──────────────────────────────────────────────────────────────

  const handleSave = () => {
    setIsSaving(true);
    saveMutation.mutate(editorContent);
  };

  const handleDeploy = () => {
    setIsDeploying(true);
    deployMutation.mutate(deployPlatform);
  };

  const handleShare = () => {
    const link = `${window.location.origin}/website-builder/view/${id}`;
    setShareLink(link);
    setShowShareDialog(true);
  };

  const handleCopyLink = () => {
    navigator.clipboard.writeText(shareLink);
    toast({ title: "Copied!", description: "Link copied to clipboard." });
  };

  const handleCodeChange = (content: string) => {
    setEditorContent((prev) => ({
      ...prev,
      [activeFile]: content,
    }));
  };

  const handleRefreshPreview = () => {
    if (iframeRef.current) {
      iframeRef.current.src = iframeRef.current.src;
    }
  };

  const handleExport = () => {
    const html = editorContent.html || "";
    const css = editorContent.css || "";
    const js = editorContent.js || "";
    const fullHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>${css}</style>
      </head>
      <body>
        ${html}
        <script>${js}</script>
      </body>
      </html>
    `;
    const blob = new Blob([fullHtml], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${app?.title || "app"}.html`;
    a.click();
    URL.revokeObjectURL(url);
    toast({ title: "Exported!", description: "HTML file downloaded." });
  };

  const getFileIcon = (file: string) => {
    const icons: Record<string, any> = {
      html: FileCode,
      css: FileJson,
      js: FileText,
    };
    return icons[file] || FileCode;
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!app) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center">
        <p className="text-muted-foreground mb-4">App not found</p>
        <Button onClick={() => setLocation("/website-builder")}>Go Back</Button>
      </div>
    );
  }

  return (
    <div className={`min-h-screen bg-background ${isFullscreen ? "fixed inset-0 z-50" : ""}`}>
      {/* ─── HEADER ───────────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-10 border-b border-border/50 bg-background/95 backdrop-blur px-4 py-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => setLocation("/website-builder")}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <div>
              <h1 className="font-semibold text-sm">{app.title}</h1>
              <p className="text-xs text-muted-foreground">
                {formatDistanceToNow(new Date(app.updated_at), { addSuffix: true })}
              </p>
            </div>
            {app.is_favorite && (
              <Badge variant="secondary" className="text-xs">
                ⭐ Favorite
              </Badge>
            )}
          </div>

          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="gap-1 text-xs"
              onClick={() => setIsMobilePreview(!isMobilePreview)}
            >
              {isMobilePreview ? <Monitor className="h-4 w-4" /> : <Smartphone className="h-4 w-4" />}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="gap-1 text-xs"
              onClick={() => setIsDarkPreview(!isDarkPreview)}
            >
              {isDarkPreview ? "☀️" : "🌙"}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="gap-1 text-xs"
              onClick={handleRefreshPreview}
            >
              <RefreshCw className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="gap-1 text-xs"
              onClick={() => setIsFullscreen(!isFullscreen)}
            >
              {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
            </Button>
            <div className="w-px h-6 bg-border mx-1" />
            <Button
              variant="outline"
              size="sm"
              className="gap-1 text-xs"
              onClick={handleShare}
            >
              <Share2 className="h-4 w-4" />
              Share
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="gap-1 text-xs"
              onClick={handleExport}
            >
              <Download className="h-4 w-4" />
              Export
            </Button>
            <Button
              variant="default"
              size="sm"
              className="gap-1 text-xs"
              onClick={() => setShowDeployDialog(true)}
            >
              <Rocket className="h-4 w-4" />
              Deploy
            </Button>
            <Button
              variant="default"
              size="sm"
              className="gap-1 text-xs bg-green-600 hover:bg-green-700"
              onClick={handleSave}
              disabled={isSaving}
            >
              {isSaving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              Save
            </Button>
          </div>
        </div>

        {/* ─── VIEW TOGGLES ───────────────────────────────────────────────────── */}
        <div className="flex items-center gap-1 mt-2">
          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)} className="w-full">
            <TabsList className="h-8">
              <TabsTrigger value="preview" className="text-xs gap-1">
                <Eye className="h-3 w-3" />
                Preview
              </TabsTrigger>
              <TabsTrigger value="code" className="text-xs gap-1">
                <Code2 className="h-3 w-3" />
                Code
              </TabsTrigger>
              <TabsTrigger value="split" className="text-xs gap-1">
                <Layout className="h-3 w-3" />
                Split
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      </header>

      {/* ─── MAIN CONTENT ────────────────────────────────────────────────────── */}
      <div className="flex-1 h-[calc(100vh-120px)]">
        {activeTab === "preview" && (
          <PreviewPanel
            iframeRef={iframeRef}
            isMobilePreview={isMobilePreview}
            isDarkPreview={isDarkPreview}
          />
        )}

        {activeTab === "code" && (
          <CodePanel
            editorContent={editorContent}
            activeFile={activeFile}
            setActiveFile={setActiveFile}
            onCodeChange={handleCodeChange}
            getFileIcon={getFileIcon}
          />
        )}

        {activeTab === "split" && (
          <SplitPanel
            iframeRef={iframeRef}
            isMobilePreview={isMobilePreview}
            isDarkPreview={isDarkPreview}
            editorContent={editorContent}
            activeFile={activeFile}
            setActiveFile={setActiveFile}
            onCodeChange={handleCodeChange}
            getFileIcon={getFileIcon}
          />
        )}
      </div>

      {/* ─── DEPLOY DIALOG ───────────────────────────────────────────────────── */}
      <Dialog open={showDeployDialog} onOpenChange={setShowDeployDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Rocket className="h-5 w-5 text-primary" />
              Deploy Your App
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">Choose where to deploy your app:</p>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { id: "vercel", label: "Vercel", icon: Rocket },
                  { id: "github", label: "GitHub", icon: Github },
                  { id: "capacitor", label: "Mobile App", icon: Smartphone },
                ].map((platform) => (
                  <Button
                    key={platform.id}
                    variant={deployPlatform === platform.id ? "default" : "outline"}
                    className="gap-2"
                    onClick={() => setDeployPlatform(platform.id as any)}
                  >
                    <platform.icon className="h-4 w-4" />
                    {platform.label}
                  </Button>
                ))}
              </div>
            </div>
            <div className="p-3 bg-muted/30 rounded-lg text-sm">
              <p className="text-muted-foreground">
                {deployPlatform === "vercel" && "Deploy to Vercel for a live URL. Requires Vercel account."}
                {deployPlatform === "github" && "Push to GitHub repository. Requires GitHub connection."}
                {deployPlatform === "capacitor" && "Export as iOS/Android app. Requires Capacitor setup."}
              </p>
            </div>
            <Button
              onClick={handleDeploy}
              disabled={isDeploying}
              className="w-full gap-2 hover-elevate"
            >
              {isDeploying ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Rocket className="h-4 w-4" />
              )}
              {isDeploying ? "Deploying..." : "Deploy Now"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ─── SHARE DIALOG ────────────────────────────────────────────────────── */}
      <Dialog open={showShareDialog} onOpenChange={setShowShareDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Share2 className="h-5 w-5 text-primary" />
              Share Your App
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="p-3 bg-muted/50 rounded-lg">
              <p className="text-xs text-muted-foreground mb-1">Share Link</p>
              <div className="flex items-center gap-2">
                <Input value={shareLink} readOnly className="text-xs" />
                <Button size="icon" variant="outline" onClick={handleCopyLink}>
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" className="gap-2" onClick={handleCopyLink}>
                <Copy className="h-4 w-4" />
                Copy Link
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="gap-2"
                onClick={() => {
                  window.open(`https://wa.me/?text=${encodeURIComponent(`Check out my app: ${shareLink}`)}`, "_blank");
                }}
              >
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                </svg>
                WhatsApp
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── PREVIEW PANEL ────────────────────────────────────────────────────────────

function PreviewPanel({ iframeRef, isMobilePreview, isDarkPreview }: any) {
  return (
    <div className="flex-1 h-full bg-muted/20 p-4 flex items-center justify-center">
      <div
        className={`bg-white rounded-lg shadow-lg overflow-hidden transition-all ${
          isMobilePreview ? "w-[375px] h-[812px]" : "w-full h-full"
        } ${isDarkPreview ? "dark" : ""}`}
      >
        <iframe
          ref={iframeRef}
          className="w-full h-full border-0"
          title="App Preview"
          sandbox="allow-scripts allow-modals allow-same-origin"
        />
      </div>
    </div>
  );
}

// ─── CODE PANEL ──────────────────────────────────────────────────────────────

function CodePanel({
  editorContent,
  activeFile,
  setActiveFile,
  onCodeChange,
  getFileIcon,
}: any) {
  const files = [
    { id: "html", label: "HTML", icon: getFileIcon("html") },
    { id: "css", label: "CSS", icon: getFileIcon("css") },
    { id: "js", label: "JavaScript", icon: getFileIcon("js") },
  ];

  return (
    <div className="flex-1 h-full flex flex-col bg-black/5 dark:bg-white/5">
      <div className="flex items-center border-b border-border/50 bg-muted/30 px-2">
        {files.map((file) => {
          const Icon = file.icon;
          return (
            <Button
              key={file.id}
              variant={activeFile === file.id ? "default" : "ghost"}
              size="sm"
              className="gap-1.5 text-xs rounded-none border-b-2 border-transparent data-[state=active]:border-primary"
              onClick={() => setActiveFile(file.id as any)}
            >
              <Icon className="h-3 w-3" />
              {file.label}
            </Button>
          );
        })}
      </div>
      <div className="flex-1 overflow-auto p-4">
        <textarea
          className="w-full h-full bg-transparent border-0 outline-none font-mono text-sm resize-none"
          value={editorContent[activeFile] || ""}
          onChange={(e) => onCodeChange(e.target.value)}
          spellCheck={false}
          placeholder={`Enter your ${activeFile.toUpperCase()} code here...`}
        />
      </div>
    </div>
  );
}

// ─── SPLIT PANEL ─────────────────────────────────────────────────────────────

function SplitPanel({
  iframeRef,
  isMobilePreview,
  isDarkPreview,
  editorContent,
  activeFile,
  setActiveFile,
  onCodeChange,
  getFileIcon,
}: any) {
  return (
    <div className="flex-1 h-full flex">
      <div className="flex-1 border-r border-border/50">
        <CodePanel
          editorContent={editorContent}
          activeFile={activeFile}
          setActiveFile={setActiveFile}
          onCodeChange={onCodeChange}
          getFileIcon={getFileIcon}
        />
      </div>
      <div className="flex-1">
        <PreviewPanel
          iframeRef={iframeRef}
          isMobilePreview={isMobilePreview}
          isDarkPreview={isDarkPreview}
        />
      </div>
    </div>
  );
}

// ─── LAYOUT ICON (for split view) ────────────────────────────────────────────

function Layout(props: any) {
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
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <line x1="12" y1="3" x2="12" y2="21" />
    </svg>
  );
}
