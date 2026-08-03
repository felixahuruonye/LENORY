// client/src/components/VoiceHistoryModal.tsx
import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogClose,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import {
  Trash2,
  Eye,
  MessageSquare,
  Copy,
  History,
  Loader2,
  Clock,
  ChevronRight,
  X,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";
import { formatDistanceToNow } from "date-fns";

interface TranscriptMessage {
  role: "user" | "assistant";
  content: string;
}

interface Recording {
  id: string;
  title: string;
  transcript: TranscriptMessage[];
  duration: number;
  createdAt: string;
  sessionId?: string | null;
}

interface VoiceHistoryModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function VoiceHistoryModal({ open, onOpenChange }: VoiceHistoryModalProps) {
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedRecording, setSelectedRecording] = useState<Recording | null>(null);
  const [viewingTranscript, setViewingTranscript] = useState<Recording | null>(null);
  const { toast } = useToast();
  const [, navigate] = useLocation();

  // Fetch recordings when modal opens
  const fetchRecordings = async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/recordings", {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to fetch recordings");
      const data = await res.json();
      setRecordings(data);
    } catch (err) {
      toast({
        title: "Error",
        description: "Could not load voice history",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) {
      fetchRecordings();
    }
  }, [open]);

  // Delete a recording
  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm("Delete this voice session?")) return;
    try {
      const res = await fetch(`/api/recordings/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) throw new Error("Delete failed");
      setRecordings((prev) => prev.filter((r) => r.id !== id));
      toast({
        title: "Deleted",
        description: "Voice session removed",
      });
    } catch {
      toast({
        title: "Error",
        description: "Could not delete",
        variant: "destructive",
      });
    }
  };

  // Start a new chat with the transcript as context
  const handleChatAbout = async (recording: Recording, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      // Build transcript text
      const transcriptText = recording.transcript
        .map((msg) => `${msg.role === "assistant" ? "LENORY" : "You"}: ${msg.content}`)
        .join("\n\n");

      // Create a new chat session
      const sessionRes = await fetch("/api/chat/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          title: `Voice: ${recording.title}`,
          mode: "chat",
        }),
      });
      if (!sessionRes.ok) throw new Error("Could not create chat");
      const session = await sessionRes.json();

      // Save the transcript as a user message
      await fetch("/api/chat/save-message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          sessionId: session.id,
          role: "user",
          content: `📞 **Voice Session Transcript**\n\n${transcriptText}`,
        }),
      });

      // Close modal and navigate
      onOpenChange(false);
      navigate(`/chat?sessionId=${session.id}`);
      toast({
        title: "Chat Started",
        description: "Your voice transcript is now in the chat",
      });
    } catch (err) {
      toast({
        title: "Error",
        description: "Could not start chat",
        variant: "destructive",
      });
    }
  };

  // Copy transcript to clipboard
  const handleCopy = (recording: Recording, e: React.MouseEvent) => {
    e.stopPropagation();
    const text = recording.transcript
      .map((msg) => `${msg.role === "assistant" ? "LENORY" : "You"}: ${msg.content}`)
      .join("\n\n");
    navigator.clipboard.writeText(text);
    toast({
      title: "Copied",
      description: "Transcript copied to clipboard",
    });
  };

  // View full transcript
  const handleViewTranscript = (recording: Recording, e: React.MouseEvent) => {
    e.stopPropagation();
    setViewingTranscript(recording);
  };

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}m ${secs}s`;
  };

  return (
    <>
      {/* Main Modal */}
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <History className="h-5 w-5" />
              Voice Session History
            </DialogTitle>
          </DialogHeader>

          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : recordings.length === 0 ? (
            <div className="py-12 text-center">
              <History className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
              <p className="text-muted-foreground">No voice sessions yet</p>
              <p className="text-xs text-muted-foreground mt-1">
                Start a voice call to save transcripts here
              </p>
            </div>
          ) : (
            <ScrollArea className="flex-1 pr-4">
              <div className="space-y-3">
                {recordings.map((rec) => (
                  <div
                    key={rec.id}
                    className="border rounded-lg p-4 hover:bg-muted/30 transition-colors cursor-pointer"
                    onClick={() => setSelectedRecording(rec)}
                    data-testid={`voice-history-item-${rec.id}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <h4 className="font-medium text-sm truncate">{rec.title}</h4>
                        <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1">
                          <span className="flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {formatDuration(rec.duration)}
                          </span>
                          <span>•</span>
                          <span>{formatDistanceToNow(new Date(rec.createdAt), { addSuffix: true })}</span>
                          <Badge variant="outline" className="text-[10px]">
                            {rec.transcript.length} messages
                          </Badge>
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={(e) => handleViewTranscript(rec, e)}
                          className="h-8 w-8 p-0"
                          title="View transcript"
                          data-testid={`voice-history-view-${rec.id}`}
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={(e) => handleChatAbout(rec, e)}
                          className="h-8 w-8 p-0 text-primary"
                          title="Chat about this"
                          data-testid={`voice-history-chat-${rec.id}`}
                        >
                          <MessageSquare className="h-4 w-4" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={(e) => handleCopy(rec, e)}
                          className="h-8 w-8 p-0"
                          title="Copy transcript"
                          data-testid={`voice-history-copy-${rec.id}`}
                        >
                          <Copy className="h-4 w-4" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={(e) => handleDelete(rec.id, e)}
                          className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                          title="Delete"
                          data-testid={`voice-history-delete-${rec.id}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                    {/* Preview snippet */}
                    {rec.transcript.length > 0 && (
                      <p className="text-xs text-muted-foreground mt-2 truncate">
                        {rec.transcript[0]?.role === "assistant"
                          ? `LENORY: ${rec.transcript[0].content.substring(0, 80)}...`
                          : `You: ${rec.transcript[0].content.substring(0, 80)}...`}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}
        </DialogContent>
      </Dialog>

      {/* View Transcript Sub-modal */}
      <Dialog open={!!viewingTranscript} onOpenChange={() => setViewingTranscript(null)}>
        <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center justify-between gap-4">
              <span className="truncate">{viewingTranscript?.title}</span>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  if (viewingTranscript) {
                    const text = viewingTranscript.transcript
                      .map((msg) => `${msg.role === "assistant" ? "LENORY" : "You"}: ${msg.content}`)
                      .join("\n\n");
                    navigator.clipboard.writeText(text);
                    toast({ title: "Copied", description: "Transcript copied" });
                  }
                }}
                data-testid="button-copy-full-transcript"
              >
                <Copy className="h-4 w-4 mr-2" />
                Copy All
              </Button>
              <DialogClose asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8">
                  <X className="h-4 w-4" />
                </Button>
              </DialogClose>
            </DialogTitle>
          </DialogHeader>
          <ScrollArea className="flex-1 pr-4">
            <div className="space-y-3">
              {viewingTranscript?.transcript.map((msg, idx) => (
                <div
                  key={idx}
                  className={`p-3 rounded-lg ${
                    msg.role === "assistant"
                      ? "bg-primary/10 border border-primary/20"
                      : "bg-muted/30 border border-border"
                  }`}
                >
                  <p className="text-xs font-semibold text-muted-foreground mb-1">
                    {msg.role === "assistant" ? "🤖 LENORY" : "👤 You"}
                  </p>
                  <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                </div>
              ))}
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </>
  );
}
