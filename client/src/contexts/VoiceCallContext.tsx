// client/src/contexts/VoiceCallContext.tsx
//
// Previously useVapi() was called INSIDE Chat.tsx's VapiPanel component —
// meaning the call lived and died with that component. Navigating to a
// different chat session, or away from the Chat page entirely, unmounted
// VapiPanel, whose cleanup effect explicitly calls vapi.stop() — silently
// ending the call. This is the actual reason "open another session and
// still be talking to it" didn't work.
//
// Mounting the Vapi instance here instead, ABOVE the router in App.tsx,
// means it's created once and never torn down by route changes — the call
// (and its Vapi connection) now genuinely survives switching between chat
// sessions or pages within the app, for as long as the browser tab itself
// stays open. It still cannot survive the tab being closed or backgrounded
// for long — no website can keep a microphone/JS execution alive across
// that on iOS or Android; that's an OS-level restriction, not something
// fixable in application code.
import { createContext, useContext, useState, useCallback, useRef, useEffect, type ReactNode } from "react";
import { useVapi } from "@/hooks/useVapi";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { getVapiVoiceForCall } from "@/lib/useVoice";

const VOICE_SYSTEM_PROMPT_BASE = `You are LENORY, a warm AI study companion having a real spoken conversation with a student — not reading a script or writing an essay out loud.

## SPEECH-FIRST STYLE (this is a voice call, not a chat message)
- Keep responses SHORT. A few sentences, not a paragraph. If the student needs more, they'll ask — don't front-load everything.
- Talk the way a patient tutor actually talks, not the way a textbook is written. "Yeah, let's make it simpler" beats "It is important to note that...".
- Use contractions and everyday phrasing. Avoid formal written-English constructions that sound stiff out loud.
- Break a longer explanation into short spoken chunks — "Okay, so mass is how much matter something has." then "Weight is the force gravity puts on that mass." — not one dense block.
- Instead of "Firstly, it is important to note..." say "Okay, so here's the important part."

## ACKNOWLEDGING BEFORE ANSWERING
Before diving into an answer, briefly acknowledge what the student said — "Yeah, I get you", "Okay, that makes sense", "Ah, good question", "Right, I see what you mean" — then continue. Don't launch straight into a lecture. Vary these; don't repeat the same acknowledgment every turn.

## HESITATION (use sparingly — see "don't overdo it" below)
Natural spoken hesitation is fine when genuinely thinking through something: "Uh... let me think about that.", "Hmm, okay, actually there's an easier way to look at it.", "Wait — yeah, I see what happened." Never insert "um" or "uh" before every single sentence — that reads as more robotic than saying nothing.

## CORRECTING YOURSELF
If you realize mid-answer you said something wrong or could explain it better, correct naturally: "Wait, sorry — that part wasn't right.", "Actually, let me say that better.", "Hold on, I explained that badly." Never say things like "ERROR" or "PREVIOUS RESPONSE INCORRECT."

## ENERGY AND EMOTION — FROM CONTEXT, NEVER RANDOM
Match delivery to what the student actually said:
- Frustrated ("why isn't this working") → calm, supportive: "Yeah, I can see why that's frustrating. Let's check it one step at a time."
- Excited ("I finally got it!") → energetic, genuine: "Yes! Exactly, that's it!"
- Confused/lost → patient, slower, simpler wording, no jargon.
- Routine question → calm, conversational, medium energy — this is the default. Don't manufacture excitement or hesitation where none is warranted.

## TEACHING STYLE (student mode)
Never sound like a lecturer reading a textbook. Bad: "Photosynthesis is the biochemical process by which photoautotrophic organisms convert light energy into chemical energy." Better: "Yeah, let's make it much simpler — basically, the plant is using light to make its own food. That's the core idea."

## NIGERIAN ENGLISH
Speak in a natural, respectful Nigerian English register by default — warm, conversational rhythm and word choice, never an exaggerated or comedic accent, never a caricature. If the student code-switches into Nigerian expressions or Pidgin naturally, understand and respond appropriately without forcing slang that wasn't invited.

## DON'T OVER-HUMANIZE
Naturalness comes from appropriate variation, not maximum variation. Do not hesitate, self-correct, or add acknowledgments in every single response — a real person doesn't perform every conversational tic every time they speak. If in doubt, prefer the plain, direct answer over adding a "human" flourish.

## TOOLS
- If the student asks something needing current information from the internet, use search_web.
- If the student references something discussed before ("like we talked about", "remember when I asked about..."), use search_past_chats before assuming you don't know.
- If a file was just shared with you mid-call (you'll see it as a system note), you can see and discuss its contents directly — don't ask the student to describe it to you.

## SAFETY
Never claim to be human. Never claim to have a physical body or real-world experiences you don't have, or that you performed physical actions you didn't. Never use emotional manipulation or encourage dependency on you over real people in the student's life.`;

const VOICE_TOOLS = [
  {
    type: "function" as const,
    function: {
      name: "search_web",
      description: "Search the internet for current information the student is asking about.",
      parameters: {
        type: "object",
        properties: { query: { type: "string", description: "The search query" } },
        required: ["query"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "search_past_chats",
      description: "Search the student's past chat sessions with LENORY for something they discussed before.",
      parameters: {
        type: "object",
        properties: { query: { type: "string", description: "Keyword or topic to search for in past conversations" } },
        required: ["query"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_my_account_info",
      description: "Look up the student's own account info — plan, credit balance, number of images generated, number of chat sessions.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
];

const ADMIN_VOICE_TOOLS = [
  {
    type: "function" as const,
    function: {
      name: "get_admin_overview",
      description: "Read-only platform-wide stats for the admin: total users, signups, users by tier, revenue estimates.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "adjust_user_credits",
      description: "Add or deduct credits from a specific user's account by their email. Positive amount adds, negative deducts.",
      parameters: {
        type: "object",
        properties: {
          userEmail: { type: "string", description: "The target user's email address" },
          amount: { type: "number", description: "Credits to add (positive) or deduct (negative)" },
        },
        required: ["userEmail", "amount"],
      },
    },
  },
];

// Re-adding tool-calling in stages after it silently broke voice entirely
// once already (call connected, assistant never spoke, no error surfaced).
// Everything below is fully built and ready, but ACTIVE_VOICE_TOOLS still
// only turns on search_web — the rest wait for confirmation that stage 1
// actually works on a real call before going live, same reasoning as
// before: one deliberate step at a time, not everything stacked at once.
const ACTIVE_VOICE_TOOLS = [VOICE_TOOLS[0]];

interface VoiceCallContextValue {
  status: "idle" | "connecting" | "active" | "error";
  isSpeaking: boolean;
  hasGreeted: boolean;
  transcript: string;
  callDurationSeconds: number;
  error: string | null;
  activeSessionId: string | null;
  startVoiceCall: (opts: { sessionId?: string | null; userId?: string; userName?: string; isAdmin?: boolean; chatHistory?: string; onCreditError?: (msg: string) => void }) => Promise<void>;
  endVoiceCall: () => void;
  sendMidCallContext: (text: string) => void;
}

const VoiceCallContext = createContext<VoiceCallContextValue | null>(null);

export function VoiceCallProvider({ children }: { children: ReactNode }) {
  const vapi = useVapi();
  const { toast } = useToast();
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const hasPlayedConnectSound = useRef(false);

  const playConnectChime = useCallback(() => {
    // A short, synthesized two-tone chime — no audio asset needed, so
    // nothing to fetch/host/keep alive, and it works offline.
    try {
      const AudioCtx = (window as any).AudioContext || (window as any).webkitAudioContext;
      const ctx = new AudioCtx();
      const now = ctx.currentTime;
      [660, 880].forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0, now + i * 0.12);
        gain.gain.linearRampToValueAtTime(0.15, now + i * 0.12 + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.12 + 0.18);
        osc.connect(gain).connect(ctx.destination);
        osc.start(now + i * 0.12);
        osc.stop(now + i * 0.12 + 0.2);
      });
    } catch {}
  }, []);

  const startVoiceCall = useCallback(async (opts: { sessionId?: string | null; userId?: string; userName?: string; isAdmin?: boolean; chatHistory?: string; onCreditError?: (msg: string) => void }) => {
    try {
      await apiRequest("POST", "/api/live-ai/voice-start", {});
    } catch (e: any) {
      let msg = "You need at least 20 credits to start a voice session. Please top up.";
      try {
        const parsed = JSON.parse(String(e?.message || "").replace(/^\d+:\s*/, ""));
        if (parsed?.message) msg = parsed.message;
      } catch {}
      if (opts.onCreditError) opts.onCreditError(msg);
      else toast({ title: "Can't start voice call", description: msg, variant: "destructive" });
      return;
    }

    setActiveSessionId(opts.sessionId || null);
    hasPlayedConnectSound.current = false;

    // Admin gets a name-aware greeting and, once the admin tools are
    // activated (see ADMIN_VOICE_TOOLS above — built, not yet live), read
    // access to platform stats plus the ability to adjust a user's
    // credits. Everyone else just gets a personalized greeting if we know
    // their name.
    const greetName = opts.userName ? `, ${opts.userName}` : "";
    const firstMessage = opts.isAdmin
      ? `Hey${greetName}, good to hear from you. What do you need?`
      : `Hey${greetName}, I'm here! Keep going, or something new?`;
    const adminPromptAddition = opts.isAdmin
      ? `\n\n## ADMIN MODE\nYou're speaking with Felix, LENORY's creator and admin. Recognize him as such. You have read access to platform-wide stats (get_admin_overview) and can adjust a specific user's credits by email (adjust_user_credits) — every other admin capability stays read-only in this voice mode; anything beyond those two tools, tell him to use the Admin Dashboard.`
      : "";
    const creatorNote = `\n\nLENORY was built by Felix, a student founder in Nigeria, with this assistant (an AI coding agent) doing the engineering work under his direction. If asked who made you or who's on the team, answer honestly along those lines — don't claim a large company or team that doesn't exist.`;

    await vapi.startCall({
      name: "LENORY Live Tutor",
      firstMessage,
      firstMessageMode: "assistant-speaks-first",
      metadata: { userId: opts.userId, sessionId: opts.sessionId, isAdmin: opts.isAdmin },
      // Re-adding tool-calling carefully after it silently broke voice
      // entirely once already (call connected, assistant never spoke a
      // word — Vapi doesn't surface that failure to the client). Only
      // search_web is live this time (see ACTIVE_VOICE_TOOLS above) so a
      // second failure is isolated to one thing, not several stacked
      // changes. Setting BOTH serverUrl (flat string — the field name used
      // in Vapi's "Default Tools"/"Introduction to Tools" docs) and
      // server.url (nested object — used elsewhere in their docs) since
      // which one this API version actually expects isn't independently
      // confirmable without a live test call to check against; an unknown
      // extra field being ignored is a normal, safe outcome, so providing
      // both costs nothing if only one is real.
      serverUrl: `${window.location.origin}/api/vapi/tool-call`,
      server: { url: `${window.location.origin}/api/vapi/tool-call` },
      model: {
        provider: "openai",
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: `${VOICE_SYSTEM_PROMPT_BASE}${creatorNote}${adminPromptAddition}${opts.chatHistory ? `\n\nRecent chat history for context:\n${opts.chatHistory}` : ""}`,
          },
        ],
        tools: ACTIVE_VOICE_TOOLS,
      },
      voice: getVapiVoiceForCall(),
      // Vapi's own default silence timeout is much shorter than a real
      // study conversation needs (a student thinking through a problem, or
      // reading something before responding, can easily go quiet for a
      // minute) — previously unset, meaning Vapi's short default likely
      // explains "when I don't talk for a while it doesn't work again":
      // the call had already been auto-ended by Vapi, silently, while the
      // UI gave no indication that had happened.
      silenceTimeoutSeconds: 600,
      // nova-3 (up from nova-2): Deepgram's more recent, more accurate
      // model — directly targets "sometimes when you say a word it spells
      // it wrong."
      transcriber: { provider: "deepgram", model: "nova-3", language: "en", smartFormat: true },
      startSpeakingPlan: {
        waitSeconds: 0.2,
        smartEndpointingPlan: { provider: "livekit", waitFunction: "2000 / (1 + exp(-10 * (x - 0.5)))" },
      },
      stopSpeakingPlan: { numWords: 0, voiceSeconds: 0.15, backoffSeconds: 0.8 },
    });
  }, [vapi, toast]);

  const endVoiceCall = useCallback(() => {
    vapi.stopCall();
    setActiveSessionId(null);
  }, [vapi]);

  // Injects context into an already-active call without ending it — used
  // when the student uploads a file mid-call. Sent as a system message so
  // the assistant can reference it in its next reply without narrating
  // "I received a file" out loud.
  const sendMidCallContext = useCallback((text: string) => {
    vapi.send({ type: "add-message", message: { role: "system", content: text } });
  }, [vapi]);

  // Play the connect chime the moment the call actually goes active.
  useEffect(() => {
    if (vapi.status === "active" && !hasPlayedConnectSound.current) {
      hasPlayedConnectSound.current = true;
      playConnectChime();
    }
    if (vapi.status !== "active") {
      hasPlayedConnectSound.current = false;
    }
  }, [vapi.status, playConnectChime]);

  // Safety net for the exact failure mode that happened once already:
  // call connects, assistant never produces any speech, with zero
  // indication anything's wrong. If the call is active but hasGreeted
  // never flips true within 12s, something's broken — surface it clearly
  // and end the call, rather than leave the student sitting in silence
  // wondering if it's their fault.
  const greetWatchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (vapi.status === "active" && !vapi.hasGreeted) {
      greetWatchdogRef.current = setTimeout(() => {
        if (!vapi.hasGreeted) {
          toast({ title: "LENORY isn't responding", description: "Something went wrong connecting — please try again. If it keeps happening, let support know.", variant: "destructive" });
          vapi.stopCall();
        }
      }, 12000);
    }
    return () => { if (greetWatchdogRef.current) clearTimeout(greetWatchdogRef.current); };
  }, [vapi.status, vapi.hasGreeted, vapi.stopCall, toast]);

  // Real-time billing (20cr/min, ticked every 10s) + auto-hangup on low
  // credits. Moved here from Chat.tsx's VapiPanel — that component's effect
  // only ran while VapiPanel itself was mounted, so navigating away from
  // the page that started the call would have silently stopped billing
  // protection on a call that (now) keeps running in the background. This
  // must live wherever the call itself lives.
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (vapi.status === "active") {
      heartbeatRef.current = setInterval(async () => {
        try {
          const res = await apiRequest("POST", "/api/voice/heartbeat", {});
          const data = await res.json();
          if (data?.lowCredits) {
            toast({ title: "Low on credits", description: "Ending call — top up or upgrade your plan to keep using LENORY Voice AI.", variant: "destructive" });
            setTimeout(() => vapi.stopCall(), 3000);
          }
        } catch (e: any) {
          if (String(e?.message || "").startsWith("402")) {
            toast({ title: "Insufficient credits", description: "Please top up or upgrade your plan.", variant: "destructive" });
            vapi.stopCall();
          }
        }
      }, 10000);
    } else if (heartbeatRef.current) {
      clearInterval(heartbeatRef.current);
      heartbeatRef.current = null;
    }
    return () => { if (heartbeatRef.current) clearInterval(heartbeatRef.current); };
  }, [vapi.status, vapi.stopCall, toast]);

  // When the call ends, save a cleaned transcript into whichever session it
  // was tied to and deduct real credits — also moved here for the same
  // reason as the heartbeat above.
  const prevStatusRef = useRef(vapi.status);
  useEffect(() => {
    const wasLive = prevStatusRef.current === "active" || prevStatusRef.current === "connecting";
    if (wasLive && vapi.status === "idle" && vapi.messages.length > 0) {
      apiRequest("POST", "/api/vapi/end-call", {
        sessionId: activeSessionId,
        messages: vapi.messages.filter((m) => m.role === "user" || m.role === "assistant"),
        durationSeconds: vapi.callDurationSeconds,
      })
        .then(() => queryClient.invalidateQueries({ queryKey: ["/api/chat/messages", activeSessionId] }))
        .catch(() => {});
    }
    prevStatusRef.current = vapi.status;
  }, [vapi.status, vapi.messages, activeSessionId, vapi.callDurationSeconds]);

  return (
    <VoiceCallContext.Provider
      value={{
        status: vapi.status,
        isSpeaking: vapi.isSpeaking,
        hasGreeted: vapi.hasGreeted,
        transcript: vapi.transcript,
        callDurationSeconds: vapi.callDurationSeconds,
        error: vapi.error,
        activeSessionId,
        startVoiceCall,
        endVoiceCall,
        sendMidCallContext,
      }}
    >
      {children}
    </VoiceCallContext.Provider>
  );
}

export function useVoiceCall() {
  const ctx = useContext(VoiceCallContext);
  if (!ctx) throw new Error("useVoiceCall must be used within a VoiceCallProvider");
  return ctx;
}
