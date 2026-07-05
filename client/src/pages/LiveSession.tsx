import { useState, useRef, useEffect, useCallback } from "react";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ThemeToggle } from "@/components/ThemeToggle";
import {
  Mic,
  Square,
  Pause,
  Play,
  ArrowLeft,
  Loader2,
  Wand2,
  BookOpen,
  X,
  Copy,
  Check,
  Trash2,
  History,
  Download,
  Brain,
  FileText,
  Clock,
  Volume2,
  AlertTriangle,
} from "lucide-react";
import { Link } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { supabase } from "@/lib/supabase";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

// ─── Types ─────────────────────────────────────────────────────────────────────
interface TranscriptSegment {
  speaker: string;
  text: string;
  start: number;
  end: number;
}

interface NoteEntry {
  id: string;
  title: string;
  rawTranscript: string;
  formattedNotes: string;
  segments: TranscriptSegment[];
  duration: number;
  subject: string;
  createdAt: number;
}

// ─── Helpers ───────────────────────────────────────────────────────────────────
const STORAGE_KEY = "lenory-write-my-note-history";

function loadHistory(): NoteEntry[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
  } catch {
    return [];
  }
}

function saveHistory(notes: NoteEntry[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(notes.slice(0, 50)));
  } catch {}
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// ─── Main component ────────────────────────────────────────────────────────────
export default function LiveSession() {
  const { user, isLoading: authLoading } = useAuth();
  const { toast } = useToast();

  // Recording state
  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [audioBlobs, setAudioBlobs] = useState<Blob[]>([]);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);

  // Processing state
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [isFormattingNotes, setIsFormattingNotes] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [segments, setSegments] = useState<TranscriptSegment[]>([]);
  const [formattedNotes, setFormattedNotes] = useState("");
  const [detectedLanguage, setDetectedLanguage] = useState("");

  // Session meta
  const [sessionTitle, setSessionTitle] = useState("");
  const [subject, setSubject] = useState("");
  const [activeTab, setActiveTab] = useState<"record" | "notes" | "history">("record");
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // History
  const [history, setHistory] = useState<NoteEntry[]>([]);
  const [selectedNote, setSelectedNote] = useState<NoteEntry | null>(null);

  // Refs
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Load history on mount
  useEffect(() => {
    setHistory(loadHistory());
  }, []);

  // Duration timer
  useEffect(() => {
    if (isRecording && !isPaused) {
      timerRef.current = setInterval(() => setRecordingDuration(d => d + 1), 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [isRecording, isPaused]);

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, sampleRate: 16000 } });
      streamRef.current = stream;
      chunksRef.current = [];
      setAudioBlobs([]);
      setTranscript("");
      setSegments([]);
      setFormattedNotes("");
      setAudioUrl(null);
      setRecordingDuration(0);

      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/webm")
        ? "audio/webm"
        : "audio/ogg";

      const recorder = new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 32000 });
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        const finalBlob = new Blob(chunksRef.current, { type: mimeType });
        setAudioBlobs([finalBlob]);
        const url = URL.createObjectURL(finalBlob);
        setAudioUrl(url);
        stream.getTracks().forEach(t => t.stop());
        streamRef.current = null;
      };

      recorder.start(1000);
      setIsRecording(true);
      setIsPaused(false);
    } catch (err: any) {
      toast({ title: "Microphone error", description: err?.message || "Could not access microphone", variant: "destructive" });
    }
  }, [toast]);

  const pauseResumeRecording = useCallback(() => {
    const recorder = mediaRecorderRef.current;
    if (!recorder) return;
    if (recorder.state === "recording") {
      recorder.pause();
      setIsPaused(true);
    } else if (recorder.state === "paused") {
      recorder.resume();
      setIsPaused(false);
    }
  }, []);

  const stopRecording = useCallback(() => {
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.stop();
    }
    setIsRecording(false);
    setIsPaused(false);
  }, []);

  // Split blob into chunks ≤ 24 MB
  const splitBlob = (blob: Blob, maxBytes = 24 * 1024 * 1024): Blob[] => {
    if (blob.size <= maxBytes) return [blob];
    const parts: Blob[] = [];
    let offset = 0;
    while (offset < blob.size) {
      parts.push(blob.slice(offset, offset + maxBytes, blob.type));
      offset += maxBytes;
    }
    return parts;
  };

  const transcribeAudio = useCallback(async () => {
    if (!audioBlobs.length) return;

    const fullBlob = audioBlobs[0];
    if (fullBlob.size > 25 * 1024 * 1024) {
      toast({ title: "Large file detected", description: "File exceeds 25 MB — will be split and transcribed in chunks." });
    }

    setIsTranscribing(true);
    setTranscript("");
    setSegments([]);

    try {
      // Get auth token once before the loop
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token || "";

      const chunks = splitBlob(fullBlob);
      const allTexts: string[] = [];
      const allSegments: TranscriptSegment[] = [];
      let timeOffset = 0;

      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        const form = new FormData();
        form.append("audio", chunk, `part${i + 1}.webm`);
        form.append("language", "en");

        const res = await fetch("/api/groq/transcribe", {
          method: "POST",
          body: form,
          headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: "Unknown error" }));
          throw new Error(err.error || "Transcription failed");
        }

        const data = await res.json();
        if (data.text) allTexts.push(data.text.trim());
        if (data.language && !detectedLanguage) setDetectedLanguage(data.language);
        if (data.segments) {
          allSegments.push(...data.segments.map((s: TranscriptSegment) => ({
            ...s,
            start: s.start + timeOffset,
            end: s.end + timeOffset,
          })));
          if (data.duration) timeOffset += data.duration;
        }
      }

      const fullText = allTexts.join(" ");
      setTranscript(fullText);
      setSegments(allSegments);

      if (fullText) {
        setActiveTab("notes");
        toast({ title: "Transcription complete!", description: "Your audio has been transcribed." });
      } else {
        toast({ title: "No speech detected", description: "The recording had no audible speech.", variant: "destructive" });
      }
    } catch (err: any) {
      toast({ title: "Transcription failed", description: err?.message || "Could not transcribe audio", variant: "destructive" });
    } finally {
      setIsTranscribing(false);
    }
  }, [audioBlobs, detectedLanguage, toast]);

  const formatNotes = useCallback(async () => {
    if (!transcript) return;
    setIsFormattingNotes(true);
    try {
      const res = await apiRequest("POST", "/api/groq/format-notes", { transcript, subject });
      const data = await res.json();
      setFormattedNotes(data.notes || transcript);
      toast({ title: "Notes formatted!", description: "Your transcript has been structured." });
    } catch {
      toast({ title: "Failed to format notes", description: "Could not generate structured notes.", variant: "destructive" });
    } finally {
      setIsFormattingNotes(false);
    }
  }, [transcript, subject, toast]);

  const [isSavingToNotes, setIsSavingToNotes] = useState(false);
  const saveTranscriptAsNote = useCallback(async () => {
    const textToSave = formattedNotes || transcript;
    if (!textToSave) {
      toast({ title: "Nothing to save", description: "Transcribe audio first.", variant: "destructive" });
      return;
    }
    setIsSavingToNotes(true);
    try {
      const title = sessionTitle || `Live Session — ${new Date().toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" })}`;
      const res = await apiRequest("POST", "/api/notes/from-text", { fileName: title, text: textToSave });
      const data = await res.json();
      if (data?.creditsCharged > 0) {
        toast({ title: "Saved to Knowledge Base", description: "20 credits used (past your 10 free note uploads)." });
      } else {
        toast({ title: "Saved to Knowledge Base", description: "You can now quiz yourself on this in Notes." });
      }
    } catch (err: any) {
      toast({ title: "Couldn't save note", description: err?.message || "Please try again.", variant: "destructive" });
    } finally {
      setIsSavingToNotes(false);
    }
  }, [transcript, formattedNotes, sessionTitle, toast]);

  const saveNote = useCallback(() => {
    if (!transcript && !formattedNotes) {
      toast({ title: "Nothing to save", description: "Transcribe audio first.", variant: "destructive" });
      return;
    }

    const title = sessionTitle || `Note — ${new Date().toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" })}`;
    const entry: NoteEntry = {
      id: Date.now().toString(),
      title,
      rawTranscript: transcript,
      formattedNotes,
      segments,
      duration: recordingDuration,
      subject,
      createdAt: Date.now(),
    };

    const updated = [entry, ...history];
    setHistory(updated);
    saveHistory(updated);
    toast({ title: "Note saved!", description: `"${title}" saved to history.` });
  }, [transcript, formattedNotes, sessionTitle, segments, recordingDuration, subject, history, toast]);

  const deleteNote = useCallback((id: string) => {
    const updated = history.filter(n => n.id !== id);
    setHistory(updated);
    saveHistory(updated);
    if (selectedNote?.id === id) setSelectedNote(null);
    toast({ title: "Note deleted" });
  }, [history, selectedNote, toast]);

  const copyText = useCallback(async (text: string, id: string) => {
    await navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  }, []);

  const downloadNote = useCallback((note: NoteEntry) => {
    const content = note.formattedNotes || note.rawTranscript;
    const blob = new Blob([content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${note.title.replace(/[^a-z0-9]/gi, "_")}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  if (authLoading || !user) {
    return (
      <div className="flex items-center justify-center h-screen">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b border-border/50 bg-background/80 backdrop-blur-lg flex-shrink-0">
        <div className="max-w-4xl mx-auto px-4 h-14 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Link href="/dashboard">
              <Button variant="ghost" size="icon" data-testid="button-back">
                <ArrowLeft className="w-4 h-4" />
              </Button>
            </Link>
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                <Mic className="w-4 h-4 text-primary" />
              </div>
              <div>
                <p className="font-semibold text-sm leading-tight">Write My Note</p>
                <p className="text-xs text-muted-foreground leading-tight">Record, transcribe &amp; format</p>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <ThemeToggle />
          </div>
        </div>
      </header>

      {/* Tab bar */}
      <div className="border-b border-border/50 bg-background/80 flex-shrink-0">
        <div className="max-w-4xl mx-auto px-4 flex gap-1 py-1.5">
          {(["record", "notes", "history"] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors capitalize ${activeTab === tab ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground hover:bg-muted/60"}`}
              data-testid={`tab-${tab}`}
            >
              {tab === "record" ? "Record" : tab === "notes" ? "Notes" : `History (${history.length})`}
            </button>
          ))}
        </div>
      </div>

      <main className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto px-4 py-6">

          {/* ── Record Tab ── */}
          {activeTab === "record" && (
            <div className="space-y-6">
              {/* Session meta */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Session Title (optional)</label>
                  <input
                    type="text"
                    value={sessionTitle}
                    onChange={e => setSessionTitle(e.target.value)}
                    placeholder="e.g. Biology Lecture — Cell Division"
                    className="w-full px-3 py-2 text-sm rounded-lg bg-muted/40 border border-border placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary"
                    data-testid="input-session-title"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Subject (optional)</label>
                  <input
                    type="text"
                    value={subject}
                    onChange={e => setSubject(e.target.value)}
                    placeholder="e.g. Biology, Mathematics, History"
                    className="w-full px-3 py-2 text-sm rounded-lg bg-muted/40 border border-border placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary"
                    data-testid="input-subject"
                  />
                </div>
              </div>

              {/* Recording orb */}
              <div className="flex flex-col items-center gap-6 py-8">
                <div className={`relative w-32 h-32 rounded-full flex items-center justify-center transition-all duration-500 ${
                  isRecording && !isPaused
                    ? "bg-red-500/20 shadow-[0_0_60px_rgba(239,68,68,0.35)] ring-4 ring-red-500/30"
                    : isRecording && isPaused
                    ? "bg-amber-500/20 ring-4 ring-amber-500/30"
                    : audioUrl
                    ? "bg-primary/10 ring-4 ring-primary/20"
                    : "bg-muted/30 ring-4 ring-border/40"
                }`}>
                  {isRecording && !isPaused && (
                    <div className="absolute inset-0 rounded-full animate-ping bg-red-500/15" />
                  )}
                  <div className="flex flex-col items-center gap-1">
                    <Mic className={`w-10 h-10 transition-colors ${isRecording && !isPaused ? "text-red-500" : isRecording && isPaused ? "text-amber-500" : audioUrl ? "text-primary" : "text-muted-foreground"}`} />
                    {isRecording && (
                      <span className="text-sm font-bold font-mono tabular-nums text-red-400">
                        {formatDuration(recordingDuration)}
                      </span>
                    )}
                  </div>
                </div>

                {/* Status text */}
                <div className="text-center">
                  {!isRecording && !audioUrl && (
                    <p className="text-muted-foreground text-sm">Tap record to start capturing audio</p>
                  )}
                  {isRecording && !isPaused && (
                    <p className="text-red-400 text-sm font-medium animate-pulse">Recording in progress...</p>
                  )}
                  {isRecording && isPaused && (
                    <p className="text-amber-400 text-sm font-medium">Paused — tap resume to continue</p>
                  )}
                  {!isRecording && audioUrl && (
                    <div className="space-y-1">
                      <p className="text-primary text-sm font-medium">Recording complete — {formatDuration(recordingDuration)}</p>
                      <p className="text-muted-foreground text-xs">Ready to transcribe with Groq Whisper</p>
                    </div>
                  )}
                </div>

                {/* Controls */}
                <div className="flex items-center gap-3 flex-wrap justify-center">
                  {!isRecording && !audioUrl && (
                    <Button onClick={startRecording} size="lg" className="gap-2 px-8" data-testid="button-start-recording">
                      <Mic className="w-5 h-5" />
                      Start Recording
                    </Button>
                  )}

                  {isRecording && (
                    <>
                      <Button onClick={pauseResumeRecording} variant="outline" size="lg" className="gap-2" data-testid="button-pause-resume">
                        {isPaused ? <Play className="w-5 h-5" /> : <Pause className="w-5 h-5" />}
                        {isPaused ? "Resume" : "Pause"}
                      </Button>
                      <Button onClick={stopRecording} variant="destructive" size="lg" className="gap-2 px-8" data-testid="button-stop-recording">
                        <Square className="w-4 h-4" />
                        Stop
                      </Button>
                    </>
                  )}

                  {!isRecording && audioUrl && (
                    <>
                      <Button
                        onClick={transcribeAudio}
                        disabled={isTranscribing}
                        size="lg"
                        className="gap-2 px-8"
                        data-testid="button-transcribe"
                      >
                        {isTranscribing ? <Loader2 className="w-5 h-5 animate-spin" /> : <Brain className="w-5 h-5" />}
                        {isTranscribing ? "Transcribing..." : "Transcribe"}
                      </Button>

                      <Button
                        onClick={startRecording}
                        variant="outline"
                        size="lg"
                        className="gap-2"
                        data-testid="button-record-again"
                      >
                        <Mic className="w-4 h-4" />
                        Record Again
                      </Button>
                    </>
                  )}
                </div>

                {/* Audio preview */}
                {audioUrl && !isRecording && (
                  <div className="w-full max-w-md">
                    <p className="text-xs text-muted-foreground mb-1.5 text-center">Preview recording</p>
                    <audio controls src={audioUrl} className="w-full h-10 rounded-lg" data-testid="audio-preview" />
                  </div>
                )}

                {/* Transcription progress */}
                {isTranscribing && (
                  <div className="flex items-center gap-3 px-5 py-3 rounded-xl bg-primary/10 border border-primary/20 max-w-sm">
                    <Loader2 className="w-5 h-5 text-primary animate-spin flex-shrink-0" />
                    <div>
                      <p className="text-sm font-medium text-primary">Processing with Groq Whisper</p>
                      <p className="text-xs text-muted-foreground">Using whisper-large-v3-turbo model</p>
                    </div>
                  </div>
                )}
              </div>

              {/* Transcript preview */}
              {transcript && (
                <div className="rounded-xl border border-border bg-card p-5 space-y-3">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-2">
                      <FileText className="w-4 h-4 text-primary" />
                      <span className="font-semibold text-sm">Raw Transcript</span>
                      {detectedLanguage && (
                        <Badge variant="secondary" className="text-xs">{detectedLanguage.toUpperCase()}</Badge>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => copyText(transcript, "transcript")}
                        data-testid="button-copy-transcript"
                      >
                        {copiedId === "transcript" ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
                        {copiedId === "transcript" ? "Copied" : "Copy"}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={isSavingToNotes}
                        onClick={() => saveTranscriptAsNote()}
                        className="gap-1.5"
                        data-testid="button-save-to-notes"
                      >
                        {isSavingToNotes ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <BookOpen className="w-3.5 h-3.5" />}
                        {isSavingToNotes ? "Saving..." : "Save to Knowledge Base"}
                      </Button>
                      <Button
                        size="sm"
                        onClick={formatNotes}
                        disabled={isFormattingNotes}
                        className="gap-1.5"
                        data-testid="button-format-notes"
                      >
                        {isFormattingNotes ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wand2 className="w-3.5 h-3.5" />}
                        {isFormattingNotes ? "Formatting..." : "Format Notes"}
                      </Button>
                    </div>
                  </div>
                  <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-wrap">{transcript}</p>

                  {/* Segments (if available) */}
                  {segments.length > 0 && (
                    <details className="mt-2">
                      <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground">
                        Show {segments.length} timestamped segments
                      </summary>
                      <div className="mt-2 space-y-1 max-h-48 overflow-y-auto">
                        {segments.map((seg, i) => (
                          <div key={i} className="flex gap-2 text-xs">
                            <span className="text-muted-foreground font-mono flex-shrink-0">{formatDuration(seg.start)}</span>
                            <span className="text-foreground/80">{seg.text}</span>
                          </div>
                        ))}
                      </div>
                    </details>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ── Notes Tab ── */}
          {activeTab === "notes" && (
            <div className="space-y-4">
              {!formattedNotes && !transcript ? (
                <div className="flex flex-col items-center justify-center gap-4 py-16 text-center">
                  <div className="w-16 h-16 rounded-full bg-muted/40 flex items-center justify-center">
                    <BookOpen className="w-8 h-8 text-muted-foreground" />
                  </div>
                  <div>
                    <p className="font-medium text-muted-foreground">No notes yet</p>
                    <p className="text-sm text-muted-foreground/70">Record and transcribe audio first, then format your notes here.</p>
                  </div>
                  <Button onClick={() => setActiveTab("record")} variant="outline" size="sm">
                    <Mic className="w-4 h-4 mr-2" />
                    Go to Record
                  </Button>
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <h2 className="font-semibold">{sessionTitle || "Untitled Note"}</h2>
                    <div className="flex gap-2">
                      {!formattedNotes && transcript && (
                        <Button onClick={formatNotes} disabled={isFormattingNotes} size="sm" className="gap-1.5">
                          {isFormattingNotes ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wand2 className="w-3.5 h-3.5" />}
                          {isFormattingNotes ? "Formatting..." : "Format with AI"}
                        </Button>
                      )}
                      <Button onClick={saveNote} size="sm" variant="outline" className="gap-1.5" data-testid="button-save-note">
                        <BookOpen className="w-3.5 h-3.5" />
                        Save Note
                      </Button>
                      {(formattedNotes || transcript) && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => copyText(formattedNotes || transcript, "notes")}
                          data-testid="button-copy-notes"
                        >
                          {copiedId === "notes" ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
                          {copiedId === "notes" ? "Copied" : "Copy"}
                        </Button>
                      )}
                    </div>
                  </div>

                  {formattedNotes ? (
                    <div className="rounded-xl border border-border bg-card p-6">
                      <div className="prose prose-sm dark:prose-invert max-w-none
                        prose-headings:font-semibold prose-p:leading-relaxed
                        prose-ul:my-2 prose-li:my-0.5 prose-strong:text-foreground">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                          {formattedNotes}
                        </ReactMarkdown>
                      </div>
                    </div>
                  ) : transcript ? (
                    <div className="rounded-xl border border-border bg-card p-5">
                      <p className="text-sm leading-relaxed whitespace-pre-wrap text-foreground/90">{transcript}</p>
                    </div>
                  ) : null}
                </>
              )}
            </div>
          )}

          {/* ── History Tab ── */}
          {activeTab === "history" && (
            <div className="space-y-4">
              {selectedNote ? (
                /* Note detail view */
                <div className="space-y-4">
                  <div className="flex items-center gap-3">
                    <Button variant="ghost" size="sm" onClick={() => setSelectedNote(null)} className="gap-1.5">
                      <ArrowLeft className="w-4 h-4" />
                      Back
                    </Button>
                    <div className="flex-1 min-w-0">
                      <h2 className="font-semibold truncate">{selectedNote.title}</h2>
                      <p className="text-xs text-muted-foreground">
                        {new Date(selectedNote.createdAt).toLocaleDateString("en-NG", { day: "numeric", month: "long", year: "numeric" })}
                        {selectedNote.duration > 0 && ` · ${formatDuration(selectedNote.duration)}`}
                        {selectedNote.subject && ` · ${selectedNote.subject}`}
                      </p>
                    </div>
                    <Button size="sm" variant="ghost" onClick={() => downloadNote(selectedNote)} title="Download">
                      <Download className="w-4 h-4" />
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => copyText(selectedNote.formattedNotes || selectedNote.rawTranscript, selectedNote.id)}>
                      {copiedId === selectedNote.id ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4" />}
                    </Button>
                  </div>

                  <div className="rounded-xl border border-border bg-card p-6">
                    {selectedNote.formattedNotes ? (
                      <div className="prose prose-sm dark:prose-invert max-w-none
                        prose-headings:font-semibold prose-p:leading-relaxed
                        prose-ul:my-2 prose-li:my-0.5 prose-strong:text-foreground">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                          {selectedNote.formattedNotes}
                        </ReactMarkdown>
                      </div>
                    ) : (
                      <p className="text-sm leading-relaxed whitespace-pre-wrap text-foreground/90">{selectedNote.rawTranscript}</p>
                    )}
                  </div>
                </div>
              ) : history.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-4 py-16 text-center">
                  <div className="w-16 h-16 rounded-full bg-muted/40 flex items-center justify-center">
                    <History className="w-8 h-8 text-muted-foreground" />
                  </div>
                  <div>
                    <p className="font-medium text-muted-foreground">No saved notes yet</p>
                    <p className="text-sm text-muted-foreground/70">Your transcribed and formatted notes will appear here.</p>
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  {history.map(note => (
                    <div
                      key={note.id}
                      className="flex items-start gap-3 p-4 rounded-xl border border-border bg-card hover-elevate cursor-pointer group"
                      onClick={() => setSelectedNote(note)}
                      data-testid={`note-card-${note.id}`}
                    >
                      <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                        <FileText className="w-4 h-4 text-primary" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm truncate">{note.title}</p>
                        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                          <span className="text-xs text-muted-foreground">
                            {new Date(note.createdAt).toLocaleDateString("en-NG", { day: "numeric", month: "short" })}
                          </span>
                          {note.duration > 0 && (
                            <span className="flex items-center gap-0.5 text-xs text-muted-foreground">
                              <Clock className="w-3 h-3" />
                              {formatDuration(note.duration)}
                            </span>
                          )}
                          {note.subject && (
                            <Badge variant="secondary" className="text-xs">{note.subject}</Badge>
                          )}
                          {note.formattedNotes && (
                            <Badge variant="secondary" className="text-xs text-primary">AI Formatted</Badge>
                          )}
                        </div>
                        {note.rawTranscript && (
                          <p className="text-xs text-muted-foreground mt-1 line-clamp-1">{note.rawTranscript.slice(0, 120)}</p>
                        )}
                      </div>
                      <button
                        onClick={e => { e.stopPropagation(); deleteNote(note.id); }}
                        className="opacity-0 group-hover:opacity-100 p-1.5 rounded-lg text-destructive hover:bg-destructive/15 transition-all flex-shrink-0"
                        data-testid={`button-delete-note-${note.id}`}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </main>

      {/* Groq tip footer */}
      <footer className="border-t border-border/50 py-2 flex-shrink-0">
        <p className="text-xs text-muted-foreground text-center">
          Powered by Groq Whisper (whisper-large-v3-turbo) · Supports Nigerian English, Pidgin, and 100+ languages
        </p>
      </footer>
    </div>
  );
}
