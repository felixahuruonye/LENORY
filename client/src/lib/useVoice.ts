import { useCallback, useRef, useEffect, useState } from "react";

// Gemini 2.0 voices (Multimodal Live API)
export const GEMINI_VOICES = [
  { id: "Aoede", name: "Aoede", description: "Bright & melodic", gender: "female", lang: "en-US" },
  { id: "Charon", name: "Charon", description: "Deep & authoritative", gender: "male", lang: "en-US" },
  { id: "Fenrir", name: "Fenrir", description: "Strong & commanding", gender: "male", lang: "en-US" },
  { id: "Kore", name: "Kore", description: "Warm & nurturing", gender: "female", lang: "en-US" },
  { id: "Puck", name: "Puck", description: "Playful & energetic", gender: "neutral", lang: "en-US" },
];

// Legacy browser TTS voices (fallback)
export const AVAILABLE_VOICES = GEMINI_VOICES;

const DEFAULT_VOICE = "Aoede";

// Text preprocessing function - removes formatting, keeps only text
function preprocessTextForSpeech(text: string): string {
  let processed = text;
  
  // Convert LENORY to lowercase so it's read as a word, not spelled
  processed = processed.replace(/LENORY/g, "learnory");
  
  // Remove markdown formatting
  processed = processed
    .replace(/\*\*(.+?)\*\*/g, "$1") // Remove **bold**
    .replace(/\*(.+?)\*/g, "$1") // Remove *italic*
    .replace(/```[\s\S]*?```/g, "") // Remove code blocks
    .replace(/`(.+?)`/g, "$1") // Remove inline code
    .replace(/#{1,6}\s+/g, "") // Remove heading markers
    .replace(/^\s*[-•*]\s+/gm, "") // Remove bullet points
    .replace(/^\s*\d+\.\s+/gm, "") // Remove numbered lists
    .replace(/\n\n+/g, " ") // Collapse multiple newlines to space
    .replace(/\[([^\]]+)\]\([^\)]+\)/g, "$1") // Remove markdown links [text](url) -> text
    .replace(/___/g, "") // Remove horizontal rules
    .replace(/--/g, "-") // Normalize dashes
    .replace(/~/g, "") // Remove strikethrough markers
    .replace(/\|/g, "") // Remove table pipes
    .replace(/[🎓😊👋🌟]/g, "") // Remove emojis
    .trim();
  
  // Remove extra whitespace
  processed = processed.replace(/\s+/g, " ").trim();
  
  return processed;
}

export function useVoice() {
  const [selectedVoice, setSelectedVoice] = useState(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("selectedVoice") || DEFAULT_VOICE;
    }
    return DEFAULT_VOICE;
  });
  const [isPlaying, setIsPlaying] = useState(false);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const synthRef = useRef<SpeechSynthesis | null>(null);

  // Initialize speech synthesis
  useEffect(() => {
    if (typeof window !== "undefined") {
      synthRef.current = window.speechSynthesis || (window as any).webkitSpeechSynthesis;
    }
  }, []);

  // Save voice preference to localStorage
  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem("selectedVoice", selectedVoice);
    }
  }, [selectedVoice]);

  const speak = useCallback(
    (text: string) => {
      if (!synthRef.current) return;

      const processedText = preprocessTextForSpeech(text);
      if (!processedText.trim()) {
        setIsPlaying(false);
        return;
      }

      // Cancel any ongoing speech
      synthRef.current.cancel();

      const utterance = new SpeechSynthesisUtterance(processedText);

      // Get voice info and set properties
      const voiceInfo = AVAILABLE_VOICES.find((v) => v.name === selectedVoice);
      utterance.lang = voiceInfo?.lang || "en-US";
      utterance.rate = 1;
      utterance.pitch = 1;
      utterance.volume = 1;

      // Try to match voice by name or language
      const allVoices = synthRef.current.getVoices();
      const matchedVoice = allVoices.find(
        (v: SpeechSynthesisVoice) =>
          v.name.toLowerCase().includes(selectedVoice.toLowerCase()) ||
          (v.lang === voiceInfo?.lang && v.name.length < 20)
      );
      
      if (matchedVoice) {
        utterance.voice = matchedVoice;
      }

      utterance.onstart = () => {
        setIsPlaying(true);
      };

      utterance.onend = () => {
        setIsPlaying(false);
      };

      utterance.onerror = (event) => {
        console.error("Speech error:", event.error);
        setIsPlaying(false);
      };

      utteranceRef.current = utterance;
      synthRef.current.speak(utterance);
    },
    [selectedVoice]
  );

  const stop = useCallback(() => {
    if (synthRef.current) {
      synthRef.current.cancel();
    }
    setIsPlaying(false);
  }, []);

  const toggleSpeak = useCallback(
    (text: string) => {
      if (isPlaying) {
        stop();
      } else {
        speak(text);
      }
    },
    [isPlaying, speak, stop]
  );

  return {
    speak,
    stop,
    toggleSpeak,
    isPlaying,
    selectedVoice,
    setSelectedVoice,
    isSpeechAvailable: true,
    availableVoices: AVAILABLE_VOICES,
  };
}
