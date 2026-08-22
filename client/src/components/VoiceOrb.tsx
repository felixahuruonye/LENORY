// client/src/components/VoiceOrb.tsx
//
// Rendered once at the app root (inside VoiceCallProvider, above the
// router) so it shows on whatever page the student is on while a call is
// active — matching the request to keep talking to LENORY while switching
// chat sessions, and to have a persistent floating indicator like ChatGPT's
// voice mode rather than a full-page "in call" screen.
import { useState } from "react";
import { Mic, PhoneOff, ChevronUp, ChevronDown } from "lucide-react";
import { useVoiceCall } from "@/contexts/VoiceCallContext";

function formatDuration(s: number) {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

export default function VoiceOrb() {
  const { status, isSpeaking, callDurationSeconds, transcript, endVoiceCall } = useVoiceCall();
  const [showTranscript, setShowTranscript] = useState(false);

  if (status === "idle") return null;

  return (
    <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-40 flex flex-col items-center gap-2" data-testid="voice-orb">
      {/* Status is always visible without needing a tap — previously this
          info lived behind the same tap that also just toggled a panel,
          which combined with the hang-up button being a SECOND, separate
          tap made the whole thing feel like it "hung" when a single tap
          (the universal expectation for a call button) didn't visibly do
          anything obvious. */}
      {showTranscript && transcript && (
        <div className="bg-background/95 backdrop-blur-xl border border-primary/30 rounded-2xl px-4 py-2 shadow-2xl max-w-xs animate-in fade-in slide-in-from-bottom-2">
          <p className="text-xs text-muted-foreground italic line-clamp-3">"{transcript}"</p>
        </div>
      )}

      <div className="flex items-center gap-2">
        <button
          onClick={() => setShowTranscript(v => !v)}
          className="w-8 h-8 rounded-full bg-background/80 backdrop-blur border border-border flex items-center justify-center text-muted-foreground hover:text-foreground shadow-lg"
          data-testid="button-toggle-transcript"
          title="Show live transcript"
        >
          {showTranscript ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
        </button>

        <div className="relative">
          <div className={`px-3 py-1 rounded-full text-xs font-mono shadow-lg ${status === "connecting" ? "bg-muted text-muted-foreground" : "bg-background/80 backdrop-blur border border-border text-foreground"}`}>
            {status === "connecting" ? "Connecting..." : formatDuration(callDurationSeconds)}
          </div>
        </div>

        {/* The main button is UNAMBIGUOUSLY hang-up now — one tap, always
            ends the call immediately, matching how every phone call UI
            works. Previously this same button just toggled a details
            panel, and the real hang-up was a second tap buried inside it. */}
        <button
          onClick={endVoiceCall}
          className="relative w-14 h-14 rounded-full flex items-center justify-center shadow-2xl transition-all bg-destructive shadow-destructive/40 active:scale-95"
          data-testid="button-voice-orb"
          title="Tap to end the call"
        >
          {isSpeaking && <span className="absolute inset-0 rounded-full bg-destructive/40 animate-ping" />}
          <PhoneOff className="w-6 h-6 relative text-destructive-foreground" />
        </button>
      </div>
    </div>
  );
}
