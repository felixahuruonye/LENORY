import { useCallback, useRef, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

export const OPENAI_VOICES = [
  { id: "alloy", name: "Alloy", description: "Neutral, balanced", gender: "neutral", lang: "en-US" },
  { id: "echo", name: "Echo", description: "Clear, articulate male", gender: "male", lang: "en-US" },
  { id: "fable", name: "Fable", description: "Expressive, warm", gender: "neutral", lang: "en-US" },
  { id: "onyx", name: "Onyx", description: "Deep, authoritative male", gender: "male", lang: "en-US" },
  { id: "nova", name: "Nova", description: "Warm, expressive female", gender: "female", lang: "en-US" },
  { id: "shimmer", name: "Shimmer", description: "Bright, energetic female", gender: "female", lang: "en-US" },
];

// These are the real 16 voice IDs YarnGPT's API actually accepts
export const NIGERIAN_VOICES = [
  { id: "Idera", name: "Idera", description: "Melodic, gentle", gender: "female", lang: "en-NG", nigerian: true },
  { id: "Emma", name: "Emma", description: "Authoritative, deep", gender: "female", lang: "en-NG", nigerian: true },
  { id: "Zainab", name: "Zainab", description: "Soothing, gentle", gender: "female", lang: "en-NG", nigerian: true },
  { id: "Osagie", name: "Osagie", description: "Smooth, calm", gender: "male", lang: "en-NG", nigerian: true },
  { id: "Wura", name: "Wura", description: "Young, sweet", gender: "female", lang: "en-NG", nigerian: true },
  { id: "Jude", name: "Jude", description: "Warm, confident", gender: "male", lang: "en-NG", nigerian: true },
  { id: "Chinenye", name: "Chinenye", description: "Engaging, warm", gender: "female", lang: "en-NG", nigerian: true },
  { id: "Tayo", name: "Tayo", description: "Upbeat, energetic", gender: "male", lang: "en-NG", nigerian: true },
  { id: "Regina", name: "Regina", description: "Mature, warm", gender: "female", lang: "en-NG", nigerian: true },
  { id: "Femi", name: "Femi", description: "Rich, reassuring", gender: "male", lang: "en-NG", nigerian: true },
  { id: "Adaora", name: "Adaora", description: "Warm, engaging", gender: "female", lang: "en-NG", nigerian: true },
  { id: "Umar", name: "Umar", description: "Calm, smooth", gender: "male", lang: "en-NG", nigerian: true },
  { id: "Mary", name: "Mary", description: "Energetic, youthful", gender: "female", lang: "en-NG", nigerian: true },
  { id: "Nonso", name: "Nonso", description: "Bold, resonant", gender: "male", lang: "en-NG", nigerian: true },
  { id: "Remi", name: "Remi", description: "Melodious, warm", gender: "female", lang: "en-NG", nigerian: true },
  { id: "Adam", name: "Adam", description: "Deep, clear", gender: "male", lang: "en-NG", nigerian: true },
];

export const AVAILABLE_VOICES = [...NIGERIAN_VOICES, ...OPENAI_VOICES];

const DEFAULT_VOICE = "Idera";

// Nigerian voices go through the real YarnGPT API; everything else uses real OpenAI TTS
const YARNGPT_SPEAKERS = new Set(NIGERIAN_VOICES.map((v) => v.id));

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

// VAPI only supports specific voice providers natively (OpenAI, ElevenLabs, etc.) —
// it cannot use YarnGPT directly. If the user picked a Nigerian voice for
// previews/read-aloud, map it to the closest OpenAI voice by gender for live
// calls; otherwise use their exact OpenAI voice pick. Keeps one consistent
// "default voice" across Voice Gallery, read-aloud, and both Live AI surfaces.
export function getVapiVoiceForCall(): { provider: "openai"; voiceId: string } {
  if (typeof window === "undefined") return { provider: "openai", voiceId: "nova" };
  const preferred = localStorage.getItem("lenory_default_voice") || "Idera";
  const nigerian = NIGERIAN_VOICES.find((v) => v.id === preferred);
  if (nigerian) return { provider: "openai", voiceId: nigerian.gender === "male" ? "onyx" : "nova" };
  const openai = OPENAI_VOICES.find((v) => v.id === preferred);
  return { provider: "openai", voiceId: openai?.id || "nova" };
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
    const voiceInfo = AVAILABLE_VOICES.find((v) => v.name === voiceName || v.id === voiceName);
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
          const audioSrc = data.audioUrl || data.url || data.audio || (data.audioBase64 ? `data:${data.mimeType || "audio/wav"};base64,${data.audioBase64}` : null);

          if (audioSrc) {
            const audio = new Audio(audioSrc);
            yarngptAudioRef.current = audio;
            audio.onended = () => { setIsPlaying(false); yarngptAudioRef.current = null; };
            audio.onerror = () => { setIsPlaying(false); yarngptAudioRef.current = null; };
            await audio.play();
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

      // International voices — real OpenAI TTS, browser speech only as a last-resort fallback
      try {
        if (yarngptAudioRef.current) { yarngptAudioRef.current.pause(); yarngptAudioRef.current = null; }
        if (synthRef.current) synthRef.current.cancel();
        setIsPlaying(true);

        const { data: { session } } = await supabase.auth.getSession();
        const token = session?.access_token || "";

        const resp = await fetch("/api/tts/openai", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ text: processedText.slice(0, 2000), voice: preferredVoice }),
        });

        if (!resp.ok) throw new Error("OpenAI TTS failed");
        const data = await resp.json();
        if (!data.audioBase64) throw new Error("No audio data returned");

        const audio = new Audio(`data:${data.mimeType || "audio/mpeg"};base64,${data.audioBase64}`);
        yarngptAudioRef.current = audio;
        audio.onended = () => { setIsPlaying(false); yarngptAudioRef.current = null; };
        audio.onerror = () => { setIsPlaying(false); yarngptAudioRef.current = null; };
        await audio.play();
      } catch (err) {
        console.warn("OpenAI TTS error, falling back to browser speech:", err);
        setIsPlaying(false);
        browserSpeak(processedText, preferredVoice);
      }
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
