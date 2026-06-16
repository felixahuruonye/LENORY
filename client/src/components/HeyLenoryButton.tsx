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

  // Drag state
  const [position, setPosition] = useState({ x: -1, y: -1 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef<{ mx: number; my: number; px: number; py: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const socketRef = useRef<WebSocket | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recognitionRef = useRef<any>(null);
  const { toast } = useToast();

  // Initialize position to bottom-right on mount
  useEffect(() => {
    const saved = localStorage.getItem("heylenory-pos");
    if (saved) {
      try {
        setPosition(JSON.parse(saved));
      } catch {
        setPosition({ x: window.innerWidth - 80, y: window.innerHeight - 80 });
      }
    } else {
      setPosition({ x: window.innerWidth - 80, y: window.innerHeight - 80 });
    }
  }, []);

  // Clamp position to viewport
  const clampPos = useCallback((x: number, y: number) => {
    const W = window.innerWidth;
    const H = window.innerHeight;
    return {
      x: Math.max(8, Math.min(x, W - 72)),
      y: Math.max(8, Math.min(y, H - 72)),
    };
  }, []);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragStartRef.current = { mx: e.clientX, my: e.clientY, px: position.x, py: position.y };
    setIsDragging(false);
  }, [position]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragStartRef.current) return;
    const dx = e.clientX - dragStartRef.current.mx;
    const dy = e.clientY - dragStartRef.current.my;
    if (!isDragging && Math.abs(dx) < 5 && Math.abs(dy) < 5) return;
    setIsDragging(true);
    const newPos = clampPos(dragStartRef.current.px + dx, dragStartRef.current.py + dy);
    setPosition(newPos);
  }, [isDragging, clampPos]);

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    if (!dragStartRef.current) return;
    const dx = e.clientX - dragStartRef.current.mx;
    const dy = e.clientY - dragStartRef.current.my;
    const wasDrag = Math.abs(dx) > 5 || Math.abs(dy) > 5;
    dragStartRef.current = null;
    if (wasDrag) {
      localStorage.setItem("heylenory-pos", JSON.stringify(position));
    } else {
      setIsOpen(prev => !prev);
    }
    setTimeout(() => setIsDragging(false), 50);
  }, [position]);

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

  const handleSend = useCallback((text: string) => {
    if (!text.trim()) return;
    if (onTranscript) onTranscript(text.trim());
    setTranscript("");
    stopListening();
    setIsOpen(false);
    toast({ title: "Voice sent to LENORY", description: text.trim().slice(0, 60) });
  }, [onTranscript, stopListening, toast]);

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
  }, [silenceTimer, handleSend]);

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
  }, [toast, handleSend]);

  const startListening = useCallback(() => {
    if (useAssemblyAI) {
      startListeningAssemblyAI();
    } else {
      startListeningWebSpeech();
    }
  }, [useAssemblyAI, startListeningAssemblyAI, startListeningWebSpeech]);

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

  if (position.x < 0) return null;

  const panelLeft = position.x > window.innerWidth / 2;

  return (
    <div
      ref={containerRef}
      className={`fixed z-50 flex flex-col items-end gap-3 ${className || ""}`}
      style={{ left: position.x, top: position.y }}
    >
      {isOpen && (
        <div
          className={`absolute bottom-16 ${panelLeft ? "right-0" : "left-0"} bg-background/95 backdrop-blur-xl border border-primary/30 rounded-2xl p-4 shadow-2xl w-72 animate-in fade-in slide-in-from-bottom-3`}
          onPointerDown={e => e.stopPropagation()}
        >
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
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        className={`h-14 w-14 rounded-full flex items-center justify-center shadow-2xl transition-all select-none touch-none ${
          isDragging ? "cursor-grabbing scale-110 shadow-primary/30 shadow-2xl" :
          isOpen
            ? "bg-primary text-primary-foreground ring-4 ring-primary/30 cursor-grab"
            : isListening
            ? "bg-red-500 text-white ring-4 ring-red-500/30 animate-pulse cursor-grab"
            : "bg-background/90 backdrop-blur text-foreground border border-primary/30 hover:bg-primary hover:text-primary-foreground cursor-grab"
        }`}
        data-testid="button-hey-lenory"
        title="Hey LENORY — drag to move, tap to open voice assistant"
      >
        <Mic className="h-6 w-6 pointer-events-none" />
      </button>
    </div>
  );
}
