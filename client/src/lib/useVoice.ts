import { useCallback, useRef, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

export const GEMINI_VOICES = [
  { id: "Aoede", name: "Aoede", description: "Bright & melodic", gender: "female", lang: "en-US" },
  { id: "Charon", name: "Charon", description: "Deep & authoritative", gender: "male", lang: "en-US" },
  { id: "Fenrir", name: "Fenrir", description: "Strong & commanding", gender: "male", lang: "en-US" },
  { id: "Kore", name: "Kore", description: "Warm & nurturing", gender: "female", lang: "en-US" },
  { id: "Puck", name: "Puck", description: "Playful & energetic", gender: "neutral", lang: "en-US" },
];

export const AVAILABLE_VOICES = GEMINI_VOICES;

const DEFAULT_VOICE = "Aoede";

// Nigerian YarnGPT speaker IDs — routed through our TTS proxy, not browser speech
const YARNGPT_SPEAKERS = new Set([
  "idera", "temi", "jide", "chidi",
  "yoruba_female", "yoruba_male",
  "igbo_female", "igbo_male",
  "hausa_male", "hausa_female",
  "pidgin",
]);

function preprocessTextForSpeech(text: string): string {
  let processed = text;
  processed = processed.replace(/LENORY/g, "learnory");
  processed = processed
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`(.+?)`/g, "$1")
    .replace(/#{1,6}\s+/g, "")
    .replace(/^\s*[-•*]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    .replace(/\n\n+/g, " ")
    .replace(/\[([^\]]+)\]\([^\)]+\)/g, "$1")
    .replace(/___/g, "")
    .replace(/--/g, "-")
    .replace(/~/g, "")
    .replace(/\|/g, "")
    .replace(/[🎓😊👋🌟]/g, "")
    .trim();
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
  const yarngptAudioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (typeof window !== "undefined") {
      synthRef.current = window.speechSynthesis || (window as any).webkitSpeechSynthesis;
    }
  }, []);

  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem("selectedVoice", selectedVoice);
    }
  }, [selectedVoice]);

  // Browser SpeechSynthesis fallback
  const browserSpeak = useCallback((processedText: string, voiceName: string) => {
    if (!synthRef.current) return;
    synthRef.current.cancel();
    const utterance = new SpeechSynthesisUtterance(processedText);
    const voiceInfo = AVAILABLE_VOICES.find((v) => v.name === voiceName);
    utterance.lang = voiceInfo?.lang || "en-US";
    utterance.rate = 1;
    utterance.pitch = 1;
    utterance.volume = 1;
    const allVoices = synthRef.current.getVoices();
    const matchedVoice = allVoices.find(
      (v: SpeechSynthesisVoice) =>
        v.name.toLowerCase().includes(voiceName.toLowerCase()) ||
        (v.lang === utterance.lang && v.name.length < 20)
    );
    if (matchedVoice) utterance.voice = matchedVoice;
    utterance.onstart = () => setIsPlaying(true);
    utterance.onend = () => setIsPlaying(false);
    utterance.onerror = () => setIsPlaying(false);
    utteranceRef.current = utterance;
    synthRef.current.speak(utterance);
  }, []);

  const speak = useCallback(
    async (text: string) => {
      const processedText = preprocessTextForSpeech(text);
      if (!processedText.trim()) { setIsPlaying(false); return; }

      // User's Voice Gallery choice overrides the Settings dropdown selection
      const preferredVoice = (typeof window !== "undefined" && localStorage.getItem("lenory_default_voice")) || selectedVoice;

      // Nigerian YarnGPT voices go through our TTS API proxy
      if (YARNGPT_SPEAKERS.has(preferredVoice)) {
        try {
          // Stop any existing audio
          if (yarngptAudioRef.current) {
            yarngptAudioRef.current.pause();
            yarngptAudioRef.current = null;
          }
          if (synthRef.current) synthRef.current.cancel();
          setIsPlaying(true);

          const { data: { session } } = await supabase.auth.getSession();
          const token = session?.access_token || "";

          const resp = await fetch("/api/tts/yarngpt", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
            body: JSON.stringify({ text: processedText.slice(0, 500), speaker: preferredVoice }),
          });

          if (!resp.ok) throw new Error("YarnGPT TTS failed");
          const data = await resp.json();
          const audioUrl = data.audioUrl || data.url || data.audio;

          if (audioUrl) {
            const audio = new Audio(audioUrl);
            yarngptAudioRef.current = audio;
            audio.onended = () => { setIsPlaying(false); yarngptAudioRef.current = null; };
            audio.onerror = () => { setIsPlaying(false); yarngptAudioRef.current = null; };
            audio.play();
          } else {
            setIsPlaying(false);
          }
        } catch (err) {
          console.warn("YarnGPT TTS error, falling back to browser speech:", err);
          setIsPlaying(false);
          browserSpeak(processedText, selectedVoice);
        }
        return;
      }

      // Gemini / international voices — browser SpeechSynthesis
      browserSpeak(processedText, preferredVoice);
    },
    [selectedVoice, browserSpeak]
  );

  const stop = useCallback(() => {
    if (synthRef.current) synthRef.current.cancel();
    if (yarngptAudioRef.current) {
      yarngptAudioRef.current.pause();
      yarngptAudioRef.current = null;
    }
    setIsPlaying(false);
  }, []);

  const toggleSpeak = useCallback(
    (text: string) => {
      if (isPlaying) { stop(); }
      else { speak(text); }
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
