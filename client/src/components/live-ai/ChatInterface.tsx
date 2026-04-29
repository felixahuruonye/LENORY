import { useRef, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Send, Copy, Volume2 } from "lucide-react";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
}

interface ChatInterfaceProps {
  messages: Message[];
  isLoading: boolean;
  onSendMessage: (content: string) => Promise<void>;
  onClearChat: () => void;
  onExportChat: () => void;
  onReplayVoice?: (content: string) => void;
}

export function ChatInterface({
  messages,
  isLoading,
  onSendMessage,
  onClearChat,
  onExportChat,
  onReplayVoice,
}: ChatInterfaceProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto scroll to bottom
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  return (
    <Card className="flex flex-col h-full bg-slate-800 border-slate-700">
      {/* Header */}
      <div className="p-4 border-b border-slate-700 flex items-center justify-between">
        <h2 className="font-bold text-white">Chat with LENORY</h2>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={onExportChat}
            data-testid="button-export-chat"
          >
            Export
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={onClearChat}
            data-testid="button-clear-chat"
          >
            Clear
          </Button>
        </div>
      </div>

      {/* Messages */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto p-4 space-y-3"
        data-testid="messages-container"
      >
        {messages.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-slate-400 text-center">
              Start a conversation with LENORY AI. Ask any question!
            </p>
          </div>
        ) : (
          messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
              data-testid={`message-${msg.id}`}
            >
              <div
                className={`max-w-xs px-4 py-2 rounded-lg ${
                  msg.role === "user"
                    ? "bg-purple-600 text-white"
                    : "bg-slate-700 text-slate-100"
                }`}
              >
                <p className="text-sm">{msg.content}</p>
                <div className="flex items-center gap-2 mt-1 text-xs opacity-50">
                  <span>
                    {new Date(msg.timestamp).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                  {msg.role === "assistant" && (
                    <Button
                      size="icon"
                      variant="ghost"
                      className="w-4 h-4"
                      onClick={() => copyToClipboard(msg.content)}
                      data-testid={`button-copy-${msg.id}`}
                    >
                      <Copy className="w-3 h-3" />
                    </Button>
                  )}
                  {msg.role === "assistant" && onReplayVoice && (
                    <Button
                      size="icon"
                      variant="ghost"
                      className="w-4 h-4"
                      onClick={() => onReplayVoice(msg.content)}
                      data-testid={`button-voice-${msg.id}`}
                    >
                      <Volume2 className="w-3 h-3" />
                    </Button>
                  )}
                </div>
              </div>
            </div>
          ))
        )}
      </div>

    </Card>
  );
}
