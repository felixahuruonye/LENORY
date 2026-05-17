import { useState, useRef, useCallback, useEffect } from "react";
import { supabase } from "@/lib/supabase";

type VapiStatus = "idle" | "connecting" | "active" | "error";

interface UseVapiReturn {
  status: VapiStatus;
  isSpeaking: boolean;
  transcript: string;
  startCall: () => Promise<void>;
  stopCall: () => void;
  sendMessage: (text: string) => void;
  error: string | null;
}

export function useVapi(): UseVapiReturn {
  const [status, setStatus] = useState<VapiStatus>("idle");
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [error, setError] = useState<string | null>(null);
  const vapiRef = useRef<any>(null);

  const startCall = useCallback(async () => {
    try {
      setStatus("connecting");
      setError(null);

      // Get auth token from Supabase session
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token || "";

      // Fetch public key from backend
      const res = await fetch("/api/vapi-config", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("VAPI not configured. Check VAPI_PUBLIC_KEY in Replit Secrets.");
      const { publicKey } = await res.json();
      if (!publicKey) throw new Error("VAPI public key missing from server response");

      const { default: Vapi } = await import("@vapi-ai/web");
      const vapi = new Vapi(publicKey);
      vapiRef.current = vapi;

      vapi.on("call-start", () => setStatus("active"));
      vapi.on("call-end", () => { setStatus("idle"); setIsSpeaking(false); });
      vapi.on("speech-start", () => setIsSpeaking(true));
      vapi.on("speech-end", () => setIsSpeaking(false));
      vapi.on("message", (msg: any) => {
        if (msg.type === "transcript" && msg.transcript) setTranscript(msg.transcript);
      });
      vapi.on("error", (err: any) => {
        console.error("VAPI error:", err);
        setError(err?.message || "Voice call error");
        setStatus("error");
      });

      await vapi.start({
        name: "LENORY Voice Assistant",
        firstMessage: "Hello! I'm LENORY, your AI learning assistant. How can I help you today?",
        transcriber: { provider: "deepgram", model: "nova-2", language: "en" },
        voice: { provider: "playht", voiceId: "jennifer" },
        model: {
          provider: "openai",
          model: "gpt-3.5-turbo",
          messages: [{
            role: "system",
            content: `You are LENORY, an advanced AI tutor designed for Nigerian students preparing for JAMB, WAEC, and NECO exams. You help with all academic subjects. You are warm, encouraging, and adapt explanations to the student's level. Keep voice responses concise — 2-3 sentences unless asked to elaborate.`,
          }],
        },
      });
    } catch (err: any) {
      console.error("VAPI start error:", err);
      setError(err?.message || "Failed to start voice call");
      setStatus("error");
    }
  }, []);

  const stopCall = useCallback(() => {
    if (vapiRef.current) { vapiRef.current.stop(); vapiRef.current = null; }
    setStatus("idle");
    setIsSpeaking(false);
  }, []);

  const sendMessage = useCallback((text: string) => {
    if (vapiRef.current && status === "active") {
      vapiRef.current.send({ type: "add-message", message: { role: "user", content: text } });
    }
  }, [status]);

  useEffect(() => {
    return () => { if (vapiRef.current) vapiRef.current.stop(); };
  }, []);

  return { status, isSpeaking, transcript, startCall, stopCall, sendMessage, error };
}
