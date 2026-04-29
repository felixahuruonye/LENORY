import { useState, useRef, useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ThemeToggle } from "@/components/ThemeToggle";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Send,
  MessageSquare,
  Plus,
  Trash2,
  Menu,
  ChevronLeft,
  ArrowLeft,
  Loader2,
  Bot,
  User as UserIcon,
  Volume2,
  VolumeX,
  Settings,
  Bell,
  Zap,
  CheckSquare,
  Square,
  Search,
  ExternalLink,
  Sparkles,
  BookOpen,
  Brain,
  Gauge,
  Image,
  Code,
  Lightbulb,
} from "lucide-react";
import { Link, useLocation, useSearch, useRoute } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useVoice } from "@/lib/useVoice";
import { detectFeatureOpen } from "@/lib/featureRegistry";
import type { ChatMessage, ChatSession, ChatMessageWithAttachments } from "@shared/schema";

export default function Chat() {
  const { user, isLoading: authLoading } = useAuth();
  const { toast } = useToast();
  const { toggleSpeak, isPlaying } = useVoice();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  
  // Get sessionId from URL query params
  const searchString = useSearch();
  const urlSessionId = new URLSearchParams(searchString).get("sessionId");
  
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(urlSessionId);
  const [message, setMessage] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [playingMessageId, setPlayingMessageId] = useState<string | null>(null);
  const [historyTab, setHistoryTab] = useState("all"); // "all" or "manage"
  const [selectedChatsForDelete, setSelectedChatsForDelete] = useState<Set<string>>(new Set());
  const [searchResults, setSearchResults] = useState<any>(null);
  const [isSearching, setIsSearching] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Load chat sessions
  const { data: sessions = [] } = useQuery<ChatSession[]>({
    queryKey: ["/api/chat/sessions"],
    enabled: !!user,
  });

  // Load messages for current session
  const { data: messages = [], refetch: refetchMessages } = useQuery<ChatMessageWithAttachments[]>({
    queryKey: ["/api/chat/messages", currentSessionId],
    enabled: !!user && !!currentSessionId,
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/chat/messages?sessionId=${currentSessionId}`);
      const data = await res.json();
      return data.sort((a: ChatMessageWithAttachments, b: ChatMessageWithAttachments) => {
        const timeA = new Date(a.createdAt || 0).getTime();
        const timeB = new Date(b.createdAt || 0).getTime();
        return timeA - timeB;
      });
    },
  });

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Auto-fill voice message from URL param
  const searchParams = new URLSearchParams(searchString);
  const voiceParam = searchParams.get("voice");
  useEffect(() => {
    if (voiceParam) {
      setMessage(decodeURIComponent(voiceParam));
    }
  }, [voiceParam]);

  // Set session from URL — no empty session creation on load
  useEffect(() => {
    if (user) {
      if (urlSessionId && sessions.some(s => s.id === urlSessionId)) {
        setCurrentSessionId(urlSessionId);
      } else if (!currentSessionId && sessions.length > 0) {
        setCurrentSessionId(sessions[0].id);
      }
      // Do NOT auto-create a session — wait for first message
    }
  }, [user, sessions, urlSessionId]);

  // Create new chat
  const createNewChat = async () => {
    try {
      const res = await apiRequest("POST", "/api/chat/sessions", {
        title: "New Chat",
        mode: "chat",
      });
      const session = await res.json();
      setCurrentSessionId(session.id);
      setMessage("");
      queryClient.invalidateQueries({ queryKey: ["/api/chat/sessions"] });
      toast({ title: "New chat created" });
    } catch (error) {
      toast({ title: "Error", description: "Failed to create chat", variant: "destructive" });
    }
  };

  // Delete single chat
  const deleteChat = async (sessionId: string) => {
    try {
      await apiRequest("DELETE", `/api/chat/sessions/${sessionId}`, {});
      queryClient.invalidateQueries({ queryKey: ["/api/chat/sessions"] });
      if (currentSessionId === sessionId) {
        setCurrentSessionId(null);
      }
      toast({ title: "Chat deleted" });
    } catch (error) {
      toast({ title: "Error", description: "Failed to delete chat", variant: "destructive" });
    }
  };

  // Bulk delete chats
  const bulkDeleteChats = async () => {
    if (selectedChatsForDelete.size === 0) {
      toast({ title: "No chats selected", variant: "destructive" });
      return;
    }

    try {
      await apiRequest("POST", "/api/chat/sessions/bulk-delete", {
        sessionIds: Array.from(selectedChatsForDelete),
      });
      queryClient.invalidateQueries({ queryKey: ["/api/chat/sessions"] });
      setSelectedChatsForDelete(new Set());
      if (selectedChatsForDelete.has(currentSessionId || "")) {
        setCurrentSessionId(null);
      }
      toast({ title: `Deleted ${selectedChatsForDelete.size} chats` });
    } catch (error) {
      toast({ title: "Error", description: "Failed to delete chats", variant: "destructive" });
    }
  };

  // Toggle select all
  const toggleSelectAll = () => {
    if (selectedChatsForDelete.size === sessions.length) {
      setSelectedChatsForDelete(new Set());
    } else {
      setSelectedChatsForDelete(new Set(sessions.map(s => s.id)));
    }
  };

  // Toggle individual chat selection
  const toggleChatSelection = (sessionId: string) => {
    const newSelected = new Set(selectedChatsForDelete);
    if (newSelected.has(sessionId)) {
      newSelected.delete(sessionId);
    } else {
      newSelected.add(sessionId);
    }
    setSelectedChatsForDelete(newSelected);
  };

  // Detect if user is asking for internet search
  const detectSearchQuery = (text: string): string | null => {
    const searchKeywords = [
      "search for",
      "find",
      "look up",
      "what is",
      "who is",
      "latest",
      "current",
      "today",
      "news about",
      "recent",
      "internet search",
      "google",
      "web search",
      "who are you",
      "about you"
    ];

    const lowerText = text.toLowerCase();
    for (const keyword of searchKeywords) {
      if (lowerText.includes(keyword)) {
        return text.replace(new RegExp(keyword, "gi"), "").trim();
      }
    }
    return null;
  };

  // Perform internet search
  const performSearch = async (query: string) => {
    try {
      setIsSearching(true);
      setSearchResults(null);
      const res = await apiRequest("POST", "/api/chat/search", { query });
      const data = await res.json();
      setSearchResults(data);
      toast({ title: "Search complete", description: `Found ${data.results?.length || 0} results` });
    } catch (error) {
      toast({
        title: "Search failed",
        description: "Could not search the internet",
        variant: "destructive",
      });
    } finally {
      setIsSearching(false);
    }
  };

  // Send message — creates session on first message if needed
  const handleSendMessage = async () => {
    if (!message.trim() || isLoading) return;

    // Check if user is asking to open a feature
    const featureRoute = detectFeatureOpen(message);
    if (featureRoute) {
      window.location.href = featureRoute;
      return;
    }

    // Check if user is asking for internet search
    const searchQuery = detectSearchQuery(message);
    if (searchQuery) {
      await performSearch(searchQuery);
      setMessage("");
      return;
    }

    // Create session on first message if we don't have one
    let sessionId = currentSessionId;
    if (!sessionId) {
      try {
        const res = await apiRequest("POST", "/api/chat/sessions", {
          title: message.trim().slice(0, 60),
          mode: "chat",
        });
        const session = await res.json();
        sessionId = session.id;
        setCurrentSessionId(session.id);
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
      });
      await res.json();

      await refetchMessages();
      queryClient.invalidateQueries({ queryKey: ["/api/chat/sessions"] });
      setMessage("");
    } catch (error) {
      toast({ title: "Error", description: "Failed to send message", variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  };

  // Handle Enter key
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  if (authLoading || !user) {
    return (
      <div className="flex items-center justify-center h-screen">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background transition-all duration-700 ease-in-out animate-in fade-in zoom-in-95">
      <div className="flex h-screen glassmorphism shadow-2xl relative z-10">
        {/* Sidebar */}
        <div
          className={`${
            sidebarOpen ? "w-64" : "w-0"
          } transition-all duration-300 border-r border-border flex flex-col overflow-hidden bg-slate-900/50 backdrop-blur-xl`}
        >
          {/* New Chat Button */}
          <div className="p-4 border-b border-border">
            <Button
              onClick={createNewChat}
              className="w-full"
              data-testid="button-new-chat"
            >
              <Plus className="w-4 h-4 mr-2" />
              New Chat
            </Button>
          </div>

          {/* History Tabs */}
          <div className="flex gap-1 p-3 border-b border-border">
            <button
              onClick={() => setHistoryTab("all")}
              className={`flex-1 text-xs font-semibold py-2 rounded transition-colors ${
                historyTab === "all"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              data-testid="tab-history-all"
            >
              All
            </button>
            <button
              onClick={() => setHistoryTab("manage")}
              className={`flex-1 text-xs font-semibold py-2 rounded transition-colors ${
                historyTab === "manage"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              data-testid="tab-history-manage"
            >
              Manage
            </button>
          </div>

          {/* Chat History */}
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {historyTab === "all" ? (
              // All chats view
              <>
                {sessions.length === 0 ? (
                  <p className="text-xs text-muted-foreground text-center py-4">No chats yet</p>
                ) : (
                  sessions.map((session) => (
                    <div
                      key={session.id}
                      className={`flex items-center gap-2 p-2 rounded cursor-pointer transition-colors ${
                        currentSessionId === session.id
                          ? "bg-primary/20 text-primary"
                          : "hover:bg-muted"
                      }`}
                    >
                      <button
                        onClick={() => setCurrentSessionId(session.id)}
                        className="flex-1 text-left text-sm truncate min-w-0"
                        title={session.title}
                        data-testid={`button-session-${session.id}`}
                      >
                        {session.title}
                      </button>
                      <button
                        onClick={() => {
                          if (window.confirm("Delete " + session.title + "?")) {
                            deleteChat(session.id);
                          }
                        }}
                        className="p-1 text-destructive hover:bg-destructive/20 rounded transition-colors"
                        data-testid={`button-delete-${session.id}`}
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))
                )}
              </>
            ) : (
              // Manage chats view with checkboxes
              <>
                {sessions.length === 0 ? (
                  <p className="text-xs text-muted-foreground text-center py-4">No chats to manage</p>
                ) : (
                  <>
                    {/* Select All Button */}
                    <button
                      onClick={toggleSelectAll}
                      className="w-full flex items-center gap-2 p-2 rounded hover:bg-muted transition-colors mb-2 text-sm font-semibold"
                      data-testid="button-select-all-chats"
                    >
                      {selectedChatsForDelete.size === sessions.length ? (
                        <CheckSquare className="w-4 h-4 text-primary" />
                      ) : (
                        <Square className="w-4 h-4 text-muted-foreground" />
                      )}
                      <span className="text-xs">
                        {selectedChatsForDelete.size > 0 ? `${selectedChatsForDelete.size} selected` : "Select All"}
                      </span>
                    </button>

                    {/* Chat List with Checkboxes */}
                    {sessions.map((session) => (
                      <div
                        key={session.id}
                        className="flex items-center gap-2 p-2 rounded hover:bg-muted transition-colors"
                      >
                        <button
                          onClick={() => toggleChatSelection(session.id)}
                          className="flex-shrink-0"
                          data-testid={`checkbox-session-${session.id}`}
                        >
                          {selectedChatsForDelete.has(session.id) ? (
                            <CheckSquare className="w-4 h-4 text-primary" />
                          ) : (
                            <Square className="w-4 h-4 text-muted-foreground" />
                          )}
                        </button>
                        <span className="flex-1 text-sm truncate">{session.title}</span>
                      </div>
                    ))}

                    {/* Bulk Delete Button */}
                    {selectedChatsForDelete.size > 0 && (
                      <button
                        onClick={bulkDeleteChats}
                        className="w-full mt-4 flex items-center justify-center gap-2 p-2 rounded bg-destructive/20 text-destructive hover:bg-destructive/30 transition-colors text-sm font-semibold"
                        data-testid="button-bulk-delete-chats"
                      >
                        <Trash2 className="w-4 h-4" />
                        Delete {selectedChatsForDelete.size}
                      </button>
                    )}
                  </>
                )}
              </>
            )}
          </div>
        </div>

        {/* Main Chat Area */}
        <div className="flex-1 flex flex-col min-w-0 bg-slate-950/20">
          {/* Header - Mobile responsive */}
          <header className="border-b border-border bg-background/80 backdrop-blur-sm">
            <div className="flex items-center justify-between h-14 px-2 sm:px-4">
              <div className="flex items-center gap-1 sm:gap-3">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setSidebarOpen(!sidebarOpen)}
                  data-testid="button-toggle-sidebar"
                >
                  {sidebarOpen ? (
                    <ChevronLeft className="w-5 h-5" />
                  ) : (
                    <Menu className="w-5 h-5" />
                  )}
                </Button>
                <h1 className="font-semibold text-base sm:text-lg">LENORY</h1>

                {/* Quick Action Menu */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      className="hover-elevate ml-1 sm:ml-2 px-2 sm:px-3"
                      data-testid="button-quick-actions"
                    >
                      <Sparkles className="w-4 h-4 sm:mr-2" />
                      <span className="hidden sm:inline">Quick Actions</span>
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-56 z-50">
                    <DropdownMenuItem asChild data-testid="action-open-cbt">
                      <Link href="/cbt-mode" className="flex items-center cursor-pointer">
                        <Lightbulb className="w-4 h-4 mr-2" />
                        <span>Open CBT Mode</span>
                      </Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild data-testid="action-show-memory">
                      <Link href="/memory" className="flex items-center cursor-pointer">
                        <Brain className="w-4 h-4 mr-2" />
                        <span>Show my Memory</span>
                      </Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild data-testid="action-dashboard">
                      <Link href="/dashboard" className="flex items-center cursor-pointer">
                        <Gauge className="w-4 h-4 mr-2" />
                        <span>Take me to Dashboard</span>
                      </Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild data-testid="action-live-ai">
                      <Link href="/live-ai" className="flex items-center cursor-pointer">
                        <Zap className="w-4 h-4 mr-2" />
                        <span>Launch Live AI</span>
                      </Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild data-testid="action-settings">
                      <Link href="/settings" className="flex items-center cursor-pointer">
                        <Settings className="w-4 h-4 mr-2" />
                        <span>View my Settings</span>
                      </Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild data-testid="action-gallery">
                      <Link href="/image-gallery" className="flex items-center cursor-pointer">
                        <Image className="w-4 h-4 mr-2" />
                        <span>Go to Image Gallery</span>
                      </Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild data-testid="action-video-gen">
                      <Link href="/video-gen" className="flex items-center cursor-pointer">
                        <Zap className="w-4 h-4 mr-2" />
                        <span>Generate Video</span>
                      </Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild data-testid="action-courses">
                      <Link href="/courses" className="flex items-center cursor-pointer">
                        <BookOpen className="w-4 h-4 mr-2" />
                        <span>Start a Course</span>
                      </Link>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              <div className="flex items-center gap-1 sm:gap-2">
                <Link href="/settings">
                  <Button variant="ghost" size="icon" data-testid="link-settings" className="hidden sm:flex">
                    <Settings className="w-5 h-5" />
                  </Button>
                </Link>
                <Link href="/live-ai">
                  <Button variant="ghost" size="icon" data-testid="link-live-ai" className="text-purple-400 hover:text-purple-300">
                    <Zap className="w-5 h-5" />
                  </Button>
                </Link>
                <Link href="/dashboard">
                  <Button variant="ghost" size="icon" data-testid="link-back">
                    <ArrowLeft className="w-5 h-5" />
                  </Button>
                </Link>
                <ThemeToggle />
              </div>
            </div>
          </header>

          {/* Messages Container */}
          <div className="flex-1 overflow-y-auto p-4">
            {/* Search Results Display */}
            {searchResults && (
              <div className="max-w-4xl mx-auto mb-6">
                <div className="bg-gradient-to-br from-blue-900/30 to-purple-900/30 border border-blue-700/50 rounded-lg p-6">
                  <div className="flex items-center gap-3 mb-4">
                    <Search className="w-5 h-5 text-blue-400" />
                    <h3 className="text-lg font-semibold text-white">Search Results</h3>
                    <span className="ml-auto text-sm text-blue-300">{searchResults.results?.length || 0} results</span>
                  </div>

                  {searchResults.summary && (
                    <p className="text-sm text-slate-300 mb-4 p-3 bg-slate-800/50 rounded">
                      <strong>Summary:</strong> {searchResults.summary}
                    </p>
                  )}

                  {searchResults.results && searchResults.results.length > 0 ? (
                    <div className="space-y-3">
                      {searchResults.results.map((result: any, idx: number) => (
                        <a
                          key={idx}
                          href={result.link}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="block p-3 bg-slate-800/50 hover:bg-slate-700/50 rounded border border-slate-700 transition-colors group"
                          data-testid={`search-result-${idx}`}
                        >
                          <div className="flex items-start gap-2">
                            <ExternalLink className="w-4 h-4 text-blue-400 flex-shrink-0 mt-1" />
                            <div className="flex-1 min-w-0">
                              <h4 className="font-semibold text-white group-hover:text-blue-300 truncate">
                                {result.title}
                              </h4>
                              <p className="text-xs text-blue-400 mb-1">{result.source}</p>
                              <p className="text-sm text-slate-300 line-clamp-2">
                                {result.snippet}
                              </p>
                              <p className="text-xs text-slate-500 mt-2 truncate">
                                {result.link}
                              </p>
                            </div>
                          </div>
                        </a>
                      ))}
                    </div>
                  ) : (
                    <p className="text-slate-400 text-sm">No results found</p>
                  )}

                  <button
                    onClick={() => setSearchResults(null)}
                    className="mt-4 text-xs text-slate-400 hover:text-slate-200 transition-colors"
                    data-testid="button-close-search"
                  >
                    Clear search
                  </button>
                </div>
              </div>
            )}

            {messages.length === 0 && !searchResults ? (
              <div className="flex flex-col items-center justify-center h-full text-center">
                <Bot className="w-16 h-16 text-muted-foreground/30 mb-4" />
                <h2 className="text-2xl font-semibold mb-2">Start a conversation</h2>
                <p className="text-muted-foreground max-w-md mb-4">
                  Ask me anything about your studies. I can help with explanations, problem-solving, exam prep, and more.
                </p>
                <p className="text-sm text-muted-foreground max-w-md">
                  💡 Try saying "search for..." to find information on the internet!
                </p>
              </div>
            ) : searchResults ? null : (
              <div className="space-y-4 max-w-4xl mx-auto">
                {messages.map((msg) => (
                  <div
                    key={msg.id}
                    className={`flex gap-3 ${
                      msg.role === "user" ? "justify-end" : "justify-start"
                    }`}
                    data-testid={`message-${msg.role}-${msg.id}`}
                  >
                    {msg.role === "assistant" && (
                      <div className="flex-shrink-0">
                        <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                          <Bot className="w-5 h-5 text-primary" />
                        </div>
                      </div>
                    )}

                    <div
                      className={`max-w-2xl rounded-lg p-4 backdrop-blur-md transition-all duration-300 ${
                        msg.role === "user"
                          ? "bg-gradient-to-br from-primary/90 to-primary/70 text-primary-foreground shadow-lg shadow-primary/20 hover:shadow-primary/40"
                          : "bg-gradient-to-br from-muted/80 to-muted/60 text-foreground border border-border/50 shadow-lg shadow-black/10 dark:shadow-black/30 hover:shadow-black/20 dark:hover:shadow-black/40"
                      }`}
                      data-testid={`card-message-${msg.id}`}
                    >
                      {msg.attachments?.images && msg.attachments.images.length > 0 && (
                        <div className="mb-3 space-y-2">
                          {msg.attachments.images.map((img: any, idx: number) => (
                            <div key={idx} className="rounded-lg overflow-hidden" data-testid={`image-${msg.id}-${idx}`}>
                              <img
                                src={img.url}
                                alt={img.title || "Generated image"}
                                className="w-full h-auto max-h-64 object-cover rounded-lg"
                                loading="lazy"
                              />
                              {img.title && (
                                <p className="text-xs text-muted-foreground mt-1 italic">{img.title}</p>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                      <div className="flex justify-between items-start gap-3">
                        <div className="break-words text-sm flex-1 min-w-0">
                          {msg.role === "assistant" ? (
                            <div className="prose prose-sm dark:prose-invert max-w-none prose-p:my-1 prose-headings:my-2 prose-ul:my-1 prose-ol:my-1 prose-li:my-0.5 prose-code:bg-secondary prose-code:px-1 prose-code:rounded prose-pre:bg-secondary prose-pre:p-3 prose-pre:rounded-lg prose-blockquote:border-l-primary prose-blockquote:text-muted-foreground">
                              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                {msg.content}
                              </ReactMarkdown>
                            </div>
                          ) : (
                            <div className="whitespace-pre-wrap">{msg.content}</div>
                          )}
                        </div>
                        {msg.role === "assistant" && (
                          <button
                            onClick={() => {
                              setPlayingMessageId(
                                playingMessageId === msg.id ? null : msg.id
                              );
                              toggleSpeak(msg.content);
                            }}
                            className={`flex-shrink-0 p-2 rounded-lg transition-all duration-200 ${
                              playingMessageId === msg.id
                                ? "bg-primary text-primary-foreground"
                                : "hover:bg-primary/20"
                            }`}
                            title={
                              playingMessageId === msg.id ? "Stop" : "Read aloud"
                            }
                            data-testid={`button-speak-${msg.id}`}
                          >
                            {playingMessageId === msg.id ? (
                              <VolumeX className="w-4 h-4" />
                            ) : (
                              <Volume2 className="w-4 h-4" />
                            )}
                          </button>
                        )}
                      </div>
                    </div>

                    {msg.role === "user" && (
                      <div className="flex-shrink-0">
                        <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center">
                          <UserIcon className="w-5 h-5 text-primary-foreground" />
                        </div>
                      </div>
                    )}
                  </div>
                ))}
                <div ref={messagesEndRef} />
              </div>
            )}
          </div>

          {/* Input Area */}
          <div className="border-t border-border bg-background p-4">
            <div className="max-w-4xl mx-auto flex gap-2">
              <Textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Type your message... (Shift+Enter for new line)"
                className="flex-1 resize-none"
                rows={3}
                disabled={isLoading}
                data-testid="input-message"
              />
              <Button
                onClick={handleSendMessage}
                disabled={!message.trim() || isLoading || isSearching}
                size="icon"
                className="self-end"
                data-testid="button-send"
              >
                {isLoading || isSearching ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  <Send className="w-5 h-5" />
                )}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
