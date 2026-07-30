// client/src/hooks/useChatStream.ts
import { useState, useCallback, useRef } from "react";

interface StreamEvent {
  type: "status" | "token" | "done" | "error";
  status?: "thinking" | "searching" | "writing" | "almost_done" | "done";
  token?: string;
  message?: string;
  estimatedTimeRemaining?: number; // in seconds
}

interface UseChatStreamOptions {
  onToken?: (token: string) => void;
  onStatus?: (status: string, estimatedTime?: number) => void;
  onDone?: (fullResponse: string) => void;
  onError?: (error: string) => void;
}

export function useChatStream(options: UseChatStreamOptions = {}) {
  const [isStreaming, setIsStreaming] = useState(false);
  const [fullResponse, setFullResponse] = useState("");
  const [currentStatus, setCurrentStatus] = useState<string>("");
  const [estimatedTime, setEstimatedTime] = useState<number | undefined>(undefined);
  const abortControllerRef = useRef<AbortController | null>(null);

  const sendMessage = useCallback(
    async (
      content: string,
      sessionId?: string,
      extraContext?: string,
      isAdvanced?: boolean
    ) => {
      // Abort any existing stream
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }

      const controller = new AbortController();
      abortControllerRef.current = controller;

      setIsStreaming(true);
      setFullResponse("");
      setCurrentStatus("thinking");
      setEstimatedTime(undefined);

      if (options.onStatus) {
        options.onStatus("thinking", 5);
      }

      try {
        const response = await fetch("/api/chat/stream", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            content,
            sessionId,
            context: extraContext,
            isAdvanced,
            stream: true,
          }),
          signal: controller.signal,
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.message || `HTTP ${response.status}`);
        }

        const reader = response.body?.getReader();
        if (!reader) throw new Error("No response body");

        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          // Process complete lines
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (line.startsWith("data: ")) {
              try {
                const event: StreamEvent = JSON.parse(line.slice(6));
                handleEvent(event);
              } catch (parseErr) {
                // Skip malformed JSON
                console.warn("Failed to parse SSE event:", line);
              }
            }
          }
        }

        // Process any remaining buffer
        if (buffer.startsWith("data: ")) {
          try {
            const event: StreamEvent = JSON.parse(buffer.slice(6));
            handleEvent(event);
          } catch (parseErr) {
            // Skip malformed JSON
          }
        }

        setIsStreaming(false);
      } catch (error: any) {
        if (error.name === "AbortError") {
          console.log("Stream aborted");
        } else {
          console.error("Stream error:", error);
          if (options.onError) {
            options.onError(error.message || "Stream failed");
          }
        }
        setIsStreaming(false);
      }
    },
    [options]
  );

  const handleEvent = (event: StreamEvent) => {
    switch (event.type) {
      case "status":
        setCurrentStatus(event.status || "");
        setEstimatedTime(event.estimatedTimeRemaining);
        if (options.onStatus) {
          options.onStatus(event.status || "", event.estimatedTimeRemaining);
        }
        break;

      case "token":
        if (event.token) {
          setFullResponse((prev) => prev + event.token);
          if (options.onToken) {
            options.onToken(event.token);
          }
        }
        break;

      case "done":
        setIsStreaming(false);
        setCurrentStatus("done");
        if (options.onDone) {
          options.onDone(event.message || fullResponse);
        }
        break;

      case "error":
        setIsStreaming(false);
        if (options.onError) {
          options.onError(event.message || "Unknown error");
        }
        break;
    }
  };

  const abort = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
      setIsStreaming(false);
    }
  }, []);

  return {
    isStreaming,
    fullResponse,
    currentStatus,
    estimatedTime,
    sendMessage,
    abort,
  };
}
