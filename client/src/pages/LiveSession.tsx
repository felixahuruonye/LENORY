import { useState, useRef, useEffect, useCallback } from "react";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ThemeToggle } from "@/components/ThemeToggle";
import {
  Mic, Square, Pause, Play, ArrowLeft, Loader2, BookOpen, X, Trash2, Search,
  Upload, Plus, Folder, Share2, Camera, Pencil, Save, FileText, MessageSquare,
  ChevronRight, HardDrive, Link2, Globe, Lock, AlertTriangle, Image as ImageIcon,
} from "lucide-react";
import { Link, useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/lib/supabase";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getAuthHeaders } from "@/lib/queryClient";

const FOLDER_STORAGE_LIMIT = 100 * 1024 * 1024;
const TOPIC_STORAGE_LIMIT = 50 * 1024 * 1024;
const FOLDER_COLORS = ["bg-emerald-500","bg-blue-500","bg-purple-500","bg-amber-500","bg-rose-500","bg-cyan-500","bg-indigo-500","bg-orange-500"];

type View = "home" | "notebook" | "topic" | "recording" | "transcript" | "formatted";

interface NotebookMeta { academicSession?: string; semester?: string; lecturer?: string; tags?: string[]; }
interface Notebook {
  id: string; name: string; description?: string | null;
  storage_used?: number; storageUsed?: number; created_at?: string; updated_at?: string; meta?: NotebookMeta;
}
interface TopicFile {
  id: string; name: string; size_bytes?: number; sizeBytes?: number;
  extracted_text?: string | null; extractedText?: string | null; created_at?: string; createdAt?: string;
}
interface TopicPage {
  id: string;
  pageNumber: number;
  title?: string;
  createdAt: string;
  transcript?: string;
  formattedNotes?: string;
  segments?: Array<{ text: string; start: number; end: number; speaker?: string }>;
  duration?: number;
  photos?: string[];
  language?: string;
  photoCount?: number;
  hasRecording?: boolean;
  recordingUrl?: string;
  uploadedFiles?: Array<{ name: string; type: string; size?: number; url?: string }>;
}
/** v2 multi-page topic document (legacy single-page fields still accepted) */
interface TopicPayload {
  version?: number;
  pages?: TopicPage[];
  // legacy single-page fields
  transcript?: string; formattedNotes?: string;
  segments?: Array<{ text: string; start: number; end: number; speaker?: string }>;
  duration?: number; photos?: string[]; language?: string;
  photoCount?: number; hasRecording?: boolean;
  recordingUrl?: string;
  uploadedFiles?: Array<{ name: string; type: string; size?: number; url?: string }>;
}
interface TranscriptSegment { text: string; start: number; end: number; speaker?: string; }

function parseMeta(description?: string | null): NotebookMeta {
  if (!description) return {};
  try { const j = JSON.parse(description); if (j && typeof j === "object") return j; } catch {}
  return {};
}
function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60); const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}
function colorForId(id: string): string {
  let h = 0; for (let i = 0; i < id.length; i++) h = (h + id.charCodeAt(i) * 17) % FOLDER_COLORS.length;
  return FOLDER_COLORS[h];
}
function relativeTime(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso); const days = Math.floor((Date.now() - d.getTime()) / 86400000);
  if (days <= 0) return "Today"; if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`; return d.toLocaleDateString();
}
function parseTopicPayload(raw?: string | null): TopicPayload {
  if (!raw) return { version: 2, pages: [] };
  try {
    const j = JSON.parse(raw);
    if (j && typeof j === "object") {
      // Already multi-page
      if (Array.isArray(j.pages)) return { version: 2, pages: j.pages, ...j };
      // Legacy single blob → migrate to one page
      if (j.transcript || j.formattedNotes || j.recordingUrl || j.photos) {
        const page: TopicPage = {
          id: j.id || `page_legacy_${Date.now()}`,
          pageNumber: 1,
          title: j.title || "Page 1",
          createdAt: j.createdAt || new Date().toISOString(),
          transcript: j.transcript,
          formattedNotes: j.formattedNotes,
          segments: j.segments,
          duration: j.duration,
          photos: j.photos,
          language: j.language,
          photoCount: j.photoCount,
          hasRecording: j.hasRecording,
          recordingUrl: j.recordingUrl,
          uploadedFiles: j.uploadedFiles,
        };
        return { version: 2, pages: [page] };
      }
      return j;
    }
  } catch {}
  return {
    version: 2,
    pages: [{
      id: `page_raw_${Date.now()}`,
      pageNumber: 1,
      title: "Page 1",
      createdAt: new Date().toISOString(),
      transcript: raw || "",
    }],
  };
}

function getTopicPages(payload: TopicPayload): TopicPage[] {
  if (Array.isArray(payload.pages) && payload.pages.length) {
    return [...payload.pages].sort((a, b) => (a.pageNumber || 0) - (b.pageNumber || 0));
  }
  return [];
}

function loadPageIntoState(page: TopicPage | null | undefined) {
  if (!page) {
    return {
      transcript: "",
      formattedNotes: "",
      segments: [] as TranscriptSegment[],
      duration: 0,
      photos: [] as string[],
      recordingUrl: undefined as string | undefined,
      language: "",
    };
  }
  return {
    transcript: page.transcript || "",
    formattedNotes: page.formattedNotes || "",
    segments: page.segments || [],
    duration: page.duration || 0,
    photos: page.photos || [],
    recordingUrl: page.recordingUrl,
    language: page.language || "",
  };
}
async function authFetch(url: string, init: RequestInit = {}) {
  const headers = await getAuthHeaders();
  return fetch(url, { ...init, headers: { ...headers, ...(init.headers || {}) } });
}

const IDB_NAME = "lenory-wmn-recordings"; const IDB_STORE = "chunks";
function openIdb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(IDB_STORE)) req.result.createObjectStore(IDB_STORE, { keyPath: "id" }); };
    req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error);
  });
}
async function idbPut(record: { id: string; blobs: Blob[]; meta: any }) {
  const db = await openIdb();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readwrite");
    tx.objectStore(IDB_STORE).put(record); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error);
  });
}

export default function LiveSession() {
  const { user, isLoading: authLoading } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();

  const [view, setView] = useState<View>("home");
  const [selectedNotebook, setSelectedNotebook] = useState<Notebook | null>(null);
  const [selectedTopic, setSelectedTopic] = useState<TopicFile | null>(null);
  const [topicTab, setTopicTab] = useState<"live" | "note">("live");
  const [topicPages, setTopicPages] = useState<TopicPage[]>([]);
  const [selectedPageIndex, setSelectedPageIndex] = useState(0);
  const [playingSegIndex, setPlayingSegIndex] = useState<number | null>(null);
  const [isSegPlaying, setIsSegPlaying] = useState(false);
  const segAudioRef = useRef<HTMLAudioElement | null>(null);

  const [showCreateNotebook, setShowCreateNotebook] = useState(false);
  const [nbName, setNbName] = useState(""); const [nbSession, setNbSession] = useState("");
  const [nbSemester, setNbSemester] = useState(""); const [nbLecturer, setNbLecturer] = useState("");
  const [nbTags, setNbTags] = useState("");

  const [showCreateTopic, setShowCreateTopic] = useState(false);
  const [topicName, setTopicName] = useState("");
  const [showShare, setShowShare] = useState(false);
  const [sharePublic, setSharePublic] = useState(false);
  const [shareLink, setShareLink] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [showSearch, setShowSearch] = useState(false);

  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [audioBlobs, setAudioBlobs] = useState<Blob[]>([]);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [photos, setPhotos] = useState<string[]>([]);
  const [showOfflineNotice, setShowOfflineNotice] = useState(false);
  const [showStartRecCard, setShowStartRecCard] = useState(false);
  const [quietPeriod, setQuietPeriod] = useState(false);
  const [autoPauseOnSilence, setAutoPauseOnSilence] = useState(false);
  const [showSilenceSettings, setShowSilenceSettings] = useState(false);
  const [videoUrlInput, setVideoUrlInput] = useState("");
  const [showVideoUrl, setShowVideoUrl] = useState(false);

  const [isTranscribing, setIsTranscribing] = useState(false);
  const [isFormatting, setIsFormatting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [segments, setSegments] = useState<TranscriptSegment[]>([]);
  const [formattedNotes, setFormattedNotes] = useState("");
  const [detectedLanguage, setDetectedLanguage] = useState("");
  const [isEditingTranscript, setIsEditingTranscript] = useState(false);
  const [editDraft, setEditDraft] = useState("");

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const silenceMsRef = useRef(0);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const videoInputRef = useRef<HTMLInputElement | null>(null);
  const cameraInputRef = useRef<HTMLInputElement | null>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const sessionIdRef = useRef(`rec_${Date.now()}`);

  const firstName = user?.firstName || user?.email?.split("@")[0] || "there";

  const { data: folders = [], isLoading: foldersLoading } = useQuery<Notebook[]>({
    queryKey: ["/api/kb/folders"],
    queryFn: async () => {
      const res = await authFetch("/api/kb/folders");
      if (!res.ok) throw new Error("Failed to load notebooks");
      const data = await res.json();
      return (data || []).map((f: any) => ({ ...f, storageUsed: f.storage_used ?? f.storageUsed ?? 0, meta: parseMeta(f.description) }));
    },
    enabled: !!user,
  });

  const { data: topicFiles = [], isLoading: topicsLoading, refetch: refetchTopics } = useQuery<TopicFile[]>({
    queryKey: ["/api/kb/folders", selectedNotebook?.id, "files"],
    queryFn: async () => {
      if (!selectedNotebook) return [];
      const res = await authFetch(`/api/kb/folders/${selectedNotebook.id}`);
      if (!res.ok) throw new Error("Failed to load topics");
      return res.json();
    },
    enabled: !!user && !!selectedNotebook,
  });

  const createNotebookMutation = useMutation({
    mutationFn: async () => {
      const meta: NotebookMeta = {
        academicSession: nbSession || undefined, semester: nbSemester || undefined,
        lecturer: nbLecturer || undefined,
        tags: nbTags ? nbTags.split(",").map((t) => t.trim()).filter(Boolean) : undefined,
      };
      const res = await authFetch("/api/kb/folders", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: nbName.trim(), description: JSON.stringify(meta) }),
      });
      if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.message || "Failed to create notebook"); }
      return res.json();
    },
    onSuccess: (folder) => {
      queryClient.invalidateQueries({ queryKey: ["/api/kb/folders"] });
      setShowCreateNotebook(false); setNbName(""); setNbSession(""); setNbSemester(""); setNbLecturer(""); setNbTags("");
      toast({ title: "Notebook created", description: "100 MB storage allocated." });
      const nb: Notebook = { ...folder, storageUsed: 0, meta: parseMeta(folder.description) };
      setSelectedNotebook(nb); setView("notebook");
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const createTopicMutation = useMutation({
    mutationFn: async (name: string) => {
      if (!selectedNotebook) throw new Error("No notebook selected");
      const used = selectedNotebook.storageUsed ?? selectedNotebook.storage_used ?? 0;
      if (used >= FOLDER_STORAGE_LIMIT) throw new Error("Notebook storage full (100 MB). Upgrade or delete topics.");
      const payload: TopicPayload = { transcript: "", formattedNotes: "", segments: [], duration: 0, photos: [] };
      const res = await authFetch(`/api/kb/folders/${selectedNotebook.id}/files/text`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), content: JSON.stringify(payload) }),
      });
      if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.message || "Failed to create topic"); }
      return res.json();
    },
    onSuccess: (file) => {
      refetchTopics(); setShowCreateTopic(false); setTopicName(""); setSelectedTopic(file);
      setShowStartRecCard(true); setView("topic");
      toast({ title: "Topic created", description: "Up to 50 MB per topic file." });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteTopicMutation = useMutation({
    mutationFn: async (fileId: string) => {
      if (!selectedNotebook) throw new Error("No notebook");
      const res = await authFetch(`/api/kb/folders/${selectedNotebook.id}/files/${fileId}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete");
    },
    onSuccess: () => {
      refetchTopics(); queryClient.invalidateQueries({ queryKey: ["/api/kb/folders"] });
      if (selectedTopic) { setSelectedTopic(null); setView("notebook"); }
      toast({ title: "Topic deleted permanently" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  useEffect(() => {
    if (isRecording && !isPaused) {
      timerRef.current = setInterval(() => setRecordingDuration((d) => d + 1), 1000);
    } else if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [isRecording, isPaused]);

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1, sampleRate: 16000 },
      });
      streamRef.current = stream; chunksRef.current = [];
      setAudioBlobs([]); setAudioUrl(null); setTranscript(""); setSegments([]); setFormattedNotes("");
      setRecordingDuration(0); sessionIdRef.current = `rec_${Date.now()}`;

      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "audio/ogg";
      const recorder = new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 32000 });
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = async (e) => {
        if (e.data && e.data.size > 0) {
          chunksRef.current.push(e.data);
          try {
            await idbPut({ id: sessionIdRef.current, blobs: [...chunksRef.current],
              meta: { topicId: selectedTopic?.id, notebookId: selectedNotebook?.id, startedAt: Date.now() } });
          } catch {}
        }
      };
      recorder.onstop = () => {
        const finalBlob = new Blob(chunksRef.current, { type: mimeType });
        setAudioBlobs([finalBlob]); setAudioUrl(URL.createObjectURL(finalBlob));
        stream.getTracks().forEach((t) => t.stop()); streamRef.current = null;
      };
      recorder.start(2000);
      setIsRecording(true); setIsPaused(false); setShowStartRecCard(false);
      setShowOfflineNotice(true); setView("recording");
      setQuietPeriod(false); silenceMsRef.current = 0;

      // Voice activity / silence detection (does NOT discard audio)
      try {
        const ctx = new AudioContext();
        audioCtxRef.current = ctx;
        const source = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 512;
        source.connect(analyser);
        analyserRef.current = analyser;
        const data = new Uint8Array(analyser.frequencyBinCount);
        let lastTs = performance.now();
        const tick = (now: number) => {
          const dt = now - lastTs; lastTs = now;
          analyser.getByteFrequencyData(data);
          let sum = 0;
          for (let i = 0; i < data.length; i++) sum += data[i];
          const avg = sum / data.length;
          const speaking = avg > 12;
          if (!speaking) {
            silenceMsRef.current += dt;
            if (silenceMsRef.current > 15000) setQuietPeriod(true);
            if (autoPauseOnSilence && silenceMsRef.current > 45000) {
              const r = mediaRecorderRef.current;
              if (r && r.state === "recording") {
                r.pause();
                setIsPaused(true);
                toast({ title: "Auto-paused", description: "Long silence detected. Resume when the lecture continues." });
              }
              silenceMsRef.current = 0;
            }
          } else {
            silenceMsRef.current = 0;
            setQuietPeriod(false);
            if (autoPauseOnSilence) {
              const r = mediaRecorderRef.current;
              if (r && r.state === "paused") {
                r.resume();
                setIsPaused(false);
              }
            }
          }
          rafRef.current = requestAnimationFrame(tick);
        };
        rafRef.current = requestAnimationFrame(tick);
      } catch {}

      toast({ title: "Recording started", description: "Saved locally in chunks. Turn off mobile data to save bandwidth." });
    } catch (err: any) {
      toast({ title: "Microphone error", description: err?.message || "Could not access microphone", variant: "destructive" });
    }
  }, [toast, selectedTopic, selectedNotebook, autoPauseOnSilence]);

  const pauseResumeRecording = useCallback(() => {
    const recorder = mediaRecorderRef.current; if (!recorder) return;
    if (recorder.state === "recording") { recorder.pause(); setIsPaused(true); }
    else if (recorder.state === "paused") { recorder.resume(); setIsPaused(false); }
  }, []);

  const stopRecording = useCallback(() => {
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== "inactive") recorder.stop();
    setIsRecording(false); setIsPaused(false); setShowOfflineNotice(false);
    setQuietPeriod(false);
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    try { audioCtxRef.current?.close(); } catch {}
    audioCtxRef.current = null; analyserRef.current = null;
    toast({ title: "Recording stopped", description: "Turn on internet, then tap Generate My Notes." });
  }, [toast]);

  const handleVideoUrlSubmit = () => {
    const url = videoUrlInput.trim();
    if (!url) return;
    const lower = url.toLowerCase();
    const supported =
      lower.includes("youtube.com") ||
      lower.includes("youtu.be") ||
      lower.includes("vimeo.com");
    if (!supported) {
      toast({
        title: "Link not supported yet",
        description: "Upload the video file instead, or use a YouTube/Vimeo link when the integration is enabled.",
        variant: "destructive",
      });
      return;
    }
    // Policy-safe path: we do not download YouTube AV without authorization.
    // Offer metadata-only guidance and file upload.
    toast({
      title: "External video links",
      description: "For rights and policy reasons, paste links are limited. Download/export audio you're authorized to use, then Upload the file.",
    });
    setShowVideoUrl(false);
  };


  /** Upload image/audio permanently to notebook media storage. Returns public URL. */
  const uploadPermanentMedia = async (
    folderId: string,
    opts: { file?: File | Blob; dataUrl?: string; name: string; mimeType?: string; topicId?: string; role?: string }
  ): Promise<{ url: string; id?: string } | null> => {
    try {
      if (opts.file) {
        const form = new FormData();
        form.append("file", opts.file, opts.name);
        form.append("label", opts.name);
        if (opts.topicId) form.append("topicId", opts.topicId);
        if (opts.role) form.append("role", opts.role);
        const res = await authFetch(`/api/kb/folders/${folderId}/media`, { method: "POST", body: form });
        if (!res.ok) return null;
        const data = await res.json();
        return data.url ? { url: data.url, id: data.id } : null;
      }
      if (opts.dataUrl) {
        const res = await authFetch(`/api/kb/folders/${folderId}/media`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            dataUrl: opts.dataUrl,
            name: opts.name,
            mimeType: opts.mimeType,
            topicId: opts.topicId,
            role: opts.role,
            label: opts.name,
          }),
        });
        if (!res.ok) return null;
        const data = await res.json();
        return data.url ? { url: data.url, id: data.id } : null;
      }
    } catch (e) {
      console.warn("permanent media upload failed", e);
    }
    return null;
  };

  const handleCameraCapture = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const localUrl = URL.createObjectURL(file);
    setPhotos((p) => [...p, localUrl]);
    // Persist in background when online + notebook selected
    (async () => {
      if (!selectedNotebook?.id || !navigator.onLine) {
        toast({ title: "Photo captured", description: "Will upload when you save online." });
        // Keep data URL fallback for offline save later
        const reader = new FileReader();
        reader.onload = () => {
          if (typeof reader.result === "string") {
            setPhotos((prev) => prev.map((u) => (u === localUrl ? (reader.result as string) : u)));
          }
        };
        reader.readAsDataURL(file);
        return;
      }
      toast({ title: "Uploading photo…" });
      const saved = await uploadPermanentMedia(selectedNotebook.id, {
        file,
        name: `board-${Date.now()}.jpg`,
        topicId: selectedTopic?.id,
        role: "board_photo",
      });
      if (saved?.url) {
        setPhotos((prev) => prev.map((u) => (u === localUrl ? saved.url : u)));
        toast({ title: "Photo saved permanently" });
      } else {
        // Fallback data URL
        const reader = new FileReader();
        reader.onload = () => {
          if (typeof reader.result === "string") {
            setPhotos((prev) => prev.map((u) => (u === localUrl ? (reader.result as string) : u)));
          }
        };
        reader.readAsDataURL(file);
        toast({ title: "Photo kept locally", description: "Permanent upload failed — will retry on save.", variant: "destructive" });
      }
    })();
    e.target.value = "";
  };

  const handleUploadRecording = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    const isAudio = file.type.startsWith("audio/") || /\.(webm|mp3|wav|m4a|ogg|aac|flac|mpeg)$/i.test(file.name);
    const isVideo = file.type.startsWith("video/") || /\.(mp4|webm|mov|mkv)$/i.test(file.name);
    if (!isAudio && !isVideo) {
      toast({ title: "Invalid file", description: "Upload audio or video (mp3, wav, webm, m4a, mp4…).", variant: "destructive" });
      e.target.value = ""; return;
    }
    if (file.size > TOPIC_STORAGE_LIMIT) {
      toast({ title: "File too large", description: `Topic limit is ${formatBytes(TOPIC_STORAGE_LIMIT)}.`, variant: "destructive" });
      e.target.value = ""; return;
    }
    const blob = file.slice(0, file.size, file.type || "audio/webm");
    setAudioBlobs([blob]); setAudioUrl(URL.createObjectURL(blob));
    setTranscript(""); setSegments([]); setFormattedNotes("");
    const audio = new Audio(); audio.preload = "metadata"; audio.src = URL.createObjectURL(blob);
    audio.onloadedmetadata = () => { if (Number.isFinite(audio.duration) && audio.duration > 0) setRecordingDuration(Math.round(audio.duration)); };
    setView("transcript");
    toast({ title: isVideo ? "Video uploaded" : "Recording uploaded", description: "Tap Generate My Notes to transcribe." });
    e.target.value = "";
  }, [toast]);

  // Keep chunks under Groq's ~25 MB limit after conversion; 12 MB is safer on mobile.
  const splitBlob = (blob: Blob, maxBytes = 12 * 1024 * 1024): Blob[] => {
    if (blob.size <= maxBytes) return [blob];
    const parts: Blob[] = []; let offset = 0;
    while (offset < blob.size) { parts.push(blob.slice(offset, offset + maxBytes, blob.type || "audio/webm")); offset += maxBytes; }
    return parts;
  };

  const transcribeAudio = useCallback(async () => {
    if (!audioBlobs.length) { toast({ title: "No audio", description: "Record or upload first.", variant: "destructive" }); return; }
    if (!navigator.onLine) { toast({ title: "You're offline", description: "Turn on internet to process.", variant: "destructive" }); return; }
    const fullBlob = audioBlobs[0];
    setIsTranscribing(true); setTranscript(""); setSegments([]); setView("transcript");
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token || "";
      const authHeaders: Record<string, string> = accessToken ? { Authorization: `Bearer ${accessToken}` } : {};

      const pollJob = async (jobId: string): Promise<any> => {
        const maxAttempts = 180; // up to ~6 min
        for (let i = 0; i < maxAttempts; i++) {
          await new Promise((r) => setTimeout(r, 2000));
          const res = await fetch(`/api/jobs/${jobId}`, { headers: authHeaders });
          if (!res.ok) continue;
          const job = await res.json();
          if (job.status === "done") return job.result;
          if (job.status === "failed") throw new Error(job.error || "Transcription job failed");
        }
        throw new Error("Transcription is taking too long. Please try again or use a shorter clip.");
      };

      const uploadOne = async (chunk: Blob, name: string): Promise<any> => {
        const form = new FormData();
        form.append("audio", chunk, name);
        form.append("language", "auto");
        let res: Response;
        try {
          res = await fetch("/api/groq/transcribe", {
            method: "POST",
            body: form,
            headers: authHeaders,
          });
        } catch (netErr: any) {
          // Retry once on network failure
          await new Promise((r) => setTimeout(r, 1500));
          try {
            res = await fetch("/api/groq/transcribe", {
              method: "POST",
              body: form,
              headers: authHeaders,
            });
          } catch {
            throw new Error("Network error — check your connection and try again. Long files need a stable signal.");
          }
        }
        if (res.status === 202) {
          const { jobId } = await res.json();
          if (!jobId) throw new Error("Server queued the job but returned no id");
          return pollJob(jobId);
        }
        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: "Unknown error" }));
          throw new Error(err.message || err.error || err.detail || "Transcription failed");
        }
        return res.json();
      };

      // Prefer one upload for whole file — server converts, splits, and may run async
      const mime = fullBlob.type || "audio/webm";
      const ext = mime.includes("mp4") ? "mp4" : mime.includes("mp3") || mime.includes("mpeg") ? "mp3" : mime.includes("wav") ? "wav" : "webm";
      let data: any;
      try {
        data = await uploadOne(fullBlob, `recording.${ext}`);
      } catch (e: any) {
        // Fallback: try smaller byte chunks if full upload failed (network)
        if (fullBlob.size > 3 * 1024 * 1024) {
          const chunks = splitBlob(fullBlob, 3 * 1024 * 1024);
          const allTexts: string[] = [];
          const allSegments: TranscriptSegment[] = [];
          let timeOffset = 0;
          let lang = "";
          for (let i = 0; i < chunks.length; i++) {
            const part = await uploadOne(chunks[i], `part${i + 1}.${ext}`);
            if (part.text) allTexts.push(part.text.trim());
            if (part.language && !lang) lang = part.language;
            if (part.segments) {
              allSegments.push(...part.segments.map((s: TranscriptSegment) => ({
                ...s,
                start: (s.start || 0) + timeOffset,
                end: (s.end || 0) + timeOffset,
              })));
            }
            if (part.duration) timeOffset += part.duration;
          }
          data = { text: allTexts.join(" "), segments: allSegments, language: lang };
        } else {
          throw e;
        }
      }

      const fullText = (data.text || "").trim();
      setTranscript(fullText);
      setSegments(data.segments || []);
      setDetectedLanguage(data.language || "");
      if (fullText) toast({ title: "Transcription complete" });
      else toast({ title: "No speech detected", variant: "destructive" });
    } catch (err: any) {
      const msg = err?.message || "Could not transcribe";
      toast({
        title: "Transcription failed",
        description: msg === "Failed to fetch"
          ? "Network error — the upload was interrupted. Try Wi‑Fi or a shorter file."
          : msg,
        variant: "destructive",
      });
    } finally {
      setIsTranscribing(false);
    }
  }, [audioBlobs, toast]);

  const formatNotes = useCallback(async () => {
    if (!transcript) return;
    setIsFormatting(true);
    try {
      const res = await authFetch("/api/groq/format-notes", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transcript: transcript.slice(0, 50000), subject: selectedNotebook?.name || "",
          lecturer: selectedNotebook?.meta?.lecturer || "", topic: selectedTopic?.name || "",
          date: new Date().toISOString().slice(0, 10), hasPhotos: photos.length > 0,
          photoCount: photos.length, segments: segments.slice(0, 200),
        }),
      });
      if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || err.message || "Format failed"); }
      const data = await res.json();
      setFormattedNotes(data.notes || transcript); setView("formatted");
      toast({ title: "Notes formatted" });
    } catch (err: any) {
      toast({ title: "Format failed", description: err?.message, variant: "destructive" });
    } finally { setIsFormatting(false); }
  }, [transcript, selectedNotebook, selectedTopic, photos, segments, toast]);


  const applyTopicPage = useCallback((page: TopicPage | null) => {
    const s = loadPageIntoState(page);
    setTranscript(s.transcript);
    setFormattedNotes(s.formattedNotes);
    setSegments(s.segments);
    setRecordingDuration(s.duration);
    setPhotos(s.photos);
    setDetectedLanguage(s.language || "");
    if (s.recordingUrl) {
      setAudioUrl(s.recordingUrl);
      setAudioBlobs([]);
    } else {
      setAudioUrl(null);
      setAudioBlobs([]);
    }
    // stop any segment playback
    try { segAudioRef.current?.pause(); } catch {}
    setPlayingSegIndex(null);
    setIsSegPlaying(false);
  }, []);

  const stopSegmentAudio = useCallback(() => {
    try {
      const a = segAudioRef.current || audioElRef.current;
      if (a) { a.pause(); }
    } catch {}
    setIsSegPlaying(false);
    setPlayingSegIndex(null);
  }, []);

  const playSegmentAt = useCallback((index: number, start: number) => {
    const src = audioUrl;
    if (!src) {
      toast({ title: "No recording", description: "This page has no audio to play.", variant: "destructive" });
      return;
    }
    // Stop previous
    try {
      if (segAudioRef.current && segAudioRef.current !== audioElRef.current) {
        segAudioRef.current.pause();
      }
    } catch {}
    let audio = audioElRef.current;
    if (!audio) {
      audio = new Audio(src);
      segAudioRef.current = audio;
    } else {
      if (audio.src !== src && !audio.src.endsWith(src) && audio.src !== src) {
        audio.src = src;
      }
      segAudioRef.current = audio;
    }
    const onEnded = () => { setIsSegPlaying(false); setPlayingSegIndex(null); };
    audio.onended = onEnded;
    try {
      audio.currentTime = Math.max(0, start || 0);
      const p = audio.play();
      if (p && typeof p.then === "function") p.catch(() => {});
      setPlayingSegIndex(index);
      setIsSegPlaying(true);
    } catch {
      toast({ title: "Could not play", variant: "destructive" });
    }
  }, [audioUrl, toast]);

  const toggleSegmentPlay = useCallback((index: number, start: number) => {
    if (playingSegIndex === index && isSegPlaying) {
      try { (segAudioRef.current || audioElRef.current)?.pause(); } catch {}
      setIsSegPlaying(false);
      return;
    }
    if (playingSegIndex === index && !isSegPlaying) {
      try {
        const a = segAudioRef.current || audioElRef.current;
        a?.play().catch(() => {});
        setIsSegPlaying(true);
      } catch {}
      return;
    }
    playSegmentAt(index, start);
  }, [playingSegIndex, isSegPlaying, playSegmentAt]);

  const saveToTopic = useCallback(async () => {
    if (!selectedNotebook || !selectedTopic) {
      toast({ title: "Open a topic first", variant: "destructive" });
      return;
    }
    setIsSaving(true);
    try {
      // Persist photos
      const permanentPhotos: string[] = [];
      for (let i = 0; i < photos.length; i++) {
        const ph = photos[i];
        if (!ph) continue;
        if (ph.startsWith("http://") || ph.startsWith("https://")) {
          permanentPhotos.push(ph);
          continue;
        }
        let uploaded: { url: string } | null = null;
        if (ph.startsWith("data:")) {
          uploaded = await uploadPermanentMedia(selectedNotebook.id, {
            dataUrl: ph,
            name: `board-${selectedTopic.id}-${i + 1}.jpg`,
            topicId: selectedTopic.id,
            role: "board_photo",
          });
        } else if (ph.startsWith("blob:") && navigator.onLine) {
          try {
            const blob = await fetch(ph).then((r) => r.blob());
            uploaded = await uploadPermanentMedia(selectedNotebook.id, {
              file: blob,
              name: `board-${selectedTopic.id}-${i + 1}.jpg`,
              mimeType: blob.type || "image/jpeg",
              topicId: selectedTopic.id,
              role: "board_photo",
            });
          } catch {}
        }
        if (uploaded?.url) permanentPhotos.push(uploaded.url);
      }
      setPhotos(permanentPhotos);

      // Persist recording
      let recordingUrl: string | undefined;
      // Prefer already-permanent URL if present
      if (audioUrl && (audioUrl.startsWith("http://") || audioUrl.startsWith("https://"))) {
        recordingUrl = audioUrl;
      } else if (audioBlobs.length > 0 && navigator.onLine) {
        const blob = audioBlobs[0];
        const ext = (blob.type || "").includes("mp4")
          ? "mp4"
          : (blob.type || "").includes("mpeg") || (blob.type || "").includes("mp3")
            ? "mp3"
            : "webm";
        const uploadedAudio = await uploadPermanentMedia(selectedNotebook.id, {
          file: blob,
          name: `recording-${selectedTopic.id}-p${topicPages.length + 1}.${ext}`,
          mimeType: blob.type || "audio/webm",
          topicId: selectedTopic.id,
          role: "lecture_recording",
        });
        if (uploadedAudio?.url) {
          recordingUrl = uploadedAudio.url;
          setAudioUrl(uploadedAudio.url);
        }
      }

      // Build NEW page and APPEND (never wipe previous pages)
      const existingDoc = parseTopicPayload(selectedTopic.extracted_text || selectedTopic.extractedText);
      let pages = getTopicPages(existingDoc);
      // Merge in memory pages if newer
      if (topicPages.length > pages.length) pages = [...topicPages];

      const nextNum = pages.length + 1;
      const newPage: TopicPage = {
        id: `page_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        pageNumber: nextNum,
        title: `Page ${nextNum}`,
        createdAt: new Date().toISOString(),
        transcript: (transcript || "").slice(0, 180_000),
        formattedNotes: (formattedNotes || transcript || "").slice(0, 180_000),
        segments: (segments || []).slice(0, 400),
        duration: recordingDuration,
        photos: permanentPhotos,
        photoCount: permanentPhotos.length,
        hasRecording: !!(recordingUrl || audioUrl || audioBlobs.length),
        recordingUrl,
        language: detectedLanguage,
        uploadedFiles: [
          ...(recordingUrl
            ? [{ name: "Lecture recording", type: "audio", url: recordingUrl, size: audioBlobs[0]?.size }]
            : []),
          ...permanentPhotos.map((url, i) => ({ name: `Board photo ${i + 1}`, type: "image", url })),
        ],
      };

      pages = [...pages, newPage];
      const doc: TopicPayload = { version: 2, pages };
      const content = JSON.stringify(doc);
      const size = new Blob([content]).size;
      if (size > TOPIC_STORAGE_LIMIT) {
        throw new Error(
          `This topic would exceed 50 MB (${formatBytes(size)}). Delete older pages or upgrade your plan.`
        );
      }

      const body = JSON.stringify({ name: selectedTopic.name, content });
      let res = await authFetch(
        `/api/kb/folders/${selectedNotebook.id}/files/${selectedTopic.id}`,
        { method: "PUT", headers: { "Content-Type": "application/json" }, body }
      );
      if (!res.ok) {
        res = await authFetch(`/api/kb/folders/${selectedNotebook.id}/files/text`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
        });
        if (res.ok) {
          try {
            await authFetch(
              `/api/kb/folders/${selectedNotebook.id}/files/${selectedTopic.id}`,
              { method: "DELETE" }
            );
          } catch {}
        }
      }
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || err.error || `Save failed (${res.status})`);
      }
      const saved = await res.json();
      const updatedTopic = {
        ...selectedTopic,
        ...saved,
        extracted_text: saved.extracted_text || content,
        size_bytes: size,
      };
      setSelectedTopic(updatedTopic);
      setTopicPages(pages);
      setSelectedPageIndex(pages.length - 1);
      applyTopicPage(newPage);
      refetchTopics();
      queryClient.invalidateQueries({ queryKey: ["/api/kb/folders"] });
      toast({
        title: `Saved as Page ${nextNum}`,
        description: `${pages.length} page${pages.length === 1 ? "" : "s"} in this topic · ${formatBytes(size)} / 50 MB`,
      });
      setView("topic");
      setTopicTab("note");
    } catch (err: any) {
      const msg = err?.message || "Could not save";
      toast({
        title: "Save failed",
        description:
          msg === "Failed to fetch"
            ? "Network error while saving. Check your connection and try again."
            : msg,
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  }, [
    selectedNotebook, selectedTopic, transcript, formattedNotes, segments,
    recordingDuration, photos, detectedLanguage, audioUrl, audioBlobs, topicPages,
    toast, refetchTopics, queryClient, applyTopicPage,
  ]);

  const openShare = async (forcePublic?: boolean) => {
    if (!selectedNotebook) return;
    const isPublic = forcePublic !== undefined ? forcePublic : sharePublic;
    if (forcePublic !== undefined) setSharePublic(forcePublic);
    try {
      const res = await authFetch(`/api/kb/folders/${selectedNotebook.id}/share`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ permission: isPublic ? "public" : "private" }),
      });
      if (res.ok) {
        const data = await res.json();
        const token = data.shareToken || data.share_code;
        setShareLink(`${window.location.origin}/shared/${token}`);
      } else setShareLink(`${window.location.origin}/live-session`);
    } catch { setShareLink(`${window.location.origin}/live-session`); }
    setShowShare(true);
  };

  const copyShare = async (target: "link" | "whatsapp" | "telegram" | "chat") => {
    if (!shareLink) return;
    if (target === "link" || target === "chat") { await navigator.clipboard.writeText(shareLink); toast({ title: "Link copied" }); }
    else if (target === "whatsapp") window.open(`https://wa.me/?text=${encodeURIComponent(shareLink)}`, "_blank");
    else if (target === "telegram") window.open(`https://t.me/share/url?url=${encodeURIComponent(shareLink)}`, "_blank");
  };

  const askLenory = () => {
    if (!selectedNotebook) return;
    const name = encodeURIComponent(selectedNotebook.name || "Notebook");
    // Chat expects newFolderSession + folderName to create a KB-scoped session
    setLocation(`/chat?newFolderSession=${selectedNotebook.id}&folderName=${name}`);
  };

  if (authLoading) return <div className="min-h-screen flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;
  if (!user) return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4 p-6">
      <p className="text-muted-foreground">Sign in to use Write My Note</p>
      <Button asChild><Link href="/login">Sign in</Link></Button>
    </div>
  );

  const notebookUsed = selectedNotebook ? selectedNotebook.storageUsed ?? selectedNotebook.storage_used ?? 0 : 0;
  const notebookPct = Math.min(100, Math.round((notebookUsed / FOLDER_STORAGE_LIMIT) * 100));

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {view === "home" && (
        <>
          <header className="sticky top-0 z-40 bg-background/90 backdrop-blur border-b px-4 py-3">
            <div className="max-w-lg mx-auto flex items-start justify-between gap-3">
              <div>
                <h1 className="text-xl font-bold tracking-tight">Hello, {firstName} <span aria-hidden>👋</span></h1>
                <p className="text-sm text-muted-foreground">Let's make your notes smarter.</p>
              </div>
              <div className="flex items-center gap-1">
                <ThemeToggle />
                <Button variant="ghost" size="icon" asChild><Link href="/dashboard"><ArrowLeft className="w-5 h-5" /></Link></Button>
              </div>
            </div>
          </header>
          <main className="flex-1 max-w-lg mx-auto w-full px-4 py-5 space-y-6">
            <div className="rounded-2xl bg-[#5B5CF0] text-white p-5 shadow-lg shadow-indigo-500/20">
              <div className="flex items-start gap-3 mb-4">
                <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center shrink-0"><BookOpen className="w-5 h-5" /></div>
                <div>
                  <h2 className="font-semibold text-base leading-tight">Your Notes, Powered by Lenory</h2>
                  <p className="text-sm text-white/85 mt-1 leading-snug">Record, upload, or sort notes. We'll turn everything into organized, format notes.</p>
                </div>
              </div>
              <button type="button" onClick={() => setShowCreateNotebook(true)} className="w-full rounded-xl bg-white text-[#5B5CF0] font-semibold py-3 px-4 flex items-center justify-center gap-2 hover:bg-white/95 transition" data-testid="button-create-notebook">
                <Plus className="w-5 h-5" /> Create New Notebook
              </button>
            </div>
            <div>
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold text-base">My Notebooks</h3>
                <span className="text-sm text-[#5B5CF0] font-medium">{folders.length > 0 ? `${folders.length}` : ""}</span>
              </div>
              {foldersLoading ? (
                <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
              ) : folders.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border p-8 text-center text-muted-foreground text-sm">No notebooks yet. Create one to start recording lectures.</div>
              ) : (
                <div className="space-y-2.5">
                  {folders.map((nb) => {
                    const used = nb.storageUsed ?? nb.storage_used ?? 0;
                    return (
                      <button key={nb.id} type="button" onClick={() => { setSelectedNotebook(nb); setView("notebook"); }}
                        className="w-full flex items-center gap-3 rounded-xl border border-border bg-card px-3.5 py-3.5 text-left hover:bg-muted/40 transition" data-testid={`notebook-${nb.id}`}>
                        <div className={`w-10 h-10 rounded-lg ${colorForId(nb.id)} flex items-center justify-center shrink-0`}><Folder className="w-5 h-5 text-white" /></div>
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-sm truncate">{nb.name}</p>
                          <p className="text-xs text-muted-foreground mt-0.5">{formatBytes(used)} / 100 MB{nb.updated_at || nb.created_at ? ` · Last updated ${relativeTime(nb.updated_at || nb.created_at)}` : ""}</p>
                        </div>
                        <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </main>
        </>
      )}

      {view === "notebook" && selectedNotebook && (
        <>
          <header className="sticky top-0 z-40 bg-background/90 backdrop-blur border-b px-4 py-3">
            <div className="max-w-lg mx-auto">
              <div className="flex items-center gap-2 mb-2">
                <Button variant="ghost" size="icon" onClick={() => { setSelectedNotebook(null); setView("home"); }}><ArrowLeft className="w-5 h-5" /></Button>
                <div className="flex-1 min-w-0">
                  <h1 className="font-bold text-lg truncate">{selectedNotebook.name}</h1>
                  <p className="text-xs text-muted-foreground">
                    {selectedNotebook.meta?.academicSession || selectedNotebook.meta?.semester
                      ? [selectedNotebook.meta?.academicSession, selectedNotebook.meta?.semester].filter(Boolean).join(" · ")
                      : "Notebook"}
                    {selectedNotebook.meta?.lecturer ? ` · ${selectedNotebook.meta.lecturer}` : ""}
                  </p>
                </div>
                <Button variant="ghost" size="icon" onClick={() => setShowSearch((s) => !s)}><Search className="w-5 h-5" /></Button>
              </div>
              <div className="px-1">
                <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
                  <span className="flex items-center gap-1"><HardDrive className="w-3.5 h-3.5" />{formatBytes(notebookUsed)} / 100 MB</span>
                  <span>{notebookPct}%</span>
                </div>
                <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                  <div className={`h-full rounded-full transition-all ${notebookPct >= 90 ? "bg-red-500" : notebookPct >= 70 ? "bg-amber-500" : "bg-primary"}`} style={{ width: `${notebookPct}%` }} />
                </div>
                {notebookPct >= 90 && <p className="text-xs text-red-500 mt-1">Storage almost full — upgrade plan or delete topics.</p>}
              </div>
            </div>
          </header>
          <main className="flex-1 max-w-lg mx-auto w-full px-4 py-4 space-y-4">
            {showSearch && (
              <input value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Search topics…" className="w-full px-3 py-2 text-sm rounded-lg bg-muted/40 border border-border focus:outline-none focus:ring-1 focus:ring-primary" autoFocus />
            )}
            <div className="flex flex-wrap gap-2">
              <Button size="sm" className="gap-1.5" onClick={() => setShowCreateTopic(true)} data-testid="button-add-topic"><Plus className="w-4 h-4" />Add New Topic</Button>
              <Button size="sm" variant="outline" className="gap-1.5" onClick={askLenory}><MessageSquare className="w-4 h-4" />Ask Lenory</Button>
              <Button size="sm" variant="outline" className="gap-1.5" onClick={() => openShare()}><Share2 className="w-4 h-4" />Share</Button>
            </div>
            {topicsLoading ? (
              <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
            ) : topicFiles.length === 0 ? (
              <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">No topics yet. Add a topic, then record or upload a lecture.</div>
            ) : (
              <div className="space-y-2">
                {topicFiles.filter((t) => !searchQuery || t.name.toLowerCase().includes(searchQuery.toLowerCase()) || (t.extracted_text || t.extractedText || "").toLowerCase().includes(searchQuery.toLowerCase())).map((t) => {
                  const size = t.size_bytes ?? t.sizeBytes ?? 0;
                  const pageCount = getTopicPages(parseTopicPayload(t.extracted_text || t.extractedText)).length;
                  return (
                    <div key={t.id} className="flex items-center gap-2 rounded-xl border bg-card px-3 py-3">
                      <button type="button" className="flex-1 flex items-center gap-3 text-left min-w-0" onClick={() => {
                        setSelectedTopic(t);
                        const payload = parseTopicPayload(t.extracted_text || t.extractedText);
                        const pages = getTopicPages(payload);
                        setTopicPages(pages);
                        const idx = Math.max(0, pages.length - 1);
                        setSelectedPageIndex(idx);
                        const page = pages[idx] || null;
                        applyTopicPage(page);
                        setTopicTab(page?.formattedNotes ? "note" : "live");
                        setView("topic");
                      }}>
                        <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0"><FileText className="w-4 h-4 text-primary" /></div>
                        <div className="min-w-0">
                          <p className="font-medium text-sm truncate">{t.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {pageCount > 0 ? `${pageCount} page${pageCount === 1 ? "" : "s"} · ` : ""}
                            {formatBytes(size)} / 50 MB · {relativeTime(t.created_at || t.createdAt)}
                          </p>
                        </div>
                      </button>
                      <Button variant="ghost" size="icon" className="shrink-0" onClick={() => { if (confirm(`Delete "${t.name}" permanently?`)) deleteTopicMutation.mutate(t.id); }}><Trash2 className="w-4 h-4 text-destructive" /></Button>
                      <Button variant="ghost" size="icon" className="shrink-0" onClick={() => { setSelectedTopic(t); openShare(); }}><Share2 className="w-4 h-4" /></Button>
                    </div>
                  );
                })}
              </div>
            )}
          </main>
        </>
      )}
      {view === "topic" && selectedTopic && selectedNotebook && (
        <>
          <header className="sticky top-0 z-40 bg-background/90 backdrop-blur border-b px-4 py-3">
            <div className="max-w-lg mx-auto flex items-center gap-2">
              <Button variant="ghost" size="icon" onClick={() => { stopSegmentAudio(); setSelectedTopic(null); setView("notebook"); }}><ArrowLeft className="w-5 h-5" /></Button>
              <div className="flex-1 min-w-0">
                <h1 className="font-bold text-base truncate">{selectedTopic.name}</h1>
                <p className="text-xs text-muted-foreground">
                  {selectedNotebook.name}
                  {topicPages.length > 0 ? ` · ${topicPages.length} page${topicPages.length === 1 ? "" : "s"} · ${formatBytes(selectedTopic.size_bytes ?? selectedTopic.sizeBytes ?? 0)} / 50 MB` : ""}
                </p>
              </div>
            </div>
          </header>
          <main className="flex-1 max-w-lg mx-auto w-full px-4 py-4 space-y-4">
            {/* Page selector — each save/upload is a numbered page */}
            {topicPages.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Pages in this topic</p>
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {topicPages.map((pg, idx) => (
                    <button
                      key={pg.id}
                      type="button"
                      onClick={() => {
                        stopSegmentAudio();
                        setSelectedPageIndex(idx);
                        applyTopicPage(pg);
                        setTopicTab(pg.formattedNotes ? "note" : "live");
                      }}
                      className={`shrink-0 rounded-lg border px-3 py-2 text-left min-w-[7rem] transition ${
                        selectedPageIndex === idx ? "border-primary bg-primary/10 ring-1 ring-primary" : "bg-card hover:bg-muted/40"
                      }`}
                    >
                      <p className="text-sm font-semibold">Page {pg.pageNumber}</p>
                      <p className="text-[10px] text-muted-foreground truncate">
                        {pg.title || relativeTime(pg.createdAt)}
                        {pg.hasRecording || pg.recordingUrl ? " · 🎧" : ""}
                      </p>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              <Button size="sm" className="gap-1.5" onClick={() => { stopSegmentAudio(); setShowStartRecCard(true); }}><Mic className="w-4 h-4" />Record</Button>
              <Button size="sm" variant="outline" className="gap-1.5" onClick={() => fileInputRef.current?.click()}><Upload className="w-4 h-4" />Upload</Button>
              <Button size="sm" variant="outline" className="gap-1.5" onClick={() => videoInputRef.current?.click()}><FileText className="w-4 h-4" />Video</Button>
              <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setShowVideoUrl(true)}><Link2 className="w-4 h-4" />Link</Button>
            </div>
            <input ref={fileInputRef} type="file" accept="audio/*,.mp3,.wav,.webm,.m4a,.ogg,.aac,.flac" className="hidden" onChange={handleUploadRecording} />
            <input ref={videoInputRef} type="file" accept="video/*,.mp4,.webm,.mov" className="hidden" onChange={handleUploadRecording} />

            {(transcript || formattedNotes || audioUrl || photos.length > 0 || topicPages.length > 0) ? (
              <>
                <div className="flex rounded-lg border p-0.5 bg-muted/30">
                  <button type="button" className={`flex-1 text-sm py-2 rounded-md font-medium transition ${topicTab === "live" ? "bg-background shadow-sm" : "text-muted-foreground"}`} onClick={() => setTopicTab("live")}>Live Class</button>
                  <button type="button" className={`flex-1 text-sm py-2 rounded-md font-medium transition ${topicTab === "note" ? "bg-background shadow-sm" : "text-muted-foreground"}`} onClick={() => setTopicTab("note")}>Note</button>
                </div>

                {topicTab === "live" && (
                  <div className="space-y-4">
                    <div className="rounded-xl border bg-card p-4 space-y-2">
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                        Recording · Page {topicPages[selectedPageIndex]?.pageNumber || 1}
                      </p>
                      {audioUrl ? (
                        <>
                          <audio
                            ref={audioElRef}
                            controls
                            src={audioUrl}
                            className="w-full h-10"
                            onPlay={() => setIsSegPlaying(true)}
                            onPause={() => setIsSegPlaying(false)}
                            onEnded={() => { setIsSegPlaying(false); setPlayingSegIndex(null); }}
                          />
                          <p className="text-xs text-muted-foreground">
                            Duration {formatDuration(recordingDuration)}
                            {audioUrl.startsWith("http") ? " · Saved permanently" : ""}
                          </p>
                        </>
                      ) : (
                        <p className="text-sm text-muted-foreground">
                          No recording on this page yet. Record or upload, then save to keep it permanently on this page.
                        </p>
                      )}
                    </div>

                    <div className="rounded-xl border bg-card p-4 space-y-2">
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Transcript</p>
                      {transcript ? (
                        segments.length > 0 ? (
                          <div className="space-y-1 max-h-80 overflow-y-auto">
                            {segments.slice(0, 120).map((s, i) => {
                              const active = playingSegIndex === i;
                              return (
                                <div
                                  key={i}
                                  className={`flex items-start gap-2 rounded-lg px-2 py-1.5 text-sm ${active ? "bg-primary/10 ring-1 ring-primary/40" : "hover:bg-muted/50"}`}
                                >
                                  <button
                                    type="button"
                                    className="mt-0.5 shrink-0 w-7 h-7 rounded-full border flex items-center justify-center bg-background"
                                    title={active && isSegPlaying ? "Pause" : "Play from here"}
                                    onClick={() => toggleSegmentPlay(i, s.start || 0)}
                                  >
                                    {active && isSegPlaying ? (
                                      <Pause className="w-3.5 h-3.5" />
                                    ) : (
                                      <Play className="w-3.5 h-3.5" />
                                    )}
                                  </button>
                                  {active && (
                                    <button
                                      type="button"
                                      className="mt-0.5 shrink-0 w-7 h-7 rounded-full border flex items-center justify-center bg-background text-destructive"
                                      title="Stop"
                                      onClick={stopSegmentAudio}
                                    >
                                      <Square className="w-3 h-3 fill-current" />
                                    </button>
                                  )}
                                  <button
                                    type="button"
                                    className="flex-1 text-left min-w-0"
                                    onClick={() => toggleSegmentPlay(i, s.start || 0)}
                                  >
                                    <span className="text-xs font-mono text-primary mr-2">{formatDuration(s.start || 0)}</span>
                                    {s.text}
                                  </button>
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          <pre className="whitespace-pre-wrap text-sm font-sans max-h-64 overflow-y-auto">{transcript}</pre>
                        )
                      ) : (
                        <p className="text-sm text-muted-foreground">No transcript on this page yet.</p>
                      )}
                    </div>

                    <div className="rounded-xl border bg-card p-4 space-y-3">
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Uploaded Files</p>
                      {photos.length === 0 && !audioUrl ? (
                        <p className="text-sm text-muted-foreground">No files on this page yet.</p>
                      ) : (
                        <div className="space-y-2">
                          {audioUrl && (
                            <div className="flex items-center gap-2 text-sm rounded-lg border px-3 py-2">
                              <Mic className="w-4 h-4 text-primary shrink-0" />
                              <span className="truncate">Lecture recording</span>
                              <span className="text-xs text-muted-foreground ml-auto">{formatDuration(recordingDuration)}</span>
                            </div>
                          )}
                          {photos.map((src, i) => (
                            <div key={i} className="flex items-center gap-3 rounded-lg border px-3 py-2">
                              <img src={src} alt="" className="w-12 h-12 object-cover rounded bg-muted" />
                              <div className="min-w-0 flex-1">
                                <p className="text-sm font-medium truncate">Board photo {i + 1}</p>
                                <p className="text-xs text-muted-foreground">
                                  {src.startsWith("http") ? "Saved permanently" : "Local (will upload on save)"}
                                </p>
                              </div>
                              {src.startsWith("http") && (
                                <a href={src} target="_blank" rel="noreferrer" className="text-xs text-primary shrink-0">Open</a>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {topicTab === "note" && (
                  <div className="rounded-xl border bg-card p-4 prose prose-sm dark:prose-invert max-w-none">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide not-prose mb-2">
                      Note · Page {topicPages[selectedPageIndex]?.pageNumber || 1}
                    </p>
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {formattedNotes || "No formatted notes on this page yet. Use Format Note after transcription, then Save."}
                    </ReactMarkdown>
                  </div>
                )}
              </>
            ) : (
              <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground space-y-3">
                <p>Record a lecture or upload audio/video. Each save creates a new <strong>page</strong> in this topic (counts toward 50 MB).</p>
                <div className="flex justify-center gap-2">
                  <Button onClick={() => setShowStartRecCard(true)} className="gap-2">
                    <Mic className="w-4 h-4" />Start Recording
                  </Button>
                </div>
              </div>
            )}
          </main>
        </>
      )}

      {view === "recording" && (
        <>
          <header className="sticky top-0 z-40 bg-background/90 backdrop-blur border-b px-4 py-3">
            <div className="max-w-lg mx-auto flex items-center gap-2">
              <Button variant="ghost" size="icon" onClick={() => { if (isRecording && !confirm("Stop recording and leave?")) return; if (isRecording) stopRecording(); setView(selectedTopic ? "topic" : "notebook"); }}><ArrowLeft className="w-5 h-5" /></Button>
              <div className="flex-1">
                <h1 className="font-bold text-base">Recording</h1>
                <p className="text-xs text-muted-foreground">{selectedTopic?.name || "Lecture"} · mono · local chunks</p>
              </div>
              <Button variant="outline" size="icon" onClick={() => cameraInputRef.current?.click()} disabled={!isRecording} title="Snap board photo"><Camera className="w-5 h-5" /></Button>
              {photos.length > 0 && <Badge variant="secondary" className="gap-1"><ImageIcon className="w-3 h-3" />{photos.length}</Badge>}
              <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handleCameraCapture} />
            </div>
          </header>
          <main className="flex-1 max-w-lg mx-auto w-full px-4 py-8 flex flex-col items-center gap-6">
            {showOfflineNotice && (
              <div className="w-full rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm flex gap-2">
                <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0" />
                <div>
                  <p className="font-medium text-amber-700 dark:text-amber-300">Tip: turn off mobile data while recording</p>
                  <p className="text-muted-foreground text-xs mt-0.5">Capture runs fully offline. Process notes after class when online.</p>
                </div>
                <button type="button" onClick={() => setShowOfflineNotice(false)} className="shrink-0"><X className="w-4 h-4" /></button>
              </div>
            )}
            <div className={`relative w-36 h-36 rounded-full flex items-center justify-center transition-all ${isRecording && !isPaused ? "bg-red-500/20 ring-4 ring-red-500/30 shadow-[0_0_50px_rgba(239,68,68,0.3)]" : isPaused ? "bg-amber-500/20 ring-4 ring-amber-500/30" : "bg-muted/40 ring-4 ring-border"}`}>
              {isRecording && !isPaused && <div className="absolute inset-0 rounded-full animate-ping bg-red-500/10" />}
              <div className="flex flex-col items-center gap-1">
                <Mic className={`w-12 h-12 ${isRecording && !isPaused ? "text-red-500" : isPaused ? "text-amber-500" : "text-muted-foreground"}`} />
                <span className="font-mono font-bold tabular-nums text-lg">{formatDuration(recordingDuration)}</span>
              </div>
            </div>
            <p className="text-sm text-muted-foreground text-center">
              {isRecording && !isPaused && "Recording in progress…"}
              {isPaused && "Paused — tap Resume to continue"}
              {!isRecording && audioUrl && "Recording complete"}
              {!isRecording && !audioUrl && "Ready"}
            </p>
            {quietPeriod && isRecording && (
              <p className="text-xs text-amber-600 dark:text-amber-400">Quiet period detected — still recording (audio is never discarded)</p>
            )}
            <button type="button" className="text-xs text-primary underline" onClick={() => setShowSilenceSettings(true)}>
              Silence detection settings
            </button>
            <div className="flex flex-wrap items-center justify-center gap-3">
              {isRecording && (
                <>
                  <Button variant="outline" size="lg" className="gap-2" onClick={pauseResumeRecording}>{isPaused ? <Play className="w-5 h-5" /> : <Pause className="w-5 h-5" />}{isPaused ? "Resume" : "Pause"}</Button>
                  <Button variant="destructive" size="lg" className="gap-2 px-8" onClick={stopRecording}><Square className="w-4 h-4" />Stop</Button>
                </>
              )}
              {!isRecording && audioUrl && (
                <>
                  <Button size="lg" className="gap-2 px-8" onClick={transcribeAudio} disabled={isTranscribing}>
                    {isTranscribing ? <Loader2 className="w-5 h-5 animate-spin" /> : <BookOpen className="w-5 h-5" />}Generate My Notes
                  </Button>
                  <Button variant="outline" size="lg" onClick={() => setShowStartRecCard(true)}>Record Again</Button>
                </>
              )}
            </div>
            {audioUrl && !isRecording && (
              <div className="w-full max-w-sm space-y-1">
                <p className="text-xs text-muted-foreground text-center">Duration {formatDuration(recordingDuration)} · ~{formatBytes(audioBlobs[0]?.size || 0)}</p>
                <audio ref={audioElRef} controls src={audioUrl} className="w-full h-10" />
              </div>
            )}
            {photos.length > 0 && (
              <div className="w-full">
                <p className="text-xs font-medium text-muted-foreground mb-2">Board photos</p>
                <div className="flex gap-2 overflow-x-auto pb-1">{photos.map((src, i) => <img key={i} src={src} alt="" className="h-20 w-20 object-cover rounded-lg border" />)}</div>
              </div>
            )}
          </main>
        </>
      )}

      {view === "transcript" && (
        <>
          <header className="sticky top-0 z-40 bg-background/90 backdrop-blur border-b px-4 py-3">
            <div className="max-w-lg mx-auto flex items-center gap-2 flex-wrap">
              <Button variant="ghost" size="icon" onClick={() => setView(audioUrl ? "recording" : "topic")}><ArrowLeft className="w-5 h-5" /></Button>
              <h1 className="font-bold text-base flex-1">Transcription</h1>
              {detectedLanguage && <Badge variant="secondary" className="text-xs uppercase">{detectedLanguage}</Badge>}
            </div>
            <div className="max-w-lg mx-auto flex flex-wrap gap-2 mt-2">
              <Button size="sm" className="gap-1" onClick={formatNotes} disabled={!transcript || isFormatting}>{isFormatting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <BookOpen className="w-3.5 h-3.5" />}Format Note</Button>
              <Button size="sm" variant="outline" className="gap-1" onClick={saveToTopic} disabled={!transcript || isSaving}>{isSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}Save Transcription</Button>
              {audioUrl && <Button size="sm" variant="outline" className="gap-1" onClick={() => audioElRef.current?.play()}><Play className="w-3.5 h-3.5" />Play</Button>}
              <Button size="sm" variant="outline" className="gap-1" onClick={() => { setIsEditingTranscript(true); setEditDraft(transcript); }}><Pencil className="w-3.5 h-3.5" />Edit</Button>
            </div>
          </header>
          <main className="flex-1 max-w-lg mx-auto w-full px-4 py-4 space-y-4">
            {isTranscribing && (
              <div className="flex items-center gap-3 p-4 rounded-xl bg-primary/10 border border-primary/20">
                <Loader2 className="w-5 h-5 animate-spin text-primary" />
                <div><p className="text-sm font-medium">Transcribing With Lenory</p><p className="text-xs text-muted-foreground">Long audio is processed in chunks</p></div>
              </div>
            )}
            {audioUrl && <audio ref={audioElRef} controls src={audioUrl} className="w-full h-10" />}
            {!transcript && !isTranscribing && audioUrl && (
              <div className="text-center space-y-3 py-8">
                <p className="text-sm text-muted-foreground">Audio ready. Generate a transcript.</p>
                <Button onClick={transcribeAudio} className="gap-2"><BookOpen className="w-4 h-4" />Generate My Notes</Button>
              </div>
            )}
            {isEditingTranscript ? (
              <div className="space-y-2">
                <textarea value={editDraft} onChange={(e) => setEditDraft(e.target.value)} className="w-full min-h-[240px] p-3 text-sm rounded-xl border bg-card focus:outline-none focus:ring-1 focus:ring-primary" />
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => { setTranscript(editDraft); setIsEditingTranscript(false); toast({ title: "Transcript updated" }); }}>Save edits</Button>
                  <Button size="sm" variant="ghost" onClick={() => setIsEditingTranscript(false)}>Cancel</Button>
                </div>
              </div>
            ) : transcript ? (
              <div className="rounded-xl border bg-card p-4 space-y-3">
                {segments.length > 0 ? segments.map((s, i) => (
                  <button
                    key={i}
                    type="button"
                    className="text-sm text-left w-full rounded-lg px-2 py-1.5 hover:bg-muted/50 transition"
                    onClick={() => {
                      const el = audioElRef.current;
                      if (el && Number.isFinite(s.start)) {
                        el.currentTime = Math.max(0, s.start);
                        el.play().catch(() => {});
                      }
                    }}
                    title="Tap to replay this part of the recording"
                  >
                    <span className="text-xs font-mono text-primary mr-2">{formatDuration(s.start || 0)}</span>
                    <span>{s.text}</span>
                  </button>
                )) : <p className="text-sm whitespace-pre-wrap leading-relaxed">{transcript}</p>}
              </div>
            ) : null}
          </main>
        </>
      )}

      {view === "formatted" && (
        <>
          <header className="sticky top-0 z-40 bg-background/90 backdrop-blur border-b px-4 py-3">
            <div className="max-w-lg mx-auto flex items-center gap-2">
              <Button variant="ghost" size="icon" onClick={() => setView("transcript")}><ArrowLeft className="w-5 h-5" /></Button>
              <h1 className="font-bold text-base flex-1">Formatted Note</h1>
              <Button size="sm" className="gap-1" onClick={saveToTopic} disabled={isSaving}>{isSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}Save To Topic File</Button>
            </div>
          </header>
          <main className="flex-1 max-w-lg mx-auto w-full px-4 py-4">
            <article className="prose prose-sm dark:prose-invert max-w-none rounded-xl border bg-card p-5">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{formattedNotes}</ReactMarkdown>
            </article>
            {photos.length > 0 && (
              <div className="mt-4 space-y-2">
                <p className="text-sm font-medium">Lecture photographs</p>
                <div className="grid grid-cols-2 gap-2">{photos.map((src, i) => <img key={i} src={src} alt="" className="rounded-lg border object-cover w-full aspect-video" />)}</div>
              </div>
            )}
          </main>
        </>
      )}
      {showCreateNotebook && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-2xl bg-background border shadow-xl p-5 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h2 className="font-bold text-lg">Create New Notebook</h2>
              <Button variant="ghost" size="icon" onClick={() => setShowCreateNotebook(false)}><X className="w-5 h-5" /></Button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground">Subject / Course Name *</label>
                <input value={nbName} onChange={(e) => setNbName(e.target.value)} placeholder="e.g. Biology, CSC 201" className="mt-1 w-full px-3 py-2 text-sm rounded-lg border bg-muted/30 focus:outline-none focus:ring-1 focus:ring-primary" />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Academic session</label>
                <input value={nbSession} onChange={(e) => setNbSession(e.target.value)} placeholder="e.g. 2025/2026" className="mt-1 w-full px-3 py-2 text-sm rounded-lg border bg-muted/30 focus:outline-none focus:ring-1 focus:ring-primary" />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Semester or term</label>
                <input value={nbSemester} onChange={(e) => setNbSemester(e.target.value)} placeholder="e.g. First Semester" className="mt-1 w-full px-3 py-2 text-sm rounded-lg border bg-muted/30 focus:outline-none focus:ring-1 focus:ring-primary" />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Optional lecturer or teacher name</label>
                <input value={nbLecturer} onChange={(e) => setNbLecturer(e.target.value)} placeholder="e.g. Dr. Okonkwo" className="mt-1 w-full px-3 py-2 text-sm rounded-lg border bg-muted/30 focus:outline-none focus:ring-1 focus:ring-primary" />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Optional tags</label>
                <input value={nbTags} onChange={(e) => setNbTags(e.target.value)} placeholder="comma-separated, e.g. exam, practical" className="mt-1 w-full px-3 py-2 text-sm rounded-lg border bg-muted/30 focus:outline-none focus:ring-1 focus:ring-primary" />
              </div>
              <p className="text-xs text-muted-foreground">Each notebook gets <strong>100 MB</strong> storage. Topics inside are capped at <strong>50 MB</strong> each.</p>
            </div>
            <Button className="w-full" disabled={!nbName.trim() || createNotebookMutation.isPending} onClick={() => createNotebookMutation.mutate()}>
              {createNotebookMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Create Notebook"}
            </Button>
          </div>
        </div>
      )}

      {showCreateTopic && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-2xl bg-background border shadow-xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-bold text-lg">Add New Topic</h2>
              <Button variant="ghost" size="icon" onClick={() => setShowCreateTopic(false)}><X className="w-5 h-5" /></Button>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Topic title</label>
              <input value={topicName} onChange={(e) => setTopicName(e.target.value)} placeholder="e.g. Cell Division — Week 3" className="mt-1 w-full px-3 py-2 text-sm rounded-lg border bg-muted/30 focus:outline-none focus:ring-1 focus:ring-primary" />
            </div>
            <div className="flex items-center justify-center gap-6 py-4 border rounded-xl bg-muted/20">
              <button type="button" className="flex flex-col items-center gap-1 text-sm" onClick={() => {
                if (!topicName.trim()) { toast({ title: "Enter a topic title first", variant: "destructive" }); return; }
                createTopicMutation.mutate(topicName.trim(), { onSuccess: () => setShowStartRecCard(true) });
              }}>
                <div className="w-14 h-14 rounded-full bg-red-500/15 flex items-center justify-center"><Mic className="w-7 h-7 text-red-500" /></div>
                Record
              </button>
              <button type="button" className="flex flex-col items-center gap-1 text-sm" onClick={() => {
                if (!topicName.trim()) { toast({ title: "Enter a topic title first", variant: "destructive" }); return; }
                createTopicMutation.mutate(topicName.trim(), { onSuccess: () => fileInputRef.current?.click() });
              }}>
                <div className="w-14 h-14 rounded-full bg-primary/15 flex items-center justify-center"><Plus className="w-7 h-7 text-primary" /></div>
                Upload
              </button>
            </div>
            <Button className="w-full" disabled={!topicName.trim() || createTopicMutation.isPending} onClick={() => createTopicMutation.mutate(topicName.trim())}>
              {createTopicMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Create Topic"}
            </Button>
          </div>
        </div>
      )}

      {showStartRecCard && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-background border shadow-xl p-6 space-y-4 text-center">
            <div className="w-16 h-16 rounded-full bg-red-500/15 flex items-center justify-center mx-auto"><Mic className="w-8 h-8 text-red-500" /></div>
            <h2 className="font-bold text-lg">Start Recording</h2>
            <p className="text-sm text-muted-foreground">LENORY records locally on your device (mono). Pause, resume, and snap board photos without stopping.</p>
            <Button className="w-full gap-2" size="lg" onClick={startRecording}><Mic className="w-5 h-5" />Start Recording</Button>
            <Button variant="ghost" className="w-full" onClick={() => setShowStartRecCard(false)}>Cancel</Button>
          </div>
        </div>
      )}

      {showShare && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-2xl bg-background border shadow-xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-bold text-lg">Share</h2>
              <Button variant="ghost" size="icon" onClick={() => setShowShare(false)}><X className="w-5 h-5" /></Button>
            </div>
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div className="flex items-center gap-2 text-sm">{sharePublic ? <Globe className="w-4 h-4" /> : <Lock className="w-4 h-4" />}{sharePublic ? "Public preview" : "Private (login required)"}</div>
              <button type="button" role="switch" aria-checked={sharePublic} onClick={() => {
                  const next = !sharePublic;
                  setSharePublic(next);
                  openShare(next);
                }} className={`w-11 h-6 rounded-full transition ${sharePublic ? "bg-primary" : "bg-muted"} relative`}>
                <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition ${sharePublic ? "left-5" : "left-0.5"}`} />
              </button>
            </div>
            <p className="text-xs text-muted-foreground">Private links require sign-in. Public previews hide original recordings unless explicitly shared.</p>
            <div className="grid grid-cols-2 gap-2">
              <Button variant="outline" className="gap-2" onClick={() => copyShare("chat")}><MessageSquare className="w-4 h-4" />Lenory Chat</Button>
              <Button variant="outline" className="gap-2" onClick={() => copyShare("whatsapp")}>WhatsApp</Button>
              <Button variant="outline" className="gap-2" onClick={() => copyShare("telegram")}>Telegram</Button>
              <Button variant="outline" className="gap-2" onClick={() => copyShare("link")}><Link2 className="w-4 h-4" />Copy link</Button>
            </div>
            {shareLink && <p className="text-xs break-all text-muted-foreground bg-muted/40 p-2 rounded-lg">{shareLink}</p>}
          </div>
        </div>
      )}

      {showSilenceSettings && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-background border shadow-xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-bold text-lg">Silence detection</h2>
              <Button variant="ghost" size="icon" onClick={() => setShowSilenceSettings(false)}><X className="w-5 h-5" /></Button>
            </div>
            <p className="text-sm text-muted-foreground">
              After 15s without speech, a quiet-period indicator appears. Audio is never deleted because of silence.
            </p>
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div className="text-sm pr-2">
                <p className="font-medium">Auto-pause on long silence</p>
                <p className="text-xs text-muted-foreground">After ~45s quiet, pause; resume when speech returns (experimental)</p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={autoPauseOnSilence}
                onClick={() => setAutoPauseOnSilence((v) => !v)}
                className={`w-11 h-6 rounded-full transition shrink-0 ${autoPauseOnSilence ? "bg-primary" : "bg-muted"} relative`}
              >
                <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition ${autoPauseOnSilence ? "left-5" : "left-0.5"}`} />
              </button>
            </div>
            <Button className="w-full" onClick={() => setShowSilenceSettings(false)}>Done</Button>
          </div>
        </div>
      )}

      {showVideoUrl && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-2xl bg-background border shadow-xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-bold text-lg">Paste video link</h2>
              <Button variant="ghost" size="icon" onClick={() => setShowVideoUrl(false)}><X className="w-5 h-5" /></Button>
            </div>
            <input
              value={videoUrlInput}
              onChange={(e) => setVideoUrlInput(e.target.value)}
              placeholder="https://youtube.com/… or Vimeo"
              className="w-full px-3 py-2 text-sm rounded-lg border bg-muted/30 focus:outline-none focus:ring-1 focus:ring-primary"
            />
            <p className="text-xs text-muted-foreground">
              Unsupported platforms show a notice. YouTube/Vimeo full download is restricted by policy — prefer uploading a file you are authorized to use.
            </p>
            <Button className="w-full" onClick={handleVideoUrlSubmit}>Continue</Button>
          </div>
        </div>
      )}
    </div>
  );
}
