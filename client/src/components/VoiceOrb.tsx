// client/src/components/VoiceOrb.tsx
//
// Rendered once at the app root (inside VoiceCallProvider, above the
// router) so it shows on whatever page the student is on while a call is
// active — matching the request to keep talking to LENORY while switching
// chat sessions, and to have a persistent floating indicator like ChatGPT's
// voice mode rather than a full-page "in call" screen.
import { useState } from "react";
import { Mic, PhoneOff, X } from "lucide-react";
import { useVoiceCall } from "@/contexts/VoiceCallContext";

function formatDuration(s: number) {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

export default function VoiceOrb() {
  const { status, isSpeaking, callDurationSeconds, transcript, endVoiceCall } = useVoiceCall();
  const [expanded, setExpanded] = useState(false);

  if (status === "idle") return null;

  return (
    <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-40 flex flex-col items-center" data-testid="voice-orb">
      {expanded && (
        <div className="mb-2 bg-background/95 backdrop-blur-xl border border-primary/30 rounded-2xl px-4 py-3 shadow-2xl max-w-xs animate-in fade-in slide-in-from-bottom-2">
          <div className="flex items-center justify-between gap-3 mb-1">
            <span className="text-xs font-mono text-muted-foreground">
              {status === "connecting" ? "Connecting..." : formatDuration(callDurationSeconds)}
            </span>
            <button onClick={() => setExpanded(false)} className="text-muted-foreground hover:text-foreground" data-testid="button-collapse-orb">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          {transcript && <p className="text-xs text-muted-foreground italic mb-2 line-clamp-2">"{transcript}"</p>}
          <button
            onClick={endVoiceCall}
            className="w-full flex items-center justify-center gap-2 text-xs font-medium bg-destructive/10 hover:bg-destructive/20 text-destructive rounded-lg py-1.5 transition-colors"
            data-testid="button-end-call-orb"
          >
            <PhoneOff className="w-3.5 h-3.5" /> End Call
          </button>
        </div>
      )}

      <button
        onClick={() => setExpanded(v => !v)}
        className={`relative w-14 h-14 rounded-full flex items-center justify-center shadow-2xl transition-all ${
          status === "connecting" ? "bg-muted animate-pulse" : "bg-primary shadow-primary/40"
        }`}
        data-testid="button-voice-orb"
        title="Live voice call — tap for options"
      >
        {isSpeaking && <span className="absolute inset-0 rounded-full bg-primary/40 animate-ping" />}
        <Mic className={`w-6 h-6 relative ${status === "connecting" ? "text-muted-foreground" : "text-primary-foreground"}`} />
      </button>
    </div>
  );
}
