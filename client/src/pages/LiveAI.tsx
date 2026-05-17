import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Send, Volume2, VolumeX, Upload, X, Mic, MicOff, Phone, PhoneOff, Settings, Shield, Sparkles } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { ChatInterface } from "@/components/live-ai/ChatInterface";
import { QuickActions } from "@/components/live-ai/QuickActions";
import { AvatarDisplay } from "@/components/live-ai/AvatarDisplay";
import { useAuth } from "@/hooks/useAuth";
import { useVapi } from "@/hooks/useVapi";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
}

const GEMINI_VOICES = [
  { id: "Aoede", name: "Aoede", description: "Bright & melodic" },
  { id: "Charon", name: "Charon", description: "Deep & authoritative" },
  { id: "Fenrir", name: "Fenrir", description: "Strong & commanding" },
  { id: "Kore", name: "Kore", description: "Warm & nurturing" },
  { id: "Puck", name: "Puck", description: "Playful & energetic" },
];

export default function LiveAI() {
  const { toast } = useToast();
  const { user } = useAuth();
  const [voice] = useState<"female" | "male">("female");
  const [messages, setMessages] = useState<Message[]>([]);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [currentMode, setCurrentMode] = useState("explain");
  const [messageInput, setMessageInput] = useState("");
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [whisperStatus, setWhisperStatus] = useState<"online" | "offline">("online");
  const [showUploadMode, setShowUploadMode] = useState(false);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [showPromptInput, setShowPromptInput] = useState(false);
  const [fileDescription, setFileDescription] = useState("");
  const [isMuted, setIsMuted] = useState(true);
  const [isCallActive, setIsCallActive] = useState(true);
  const [, setLocation] = useLocation();
  
  // Microphone permission and settings states
  const [micPermission, setMicPermission] = useState<"granted" | "denied" | "prompt">("prompt");
  const [showMicSettings, setShowMicSettings] = useState(false);
  const [selectedVoice, setSelectedVoice] = useState("Aoede");
  const [isGeminiConnected, setIsGeminiConnected] = useState(false);
  const [showVapiPanel, setShowVapiPanel] = useState(false);

  // VAPI Live voice call
  const vapi = useVapi();

  // Note: MediaRecorder refs removed - all audio uses PCM streaming via ScriptProcessor
  const messageCountRef = useRef(0);
  const initRef = useRef(false);
  const silenceTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const mouthAnimationRef = useRef<boolean>(false);
  const sessionIdRef = useRef<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const geminiWsRef = useRef<WebSocket | null>(null);

  // Check microphone permission on mount
  useEffect(() => {
    checkMicrophonePermission();
  }, []);

  const checkMicrophonePermission = async () => {
    try {
      const result = await navigator.permissions.query({ name: "microphone" as PermissionName });
      setMicPermission(result.state as "granted" | "denied" | "prompt");
      
      result.addEventListener("change", () => {
        setMicPermission(result.state as "granted" | "denied" | "prompt");
      });
    } catch (error) {
      console.log("Permission API not supported, will check on use");
    }
  };

  const requestMicrophonePermission = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach(track => track.stop());
      setMicPermission("granted");
      toast({
        title: "Microphone Access Granted",
        description: "You can now use voice features",
      });
      return true;
    } catch (error) {
      setMicPermission("denied");
      toast({
        title: "Microphone Access Denied",
        description: "Please enable microphone in browser settings",
        variant: "destructive",
      });
      return false;
    }
  };

  // Connect to Gemini Live WebSocket
  const connectToGeminiLive = () => {
    if (geminiWsRef.current?.readyState === WebSocket.OPEN) {
      return;
    }

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/ws/gemini-live?userId=${user?.id || 'anonymous'}`;
    
    const ws = new WebSocket(wsUrl);
    geminiWsRef.current = ws;

    ws.onopen = () => {
      console.log("Connected to Gemini Live API");
      setIsGeminiConnected(true);
      toast({
        title: "AI Voice Connected",
        description: "Ready for real-time conversation",
      });
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        handleGeminiMessage(data);
      } catch (error) {
        console.error("Error parsing Gemini message:", error);
      }
    };

    ws.onclose = () => {
      console.log("Disconnected from Gemini Live API");
      setIsGeminiConnected(false);
    };

    ws.onerror = (error) => {
      console.error("Gemini WebSocket error:", error);
      setIsGeminiConnected(false);
    };
  };

  // Audio context for playing Gemini audio with queueing
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioQueueRef = useRef<ArrayBuffer[]>([]);
  const isPlayingRef = useRef<boolean>(false);
  const nextPlayTimeRef = useRef<number>(0);

  // Initialize audio context for playback
  const getAudioContext = async (): Promise<AudioContext> => {
    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({
        sampleRate: 24000, // Gemini outputs at 24kHz
      });
    }
    
    if (audioContextRef.current.state === 'suspended') {
      await audioContextRef.current.resume();
    }
    
    return audioContextRef.current;
  };

  // Queue-based audio playback for seamless streaming
  const playGeminiAudio = async (audioBase64: string, mimeType: string = "audio/mp3") => {
    try {
      const audioContext = await getAudioContext();
      
      // Decode base64 to array buffer
      const binaryString = atob(audioBase64);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      
      // Handle PCM audio (from Gemini Live streaming at 24kHz)
      if (mimeType.includes("pcm") || mimeType.includes("rate=24000")) {
        await queuePCMAudio(bytes.buffer, 24000);
        return;
      }
      
      // Try to decode as encoded audio (MP3, WAV, etc.)
      try {
        const audioBuffer = await audioContext.decodeAudioData(bytes.buffer.slice(0));
        await scheduleAudioBuffer(audioBuffer);
        console.log("Playing Gemini audio response");
      } catch (decodeError) {
        console.log("Standard decode failed, trying as PCM:", decodeError);
        await queuePCMAudio(bytes.buffer, 24000);
      }
    } catch (error) {
      console.error("Error playing Gemini audio:", error);
      // No browser TTS fallback - Gemini audio only
    }
  };

  // Queue PCM audio chunks for seamless playback
  const queuePCMAudio = async (arrayBuffer: ArrayBuffer, sampleRate: number = 24000) => {
    try {
      const audioContext = await getAudioContext();
      
      // Convert 16-bit PCM to Float32
      const int16Array = new Int16Array(arrayBuffer);
      const float32Array = new Float32Array(int16Array.length);
      
      for (let i = 0; i < int16Array.length; i++) {
        float32Array[i] = int16Array[i] / 32768.0;
      }
      
      // Create audio buffer
      const audioBuffer = audioContext.createBuffer(1, float32Array.length, sampleRate);
      audioBuffer.getChannelData(0).set(float32Array);
      
      // Schedule for seamless playback
      await scheduleAudioBuffer(audioBuffer);
    } catch (error) {
      console.error("Error queuing PCM audio:", error);
    }
  };

  // Schedule audio buffer for seamless playback with queue
  const scheduleAudioBuffer = async (audioBuffer: AudioBuffer) => {
    const audioContext = await getAudioContext();
    const source = audioContext.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(audioContext.destination);
    
    // Calculate when to start this buffer (for seamless playback)
    const currentTime = audioContext.currentTime;
    const startTime = Math.max(currentTime, nextPlayTimeRef.current);
    
    // Update next play time for seamless scheduling
    nextPlayTimeRef.current = startTime + audioBuffer.duration;
    
    setIsSpeaking(true);
    source.onended = () => {
      // Only set speaking to false if no more audio is queued
      if (audioContext.currentTime >= nextPlayTimeRef.current - 0.1) {
        setIsSpeaking(false);
      }
    };
    
    source.start(startTime);
    console.log(`Scheduled audio at ${startTime.toFixed(2)}s, duration: ${audioBuffer.duration.toFixed(2)}s`);
  };

  const handleGeminiMessage = async (data: any) => {
    switch (data.type) {
      case "session_started":
        console.log("Gemini session started:", data.sessionId);
        break;
      case "processing_started":
        setIsProcessing(true);
        break;
      case "processing_complete":
        setIsProcessing(false);
        break;
      case "user_transcript":
        // User's spoken words transcribed by Gemini
        const userTranscript = data.text?.trim() || "";
        if (userTranscript) {
          addMessage("user", userTranscript);
          await saveMessageToDatabase("user", userTranscript);
        }
        break;
      case "audio_output":
        // Gemini audio response - play it directly
        if (data.audio) {
          await playGeminiAudio(data.audio, data.mimeType || "audio/mp3");
        }
        break;
      case "ai_response":
        const aiMessage = (data.text || "").trim();
        if (aiMessage) {
          addMessage("assistant", aiMessage);
          await saveMessageToDatabase("assistant", aiMessage);
          // Gemini audio only - no browser TTS fallback
        }
        setIsProcessing(false);
        break;
      case "error":
        toast({
          title: "AI Error",
          description: data.message,
          variant: "destructive",
        });
        setIsProcessing(false);
        break;
    }
  };

  // Note: sendAudioToGemini removed - audio now streams as raw binary PCM frames only

  const sendTextToGemini = (text: string) => {
    if (geminiWsRef.current?.readyState !== WebSocket.OPEN) {
      connectToGeminiLive();
      setTimeout(() => sendTextToGemini(text), 500);
      return;
    }

    geminiWsRef.current.send(JSON.stringify({
      type: "text_input",
      text,
    }));
  };

  useEffect(() => {
    // Load saved settings
    const saved = localStorage.getItem("learnory_live_ai_settings");
    if (saved) {
      try {
        const settings = JSON.parse(saved);
        setIsDarkMode(settings.isDarkMode || false);
      } catch (e) {
        console.error("Failed to load settings:", e);
      }
    }

    if (!initRef.current) {
      initRef.current = true;
      
      // Create a new chat session for this Live AI conversation
      (async () => {
        try {
          console.log("🔄 Creating chat session...");
          const { apiRequest } = await import("@/lib/queryClient");
          const response = await apiRequest("POST", "/api/chat/sessions", {
            title: "Live AI Session - " + new Date().toLocaleString(),
            mode: "live-ai",
            summary: "Interactive voice-based learning session"
          });
          
          const session = await response.json();
          console.log("📊 Session response:", session);
          
          if (session.id) {
            setSessionId(session.id);
            sessionIdRef.current = session.id;
            console.log("✓ Created chat session:", session.id);
          } else {
            console.error("❌ No session ID in response:", session);
          }
        } catch (err) {
          console.error("❌ Failed to create session:", err);
        }
      })();

      // Initialize Gemini Live connection
      connectToGeminiLive();
      console.log("✅ Gemini Live initialized - waiting for user to unmute");
      
      // Auto-greet with text only (voice comes from Gemini when user unmutes)
      setTimeout(async () => {
        const greetings = [
          "Hello! I'm your LENORY AI tutor. What would you like to learn today?",
          "Hi! I'm here to help you study. What topic interests you?",
          "Welcome to LENORY! I'm ready to assist with your learning.",
        ];
        const greeting = greetings[Math.floor(Math.random() * greetings.length)];
        
        // Add to UI immediately
        addMessage("assistant", greeting);
        
        // Save to database for permanent transcript (wait for sessionId if needed)
        const checkAndSave = async () => {
          let attempts = 0;
          while (!sessionId && attempts < 20) {
            await new Promise(resolve => setTimeout(resolve, 100));
            attempts++;
          }
          if (sessionId) {
            await saveMessageToDatabase("assistant", greeting);
          }
        };
        checkAndSave();
        
        console.log("🎙️ Greeting displayed - waiting for user to unmute for voice");
      }, 1000);
    }

    return () => {
      if (silenceTimeoutRef.current) {
        clearTimeout(silenceTimeoutRef.current);
      }
      // Clean up PCM streaming
      stopPCMStreaming();
    };
  }, []);

  // PCM Audio streaming refs
  const pcmContextRef = useRef<AudioContext | null>(null);
  const pcmProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const pcmStreamRef = useRef<MediaStream | null>(null);
  const isStreamingRef = useRef<boolean>(false);

  // Initialize PCM audio streaming for Gemini Live
  const initializeContinuousListening = async () => {
    try {
      // Request microphone permission
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: 16000, // Request 16kHz for Gemini
        } as any
      });
      
      pcmStreamRef.current = stream;
      
      // Connect to Gemini Live first
      if (geminiWsRef.current?.readyState !== WebSocket.OPEN) {
        connectToGeminiLive();
        // Wait for connection
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      
      // Create audio context at 16kHz
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({
        sampleRate: 16000,
      });
      pcmContextRef.current = audioContext;
      
      // Create media stream source
      const source = audioContext.createMediaStreamSource(stream);
      
      // Create script processor for PCM extraction (4096 buffer size)
      const processor = audioContext.createScriptProcessor(4096, 1, 1);
      pcmProcessorRef.current = processor;
      
      // Voice activity detection
      let silenceFrames = 0;
      const SILENCE_THRESHOLD = 0.01;
      const SILENCE_FRAMES_LIMIT = 25; // ~1.5 seconds at 16kHz
      let hasVoice = false;
      
      processor.onaudioprocess = (e) => {
        if (!isStreamingRef.current) return;
        
        const inputData = e.inputBuffer.getChannelData(0);
        
        // Calculate RMS for voice activity detection
        let sum = 0;
        for (let i = 0; i < inputData.length; i++) {
          sum += inputData[i] * inputData[i];
        }
        const rms = Math.sqrt(sum / inputData.length);
        
        if (rms > SILENCE_THRESHOLD) {
          silenceFrames = 0;
          if (!hasVoice) {
            hasVoice = true;
            console.log("🎤 Voice detected - streaming to Gemini");
          }
          
          // Convert Float32 to Int16 PCM
          const pcmData = new Int16Array(inputData.length);
          for (let i = 0; i < inputData.length; i++) {
            const s = Math.max(-1, Math.min(1, inputData[i]));
            pcmData[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
          }
          
          // Send raw binary PCM frame directly
          if (geminiWsRef.current?.readyState === WebSocket.OPEN) {
            // Send as raw binary ArrayBuffer - NOT base64 JSON
            geminiWsRef.current.send(pcmData.buffer);
          }
        } else {
          silenceFrames++;
          if (hasVoice && silenceFrames > SILENCE_FRAMES_LIMIT) {
            hasVoice = false;
            console.log("🎤 Silence detected - signaling end of turn");
            
            // Signal end of audio input
            if (geminiWsRef.current?.readyState === WebSocket.OPEN) {
              geminiWsRef.current.send(JSON.stringify({
                type: "audio_end",
              }));
              setIsProcessing(true);
            }
            silenceFrames = 0;
          }
        }
      };
      
      // Connect the audio graph
      source.connect(processor);
      processor.connect(audioContext.destination);
      
      isStreamingRef.current = true;
      setIsListening(true);
      
      toast({ 
        title: "Voice Ready", 
        description: "Listening... Speak naturally!" 
      });
      console.log("🎙️ PCM Audio streaming initialized at 16kHz");
      
    } catch (error: any) {
      console.error("Microphone access error:", error);
      toast({
        title: "Microphone Error",
        description: "Please grant microphone permission",
        variant: "destructive",
      });
    }
  };

  // Stop PCM streaming
  const stopPCMStreaming = () => {
    isStreamingRef.current = false;
    if (pcmProcessorRef.current) {
      pcmProcessorRef.current.disconnect();
      pcmProcessorRef.current = null;
    }
    if (pcmContextRef.current) {
      pcmContextRef.current.close();
      pcmContextRef.current = null;
    }
    if (pcmStreamRef.current) {
      pcmStreamRef.current.getTracks().forEach(track => track.stop());
      pcmStreamRef.current = null;
    }
    setIsListening(false);
  };

  // Note: startVoiceActivityDetection removed - voice now uses continuous PCM streaming via initializeContinuousListening
  // Note: streamAudioToGeminiLive removed - PCM streams continuously as binary frames
  // Note: transcribeWithWhisper removed - all voice now uses Gemini Live binary PCM streaming only


  // Save message to both UI and database for permanent transcript
  const addMessage = (role: "user" | "assistant", content: string) => {
    const msg: Message = {
      id: `${role}-${++messageCountRef.current}`,
      role,
      content,
      timestamp: Date.now(),
    };
    setMessages((prev) => [...prev, msg]);
  };

  // Save assistant message to database for permanent transcript
  const saveMessageToDatabase = async (role: "user" | "assistant", content: string) => {
    try {
      // Use ref first, then state
      let currentSessionId = sessionIdRef.current || sessionId;
      
      // Wait a bit for session to be created if not available yet
      if (!currentSessionId) {
        let attempts = 0;
        while (!currentSessionId && attempts < 30) {
          await new Promise(resolve => setTimeout(resolve, 100));
          currentSessionId = sessionIdRef.current || sessionId;
          attempts++;
        }
      }

      if (!currentSessionId) {
        console.warn("No session ID - message not persisted to database");
        return;
      }

      const { apiRequest } = await import("@/lib/queryClient");
      await apiRequest("POST", "/api/chat/save-message", {
        sessionId: currentSessionId,
        role,
        content,
        timestamp: new Date().toISOString(),
      });
      console.log(`✓ Message saved to database: ${role}`);
    } catch (error) {
      console.error("Failed to save message to database:", error);
    }
  };

  // Clean text for speech (remove all markdown, special characters)
  const cleanTextForSpeech = (text: string): string => {
    return text
      .replace(/\*\*(.+?)\*\*/g, "$1")  // Remove bold markers, keep text
      .replace(/\*(.+?)\*/g, "$1")      // Remove italic markers
      .replace(/`(.+?)`/g, "$1")        // Remove code markers
      .replace(/#{1,6}\s+/g, "")        // Remove headers
      .replace(/[-•*]\s+/g, ". ")       // Convert bullet points to periods
      .replace(/\n\n+/g, ". ")          // Replace multiple newlines with periods
      .replace(/\n/g, " ")              // Replace newlines with spaces
      .replace(/\[(.+?)\]\(.+?\)/g, "$1") // Remove links, keep text
      .trim();
  };


  // Play audio with mouth animation - Gemini audio only, no browser TTS
  // This is now only used for visual feedback when Gemini audio plays
  const playAudio = async (text: string) => {
    // Gemini handles audio playback via playGeminiAudio
    // This function is kept for mouth animation sync
    setIsSpeaking(true);
    mouthAnimationRef.current = true;
    
    // Auto-mute mic while AI is speaking
    setIsMuted(true);
    stopPCMStreaming();
    console.log("🔇 Auto-muted during AI response");
    
    // The audio will be played by Gemini via playGeminiAudio
    // Speaking state will be managed by that function
  };

  const handleSendMessage = async (userText?: string) => {
    const text = userText || messageInput;
    if (!text.trim() || isProcessing) return;

    setMessageInput("");
    setIsProcessing(true);
    
    // Stop any current audio playback
    setIsSpeaking(false);
    mouthAnimationRef.current = false;

    try {
      addMessage("user", text);
      
      // Save user message to database for permanent transcript
      await saveMessageToDatabase("user", text);

      // If Whisper was offline and user types, auto-recover
      if (whisperStatus === "offline") {
        console.log("Attempting to re-enable Whisper API...");
        setWhisperStatus("online");
        localStorage.setItem("learnory_whisper_status", "online");
        
        toast({
          title: "Voice Restored",
          description: "You can now talk to me again!",
        });
      }

      // Use Gemini Live WebSocket if connected, otherwise fall back to HTTP API
      if (isGeminiConnected && geminiWsRef.current?.readyState === WebSocket.OPEN) {
        // Send via Gemini Live WebSocket for real-time response
        sendTextToGemini(text);
        // Response will be handled by handleGeminiMessage
      } else {
        // Fall back to HTTP API
        const response = await fetch("/api/chat/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ 
            content: text, 
            sessionId: sessionId,
            includeUserContext: true,
            autoLearn: true
          }),
        });

        if (!response.ok) {
          throw new Error("Failed to get response");
        }

        const data = await response.json();
        console.log("API Response:", data);
        let aiMessage = (data.message || "Got it!").trim();
        
        if (!aiMessage || aiMessage.trim() === "") {
          throw new Error("Empty response from API");
        }
        addMessage("assistant", aiMessage);
        
        // Save AI message to database for permanent transcript
        await saveMessageToDatabase("assistant", aiMessage);

        // Speak the response with avatar lip-syncing
        await playAudio(aiMessage);
      }
    } catch (error) {
      console.error("Error:", error);
      toast({
        title: "Error",
        description: "Failed to process message",
        variant: "destructive",
      });
    } finally {
      setIsProcessing(false);
      // PCM streaming continues automatically if not muted
    }
  };

  // Save settings and Whisper status
  useEffect(() => {
    localStorage.setItem(
      "learnory_live_ai_settings",
      JSON.stringify({ isDarkMode })
    );
    localStorage.setItem("learnory_whisper_status", whisperStatus);
  }, [isDarkMode, whisperStatus]);

  // Save messages
  useEffect(() => {
    localStorage.setItem("learnory_chat_messages", JSON.stringify(messages));
  }, [messages]);

  // End call - stop microphone and redirect to chat page
  const handleEndCall = () => {
    console.log("Ending call...");
    
    // Stop audio playback
    setIsSpeaking(false);
    mouthAnimationRef.current = false;
    
    // Stop PCM streaming
    stopPCMStreaming();
    
    // Close WebSocket connections
    if (geminiWsRef.current) {
      geminiWsRef.current.close();
    }
    
    setIsCallActive(false);
    setIsListening(false);
    setIsMuted(true);
    
    toast({
      title: "Call Ended",
      description: "Microphone disabled. Your conversation has been saved.",
    });
    
    // Redirect to chat page after a short delay
    setTimeout(() => {
      setLocation("/");
    }, 1000);
  };

  // Handle file selection - just set file and show prompt input
  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setUploadedFile(file);
    setShowPromptInput(true);
    setFileDescription("");
    
    toast({
      title: "📁 File Selected",
      description: `${file.name} loaded. Now describe what you need help with.`,
    });
  };

  // Handle submission of file + description to LENORY API
  const handleAnalyzeWithDescription = async () => {
    if (!uploadedFile || !fileDescription.trim()) {
      toast({
        title: "⚠️ Missing Information",
        description: "Please describe what you need help with.",
        variant: "destructive",
      });
      return;
    }

    setIsProcessing(true);
    
    try {
      const formData = new FormData();
      formData.append("file", uploadedFile);
      formData.append("description", fileDescription);
      
      toast({
        title: "🔍 Analyzing with LENORY...",
        description: `Processing ${uploadedFile.name}...`,
      });

      const response = await fetch("/api/chat/analyze-file", {
        method: "POST",
        credentials: "include",
        body: formData,
      });

      if (!response.ok) {
        throw new Error("Failed to analyze file");
      }

      const data = await response.json();
      const analysis = data.analysis || "File analyzed successfully";

      // Add user message showing uploaded file + description
      const fileName = uploadedFile.name;
      addMessage("user", `📎 ${fileName}\n\n${fileDescription}`);
      await saveMessageToDatabase("user", `File: ${fileName}\nRequest: ${fileDescription}`);

      // Add AI analysis response
      let displayResponse = analysis;
      if (typeof analysis === "object") {
        displayResponse = JSON.stringify(analysis, null, 2);
      }

      addMessage("assistant", displayResponse);
      await saveMessageToDatabase("assistant", displayResponse);

      // Speak the response
      await playAudio(displayResponse);

      toast({
        title: "✅ LENORY Analysis Complete",
        description: "Response generated and read aloud",
      });

      // Reset upload mode
      setShowUploadMode(false);
      setShowPromptInput(false);
      setUploadedFile(null);
      setFileDescription("");
      setUploadProgress(0);
      
    } catch (error) {
      console.error("File analysis error:", error);
      toast({
        title: "Error",
        description: "Failed to analyze file. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsProcessing(false);
      // Reset file input
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  return (
    <div className={isDarkMode ? "dark" : ""}>
      <div className={`min-h-screen ${isDarkMode ? "bg-slate-900" : "bg-slate-50"}`}>
        <div className="max-w-4xl mx-auto p-4 md:p-6">
          <div className="space-y-6">
            {/* Avatar with Action Buttons - Center Stage */}
            <div className="flex flex-col items-center gap-4">
              {/* VAPI Live Call Panel */}
              <Card className={`p-4 w-full max-w-sm border-2 ${
                vapi.status === "active"
                  ? "border-green-500/50 bg-green-500/5"
                  : "border-primary/20 bg-primary/5"
              }`}>
                <div className="flex flex-col items-center gap-3">
                  <div className="flex items-center gap-2">
                    <Phone className={`w-4 h-4 ${vapi.status === "active" ? "text-green-500" : "text-primary"}`} />
                    <span className="text-sm font-semibold">
                      {vapi.status === "idle" && "VAPI Live AI Call"}
                      {vapi.status === "connecting" && "Connecting..."}
                      {vapi.status === "active" && "Live Call Active"}
                      {vapi.status === "error" && "Call Error"}
                    </span>
                    {vapi.isSpeaking && (
                      <Badge variant="secondary" className="text-[10px] animate-pulse">Speaking</Badge>
                    )}
                  </div>
                  {vapi.transcript && vapi.status === "active" && (
                    <p className="text-xs text-muted-foreground text-center italic">"{vapi.transcript}"</p>
                  )}
                  {vapi.error && (
                    <p className="text-xs text-destructive text-center">{vapi.error}</p>
                  )}
                  <div className="flex gap-2">
                    {vapi.status === "idle" || vapi.status === "error" ? (
                      <Button
                        size="sm"
                        onClick={vapi.startCall}
                        className="gap-1"
                        data-testid="button-start-vapi-call"
                      >
                        <Phone className="w-3 h-3" />
                        Start Voice Call
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={vapi.stopCall}
                        className="gap-1"
                        data-testid="button-stop-vapi-call"
                      >
                        <PhoneOff className="w-3 h-3" />
                        End Call
                      </Button>
                    )}
                  </div>
                  <p className="text-[10px] text-muted-foreground text-center">
                    Powered by VAPI — real-time voice AI conversation
                  </p>
                </div>
              </Card>

              {/* Avatar Display */}
              <Card className={`p-6 w-full max-w-sm ${
                isDarkMode
                  ? "bg-gradient-to-br from-purple-600/10 to-pink-600/10 border-purple-500/30"
                  : "bg-gradient-to-br from-purple-100 to-pink-100 border-purple-200"
              }`}>
                <AvatarDisplay 
                  voice={voice} 
                  isActive={isSpeaking} 
                  isListening={isListening}
                  isMouthOpen={mouthAnimationRef.current}
                />
              </Card>

              {/* Status Indicator */}
              <div className={`flex items-center gap-2 text-sm font-medium ${
                isDarkMode ? "text-slate-300" : "text-slate-700"
              }`}>
                {isMuted && !isProcessing && !isSpeaking && (
                  <>
                    <VolumeX className="w-4 h-4" />
                    <span>Muted - Click Unmute to talk</span>
                  </>
                )}
                {isListening && !isMuted && (
                  <>
                    <Mic className="w-4 h-4 animate-pulse text-green-500" />
                    <span>Listening...</span>
                  </>
                )}
                {isSpeaking && (
                  <>
                    <Volume2 className="w-4 h-4 animate-pulse text-blue-500" />
                    <span>LENORY Speaking...</span>
                  </>
                )}
                {isProcessing && (
                  <>
                    <Sparkles className="w-4 h-4 animate-spin text-purple-500" />
                    <span>Thinking...</span>
                  </>
                )}
              </div>

              {/* Action Buttons */}
              <div className="w-full max-w-sm">
                <QuickActions 
                  onModeSelect={(mode, prompt = "") => {
                    setCurrentMode(mode);
                    // Handle special modes
                    if (mode === "ask-question") {
                      // Focus on input for direct questioning
                      const textarea = document.querySelector('[data-testid="textarea-message"]') as HTMLTextAreaElement;
                      textarea?.focus();
                    } else if (mode === "voice-tutor") {
                      // Activate voice mode
                      setMessages(prev => [...prev, {
                        id: Date.now().toString(),
                        role: "assistant",
                        content: "Voice mode activated! I'm ready to have a voice conversation with you. Speak naturally!",
                        timestamp: Date.now()
                      }]);
                      toast({ title: "Voice Mode", description: "Start speaking to begin conversation" });
                    } else if (mode === "scan-image" || mode === "summarize") {
                      // Show file upload interface
                      setShowUploadMode(true);
                      setUploadedFile(null);
                      toast({ title: (mode === "scan-image" ? "Upload Image" : "Upload PDF"), description: "Click the upload button to choose your file" });
                      setTimeout(() => fileInputRef.current?.click(), 100);
                    } else {
                      // For other modes, pre-fill the message input
                      setMessageInput(prompt);
                      // Auto-focus to prompt user to complete the thought
                      setTimeout(() => {
                        const textarea = document.querySelector('[data-testid="textarea-message"]') as HTMLTextAreaElement;
                        textarea?.focus();
                      }, 100);
                    }
                  }}
                  isDarkMode={isDarkMode}
                />
              </div>

              {/* Control Buttons - Mute/Unmute and End Call */}
              <div className="w-full max-w-sm flex gap-2">
                <Button
                  onClick={async () => {
                    if (isMuted) {
                      // User wants to unmute and start listening
                      setIsMuted(false);
                      console.log("User clicked Unmute - Starting speech recognition...");
                      
                      // Auto-connect to Gemini Live WebSocket if not connected
                      if (!isGeminiConnected) {
                        connectToGeminiLive();
                      }
                      
                      // Request mic permission if needed
                      if (micPermission !== "granted") {
                        const granted = await requestMicrophonePermission();
                        if (!granted) return;
                      }
                      
                      // Use Gemini Live for voice input - wait for WebSocket connection
                      const waitForConnection = async () => {
                        // Give WebSocket a moment to connect
                        await new Promise(resolve => setTimeout(resolve, 500));
                        
                        // Use Gemini-only PCM streaming
                        console.log("Using Gemini Live for voice input (PCM streaming)");
                        initializeContinuousListening();
                      };
                      waitForConnection();
                      toast({ title: "Voice Enabled", description: "Microphone is now active - speak whenever you're ready" });
                    } else {
                      // User wants to mute - stop PCM streaming
                      setIsMuted(true);
                      stopPCMStreaming();
                      toast({ title: "Microphone Muted", description: "Microphone is now off" });
                    }
                  }}
                  variant={isMuted ? "default" : "outline"}
                  size="sm"
                  className="flex-1 gap-2"
                  data-testid="button-toggle-mute"
                  title={isMuted ? "Click to unmute and start talking" : "Click to mute microphone"}
                >
                  {isMuted ? (
                    <>
                      <MicOff className="w-4 h-4" />
                      Unmute to Talk
                    </>
                  ) : (
                    <>
                      <Mic className="w-4 h-4" />
                      Mute
                    </>
                  )}
                </Button>

                <Button
                  onClick={handleEndCall}
                  variant="destructive"
                  size="sm"
                  className="flex-1 gap-2"
                  data-testid="button-end-call"
                  title="End the call and stop microphone"
                >
                  <PhoneOff className="w-4 h-4" />
                  End Call
                </Button>
              </div>

              {/* Voice Settings Button */}
              <Button
                onClick={() => setShowMicSettings(!showMicSettings)}
                variant="outline"
                size="sm"
                className="w-full max-w-sm gap-2"
                data-testid="button-voice-settings"
              >
                <Settings className="w-4 h-4" />
                Voice & Microphone Settings
              </Button>

              {/* Microphone Settings Panel */}
              {showMicSettings && (
                <Card className={`w-full max-w-sm p-4 ${isDarkMode ? "bg-slate-800 border-slate-700" : ""}`}>
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <h3 className="font-semibold">Voice Settings</h3>
                      <Badge variant="outline" className="gap-1 text-xs">
                        <Sparkles className="w-3 h-3" />
                        Gemini 2.0
                      </Badge>
                    </div>

                    {/* Microphone Permission */}
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 text-sm font-medium">
                        <Shield className="w-4 h-4" />
                        Microphone Permission
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-muted-foreground">
                          {micPermission === "granted" && "Access granted"}
                          {micPermission === "denied" && "Access denied"}
                          {micPermission === "prompt" && "Not requested yet"}
                        </span>
                        {micPermission !== "granted" && (
                          <Button
                            size="sm"
                            onClick={requestMicrophonePermission}
                            data-testid="button-request-mic"
                          >
                            Grant Access
                          </Button>
                        )}
                        {micPermission === "granted" && (
                          <Badge variant="secondary" className="bg-green-500/20 text-green-600">
                            Enabled
                          </Badge>
                        )}
                      </div>
                    </div>

                    {/* AI Voice Selection */}
                    <div className="space-y-2">
                      <div className="text-sm font-medium">AI Voice</div>
                      <div className="grid grid-cols-2 gap-2">
                        {GEMINI_VOICES.map((v) => (
                          <Button
                            key={v.id}
                            variant={selectedVoice === v.id ? "default" : "outline"}
                            size="sm"
                            className="justify-start text-left"
                            onClick={() => {
                              setSelectedVoice(v.id);
                              if (geminiWsRef.current?.readyState === WebSocket.OPEN) {
                                geminiWsRef.current.send(JSON.stringify({
                                  type: "set_voice",
                                  voice: v.id,
                                }));
                              }
                            }}
                            data-testid={`button-voice-${v.id}`}
                          >
                            <div className="flex flex-col">
                              <span className="font-medium">{v.name}</span>
                              <span className="text-xs opacity-70">{v.description}</span>
                            </div>
                          </Button>
                        ))}
                      </div>
                    </div>

                    {/* Connection Status */}
                    <div className="flex items-center justify-between text-sm">
                      <span>Gemini Live API</span>
                      <Badge variant={isGeminiConnected ? "secondary" : "outline"}>
                        {isGeminiConnected ? "Connected" : "Disconnected"}
                      </Badge>
                    </div>

                    {!isGeminiConnected && (
                      <Button
                        size="sm"
                        onClick={connectToGeminiLive}
                        className="w-full"
                        data-testid="button-connect-gemini"
                      >
                        Connect to AI Voice
                      </Button>
                    )}
                  </div>
                </Card>
              )}

              {/* Theme Toggle */}
              <Button
                onClick={() => setIsDarkMode(!isDarkMode)}
                variant="outline"
                size="sm"
                className="w-full max-w-sm"
                data-testid="button-toggle-theme"
              >
                {isDarkMode ? "☀️ Light Mode" : "🌙 Dark Mode"}
              </Button>
            </div>

            {/* Chat Interface - Below Avatar */}
            <div className="w-full">
              <ChatInterface 
                messages={messages} 
                isLoading={isProcessing} 
                onSendMessage={handleSendMessage}
                onClearChat={() => setMessages([])}
                onExportChat={() => {}}
              />
            </div>

            {/* Hidden File Input */}
            <input
              ref={fileInputRef}
              type="file"
              onChange={handleFileUpload}
              accept={currentMode === "scan-image" ? "image/*" : ".pdf,.doc,.docx,.txt"}
              style={{ display: "none" }}
              data-testid="input-file-upload"
            />

            {/* File Upload Interface - Shows when upload mode is active */}
            {showUploadMode && !showPromptInput && (
              <Card className={`p-6 border-2 border-dashed ${isDarkMode ? "bg-slate-800/50 border-purple-500/50" : "bg-purple-50 border-purple-300"}`}>
                <div className="space-y-4">
                  <div className="text-center">
                    <p className={`text-sm font-medium ${isDarkMode ? "text-slate-300" : "text-slate-700"}`}>
                      {currentMode === "scan-image" ? "📷 Upload Image or Problem" : "📄 Upload PDF or Notes"}
                    </p>
                    <p className={`text-xs ${isDarkMode ? "text-slate-400" : "text-slate-600"}`}>
                      {uploadedFile ? uploadedFile.name : "Click to upload or drag and drop"}
                    </p>
                  </div>

                  <div className="flex gap-3">
                    <Button
                      onClick={() => fileInputRef.current?.click()}
                      disabled={isProcessing}
                      className="flex-1 gap-2"
                      data-testid="button-upload-file"
                    >
                      <Upload className="w-4 h-4" />
                      {uploadedFile ? "Change File" : "Choose File"}
                    </Button>

                    {uploadedFile && (
                      <Button
                        onClick={() => {
                          setUploadedFile(null);
                          if (fileInputRef.current) fileInputRef.current.value = "";
                        }}
                        variant="outline"
                        size="icon"
                        disabled={isProcessing}
                        data-testid="button-remove-file"
                      >
                        <X className="w-4 h-4" />
                      </Button>
                    )}

                    <Button
                      onClick={() => {
                        setShowUploadMode(false);
                        setShowPromptInput(false);
                        setUploadedFile(null);
                        if (fileInputRef.current) fileInputRef.current.value = "";
                      }}
                      variant="outline"
                      disabled={isProcessing}
                      data-testid="button-cancel-upload"
                    >
                      Cancel
                    </Button>
                  </div>

                  {uploadedFile && !isProcessing && (
                    <div className={`text-xs p-3 rounded ${isDarkMode ? "bg-slate-700" : "bg-white"}`}>
                      <p className={isDarkMode ? "text-slate-300" : "text-slate-700"}>
                        ✓ Ready: <strong>{uploadedFile.name}</strong>
                      </p>
                    </div>
                  )}

                  {isProcessing && (
                    <div className={`text-xs p-3 rounded animate-pulse ${isDarkMode ? "bg-slate-700" : "bg-white"}`}>
                      <p className={isDarkMode ? "text-slate-300" : "text-slate-700"}>
                        ⏳ Analyzing with LENORY...
                      </p>
                    </div>
                  )}
                </div>
              </Card>
            )}

            {/* Prompt Input - Shows after file is selected */}
            {showPromptInput && uploadedFile && (
              <Card className={`p-6 border-2 ${isDarkMode ? "bg-slate-800/50 border-purple-500/30" : "bg-purple-50 border-purple-200"}`}>
                <div className="space-y-4">
                  <div>
                    <p className={`text-sm font-medium mb-2 ${isDarkMode ? "text-slate-300" : "text-slate-700"}`}>
                      📎 File: <span className="text-purple-600 dark:text-purple-400">{uploadedFile.name}</span>
                    </p>
                    <p className={`text-xs ${isDarkMode ? "text-slate-400" : "text-slate-600"}`}>
                      Now describe what you need help with. This helps LENORY give you better responses.
                    </p>
                  </div>

                  <Textarea
                    placeholder={
                      currentMode === "scan-image" 
                        ? "e.g., Solve this math problem step by step, explain the physics concept, or find the errors in this code..."
                        : "e.g., Summarize the key points, extract formulas, find important concepts, or create a study guide..."
                    }
                    value={fileDescription}
                    onChange={(e) => setFileDescription(e.target.value)}
                    rows={4}
                    className="resize-none"
                    disabled={isProcessing}
                    data-testid="textarea-file-description"
                  />

                  <div className="flex gap-3">
                    <Button
                      onClick={handleAnalyzeWithDescription}
                      disabled={!fileDescription.trim() || isProcessing}
                      className="flex-1 gap-2 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700"
                      data-testid="button-analyze-with-description"
                    >
                      <Send className="w-4 h-4" />
                      {isProcessing ? "Analyzing..." : "Analyze with LENORY"}
                    </Button>

                    <Button
                      onClick={() => {
                        setShowPromptInput(false);
                        setFileDescription("");
                      }}
                      variant="outline"
                      disabled={isProcessing}
                      data-testid="button-back-to-upload"
                    >
                      Back
                    </Button>
                  </div>

                  {isProcessing && (
                    <div className={`text-xs p-3 rounded animate-pulse ${isDarkMode ? "bg-slate-700" : "bg-white"}`}>
                      <p className={isDarkMode ? "text-slate-300" : "text-slate-700"}>
                        🔍 LENORY is analyzing your file and request...
                      </p>
                    </div>
                  )}
                </div>
              </Card>
            )}

            {/* Type Message Input - Simple */}
            {!showUploadMode && (
              <Card className={`p-4 ${isDarkMode ? "bg-slate-800 border-slate-700" : "bg-white border-slate-200"}`}>
                <div className="space-y-3">
                  <Textarea
                    placeholder="Type your question (press Enter to send)..."
                    value={messageInput}
                    onChange={(e) => setMessageInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        handleSendMessage();
                      }
                    }}
                    rows={3}
                    className="resize-none"
                    disabled={isProcessing}
                    data-testid="textarea-message"
                  />
                  <div className="flex gap-2">
                    <Button
                      onClick={() => handleSendMessage()}
                      disabled={!messageInput.trim() || isProcessing}
                      className="flex-1 gap-2"
                      data-testid="button-send-message"
                    >
                      <Send className="w-4 h-4" />
                      {isProcessing ? "Thinking..." : "Send"}
                    </Button>
                    <Button
                      onClick={() => setMessageInput("")}
                      variant="outline"
                      size="sm"
                      data-testid="button-clear-input"
                    >
                      Clear
                    </Button>
                  </div>
                  <div className={`text-xs ${isDarkMode ? "text-slate-400" : "text-slate-600"}`}>
                    💬 Speak naturally or type your questions • Press Enter to send • Shift+Enter for new line
                  </div>
                </div>
              </Card>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
