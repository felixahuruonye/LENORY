import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { X, Sparkles , Circle } from "lucide-react";

interface VoiceSettingsProps {
  onClose: () => void;
  voice: string;
  speed: number;
  language: string;
  tone: string;
  onVoiceChange: (voice: string) => void;
  onSpeedChange: (speed: number) => void;
  onLanguageChange: (language: string) => void;
  onToneChange: (tone: string) => void;
}

const GEMINI_VOICES = [
  { id: "Aoede", name: "Aoede", description: "Bright & melodic", gender: "female" },
  { id: "Charon", name: "Charon", description: "Deep & authoritative", gender: "male" },
  { id: "Fenrir", name: "Fenrir", description: "Strong & commanding", gender: "male" },
  { id: "Kore", name: "Kore", description: "Warm & nurturing", gender: "female" },
  { id: "Puck", name: "Puck", description: "Playful & energetic", gender: "neutral" },
];

export function VoiceSettings({
  onClose,
  voice,
  speed,
  language,
  tone,
  onVoiceChange,
  onSpeedChange,
  onLanguageChange,
  onToneChange,
}: VoiceSettingsProps) {
  return (
    <Card className="p-4 bg-slate-800 border-slate-700">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <h3 className="font-bold text-white">Voice Settings</h3>
          <Badge variant="outline" className="gap-1 text-xs border-purple-500/50 text-purple-400">
            <Sparkles className="w-3 h-3" />
            Gemini 2.0
          </Badge>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={onClose}
          data-testid="button-close-settings"
        >
          <X className="w-4 h-4" />
        </Button>
      </div>

      <div className="space-y-4">
        {/* Gemini 2.0 Voice Selection */}
        <div>
          <label className="text-sm font-medium text-slate-300 block mb-2">
            Gemini AI Voice
          </label>
          <Select value={voice} onValueChange={onVoiceChange}>
            <SelectTrigger data-testid="select-voice">
              <SelectValue placeholder="Select a voice" />
            </SelectTrigger>
            <SelectContent>
              {GEMINI_VOICES.map((v) => (
                <SelectItem key={v.id} value={v.id}>
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{v.name}</span>
                    <span className="text-xs text-muted-foreground">- {v.description}</span>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-slate-500 mt-1">
            Powered by Gemini 2.0 Live API
          </p>
        </div>

        {/* Speed */}
        <div>
          <label className="text-sm font-medium text-slate-300 block mb-2">
            Speaking Speed: {speed}x
          </label>
          <Slider
            value={[speed]}
            onValueChange={(v) => onSpeedChange(v[0])}
            min={0.5}
            max={2}
            step={0.1}
            data-testid="slider-speed"
          />
        </div>

        {/* Language */}
        <div>
          <label className="text-sm font-medium text-slate-300 block mb-2">
            Language
          </label>
          <Select value={language} onValueChange={onLanguageChange}>
            <SelectTrigger data-testid="select-language">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="en">English</SelectItem>
              <SelectItem value="pidgin">Pidgin English</SelectItem>
              <SelectItem value="yoruba">Yoruba</SelectItem>
              <SelectItem value="igbo">Igbo</SelectItem>
              <SelectItem value="hausa">Hausa</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Tone */}
        <div>
          <label className="text-sm font-medium text-slate-300 block mb-2">
            Teaching Tone
          </label>
          <Select value={tone} onValueChange={onToneChange}>
            <SelectTrigger data-testid="select-tone">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="friendly">Friendly</SelectItem>
              <SelectItem value="teacher">Teacher</SelectItem>
              <SelectItem value="serious">Serious</SelectItem>
              <SelectItem value="exam">Exam Instructor</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
    </Card>
  );
}

