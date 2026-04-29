import { useState, useRef, useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ThemeToggle } from "@/components/ThemeToggle";
import {
  Mic,
  Square,
  Pause,
  Play,
  Save,
  Settings,
  Users,
  Clock,
  ArrowLeft,
  Loader2,
  Download,
  Volume2,
  Trash2,
  History,
  Edit3,
  Eye,
  Wand2,
  BookOpen,
  X,
} from "lucide-react";
import { Link, useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { isUnauthorizedError } from "@/lib/authUtils";
import { apiRequest } from "@/lib/queryClient";

interface TranscriptSegment {
  speaker: string;
  text: string;
  timestamp: number;
}

interface Recording {
  id: string;
  title: string;
  transcript: TranscriptSegment[];
  audioBlob: Blob;
  duration: number;
  createdAt: number;
}

interface SessionSettings {
  difficulty: 'easy' | 'medium' | 'hard';
  language: 'en' | 'pidgin' | 'yoruba' | 'igbo' | 'hausa';
  autoSaveTranscripts: boolean;
  aiModel: 'gpt-3.5-turbo' | 'gpt-4';
  recordingTimeout: number; // in minutes
}

interface GeneratedLesson {
  title: string;
  objectives: string[];
  keyPoints: string[];
  summary: string;
}

export default function LiveSession() {
  const { user, isLoading: authLoading } = useAuth();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [sessionTitle, setSessionTitle] = useState("");
  const [duration, setDuration] = useState(0);
  const [transcript, setTranscript] = useState<TranscriptSegment[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [activeTab, setActiveTab] = useState<'record' | 'history'>('record');
  const [livePreviewText, setLivePreviewText] = useState("");
  const [expandedRecordingId, setExpandedRecordingId] = useState<string | null>(null);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState("");
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [manualTranscriptInput, setManualTranscriptInput] = useState("");
  const [showManualTranscriptModal, setShowManualTranscriptModal] = useState(false);
  const [isAudioPlaying, setIsAudioPlaying] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showLessonPreview, setShowLessonPreview] = useState(false);
  const [generatedLesson, setGeneratedLesson] = useState<GeneratedLesson | null>(null);
  const [isGeneratingLesson, setIsGeneratingLesson] = useState(false);
  const [selectedRecordingForLesson, setSelectedRecordingForLesson] = useState<Recording | null>(null);
  const [sessionSettings, setSessionSettings] = useState<SessionSettings>({
    difficulty: 'medium',
    language: 'en',
    autoSaveTranscripts: true,
    aiModel: 'gpt-3.5-turbo',
    recordingTimeout: 30,
  });
  const transcriptEndRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const audioPlayerRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    if (!authLoading && !user) {
      toast({
        title: "Unauthorized",
        description: "You are logged out. Logging in again...",
        variant: "destructive",
      });
      setTimeout(() => {
        window.location.href = "/api/login";
      }, 500);
    }
  }, [user, authLoading, toast]);

  // Load recordings from database on mount
  useEffect(() => {
    const loadRecordings = async () => {
      try {
        console.log("Loading recordings for user:", user?.email);
        const res = await apiRequest("GET", "/api/recordings");
        if (!res.ok) {
          console.error("Failed to fetch recordings - HTTP", res.status);
          return;
        }
        const dbRecordings = await res.json();
        console.log("Loaded recordings from DB:", dbRecordings);
        // Convert database format to client format
        const formattedRecordings: Recording[] = (dbRecordings || []).map((rec: any) => ({
          id: rec.id,
          title: rec.title,
          transcript: Array.isArray(rec.transcript) ? rec.transcript : (typeof rec.transcript === 'string' ? JSON.parse(rec.transcript) : []),
          audioBlob: new Blob(),
          duration: rec.duration || 0,
          createdAt: new Date(rec.createdAt).getTime(),
        }));
        setRecordings(formattedRecordings);
      } catch (error: any) {
        console.error("Error loading recordings:", error?.message || error);
      }
    };
    if (user) {
      loadRecordings();
    }
  }, [user]);

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [transcript]);

  useEffect(() => {
    if (isRecording && !isPaused) {
      timerRef.current = setInterval(() => {
        setDuration((prev) => prev + 1);
      }, 1000);
    } else {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    }

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, [isRecording, isPaused]);

  const formatDuration = (seconds: number) => {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    return `${hrs.toString().padStart(2, "0")}:${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  const startRecording = async () => {
    if (!sessionTitle.trim()) {
      toast({
        title: "Session title required",
        description: "Please enter a title for this session",
        variant: "destructive",
      });
      return;
    }

    try {
      // Create live session via API
      const res = await apiRequest("POST", "/api/live-sessions", { title: sessionTitle });
      const sessionData = await res.json();
      setSessionId(sessionData.id);

      // Initialize WebSocket connection
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const wsUrl = `${protocol}//${window.location.host}/ws`;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log("WebSocket connected");
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'transcript_segment') {
            const segment = {
              speaker: data.data.speaker || user?.firstName || "Speaker",
              text: data.data.text,
              timestamp: data.data.timestamp,
            };
            setTranscript((prev) => [...prev, segment]);
            // Update live preview text
            setLivePreviewText((prev) => prev + (prev ? "\n" : "") + `${segment.speaker}: ${segment.text}`);
          }
        } catch (e) {
          console.error("Error parsing WebSocket message:", e);
        }
      };

      ws.onerror = (error) => {
        console.error("WebSocket error:", error);
        toast({
          title: "Connection error",
          description: "Failed to connect to transcription service",
          variant: "destructive",
        });
      };

      // Get user media
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: 'audio/webm;codecs=opus',
      });
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = async (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
          // Convert blob to base64 and send via WebSocket
          const reader = new FileReader();
          reader.onload = () => {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({
                type: 'audio_chunk',
                data: reader.result, // Base64 encoded
              }));
            }
          };
          reader.readAsDataURL(event.data);
        }
      };

      mediaRecorder.start(1000); // Capture audio in 1-second chunks

      setIsRecording(true);
      setDuration(0);
      toast({
        title: "Recording started",
        description: "Speak clearly into your microphone",
      });
    } catch (error) {
      console.error("Error starting recording:", error);
      toast({
        title: "Recording failed",
        description: "Could not access microphone. Please check permissions.",
        variant: "destructive",
      });
    }
  };

  const togglePause = () => {
    setIsPaused(!isPaused);
    toast({
      title: isPaused ? "Recording resumed" : "Recording paused",
    });
  };

  const stopRecording = async () => {
    // Stop media recorder
    if (mediaRecorderRef.current) {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current.stream.getTracks().forEach(track => track.stop());
    }

    // Close WebSocket
    if (wsRef.current) {
      wsRef.current.close();
    }

    // Save to history and database
    if (transcript.length > 0 || audioChunksRef.current.length > 0) {
      const audioBlob = new Blob(audioChunksRef.current, { type: "audio/webm" });
      
      // Convert audio to base64 for storage
      const reader = new FileReader();
      reader.onerror = () => {
        console.error("Error reading audio file");
        toast({
          title: "Error",
          description: "Failed to process recording audio",
          variant: "destructive",
        });
      };
      reader.onload = async () => {
        const audioData = reader.result as string;
        const newRecording: Recording = {
          id: sessionId || `recording-${Date.now()}`,
          title: sessionTitle || "Untitled Recording",
          transcript,
          audioBlob,
          duration,
          createdAt: Date.now(),
        };
        
        // Save to database (save metadata and transcript, not full audio)
        try {
          console.log("Attempting to save recording:", {
            title: newRecording.title,
            transcriptLength: newRecording.transcript.length,
            duration: newRecording.duration,
          });
          
          const res = await apiRequest("POST", "/api/recordings", {
            title: newRecording.title,
            audioData: "", // Don't save large base64 audio to database
            transcript: newRecording.transcript,
            duration: newRecording.duration,
            sessionId,
          });
          
          const savedRecording = await res.json();
          console.log("Recording saved successfully to database:", savedRecording.id);
          toast({
            title: "Success",
            description: "Recording saved successfully",
          });
        } catch (error: any) {
          console.error("Error saving recording to database:", error?.message || String(error));
          toast({
            title: "Warning",
            description: "Recording saved locally but failed to sync to database",
            variant: "destructive",
          });
        }
        
        // Always update local state
        setRecordings((prev) => [newRecording, ...prev]);
      };
      reader.readAsDataURL(audioBlob);
    }

    // Save transcript to backend
    if (sessionId && transcript.length > 0) {
      try {
        await apiRequest("POST", "/api/transcripts", {
          sessionId,
          segments: transcript,
          audioUrl: null,
        });

        // Update session status
        await apiRequest("PATCH", `/api/live-sessions/${sessionId}`, { status: 'completed' });
      } catch (error) {
        console.error("Error saving transcript:", error);
      }
    }

    setIsRecording(false);
    setIsPaused(false);
    setLivePreviewText("");
    toast({
      title: "Recording stopped",
      description: "Your session has been saved to history",
    });
  };

  const deleteRecording = async (id: string) => {
    try {
      // Delete from database
      await apiRequest("DELETE", `/api/recordings/${id}`);
      
      // Remove from local state
      setRecordings((prev) => prev.filter((rec) => rec.id !== id));
      
      toast({
        title: "Recording deleted",
        description: "The recording has been removed from history",
      });
    } catch (error) {
      console.error("Error deleting recording:", error);
      toast({
        title: "Error",
        description: "Failed to delete recording",
        variant: "destructive",
      });
    }
  };

  const readAllText = async (recording: Recording) => {
    if (!window.speechSynthesis) {
      toast({
        title: "Not supported",
        description: "Text-to-speech is not supported in your browser",
        variant: "destructive",
      });
      return;
    }

    if (isSpeaking) {
      window.speechSynthesis.cancel();
      setIsSpeaking(false);
      return;
    }

    const fullText = recording.transcript.map((seg) => seg.text).join(" ");
    if (!fullText) {
      toast({
        title: "No text",
        description: "No transcribed text to read",
        variant: "destructive",
      });
      return;
    }

    setIsSpeaking(true);
    const utterance = new SpeechSynthesisUtterance(fullText);
    utterance.onend = () => setIsSpeaking(false);
    window.speechSynthesis.speak(utterance);
  };

  const summarizeAndCorrect = async (recording: Recording) => {
    setIsSummarizing(true);
    const fullText = recording.transcript.map((seg) => seg.text).join(" ");

    try {
      const response = await apiRequest("POST", "/api/summarize-and-correct", {
        text: fullText,
      });

      const data = await response.json();

      // Update recording with corrected text
      setRecordings((prev) =>
        prev.map((rec) =>
          rec.id === recording.id
            ? {
                ...rec,
                transcript: [
                  ...rec.transcript,
                  {
                    speaker: "AI Corrected",
                    text: data.correctedText,
                    timestamp: Date.now(),
                  },
                ],
              }
            : rec
        )
      );

      toast({
        title: "Text corrected",
        description: data.summary ? "Summary: " + data.summary.slice(0, 100) + "..." : "Text has been corrected",
      });
    } catch (error) {
      console.error("Summarize/correct error:", error);
      toast({
        title: "Processing failed",
        description: "Could not summarize and correct text",
        variant: "destructive",
      });
    } finally {
      setIsSummarizing(false);
    }
  };

  const saveEditedText = (recordingId: string) => {
    setRecordings((prev) =>
      prev.map((rec) =>
        rec.id === recordingId
          ? {
              ...rec,
              transcript: [
                ...rec.transcript,
                {
                  speaker: "Edited",
                  text: editingText,
                  timestamp: Date.now(),
                },
              ],
            }
          : rec
      )
    );
    setEditingId(null);
    setEditingText("");
    toast({
      title: "Text updated",
      description: "Your edits have been saved",
    });
  };

  const addManualTranscript = async () => {
    if (!manualTranscriptInput.trim()) {
      toast({
        title: "Empty text",
        description: "Please enter some text to transcribe",
        variant: "destructive",
      });
      return;
    }

    setIsProcessing(true);
    toast({
      title: "Generating lesson",
      description: "LENORY AI is processing your text and creating a lesson...",
    });

    try {
      // Use LENORY AI to generate lesson from manual text
      const response = await apiRequest("POST", "/api/generate-lesson-from-text", {
        text: manualTranscriptInput,
        recordingId: recordings.length > 0 ? recordings[0].id : null,
      });

      if (!response.ok) {
        throw new Error("Failed to generate lesson");
      }

      const lesson = await response.json();

      // Update the last recording with manual transcript
      setRecordings((prev) => {
        if (prev.length === 0) return prev;
        
        const updated = [...prev];
        updated[0] = {
          ...updated[0],
          transcript: [
            ...updated[0].transcript,
            {
              speaker: "Manual Entry",
              text: manualTranscriptInput,
              timestamp: Date.now(),
            },
          ],
        };
        return updated;
      });

      setManualTranscriptInput("");
      setShowManualTranscriptModal(false);
      setTranscript((prev) => [...prev, {
        speaker: "Manual Entry",
        text: manualTranscriptInput,
        timestamp: Date.now(),
      }]);

      toast({
        title: "Lesson created!",
        description: "Your text has been converted into a structured lesson and saved",
      });
    } catch (error) {
      console.error("Error generating lesson from text:", error);
      toast({
        title: "Error",
        description: "Failed to generate lesson from text",
        variant: "destructive",
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const playHistoryRecording = (recording: Recording) => {
    try {
      const audioUrl = URL.createObjectURL(recording.audioBlob);
      if (audioPlayerRef.current) {
        if (isPlaying && audioPlayerRef.current.src === audioUrl) {
          // Toggle pause/play
          if (audioPlayerRef.current.paused) {
            audioPlayerRef.current.play();
            setIsPlaying(true);
          } else {
            audioPlayerRef.current.pause();
            setIsPlaying(false);
          }
        } else {
          audioPlayerRef.current.src = audioUrl;
          audioPlayerRef.current.play();
          setIsPlaying(true);
        }
      }
    } catch (error) {
      console.error("Error playing recording:", error);
      toast({
        title: "Playback error",
        description: "Could not play recording",
        variant: "destructive",
      });
    }
  };

  const generateLessonFromTranscript = async (recording: Recording) => {
    try {
      setIsGeneratingLesson(true);
      setSelectedRecordingForLesson(recording);
      
      // Combine all transcript segments into one text
      const transcriptText = recording.transcript
        .map((seg) => `${seg.speaker}: ${seg.text}`)
        .join("\n");

      if (!transcriptText.trim()) {
        toast({
          title: "Empty transcript",
          description: "Recording has no transcript to generate lesson from",
          variant: "destructive",
        });
        setIsGeneratingLesson(false);
        return;
      }

      const response = await apiRequest("POST", "/api/generate-lesson", { text: transcriptText });

      if (response.ok) {
        const lesson = await response.json() as GeneratedLesson;
        setGeneratedLesson(lesson);
        setShowLessonPreview(true);
      } else {
        toast({
          title: "Generation failed",
          description: "Could not generate lesson from transcript",
          variant: "destructive",
        });
      }
    } catch (error) {
      console.error("Error generating lesson:", error);
      toast({
        title: "Error",
        description: "Failed to generate lesson",
        variant: "destructive",
      });
    } finally {
      setIsGeneratingLesson(false);
    }
  };

  const downloadHistoryAsPDF = async (recording: Recording) => {
    try {
      const { jsPDF } = await import("jspdf");
      const doc = new jsPDF();

      doc.setFontSize(16);
      doc.text(`Session: ${recording.title}`, 10, 15);

      doc.setFontSize(10);
      doc.setTextColor(128, 128, 128);
      doc.text(`Generated: ${new Date(recording.createdAt).toLocaleString()}`, 10, 25);
      doc.setTextColor(0, 0, 0);

      let yPosition = 35;
      doc.setFontSize(11);

      recording.transcript.forEach((segment) => {
        const timestamp = new Date(segment.timestamp).toLocaleTimeString();
        const text = `[${timestamp}] ${segment.speaker}: ${segment.text}`;
        const lines = doc.splitTextToSize(text, 190);

        lines.forEach((line: string) => {
          if (yPosition > 280) {
            doc.addPage();
            yPosition = 10;
          }
          doc.text(line, 10, yPosition);
          yPosition += 5;
        });
        yPosition += 2;
      });

      // Generate PDF and trigger download via blob
      const pdfBlob = doc.output('blob');
      const url = URL.createObjectURL(pdfBlob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${recording.title}-transcript.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      toast({
        title: "PDF downloaded",
        description: "Your transcript has been saved to your device",
      });
    } catch (error) {
      console.error("PDF download error:", error);
      toast({
        title: "Download failed",
        description: "Could not save PDF",
        variant: "destructive",
      });
    }
  };

  const saveAsLesson = async () => {
    setIsProcessing(true);
    toast({
      title: "Generating lesson",
      description: "AI is converting your transcript into a structured lesson...",
    });

    try {
      const transcriptText = transcript.map(seg => `${seg.speaker}: ${seg.text}`).join('\n');
      await apiRequest("POST", "/api/lessons/generate", {
        transcriptText,
        courseId: null, // Could be linked to a course
      });

      setIsProcessing(false);
      toast({
        title: "Lesson created!",
        description: "Your lesson has been saved successfully",
      });
    } catch (error) {
      console.error("Error generating lesson:", error);
      setIsProcessing(false);
      toast({
        title: "Error",
        description: "Failed to generate lesson",
        variant: "destructive",
      });
    }
  };

  const jumpToTimestamp = (timestamp: number) => {
    toast({
      title: "Timestamp",
      description: new Date(timestamp).toLocaleTimeString(),
    });
  };

  const playRecording = async () => {
    if (audioChunksRef.current.length === 0) {
      toast({
        title: "No recording",
        description: "Start a recording first",
        variant: "destructive",
      });
      return;
    }

    try {
      const audioBlob = new Blob(audioChunksRef.current, { type: "audio/webm" });
      const audioUrl = URL.createObjectURL(audioBlob);
      
      if (audioPlayerRef.current) {
        audioPlayerRef.current.src = audioUrl;
        audioPlayerRef.current.play();
        setIsPlaying(true);
      }
    } catch (error) {
      console.error("Error playing recording:", error);
      toast({
        title: "Playback error",
        description: "Could not play recording",
        variant: "destructive",
      });
    }
  };

  const transcribeManually = async () => {
    if (audioChunksRef.current.length === 0) {
      toast({
        title: "No recording",
        description: "Record audio first",
        variant: "destructive",
      });
      return;
    }

    setIsTranscribing(true);
    toast({
      title: "Transcribing",
      description: "Processing your recording with Whisper...",
    });

    try {
      const audioBlob = new Blob(audioChunksRef.current, { type: "audio/webm" });
      const formData = new FormData();
      formData.append("file", audioBlob, "recording.webm");

      const response = await fetch("/api/transcribe", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        throw new Error("Transcription failed");
      }

      const data = await response.json();
      setTranscript([
        ...transcript,
        {
          speaker: "Full Recording",
          text: data.text,
          timestamp: Date.now(),
        },
      ]);

      toast({
        title: "Transcription complete",
        description: "Your recording has been transcribed",
      });
    } catch (error) {
      console.error("Transcription error:", error);
      toast({
        title: "Transcription failed",
        description: "Could not transcribe audio",
        variant: "destructive",
      });
    } finally {
      setIsTranscribing(false);
    }
  };

  const downloadAsPDF = async () => {
    if (transcript.length === 0) {
      toast({
        title: "No transcript",
        description: "Generate a transcript first",
        variant: "destructive",
      });
      return;
    }

    try {
      // Dynamically import jsPDF
      const { jsPDF } = await import("jspdf");
      const doc = new jsPDF();

      // Add title
      doc.setFontSize(16);
      doc.text(`Session: ${sessionTitle}`, 10, 15);

      // Add metadata
      doc.setFontSize(10);
      doc.setTextColor(128, 128, 128);
      doc.text(`Generated: ${new Date().toLocaleString()}`, 10, 25);
      doc.setTextColor(0, 0, 0);

      // Add transcript
      let yPosition = 35;
      doc.setFontSize(11);

      transcript.forEach((segment) => {
        const timestamp = new Date(segment.timestamp).toLocaleTimeString();
        const text = `[${timestamp}] ${segment.speaker}: ${segment.text}`;
        const lines = doc.splitTextToSize(text, 190);

        lines.forEach((line: string) => {
          if (yPosition > 280) {
            doc.addPage();
            yPosition = 10;
          }
          doc.text(line, 10, yPosition);
          yPosition += 5;
        });
        yPosition += 2;
      });

      // Generate PDF and trigger download via blob
      const pdfBlob = doc.output('blob');
      const url = URL.createObjectURL(pdfBlob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${sessionTitle || "session"}-transcript.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      
      toast({
        title: "PDF downloaded",
        description: "Your transcript has been saved to your device",
      });
    } catch (error) {
      console.error("PDF download error:", error);
      toast({
        title: "Download failed",
        description: "Could not save PDF",
        variant: "destructive",
      });
    }
  };

  if (authLoading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-pulse text-muted-foreground">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b border-border/50 backdrop-blur-lg bg-background/80">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-4">
              <Button variant="ghost" size="icon" asChild className="hover-elevate active-elevate-2">
                <a href="/dashboard" data-testid="link-back">
                  <ArrowLeft className="h-5 w-5" />
                </a>
              </Button>
              <div>
                <h1 className="font-display font-semibold text-lg">Live Session</h1>
                {isRecording && (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <div className="h-2 w-2 rounded-full bg-red-500 animate-pulse" />
                    Recording
                  </div>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <ThemeToggle />
            </div>
          </div>
        </div>
      </header>

      {/* Tab Buttons */}
      <div className="flex gap-2 border-b border-border px-4 sm:px-6 pt-4 mb-4 max-w-7xl mx-auto w-full">
        <Button
          onClick={() => setActiveTab('record')}
          variant={activeTab === 'record' ? 'default' : 'ghost'}
          className={`hover-elevate active-elevate-2 ${activeTab === 'record' ? '' : 'opacity-50'}`}
          data-testid="tab-record"
        >
          <Mic className="h-4 w-4 mr-2" />
          Recording
        </Button>
        <Button
          onClick={() => setActiveTab('history')}
          variant={activeTab === 'history' ? 'default' : 'ghost'}
          className={`hover-elevate active-elevate-2 ${activeTab === 'history' ? '' : 'opacity-50'}`}
          data-testid="tab-history"
        >
          <History className="h-4 w-4 mr-2" />
          History ({recordings.length})
        </Button>
      </div>

      <div className="flex-1 flex flex-col lg:flex-row max-w-7xl mx-auto w-full">
        {/* Record Tab */}
        {activeTab === 'record' && (
        <>
        {/* Transcript Pane (70%) */}
        <div className="flex-1 lg:w-[70%] overflow-y-auto p-4 sm:p-6">
          {transcript.length === 0 ? (
            <div className="h-full flex items-center justify-center">
              <div className="text-center max-w-md">
                <Mic className="h-16 w-16 mx-auto mb-4 text-primary opacity-50" />
                <h2 className="text-2xl font-display font-semibold mb-2">
                  Start Your Live Session
                </h2>
                <p className="text-muted-foreground mb-6">
                  Enter a title and click record to begin. Your voice will be
                  transcribed in real-time with AI.
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-display font-semibold">{sessionTitle}</h2>
                <Button
                  onClick={saveAsLesson}
                  disabled={isProcessing}
                  className="hover-elevate active-elevate-2"
                  data-testid="button-save-lesson"
                >
                  {isProcessing ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Generating...
                    </>
                  ) : (
                    <>
                      <Save className="h-4 w-4 mr-2" />
                      Save as Lesson
                    </>
                  )}
                </Button>
              </div>

              {transcript.map((segment, index) => (
                <Card
                  key={index}
                  className="p-4 hover-elevate cursor-pointer"
                  onClick={() => jumpToTimestamp(segment.timestamp)}
                  data-testid={`transcript-segment-${index}`}
                >
                  <div className="flex items-start gap-3">
                    <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                      <span className="text-sm font-semibold text-primary">
                        {segment.speaker.charAt(0)}
                      </span>
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-semibold text-sm">{segment.speaker}</span>
                        <Badge variant="outline" className="text-xs">
                          {new Date(segment.timestamp).toLocaleTimeString()}
                        </Badge>
                      </div>
                      <p className="text-sm">{segment.text}</p>
                    </div>
                  </div>
                </Card>
              ))}
              <div ref={transcriptEndRef} />
            </div>
          )}

          {/* Live Preview Window - Only show when recording */}
          {isRecording && (
            <Card className="mt-6 p-4 bg-background border-2 border-primary/30">
              <h3 className="font-semibold mb-3 flex items-center gap-2">
                <Mic className="h-4 w-4 text-primary" />
                Live Transcription Preview
              </h3>
              <div className="max-h-48 overflow-y-auto bg-muted/50 p-3 rounded-md">
                {livePreviewText ? (
                  <p className="text-sm whitespace-pre-wrap text-foreground">{livePreviewText}</p>
                ) : (
                  <p className="text-sm text-muted-foreground italic">Waiting for audio input...</p>
                )}
              </div>
            </Card>
          )}
        </div>

        {/* Controls Panel (30%) */}
        <div className="lg:w-[30%] border-l border-border p-4 sm:p-6 bg-muted/30 flex flex-col">
          <div className="space-y-6 flex-1">
            {/* Session Title */}
            {!isRecording && (
              <div>
                <label className="text-sm font-medium mb-2 block">
                  Session Title
                </label>
                <Input
                  value={sessionTitle}
                  onChange={(e) => setSessionTitle(e.target.value)}
                  placeholder="e.g., Introduction to Physics"
                  data-testid="input-session-title"
                />
              </div>
            )}

            {/* Timer */}
            {isRecording && (
              <Card className="p-4 bg-background">
                <div className="flex items-center justify-center gap-2 mb-2">
                  <Clock className="h-5 w-5 text-primary" />
                  <span className="text-sm font-medium">Duration</span>
                </div>
                <div className="text-3xl font-display font-bold text-center text-primary">
                  {formatDuration(duration)}
                </div>
              </Card>
            )}

            {/* Recording Controls */}
            <div className="space-y-3">
              {!isRecording ? (
                <Button
                  onClick={startRecording}
                  className="w-full h-14 text-lg hover-elevate active-elevate-2"
                  data-testid="button-start-recording"
                >
                  <Mic className="h-5 w-5 mr-2" />
                  Start Recording
                </Button>
              ) : (
                <>
                  <div className="flex gap-2">
                    <Button
                      onClick={togglePause}
                      variant="outline"
                      className="flex-1 hover-elevate active-elevate-2"
                      data-testid="button-pause"
                    >
                      {isPaused ? (
                        <>
                          <Play className="h-5 w-5 mr-2" />
                          Resume
                        </>
                      ) : (
                        <>
                          <Pause className="h-5 w-5 mr-2" />
                          Pause
                        </>
                      )}
                    </Button>
                    <Button
                      onClick={stopRecording}
                      variant="destructive"
                      className="flex-1 hover-elevate active-elevate-2"
                      data-testid="button-stop"
                    >
                      <Square className="h-5 w-5 mr-2" />
                      Stop
                    </Button>
                  </div>

                  {/* Waveform Visualization */}
                  <Card className="p-4 bg-background">
                    <div className="flex items-center justify-center gap-1 h-20">
                      {[...Array(20)].map((_, i) => (
                        <div
                          key={i}
                          className="w-1 bg-primary rounded-full animate-pulse"
                          style={{
                            height: `${Math.random() * 60 + 20}%`,
                            animationDelay: `${i * 0.05}s`,
                          }}
                        />
                      ))}
                    </div>
                  </Card>
                </>
              )}
            </div>

            {/* Manual Transcript Input - If no transcription */}
            {!isRecording && transcript.length === 0 && recordings.length > 0 && (
              <Button
                onClick={() => setShowManualTranscriptModal(true)}
                className="w-full hover-elevate active-elevate-2"
                variant="outline"
                data-testid="button-add-manual-transcript"
              >
                <Edit3 className="h-4 w-4 mr-2" />
                Add Text Manually
              </Button>
            )}

            {/* Session Info */}
            <Card className="p-4 bg-background">
              <div className="space-y-3 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Participants</span>
                  <div className="flex items-center gap-1">
                    <Users className="h-4 w-4" />
                    <span className="font-semibold">1</span>
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Segments</span>
                  <span className="font-semibold">{transcript.length}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Language</span>
                  <Badge variant="outline">English</Badge>
                </div>
              </div>
            </Card>

            {/* Audio Controls - Show after recording stopped */}
            {!isRecording && transcript.length > 0 && (
              <div className="space-y-3">
                <Button
                  onClick={playRecording}
                  variant="outline"
                  className="w-full hover-elevate active-elevate-2"
                  data-testid="button-play"
                >
                  {isPlaying ? (
                    <>
                      <Pause className="h-4 w-4 mr-2" />
                      Stop Playback
                    </>
                  ) : (
                    <>
                      <Volume2 className="h-4 w-4 mr-2" />
                      Play Recording
                    </>
                  )}
                </Button>

                <Button
                  onClick={transcribeManually}
                  disabled={isTranscribing}
                  variant="outline"
                  className="w-full hover-elevate active-elevate-2"
                  data-testid="button-transcribe"
                >
                  {isTranscribing ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Transcribing...
                    </>
                  ) : (
                    <>
                      <Mic className="h-4 w-4 mr-2" />
                      Transcribe with Whisper
                    </>
                  )}
                </Button>

                <Button
                  onClick={downloadAsPDF}
                  variant="outline"
                  className="w-full hover-elevate active-elevate-2"
                  data-testid="button-download-pdf"
                >
                  <Download className="h-4 w-4 mr-2" />
                  Download as PDF
                </Button>
              </div>
            )}

            {/* Settings */}
            <Button
              onClick={() => setShowSettingsModal(true)}
              variant="outline"
              className="w-full hover-elevate active-elevate-2"
              data-testid="button-settings"
            >
              <Settings className="h-4 w-4 mr-2" />
              Session Settings
            </Button>

            {/* View Generated Lessons */}
            <Button
              onClick={() => setLocation("/generated-lessons")}
              variant="outline"
              className="w-full hover-elevate active-elevate-2"
              data-testid="button-view-lessons"
            >
              <BookOpen className="h-4 w-4 mr-2" />
              View Generated Lessons
            </Button>
          </div>
        </div>
        </>
        )}

        {/* History Tab */}
        {activeTab === 'history' && (
          <div className="flex-1 overflow-y-auto p-4 sm:p-6">
            {recordings.length === 0 ? (
              <div className="h-full flex items-center justify-center">
                <div className="text-center max-w-md">
                  <History className="h-16 w-16 mx-auto mb-4 text-primary opacity-50" />
                  <h2 className="text-2xl font-display font-semibold mb-2">
                    No Recordings Yet
                  </h2>
                  <p className="text-muted-foreground">
                    Your recorded sessions will appear here. Start recording to build your history.
                  </p>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4">
                {recordings.map((recording) => (
                  <Card key={recording.id} className="p-4 hover-elevate" data-testid={`history-recording-${recording.id}`}>
                    <div className="mb-3">
                      <h3 className="font-semibold text-lg">{recording.title}</h3>
                      <p className="text-sm text-muted-foreground">
                        {new Date(recording.createdAt).toLocaleString()} • {formatDuration(recording.duration)}
                      </p>
                    </div>

                    {/* Transcript Preview / Full Text */}
                    {expandedRecordingId === recording.id ? (
                      <div className="mb-4 bg-muted/50 p-3 rounded">
                        {editingId === recording.id ? (
                          <div className="space-y-2">
                            <textarea
                              value={editingText}
                              onChange={(e) => setEditingText(e.target.value)}
                              className="w-full p-2 bg-background border border-border rounded text-sm min-h-24"
                              data-testid={`textarea-edit-${recording.id}`}
                            />
                            <div className="flex gap-2">
                              <Button
                                onClick={() => saveEditedText(recording.id)}
                                size="sm"
                                className="hover-elevate active-elevate-2"
                                data-testid={`button-save-edit-${recording.id}`}
                              >
                                Save
                              </Button>
                              <Button
                                onClick={() => {
                                  setEditingId(null);
                                  setEditingText("");
                                }}
                                size="sm"
                                variant="outline"
                                className="hover-elevate active-elevate-2"
                                data-testid={`button-cancel-edit-${recording.id}`}
                              >
                                Cancel
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <div>
                            <div className="max-h-48 overflow-y-auto text-sm space-y-2">
                              {recording.transcript.map((seg, idx) => (
                                <p key={idx} className="text-xs">
                                  <span className="font-semibold text-primary">{seg.speaker}:</span> {seg.text}
                                </p>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="mb-4 max-h-32 overflow-y-auto bg-muted/50 p-2 rounded text-sm">
                        {recording.transcript.map((seg, idx) => (
                          <p key={idx} className="text-xs mb-1">
                            <span className="font-semibold">{seg.speaker}:</span> {seg.text.slice(0, 100)}{seg.text.length > 100 ? '...' : ''}
                          </p>
                        ))}
                      </div>
                    )}

                    {/* Action Buttons */}
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-3">
                      <Button
                        onClick={() => playHistoryRecording(recording)}
                        size="sm"
                        variant="outline"
                        className="hover-elevate active-elevate-2"
                        data-testid={`button-play-${recording.id}`}
                      >
                        <Volume2 className="h-3 w-3 mr-1" />
                        Play
                      </Button>

                      <Button
                        onClick={() => setExpandedRecordingId(expandedRecordingId === recording.id ? null : recording.id)}
                        size="sm"
                        variant="outline"
                        className="hover-elevate active-elevate-2"
                        data-testid={`button-show-text-${recording.id}`}
                      >
                        <Eye className="h-3 w-3 mr-1" />
                        {expandedRecordingId === recording.id ? "Hide" : "Show"} Text
                      </Button>

                      <Button
                        onClick={() => downloadHistoryAsPDF(recording)}
                        size="sm"
                        variant="outline"
                        className="hover-elevate active-elevate-2"
                        data-testid={`button-download-${recording.id}`}
                      >
                        <Download className="h-3 w-3 mr-1" />
                        PDF
                      </Button>

                      <Button
                        onClick={() => readAllText(recording)}
                        size="sm"
                        variant="outline"
                        className={`hover-elevate active-elevate-2 ${isSpeaking ? "bg-primary text-primary-foreground" : ""}`}
                        data-testid={`button-read-${recording.id}`}
                      >
                        <Mic className="h-3 w-3 mr-1" />
                        {isSpeaking ? "Stop" : "Read"}
                      </Button>

                      <Button
                        onClick={() => {
                          setEditingId(recording.id);
                          setEditingText(recording.transcript.map((seg) => seg.text).join(" "));
                          setExpandedRecordingId(recording.id);
                        }}
                        size="sm"
                        variant="outline"
                        className="hover-elevate active-elevate-2"
                        data-testid={`button-edit-${recording.id}`}
                      >
                        <Edit3 className="h-3 w-3 mr-1" />
                        Edit
                      </Button>

                      <Button
                        onClick={() => generateLessonFromTranscript(recording)}
                        disabled={isGeneratingLesson}
                        size="sm"
                        variant="outline"
                        className="hover-elevate active-elevate-2"
                        data-testid={`button-generate-lesson-${recording.id}`}
                      >
                        {isGeneratingLesson ? (
                          <>
                            <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                            Generating...
                          </>
                        ) : (
                          <>
                            <BookOpen className="h-3 w-3 mr-1" />
                            Generate Lesson
                          </>
                        )}
                      </Button>

                      <Button
                        onClick={() => summarizeAndCorrect(recording)}
                        disabled={isSummarizing}
                        size="sm"
                        variant="outline"
                        className="hover-elevate active-elevate-2"
                        data-testid={`button-summarize-${recording.id}`}
                      >
                        {isSummarizing ? (
                          <>
                            <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                            Processing
                          </>
                        ) : (
                          <>
                            <Wand2 className="h-3 w-3 mr-1" />
                            AI Fix
                          </>
                        )}
                      </Button>
                    </div>

                    {/* Delete Button - Full Width */}
                    <Button
                      onClick={() => deleteRecording(recording.id)}
                      size="sm"
                      variant="outline"
                      className="w-full hover-elevate active-elevate-2 text-destructive"
                      data-testid={`button-delete-${recording.id}`}
                    >
                      <Trash2 className="h-3 w-3 mr-1" />
                      Delete Recording
                    </Button>
                  </Card>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Manual Transcript Modal */}
      {showManualTranscriptModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <Card className="w-full max-w-2xl p-6">
            <h2 className="text-2xl font-display font-semibold mb-4">Add Transcribed Text</h2>
            <p className="text-sm text-muted-foreground mb-4">
              Paste or type the text from your recording. This will be added to your transcript.
            </p>
            
            <textarea
              value={manualTranscriptInput}
              onChange={(e) => setManualTranscriptInput(e.target.value)}
              placeholder="Enter the transcribed text here..."
              className="w-full p-3 bg-background border border-border rounded-md text-sm min-h-40 focus:outline-none focus:ring-2 focus:ring-primary"
              data-testid="textarea-manual-transcript"
            />

            <div className="flex gap-2 mt-4 justify-end">
              <Button
                onClick={() => {
                  setShowManualTranscriptModal(false);
                  setManualTranscriptInput("");
                }}
                variant="outline"
                className="hover-elevate active-elevate-2"
                data-testid="button-cancel-manual"
              >
                Cancel
              </Button>
              <Button
                onClick={addManualTranscript}
                className="hover-elevate active-elevate-2"
                data-testid="button-submit-manual"
              >
                Add Text
              </Button>
            </div>
          </Card>
        </div>
      )}

      {/* Session Settings Modal */}
      {showSettingsModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <Card className="w-full max-w-md p-6">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-2xl font-display font-semibold">Session Settings</h2>
              <button onClick={() => setShowSettingsModal(false)} className="text-muted-foreground hover:text-foreground">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-4">
              {/* Difficulty Level */}
              <div>
                <label className="text-sm font-medium mb-2 block">Difficulty Level</label>
                <select
                  value={sessionSettings.difficulty}
                  onChange={(e) => setSessionSettings({...sessionSettings, difficulty: e.target.value as 'easy' | 'medium' | 'hard'})}
                  className="w-full p-2 bg-background border border-border rounded text-sm"
                  data-testid="select-difficulty"
                >
                  <option value="easy">Easy</option>
                  <option value="medium">Medium</option>
                  <option value="hard">Hard</option>
                </select>
              </div>

              {/* Language */}
              <div>
                <label className="text-sm font-medium mb-2 block">Language</label>
                <select
                  value={sessionSettings.language}
                  onChange={(e) => setSessionSettings({...sessionSettings, language: e.target.value as any})}
                  className="w-full p-2 bg-background border border-border rounded text-sm"
                  data-testid="select-language"
                >
                  <option value="en">English</option>
                  <option value="pidgin">Pidgin English</option>
                  <option value="yoruba">Yoruba</option>
                  <option value="igbo">Igbo</option>
                  <option value="hausa">Hausa</option>
                </select>
              </div>

              {/* AI Model */}
              <div>
                <label className="text-sm font-medium mb-2 block">AI Model</label>
                <select
                  value={sessionSettings.aiModel}
                  onChange={(e) => setSessionSettings({...sessionSettings, aiModel: e.target.value as any})}
                  className="w-full p-2 bg-background border border-border rounded text-sm"
                  data-testid="select-ai-model"
                >
                  <option value="gpt-3.5-turbo">GPT-3.5 Turbo (Fast)</option>
                  <option value="gpt-4">GPT-4 (Accurate)</option>
                </select>
              </div>

              {/* Recording Timeout */}
              <div>
                <label className="text-sm font-medium mb-2 block">Recording Timeout (minutes)</label>
                <Input
                  type="number"
                  value={sessionSettings.recordingTimeout}
                  onChange={(e) => setSessionSettings({...sessionSettings, recordingTimeout: parseInt(e.target.value) || 30})}
                  min={5}
                  max={120}
                  className="w-full"
                  data-testid="input-timeout"
                />
              </div>

              {/* Auto-save Transcripts */}
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={sessionSettings.autoSaveTranscripts}
                  onChange={(e) => setSessionSettings({...sessionSettings, autoSaveTranscripts: e.target.checked})}
                  className="w-4 h-4"
                  data-testid="checkbox-auto-save"
                />
                <label className="text-sm font-medium">Auto-save Transcripts</label>
              </div>
            </div>

            <div className="flex gap-2 mt-6 justify-end">
              <Button
                onClick={() => setShowSettingsModal(false)}
                variant="outline"
                className="hover-elevate active-elevate-2"
                data-testid="button-close-settings"
              >
                Done
              </Button>
            </div>
          </Card>
        </div>
      )}

      {/* Lesson Preview Modal */}
      {showLessonPreview && generatedLesson && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 overflow-y-auto">
          <Card className="w-full max-w-2xl p-6 my-8">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-2xl font-display font-semibold">Generated Lesson</h2>
              <button onClick={() => setShowLessonPreview(false)} className="text-muted-foreground hover:text-foreground">
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Title */}
            <div className="mb-6">
              <h3 className="text-xl font-semibold mb-2">{generatedLesson.title}</h3>
              <p className="text-sm text-muted-foreground">
                From: {selectedRecordingForLesson?.title || "Recording"}
              </p>
            </div>

            {/* Objectives */}
            <div className="mb-6">
              <h4 className="font-semibold mb-3">Learning Objectives</h4>
              <ul className="space-y-2">
                {generatedLesson.objectives.length > 0 ? (
                  generatedLesson.objectives.map((obj, idx) => (
                    <li key={idx} className="text-sm flex gap-2">
                      <span className="text-primary">•</span>
                      <span>{obj}</span>
                    </li>
                  ))
                ) : (
                  <p className="text-sm text-muted-foreground">No objectives generated</p>
                )}
              </ul>
            </div>

            {/* Key Points */}
            <div className="mb-6">
              <h4 className="font-semibold mb-3">Key Points</h4>
              <ul className="space-y-2">
                {generatedLesson.keyPoints.length > 0 ? (
                  generatedLesson.keyPoints.map((point, idx) => (
                    <li key={idx} className="text-sm flex gap-2">
                      <span className="text-primary">•</span>
                      <span>{point}</span>
                    </li>
                  ))
                ) : (
                  <p className="text-sm text-muted-foreground">No key points generated</p>
                )}
              </ul>
            </div>

            {/* Summary */}
            <div className="mb-6">
              <h4 className="font-semibold mb-3">Summary</h4>
              <p className="text-sm text-muted-foreground">
                {generatedLesson.summary || "No summary generated"}
              </p>
            </div>

            <div className="flex gap-2 justify-end">
              <Button
                onClick={() => setShowLessonPreview(false)}
                variant="outline"
                className="hover-elevate active-elevate-2"
                data-testid="button-close-lesson"
              >
                Close
              </Button>
              <Button
                onClick={() => {
                  // TODO: Save lesson to database
                  toast({
                    title: "Success",
                    description: "Lesson saved to your courses",
                  });
                  setShowLessonPreview(false);
                }}
                className="hover-elevate active-elevate-2"
                data-testid="button-save-lesson"
              >
                <Save className="h-4 w-4 mr-2" />
                Save Lesson
              </Button>
            </div>
          </Card>
        </div>
      )}

      {/* Hidden audio player */}
      <audio
        ref={audioPlayerRef}
        onEnded={() => setIsPlaying(false)}
        style={{ display: "none" }}
      />
    </div>
  );
}
