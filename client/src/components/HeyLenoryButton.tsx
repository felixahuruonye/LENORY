import { useState, useRef, useEffect, useCallback } from "react";
import { Mic, MicOff, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

interface HeyLenoryButtonProps {
  onTranscript?: (text: string) => void;
  className?: string;
}

export default function HeyLenoryButton({ onTranscript, className }: HeyLenoryButtonProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [silenceTimer, setSilenceTimer] = useState<NodeJS.Timeout | null>(null);
  const [useAssemblyAI, setUseAssemblyAI] = useState(true);
  const socketRef = useRef<WebSocket | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recognitionRef = useRef<any>(null);
  const { toast } = useToast();

  const stopListening = useCallback(() => {
    setIsListening(false);
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      recorderRef.current.stop();
    }
    if (socketRef.current) {
      socketRef.current.close();
      socketRef.current = null;
    }
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
    recorderRef.current = null;
    if (silenceTimer) clearTimeout(silenceTimer);
  }, [silenceTimer]);

  const startListeningAssemblyAI = useCallback(async () => {
    try {
      const tokenRes = await apiRequest("POST", "/api/assemblyai/token", {});
      if (!tokenRes.ok) throw new Error("Token failed");
      const { token } = await tokenRes.json();

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const ws = new WebSocket(`wss://api.assemblyai.com/v2/realtime/ws?sample_rate=16000&token=${token}`);
      socketRef.current = ws;

      ws.onopen = () => {
        setIsListening(true);
        const recorder = new MediaRecorder(stream, { mimeType: "audio/webm;codecs=opus" });
        recorderRef.current = recorder;
        recorder.addEventListener("dataavailable", (e) => {
          if (e.data.size > 0 && ws.readyState === WebSocket.OPEN) {
            e.data.arrayBuffer().then((buffer) => ws.send(buffer));
          }
        });
        recorder.start(250);
      };

      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.message_type === "FinalTranscript" && msg.text) {
          setTranscript((prev) => (prev ? prev + " " + msg.text : msg.text));
          if (silenceTimer) clearTimeout(silenceTimer);
          const t = setTimeout(() => { if (msg.text) handleSend(msg.text); }, 3000);
          setSilenceTimer(t);
        } else if (msg.message_type === "PartialTranscript" && msg.text) {
          setTranscript(msg.text);
        }
      };

      ws.onerror = () => {
        setUseAssemblyAI(false);
        startListeningWebSpeech();
      };

      ws.onclose = () => {
        stream.getTracks().forEach((t) => t.stop());
        setIsListening(false);
      };
    } catch {
      setUseAssemblyAI(false);
      startListeningWebSpeech();
    }
  }, [silenceTimer]);

  const startListeningWebSpeech = useCallback(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      toast({ title: "Microphone unavailable", description: "Please allow microphone access and try again.", variant: "destructive" });
      return;
    }
    const recognition = new SpeechRecognition();
    recognition.lang = "en-NG";
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.onresult = (e: any) => {
      const text = Array.from(e.results).map((r: any) => r[0].transcript).join(" ");
      setTranscript(text);
      if (e.results[e.results.length - 1].isFinal) {
        handleSend(text);
      }
    };
    recognition.onerror = () => setIsListening(false);
    recognition.onend = () => setIsListening(false);
    recognitionRef.current = recognition;
    recognition.start();
    setIsListening(true);
  }, [toast]);

  const startListening = useCallback(() => {
    if (useAssemblyAI) {
      startListeningAssemblyAI();
    } else {
      startListeningWebSpeech();
    }
  }, [useAssemblyAI, startListeningAssemblyAI, startListeningWebSpeech]);

  const handleSend = useCallback((text: string) => {
    if (!text.trim()) return;
    if (onTranscript) onTranscript(text.trim());
    setTranscript("");
    stopListening();
    setIsOpen(false);
    toast({ title: "Voice sent to LENORY", description: text.trim().slice(0, 60) });
  }, [onTranscript, stopListening, toast]);

  useEffect(() => {
    return () => {
      stopListening();
      if (silenceTimer) clearTimeout(silenceTimer);
    };
  }, []);

  useEffect(() => {
    if (!isOpen) {
      stopListening();
      setTranscript("");
    }
  }, [isOpen]);

  return (
    <div className={`fixed bottom-6 right-6 z-50 flex flex-col items-end gap-3 ${className || ""}`}>
      {isOpen && (
        <div className="bg-background/95 backdrop-blur-xl border border-primary/30 rounded-2xl p-4 shadow-2xl w-72 animate-in fade-in slide-in-from-bottom-3">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <div className={`h-2 w-2 rounded-full ${isListening ? "bg-red-500 animate-pulse" : "bg-muted-foreground"}`} />
              <span className="text-sm font-semibold">Hey LENORY</span>
            </div>
            <Button size="icon" variant="ghost" onClick={() => setIsOpen(false)} data-testid="button-close-voice">
              <X className="h-4 w-4" />
            </Button>
          </div>

          <div className="min-h-16 bg-secondary/30 rounded-lg p-3 mb-3 text-sm text-muted-foreground">
            {transcript || (isListening ? "Listening… speak now" : "Tap the mic and speak")}
          </div>

          <div className="flex gap-2">
            <Button
              className="flex-1 gap-2"
              variant={isListening ? "destructive" : "default"}
              onClick={isListening ? stopListening : startListening}
              data-testid="button-toggle-listen"
            >
              {isListening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
              {isListening ? "Stop" : "Start Speaking"}
            </Button>
            {transcript && (
              <Button variant="outline" onClick={() => handleSend(transcript)} data-testid="button-send-transcript">
                Send
              </Button>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-2 text-center">
            3 seconds of silence = auto-send to chat
          </p>
        </div>
      )}

      <button
        onClick={() => setIsOpen((p) => !p)}
        className={`h-14 w-14 rounded-full flex items-center justify-center shadow-2xl transition-all hover:scale-105 active:scale-95 ${
          isOpen
            ? "bg-primary text-primary-foreground ring-4 ring-primary/30"
            : isListening
            ? "bg-red-500 text-white ring-4 ring-red-500/30 animate-pulse"
            : "bg-background/90 backdrop-blur text-foreground border border-primary/30 hover:bg-primary hover:text-primary-foreground"
        }`}
        data-testid="button-hey-lenory"
        title="Hey LENORY — tap to open voice assistant"
      >
        <Mic className="h-6 w-6" />
      </button>
    </div>
  );
}
