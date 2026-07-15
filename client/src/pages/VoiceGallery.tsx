import { useState, useRef } from "react";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Link } from "wouter";
import {
  ArrowLeft,
  Play,
  Square,
  Check,
  Loader2,
  Volume2,
  Star,
  Globe,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

interface Voice {
  id: string;
  name: string;
  description: string;
  accent: string;
  language: string;
  sample: string;
  category: "nigerian" | "international";
  speaker: string;
}

const VOICES: Voice[] = [
  // Nigerian voices (YarnGPT)
  { id: "idera", name: "Idera", description: "Warm Nigerian female, clear diction", accent: "Nigerian English", language: "en-NG", sample: "Hello! I am LENORY, your AI learning assistant. I am here to help you excel in your studies.", category: "nigerian", speaker: "idera" },
  { id: "temi", name: "Temi", description: "Friendly Lagos female voice", accent: "Nigerian English", language: "en-NG", sample: "Welcome back! Ready to learn something new today? Let me help you understand this topic.", category: "nigerian", speaker: "temi" },
  { id: "jide", name: "Jide", description: "Professional Nigerian male", accent: "Nigerian English", language: "en-NG", sample: "Good day! I am your LENORY assistant. Tell me what you need help with today.", category: "nigerian", speaker: "jide" },
  { id: "chidi", name: "Chidi", description: "Deep, authoritative Nigerian male", accent: "Nigerian English", language: "en-NG", sample: "Alright, let us get started. I will walk you through this concept step by step.", category: "nigerian", speaker: "chidi" },
  { id: "yoruba_female", name: "Adunola", description: "Yoruba-accented English female", accent: "Yoruba English", language: "yo", sample: "Bawo ni! LENORY niyi, mo wa lati ran yin lowo pelu eko yin.", category: "nigerian", speaker: "yoruba_female" },
  { id: "yoruba_male", name: "Biodun", description: "Yoruba-accented English male", accent: "Yoruba English", language: "yo", sample: "E kaaro! Emi LENORY ni. Jeki n gba yin lowo pelu eko yin loni.", category: "nigerian", speaker: "yoruba_male" },
  { id: "igbo_female", name: "Chioma", description: "Igbo-accented English female", accent: "Igbo English", language: "ig", sample: "Nnoo! Abu m LENORY. Anọ m ebe a inyere gị aka na mmụta gị.", category: "nigerian", speaker: "igbo_female" },
  { id: "igbo_male", name: "Emeka", description: "Igbo-accented English male", accent: "Igbo English", language: "ig", sample: "Good morning! I am LENORY. Let me help you with your studies today.", category: "nigerian", speaker: "igbo_male" },
  { id: "hausa_male", name: "Ibrahim", description: "Hausa-accented English male", accent: "Hausa English", language: "ha", sample: "Sannu! Ni ne LENORY. Zan taimake ku da karatunku yau.", category: "nigerian", speaker: "hausa_male" },
  { id: "hausa_female", name: "Fatima", description: "Hausa-accented English female", accent: "Hausa English", language: "ha", sample: "Barka da zuwa! Ni LENORY ce. Na zo taimakon karatunki.", category: "nigerian", speaker: "hausa_female" },
  { id: "pidgin", name: "Bola", description: "Nigerian Pidgin English voice", accent: "Naija Pidgin", language: "pcm", sample: "How far! Na me be LENORY. I dey here to help you with your school work, no worry.", category: "nigerian", speaker: "pidgin" },

  // International voices (OpenAI via VAPI)
  { id: "alloy", name: "Alloy", description: "Neutral, balanced AI voice", accent: "American English", language: "en-US", sample: "Hello! I'm LENORY, your AI learning assistant. How can I help you today?", category: "international", speaker: "alloy" },
  { id: "echo", name: "Echo", description: "Clear, articulate male voice", accent: "American English", language: "en-US", sample: "Good day! I'm LENORY. Let's explore this topic together and make learning easy.", category: "international", speaker: "echo" },
  { id: "nova", name: "Nova", description: "Warm, expressive female voice", accent: "American English", language: "en-US", sample: "Hi there! I'm LENORY. I'm excited to help you learn something new today!", category: "international", speaker: "nova" },
];

const DEFAULT_VOICE_KEY = "lenory_default_voice";

export default function VoiceGallery() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [defaultVoice, setDefaultVoice] = useState<string>(
    () => localStorage.getItem(DEFAULT_VOICE_KEY) || "idera"
  );
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const stopCurrentAudio = () => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = "";
      audioRef.current = null;
    }
    setPlayingId(null);
  };

  const playVoice = async (voice: Voice) => {
    if (playingId === voice.id) {
      stopCurrentAudio();
      return;
    }
    stopCurrentAudio();
    setLoadingId(voice.id);

    try {
      if (voice.category === "nigerian") {
        // Use YarnGPT backend proxy
        const res = await apiRequest("POST", "/api/tts/yarngpt", {
          text: voice.sample,
          speaker: voice.speaker,
        });
        const data = await res.json();

        let src = "";
        if (data.audioUrl) {
          src = data.audioUrl;
        } else if (data.audioBase64) {
          src = `data:${data.mimeType || "audio/wav"};base64,${data.audioBase64}`;
        } else {
          throw new Error("No audio data returned");
        }

        const audio = new Audio(src);
        audioRef.current = audio;
        setPlayingId(voice.id);
        setLoadingId(null);
        audio.onended = () => setPlayingId(null);
        audio.onerror = () => { setPlayingId(null); toast({ title: "Preview failed", description: "Could not play this voice sample", variant: "destructive" }); };
        await audio.play();
      } else {
        // International voices: use browser TTS as preview
        if ("speechSynthesis" in window) {
          window.speechSynthesis.cancel();
          const utterance = new SpeechSynthesisUtterance(voice.sample);
          utterance.lang = voice.language;
          utterance.rate = 0.95;
          utterance.onend = () => setPlayingId(null);
          setPlayingId(voice.id);
          setLoadingId(null);
          window.speechSynthesis.speak(utterance);
        } else {
          throw new Error("Browser TTS not available");
        }
      }
    } catch (err: any) {
      setLoadingId(null);
      setPlayingId(null);
      toast({ title: "Preview unavailable", description: err?.message || "Could not preview this voice", variant: "destructive" });
    }
  };

  const setAsDefault = (voice: Voice) => {
    localStorage.setItem(DEFAULT_VOICE_KEY, voice.id);
    setDefaultVoice(voice.id);
    toast({ title: "Default voice set", description: `${voice.name} will be used for your LENORY voice sessions.` });
  };

  const nigerianVoices = VOICES.filter((v) => v.category === "nigerian");
  const intlVoices = VOICES.filter((v) => v.category === "international");

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-primary/5">
      <header className="sticky top-0 z-50 backdrop-blur-xl bg-background/80 border-b border-primary/10">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-4">
              <Button variant="ghost" size="icon" asChild>
                <Link href="/settings"><ArrowLeft className="h-5 w-5" /></Link>
              </Button>
              <div>
                <h1 className="text-xl font-bold">LENORY Voice Gallery</h1>
                <p className="text-xs text-muted-foreground">Choose your AI voice</p>
              </div>
            </div>
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
        {/* Nigerian Voices */}
        <section>
          <div className="flex items-center gap-3 mb-4">
            <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center">
              <span className="text-base">🇳🇬</span>
            </div>
            <div>
              <h2 className="font-bold text-lg">Nigerian Voices</h2>
              <p className="text-sm text-muted-foreground">Authentic Nigerian accents — English, Yoruba, Igbo, Hausa, Pidgin</p>
            </div>
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            {nigerianVoices.map((voice) => (
              <VoiceCard
                key={voice.id}
                voice={voice}
                isPlaying={playingId === voice.id}
                isLoading={loadingId === voice.id}
                isDefault={defaultVoice === voice.id}
                onPlay={() => playVoice(voice)}
                onSetDefault={() => setAsDefault(voice)}
              />
            ))}
          </div>
        </section>

        {/* International Voices */}
        <section>
          <div className="flex items-center gap-3 mb-4">
            <div className="h-8 w-8 rounded-full bg-chart-2/10 flex items-center justify-center">
              <Globe className="h-4 w-4 text-chart-2" />
            </div>
            <div>
              <h2 className="font-bold text-lg">International Voices</h2>
              <p className="text-sm text-muted-foreground">Clear, neutral voices for live sessions</p>
            </div>
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            {intlVoices.map((voice) => (
              <VoiceCard
                key={voice.id}
                voice={voice}
                isPlaying={playingId === voice.id}
                isLoading={loadingId === voice.id}
                isDefault={defaultVoice === voice.id}
                onPlay={() => playVoice(voice)}
                onSetDefault={() => setAsDefault(voice)}
              />
            ))}
          </div>
        </section>

        <p className="text-xs text-muted-foreground text-center pb-4">
          Your chosen voice is used in Live Voice Sessions. Nigerian voices are processed through our secure AI voice server.
        </p>
      </main>
    </div>
  );
}

function VoiceCard({
  voice,
  isPlaying,
  isLoading,
  isDefault,
  onPlay,
  onSetDefault,
}: {
  voice: Voice;
  isPlaying: boolean;
  isLoading: boolean;
  isDefault: boolean;
  onPlay: () => void;
  onSetDefault: () => void;
}) {
  return (
    <Card className={`transition-all ${isDefault ? "border-primary/50 bg-primary/5" : ""}`} data-testid={`card-voice-${voice.id}`}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold">{voice.name}</span>
              {isDefault && (
                <Badge variant="outline" className="text-xs border-primary/40 text-primary gap-1">
                  <Star className="h-2.5 w-2.5" />
                  Default
                </Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">{voice.description}</p>
            <Badge variant="secondary" className="text-xs mt-1.5">{voice.accent}</Badge>
          </div>
          <div className="flex flex-col gap-1.5 flex-shrink-0">
            <Button
              size="sm"
              variant={isPlaying ? "default" : "outline"}
              onClick={onPlay}
              disabled={isLoading}
              className="h-8 px-3 gap-1.5"
              data-testid={`button-play-${voice.id}`}
            >
              {isLoading ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : isPlaying ? (
                <><Square className="h-3 w-3" />Stop</>
              ) : (
                <><Play className="h-3 w-3" />Preview</>
              )}
            </Button>
            {!isDefault && (
              <Button
                size="sm"
                variant="ghost"
                onClick={onSetDefault}
                className="h-8 px-3 gap-1.5 text-xs"
                data-testid={`button-set-default-${voice.id}`}
              >
                <Check className="h-3 w-3" />
                Use Voice
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
