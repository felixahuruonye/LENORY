import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation, useParams } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Loader2, ChevronLeft, Zap, Send, Copy } from "lucide-react";

interface DebugMessage {
  type: "user" | "status";
  content: string;
}

export default function WebsiteDebug() {
  const [, setLocation] = useLocation();
  const { id } = useParams<{ id: string }>();
  const { toast } = useToast();
  const [debugPrompt, setDebugPrompt] = useState("");
  const [debugHistory, setDebugHistory] = useState<DebugMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [scrollRef, setScrollRef] = useState<HTMLDivElement | null>(null);
  const [activeTab, setActiveTab] = useState<"html" | "css" | "js">("html");
  const [currentCode, setCurrentCode] = useState({
    html: "",
    css: "",
    js: "",
  });

  // Auto-scroll when messages update
  useEffect(() => {
    setTimeout(() => {
      if (scrollRef) {
        scrollRef.scrollTop = scrollRef.scrollHeight;
      }
    }, 100);
  }, [debugHistory]);

  // Fetch website
  const { data: website, isLoading: websiteLoading, refetch } = useQuery({
    queryKey: ["/api/websites", id],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/websites/${id}`);
      return res.json();
    },
    enabled: !!id,
  });

  // Update local code when website changes
  useEffect(() => {
    if (website) {
      setCurrentCode({
        html: website.htmlCode || "",
        css: website.cssCode || "",
        js: website.jsCode || "",
      });
    }
  }, [website]);

  const handleSubmit = async () => {
    if (!debugPrompt.trim() || isLoading) return;

    const userPrompt = debugPrompt;
    setDebugPrompt("");
    setDebugHistory((prev) => [...prev, { type: "user", content: userPrompt }]);
    setIsLoading(true);

    try {
      const res = await apiRequest("POST", `/api/websites/${id}/debug`, { debugPrompt: userPrompt });
      const data = await res.json();
      
      // Show each step in chat
      data.steps?.forEach((step: string) => {
        setDebugHistory((prev) => [...prev, { type: "status", content: step }]);
      });

      // Update local code
      setCurrentCode({
        html: data.htmlCode,
        css: data.cssCode,
        js: data.jsCode,
      });

      // Refetch to sync with database
      await refetch();
    } catch (error: any) {
      const message = error?.message || error?.error || "Failed to debug code";
      toast({
        title: "Error",
        description: message,
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleCopyCode = () => {
    const code = activeTab === "html" ? currentCode.html : activeTab === "css" ? currentCode.css : currentCode.js;
    navigator.clipboard.writeText(code);
    toast({
      title: "Copied",
      description: `${activeTab.toUpperCase()} code copied to clipboard`,
    });
  };

  const handleClearHistory = () => {
    setDebugHistory([]);
    setDebugPrompt("");
  };

  if (!id) {
    return (
      <div className="min-h-screen bg-background">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <Card className="p-8 text-center text-muted-foreground">
            <p>Website not found</p>
            <Button variant="outline" className="mt-4" onClick={() => setLocation("/website-generator")}>
              Back to Generator
            </Button>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <div className="border-b border-border/50 bg-background/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-6xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setLocation("/website-generator")}
              data-testid="button-back"
            >
              <ChevronLeft className="h-5 w-5" />
            </Button>
            <h1 className="text-2xl font-bold text-center flex-1">Debug Mode</h1>
            <div className="w-10" />
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-6xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-8 flex-1 flex flex-col gap-4">
        {websiteLoading ? (
          <Card className="p-12 text-center flex-1 flex items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin mx-auto" />
          </Card>
        ) : (
          <>
            {/* Website Info */}
            <Card className="p-4">
              <h2 className="text-lg font-semibold mb-1">{website?.title}</h2>
              <p className="text-sm text-muted-foreground">{website?.description}</p>
            </Card>

            {/* Main Grid: Chat + Code Editor */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 flex-1 min-h-0">
              {/* Chat Panel */}
              <Card className="flex flex-col overflow-hidden">
                {/* Chat Messages */}
                <div
                  ref={setScrollRef}
                  className="flex-1 overflow-y-auto p-4 space-y-3"
                  data-testid="debug-messages-container"
                >
                  {debugHistory.length === 0 ? (
                    <div className="h-full flex items-center justify-center text-center text-muted-foreground">
                      <div>
                        <Zap className="h-12 w-12 mx-auto mb-4 opacity-50" />
                        <p>Ask LENORY AI to debug or improve your code</p>
                        <p className="text-xs mt-2">
                          Examples: "Add a button click handler", "Make the text responsive", "Fix the layout"
                        </p>
                      </div>
                    </div>
                  ) : (
                    debugHistory.map((msg, idx) => (
                      <div
                        key={idx}
                        className={`flex gap-3 ${msg.type === "user" ? "justify-end" : "justify-start"}`}
                        data-testid={`debug-message-${idx}`}
                      >
                        <div
                          className={`max-w-[80%] p-3 rounded-lg ${
                            msg.type === "user"
                              ? "bg-primary text-primary-foreground"
                              : "bg-yellow-100/20 dark:bg-yellow-900/20 text-foreground border border-yellow-300/30"
                          }`}
                        >
                          <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                        </div>
                      </div>
                    ))
                  )}
                  {isLoading && (
                    <div className="flex gap-3 justify-start">
                      <div className="bg-muted p-3 rounded-lg">
                        <Loader2 className="h-4 w-4 animate-spin" />
                      </div>
                    </div>
                  )}
                </div>

                {/* Input Area */}
                <div className="border-t p-4 space-y-3">
                  <Textarea
                    placeholder="Ask LENORY to debug, fix issues, or improve your code..."
                    value={debugPrompt}
                    onChange={(e) => setDebugPrompt(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && e.ctrlKey) {
                        handleSubmit();
                      }
                    }}
                    className="resize-none min-h-[80px]"
                    data-testid="input-debug-prompt"
                  />
                  <div className="flex gap-2">
                    <Button
                      onClick={handleSubmit}
                      disabled={!debugPrompt.trim() || isLoading}
                      className="flex-1 hover-elevate active-elevate-2"
                      data-testid="button-submit-debug"
                    >
                      {isLoading ? (
                        <>
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          Debugging...
                        </>
                      ) : (
                        <>
                          <Send className="h-4 w-4 mr-2" />
                          Ask LENORY
                        </>
                      )}
                    </Button>
                    <Button
                      variant="outline"
                      onClick={handleClearHistory}
                      disabled={debugHistory.length === 0}
                      className="hover-elevate active-elevate-2"
                      data-testid="button-clear-history"
                    >
                      Clear
                    </Button>
                  </div>
                </div>
              </Card>

              {/* Code Editor Panel */}
              <Card className="flex flex-col overflow-hidden">
                {/* Tabs */}
                <div className="flex border-b bg-muted/50 p-2 gap-1">
                  {(["html", "css", "js"] as const).map((tab) => (
                    <Button
                      key={tab}
                      size="sm"
                      variant={activeTab === tab ? "default" : "ghost"}
                      onClick={() => setActiveTab(tab)}
                      className="flex-1"
                      data-testid={`tab-${tab}`}
                    >
                      {tab.toUpperCase()}
                    </Button>
                  ))}
                </div>

                {/* Code Display */}
                <div className="flex-1 overflow-auto p-4">
                  <pre className="text-sm bg-black/5 dark:bg-white/5 p-4 rounded-lg overflow-auto font-mono whitespace-pre-wrap break-words max-h-full">
                    <code>
                      {activeTab === "html"
                        ? currentCode.html
                        : activeTab === "css"
                          ? currentCode.css
                          : currentCode.js}
                    </code>
                  </pre>
                </div>

                {/* Copy Button */}
                <div className="border-t p-3">
                  <Button
                    size="sm"
                    variant="outline"
                    className="w-full hover-elevate active-elevate-2"
                    onClick={handleCopyCode}
                    data-testid="button-copy-code"
                  >
                    <Copy className="h-4 w-4 mr-2" />
                    Copy {activeTab.toUpperCase()} Code
                  </Button>
                </div>
              </Card>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
