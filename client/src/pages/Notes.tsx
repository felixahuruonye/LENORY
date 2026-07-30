// client/src/pages/KnowledgeBaseHome.tsx
import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { supabase } from "@/lib/supabase";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogClose } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import {
  BookOpen, Upload, Trash2, Loader2, FileText, Brain,
  MessageCircle, Layers, ChevronLeft, ChevronRight, RotateCw, CheckCircle2, XCircle,
  FolderOpen, Plus, MoreVertical, Share2, Link2, QrCode, Copy, Eye,
  Database, Zap, Sparkles, GraduationCap, Clock, Users, Globe,
  Lock, Unlock, ChevronDown, File, Image, FileCode, FileJson, FileText,
  Music, Video, Archive, Download, ExternalLink, Settings, Coins,
} from "lucide-react";
import { formatDistanceToNow, format } from "date-fns";

// ─── KB COMPONENT IMPORTS ────────────────────────────────────────────────────
import {
  FolderCard,
  FileItem,
  AIActions,
  FolderCreditsDialog,
  ShareDialog,
  GuideDialog,
} from "@/components/kb";

// ─── TYPES ─────────────────────────────────────────────────────────────────────

interface Folder {
  id: string;
  name: string;
  description: string | null;
  storage_used: number;
  storage_limit: number;
  credits_allocated: number;
  credits_used: number;
  is_archived: boolean;
  share_code: string | null;
  share_password: string | null;
  share_permission: string | null;
  share_expires_at: string | null;
  share_max_uses: number | null;
  share_current_uses: number | null;
  created_at: string;
  updated_at: string;
}

interface KBFile {
  id: string;
  folder_id: string;
  name: string;
  file_type: string;
  source_type: string;
  external_id: string | null;
  file_size: number;
  extracted_text: string | null;
  full_text_url: string | null;
  mime_type: string | null;
  processed: boolean;
  created_at: string;
  updated_at: string;
}

interface FolderCredits {
  balance: number;
  allocated: number;
  used: number;
}

// ─── GUIDE STEPS ─────────────────────────────────────────────────────────────

const GUIDE_STEPS = [
  {
    title: "📚 Welcome to Your Knowledge Base!",
    description: "This is your personal study hub. Upload notes, create folders, and practice with AI.",
  },
  {
    title: "📁 Create Folders",
    description: "Organize your materials by subject, course, or exam. Each folder gets 10 free credits to start.",
  },
  {
    title: "📤 Upload Files",
    description: "Upload from your computer, Google Drive, Google Docs, or paste a URL. We support PDFs, images, documents, and more!",
  },
  {
    title: "🤖 AI Practice",
    description: "Click 'Chat Practice' to talk with AI about your files. Generate quizzes and flashcards to test yourself!",
  },
  {
    title: "🔗 Share with Friends",
    description: "Share folders with classmates via link, QR code, or WhatsApp. Great for study groups!",
  },
  {
    title: "💰 Credits & Storage",
    description: "Each folder has its own credits and storage. Top up when needed. Pro and Premium users get more!",
  },
  {
    title: "🎉 You're Ready!",
    description: "Start organizing your study materials today.",
  },
];

// ─── MAIN COMPONENT ──────────────────────────────────────────────────────────

export default function KnowledgeBaseHome() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedFolder, setSelectedFolder] = useState<Folder | null>(null);
  const [showCreateFolder, setShowCreateFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [newFolderDesc, setNewFolderDesc] = useState("");
  const [showShareDialog, setShowShareDialog] = useState(false);
  const [shareLink, setShareLink] = useState("");
  const [shareCode, setShareCode] = useState("");
  const [sharePermission, setSharePermission] = useState("view");
  const [showGuide, setShowGuide] = useState(false);
  const [guideStep, setGuideStep] = useState(0);
  const [showFileUpload, setShowFileUpload] = useState(false);
  const [uploadSource, setUploadSource] = useState<"computer" | "url" | "text">("computer");
  const [urlInput, setUrlInput] = useState("");
  const [textName, setTextName] = useState("");
  const [textContent, setTextContent] = useState("");
  const [uploadingFile, setUploadingFile] = useState<File | null>(null);
  const [showFolderCredits, setShowFolderCredits] = useState(false);
  const [selectedFolderForCredits, setSelectedFolderForCredits] = useState<Folder | null>(null);
  const [folderCredits, setFolderCredits] = useState<FolderCredits | null>(null);
  const [creditTransactions, setCreditTransactions] = useState<any[]>([]);
  const [topupAmount, setTopupAmount] = useState(10);
  const [isTopupLoading, setIsTopupLoading] = useState(false);

  // ─── QUERIES ────────────────────────────────────────────────────────────────

  // Get all folders
  const { data: folders = [], isLoading: foldersLoading, refetch: refetchFolders } = useQuery<Folder[]>({
    queryKey: ["/api/kb/folders"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/kb/folders");
      return res.json();
    },
  });

  // Get files for selected folder
  const { data: files = [], isLoading: filesLoading, refetch: refetchFiles } = useQuery<KBFile[]>({
    queryKey: ["/api/kb/folders", selectedFolder?.id, "files"],
    queryFn: async () => {
      if (!selectedFolder) return [];
      const res = await apiRequest("GET", `/api/kb/folders/${selectedFolder.id}`);
      const data = await res.json();
      return data.files || [];
    },
    enabled: !!selectedFolder,
  });

  // Get guide progress
  const { data: guideProgress } = useQuery({
    queryKey: ["/api/kb/guide/knowledge_base"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/kb/guide/knowledge_base");
      return res.json();
    },
  });

  // ─── MUTATIONS ─────────────────────────────────────────────────────────────

  // Create folder
  const createFolderMutation = useMutation({
    mutationFn: async ({ name, description }: { name: string; description?: string }) => {
      const res = await apiRequest("POST", "/api/kb/folders", { name, description });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/kb/folders"] });
      setShowCreateFolder(false);
      setNewFolderName("");
      setNewFolderDesc("");
      toast({ title: "Folder created!", description: "Your new folder is ready." });
    },
    onError: (err: any) => {
      toast({ title: "Failed to create folder", description: err.message, variant: "destructive" });
    },
  });

  // Delete folder
  const deleteFolderMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/kb/folders/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/kb/folders"] });
      if (selectedFolder?.id) setSelectedFolder(null);
      toast({ title: "Folder deleted", description: "Folder and all files removed." });
    },
    onError: (err: any) => {
      toast({ title: "Failed to delete folder", description: err.message, variant: "destructive" });
    },
  });

  // Generate share link
  const shareMutation = useMutation({
    mutationFn: async ({ folderId, permission }: { folderId: string; permission: string }) => {
      const res = await apiRequest("POST", `/api/kb/folders/${folderId}/share`, { permission });
      return res.json();
    },
    onSuccess: (data) => {
      setShareLink(data.shareUrl);
      setShareCode(data.shareCode);
      toast({ title: "Share link generated!", description: "Copy the link to share with others." });
    },
    onError: (err: any) => {
      toast({ title: "Failed to generate share link", description: err.message, variant: "destructive" });
    },
  });

  // Remove share link
  const removeShareMutation = useMutation({
    mutationFn: async (folderId: string) => {
      await apiRequest("DELETE", `/api/kb/folders/${folderId}/share`);
    },
    onSuccess: () => {
      setShareLink("");
      setShareCode("");
      queryClient.invalidateQueries({ queryKey: ["/api/kb/folders"] });
      toast({ title: "Share link removed" });
    },
    onError: (err: any) => {
      toast({ title: "Failed to remove share link", description: err.message, variant: "destructive" });
    },
  });

  // Upload file to folder
  const uploadFileMutation = useMutation({
    mutationFn: async ({ folderId, file, description }: { folderId: string; file: File; description?: string }) => {
      const formData = new FormData();
      formData.append("file", file);
      if (description) formData.append("description", description);
      const res = await apiRequest("POST", `/api/kb/folders/${folderId}/files`, formData);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/kb/folders", selectedFolder?.id, "files"] });
      queryClient.invalidateQueries({ queryKey: ["/api/kb/folders"] });
      setShowFileUpload(false);
      setUploadingFile(null);
      toast({ title: "File uploaded!", description: "Your file has been added to the folder." });
    },
    onError: (err: any) => {
      toast({ title: "Failed to upload file", description: err.message, variant: "destructive" });
    },
  });

  // Add URL to folder
  const addUrlMutation = useMutation({
    mutationFn: async ({ folderId, url, name }: { folderId: string; url: string; name?: string }) => {
      const res = await apiRequest("POST", `/api/kb/folders/${folderId}/files/url`, { url, name });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/kb/folders", selectedFolder?.id, "files"] });
      queryClient.invalidateQueries({ queryKey: ["/api/kb/folders"] });
      setShowFileUpload(false);
      setUrlInput("");
      toast({ title: "URL added!", description: "The content has been saved to your folder." });
    },
    onError: (err: any) => {
      toast({ title: "Failed to add URL", description: err.message, variant: "destructive" });
    },
  });

  // Create text file
  const createTextMutation = useMutation({
    mutationFn: async ({ folderId, name, content }: { folderId: string; name: string; content: string }) => {
      const res = await apiRequest("POST", `/api/kb/folders/${folderId}/files/text`, { name, content });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/kb/folders", selectedFolder?.id, "files"] });
      queryClient.invalidateQueries({ queryKey: ["/api/kb/folders"] });
      setShowFileUpload(false);
      setTextName("");
      setTextContent("");
      toast({ title: "Note created!", description: "Your text has been saved to the folder." });
    },
    onError: (err: any) => {
      toast({ title: "Failed to create note", description: err.message, variant: "destructive" });
    },
  });

  // Delete file
  const deleteFileMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/kb/files/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/kb/folders", selectedFolder?.id, "files"] });
      queryClient.invalidateQueries({ queryKey: ["/api/kb/folders"] });
      toast({ title: "File deleted" });
    },
    onError: (err: any) => {
      toast({ title: "Failed to delete file", description: err.message, variant: "destructive" });
    },
  });

  // Chat practice
  const chatPracticeMutation = useMutation({
    mutationFn: async ({ folderId, message }: { folderId: string; message: string }) => {
      const res = await apiRequest("POST", `/api/kb/folders/${folderId}/chat`, { message });
      return res.json();
    },
    onSuccess: (data) => {
      toast({ title: "AI Response", description: data.response?.substring(0, 100) + "..." });
    },
    onError: (err: any) => {
      toast({ title: "Chat failed", description: err.message, variant: "destructive" });
    },
  });

  // Generate quiz
  const generateQuizMutation = useMutation({
    mutationFn: async ({ folderId, questionCount }: { folderId: string; questionCount: number }) => {
      const res = await apiRequest("POST", `/api/kb/folders/${folderId}/quiz`, { questionCount });
      return res.json();
    },
    onSuccess: (data) => {
      // Show quiz in a dialog
      toast({ title: "Quiz generated!", description: `Created ${data.questions?.length || 0} questions.` });
      // Could open a quiz dialog here
    },
    onError: (err: any) => {
      toast({ title: "Failed to generate quiz", description: err.message, variant: "destructive" });
    },
  });

  // Generate flashcards
  const generateFlashcardsMutation = useMutation({
    mutationFn: async ({ folderId, count }: { folderId: string; count: number }) => {
      const res = await apiRequest("POST", `/api/kb/folders/${folderId}/flashcards`, { count });
      return res.json();
    },
    onSuccess: (data) => {
      toast({ title: "Flashcards generated!", description: `Created ${data.flashcards?.length || 0} cards.` });
    },
    onError: (err: any) => {
      toast({ title: "Failed to generate flashcards", description: err.message, variant: "destructive" });
    },
  });

  // Generate summary
  const generateSummaryMutation = useMutation({
    mutationFn: async (folderId: string) => {
      const res = await apiRequest("POST", `/api/kb/folders/${folderId}/summary`);
      return res.json();
    },
    onSuccess: (data) => {
      toast({ title: "Summary generated!", description: "Check the folder for your summary." });
    },
    onError: (err: any) => {
      toast({ title: "Failed to generate summary", description: err.message, variant: "destructive" });
    },
  });

  // Get folder credits
  const getFolderCredits = async (folderId: string) => {
    try {
      const res = await apiRequest("GET", `/api/kb/folders/${folderId}/credits`);
      const data = await res.json();
      setFolderCredits(data.credits);
      setCreditTransactions(data.transactions || []);
      setSelectedFolderForCredits(folders.find((f: Folder) => f.id === folderId) || null);
      setShowFolderCredits(true);
    } catch (err: any) {
      toast({ title: "Failed to fetch credits", description: err.message, variant: "destructive" });
    }
  };

  // Top up folder credits
  const topUpCreditsMutation = useMutation({
    mutationFn: async ({ folderId, amount }: { folderId: string; amount: number }) => {
      const res = await apiRequest("POST", `/api/kb/folders/${folderId}/credits/topup`, { amount });
      return res.json();
    },
    onSuccess: (data) => {
      setFolderCredits((prev) => ({ ...prev, balance: data.balance }));
      toast({ title: "Credits added!", description: `Added ${topupAmount} credits to this folder.` });
      setIsTopupLoading(false);
      queryClient.invalidateQueries({ queryKey: ["/api/kb/folders"] });
    },
    onError: (err: any) => {
      toast({ title: "Failed to add credits", description: err.message, variant: "destructive" });
      setIsTopupLoading(false);
    },
  });

  // Update guide progress
  const updateGuideMutation = useMutation({
    mutationFn: async ({ step, completed }: { step: number; completed: boolean }) => {
      const res = await apiRequest("POST", "/api/kb/guide/knowledge_base", { currentStep: step, completed });
      return res.json();
    },
  });

  // ─── EFFECTS ────────────────────────────────────────────────────────────────

  // Show guide on first visit
  useEffect(() => {
    if (guideProgress && !guideProgress.completed) {
      setShowGuide(true);
    }
  }, [guideProgress]);

  // ─── HANDLERS ──────────────────────────────────────────────────────────────

  const handleCreateFolder = () => {
    if (!newFolderName.trim()) {
      toast({ title: "Name required", description: "Please enter a folder name.", variant: "destructive" });
      return;
    }
    createFolderMutation.mutate({ name: newFolderName.trim(), description: newFolderDesc.trim() || undefined });
  };

  const handleShareFolder = (folder: Folder) => {
    setSelectedFolder(folder);
    if (folder.share_code) {
      setShareLink(`${window.location.origin}/share/${folder.share_code}`);
      setShareCode(folder.share_code);
    } else {
      shareMutation.mutate({ folderId: folder.id, permission: sharePermission });
    }
    setShowShareDialog(true);
  };

  const handleRemoveShare = () => {
    if (selectedFolder) {
      removeShareMutation.mutate(selectedFolder.id);
      setShareLink("");
      setShareCode("");
    }
  };

  const handleCopyLink = () => {
    navigator.clipboard.writeText(shareLink);
    toast({ title: "Copied!", description: "Share link copied to clipboard." });
  };

  const handleShareWhatsApp = () => {
    const text = `📚 Check out my study folder on LENORY!\n\n${shareLink}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank");
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingFile(file);
    setShowFileUpload(true);
    setUploadSource("computer");
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleUploadSubmit = () => {
    if (!selectedFolder) {
      toast({ title: "No folder selected", description: "Please select a folder first.", variant: "destructive" });
      return;
    }

    if (uploadSource === "computer" && uploadingFile) {
      uploadFileMutation.mutate({ folderId: selectedFolder.id, file: uploadingFile });
    } else if (uploadSource === "url" && urlInput.trim()) {
      addUrlMutation.mutate({ folderId: selectedFolder.id, url: urlInput.trim(), name: urlInput.trim().substring(0, 50) });
    } else if (uploadSource === "text" && textName.trim() && textContent.trim()) {
      createTextMutation.mutate({ folderId: selectedFolder.id, name: textName.trim(), content: textContent.trim() });
    } else {
      toast({ title: "Missing information", description: "Please fill in all required fields.", variant: "destructive" });
    }
  };

  const handleGuideNext = () => {
    if (guideStep < GUIDE_STEPS.length - 1) {
      setGuideStep(guideStep + 1);
    } else {
      setShowGuide(false);
      updateGuideMutation.mutate({ step: guideStep, completed: true });
    }
  };

  const handleGuideSkip = () => {
    setShowGuide(false);
    updateGuideMutation.mutate({ step: 0, completed: true });
  };

  const formatStorage = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  };

  const getFileIcon = (fileType: string) => {
    if (fileType.includes("image")) return <Image className="h-4 w-4" />;
    if (fileType.includes("pdf")) return <FileText className="h-4 w-4" />;
    if (fileType.includes("text") || fileType.includes("plain")) return <FileText className="h-4 w-4" />;
    if (fileType.includes("json")) return <FileJson className="h-4 w-4" />;
    if (fileType.includes("html") || fileType.includes("css") || fileType.includes("javascript")) return <FileCode className="h-4 w-4" />;
    if (fileType.includes("audio")) return <Music className="h-4 w-4" />;
    if (fileType.includes("video")) return <Video className="h-4 w-4" />;
    if (fileType.includes("zip") || fileType.includes("rar")) return <Archive className="h-4 w-4" />;
    if (fileType === "url") return <Link2 className="h-4 w-4" />;
    if (fileType === "text") return <FileText className="h-4 w-4" />;
    return <File className="h-4 w-4" />;
  };

  const getSourceLabel = (sourceType: string) => {
    const labels: Record<string, string> = {
      upload: "Uploaded",
      url: "From URL",
      google_drive: "Google Drive",
      google_docs: "Google Docs",
      github: "GitHub",
      text: "Created",
    };
    return labels[sourceType] || sourceType;
  };

  // ─── RENDER ──────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-20 border-b border-border/50 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-3">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setLocation("/dashboard")}
                className="hover-elevate"
              >
                <ChevronLeft className="h-5 w-5" />
              </Button>
              <div className="flex items-center gap-2">
                <BookOpen className="h-6 w-6 text-primary" />
                <h1 className="text-xl font-bold">Knowledge Base</h1>
                <Badge variant="outline" className="text-xs">v2</Badge>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  if (folders.length > 0) {
                    setSelectedFolder(folders[0]);
                  } else {
                    setShowCreateFolder(true);
                  }
                }}
                className="gap-2 hover-elevate"
              >
                <FolderOpen className="h-4 w-4" />
                Open Folder
              </Button>
              <Button
                size="sm"
                onClick={() => setShowCreateFolder(true)}
                className="gap-2 hover-elevate"
                data-testid="button-create-folder"
              >
                <Plus className="h-4 w-4" />
                New Folder
              </Button>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {/* Storage Summary */}
        <div className="mb-6">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-4">
              <div>
                <p className="text-sm text-muted-foreground">Total Storage Used</p>
                <p className="text-xl font-semibold">
                  {formatStorage(folders.reduce((acc: number, f: Folder) => acc + (f.storage_used || 0), 0))}
                </p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Total Folders</p>
                <p className="text-xl font-semibold">{folders.length}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowGuide(true)}
                className="gap-2 hover-elevate"
              >
                <GraduationCap className="h-4 w-4" />
                Guide
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => refetchFolders()}
                className="hover-elevate"
              >
                <RotateCw className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>

        {/* Folder Grid */}
        {foldersLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : folders.length === 0 ? (
          <div className="text-center py-20">
            <FolderOpen className="h-16 w-16 mx-auto text-muted-foreground/50 mb-4" />
            <h3 className="text-xl font-semibold mb-2">No folders yet</h3>
            <p className="text-muted-foreground mb-6">Create your first folder to start organizing your study materials.</p>
            <Button onClick={() => setShowCreateFolder(true)} className="gap-2 hover-elevate">
              <Plus className="h-4 w-4" />
              Create Folder
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {folders.map((folder: Folder) => {
              const storagePercent = Math.min(100, ((folder.storage_used || 0) / (folder.storage_limit || 1)) * 100);
              const creditBalance = (folder.credits_allocated || 0) - (folder.credits_used || 0);
              const isLowCredits = creditBalance < 3 && creditBalance > 0;
              const isOutOfCredits = creditBalance <= 0;

              return (
                <Card
                  key={folder.id}
                  className={`hover-elevate cursor-pointer transition-all border-2 ${
                    selectedFolder?.id === folder.id ? "border-primary/50 shadow-primary/20" : "border-border/50"
                  }`}
                  onClick={() => setSelectedFolder(folder)}
                  data-testid={`folder-${folder.id}`}
                >
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <FolderOpen className="h-5 w-5 text-primary flex-shrink-0" />
                          <CardTitle className="text-base truncate">{folder.name}</CardTitle>
                        </div>
                        {folder.description && (
                          <p className="text-sm text-muted-foreground truncate mt-1">{folder.description}</p>
                        )}
                      </div>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        {folder.share_code && (
                          <Badge variant="secondary" className="text-[10px] gap-1">
                            <Globe className="h-3 w-3" /> Shared
                          </Badge>
                        )}
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8"
                          onClick={(e) => {
                            e.stopPropagation();
                            getFolderCredits(folder.id);
                          }}
                          data-testid={`folder-credits-${folder.id}`}
                        >
                          <Coins className={`h-4 w-4 ${isOutOfCredits ? "text-red-500" : isLowCredits ? "text-yellow-500" : "text-green-500"}`} />
                        </Button>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">
                          {formatStorage(folder.storage_used || 0)} / {formatStorage(folder.storage_limit || 0)}
                        </span>
                        <span className="text-muted-foreground">
                          {creditBalance} credits left
                        </span>
                      </div>
                      <Progress value={storagePercent} className="h-1.5" />
                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <span>Created {formatDistanceToNow(new Date(folder.created_at), { addSuffix: true })}</span>
                        <div className="flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-xs gap-1"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleShareFolder(folder);
                            }}
                            data-testid={`folder-share-${folder.id}`}
                          >
                            <Share2 className="h-3 w-3" />
                            Share
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-xs text-destructive hover:text-destructive"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (confirm(`Delete "${folder.name}" and all its files?`)) {
                                deleteFolderMutation.mutate(folder.id);
                              }
                            }}
                            data-testid={`folder-delete-${folder.id}`}
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}

        {/* Selected Folder - Files View */}
        {selectedFolder && (
          <div className="mt-8">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <h2 className="text-xl font-semibold">{selectedFolder.name}</h2>
                <Badge variant="secondary">{files.length} files</Badge>
              </div>
              <div className="flex items-center gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  className="hidden"
                  onChange={handleFileUpload}
                  accept="image/*,.pdf,.txt,.doc,.docx,.csv,.json,.html,.css,.js,.ts,.py,.java,.c,.cpp"
                  data-testid="file-upload-input"
                />
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => fileInputRef.current?.click()}
                  className="gap-2 hover-elevate"
                  data-testid="button-upload-file"
                >
                  <Upload className="h-4 w-4" />
                  Upload
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setShowFileUpload(true);
                    setUploadSource("url");
                  }}
                  className="gap-2 hover-elevate"
                >
                  <Link2 className="h-4 w-4" />
                  Add URL
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setShowFileUpload(true);
                    setUploadSource("text");
                  }}
                  className="gap-2 hover-elevate"
                >
                  <FileText className="h-4 w-4" />
                  Create Note
                </Button>
              </div>
            </div>

            {filesLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
              </div>
            ) : files.length === 0 ? (
              <Card className="p-8 text-center text-muted-foreground">
                <FileText className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>No files in this folder yet.</p>
                <p className="text-sm mt-1">Upload files, add URLs, or create notes to get started.</p>
              </Card>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {files.map((file: KBFile) => (
                  <Card key={file.id} className="hover-elevate">
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="p-2 bg-primary/10 rounded-lg flex-shrink-0">
                            {getFileIcon(file.file_type)}
                          </div>
                          <div className="min-w-0">
                            <p className="font-medium text-sm truncate">{file.name}</p>
                            <div className="flex items-center gap-2 text-xs text-muted-foreground">
                              <span>{getSourceLabel(file.source_type)}</span>
                              <span>•</span>
                              <span>{formatDistanceToNow(new Date(file.created_at), { addSuffix: true })}</span>
                              {file.file_size > 0 && (
                                <>
                                  <span>•</span>
                                  <span>{formatStorage(file.file_size)}</span>
                                </>
                              )}
                            </div>
                          </div>
                        </div>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8 text-destructive hover:text-destructive"
                          onClick={() => deleteFileMutation.mutate(file.id)}
                          data-testid={`file-delete-${file.id}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                      {file.extracted_text && (
                        <p className="text-xs text-muted-foreground mt-2 line-clamp-2">
                          {file.extracted_text.substring(0, 150)}...
                        </p>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}

            {/* AI Actions */}
            <div className="mt-6">
              <h3 className="text-sm font-medium text-muted-foreground mb-3">AI Actions</h3>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const msg = prompt("Ask LENORY about the files in this folder:");
                    if (msg) chatPracticeMutation.mutate({ folderId: selectedFolder.id, message: msg });
                  }}
                  disabled={chatPracticeMutation.isPending}
                  className="gap-2 hover-elevate"
                  data-testid="button-chat-practice"
                >
                  <MessageCircle className="h-4 w-4" />
                  Chat Practice
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const count = prompt("How many quiz questions? (5-15)", "5");
                    if (count) generateQuizMutation.mutate({ folderId: selectedFolder.id, questionCount: parseInt(count) || 5 });
                  }}
                  disabled={generateQuizMutation.isPending}
                  className="gap-2 hover-elevate"
                >
                  <Brain className="h-4 w-4" />
                  Generate Quiz
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const count = prompt("How many flashcards? (5-30)", "10");
                    if (count) generateFlashcardsMutation.mutate({ folderId: selectedFolder.id, count: parseInt(count) || 10 });
                  }}
                  disabled={generateFlashcardsMutation.isPending}
                  className="gap-2 hover-elevate"
                >
                  <Layers className="h-4 w-4" />
                  Flashcards
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => generateSummaryMutation.mutate(selectedFolder.id)}
                  disabled={generateSummaryMutation.isPending}
                  className="gap-2 hover-elevate"
                >
                  <Zap className="h-4 w-4" />
                  Generate Summary
                </Button>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* ─── CREATE FOLDER DIALOG ────────────────────────────────────────────── */}
      <Dialog open={showCreateFolder} onOpenChange={setShowCreateFolder}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FolderOpen className="h-5 w-5 text-primary" />
              Create New Folder
            </DialogTitle>
            <DialogDescription>
              Organize your study materials by subject, course, or exam.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium">Folder Name *</label>
              <Input
                placeholder="e.g., Mathematics 101"
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                className="mt-1"
                data-testid="input-folder-name"
              />
            </div>
            <div>
              <label className="text-sm font-medium">Description (optional)</label>
              <Textarea
                placeholder="What's this folder for?"
                value={newFolderDesc}
                onChange={(e) => setNewFolderDesc(e.target.value)}
                className="mt-1 resize-none"
                rows={2}
              />
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Badge variant="secondary">10 free credits</Badge>
              <span>included with each new folder</span>
            </div>
            <div className="flex gap-2">
              <Button
                onClick={handleCreateFolder}
                disabled={createFolderMutation.isPending || !newFolderName.trim()}
                className="flex-1 hover-elevate"
                data-testid="button-create-folder-submit"
              >
                {createFolderMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Creating...
                  </>
                ) : (
                  "Create Folder"
                )}
              </Button>
              <Button variant="outline" onClick={() => setShowCreateFolder(false)}>
                Cancel
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ─── SHARE DIALOG ────────────────────────────────────────────────────── */}
      <Dialog open={showShareDialog} onOpenChange={(open) => {
        if (!open) setShowShareDialog(false);
      }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Share2 className="h-5 w-5 text-primary" />
              Share Folder
            </DialogTitle>
            <DialogDescription>
              Share this folder with classmates and study groups.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {!shareCode ? (
              <>
                <div>
                  <label className="text-sm font-medium">Permission Level</label>
                  <select
                    className="w-full mt-1 p-2 rounded-md border border-input bg-background"
                    value={sharePermission}
                    onChange={(e) => setSharePermission(e.target.value)}
                  >
                    <option value="view">View Only</option>
                    <option value="comment">View & Comment</option>
                    <option value="ai">View & AI Access</option>
                  </select>
                </div>
                <Button
                  onClick={() => shareMutation.mutate({ folderId: selectedFolder?.id || "", permission: sharePermission })}
                  disabled={shareMutation.isPending}
                  className="w-full gap-2 hover-elevate"
                >
                  {shareMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Link2 className="h-4 w-4" />
                  )}
                  Generate Share Link
                </Button>
              </>
            ) : (
              <>
                <div className="p-3 bg-muted/50 rounded-lg">
                  <p className="text-xs text-muted-foreground mb-1">Share Link</p>
                  <div className="flex items-center gap-2">
                    <Input value={shareLink} readOnly className="text-xs" />
                    <Button size="icon" variant="outline" onClick={handleCopyLink} data-testid="button-copy-share-link">
                      <Copy className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" onClick={handleShareWhatsApp} className="gap-2">
                    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                    </svg>
                    WhatsApp
                  </Button>
                  <Button variant="outline" size="sm" onClick={handleCopyLink} className="gap-2">
                    <Copy className="h-4 w-4" />
                    Copy Link
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={handleRemoveShare}
                    disabled={removeShareMutation.isPending}
                    className="gap-2"
                  >
                    <Trash2 className="h-4 w-4" />
                    Remove Link
                  </Button>
                </div>
                {selectedFolder?.share_expires_at && (
                  <p className="text-xs text-muted-foreground">
                    Expires: {format(new Date(selectedFolder.share_expires_at), "PPP")}
                  </p>
                )}
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* ─── FILE UPLOAD DIALOG ────────────────────────────────────────────── */}
      <Dialog open={showFileUpload} onOpenChange={setShowFileUpload}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Upload className="h-5 w-5 text-primary" />
              Add Files to {selectedFolder?.name}
            </DialogTitle>
            <DialogDescription>
              Upload from your computer, add a URL, or create a text note.
            </DialogDescription>
          </DialogHeader>
          <Tabs value={uploadSource} onValueChange={(v) => setUploadSource(v as any)}>
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="computer">Upload</TabsTrigger>
              <TabsTrigger value="url">URL</TabsTrigger>
              <TabsTrigger value="text">Text</TabsTrigger>
            </TabsList>

            <TabsContent value="computer" className="space-y-4">
              {uploadingFile ? (
                <div className="p-4 border rounded-lg">
                  <p className="font-medium">{uploadingFile.name}</p>
                  <p className="text-sm text-muted-foreground">{formatStorage(uploadingFile.size)}</p>
                </div>
              ) : (
                <div
                  className="border-2 border-dashed rounded-lg p-8 text-center cursor-pointer hover:bg-muted/30 transition"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Upload className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
                  <p className="text-sm text-muted-foreground">Click to select a file</p>
                  <p className="text-xs text-muted-foreground">Supports images, PDFs, documents, and more</p>
                </div>
              )}
              {uploadingFile && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => { setUploadingFile(null); if (fileInputRef.current) fileInputRef.current.value = ""; }}
                >
                  Change File
                </Button>
              )}
            </TabsContent>

            <TabsContent value="url" className="space-y-4">
              <div>
                <label className="text-sm font-medium">URL *</label>
                <Input
                  placeholder="https://example.com/article"
                  value={urlInput}
                  onChange={(e) => setUrlInput(e.target.value)}
                  className="mt-1"
                />
              </div>
              <p className="text-xs text-muted-foreground">
                LENORY will extract and save the content from this URL.
              </p>
            </TabsContent>

            <TabsContent value="text" className="space-y-4">
              <div>
                <label className="text-sm font-medium">Note Name *</label>
                <Input
                  placeholder="My Study Notes"
                  value={textName}
                  onChange={(e) => setTextName(e.target.value)}
                  className="mt-1"
                />
              </div>
              <div>
                <label className="text-sm font-medium">Content *</label>
                <Textarea
                  placeholder="Write your notes here..."
                  value={textContent}
                  onChange={(e) => setTextContent(e.target.value)}
                  className="mt-1 resize-none"
                  rows={5}
                />
              </div>
            </TabsContent>
          </Tabs>

          <div className="flex gap-2">
            <Button
              onClick={handleUploadSubmit}
              disabled={
                (uploadSource === "computer" && !uploadingFile) ||
                (uploadSource === "url" && !urlInput.trim()) ||
                (uploadSource === "text" && (!textName.trim() || !textContent.trim())) ||
                uploadFileMutation.isPending ||
                addUrlMutation.isPending ||
                createTextMutation.isPending
              }
              className="flex-1 hover-elevate"
              data-testid="button-upload-submit"
            >
              {uploadFileMutation.isPending || addUrlMutation.isPending || createTextMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Adding...
                </>
              ) : (
                "Add to Folder"
              )}
            </Button>
            <Button variant="outline" onClick={() => {
              setShowFileUpload(false);
              setUploadingFile(null);
              setUrlInput("");
              setTextName("");
              setTextContent("");
            }}>
              Cancel
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ─── FOLDER CREDITS DIALOG ───────────────────────────────────────────── */}
      <Dialog open={showFolderCredits} onOpenChange={setShowFolderCredits}>
        <DialogContent className="max-w-lg max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Coins className="h-5 w-5 text-primary" />
              Folder Credits: {selectedFolderForCredits?.name}
            </DialogTitle>
          </DialogHeader>
          <ScrollArea className="flex-1 pr-4">
            {folderCredits && (
              <div className="space-y-4">
                <div className="grid grid-cols-3 gap-3">
                  <Card>
                    <CardContent className="p-3 text-center">
                      <p className="text-2xl font-bold text-green-500">{folderCredits.balance}</p>
                      <p className="text-xs text-muted-foreground">Available</p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="p-3 text-center">
                      <p className="text-2xl font-bold text-blue-500">{folderCredits.allocated}</p>
                      <p className="text-xs text-muted-foreground">Allocated</p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="p-3 text-center">
                      <p className="text-2xl font-bold text-yellow-500">{folderCredits.used}</p>
                      <p className="text-xs text-muted-foreground">Used</p>
                    </CardContent>
                  </Card>
                </div>

                <div className="space-y-2">
                  <p className="text-sm font-medium">Top Up Credits</p>
                  <div className="flex items-center gap-2">
                    {[5, 10, 20, 50].map((amount) => (
                      <Button
                        key={amount}
                        variant={topupAmount === amount ? "default" : "outline"}
                        size="sm"
                        onClick={() => setTopupAmount(amount)}
                        className="flex-1"
                      >
                        +{amount}
                      </Button>
                    ))}
                  </div>
                  <Button
                    onClick={() => {
                      setIsTopupLoading(true);
                      topUpCreditsMutation.mutate({ folderId: selectedFolderForCredits?.id || "", amount: topupAmount });
                    }}
                    disabled={isTopupLoading || topUpCreditsMutation.isPending}
                    className="w-full hover-elevate"
                  >
                    {isTopupLoading || topUpCreditsMutation.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      `Top Up ${topupAmount} Credits`
                    )}
                  </Button>
                </div>

                <div>
                  <p className="text-sm font-medium mb-2">Transaction History</p>
                  <div className="space-y-2 max-h-[200px] overflow-y-auto">
                    {creditTransactions.length === 0 ? (
                      <p className="text-sm text-muted-foreground text-center">No transactions yet</p>
                    ) : (
                      creditTransactions.slice(0, 20).map((tx: any) => (
                        <div key={tx.id} className="flex items-center justify-between p-2 bg-muted/30 rounded-lg">
                          <div>
                            <p className="text-sm font-medium">
                              {tx.type === 'allocated' && '✨ Allocated'}
                              {tx.type === 'used' && '📤 Used'}
                              {tx.type === 'topup' && '💰 Top Up'}
                              {tx.type === 'refund' && '↩️ Refund'}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {formatDistanceToNow(new Date(tx.created_at), { addSuffix: true })}
                            </p>
                          </div>
                          <div className="text-right">
                            <p className={`font-bold ${tx.amount > 0 ? 'text-green-500' : 'text-red-500'}`}>
                              {tx.amount > 0 ? '+' : ''}{tx.amount}
                            </p>
                            <p className="text-xs text-muted-foreground">Balance: {tx.balance_after}</p>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            )}
          </ScrollArea>
        </DialogContent>
      </Dialog>

      {/* ─── GUIDE DIALOG ───────────────────────────────────────────────────── */}
      <Dialog open={showGuide} onOpenChange={setShowGuide}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-center text-2xl font-bold">
              {GUIDE_STEPS[guideStep].title}
            </DialogTitle>
          </DialogHeader>
          <div className="py-6 text-center">
            <div className="text-6xl mb-4">
              {guideStep === 0 && "📚"}
              {guideStep === 1 && "📁"}
              {guideStep === 2 && "📤"}
              {guideStep === 3 && "🤖"}
              {guideStep === 4 && "🔗"}
              {guideStep === 5 && "💰"}
              {guideStep === 6 && "🎉"}
            </div>
            <p className="text-muted-foreground">{GUIDE_STEPS[guideStep].description}</p>
            <div className="flex justify-center gap-1 mt-4">
              {GUIDE_STEPS.map((_, i) => (
                <div
                  key={i}
                  className={`h-2 w-2 rounded-full transition ${i === guideStep ? "bg-primary" : "bg-muted"}`}
                />
              ))}
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={handleGuideSkip} className="flex-1">
              Skip
            </Button>
            <Button onClick={handleGuideNext} className="flex-1 hover-elevate">
              {guideStep === GUIDE_STEPS.length - 1 ? "Get Started" : "Next"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
