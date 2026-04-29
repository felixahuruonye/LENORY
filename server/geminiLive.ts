import { WebSocket as WS } from "ws";
import { GoogleGenAI, Modality } from "@google/genai";

const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;

interface GeminiLiveSession {
  ws: WS;
  userId: string;
  sessionId: string;
  isConnected: boolean;
  isReceivingAudio: boolean;
  selectedVoice: string;
  language: string;
  liveSession: any | null;
  isStreaming: boolean;
}

const activeSessions = new Map<string, GeminiLiveSession>();

export const GEMINI_VOICES = [
  { id: "Aoede", name: "Aoede", description: "Bright & melodic", gender: "female" },
  { id: "Charon", name: "Charon", description: "Deep & authoritative", gender: "male" },
  { id: "Fenrir", name: "Fenrir", description: "Strong & commanding", gender: "male" },
  { id: "Kore", name: "Kore", description: "Warm & nurturing", gender: "female" },
  { id: "Puck", name: "Puck", description: "Playful & energetic", gender: "neutral" },
];

// Use the latest Live API model
const LIVE_MODEL = "gemini-2.0-flash-live-001";

export async function handleGeminiLiveConnection(ws: WS, userId: string) {
  const sessionId = `live_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  
  const session: GeminiLiveSession = {
    ws,
    userId,
    sessionId,
    isConnected: true,
    isReceivingAudio: false,
    selectedVoice: "Aoede",
    language: "en",
    liveSession: null,
    isStreaming: false,
  };
  
  activeSessions.set(sessionId, session);
  console.log(`Gemini Live session started: ${sessionId} for user: ${userId}`);

  // Initialize Gemini Live connection
  await initializeGeminiLiveSession(session);

  ws.send(JSON.stringify({
    type: "session_started",
    sessionId,
    voices: GEMINI_VOICES,
    message: "Connected to LENORY AI Voice with Gemini Live streaming.",
  }));

  ws.on("message", async (message: Buffer, isBinary: boolean) => {
    try {
      // Route based on isBinary flag for reliable binary detection
      if (isBinary) {
        // Binary PCM audio frame - send directly to Gemini Live
        await handleBinaryAudio(session, message);
        return;
      }

      // JSON text message
      const data = JSON.parse(message.toString());
      
      switch (data.type) {
        case "audio_end":
          await handleAudioEnd(session);
          break;
        case "text_input":
          await handleTextInput(session, data.text);
          break;
        case "set_voice":
          session.selectedVoice = data.voice || "Aoede";
          ws.send(JSON.stringify({ type: "voice_changed", voice: session.selectedVoice }));
          // Reinitialize with new voice
          await initializeGeminiLiveSession(session);
          break;
        case "set_language":
          session.language = data.language || "en";
          ws.send(JSON.stringify({ type: "language_changed", language: session.language }));
          break;
        case "end_session":
          closeSession(sessionId);
          break;
        default:
          console.log("Unknown message type:", data.type);
      }
    } catch (error) {
      console.error("Error processing Gemini Live message:", error);
      ws.send(JSON.stringify({
        type: "error",
        message: "Failed to process message",
      }));
    }
  });

  ws.on("close", () => {
    console.log(`Gemini Live session closed: ${sessionId}`);
    closeSession(sessionId);
  });

  ws.on("error", (error) => {
    console.error(`Gemini Live session error: ${sessionId}`, error);
    closeSession(sessionId);
  });
}

async function initializeGeminiLiveSession(session: GeminiLiveSession) {
  if (!GOOGLE_API_KEY) {
    console.error("No GOOGLE_API_KEY configured");
    return;
  }

  try {
    const ai = new GoogleGenAI({ apiKey: GOOGLE_API_KEY });
    
    const config = {
      responseModalities: [Modality.AUDIO, Modality.TEXT],
      systemInstruction: `You are LENORY, an advanced AI tutor specializing in Nigerian education (JAMB, WAEC, NECO).
        
Voice: ${session.selectedVoice}
Language: ${session.language}

Guidelines:
- Be encouraging, supportive, and patient
- Explain concepts clearly and simply
- Use examples relevant to Nigerian students  
- Keep responses conversational for voice interaction
- Answer questions directly and helpfully
- When you hear audio, first acknowledge what the student said, then respond
- For math and science, explain step by step`,
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: {
            voiceName: session.selectedVoice,
          },
        },
      },
    };

    // Try to establish live connection
    try {
      const liveSession = await (ai as any).live?.connect(LIVE_MODEL, config);
      if (liveSession) {
        session.liveSession = liveSession;
        console.log(`Gemini Live session established for ${session.sessionId}`);
        
        // Start listening for responses
        startReceivingResponses(session);
      }
    } catch (liveError: any) {
      console.log("Live API not available, using fallback:", liveError.message);
      session.liveSession = null;
    }
  } catch (error) {
    console.error("Error initializing Gemini Live:", error);
  }
}

async function startReceivingResponses(session: GeminiLiveSession) {
  if (!session.liveSession) return;

  try {
    for await (const response of session.liveSession.receive()) {
      if (!session.isConnected) break;

      // Handle audio response
      if (response.audio) {
        const audioBase64 = Buffer.from(response.audio).toString('base64');
        session.ws.send(JSON.stringify({
          type: "audio_output",
          audio: audioBase64,
          mimeType: "audio/pcm;rate=24000",
          isStreaming: true,
        }));
      }

      // Handle text response (transcript)
      if (response.text) {
        session.ws.send(JSON.stringify({
          type: "ai_response",
          text: response.text,
          voice: session.selectedVoice,
          hasAudio: !!response.audio,
        }));
      }

      // Handle turn complete
      if (response.turnComplete) {
        session.ws.send(JSON.stringify({ type: "processing_complete" }));
      }
    }
  } catch (error) {
    console.error("Error receiving Gemini responses:", error);
  }
}

async function handleBinaryAudio(session: GeminiLiveSession, audioData: Buffer) {
  if (!session.liveSession) {
    // No fallback - require live session for binary PCM streaming
    session.ws.send(JSON.stringify({
      type: "error",
      message: "Gemini Live session not connected. Please reconnect.",
    }));
    return;
  }

  try {
    // Send raw PCM audio directly to Gemini Live session
    await session.liveSession.sendRealtimeInput({
      audio: audioData,
      mimeType: "audio/pcm;rate=16000",
    });
    
    if (!session.isReceivingAudio) {
      session.isReceivingAudio = true;
      session.ws.send(JSON.stringify({ type: "receiving_audio" }));
    }
  } catch (error) {
    console.error("Error sending binary audio to Gemini:", error);
    session.ws.send(JSON.stringify({
      type: "error",
      message: "Failed to stream audio to Gemini Live",
    }));
  }
}

// Note: handleAudioChunk removed - all audio now uses binary PCM frames via handleBinaryAudio

async function handleAudioEnd(session: GeminiLiveSession) {
  session.isReceivingAudio = false;
  
  if (session.liveSession) {
    try {
      // Signal end of audio input
      await session.liveSession.sendRealtimeInput({ endOfTurn: true });
      session.ws.send(JSON.stringify({ type: "processing_started" }));
    } catch (error) {
      console.error("Error ending audio:", error);
    }
  }
}

// Note: handleAudioInput removed - all audio now uses binary PCM frames via handleBinaryAudio
// Note: processAudioWithFallback removed - all audio now uses Gemini Live binary streaming only
// Note: generateTTSAudio removed - all audio now uses Gemini Live streaming only

async function handleTextInput(session: GeminiLiveSession, text: string) {
  if (!GOOGLE_API_KEY) {
    session.ws.send(JSON.stringify({
      type: "error",
      message: "AI service not configured",
    }));
    return;
  }

  // Strict Live-only enforcement - no fallback
  if (!session.liveSession) {
    session.ws.send(JSON.stringify({
      type: "error",
      message: "Gemini Live session not connected. Please reconnect.",
    }));
    return;
  }

  session.ws.send(JSON.stringify({ type: "processing_started" }));

  try {
    // Send text through Gemini Live session only
    await session.liveSession.send({ text });
    // Response will come through the receive() loop in startReceivingResponses
  } catch (error) {
    console.error("Live session text failed:", error);
    session.ws.send(JSON.stringify({
      type: "error",
      message: "Failed to send text to Gemini Live. Please try again.",
    }));
    session.ws.send(JSON.stringify({ type: "processing_complete" }));
  }
}

// Note: generateTTSAudio removed - all audio now uses Gemini Live streaming only

function closeSession(sessionId: string) {
  const session = activeSessions.get(sessionId);
  if (session) {
    session.isConnected = false;
    if (session.liveSession) {
      try {
        session.liveSession.close?.();
      } catch (e) {
        console.error("Error closing live session:", e);
      }
    }
    activeSessions.delete(sessionId);
  }
}

export function getActiveSessionCount(): number {
  return activeSessions.size;
}
