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
  isSpeaking: boolean;
  hasGreeted: boolean;
  callDurationSeconds: number;
  status: "idle" | "connecting" | "active" | "error";
  start: (options?: any) => Promise<void>;
  stop: () => void;
  toggle: () => void;
  clearMessages: () => void;
  startCall: (options?: any) => Promise<void>;
  stopCall: () => void;
  send: (data: any) => void;
}

// Vapi SDK types (simplified)
interface VapiSDK {
  on(event: string, callback: (data: any) => void): void;
  start(options?: any): Promise<void>;
  stop(): void;
  send(data: any): void;
}

// ============================================================
// HOOK
// ============================================================

export function useVapi(options?: string | { publicKey?: string; onMessage?: (msg: VapiMessage) => void }): UseVapiReturn {
  const publicKey = typeof options === "string" ? options : options?.publicKey;
  const onMessageCallback = typeof options === "object" ? options?.onMessage : undefined;
  const [isCallActive, setIsCallActive] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  // Tracks whether the assistant has spoken at least once this call. Before
  // this existed, the UI showed "Listening..." the instant the call
  // connected — even while the assistant's first greeting was still being
  // synthesized — which made the connect delay look like a broken mic
  // instead of what it actually was (TTS still generating).
  const [hasGreeted, setHasGreeted] = useState(false);
  const [callDurationSeconds, setCallDurationSeconds] = useState(0);
  const durationIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [transcript, setTranscript] = useState("");
  const [messages, setMessages] = useState<VapiMessage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);

  const vapiRef = useRef<VapiSDK | null>(null);
  const onMessageRef = useRef<((msg: VapiMessage) => void) | null>(null);
  const lastEventAtRef = useRef<number>(Date.now());
  // The watchdog/offline-drop handlers below are registered once (their
  // effect only depends on `publicKey`), so they'd otherwise close over the
  // isCallActive/isConnecting values from that first render forever — refs
  // keep them reading the real current value instead of a stale one.
  const isCallActiveRef = useRef(false);
  const isConnectingRef = useRef(false);
  useEffect(() => { isCallActiveRef.current = isCallActive; }, [isCallActive]);
  useEffect(() => { isConnectingRef.current = isConnecting; }, [isConnecting]);
  useEffect(() => {
    onMessageRef.current = onMessageCallback || null;
  }, [onMessageCallback]);

  // ============================================================
  // START CALL
  // ============================================================
  const start = useCallback(
    async (options?: any) => {
      if (!vapiRef.current) {
        setError("Vapi not initialized. Call init first.");
        return;
      }
      try {
        setIsConnecting(true);
        lastEventAtRef.current = Date.now();
        await vapiRef.current.start(options);
        setIsCallActive(true);
        setError(null);
        apiRequest("POST", "/api/vapi/log-call", {}).catch(() => {});
      } catch (err: any) {
        setError(err.message || "Failed to start call");
        console.error("Vapi start error:", err);
      } finally {
        setIsConnecting(false);
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
        setCallDurationSeconds(0);
        setHasGreeted(false);
        lastEventAtRef.current = Date.now();
        if (durationIntervalRef.current) clearInterval(durationIntervalRef.current);
        durationIntervalRef.current = setInterval(() => setCallDurationSeconds((s) => s + 1), 1000);
      });

      // ─── EVENT: call-end ───────────────────────────────────
      vapi.on("call-end", () => {
        setIsCallActive(false);
        setIsSpeaking(false);
        setHasGreeted(false);
        setIsConnecting(false);
        if (durationIntervalRef.current) { clearInterval(durationIntervalRef.current); durationIntervalRef.current = null; }
      });

      // ─── EVENT: speech-start / speech-end (assistant is talking) ──
      vapi.on("speech-start", () => { setIsSpeaking(true); setHasGreeted(true); lastEventAtRef.current = Date.now(); });
      vapi.on("speech-end", () => { setIsSpeaking(false); lastEventAtRef.current = Date.now(); });

      // ─── EVENT: error ──────────────────────────────────────
      vapi.on("error", (err: any) => {
        // Previously this only set `error` and left isCallActive exactly
        // as it was. If the error came from a dead/dropped connection
        // (network drop, WebRTC failure) rather than a clean call-end, the
        // UI was left thinking a call might still be active while the
        // underlying connection was already gone — end/toggle actions on a
        // truly dead connection don't reliably fire call-end back, so the
        // app could get stuck needing a page refresh to recover. An error
        // now always resets to a clean, known state.
        setError(err.message || "Vapi error occurred");
        setIsCallActive(false);
        setIsSpeaking(false);
        setIsConnecting(false);
        if (durationIntervalRef.current) { clearInterval(durationIntervalRef.current); durationIntervalRef.current = null; }
        console.error("Vapi error:", err);
      });

      // ─── EVENT: message (FIXED) ────────────────────────────
      vapi.on("message", (msg: VapiMessage) => {
        lastEventAtRef.current = Date.now();
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

    // ─── WATCHDOG: detect a call that's silently dead ──────────
    // Previously nothing checked whether the connection was actually still
    // alive — if Vapi's SDK failed to fire call-end or error on a real
    // disconnect (which does happen on some network-drop scenarios), the
    // app was stuck believing a call was active forever, with a mic that
    // no longer did anything — exactly "freezes, need to refresh the
    // site". This doesn't try to reconnect (Vapi's SDK doesn't expose a
    // resume API) but it DOES reliably detect and clear a dead call so the
    // person can immediately start a new one instead of being stuck.
    const watchdog = setInterval(() => {
      if (isCallActiveRef.current && Date.now() - lastEventAtRef.current > 90_000) {
        console.warn("Vapi watchdog: no events for 90s on an active call — treating as disconnected");
        setError("Call disconnected (no response for a while) — please start a new call.");
        setIsCallActive(false);
        setIsSpeaking(false);
        if (durationIntervalRef.current) { clearInterval(durationIntervalRef.current); durationIntervalRef.current = null; }
        try { vapiRef.current?.stop(); } catch {}
      }
    }, 15_000);

    // ─── NETWORK DROP: end cleanly instead of leaving a dead call hanging ──
    const handleOffline = () => {
      if (isCallActiveRef.current || isConnectingRef.current) {
        console.warn("Network went offline during an active/connecting call");
        setError("Your network connection dropped — the call ended. Please reconnect once you're back online.");
        setIsCallActive(false);
        setIsConnecting(false);
        setIsSpeaking(false);
        if (durationIntervalRef.current) { clearInterval(durationIntervalRef.current); durationIntervalRef.current = null; }
        try { vapiRef.current?.stop(); } catch {}
      }
    };
    window.addEventListener("offline", handleOffline);

    // ─── CLEANUP ──────────────────────────────────────────────
    return () => {
      clearInterval(watchdog);
      window.removeEventListener("offline", handleOffline);
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
  // SEND — inject a message into the live call (used to hand the assistant
  // context from a file uploaded mid-call, without ending the call)
  // ============================================================
  const send = useCallback((data: any) => {
    if (vapiRef.current) {
      try { vapiRef.current.send(data); } catch (e) { console.error("Vapi send error:", e); }
    }
  }, []);

  // ============================================================
  // RETURN
  // ============================================================
  const status: "idle" | "connecting" | "active" | "error" = error ? "error" : isCallActive ? "active" : isConnecting ? "connecting" : "idle";

  return {
    isCallActive,
    transcript,
    messages,
    error,
    isInitialized,
    isSpeaking,
    hasGreeted,
    callDurationSeconds,
    status,
    start,
    stop,
    toggle,
    clearMessages,
    startCall: start,
    stopCall: stop,
    send,
  };
}
