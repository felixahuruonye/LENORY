import { useEffect, useState } from "react";
import { X, Maximize2, Minimize2, RefreshCw, Camera, Hand, Play, Square } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

type Props = {
  taskId: string | null;
  open: boolean;
  onClose: () => void;
  initialLiveViewUrl?: string | null;
};

/**
 * LENORY Browser Workspace — embeds Browserbase Live View for a task session.
 * Does not replace chat; used as a panel/sheet.
 */
export default function BrowserWorkspace({ taskId, open, onClose, initialLiveViewUrl }: Props) {
  const { toast } = useToast();
  const [liveViewUrl, setLiveViewUrl] = useState<string | null>(initialLiveViewUrl || null);
  const [status, setStatus] = useState<string>("idle");
  const [fullscreen, setFullscreen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [interactive, setInteractive] = useState(true);

  useEffect(() => {
    if (initialLiveViewUrl) setLiveViewUrl(initialLiveViewUrl);
  }, [initialLiveViewUrl]);

  useEffect(() => {
    if (!open || !taskId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await apiRequest("GET", `/api/actions/tasks/${taskId}/live-view`);
        const data = await res.json();
        if (!cancelled && data?.liveViewUrl) {
          setLiveViewUrl(data.liveViewUrl);
          setStatus("live");
        } else if (!cancelled) {
          setStatus("unavailable");
        }
      } catch {
        if (!cancelled) setStatus("unavailable");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, taskId]);

  useEffect(() => {
    const onMsg = (event: MessageEvent) => {
      if (event.data === "browserbase-disconnected") {
        setStatus("disconnected");
        toast({ title: "Browser session disconnected" });
      }
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [toast]);

  if (!open) return null;

  const handoff = async () => {
    if (!taskId) return;
    try {
      await apiRequest("POST", `/api/actions/tasks/${taskId}/handoff`, { reason: "User opened workspace" });
      setStatus("awaiting_human");
      toast({ title: "Your turn", description: "Interact in the browser. Press Resume when done." });
    } catch {
      toast({ title: "Handoff failed", variant: "destructive" });
    }
  };

  const resume = async () => {
    if (!taskId) return;
    try {
      await apiRequest("POST", `/api/actions/tasks/${taskId}/resume`, {});
      setStatus("running");
      toast({ title: "LENORY resumed control" });
    } catch {
      toast({ title: "Resume failed", variant: "destructive" });
    }
  };

  const closeBrowser = async () => {
    if (!taskId) return;
    try {
      await apiRequest("POST", `/api/actions/tasks/${taskId}/close-browser`, {});
      toast({ title: "Browser closed" });
      onClose();
    } catch {
      toast({ title: "Close failed", variant: "destructive" });
    }
  };

  const refreshLiveView = async () => {
    if (!taskId) return;
    setLoading(true);
    try {
      const res = await apiRequest("GET", `/api/actions/tasks/${taskId}/live-view`);
      const data = await res.json();
      if (data?.liveViewUrl) {
        setLiveViewUrl(data.liveViewUrl + (data.liveViewUrl.includes("?") ? "&" : "?") + "t=" + Date.now());
        setStatus("live");
      }
    } catch {
      setStatus("unavailable");
    } finally {
      setLoading(false);
    }
  };

  const panelClass = fullscreen
    ? "fixed inset-0 z-50 bg-background flex flex-col"
    : "fixed inset-x-0 bottom-0 z-40 h-[55vh] md:inset-auto md:right-0 md:top-14 md:bottom-0 md:w-[min(520px,46vw)] border-t md:border-l bg-background flex flex-col shadow-xl";

  return (
    <div className={panelClass}>
      <div className="flex items-center gap-2 px-3 py-2 border-b bg-muted/40">
        <span className="text-sm font-medium flex-1 truncate">Browser Workspace {taskId ? `· ${taskId.slice(0, 8)}` : ""}</span>
        <span className="text-xs text-muted-foreground">{status}{loading ? "…" : ""}</span>
        <button type="button" className="p-1.5 rounded hover:bg-muted" title="Refresh Live View" onClick={refreshLiveView}>
          <RefreshCw className="w-4 h-4" />
        </button>
        <button type="button" className="p-1.5 rounded hover:bg-muted" title="Your turn" onClick={handoff}>
          <Hand className="w-4 h-4" />
        </button>
        <button type="button" className="p-1.5 rounded hover:bg-muted" title="Resume AI" onClick={resume}>
          <Play className="w-4 h-4" />
        </button>
        <button
          type="button"
          className="p-1.5 rounded hover:bg-muted"
          title={interactive ? "View-only (pointer off)" : "Interactive"}
          onClick={() => setInteractive((v) => !v)}
        >
          <Camera className="w-4 h-4" />
        </button>
        <button type="button" className="p-1.5 rounded hover:bg-muted" title="Close browser session" onClick={closeBrowser}>
          <Square className="w-4 h-4" />
        </button>
        <button type="button" className="p-1.5 rounded hover:bg-muted" onClick={() => setFullscreen((f) => !f)}>
          {fullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
        </button>
        <button type="button" className="p-1.5 rounded hover:bg-muted" onClick={onClose} aria-label="Hide panel">
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="flex-1 min-h-0 bg-black/5 relative">
        {!liveViewUrl && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground p-4 text-center">
            {loading
              ? "Connecting to Live View…"
              : "No Live View yet. Ask LENORY to open a browser session, or check Browserbase configuration."}
          </div>
        )}
        {liveViewUrl && (
          <iframe
            title="LENORY Browser Live View"
            src={liveViewUrl}
            className="w-full h-full border-0"
            sandbox="allow-same-origin allow-scripts allow-forms allow-popups"
            allow="clipboard-read; clipboard-write"
            style={{ pointerEvents: interactive ? "auto" : "none" }}
          />
        )}
      </div>
      <p className="text-[11px] text-muted-foreground px-3 py-1.5 border-t">
        Live session is remote. CAPTCHA and identity checks stay human-controlled. Usage is metered.
      </p>
    </div>
  );
}
