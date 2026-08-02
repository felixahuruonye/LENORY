import { useEffect, useRef, useState, useCallback } from "react";
import Vapi from "@vapi-ai/web";
import { apiRequest } from "@/lib/queryClient";

// ============================================================
// TYPES
// ============================================================

export interface VapiMessage {
  role?: "user" | "assistant" | "system";
  content?: string;
  transcript?: string;
  transcriptText?: string;
  text?: string;
  transcriptType?: "final" | "interim";
  type?: string;
  output?: string | { content?: string; text?: string };
  conversation?: Array<{ role: string; content: string }>;
}

export interface UseVapiReturn {
  isCallActive: boolean;
  transcript: string;
  messages: VapiMessage[];
  error: string | null;
  isInitialized: boolean;
  start: (options?: { customData?: any }) => Promise<void>;
  stop: () => void;
  toggle: () => void;
  clearMessages: () => void;
}

// Vapi SDK types (simplified)
interface VapiSDK {
  on(event: string, callback: (data: any) => void): void;
  start(options?: { customData?: any }): Promise<void>;
  stop(): void;
  send(data: any): void;
}

// ============================================================
// HOOK
// ============================================================

export function useVapi(publicKey?: string): UseVapiReturn {
  const [isCallActive, setIsCallActive] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [messages, setMessages] = useState<VapiMessage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);

  const vapiRef = useRef<VapiSDK | null>(null);
  const onMessageRef = useRef<((msg: VapiMessage) => void) | null>(null);

  // ============================================================
  // START CALL
  // ============================================================
  const start = useCallback(
    async (options?: { customData?: any }) => {
      if (!vapiRef.current) {
        setError("Vapi not initialized. Call init first.");
        return;
      }
      try {
        await vapiRef.current.start(options);
        setIsCallActive(true);
        setError(null);
        apiRequest("POST", "/api/vapi/log-call", {}).catch(() => {});
      } catch (err: any) {
        setError(err.message || "Failed to start call");
        console.error("Vapi start error:", err);
      }
    },
    []
  );

  // ============================================================
  // STOP CALL
  // ============================================================
  const stop = useCallback(() => {
    if (vapiRef.current) {
      vapiRef.current.stop();
      setIsCallActive(false);
    }
  }, []);

  // ============================================================
  // TOGGLE
  // ============================================================
  const toggle = useCallback(() => {
    if (isCallActive) {
      stop();
    } else {
      start();
    }
  }, [isCallActive, start, stop]);

  // ============================================================
  // CLEAR MESSAGES
  // ============================================================
  const clearMessages = useCallback(() => {
    setMessages([]);
    setTranscript("");
  }, []);

  // ============================================================
  // INITIALIZE VAPI
  // ============================================================
  useEffect(() => {
    const key = publicKey || import.meta.env.VITE_VAPI_PUBLIC_KEY || "";

    if (!key) {
      setError("Vapi public key is missing. Please provide it.");
      return;
    }

    try {
      const vapi = new Vapi(key) as unknown as VapiSDK;
      vapiRef.current = vapi;
      setIsInitialized(true);
      setError(null);

      // ─── EVENT: call-start ─────────────────────────────────
      vapi.on("call-start", () => {
        setIsCallActive(true);
        setError(null);
        setTranscript("");
        setMessages([]);
      });

      // ─── EVENT: call-end ───────────────────────────────────
      vapi.on("call-end", () => {
        setIsCallActive(false);
      });

      // ─── EVENT: error ──────────────────────────────────────
      vapi.on("error", (err: any) => {
        setError(err.message || "Vapi error occurred");
        console.error("Vapi error:", err);
      });

      // ─── EVENT: message (FIXED) ────────────────────────────
      vapi.on("message", (msg: VapiMessage) => {
        // 1. Transcript handling
        const transcriptText = msg.transcript || msg.transcriptText || msg.text || "";
        const isFinal = msg.transcriptType === "final" || (msg.type === "transcript" && msg.role);
        const role = msg.role === "assistant" ? "assistant" : "user";

        if (transcriptText && transcriptText.trim()) {
          setTranscript(transcriptText);
          if (isFinal) {
            const newMsg: VapiMessage = { role, content: transcriptText.trim() };
            setMessages((prev) => [...prev, newMsg]);
            onMessageRef.current?.(newMsg);
          }
        }

        // 2. Model output (final assistant response)
        if (msg.type === "model-output" && msg.output) {
          const text =
            typeof msg.output === "string"
              ? msg.output
              : msg.output?.content || msg.output?.text || "";
          if (text.trim()) {
            const newMsg: VapiMessage = { role: "assistant", content: text.trim() };
            setMessages((prev) => [...prev, newMsg]);
            onMessageRef.current?.(newMsg);
          }
        }

        // 3. Conversation update (batched messages)
        if (msg.type === "conversation-update" && Array.isArray(msg.conversation)) {
          const lastMsg = msg.conversation[msg.conversation.length - 1];
          if (lastMsg && lastMsg.role === "assistant" && lastMsg.content?.trim()) {
            const newMsg: VapiMessage = { role: "assistant", content: lastMsg.content.trim() };
            setMessages((prev) => [...prev, newMsg]);
            onMessageRef.current?.(newMsg);
          }
        }
      });

      console.log("✅ Vapi initialized successfully");
    } catch (err: any) {
      setError(err.message || "Failed to initialize Vapi");
      console.error("Vapi init error:", err);
    }

    // ─── CLEANUP ──────────────────────────────────────────────
    return () => {
      if (vapiRef.current) {
        try {
          vapiRef.current.stop();
        } catch (_) {
          // Ignore stop errors on cleanup
        }
        vapiRef.current = null;
        setIsInitialized(false);
      }
    };
  }, [publicKey]);

  // ============================================================
  // RETURN
  // ============================================================
  return {
    isCallActive,
    transcript,
    messages,
    error,
    isInitialized,
    start,
    stop,
    toggle,
    clearMessages,
  };
}
