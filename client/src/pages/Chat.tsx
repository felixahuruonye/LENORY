import { useState, useRef, useEffect, useCallback } from "react";
import { useAuth } from "@/hooks/useAuth";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/ThemeToggle";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Send,
  MessageSquare,
  Plus,
  Trash2,
  Menu,
  ChevronLeft,
  Loader2,
  User as UserIcon,
  Volume2,
  VolumeX,
  Settings,
  ChevronDown,
  Search,
  ExternalLink,
  Sparkles,
  BookOpen,
  Brain,
  Image,
  Code,
  Mic,
  MicOff,
  Camera,
  FileText,
  Film,
  Lock,
  X,
  Copy,
  Check,
  CheckSquare,
  Square,
  AlertTriangle,
  Zap,
  Phone,
  PhoneOff,
  Radio,
  Globe,
  ArrowLeft,
  Gauge,
  Lightbulb,
  PenLine,
  MoreVertical,
  Pin,
  PinOff,
  Pencil,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Link, useLocation, useSearch } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useVoice } from "@/lib/useVoice";
import { useVapi } from "@/hooks/useVapi";
import { detectFeatureOpen } from "@/lib/featureRegistry";
import type { ChatMessage, ChatSession, ChatMessageWithAttachments } from "@shared/schema";

// ─── Models ──────────────────────────────────────────────────────────────────
const AI_MODELS = [
  { id: "lenory-ultra", label: "LENORY Ultra", description: "Most capable — GPT-4 class" },
  { id: "lenory-fast", label: "LENORY Fast", description: "Quick responses — GPT-3.5" },
  { id: "lenory-vision", label: "LENORY Vision", description: "Images & files — Gemini" },
  { id: "lenory-search", label: "LENORY Search", description: "Internet-connected" },
];

// ─── Typing animation ──────────────────────────────────────────────────────────
function TypingIndicator() {
  return (
    <div className="flex items-center gap-3 py-2 px-1">
      <div className="w-7 h-7 rounded-full bg-primary/15 flex items-center justify-center flex-shrink-0">
        <PenLine className="w-4 h-4 text-primary animate-pulse" />
      </div>
      <div className="flex items-center gap-1.5">
        <span className="w-2 h-2 rounded-full bg-primary/60 animate-bounce" style={{ animationDelay: "0ms" }} />
        <span className="w-2 h-2 rounded-full bg-primary/60 animate-bounce" style={{ animationDelay: "150ms" }} />
        <span className="w-2 h-2 rounded-full bg-primary/60 animate-bounce" style={{ animationDelay: "300ms" }} />
        <span className="ml-2 text-sm text-muted-foreground italic">LENORY is writing...</span>
      </div>
    </div>
  );
}

// ─── Code block with copy button ─────────────────────────────────────────────
function CodeBlock({ children, className }: { children: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  const lang = className?.replace("language-", "") || "code";

  const copy = async () => {
    await navigator.clipboard.writeText(children);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="relative group my-3 rounded-xl overflow-hidden border border-border/50">
      <div className="flex items-center justify-between px-4 py-2 bg-muted/80 border-b border-border/40">
        <span className="text-xs font-mono text-muted-foreground uppercase tracking-wider">{lang}</span>
        <button
          onClick={copy}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          data-testid="button-copy-code"
        >
          {copied ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
          <span>{copied ? "Copied!" : "Copy"}</span>
        </button>
      </div>
      <pre className="overflow-x-auto p-4 text-sm bg-muted/30 font-mono leading-relaxed">
        <code>{children}</code>
      </pre>
    </div>
  );
}

// ─── Markdown renderer ────────────────────────────────────────────────────────
function LenoryMarkdown({ content }: { content: string }) {
  return (
    <div className="prose prose-sm dark:prose-invert max-w-none
      prose-p:my-2 prose-p:leading-relaxed
      prose-headings:my-3 prose-headings:font-semibold
      prose-ul:my-2 prose-ol:my-2 prose-li:my-1
      prose-blockquote:border-l-primary prose-blockquote:bg-primary/5 prose-blockquote:py-1 prose-blockquote:px-4 prose-blockquote:rounded-r-lg prose-blockquote:not-italic
      prose-strong:text-foreground prose-strong:font-semibold
      prose-em:text-muted-foreground
      prose-table:my-3
      prose-th:bg-muted/50 prose-th:px-3 prose-th:py-2
      prose-td:px-3 prose-td:py-2 prose-td:border-border
    ">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={{
          code({ node, className, children, ...props }: any) {
            const isBlock = !!(props as any).inline === false || className?.includes("language-");
            const codeStr = String(children).replace(/\n$/, "");
            if (isBlock || className) {
              return <CodeBlock className={className}>{codeStr}</CodeBlock>;
            }
            return (
              <code className="bg-muted px-1.5 py-0.5 rounded text-sm font-mono text-primary" {...props}>
                {children}
              </code>
            );
          },
          a({ href, children }) {
            return (
              <a href={href} target="_blank" rel="noopener noreferrer"
                className="text-primary underline underline-offset-2 hover:text-primary/80 inline-flex items-center gap-0.5">
                {children}
                <ExternalLink className="w-3 h-3 inline" />
              </a>
            );
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

// ─── Credit alert card ────────────────────────────────────────────────────────
function CreditAlert({ credits, onUpgrade, onDismiss }: { credits: number; onUpgrade: () => void; onDismiss: () => void }) {
  return (
    <div className="mx-auto max-w-2xl my-4">
      <div className="relative rounded-2xl border border-amber-500/30 bg-gradient-to-br from-amber-950/30 via-amber-900/20 to-orange-950/30 p-5 backdrop-blur-sm">
        <button onClick={onDismiss} className="absolute top-3 right-3 text-muted-foreground hover:text-foreground" data-testid="button-dismiss-credit-alert">
          <X className="w-4 h-4" />
        </button>
        <div className="flex items-start gap-4">
          <div className="rounded-xl bg-amber-500/15 p-2.5 flex-shrink-0">
            <AlertTriangle className="w-5 h-5 text-amber-400" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-amber-300 mb-1">Low Credit Balance</h3>
            <p className="text-sm text-muted-foreground mb-3">
              You have <span className="font-bold text-amber-400">{credits} credits</span> remaining. Upgrade to Pro or Premium for unlimited AI access and exclusive features.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                onClick={onUpgrade}
                className="bg-gradient-to-r from-amber-500 to-orange-500 text-white border-0 hover:opacity-90"
                data-testid="button-upgrade-credits"
              >
                <Zap className="w-3.5 h-3.5 mr-1.5" />
                Upgrade Plan
              </Button>
              <Button size="sm" variant="ghost" onClick={onDismiss} data-testid="button-maybe-later">
                Maybe later
              </Button>
            </div>
          </div>
        </div>
        <div className="mt-3 h-1.5 rounded-full bg-muted/30 overflow-hidden">
          <div
            className="h-full rounded-full bg-gradient-to-r from-amber-500 to-red-500 transition-all"
            style={{ width: `${Math.max(5, Math.min(100, credits))}%` }}
          />
        </div>
        <p className="text-xs text-muted-foreground text-right mt-1">{credits} credits left</p>
      </div>
    </div>
  );
}

// ─── VAPI Voice Panel ─────────────────────────────────────────────────────────
function VapiPanel({ onClose }: { onClose: () => void }) {
  const { status, isSpeaking, transcript, startCall, stopCall, error } = useVapi();

  return (
    <div className="mx-auto max-w-2xl my-3">
      <div className="rounded-2xl border border-primary/30 bg-gradient-to-br from-primary/10 via-background to-primary/5 p-5 backdrop-blur-sm">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Radio className="w-5 h-5 text-primary" />
            <span className="font-semibold">Live Voice Session</span>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground" data-testid="button-close-vapi">
            <X className="w-4 h-4" />
          </button>
        </div>

        {error && (
          <div className="mb-3 p-3 rounded-lg bg-destructive/10 border border-destructive/30 text-sm text-destructive">
            {error}
          </div>
        )}

        <div className="flex flex-col items-center gap-4 py-4">
          {/* Animated orb */}
          <div className={`relative w-20 h-20 rounded-full flex items-center justify-center transition-all duration-300 ${
            status === "active" ? "bg-primary/20 shadow-lg shadow-primary/30" : "bg-muted/30"
          }`}>
            {isSpeaking && (
              <div className="absolute inset-0 rounded-full bg-primary/20 animate-ping" />
            )}
            <div className="absolute inset-0 rounded-full overflow-hidden flex items-center justify-center">
              {status === "active" && (
                <div className="flex items-end gap-0.5 h-8">
                  {[...Array(7)].map((_, i) => (
                    <div
                      key={i}
                      className="w-1 bg-primary rounded-full"
                      style={{
                        height: isSpeaking ? `${20 + Math.random() * 20}px` : "4px",
                        transition: "height 0.1s ease",
                        animationDelay: `${i * 50}ms`,
                      }}
                    />
                  ))}
                </div>
              )}
              {status !== "active" && <Mic className={`w-8 h-8 ${status === "connecting" ? "text-primary animate-pulse" : "text-muted-foreground"}`} />}
            </div>
          </div>

          <div className="text-center">
            <p className="font-medium">
              {status === "idle" && "Ready to talk"}
              {status === "connecting" && "Connecting..."}
              {status === "active" && (isSpeaking ? "LENORY is speaking..." : "Listening...")}
              {status === "error" && "Connection failed"}
            </p>
            {transcript && <p className="text-sm text-muted-foreground mt-1 italic">"{transcript}"</p>}
          </div>

          <div className="flex gap-3">
            {(status === "idle" || status === "error") && (
              <Button onClick={startCall} className="bg-primary" data-testid="button-start-voice-call">
                <Phone className="w-4 h-4 mr-2" />
                Start Voice Call
              </Button>
            )}
            {(status === "active" || status === "connecting") && (
              <Button onClick={stopCall} variant="destructive" data-testid="button-end-voice-call">
                <PhoneOff className="w-4 h-4 mr-2" />
                End Call
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}


// ─── Main Chat component ──────────────────────────────────────────────────────
export default function Chat() {
  const { user, isLoading: authLoading } = useAuth();
  const { toast } = useToast();
  const { speak, stop, isPlaying } = useVoice();
  const [, setLocation] = useLocation();

  // UI state
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [showPlusMenu, setShowPlusMenu] = useState(false);
  const [videoMode, setVideoMode] = useState(false);
  const [advancedMode, setAdvancedMode] = useState(false);
  const [showVapiPanel, setShowVapiPanel] = useState(false);
  const [showCreditAlert, setShowCreditAlert] = useState(false);
  const [creditAlertShown, setCreditAlertShown] = useState(false);
  const [historyTab, setHistoryTab] = useState("all");
  const [selectedChatsForDelete, setSelectedChatsForDelete] = useState<Set<string>>(new Set());
  const [searchResults, setSearchResults] = useState<any>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [playingMessageId, setPlayingMessageId] = useState<string | null>(null);
  const [copiedMsgId, setCopiedMsgId] = useState<string | null>(null);
  const [selectedModel, setSelectedModel] = useState(AI_MODELS[0]);

  // Chat state
  const searchString = useSearch();
  const urlSessionId = new URLSearchParams(searchString).get("sessionId");
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(urlSessionId);
  const [message, setMessage] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const recognitionRef = useRef<any>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // ─── Credit status ────────────────────────────────────────────────────────
  const { data: creditsData } = useQuery<{ credits: number; used: number; limit: number }>({
    queryKey: ["/api/user/credits"],
    enabled: !!user,
    refetchInterval: 30000,
  });

  useEffect(() => {
    if (creditsData && creditsData.credits <= 5 && !creditAlertShown) {
      setShowCreditAlert(true);
      setCreditAlertShown(true);
    }
  }, [creditsData]);

  // ─── Auto-resize textarea ─────────────────────────────────────────────────
  const autoResize = () => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 220) + "px";
  };

  // ─── Activate video mode ──────────────────────────────────────────────────
  const activateVideoMode = () => {
    setVideoMode(true);
    setShowPlusMenu(false);
    setMessage("Generate a short video about: ");
    setTimeout(() => { textareaRef.current?.focus(); autoResize(); }, 50);
  };

  // ─── File analyze ─────────────────────────────────────────────────────────
  const handleFileAnalyze = async (file: File) => {
    setShowPlusMenu(false);
    if (!file) return;
    if (file.size > 20 * 1024 * 1024) {
      toast({ title: "File too large", description: "Max file size is 20MB", variant: "destructive" });
      return;
    }
    const reader = new FileReader();
    reader.onload = async () => {
      const base64 = (reader.result as string).split(",")[1];
      const mimeType = file.type || "application/octet-stream";
      const fileName = file.name;
      const userMsg = file.type.startsWith("image/") ? `[Image: ${fileName}]` : `[File: ${fileName}]`;
      toast({ title: "Analyzing file...", description: `Sending ${fileName} to LENORY AI` });
      try {
        const res = await apiRequest("POST", "/api/chat/analyze-vision", { base64, mimeType, fileName, prompt: "Analyze this file/image and provide a detailed explanation, extract any text, describe content, and answer any questions.", sessionId: currentSessionId });
        const data = await res.json();
        if (data.analysis) {
          setMessage("");
          await handleSendMessageWithContent(`Analyze this file: ${fileName}`, `I analyzed **${fileName}**:\n\n${data.analysis}`);
        }
      } catch {
        toast({ title: "Analysis failed", description: "Could not analyze file. Try again.", variant: "destructive" });
      }
    };
    reader.readAsDataURL(file);
  };

  const handleSendMessageWithContent = async (userContent: string, assistantContent: string) => {
    if (!user) return;
    let sessionId = currentSessionId;
    if (!sessionId) {
      try {
        const res = await apiRequest("POST", "/api/chat/sessions", { title: userContent.slice(0, 40), mode: "standard" });
        const newSession = await res.json();
        sessionId = newSession.id;
        switchToSession(sessionId);
        queryClient.invalidateQueries({ queryKey: ["/api/chat/sessions"] });
      } catch { return; }
    }
    await apiRequest("POST", "/api/chat/messages", { sessionId, role: "user", content: userContent });
    await apiRequest("POST", "/api/chat/messages", { sessionId, role: "assistant", content: assistantContent });
    queryClient.invalidateQueries({ queryKey: ["/api/chat/messages", sessionId] });
    setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
  };

  // ─── Sessions ─────────────────────────────────────────────────────────────
  const { data: sessions = [] } = useQuery<ChatSession[]>({
    queryKey: ["/api/chat/sessions"],
    enabled: !!user,
  });

  const { data: messages = [], refetch: refetchMessages } = useQuery<ChatMessageWithAttachments[]>({
    queryKey: ["/api/chat/messages", currentSessionId],
    enabled: !!user && !!currentSessionId,
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/chat/messages?sessionId=${currentSessionId}`);
      const data = await res.json();
      return data.sort((a: any, b: any) => new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime());
    },
  });

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  useEffect(() => {
    if (!isPlaying) setPlayingMessageId(null);
  }, [isPlaying]);

  useEffect(() => {
    if (user) {
      if (urlSessionId && sessions.some(s => s.id === urlSessionId)) {
        setCurrentSessionId(urlSessionId);
      } else if (!currentSessionId && sessions.length > 0) {
        setCurrentSessionId(sessions[0].id);
      }
    }
  }, [user, sessions, urlSessionId]);

  // Auto-fill from URL
  const searchParams = new URLSearchParams(searchString);
  const voiceParam = searchParams.get("voice");
  useEffect(() => {
    if (voiceParam) setMessage(decodeURIComponent(voiceParam));
  }, [voiceParam]);

  // ─── Session management ───────────────────────────────────────────────────
  const switchToSession = (id: string | null) => {
    setCurrentSessionId(id);
    setLocation(id ? `/chat?sessionId=${id}` : "/chat", { replace: true } as any);
  };

  const createNewChat = async () => {
    try {
      const res = await apiRequest("POST", "/api/chat/sessions", { title: "New Chat", mode: "chat" });
      const session = await res.json();
      switchToSession(session.id);
      setMessage("");
      queryClient.invalidateQueries({ queryKey: ["/api/chat/sessions"] });
    } catch {
      toast({ title: "Error", description: "Failed to create chat", variant: "destructive" });
    }
  };

  const deleteChat = async (sessionId: string) => {
    try {
      await apiRequest("DELETE", `/api/chat/sessions/${sessionId}`, {});
      queryClient.invalidateQueries({ queryKey: ["/api/chat/sessions"] });
      if (currentSessionId === sessionId) switchToSession(null);
      toast({ title: "Chat deleted" });
    } catch {
      toast({ title: "Error", description: "Failed to delete chat", variant: "destructive" });
    }
  };

  const [renamingSessionId, setRenamingSessionId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const startRename = (session: ChatSession) => {
    setRenamingSessionId(session.id);
    setRenameValue(session.title);
  };

  const submitRename = async (sessionId: string) => {
    const newTitle = renameValue.trim();
    setRenamingSessionId(null);
    if (!newTitle) return;
    try {
      await apiRequest("PATCH", `/api/chat/sessions/${sessionId}`, { title: newTitle });
      queryClient.invalidateQueries({ queryKey: ["/api/chat/sessions"] });
    } catch {
      toast({ title: "Error", description: "Failed to rename chat", variant: "destructive" });
    }
  };

  const togglePinChat = async (session: ChatSession) => {
    try {
      await apiRequest("PATCH", `/api/chat/sessions/${session.id}`, { isBookmarked: !(session as any).isBookmarked });
      queryClient.invalidateQueries({ queryKey: ["/api/chat/sessions"] });
    } catch {
      toast({ title: "Error", description: "Failed to pin chat", variant: "destructive" });
    }
  };

  const bulkDeleteChats = async () => {
    if (selectedChatsForDelete.size === 0) return;
    try {
      await apiRequest("POST", "/api/chat/sessions/bulk-delete", { sessionIds: Array.from(selectedChatsForDelete) });
      queryClient.invalidateQueries({ queryKey: ["/api/chat/sessions"] });
      if (selectedChatsForDelete.has(currentSessionId || "")) switchToSession(null);
      setSelectedChatsForDelete(new Set());
      toast({ title: `Deleted ${selectedChatsForDelete.size} chats` });
    } catch {
      toast({ title: "Error", description: "Failed to delete chats", variant: "destructive" });
    }
  };

  const toggleSelectAll = () => {
    setSelectedChatsForDelete(
      selectedChatsForDelete.size === sessions.length ? new Set() : new Set(sessions.map(s => s.id))
    );
  };

  const toggleChatSelection = (id: string) => {
    const next = new Set(selectedChatsForDelete);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelectedChatsForDelete(next);
  };

  // ─── Internet search ──────────────────────────────────────────────────────
  const detectSearchQuery = (text: string): string | null => {
    const keywords = ["search for", "find", "look up", "latest", "current", "today", "news about", "recent", "internet search", "google", "web search"];
    const lower = text.toLowerCase();
    for (const kw of keywords) {
      if (lower.includes(kw)) return text.replace(new RegExp(kw, "gi"), "").trim();
    }
    return null;
  };

  const performSearch = async (query: string) => {
    try {
      setIsSearching(true);
      setSearchResults(null);
      const res = await apiRequest("POST", "/api/chat/search", { query });
      const data = await res.json();
      setSearchResults(data);
    } catch {
      toast({ title: "Search failed", description: "Could not search the internet", variant: "destructive" });
    } finally {
      setIsSearching(false);
    }
  };

  // ─── Voice input ──────────────────────────────────────────────────────────
  const handleMicToggle = () => {
    if (isListening) { recognitionRef.current?.stop(); setIsListening(false); return; }
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) { toast({ title: "Not supported", description: "Voice input not supported in this browser", variant: "destructive" }); return; }
    const recognition = new SR();
    recognition.lang = "en-NG";
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.onresult = (e: any) => { setMessage(prev => prev ? prev + " " + e.results[0][0].transcript : e.results[0][0].transcript); setIsListening(false); };
    recognition.onerror = () => setIsListening(false);
    recognition.onend = () => setIsListening(false);
    recognitionRef.current = recognition;
    recognition.start();
    setIsListening(true);
  };

  // ─── Send message ─────────────────────────────────────────────────────────
  const resetInput = () => {
    setMessage("");
    if (textareaRef.current) textareaRef.current.style.height = "44px";
  };

  const handleSendMessage = async () => {
    if (!message.trim() || isLoading) return;

    // Feature navigation
    const featureRoute = detectFeatureOpen(message);
    if (featureRoute) { window.location.href = featureRoute; return; }

    // Video mode
    if (videoMode) {
      const prompt = message.trim();
      const userName = (user as any)?.firstName || "there";
      setIsLoading(true);
      resetInput();
      try {
        const res = await apiRequest("POST", "/api/video/generate", { prompt });
        const data = await res.json();
        if (data.error) { toast({ title: "Video generation failed", description: data.error, variant: "destructive" }); return; }
        let output = data.output;
        let pollId = data.id;
        let attempts = 0;
        while (!output && pollId && attempts < 60) {
          await new Promise(r => setTimeout(r, 3000));
          const pollRes = await apiRequest("GET", `/api/video/status/${pollId}`);
          const pollData = await pollRes.json();
          if (pollData.output) { output = pollData.output; break; }
          if (pollData.status === "failed") { toast({ title: "Video failed", variant: "destructive" }); return; }
          attempts++;
        }
        const videoUrl = Array.isArray(output) ? output[0] : output;
        let sessionId = currentSessionId;
        if (!sessionId) {
          const sRes = await apiRequest("POST", "/api/chat/sessions", { title: prompt.slice(0, 60), mode: "chat" });
          const sData = await sRes.json();
          sessionId = sData.id;
          switchToSession(sData.id);
          queryClient.invalidateQueries({ queryKey: ["/api/chat/sessions"] });
        }
        await apiRequest("POST", "/api/chat/send", {
          content: prompt, sessionId, autoLearn: false, skipAi: false,
          overrideResponse: videoUrl
            ? `Here's your generated video:\n\n**Prompt:** ${prompt}\n\n[Watch Video](${videoUrl})\n\n\`\`\`\n${videoUrl}\n\`\`\`\n\n*Right-click → Save video. Link expires after 24 hours.*`
            : `Sorry, the video could not be generated right now. Please try again.`,
        });
        await refetchMessages();
        setVideoMode(false);
      } catch {
        toast({ title: "Video error", description: "Failed to generate video.", variant: "destructive" });
      } finally {
        setIsLoading(false);
      }
      return;
    }

    // Internet search detection
    if (selectedModel.id === "lenory-search") {
      await performSearch(message.trim());
      resetInput();
      return;
    }
    const searchQuery = detectSearchQuery(message);
    if (searchQuery) { await performSearch(searchQuery); resetInput(); return; }

    // Normal AI chat
    let sessionId = currentSessionId;
    if (!sessionId) {
      try {
        const res = await apiRequest("POST", "/api/chat/sessions", { title: message.trim().slice(0, 60), mode: "chat" });
        const session = await res.json();
        sessionId = session.id;
        switchToSession(session.id);
        queryClient.invalidateQueries({ queryKey: ["/api/chat/sessions"] });
      } catch {
        toast({ title: "Error", description: "Failed to create chat session", variant: "destructive" });
        return;
      }
    }

    try {
      setIsLoading(true);
      const res = await apiRequest("POST", "/api/chat/send", {
        content: message.trim(),
        sessionId,
        autoLearn: true,
        model: selectedModel.id,
        isAdvanced: advancedMode,
      });

      if (res.status === 402) {
        const errData = await res.json();
        setShowCreditAlert(true);
        toast({ title: "Out of credits", description: errData.message || "You need more credits. Upgrade your plan.", variant: "destructive" });
        setIsLoading(false);
        return;
      }
      resetInput();
      await res.json();
      await refetchMessages();
      queryClient.invalidateQueries({ queryKey: ["/api/chat/sessions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/user/credits"] });
    } catch {
      toast({ title: "Error", description: "Failed to send message", variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSendMessage(); }
  };

  const copyMessage = async (content: string, msgId: string) => {
    await navigator.clipboard.writeText(content);
    setCopiedMsgId(msgId);
    setTimeout(() => setCopiedMsgId(null), 2000);
  };

  // ─── Auth guard ───────────────────────────────────────────────────────────
  if (authLoading || !user) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center animate-pulse">
            <Brain className="w-7 h-7 text-primary" />
          </div>
          <Loader2 className="w-6 h-6 animate-spin text-primary" />
        </div>
      </div>
    );
  }

  const userName = (user as any)?.firstName || (user as any)?.email?.split("@")[0] || "there";
  const isAdmin = (user as any)?.email === "felixahuruonye@gmail.com";
  const credits = creditsData?.credits ?? 20;
  const userPlan: "free" | "pro" | "premium" = isAdmin ? "premium" : ((user as any)?.subscriptionTier || "free");

  const getModelLock = (modelId: string): string | null => {
    if (isAdmin || userPlan === "premium") return null;
    if (userPlan === "pro" && modelId === "lenory-ultra") return "Requires Premium";
    if (userPlan === "free" && (modelId === "lenory-ultra" || modelId === "lenory-fast")) {
      return modelId === "lenory-ultra" ? "Requires Premium" : "Requires Pro";
    }
    return null;
  };

  const quickSuggestions = [
    { icon: Code, label: "Code", prompt: "Help me write code for " },
    { icon: BookOpen, label: "Learn", prompt: "Teach me about " },
    { icon: Globe, label: "Research", prompt: "Research and explain " },
    { icon: Lightbulb, label: "Ideas", prompt: "Give me creative ideas for " },
  ];

  // ─── JSX ──────────────────────────────────────────────────────────────────
  return (
    <div className="h-screen bg-background flex overflow-hidden">
      {/* ── Sidebar ── */}
      <div className={`${sidebarOpen ? "w-64" : "w-0"} flex-shrink-0 transition-all duration-300 border-r border-border flex flex-col overflow-hidden bg-background/80 backdrop-blur-xl`}>
        <div className="p-3 border-b border-border flex-shrink-0">
          <Button onClick={createNewChat} className="w-full" size="sm" data-testid="button-new-chat">
            <Plus className="w-4 h-4 mr-2" />
            New Chat
          </Button>
        </div>

        <div className="flex gap-1 p-2 border-b border-border flex-shrink-0">
          {["all", "manage"].map(tab => (
            <button key={tab} onClick={() => setHistoryTab(tab)}
              className={`flex-1 text-xs font-medium py-1.5 rounded transition-colors capitalize ${historyTab === tab ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground"}`}
              data-testid={`tab-history-${tab}`}
            >
              {tab}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {historyTab === "all" ? (
            sessions.length === 0
              ? <p className="text-xs text-muted-foreground text-center py-6">No chats yet</p>
              : sessions.map(session => (
                  <div key={session.id} className={`flex items-center gap-1.5 p-2 rounded-lg cursor-pointer transition-colors group ${currentSessionId === session.id ? "bg-primary/15 text-primary" : "hover:bg-muted/60"}`}>
                    {renamingSessionId === session.id ? (
                      <input
                        autoFocus
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onBlur={() => submitRename(session.id)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") submitRename(session.id);
                          if (e.key === "Escape") setRenamingSessionId(null);
                        }}
                        className="flex-1 min-w-0 text-xs font-medium bg-transparent border border-primary/40 rounded px-1 py-0.5 outline-none"
                        data-testid={`input-rename-${session.id}`}
                      />
                    ) : (
                      <div className="flex-1 min-w-0 flex items-center gap-1" onClick={() => switchToSession(session.id)}>
                        {(session as any).isBookmarked && <Pin className="w-3 h-3 shrink-0 text-primary fill-primary" />}
                        <p className="text-xs truncate font-medium" data-testid={`button-session-${session.id}`}>{session.title}</p>
                      </div>
                    )}
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          onClick={(e) => e.stopPropagation()}
                          className="opacity-0 group-hover:opacity-100 p-1 hover:bg-muted rounded transition-all flex-shrink-0"
                          data-testid={`button-menu-${session.id}`}
                        >
                          <MoreVertical className="w-3.5 h-3.5" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => startRename(session)}>
                          <Pencil className="w-3.5 h-3.5 mr-2" /> Rename
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => togglePinChat(session)}>
                          {(session as any).isBookmarked
                            ? <><PinOff className="w-3.5 h-3.5 mr-2" /> Unpin</>
                            : <><Pin className="w-3.5 h-3.5 mr-2" /> Pin to top</>}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => { if (window.confirm("Delete " + session.title + "?")) deleteChat(session.id); }}
                          className="text-destructive focus:text-destructive"
                        >
                          <Trash2 className="w-3.5 h-3.5 mr-2" /> Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                ))
          ) : (
            <>
              {sessions.length > 0 && (
                <button onClick={toggleSelectAll} className="w-full flex items-center gap-2 p-2 rounded hover:bg-muted text-xs font-semibold mb-1" data-testid="button-select-all-chats">
                  {selectedChatsForDelete.size === sessions.length ? <CheckSquare className="w-4 h-4 text-primary" /> : <Square className="w-4 h-4 text-muted-foreground" />}
                  {selectedChatsForDelete.size > 0 ? `${selectedChatsForDelete.size} selected` : "Select All"}
                </button>
              )}
              {sessions.map(session => (
                <div key={session.id} className="flex items-center gap-2 p-2 rounded hover:bg-muted cursor-pointer" onClick={() => toggleChatSelection(session.id)}>
                  {selectedChatsForDelete.has(session.id) ? <CheckSquare className="w-4 h-4 text-primary flex-shrink-0" /> : <Square className="w-4 h-4 text-muted-foreground flex-shrink-0" />}
                  <span className="text-xs truncate">{session.title}</span>
                </div>
              ))}
              {selectedChatsForDelete.size > 0 && (
                <button onClick={bulkDeleteChats} className="w-full mt-2 flex items-center justify-center gap-2 p-2 rounded bg-destructive/15 text-destructive hover:bg-destructive/25 text-xs font-semibold" data-testid="button-bulk-delete-chats">
                  <Trash2 className="w-3.5 h-3.5" />
                  Delete {selectedChatsForDelete.size}
                </button>
              )}
            </>
          )}
        </div>

        {/* Credits in sidebar */}
        {creditsData && (
          <div className="p-3 border-t border-border flex-shrink-0">
            <div className="rounded-lg bg-muted/40 p-2.5">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs text-muted-foreground">AI Credits</span>
                <span className={`text-xs font-bold ${credits <= 5 ? "text-amber-400" : "text-primary"}`}>{credits}</span>
              </div>
              <div className="h-1 rounded-full bg-muted overflow-hidden">
                <div className={`h-full rounded-full transition-all ${credits <= 5 ? "bg-amber-500" : "bg-primary"}`} style={{ width: `${Math.min(100, credits)}%` }} />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── Main area ── */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Header */}
        <header className="h-14 flex items-center justify-between px-3 border-b border-border bg-background/80 backdrop-blur-sm flex-shrink-0">
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon" onClick={() => setSidebarOpen(!sidebarOpen)} data-testid="button-toggle-sidebar">
              {sidebarOpen ? <ChevronLeft className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </Button>
            <div className="flex items-center gap-1.5">
              <Brain className="w-6 h-6 text-primary" />
              <span className="font-bold text-sm">LENORY</span>
              {isAdmin && <span className="text-[9px] font-bold bg-primary/20 text-primary px-1.5 py-0.5 rounded uppercase">Admin</span>}
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <Link href="/live-session">
              <Button variant="ghost" size="icon" title="Write My Note" data-testid="link-write-note">
                <Mic className="w-4 h-4" />
              </Button>
            </Link>
            <Link href="/dashboard">
              <Button variant="ghost" size="icon" data-testid="link-dashboard"><Gauge className="w-4 h-4" /></Button>
            </Link>
            <Link href="/settings">
              <Button variant="ghost" size="icon" data-testid="link-settings"><Settings className="w-4 h-4" /></Button>
            </Link>
            <ThemeToggle />
          </div>
        </header>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-3xl mx-auto px-4 py-6 min-h-full flex flex-col">

            {/* Empty state — Claude-like */}
            {messages.length === 0 && !searchResults && !isLoading && (
              <div className="flex-1 flex flex-col items-center justify-center text-center gap-6 py-12">
                <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
                  <Brain className="w-9 h-9 text-primary" />
                </div>
                <div>
                  <h1 className="text-3xl font-bold mb-2">
                    Hello, {userName}
                  </h1>
                  <p className="text-muted-foreground text-base">
                    I'm LENORY — your advanced AI. What can I help you with?
                  </p>
                </div>

                {/* Quick suggestion pills */}
                <div className="flex flex-wrap items-center justify-center gap-2 max-w-sm">
                  {quickSuggestions.map(s => (
                    <button
                      key={s.label}
                      onClick={() => { setMessage(s.prompt); setTimeout(() => textareaRef.current?.focus(), 50); }}
                      className="flex items-center gap-2 px-4 py-2 rounded-full border border-border bg-card hover-elevate text-sm font-medium transition-all"
                      data-testid={`suggestion-${s.label.toLowerCase()}`}
                    >
                      <s.icon className="w-4 h-4 text-muted-foreground" />
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Search results */}
            {searchResults && (
              <div className="mb-6 rounded-xl border border-blue-500/30 bg-blue-950/20 p-5">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <Search className="w-4 h-4 text-blue-400" />
                    <h3 className="font-semibold text-sm">Search Results</h3>
                    <span className="text-xs text-blue-400">{searchResults.results?.length || 0} results</span>
                  </div>
                  <button onClick={() => setSearchResults(null)} className="text-muted-foreground hover:text-foreground" data-testid="button-close-search">
                    <X className="w-4 h-4" />
                  </button>
                </div>
                {searchResults.summary && (
                  <p className="text-sm mb-4 p-3 bg-muted/30 rounded-lg"><strong>Summary:</strong> {searchResults.summary}</p>
                )}
                <div className="space-y-2">
                  {(searchResults.results || []).map((r: any, i: number) => (
                    <a key={i} href={r.link} target="_blank" rel="noopener noreferrer"
                      className="flex items-start gap-3 p-3 rounded-lg bg-muted/20 hover:bg-muted/40 transition-colors group"
                      data-testid={`search-result-${i}`}
                    >
                      <ExternalLink className="w-4 h-4 text-blue-400 flex-shrink-0 mt-0.5" />
                      <div className="min-w-0">
                        <p className="font-medium text-sm truncate group-hover:text-blue-400 transition-colors">{r.title}</p>
                        <p className="text-xs text-blue-400 mb-0.5">{r.source}</p>
                        <p className="text-xs text-muted-foreground line-clamp-2">{r.snippet}</p>
                      </div>
                    </a>
                  ))}
                </div>
              </div>
            )}

            {/* Credit alert in chat */}
            {showCreditAlert && (
              <CreditAlert
                credits={credits}
                onUpgrade={() => { setShowCreditAlert(false); setLocation("/pricing"); }}
                onDismiss={() => setShowCreditAlert(false)}
              />
            )}

            {/* VAPI panel in chat */}
            {showVapiPanel && <VapiPanel onClose={() => setShowVapiPanel(false)} />}

            {/* Messages */}
            {messages.length > 0 && (
              <div className="flex-1 space-y-6">
                {messages.map(msg => (
                  <div key={msg.id} className={`flex gap-3 ${msg.role === "user" ? "justify-end" : "justify-start"}`} data-testid={`message-${msg.role}-${msg.id}`}>
                    {msg.role === "assistant" && (
                      <div className="flex-shrink-0 mt-1">
                        <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center">
                          <Brain className="w-4 h-4 text-primary" />
                        </div>
                      </div>
                    )}
                    <div className={`group relative ${msg.role === "user" ? "max-w-xl" : "flex-1"}`} data-testid={`card-message-${msg.id}`}>
                      {msg.role === "user" ? (
                        <div className="rounded-2xl rounded-tr-sm bg-primary text-primary-foreground px-4 py-3 text-sm">
                          {msg.attachments?.images?.map((img: any, idx: number) => (
                            <div key={idx} className="mb-3 rounded-lg overflow-hidden">
                              <img src={img.url} alt={img.title || "Image"} className="w-full h-auto max-h-48 object-cover rounded-lg" loading="lazy" />
                            </div>
                          ))}
                          <div className="whitespace-pre-wrap break-words">{msg.content}</div>
                        </div>
                      ) : (
                        <div className="text-sm">
                          {msg.attachments?.images?.map((img: any, idx: number) => (
                            <div key={idx} className="mb-3 rounded-lg overflow-hidden">
                              <img src={img.url} alt={img.title || "Image"} className="w-full h-auto max-h-64 object-cover rounded-lg" loading="lazy" />
                            </div>
                          ))}
                          <LenoryMarkdown content={msg.content} />
                          {/* Message actions */}
                          <div className="flex items-center gap-2 mt-2 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button
                              onClick={() => copyMessage(msg.content, msg.id)}
                              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded-md hover:bg-muted transition-colors"
                              data-testid={`button-copy-msg-${msg.id}`}
                            >
                              {copiedMsgId === msg.id ? <Check className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3" />}
                              <span>{copiedMsgId === msg.id ? "Copied" : "Copy"}</span>
                            </button>
                            <button
                              onClick={() => {
                                if (playingMessageId === msg.id) { stop(); setPlayingMessageId(null); }
                                else { if (playingMessageId) stop(); setPlayingMessageId(msg.id); speak(msg.content); }
                              }}
                              className={`flex items-center gap-1 text-xs px-2 py-1 rounded-md transition-colors ${
                                playingMessageId === msg.id ? "text-primary bg-primary/10" : "text-muted-foreground hover:text-foreground hover:bg-muted"
                              }`}
                              data-testid={`button-speak-${msg.id}`}
                            >
                              {playingMessageId === msg.id ? <VolumeX className="w-3 h-3" /> : <Volume2 className="w-3 h-3" />}
                              <span>{playingMessageId === msg.id ? "Stop" : "Read"}</span>
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                    {msg.role === "user" && (
                      <div className="flex-shrink-0 mt-1">
                        <div className="w-7 h-7 rounded-full bg-primary flex items-center justify-center">
                          <UserIcon className="w-4 h-4 text-primary-foreground" />
                        </div>
                      </div>
                    )}
                  </div>
                ))}

                {/* Writing / typing indicator */}
                {isLoading && <TypingIndicator />}

                <div ref={messagesEndRef} />
              </div>
            )}

            {/* Loading when no messages yet */}
            {messages.length === 0 && isLoading && (
              <div className="flex-1 flex flex-col gap-6">
                <TypingIndicator />
                <div ref={messagesEndRef} />
              </div>
            )}
          </div>
        </div>

        {/* ── Input Area ── */}
        <div className="flex-shrink-0 px-4 pb-4 pt-2 bg-background/90 backdrop-blur-sm">
          <div className="max-w-3xl mx-auto">

            {/* Plus menu popup */}
            {showPlusMenu && (
              <div className="mb-3 p-4 bg-card rounded-2xl border border-border shadow-xl">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-sm font-semibold">Attach or Create</span>
                  <button onClick={() => setShowPlusMenu(false)} className="text-muted-foreground hover:text-foreground"><X className="w-4 h-4" /></button>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  {[
                    { icon: Camera, label: "Camera", color: "text-blue-400 bg-blue-500/10", action: () => cameraInputRef.current?.click() },
                    { icon: Image, label: "Photos", color: "text-green-400 bg-green-500/10", action: () => { if (fileInputRef.current) { fileInputRef.current.accept = "image/*"; fileInputRef.current.click(); } } },
                    { icon: FileText, label: "Files", color: "text-orange-400 bg-orange-500/10", action: () => { if (fileInputRef.current) { fileInputRef.current.accept = "*/*"; fileInputRef.current.click(); } } },
                    { icon: Film, label: "Video", color: "text-purple-400 bg-purple-500/10", action: activateVideoMode },
                    { icon: BookOpen, label: "My Notes", color: "text-purple-300 bg-purple-400/10", action: () => { setShowPlusMenu(false); setLocation("/notes"); } },
                    { icon: Sparkles, label: "Image Gen", color: "text-pink-400 bg-pink-500/10", action: () => { setShowPlusMenu(false); window.location.href = "/image-gen"; } },
                    { icon: BookOpen, label: "Courses", color: "text-amber-400 bg-amber-500/10", action: () => { setShowPlusMenu(false); window.location.href = "/courses"; } },
                  ].map(item => (
                    <button key={item.label} onClick={item.action}
                      className="flex flex-col items-center gap-1.5 p-2.5 rounded-xl hover-elevate transition-all"
                      data-testid={`plus-menu-${item.label.toLowerCase().replace(/\s+/g, "-")}`}
                    >
                      <div className={`p-2.5 rounded-xl ${item.color}`}><item.icon className="w-5 h-5" /></div>
                      <span className="text-xs text-muted-foreground font-medium leading-tight text-center">{item.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Advanced mode indicator */}
            {advancedMode && (
              <div className="flex items-center gap-2 px-3 py-2 mb-2 bg-cyan-500/10 border border-cyan-500/30 rounded-xl">
                <Code className="w-4 h-4 text-cyan-400 flex-shrink-0" />
                <span className="text-xs text-cyan-300 flex-1">Advanced mode — deep technical & coding responses with DeepSeek</span>
                <button onClick={() => setAdvancedMode(false)} className="text-cyan-400 hover:text-cyan-200" data-testid="button-close-advanced-mode"><X className="w-3.5 h-3.5" /></button>
              </div>
            )}

            {/* Video mode indicator */}
            {videoMode && (
              <div className="flex items-center gap-2 px-3 py-2 mb-2 bg-purple-500/10 border border-purple-500/30 rounded-xl">
                <Film className="w-4 h-4 text-purple-400 flex-shrink-0" />
                <span className="text-xs text-purple-300 flex-1">Video generation mode — describe what you want to see</span>
                <button onClick={() => { setVideoMode(false); setMessage(""); }} className="text-purple-400 hover:text-purple-200"><X className="w-3.5 h-3.5" /></button>
              </div>
            )}

            {/* Main input card — Claude style */}
            <div className={`rounded-2xl border transition-all ${
              isListening ? "border-red-500/60 bg-red-500/5 shadow-red-500/10 shadow-lg" :
              videoMode ? "border-purple-500/40 bg-purple-500/5" :
              "border-border bg-card shadow-sm hover:shadow-md"
            }`}>

              {/* Textarea */}
              <div className="px-4 pt-4 pb-2">
                <textarea
                  ref={textareaRef}
                  value={message}
                  onChange={e => { setMessage(e.target.value); autoResize(); }}
                  onKeyDown={handleKeyDown}
                  placeholder={
                    isListening ? "Listening..." :
                    videoMode ? "Describe your video..." :
                    "How can I help you today?"
                  }
                  className="w-full resize-none bg-transparent text-foreground placeholder:text-muted-foreground/60 text-sm leading-relaxed outline-none border-none min-h-[44px] max-h-[220px] overflow-y-auto"
                  rows={1}
                  style={{ height: "44px" }}
                  disabled={isLoading}
                  data-testid="input-message"
                />
              </div>

              {/* Bottom toolbar */}
              <div className="flex items-center justify-between px-3 pb-3 pt-1">
                <div className="flex items-center gap-1">
                  {/* Plus button */}
                  <button
                    onClick={() => setShowPlusMenu(!showPlusMenu)}
                    className={`p-2 rounded-xl transition-all ${showPlusMenu ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground hover:bg-muted"}`}
                    title="Attach or create"
                    data-testid="button-plus-menu"
                  >
                    <Plus className="w-5 h-5" />
                  </button>

                  {/* Model selector */}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-all" data-testid="button-model-selector">
                        <span>{selectedModel.label}</span>
                        <ChevronDown className="w-3.5 h-3.5" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="w-60">
                      {AI_MODELS.map(model => {
                        const lockMsg = getModelLock(model.id);
                        return (
                          <DropdownMenuItem
                            key={model.id}
                            onClick={() => {
                              if (lockMsg) {
                                toast({ title: `${model.label} locked`, description: `${lockMsg} to use this model.`, variant: "destructive" });
                              } else {
                                setSelectedModel(model);
                              }
                            }}
                            className={`flex items-start gap-2 cursor-pointer ${selectedModel.id === model.id ? "bg-primary/10" : ""} ${lockMsg ? "opacity-60" : ""}`}
                            data-testid={`model-option-${model.id}`}
                          >
                            <div className="flex-1 min-w-0">
                              <span className="font-medium text-sm block">{model.label}</span>
                              <span className="text-xs text-muted-foreground block">{model.description}</span>
                            </div>
                            {lockMsg && <Lock className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0 mt-0.5" />}
                          </DropdownMenuItem>
                        );
                      })}
                      <DropdownMenuSeparator />
                      <DropdownMenuItem className="text-xs text-muted-foreground cursor-default">
                        {userPlan === "free" ? "Upgrade to Pro/Premium to unlock all models" : "Model controls AI capabilities"}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>

                <div className="flex items-center gap-1">
                  {/* Live AI / VAPI wave button */}
                  <button
                    onClick={() => { setShowVapiPanel(!showVapiPanel); setShowPlusMenu(false); }}
                    className={`p-2 rounded-xl transition-all ${showVapiPanel ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground hover:bg-muted"}`}
                    title="Live Voice AI"
                    data-testid="button-live-ai"
                  >
                    {/* Wave icon */}
                    <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2}>
                      <path d="M2 12s2-4 4-4 4 8 4 8 2-8 4-8 4 4 4 4" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>

                  {/* Mic */}
                  <button
                    onClick={handleMicToggle}
                    className={`p-2 rounded-xl transition-all ${isListening ? "bg-red-500 text-white animate-pulse" : "text-muted-foreground hover:text-foreground hover:bg-muted"}`}
                    title={isListening ? "Stop listening" : "Voice input"}
                    data-testid="button-mic"
                  >
                    {isListening ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
                  </button>

                  {/* Send */}
                  <button
                    onClick={handleSendMessage}
                    disabled={!message.trim() || isLoading || isSearching}
                    className={`p-2 rounded-xl transition-all ${
                      !message.trim() || isLoading || isSearching
                        ? "text-muted-foreground/30 cursor-not-allowed"
                        : videoMode
                          ? "bg-purple-600 text-white"
                          : "bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm"
                    }`}
                    data-testid="button-send"
                  >
                    {isLoading || isSearching ? (
                      <Loader2 className="w-5 h-5 animate-spin" />
                    ) : videoMode ? (
                      <Film className="w-5 h-5" />
                    ) : (
                      <Send className="w-5 h-5" />
                    )}
                  </button>
                </div>
              </div>
            </div>

            <p className="text-xs text-muted-foreground text-center mt-2">
              LENORY AI · Advanced intelligence for everyone · Always verify critical information
            </p>
          </div>
        </div>
      </div>

      {/* Hidden file inputs */}
      <input ref={fileInputRef} type="file" accept="image/*" className="hidden" data-testid="input-file-upload"
        onChange={e => { const f = e.target.files?.[0]; if (f) handleFileAnalyze(f); e.target.value = ""; }} />
      <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" className="hidden" data-testid="input-camera-upload"
        onChange={e => { const f = e.target.files?.[0]; if (f) handleFileAnalyze(f); e.target.value = ""; }} />
    </div>
  );
}
