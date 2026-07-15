import { useState, useRef, useCallback, useEffect } from "react";
import { supabase } from "@/lib/supabase";

type VapiStatus = "idle" | "connecting" | "active" | "error";

interface UseVapiReturn {
  status: VapiStatus;
  isSpeaking: boolean;
  transcript: string;
  callDurationSeconds: number;
  startCall: (chatContext?: { role: string; content: string }[]) => Promise<void>;
  stopCall: () => void;
  sendMessage: (text: string) => void;
  error: string | null;
}

export function useVapi(): UseVapiReturn {
  const [status, setStatus] = useState<VapiStatus>("idle");
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [callDurationSeconds, setCallDurationSeconds] = useState(0);
  const vapiRef = useRef<any>(null);
  const callStartTimeRef = useRef<number | null>(null);
  const durationIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const startDurationTimer = () => {
    callStartTimeRef.current = Date.now();
    durationIntervalRef.current = setInterval(() => {
      if (callStartTimeRef.current) {
        setCallDurationSeconds(Math.floor((Date.now() - callStartTimeRef.current) / 1000));
      }
    }, 1000);
  };

  const stopDurationTimer = () => {
    if (durationIntervalRef.current) {
      clearInterval(durationIntervalRef.current);
      durationIntervalRef.current = null;
    }
  };

  const reportCallEndToServer = async (durationSecs: number) => {
    if (durationSecs <= 0) return;
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token || "";
      await fetch("/api/voice/end-call", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ durationSeconds: durationSecs }),
      });
    } catch (err) {
      console.warn("Could not report voice call credits:", err);
    }
  };

  const startCall = useCallback(async (chatContext?: { role: string; content: string }[]) => {
    try {
      setStatus("connecting");
      setError(null);
      setCallDurationSeconds(0);

      // Check microphone permission first
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach((t) => t.stop());
      } catch {
        throw new Error("Microphone access denied. Please allow microphone access and try again.");
      }

      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token || "";

      const res = await fetch("/api/vapi-config", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Voice service not configured. Please contact support.");
      const { publicKey } = await res.json();
      if (!publicKey) throw new Error("Voice public key missing.");

      const { default: Vapi } = await import("@vapi-ai/web");
      const vapi = new Vapi(publicKey);
      vapiRef.current = vapi;

      // Build context from previous chat messages (last 6 to stay within token limits)
      const contextMessages = chatContext?.slice(-6).map((m) => ({
        role: m.role as "user" | "assistant" | "system",
        content: m.content,
      })) || [];

      const systemPrompt = `You are LENORY — a powerful AI assistant built in Nigeria by Alaoma Obinna Felix. You are warm, direct, and genuinely helpful. You understand Nigerian culture, language and context.

You can help with: coding, research, writing, mathematics, science, cybersecurity, Nigerian exams (JAMB, WAEC, NECO), creative tasks, and much more.

For voice responses: keep answers concise (2-3 sentences) unless asked to elaborate. Speak naturally, not like a reading machine.

${chatContext && chatContext.length > 0 ? `\nThis conversation has context from the user's existing chat. Continue naturally from where we left off.` : ""}`;

      vapi.on("call-start", () => {
        setStatus("active");
        startDurationTimer();
      });

      vapi.on("call-end", async () => {
        stopDurationTimer();
        const duration = callStartTimeRef.current
          ? Math.floor((Date.now() - callStartTimeRef.current) / 1000)
          : 0;
        await reportCallEndToServer(duration);
        setStatus("idle");
        setIsSpeaking(false);
        callStartTimeRef.current = null;
      });

      vapi.on("speech-start", () => setIsSpeaking(true));
      vapi.on("speech-end", () => setIsSpeaking(false));

      vapi.on("message", (msg: any) => {
        if (msg.type === "transcript" && msg.transcript) {
          setTranscript(msg.transcript);
        }
      });

      vapi.on("error", (err: any) => {
        const msg = err?.message || err?.error || String(err);
        console.error("VAPI error:", msg);
        // Friendly messages for common errors
        if (msg.includes("Meeting has ended") || msg.includes("call has ended")) {
          setStatus("idle");
        } else {
          setError(
            msg.includes("playht") || msg.includes("voice")
              ? "Voice provider error. The call will still work with default voice."
              : msg || "Voice call error"
          );
          setStatus("error");
        }
        stopDurationTimer();
      });

      await vapi.start({
        name: "LENORY Voice AI",
        firstMessage: "Hello! I'm LENORY, your AI assistant. How can I help you?",
        transcriber: {
          provider: "deepgram",
          model: "nova-2",
          language: "en",
        },
        voice: {
          provider: "openai",
          voiceId: "alloy",
        },
        model: {
          provider: "openai",
          model: "gpt-3.5-turbo",
          messages: [
            { role: "system", content: systemPrompt },
            ...contextMessages,
          ],
        },
      });
    } catch (err: any) {
      console.error("VAPI start error:", err);
      setError(err?.message || "Failed to start voice call");
      setStatus("error");
      stopDurationTimer();
    }
  }, []);

  const stopCall = useCallback(async () => {
    stopDurationTimer();
    const duration = callStartTimeRef.current
      ? Math.floor((Date.now() - callStartTimeRef.current) / 1000)
      : 0;
    if (vapiRef.current) {
      vapiRef.current.stop();
      vapiRef.current = null;
    }
    if (duration > 0) {
      await reportCallEndToServer(duration);
    }
    callStartTimeRef.current = null;
    setStatus("idle");
    setIsSpeaking(false);
    setCallDurationSeconds(0);
  }, []);

  const sendMessage = useCallback((text: string) => {
    if (vapiRef.current && status === "active") {
      vapiRef.current.send({ type: "add-message", message: { role: "user", content: text } });
    }
  }, [status]);

  useEffect(() => {
    return () => {
      stopDurationTimer();
      if (vapiRef.current) vapiRef.current.stop();
    };
  }, []);

  return { status, isSpeaking, transcript, callDurationSeconds, startCall, stopCall, sendMessage, error };
}
