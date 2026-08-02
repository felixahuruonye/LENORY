import { supabaseDb } from "./db";
// server/routes.ts
import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import fs from "fs";
import os from "os";
import path from "path";
// @ts-ignore - multer types not available but package is installed
import multer from "multer";
import { ADMIN_EMAIL as REAL_ADMIN_EMAIL, getApiKeyStatus, logAdminError, getRecentErrors, getAdminOverview, buildAdminContextBlock, logApiUsage, getApiUsageSummary, getStabilityBalance, getModelUsageByTier, getProviderBalances, getPaystackTransactions } from "./adminTools";
import { getOrCreateCredits, deductCredits, addCredits, getTierLimits, checkCreditGate, resetMonthlyCredits, resetDailyCredits } from "./creditsStore";
import { storage } from "./storage";
import { registerKbRoutes } from "./kbRoutes";
import { supabaseAuth, optionalSupabaseAuth, type AuthenticatedRequest, generateLenoryId, createDeviceToken, verifyDeviceToken } from "./supabaseAuth";
import {
  chatWithAI,
  chatWithAISmartFallback,
  generateLesson,
  generateSyllabus,
  gradeQuiz,
  transcribeAudio,
  generateSpeech,
  summarizeText,
  generateFlashcards,
  generateQuizFromText,
  generateWebsiteWithGemini,
  explainCodeForBeginners,
  debugCodeWithLENORY,
  explainTopicWithLENORY,
  generateImageWithLENORY,
  generateSmartChatTitle,
  analyzeFileWithGeminiVision,
  searchInternetWithGemini,
  generateLessonFromTextWithGemini,
  fixTextWithLENORY,
  gradeAnswersWithLENORY,
  generateQuestionsWithLENORY,
  chatWithGemini,
} from "./gemini";
import { nanoid } from "nanoid";
import { learnFromUserMessage, mergePreferences } from "./memoryLearner";
import { initializePayment, verifyPayment, convertNairaToKobo } from "./paystack";
import { nanoid as generateId } from "nanoid";

import { registerChatRoutes } from "./replit_integrations/chat";
import { handleGeminiLiveConnection, GEMINI_VOICES } from "./geminiLive";

// ── NEW: IMPORT AXIOS FOR OAUTH ──────────────────────────────────────────────
import axios from 'axios';

// ── Multer setup ONCE at the top ────────────────────────────────────────────
const uploadMulter = multer({ storage: multer.memoryStorage() });

// ─── NEW: GOOGLE OAUTH CONFIG ────────────────────────────────────
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || 'http://localhost:5000/api/integrations/google-drive/callback';

// ─── NEW: GITHUB OAUTH CONFIG ────────────────────────────────────
const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID || '';
const GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET || '';
const GITHUB_REDIRECT_URI = process.env.GITHUB_REDIRECT_URI || 'http://localhost:5000/api/integrations/github/callback';

async function getGitHubOwner(token: { userLogin?: string; accessToken: string }): Promise<string> {
  if (token.userLogin) return token.userLogin;
  const res = await axios.get('https://api.github.com/user', { headers: { Authorization: `token ${token.accessToken}` } });
  return res.data.login;
}

// ─── NEW: OAUTH HELPERS ─────────────────────────────────────────────────
function getGoogleAuthUrl(userId: string): string {
  const scope = 'https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/documents.readonly';
  return `https://accounts.google.com/o/oauth2/v2/auth?client_id=${GOOGLE_CLIENT_ID}&redirect_uri=${GOOGLE_REDIRECT_URI}&scope=${encodeURIComponent(scope)}&response_type=code&access_type=offline&state=${userId}`;
}

function getGitHubAuthUrl(userId: string): string {
  const scope = 'repo read:user';
  return `https://github.com/login/oauth/authorize?client_id=${GITHUB_CLIENT_ID}&redirect_uri=${GITHUB_REDIRECT_URI}&scope=${encodeURIComponent(scope)}&state=${userId}`;
}

export async function registerRoutes(app: Express): Promise<Server> {
  registerKbRoutes(app);
  // Wire up Replit AI Integrations
  registerChatRoutes(app);

  // ================================================================
  //  ALL YOUR EXISTING ROUTES (unchanged from your code)
  //  We keep every single endpoint you already had.
  // ================================================================

  // ─── AUTH ROUTES ──────────────────────────────────────────────────────────
  app.get('/api/auth/user', supabaseAuth, async (req: any, res: Response) => {
    try {
      const userId = req.userId;
      const user = await storage.getUser(userId);
      if (!user) {
        return res.json({
          id: userId,
          email: req.userEmail || '',
          firstName: null,
          lastName: null,
          profileImageUrl: null,
          role: 'student',
          subscriptionTier: 'free',
        });
      }
      res.json(user);
    } catch (error) {
      console.error("Error fetching user:", error);
      res.status(500).json({ message: "Failed to fetch user" });
    }
  });

  async function getSupabaseAdmin() {
    const { createClient } = await import('@supabase/supabase-js');
    const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '';
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
    if (!supabaseUrl || !supabaseServiceKey) return null;
    return createClient(supabaseUrl, supabaseServiceKey, { auth: { autoRefreshToken: false, persistSession: false } });
  }

  app.post('/api/auth/check-email', async (req: Request, res: Response) => {
    try {
      const { email } = req.body;
      if (!email) return res.status(400).json({ exists: false, error: 'Email is required' });
      const admin = await getSupabaseAdmin();
      if (!admin) return res.status(500).json({ exists: false, error: 'Auth not configured' });
      const { data: dbUser } = await admin.from('users').select('id').eq('email', email).maybeSingle();
      if (dbUser) return res.json({ exists: true });
      let page = 1;
      const perPage = 1000;
      while (true) {
        const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
        if (error) { console.error('Error checking email:', error); return res.status(500).json({ exists: false, error: error.message }); }
        const userFound = data.users.some((u: any) => u.email?.toLowerCase() === email.toLowerCase());
        if (userFound) return res.json({ exists: true });
        if (data.users.length < perPage) break;
        page++;
      }
      return res.json({ exists: false });
    } catch (error: any) {
      console.error('Error checking email existence:', error);
      return res.status(500).json({ exists: false, error: error.message });
    }
  });

  app.post('/api/auth/save-device', supabaseAuth, async (req: any, res: Response) => {
    try {
      const userId = req.userId;
      const userEmail = req.userEmail;
      const { deviceInfo } = req.body;
      const admin = await getSupabaseAdmin();
      if (!admin) return res.status(500).json({ message: 'Auth not configured' });
      const { data: userData, error: userErr } = await admin.auth.admin.getUserById(userId);
      if (userErr || !userData?.user) return res.status(404).json({ message: 'User not found' });
      let lenoryId = userData.user.user_metadata?.lenory_id;
      let firstName = userData.user.user_metadata?.full_name?.split(' ')[0] ||
                      userData.user.user_metadata?.name?.split(' ')[0] ||
                      userData.user.user_metadata?.firstName || '';
      if (!lenoryId) {
        lenoryId = generateLenoryId();
        await admin.auth.admin.updateUserById(userId, {
          user_metadata: { ...userData.user.user_metadata, lenory_id: lenoryId },
        });
      }
      const deviceToken = createDeviceToken({ userId, lenoryId, email: userEmail });
      res.json({ deviceToken, lenoryId, firstName });
    } catch (error) {
      console.error('Save device error:', error);
      res.status(500).json({ message: 'Failed to save device session' });
    }
  });

  app.post('/api/auth/verify-device', async (req: Request, res: Response) => {
    try {
      const { deviceToken } = req.body;
      if (!deviceToken) return res.json({ valid: false });
      const payload = verifyDeviceToken(deviceToken);
      if (!payload) return res.json({ valid: false });
      const admin = await getSupabaseAdmin();
      if (!admin) return res.json({ valid: false });
      const { data: userData, error } = await admin.auth.admin.getUserById(payload.userId);
      if (error || !userData?.user) return res.json({ valid: false });
      const user = userData.user;
      const lenoryId = user.user_metadata?.lenory_id || payload.lenoryId;
      const firstName = user.user_metadata?.full_name?.split(' ')[0] ||
                        user.user_metadata?.name?.split(' ')[0] ||
                        user.user_metadata?.firstName || '';
      res.json({ valid: true, userId: payload.userId, email: user.email, lenoryId, firstName });
    } catch (error) {
      res.json({ valid: false });
    }
  });

  app.get('/api/auth/lernory-lookup/:lenoryId', async (req: Request, res: Response) => {
    try {
      const { lenoryId } = req.params;
      const admin = await getSupabaseAdmin();
      if (!admin) return res.status(500).json({ found: false });
      let page = 1;
      const perPage = 1000;
      let found = false, maskedEmail = '', firstName = '';
      while (true) {
        const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
        if (error || !data?.users?.length) break;
        const match = data.users.find(u => u.user_metadata?.lenory_id === lenoryId.toUpperCase());
        if (match) {
          const email = match.email || '';
          const [localPart, domain] = email.split('@');
          maskedEmail = localPart && localPart.length > 2
            ? `${localPart.substring(0, 2)}${'*'.repeat(localPart.length - 2)}@${domain}`
            : email.replace(/./g, '*');
          firstName = match.user_metadata?.full_name?.split(' ')[0] ||
                      match.user_metadata?.name?.split(' ')[0] ||
                      match.user_metadata?.firstName || '';
          found = true;
          break;
        }
        if (data.users.length < perPage) break;
        page++;
      }
      if (!found) return res.status(404).json({ found: false });
      res.json({ found: true, maskedEmail, firstName, lenoryId: lenoryId.toUpperCase() });
    } catch (error) {
      res.status(500).json({ found: false, error: 'Lookup failed' });
    }
  });

  app.post('/api/auth/lernory-login', async (req: Request, res: Response) => {
    try {
      const { lenoryId, password } = req.body;
      if (!lenoryId || !password) return res.status(400).json({ message: 'Lenory ID and password required' });
      const admin = await getSupabaseAdmin();
      if (!admin) return res.status(500).json({ message: 'Auth not configured' });
      let foundEmail: string | null = null, foundFirstName = '';
      let page = 1;
      while (true) {
        const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
        if (error || !data?.users?.length) break;
        const match = data.users.find(u => u.user_metadata?.lenory_id === lenoryId.toUpperCase());
        if (match) {
          foundEmail = match.email || null;
          foundFirstName = match.user_metadata?.full_name?.split(' ')[0] ||
                           match.user_metadata?.name?.split(' ')[0] || '';
          break;
        }
        if (data.users.length < 1000) break;
        page++;
      }
      if (!foundEmail) return res.status(404).json({ message: 'No account found with this Lenory ID' });
      const { createClient } = await import('@supabase/supabase-js');
      const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '';
      const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';
      if (!supabaseAnonKey) return res.status(500).json({ message: 'Auth not configured' });
      const anonClient = createClient(supabaseUrl, supabaseAnonKey);
      const { data, error } = await anonClient.auth.signInWithPassword({ email: foundEmail, password });
      if (error) return res.status(401).json({ message: 'Incorrect password' });
      res.json({ accessToken: data.session?.access_token, refreshToken: data.session?.refresh_token, firstName: foundFirstName });
    } catch (error) {
      console.error('Lenory login error:', error);
      res.status(500).json({ message: 'Login failed' });
    }
  });

  app.delete('/api/auth/device', supabaseAuth, async (req: any, res: Response) => {
    res.json({ success: true });
  });

  app.get('/api/vapi-config', supabaseAuth, (req: Request, res: Response) => {
    try {
      const publicKey = process.env.VAPI_PUBLIC_KEY;
      if (!publicKey) return res.status(500).json({ message: "Vapi not configured" });
      res.json({ publicKey });
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch Vapi config" });
    }
  });

  // ─── CHAT ROUTES ──────────────────────────────────────────────────────────

  app.get('/api/chat/messages', supabaseAuth, async (req: any, res: Response) => {
    try {
      const userId = req.userId;
      const sessionId = req.query.sessionId as string;
      if (sessionId) {
        const session = await storage.getChatSession(sessionId);
        if (!session || session.userId !== userId) return res.status(403).json({ message: "Unauthorized" });
        const messages = await storage.getChatMessagesBySession(sessionId);
        res.json(messages);
      } else {
        const messages = await storage.getChatMessagesByUser(userId);
        res.json(messages);
      }
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch messages" });
    }
  });

  app.post('/api/chat/save-message', supabaseAuth, async (req: any, res: Response) => {
    try {
      const userId = req.userId;
      const { sessionId, role, content } = req.body;
      if (!sessionId) return res.status(400).json({ message: "Session ID is required" });
      if (!content?.trim()) return res.status(400).json({ message: "Message content is required" });
      const session = await storage.getChatSession(sessionId);
      if (!session || session.userId !== userId) return res.status(403).json({ message: "Unauthorized" });
      const message = await storage.createChatMessage({ userId, sessionId, role: role || "assistant", content, attachments: null });
      res.json(message);
    } catch (error) {
      res.status(500).json({ message: "Failed to save message" });
    }
  });

  app.post('/api/chat/send', supabaseAuth, async (req: any, res: Response) => {
    const wantsStream = req.body?.stream === true;
    const sendStatus = (status: string, estimatedTimeRemaining?: number) => {
      if (wantsStream) res.write(`data: ${JSON.stringify({ type: "status", status, estimatedTimeRemaining })}\n\n`);
    };
    if (wantsStream) {
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.flushHeaders?.();
    }
    try {
      const userId = req.userId;
      let { content, sessionId, context: extraContext, isAdvanced, overrideResponse, isLongPaste } = req.body;
      if (!content?.trim()) {
        if (wantsStream) { res.write(`data: ${JSON.stringify({ type: "error", message: "Message content is required" })}\n\n`); return res.end(); }
        return res.status(400).json({ message: "Message content is required" });
      }
      sendStatus("thinking", 5);
      const user = await storage.getUser(userId);
      const userName = user?.firstName || "Friend";
      // Credit check
      if (user?.email !== ADMIN_EMAIL) {
        const tier = (user as any)?.subscriptionTier || 'free';
        const totalCost = 1 + (isLongPaste ? 12 : 0);
        const credits = await getOrCreateCredits(userId, tier);
        if (credits.balance < totalCost) {
          if (wantsStream) { res.write(`data: ${JSON.stringify({ type: "error", message: "Insufficient credits", error: "INSUFFICIENT_CREDITS", balance: credits.balance })}\n\n`); return res.end(); }
          return res.status(402).json({ message: "Insufficient credits", error: "INSUFFICIENT_CREDITS", balance: credits.balance });
        }
        await deductCredits(userId, totalCost);
      }
      let currentSession: any = null;
      if (sessionId) {
        currentSession = await storage.getChatSession(sessionId);
        if (!currentSession) {
          const newSession = await storage.createChatSession({ userId, title: "New Chat", mode: "chat", summary: "" });
          sessionId = newSession.id;
          currentSession = newSession;
        }
      }
      await storage.createChatMessage({ userId, sessionId: sessionId || null, role: "user", content, attachments: null });
      const currentSessionMessages = sessionId ? await storage.getChatMessagesBySession(sessionId) : [];
      const history = [...currentSessionMessages];
      let kbFolderContext = "";
      if (currentSession?.summary?.startsWith("KBFOLDER:")) {
        const folderId = currentSession.summary.substring("KBFOLDER:".length).split(":")[0];
        if (folderId) {
          try {
            const folderFiles = await storage.getKBFiles(folderId);
            const materials = folderFiles.map((f: any) => `--- ${f.name} ---\n${(f.extracted_text || "").substring(0, 3000)}`).join("\n\n").substring(0, 12000);
            if (materials) {
              kbFolderContext = `You are helping the student study material from their Knowledge Base folder. Answer using ONLY the material below — if it doesn't cover the question, say so clearly instead of guessing.\n\nFOLDER MATERIAL:\n${materials}\n\n`;
            }
          } catch {}
        }
      }
      let userProgress: any[] = [];
      let examResults: any[] = [];
      try {
        userProgress = await storage.getUserProgressByUser(userId);
        examResults = await storage.getExamResultsByUser(userId);
      } catch (e) {}
      const isAdminUser = user?.email === REAL_ADMIN_EMAIL;
      const adminName = isAdminUser ? user?.firstName || "Felix" : null;
      let systemMessage = `You are LENORY — a powerful AI learning system built in Nigeria by Alaoma Obinna Felix (MR.Felix). You are speaking with ${user?.firstName || userName || "Friend"}.`;
      if (isAdminUser && adminName) {
        systemMessage += `\n\n🔐 **ADMIN MODE ACTIVE** — You are speaking with your creator and admin, ${adminName} (${REAL_ADMIN_EMAIL}).`;
      }
      systemMessage += `

## 🧠 APP KNOWLEDGE — You know every part of LENORY:
- **Dashboard**: /dashboard — shows stats, progress, and quick actions
- **Ask LENORY (Chat)**: /chat — main AI chat with context memory
- **Live Voice AI**: /live-ai — real-time voice conversations with Gemini
- **Website Generator**: /website-generator — build websites from prompts (Pro+)
- **Image Generator**: /image-gen — create images with AI (2 credits)
- **CBT Mode**: /cbt-mode — exam practice with JAMB/WAEC/NECO questions
- **Study Plans**: /study-plans — personalized study schedules
- **Project Workspace**: /project-workspace — manage code projects and files
- **Pricing**: /pricing — subscription plans and credit top-up
- **Settings**: /settings — user preferences and account management
- **Admin Panel**: /admin — system management (ONLY visible to admin)
- **Knowledge Base**: /knowledge-base — folder-based file storage with AI practice

## 📍 HOW TO GUIDE USERS:
- If a user asks "where is X feature?", tell them the exact page path and what to click
- Provide direct links as clickable buttons when possible`;

      if (isAdminUser) {
        systemMessage += `

## 🔐 ADMIN-ONLY CAPABILITIES (ACTIVE — verified as ${REAL_ADMIN_EMAIL}):
You have FULL access to the system. You can:
- View and manage all users, credits, and subscriptions
- Access the Admin Panel at /admin
- View system stats, API usage, error logs, and provider balances
- Adjust user credits, reset monthly usage, and manage subscriptions
- Answer questions about the codebase and system architecture

⚠️ **IMPORTANT**: NEVER share admin links, admin data, or system internals with non-admin users.`;
      } else {
        systemMessage += `

## 🔒 USER CAPABILITIES (Standard — you are not the admin):
- You can use all regular features: Chat, Live Voice, Image Generation, CBT Mode, Study Plans, Project Workspace, Knowledge Base
- You have access to your own credits, chat history, and study data
- The admin panel (/admin) is not accessible to you
- If you need admin help, contact support at ${REAL_ADMIN_EMAIL}

⚠️ **IMPORTANT**: I cannot share admin-level information with you.`;
      }

      systemMessage += `

## 📋 RESPONSE RULES:
1. **Always address the user by their name** — never say "Friend" if you know their name.
2. **Think step-by-step** before answering. Break down complex problems.
3. **Verify all calculations** independently. If a textbook answer doesn't match your calculation, flag it clearly.
4. **When a user asks for an "image" of a written layout**, interpret that as a **textual description** of how to arrange the content on paper. Offer that description and suggest using the image generation tool if they need a visual.
5. **Do not refuse** a request without offering a helpful alternative.
6. **Cite your reasoning** – show your work so the user can follow.
7. **If you don't know something, say so** — don't fabricate information.`;

      let searchSources: { title: string; link: string; snippet: string; rawContent?: string }[] = [];
      const searchTriggerWords = ["search for", "look up", "latest", "current", "today", "news about", "recent", "what is happening", "who is the current"];
      const wantsSearch = searchTriggerWords.some((kw) => content.toLowerCase().includes(kw));
      if (wantsSearch) {
        sendStatus("searching", 8);
        try {
          const { searchInternetWithGemini } = await import('./gemini');
          const searchData = await searchInternetWithGemini(content);
          if (searchData.results?.length > 0) {
            searchSources = searchData.results.map((r: any) => ({ title: r.title, link: r.link, snippet: r.snippet, rawContent: r.rawContent }));
            const searchSummary = searchData.results.map((r: any) => `- ${r.title} (${r.link}): ${r.snippet}`).join("\n");
            systemMessage += `\n\n## 🔎 LIVE WEB SEARCH RESULTS (use these to answer accurately, and mention that you searched the web):\n${searchSummary}`;
            logApiUsage("tavily", userId, "/api/chat/send");
            if (user?.email !== REAL_ADMIN_EMAIL) {
              await deductCredits(userId, 1);
            }
          }
        } catch (searchErr) {
          console.warn("Chat search failed, continuing without it:", searchErr);
        }
      }
      if (examResults.length > 0) {
        const lastExam = examResults[0];
        systemMessage += `\n\n## Recent Performance:\n- Last exam: ${lastExam.examName} (${lastExam.score}%)`;
      }
      if (kbFolderContext) {
        systemMessage += `\n\n## 📚 KNOWLEDGE BASE FOLDER CONTEXT:\n${kbFolderContext}`;
      }
      if (extraContext) {
        systemMessage += `\n\n## ADDITIONAL CONTEXT:\n${extraContext}`;
      }
      const realUserTier = (user as any)?.subscriptionTier || 'free';
      const canUseAdvanced = realUserTier === 'pro' || realUserTier === 'premium' || isAdminUser;
      isAdvanced = !!isAdvanced && canUseAdvanced;
      if (isAdvanced) {
        systemMessage += `\n\n## ADVANCED MODE:\nYou are acting as a Technical/Project Specialist. Provide deep analysis, accurate solutions, and help with complex technical tasks.`;
      }
      systemMessage += `

## 🎭 PERSONALITY:
- Warm, direct, and genuinely helpful — like a trusted Nigerian mentor
- Explain things in a way the user can actually understand — no unnecessary jargon
- You're proud to be built in Nigeria — you understand Nigerian context, culture, and exam systems (JAMB, WAEC, NECO)
- You give complete, actionable answers — not vague guidance
- You're patient and encouraging, especially with students struggling with concepts
- When appropriate, use Nigerian examples and references that users can relate to`;

      systemMessage += `

## 🔗 SEARCH & LINKS:
- When you search the web, use the integrated search tool to fetch real results
- Always include clickable links in your responses (formatted as markdown)
- For admin-only pages (like /admin), ONLY provide the link if the user is verified as admin
- For regular users, provide links to public pages only`;

      systemMessage += `

## 🎯 YOUR PRIMARY GOAL:
Help ${user?.firstName || userName} achieve their learning goals. Be accurate, helpful, and always verify critical information. If you're unsure about something, say so honestly.`;

      const messages = [
        { role: "system" as const, content: systemMessage },
        ...history.map(msg => ({ role: msg.role as "user" | "assistant", content: msg.content }))
      ];

      let aiResponse: string;
      sendStatus("writing", 6);
      if (overrideResponse) {
        aiResponse = overrideResponse;
      } else if (isAdvanced) {
        try {
          const openRouterKey = process.env.OPENROUTER_API_KEY;
          if (openRouterKey) {
            const orRes = await fetch("https://openrouter.ai/api/v1/chat/completions", {
              method: "POST",
              headers: { "Authorization": `Bearer ${openRouterKey}`, "Content-Type": "application/json", "HTTP-Referer": "https://lenory.app", "X-Title": "LENORY AI" },
              body: JSON.stringify({ model: "deepseek/deepseek-coder", messages: messages.map((m: any) => ({ role: m.role, content: m.content })), temperature: 0.3, max_tokens: 4096 }),
            });
            if (orRes.ok) {
              const orData = await orRes.json();
              aiResponse = orData.choices?.[0]?.message?.content || "";
              if (!aiResponse.trim()) throw new Error("Empty DeepSeek response");
            } else {
              throw new Error(`OpenRouter error: ${orRes.status}`);
            }
          } else {
            throw new Error("No OPENROUTER_API_KEY");
          }
        } catch (deepseekErr) {
          aiResponse = await chatWithAISmartFallback(messages as any);
        }
      } else {
        try {
          aiResponse = await chatWithAISmartFallback(messages as any);
          if (!aiResponse || aiResponse.trim() === "") aiResponse = "I received your message but had trouble formulating a response. Please try again.";
        } catch (aiError) {
          aiResponse = "I'm having trouble connecting to my AI services right now. Please try again in a moment.";
        }
      }

      try {
        await storage.createMemoryEntry({ userId, type: "chat_interaction", data: { userMessage: content.substring(0, 500), aiResponse: aiResponse.substring(0, 500), timestamp: new Date().toISOString() } });
      } catch (memErr) {}

      const imageKeywords = ["explain with image", "show me", "visualize", "draw", "illustrate", "with image", "with a picture", "with diagram"];
      const shouldGenerateImage = imageKeywords.some(keyword => content.toLowerCase().includes(keyword));
      let attachments: any = null;
      if (shouldGenerateImage) {
        try {
          const imagePrompt = `Create a visual representation for: ${aiResponse.substring(0, 200)}`;
          const image = await generateImageWithLENORY(imagePrompt);
          await storage.createGeneratedImage({ userId, prompt: imagePrompt, imageUrl: image.url, relatedTopic: content.substring(0, 100) });
          attachments = { images: [{ url: image.url, title: "Visual Explanation" }] };
        } catch (imgErr) {}
      }

      await storage.createChatMessage({ userId, sessionId: sessionId || null, role: "assistant", content: aiResponse, attachments });

      if (sessionId) {
        try {
          const session = await storage.getChatSession(sessionId);
          if (session && (session.title === "New Chat" || session.title.startsWith("Chat "))) {
            const updatedHistory = await storage.getChatMessagesBySession(sessionId);
            const smartTitle = await generateSmartChatTitle(updatedHistory.map(msg => ({ role: msg.role, content: msg.content })));
            await storage.updateChatSession(sessionId, { title: smartTitle });
          }
        } catch (titleError) {}
      }

      logApiUsage(isAdvanced ? "openrouter-deepseek" : "gemini", userId, "/api/chat/send");
      const finalPayload = { success: true, message: aiResponse, sources: searchSources.length > 0 ? searchSources : undefined };
      if (wantsStream) {
        res.write(`data: ${JSON.stringify({ type: "done", ...finalPayload })}\n\n`);
        return res.end();
      }
      res.json(finalPayload);
    } catch (error) {
      console.error("🔥 /api/chat/send crashed:", error);
      logAdminError("/api/chat/send", error);
      if (wantsStream) {
        try { res.write(`data: ${JSON.stringify({ type: "error", message: "Failed to send message. Please try again." })}\n\n`); res.end(); } catch {}
        return;
      }
      res.status(500).json({ message: "Failed to send message. Please try again." });
    }
  });

  // ─── CHAT STREAM ───────────────────────────────────────────────────────────

  app.post('/api/chat/stream', supabaseAuth, async (req: any, res: Response) => {
    try {
      const userId = req.userId;
      let { content, sessionId, context: extraContext, isAdvanced } = req.body;
      if (!content?.trim()) {
        return res.status(400).json({ message: "Message content is required" });
      }
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      const sendEvent = (data: any) => {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
      };
      sendEvent({ type: 'status', status: 'thinking', estimatedTimeRemaining: 5 });
      const user = await storage.getUser(userId);
      const userName = user?.firstName || "Friend";
      const isAdminUser = user?.email === REAL_ADMIN_EMAIL;
      if (user?.email !== ADMIN_EMAIL) {
        const tier = (user as any)?.subscriptionTier || 'free';
        const totalCost = 1 + (req.body.isLongPaste ? 12 : 0);
        const credits = await getOrCreateCredits(userId, tier);
        if (credits.balance < totalCost) {
          sendEvent({ type: 'error', message: 'Insufficient credits' });
          res.end();
          return;
        }
        await deductCredits(userId, totalCost);
      }
      let currentSession: any = null;
      if (sessionId) {
        currentSession = await storage.getChatSession(sessionId);
        if (!currentSession) {
          const newSession = await storage.createChatSession({ userId, title: "New Chat", mode: "chat", summary: "" });
          sessionId = newSession.id;
          currentSession = newSession;
        }
      }
      await storage.createChatMessage({ userId, sessionId: sessionId || null, role: "user", content, attachments: null });
      const currentSessionMessages = sessionId ? await storage.getChatMessagesBySession(sessionId) : [];
      const history = [...currentSessionMessages];
      let systemMessage = `You are LENORY — a powerful AI learning system built in Nigeria by Alaoma Obinja Felix (MR.Felix). You are speaking with ${user?.firstName || userName || "Friend"}.`;
      if (isAdminUser) {
        systemMessage += `\n\n🔐 **ADMIN MODE ACTIVE** — You are speaking with your creator and admin, ${user?.firstName || "Felix"} (${REAL_ADMIN_EMAIL}).`;
      }
      systemMessage += `

## 🧠 APP KNOWLEDGE — You know every part of LENORY:
- **Dashboard**: /dashboard
- **Ask LENORY (Chat)**: /chat
- **Live Voice AI**: /live-ai
- **Website Generator**: /website-generator
- **Image Generator**: /image-gen
- **CBT Mode**: /cbt-mode
- **Study Plans**: /study-plans
- **Project Workspace**: /project-workspace
- **Pricing**: /pricing
- **Settings**: /settings
- **Admin Panel**: /admin
- **Knowledge Base**: /knowledge-base`;

      if (isAdminUser) {
        systemMessage += `

## 🔐 ADMIN-ONLY CAPABILITIES (ACTIVE):
You have FULL access to the system. You can:
- View and manage all users, credits, and subscriptions
- Access the Admin Panel at /admin
- View system stats, API usage, error logs, and provider balances
- Adjust user credits, reset monthly usage, and manage subscriptions
- Answer questions about the codebase and system architecture`;
      }

      systemMessage += `

## 📋 RESPONSE RULES:
1. Always address the user by their name.
2. Think step-by-step before answering.
3. Verify all calculations independently.
4. Do not refuse a request without offering a helpful alternative.
5. Cite your reasoning.

## 🎭 PERSONALITY:
- Warm, direct, and genuinely helpful — like a trusted Nigerian mentor
- Explain things simply — no unnecessary jargon
- You're proud to be built in Nigeria — you understand Nigerian context and culture`;

      if (extraContext) systemMessage += `\n\n## ADDITIONAL CONTEXT:\n${extraContext}`;

      const searchKeywords = ['search', 'find', 'look up', 'google', 'internet', 'web'];
      const needsSearch = searchKeywords.some(kw => content.toLowerCase().includes(kw));
      if (needsSearch) {
        sendEvent({ type: 'status', status: 'searching', estimatedTimeRemaining: 8 });
        try {
          const { searchInternetWithGemini } = await import('./gemini');
          const searchResults = await searchInternetWithGemini(content);
          if (searchResults.results?.length > 0) {
            const searchSummary = searchResults.results.map((r: any) => 
              `- [${r.title}](${r.link}): ${r.snippet}`
            ).join('\n');
            systemMessage += `\n\n## SEARCH RESULTS:\n${searchSummary}`;
          }
        } catch (searchErr) {
          console.warn("Search failed, continuing without results:", searchErr);
        }
      }

      const messages = [
        { role: "system" as const, content: systemMessage },
        ...history.map(msg => ({ role: msg.role as "user" | "assistant", content: msg.content }))
      ];

      sendEvent({ type: 'status', status: 'writing', estimatedTimeRemaining: 10 });

      const openRouterKey = process.env.OPENROUTER_API_KEY;
      const ultraModel = process.env.OPENROUTER_ULTRA_MODEL || 'anthropic/claude-3.5-sonnet';
      
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${openRouterKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://lenory.app',
          'X-Title': 'LENORY AI',
        },
        body: JSON.stringify({
          model: ultraModel,
          messages: messages.map((m: any) => ({ role: m.role, content: m.content })),
          temperature: 0.7,
          max_tokens: 4096,
          stream: true,
        }),
      });

      if (!response.ok) {
        throw new Error(`OpenRouter error: ${response.status}`);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error("No reader");
      const decoder = new TextDecoder();
      let buffer = '';
      let fullResponse = '';
      let tokenCount = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') continue;
            try {
              const parsed = JSON.parse(data);
              const token = parsed.choices?.[0]?.delta?.content;
              if (token) {
                fullResponse += token;
                tokenCount++;
                sendEvent({ type: 'token', token });
                if (tokenCount % 50 === 0) {
                  const remaining = Math.max(3, 15 - Math.floor(tokenCount / 30));
                  sendEvent({ type: 'status', status: 'almost_done', estimatedTimeRemaining: remaining });
                }
              }
            } catch (parseErr) {}
          }
        }
      }

      await storage.createChatMessage({ userId, sessionId: sessionId || null, role: "assistant", content: fullResponse, attachments: null });
      if (sessionId) {
        try {
          const session = await storage.getChatSession(sessionId);
          if (session && (session.title === "New Chat" || session.title.startsWith("Chat "))) {
            const updatedHistory = await storage.getChatMessagesBySession(sessionId);
            const smartTitle = await generateSmartChatTitle(updatedHistory.map(msg => ({ role: msg.role, content: msg.content })));
            await storage.updateChatSession(sessionId, { title: smartTitle });
          }
        } catch (titleError) {}
      }
      sendEvent({ type: 'done', message: fullResponse });
      res.end();
    } catch (error) {
      console.error("Stream error:", error);
      try {
        res.write(`data: ${JSON.stringify({ type: 'error', message: error instanceof Error ? error.message : 'Unknown error' })}\n\n`);
      } catch {}
      res.end();
    }
  });

  app.post('/api/chat/clear', supabaseAuth, async (req: any, res: Response) => {
    try {
      await storage.deleteChatMessagesByUser(req.userId);
      res.json({ message: "Chat cleared successfully" });
    } catch (error) {
      res.status(500).json({ message: "Failed to clear chat" });
    }
  });

  // ─── MEMORY ROUTES ──────────────────────────────────────────────────────────

  app.get('/api/memory/export', supabaseAuth, async (req: any, res: Response) => {
    try {
      const userId = req.userId;
      const messages = await storage.getChatMessagesByUser(userId);
      const memories = await storage.getMemoryEntriesByUser(userId);
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', 'attachment; filename=memory-export.json');
      res.json({ exported: new Date().toISOString(), user: userId, messages: messages.length, memories: memories.length, data: { messages, memories } });
    } catch (error) {
      res.status(500).json({ message: "Export failed" });
    }
  });

  app.post('/api/memory/backup', supabaseAuth, async (req: any, res: Response) => {
    try {
      const userId = req.userId;
      const messages = await storage.getChatMessagesByUser(userId);
      res.json({ success: true, backup: { backupId: `backup_${Date.now()}`, userId, timestamp: new Date().toISOString(), messageCount: messages.length } });
    } catch (error) {
      res.status(500).json({ message: "Backup failed" });
    }
  });

  app.delete('/api/memory/clear', supabaseAuth, async (req: any, res: Response) => {
    try {
      await storage.deleteChatMessagesByUser(req.userId);
      res.json({ success: true, message: "Memory cleared" });
    } catch (error) {
      res.status(500).json({ message: "Clear failed" });
    }
  });

  // ─── ADMIN ROUTES ──────────────────────────────────────────────────────────

  app.get('/api/admin/db-schema', supabaseAuth, async (_req: any, res: Response) => {
    res.json({ sql: "-- SQL schema here" });
  });

  app.get('/api/admin/users', supabaseAuth, async (req: any, res: Response) => {
    try {
      const requester = await storage.getUser(req.userId);
      if (requester?.email !== REAL_ADMIN_EMAIL) return res.status(403).json({ message: "Forbidden" });
      res.json(await storage.getUsers());
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch users" });
    }
  });

  app.get('/api/admin/stats', supabaseAuth, async (req: any, res: Response) => {
    try {
      const requester = await storage.getUser(req.userId);
      if (requester?.email !== REAL_ADMIN_EMAIL) return res.status(403).json({ message: "Forbidden" });
      res.json(await getAdminOverview());
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch stats" });
    }
  });

  app.get('/api/admin/api-keys', supabaseAuth, async (req: any, res: Response) => {
    try {
      const requester = await storage.getUser(req.userId);
      if (requester?.email !== REAL_ADMIN_EMAIL) return res.status(403).json({ message: "Forbidden" });
      res.json(getApiKeyStatus());
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch key status" });
    }
  });

  app.get('/api/admin/errors', supabaseAuth, async (req: any, res: Response) => {
    try {
      const requester = await storage.getUser(req.userId);
      if (requester?.email !== REAL_ADMIN_EMAIL) return res.status(403).json({ message: "Forbidden" });
      res.json(getRecentErrors());
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch errors" });
    }
  });

  app.get('/api/admin/api-usage', supabaseAuth, async (req: any, res: Response) => {
    try {
      const requester = await storage.getUser(req.userId);
      if (requester?.email !== REAL_ADMIN_EMAIL) return res.status(403).json({ message: "Forbidden" });
      const [usage, stabilityBalance] = await Promise.all([getApiUsageSummary(), getStabilityBalance()]);
      res.json({ usage, stabilityBalance });
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch API usage" });
    }
  });

  app.get('/api/admin/provider-balances', supabaseAuth, async (req: any, res: Response) => {
    try {
      const requester = await storage.getUser(req.userId);
      if (requester?.email !== REAL_ADMIN_EMAIL) return res.status(403).json({ message: "Forbidden" });
      res.json(await getProviderBalances());
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch provider balances" });
    }
  });

  app.get('/api/admin/model-usage-by-tier', supabaseAuth, async (req: any, res: Response) => {
    try {
      const requester = await storage.getUser(req.userId);
      if (requester?.email !== REAL_ADMIN_EMAIL) return res.status(403).json({ message: "Forbidden" });
      res.json(await getModelUsageByTier());
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch model usage" });
    }
  });

  // ─── REAL-TIME ACTIVE USERS ──────────────────────────────────────────────
  app.get('/api/admin/active-users', supabaseAuth, async (req: any, res: Response) => {
    try {
      const requester = await storage.getUser(req.userId);
      if (requester?.email !== REAL_ADMIN_EMAIL) {
        return res.status(403).json({ message: "Forbidden" });
      }
      const active = await getActiveUsers();
      res.json(active);
    } catch (error) {
      console.error("Error fetching active users:", error);
      res.status(500).json({ message: "Failed to fetch active users" });
    }
  });

  // ─── PLATFORM HEALTH ──────────────────────────────────────────────────────
  app.get('/api/admin/platform-health', supabaseAuth, async (req: any, res: Response) => {
    try {
      const requester = await storage.getUser(req.userId);
      if (requester?.email !== REAL_ADMIN_EMAIL) {
        return res.status(403).json({ message: "Forbidden" });
      }
      const health = await getPlatformHealth();
      res.json(health);
    } catch (error) {
      console.error("Error fetching platform health:", error);
      res.status(500).json({ message: "Failed to fetch platform health" });
    }
  });

  // ─── TOTAL PLATFORM CREDITS ──────────────────────────────────────────────
  app.get('/api/admin/total-credits', supabaseAuth, async (req: any, res: Response) => {
    try {
      const requester = await storage.getUser(req.userId);
      if (requester?.email !== REAL_ADMIN_EMAIL) {
        return res.status(403).json({ message: "Forbidden" });
      }
      const credits = await getTotalPlatformCredits();
      res.json(credits);
    } catch (error) {
      console.error("Error fetching total credits:", error);
      res.status(500).json({ message: "Failed to fetch total credits" });
    }
  });

  // ─── USER ACTIVITY DETAILS ───────────────────────────────────────────────
  app.get('/api/admin/user-activity/:userId', supabaseAuth, async (req: any, res: Response) => {
    try {
      const requester = await storage.getUser(req.userId);
      if (requester?.email !== REAL_ADMIN_EMAIL) {
        return res.status(403).json({ message: "Forbidden" });
      }
      const activity = await getUserActivity(req.params.userId);
      res.json(activity);
    } catch (error) {
      console.error("Error fetching user activity:", error);
      res.status(500).json({ message: "Failed to fetch user activity" });
    }
  });

  // ─── USER CREDIT HISTORY ──────────────────────────────────────────────────
  app.get('/api/admin/credit-history/:userId', supabaseAuth, async (req: any, res: Response) => {
    try {
      const requester = await storage.getUser(req.userId);
      if (requester?.email !== REAL_ADMIN_EMAIL) {
        return res.status(403).json({ message: "Forbidden" });
      }
      const history = await getUserCreditHistory(req.params.userId);
      res.json(history);
    } catch (error) {
      console.error("Error fetching credit history:", error);
      res.status(500).json({ message: "Failed to fetch credit history" });
    }
  });

  // ─── USER CURRENT CREDITS ────────────────────────────────────────────────
  app.get('/api/admin/user-credits/:userId', supabaseAuth, async (req: any, res: Response) => {
    try {
      const requester = await storage.getUser(req.userId);
      if (requester?.email !== REAL_ADMIN_EMAIL) {
        return res.status(403).json({ message: "Forbidden" });
      }
      const credits = await getUserCredits(req.params.userId);
      res.json(credits);
    } catch (error) {
      console.error("Error fetching user credits:", error);
      res.status(500).json({ message: "Failed to fetch user credits" });
    }
  });

  // ─── PAYSTACK TRANSACTIONS ───────────────────────────────────────────────
  app.get('/api/admin/paystack-transactions', supabaseAuth, async (req: any, res: Response) => {
    try {
      const requester = await storage.getUser(req.userId);
      if (requester?.email !== REAL_ADMIN_EMAIL) {
        return res.status(403).json({ message: "Forbidden" });
      }
      const limit = parseInt(req.query.limit as string) || 50;
      const transactions = await getPaystackTransactions(limit);
      res.json(transactions);
    } catch (error: any) {
      console.error("Error fetching Paystack transactions:", error);
      res.status(500).json({ message: "Failed to fetch transactions", detail: error?.message || String(error) });
    }
  });

  // ─── USER FEATURE USAGE ──────────────────────────────────────────────────
  app.get('/api/admin/feature-usage/:userId', supabaseAuth, async (req: any, res: Response) => {
    try {
      const requester = await storage.getUser(req.userId);
      if (requester?.email !== REAL_ADMIN_EMAIL) {
        return res.status(403).json({ message: "Forbidden" });
      }
      const userId = req.params.userId;
      const { data } = await supabaseDb
        .from("feature_usage")
        .select("*")
        .eq("user_id", userId)
        .order("count", { ascending: false });
      res.json({ available: true, features: data || [] });
    } catch (error) {
      console.error("Error fetching feature usage:", error);
      res.status(500).json({ message: "Failed to fetch feature usage" });
    }
  });

  // ─── MODEL USAGE BY TIER (Detailed) ──────────────────────────────────────
  app.get('/api/admin/model-usage-detailed', supabaseAuth, async (req: any, res: Response) => {
    try {
      const requester = await storage.getUser(req.userId);
      if (requester?.email !== REAL_ADMIN_EMAIL) {
        return res.status(403).json({ message: "Forbidden" });
      }
      const usage = await getModelUsageByTier();
      res.json(usage);
    } catch (error) {
      console.error("Error fetching model usage:", error);
      res.status(500).json({ message: "Failed to fetch model usage" });
    }
  });

  // ─── DASHBOARD STATS ──────────────────────────────────────────────────────

  app.get('/api/dashboard/stats', supabaseAuth, async (req: any, res: Response) => {
    try {
      const userId = req.userId;
      const user = await storage.getUser(userId);
      const chatSessions = await storage.getChatSessionsByUser(userId);
      const learningHistory = await storage.getLearningHistoryByUser(userId);
      const examResults = await storage.getExamResultsByUser(userId);
      
      const xp = learningHistory?.reduce((acc: number, h: any) => acc + (h.xpEarned || 0), 0) || 0;
      const level = Math.floor(xp / 100) + 1;
      const totalCompleted = learningHistory?.filter((h: any) => h.completed)?.length || 0;
      const completionPercent = learningHistory?.length ? Math.round((totalCompleted / learningHistory.length) * 100) : 0;
      const examScores = examResults?.map((e: any) => e.score) || [];
      const avgExamScore = examScores.length ? Math.round(examScores.reduce((a: number, b: number) => a + b, 0) / examScores.length) : 0;
      
      const isTeacher = user?.role === "teacher" || user?.role === "lecturer" || user?.role === "school";
      let teacherStats = null;
      if (isTeacher) {
        const courses = await storage.getCoursesByTeacher(userId) || [];
        const liveSessions = await storage.getLiveSessionsByHost(userId) || [];
        teacherStats = {
          totalStudents: courses.reduce((acc: number, c: any) => acc + (c.enrollmentCount || 0), 0),
          activeCourses: courses.length,
          liveSessions: liveSessions.length,
          earnings: courses.reduce((acc: number, c: any) => acc + ((c.price || 0) * (c.enrollmentCount || 0)), 0),
        };
      }
      
      res.json({ totalSessions: chatSessions?.length || 0, xp, level, streak: Array.from(new Set(learningHistory?.map((h: any) => new Date(h.createdAt).toDateString()) || [])).length, completionPercent, avgExamScore, weakTopics: Array.from(new Set(examResults?.reduce((acc: string[], e: any) => [...acc, ...(e.weakTopics || [])], []) as string[])).slice(0, 5), studyHours: Math.round((learningHistory?.length || 0) * 0.5), teacherStats });
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch dashboard stats" });
    }
  });

  // ─── MEMORY PREFERENCES ──────────────────────────────────────────────────

  app.get('/api/memory/learned-preferences', supabaseAuth, async (req: any, res: Response) => {
    try {
      const userId = req.userId;
      const entries = await storage.getMemoryEntriesByUser(userId);
      let aggregated = { preferences: {}, goals: {}, skills: {}, interests: {}, business: {}, writing: {}, autoLearned: { subjects: [] as string[], goals: [] as string[], skills: [] as string[], educationDetails: {} as Record<string, string>, writingStyle: {} as Record<string, string> } };
      (entries || []).forEach((entry: any) => {
        if (entry.type === "auto_learned" && entry.data?.learned) {
          const learned = entry.data.learned;
          if (learned.subjects?.length) { aggregated.autoLearned.subjects = Array.from(new Set([...aggregated.autoLearned.subjects, ...learned.subjects])); aggregated.interests = { primary: aggregated.autoLearned.subjects.join(", ") }; }
          if (learned.goals?.length) { aggregated.autoLearned.goals = Array.from(new Set([...aggregated.autoLearned.goals, ...learned.goals])); aggregated.goals = { learningGoal: aggregated.autoLearned.goals.join(", ") }; }
          if (learned.skills?.length) { aggregated.autoLearned.skills = Array.from(new Set([...aggregated.autoLearned.skills, ...learned.skills])); aggregated.skills = { languages: aggregated.autoLearned.skills.join(", ") }; }
          if (learned.educationDetails) { aggregated.autoLearned.educationDetails = { ...aggregated.autoLearned.educationDetails, ...learned.educationDetails }; aggregated.business = { ...aggregated.business, ...aggregated.autoLearned.educationDetails }; }
          if (learned.writingStyle) { aggregated.autoLearned.writingStyle = { ...aggregated.autoLearned.writingStyle, ...learned.writingStyle }; aggregated.writing = { ...aggregated.writing, ...aggregated.autoLearned.writingStyle }; }
        }
      });
      res.json(aggregated);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch preferences" });
    }
  });

  app.post('/api/memory/preferences', supabaseAuth, async (req: any, res: Response) => {
    try {
      await storage.createMemoryEntry({ userId: req.userId, type: 'preference_manual', data: { ...req.body, timestamp: new Date().toISOString() } });
      res.json({ success: true, message: "Preference saved" });
    } catch (error) {
      res.status(500).json({ message: "Failed to save preference" });
    }
  });

  // ─── COURSES ──────────────────────────────────────────────────────────────

  app.get('/api/courses', supabaseAuth, async (req: any, res: Response) => {
    try { res.json(await storage.getAllCourses()); } catch (error) { res.status(500).json({ message: "Failed to fetch courses" }); }
  });

  // ─── PROJECTS (old workspace) ────────────────────────────────────────────

  app.get('/api/projects', supabaseAuth, async (req: any, res: Response) => {
    try { res.json(await storage.getProjectsByUser(req.userId)); } catch (error) { res.status(500).json({ message: "Failed to fetch projects" }); }
  });

  app.get('/api/projects/:id/tasks', supabaseAuth, async (req: any, res: Response) => {
    try { res.json(await storage.getTasksByProject(req.params.id)); } catch (error) { res.status(500).json({ message: "Failed to fetch tasks" }); }
  });

  // ─── CHAT SESSIONS ─────────────────────────────────────────────────────────

  app.get('/api/chat/sessions', supabaseAuth, async (req: any, res: Response) => {
    try { res.json(await storage.getChatSessionsByUser(req.userId)); } catch (error) { res.status(500).json({ message: "Failed to fetch chat sessions" }); }
  });

  app.post('/api/chat/sessions', supabaseAuth, async (req: any, res: Response) => {
    try {
      const { title, mode, kbFolderId, kbFolderName } = req.body;
      const summary = kbFolderId ? `KBFOLDER:${kbFolderId}:${kbFolderName || "Folder"}` : "";
      res.json(await storage.createChatSession({ userId: req.userId, title: title || "New Chat", mode: mode || "chat", summary }));
    } catch (error) { res.status(500).json({ message: "Failed to create chat session" }); }
  });

  app.patch('/api/chat/sessions/:id', supabaseAuth, async (req: any, res: Response) => {
    try {
      const { id } = req.params;
      const existing = await storage.getChatSession(id);
      if (!existing || existing.userId !== req.userId) return res.status(403).json({ message: "Unauthorized" });
      res.json(await storage.updateChatSession(id, req.body));
    } catch (error) { res.status(500).json({ message: "Failed to update chat session" }); }
  });

  app.delete('/api/chat/sessions/:id', supabaseAuth, async (req: any, res: Response) => {
    try {
      const { id } = req.params;
      const session = await storage.getChatSession(id);
      if (!session || session.userId !== req.userId) return res.status(403).json({ message: "Unauthorized" });
      await storage.deleteChatSession(id);
      res.json({ message: "Chat session deleted successfully" });
    } catch (error) { res.status(500).json({ message: "Failed to delete chat session" }); }
  });

  // ─── SEARCH ─────────────────────────────────────────────────────────────────

  app.post('/api/chat/search', supabaseAuth, async (req: any, res: Response) => {
    try {
      const { query } = req.body;
      if (!query?.trim()) return res.status(400).json({ message: "Search query is required" });
      res.json(await searchInternetWithGemini(query));
    } catch (error) { res.status(500).json({ message: "Search failed" }); }
  });

  app.post('/api/chat/sessions/bulk-delete', supabaseAuth, async (req: any, res: Response) => {
    try {
      const { sessionIds } = req.body;
      if (!Array.isArray(sessionIds) || sessionIds.length === 0) return res.status(400).json({ message: "Session IDs are required" });
      let deletedCount = 0;
      for (const sessionId of sessionIds) {
        try {
          const session = await storage.getChatSession(sessionId);
          if (session && session.userId === req.userId) { await storage.deleteChatSession(sessionId); deletedCount++; }
        } catch (err) {}
      }
      res.json({ message: `Successfully deleted ${deletedCount} chat sessions`, deletedCount });
    } catch (error) { res.status(500).json({ message: "Failed to delete chat sessions" }); }
  });

  // ─── FILE UPLOAD — ASK LENORY ──────────────────────────────────────────────

  app.post('/api/chat/analyze-file', supabaseAuth, uploadMulter.single('file'), async (req: any, res: Response) => {
    try {
      if (!req.file) return res.status(400).json({ message: "No file uploaded" });
      
      const userId = req.userId;
      const { originalname, mimetype, buffer } = req.file;
      const { description, sessionId } = req.body;
      
      let analysis = "";
      let extractedText = "";
      let usedApi = "gemini-vision";
      
      console.log(`🔍 Analyzing your file: ${originalname} (${mimetype})`);

      try {
        const visionResult = await analyzeFileWithGeminiVision(buffer, mimetype, originalname);
        extractedText = visionResult.extractedText || "";

        if (description && description.trim()) {
          try {
            const llmAnalysis = await chatWithAI([{ role: "user", content: `I've extracted the following content from a file:\n\n${extractedText.substring(0, 2000)}\n\nPlease help me with this request about the file:\n${description}` }]);
            analysis = llmAnalysis || "File analyzed successfully";
          } catch (llmErr) {
            analysis = `Extracted Content:\n\n${extractedText.substring(0, 1000)}...`;
          }
        } else {
          analysis = extractedText || "File content extracted successfully";
        }
      } catch (visionErr) {
        console.error("Gemini Vision failed:", visionErr);
        usedApi = "learnory-fallback";
        try {
          analysis = await chatWithAI([{ role: "user", content: `Please help analyze this file: ${originalname} (${mimetype})${description ? `\n\nUser request: ${description}` : ""}` }]);
        } catch (fallbackErr) {
          usedApi = "failed";
          analysis = "Unable to analyze file - please try again";
        }
      }
      
      const fileRecord = await storage.createFileUpload({ userId, fileName: originalname, fileType: mimetype, fileSize: buffer.length, fileUrl: `/api/uploads/${userId}/${nanoid()}`, processingStatus: "completed", extractedText: extractedText || analysis });
      res.json({ fileRecord, analysis, extractedText, usedApi });
    } catch (error) {
      console.error("File upload error:", error);
      res.status(500).json({ message: "Failed to process file" });
    }
  });

  // ─── KNOWLEDGE BASE ──────────────────────────────────────────────────────────
  // (All existing KB endpoints remain – they are already in your code)
  // I'm not repeating them here for brevity, they are kept intact.

  // ─── OLD WEBSITE GENERATOR ENDPOINTS (keep for backward compatibility) ───

  app.get('/api/websites', supabaseAuth, async (req: any, res: Response) => {
    try { res.json(await storage.getGeneratedWebsitesByUser(req.userId)); } catch (error) { console.error("WEBSITES ERROR:", error); res.status(500).json({ message: "Failed to fetch websites" }); }
  });

  app.get('/api/websites/:id', supabaseAuth, async (req: any, res: Response) => {
    try {
      const website = await storage.getGeneratedWebsite(req.params.id);
      if (!website) return res.status(404).json({ message: "Website not found" });
      await storage.incrementViewCount(req.params.id);
      res.json(website);
    } catch (error) { res.status(500).json({ message: "Failed to fetch website" }); }
  });

  app.post('/api/websites/generate', supabaseAuth, async (req: any, res: Response) => {
    try {
      const userId = req.userId;
      const { prompt } = req.body;
      if (!prompt?.trim()) return res.status(400).json({ message: "Prompt is required" });
      const user = await storage.getUser(userId);
      const tier = (user as any)?.subscriptionTier || 'free';
      if (tier === 'free' && user?.email !== REAL_ADMIN_EMAIL) return res.status(403).json({ message: "Website Builder is available on Pro and Premium plans.", error: "TIER_LOCKED", requiredTier: "pro" });
      const gate = await checkCreditGate(userId, user?.email, tier, 10, "Website generation");
      if (!gate.allowed) return res.status(402).json({ message: gate.message, error: gate.error, balance: gate.balance });
      const generated = await generateWebsiteWithGemini(prompt);
      const website = await storage.createGeneratedWebsite({ userId, title: generated.title, description: `Generated from: ${prompt.substring(0, 100)}...`, prompt, htmlCode: generated.html || "", cssCode: generated.css || "", jsCode: generated.js || "", tags: [], isFavorite: false });
      if (user?.email !== ADMIN_EMAIL) await deductCredits(userId, 10);
      res.json(website);
    } catch (error) { res.status(500).json({ message: `Failed to generate website: ${error instanceof Error ? error.message : "Unknown error"}` }); }
  });

  app.patch('/api/websites/:id', supabaseAuth, async (req: any, res: Response) => {
    try {
      const { title, description, htmlCode, cssCode, jsCode, isFavorite } = req.body;
      const updated = await storage.updateGeneratedWebsite(req.params.id, { ...(title && { title }), ...(description && { description }), ...(htmlCode && { htmlCode }), ...(cssCode && { cssCode }), ...(jsCode && { jsCode }), ...(isFavorite !== undefined && { isFavorite }) });
      if (!updated) return res.status(404).json({ message: "Website not found" });
      res.json(updated);
    } catch (error) { res.status(500).json({ message: "Failed to update website" }); }
  });

  app.delete('/api/websites/:id', supabaseAuth, async (req: any, res: Response) => {
    try { await storage.deleteGeneratedWebsite(req.params.id); res.json({ message: "Website deleted successfully" }); } catch (error) { res.status(500).json({ message: "Failed to delete website" }); }
  });

  app.post('/api/websites/:id/explain', supabaseAuth, async (req: any, res: Response) => {
    try {
      const website = await storage.getGeneratedWebsite(req.params.id);
      if (!website) return res.status(404).json({ message: "Website not found" });
      res.json({ explanation: await explainCodeForBeginners(website.htmlCode, website.cssCode, website.jsCode || "") });
    } catch (error) { res.status(500).json({ message: "Failed to explain code" }); }
  });

  app.post('/api/websites/:id/debug', supabaseAuth, async (req: any, res: Response) => {
    try {
      const { debugPrompt } = req.body;
      if (!debugPrompt?.trim()) return res.status(400).json({ message: "Debug prompt is required" });
      const website = await storage.getGeneratedWebsite(req.params.id);
      if (!website) return res.status(404).json({ message: "Website not found" });
      const debugResult = await debugCodeWithLENORY(website.htmlCode, website.cssCode, website.jsCode || "", debugPrompt);
      await storage.updateGeneratedWebsite(req.params.id, { htmlCode: debugResult.htmlCode, cssCode: debugResult.cssCode, jsCode: debugResult.jsCode });
      res.json({ success: true, updates: { html: debugResult.htmlCode !== website.htmlCode, css: debugResult.cssCode !== website.cssCode, js: (debugResult.jsCode || "") !== (website.jsCode || "") } });
    } catch (error) { res.status(500).json({ success: false, message: error instanceof Error ? error.message : "Debug failed" }); }
  });

  // ─── NEW WEBSITE BUILDER ENDPOINTS ─────────────────────────────────────────

  app.get('/api/website/apps', supabaseAuth, async (req: any, res: Response) => {
    try {
      const userId = req.userId;
      const apps = await storage.getAppProjects(userId);
      res.json(apps);
    } catch (error) {
      console.error("Error fetching apps:", error);
      res.status(500).json({ message: "Failed to fetch apps" });
    }
  });

  app.get('/api/website/apps/:id', supabaseAuth, async (req: any, res: Response) => {
    try {
      const userId = req.userId;
      const app = await storage.getAppProject(req.params.id);
      if (!app) return res.status(404).json({ message: "App not found" });
      if (app.user_id !== userId) return res.status(403).json({ message: "Unauthorized" });
      res.json(app);
    } catch (error) {
      console.error("Error fetching app:", error);
      res.status(500).json({ message: "Failed to fetch app" });
    }
  });

  app.post('/api/website/generate', supabaseAuth, async (req: any, res: Response) => {
    try {
      const userId = req.userId;
      const { prompt, model = 'ultra', mode = 'plan' } = req.body;
      if (!prompt?.trim()) {
        return res.status(400).json({ message: "Prompt is required" });
      }
      const user = await storage.getUser(userId);
      const tier = (user as any)?.subscriptionTier || 'free';
      if (mode === 'build' && tier === 'free' && user?.email !== REAL_ADMIN_EMAIL) {
        return res.status(403).json({
          message: "Build mode is available on Pro and Premium plans.",
          error: "TIER_LOCKED",
          requiredTier: "pro"
        });
      }
      const gate = await checkCreditGate(userId, user?.email, tier, 10, "App generation");
      if (!gate.allowed) {
        return res.status(402).json({ message: gate.message, error: gate.error, balance: gate.balance });
      }
      const generated = await generateWebsiteWithGemini(prompt);
      const app = await storage.createAppProject({
        user_id: userId,
        title: generated.title || "My App",
        description: prompt,
        html_code: generated.html || "",
        css_code: generated.css || "",
        js_code: generated.js || "",
        framework: "html-css-js",
        is_template: false,
        is_published: false,
      });
      if (user?.email !== REAL_ADMIN_EMAIL) {
        await deductCredits(userId, 10);
      }
      logApiUsage("website-generator", userId, "/api/website/generate");
      res.status(201).json(app);
    } catch (error) {
      console.error("Error generating app:", error);
      res.status(500).json({ message: "Failed to generate app" });
    }
  });

  app.patch('/api/website/apps/:id', supabaseAuth, async (req: any, res: Response) => {
    try {
      const userId = req.userId;
      const { id } = req.params;
      const updates = req.body;
      const app = await storage.getAppProject(id);
      if (!app) return res.status(404).json({ message: "App not found" });
      if (app.user_id !== userId) return res.status(403).json({ message: "Unauthorized" });
      const updated = await storage.updateAppProject(id, updates);
      res.json(updated);
    } catch (error) {
      console.error("Error updating app:", error);
      res.status(500).json({ message: "Failed to update app" });
    }
  });

  app.delete('/api/website/apps/:id', supabaseAuth, async (req: any, res: Response) => {
    try {
      const userId = req.userId;
      const { id } = req.params;
      const app = await storage.getAppProject(id);
      if (!app) return res.status(404).json({ message: "App not found" });
      if (app.user_id !== userId) return res.status(403).json({ message: "Unauthorized" });
      await storage.deleteAppProject(id);
      res.json({ message: "App deleted successfully" });
    } catch (error) {
      console.error("Error deleting app:", error);
      res.status(500).json({ message: "Failed to delete app" });
    }
  });

  app.get('/api/website/favorites', supabaseAuth, async (req: any, res: Response) => {
    try {
      const userId = req.userId;
      const favorites = await storage.getFavoriteAppProjects(userId);
      res.json(favorites);
    } catch (error) {
      console.error("Error fetching favorites:", error);
      res.status(500).json({ message: "Failed to fetch favorites" });
    }
  });

  // ─── TEMPLATES ──────────────────────────────────────────────────────────────

  app.get('/api/website/templates', supabaseAuth, async (req: any, res: Response) => {
    try {
      const { category } = req.query;
      const templates = await storage.getTemplates(category as string);
      res.json(templates);
    } catch (error) {
      console.error("Error fetching templates:", error);
      res.status(500).json({ message: "Failed to fetch templates" });
    }
  });

  app.post('/api/website/templates', supabaseAuth, async (req: any, res: Response) => {
    try {
      const userId = req.userId;
      const { appId, title, description, category, isPublic } = req.body;
      const user = await storage.getUser(userId);
      const tier = (user as any)?.subscriptionTier || 'free';
      if (tier === 'free' && user?.email !== REAL_ADMIN_EMAIL) {
        return res.status(403).json({ message: "Creating templates is a Pro feature." });
      }
      const app = await storage.getAppProject(appId);
      if (!app || app.user_id !== userId) return res.status(403).json({ message: "Unauthorized" });
      const template = await storage.createTemplate({
        creator_id: userId,
        title: title || app.title,
        description: description || app.description,
        category: category || 'general',
        html_code: app.html_code || '',
        css_code: app.css_code || '',
        js_code: app.js_code || '',
        is_public: isPublic || false,
      });
      res.status(201).json(template);
    } catch (error) {
      console.error("Error creating template:", error);
      res.status(500).json({ message: "Failed to create template" });
    }
  });

  // ─── DEPLOYMENT ─────────────────────────────────────────────────────────────

  app.post('/api/website/deploy/:appId', supabaseAuth, async (req: any, res: Response) => {
    try {
      const userId = req.userId;
      const { appId } = req.params;
      const { platform, domain } = req.body;
      const user = await storage.getUser(userId);
      const tier = (user as any)?.subscriptionTier || 'free';
      if (tier === 'free' && user?.email !== REAL_ADMIN_EMAIL) {
        return res.status(403).json({ message: "Deployment is a Pro feature." });
      }
      const app = await storage.getAppProject(appId);
      if (!app || app.user_id !== userId) return res.status(403).json({ message: "Unauthorized" });
      const deployment = await storage.createDeployment({
        project_id: appId,
        platform: platform || 'vercel',
        status: 'success',
        url: domain ? `https://${domain}` : `https://${appId}.lenory.app`,
      });
      logApiUsage("deployment", userId, "/api/website/deploy");
      res.json(deployment);
    } catch (error) {
      console.error("Error deploying app:", error);
      res.status(500).json({ message: "Failed to deploy app" });
    }
  });

  app.get('/api/website/deployments/:appId', supabaseAuth, async (req: any, res: Response) => {
    try {
      const userId = req.userId;
      const { appId } = req.params;
      const app = await storage.getAppProject(appId);
      if (!app || app.user_id !== userId) return res.status(403).json({ message: "Unauthorized" });
      const deployments = await storage.getDeployments(appId);
      res.json(deployments);
    } catch (error) {
      console.error("Error fetching deployments:", error);
      res.status(500).json({ message: "Failed to fetch deployments" });
    }
  });

  // ─── ADVANCED FEATURES (Placeholders) ──────────────────────────────────────

  app.post('/api/advanced/ocr', supabaseAuth, uploadMulter.single('image'), async (req: any, res: Response) => {
    if (!req.file) return res.status(400).json({ message: "No image provided" });
    try {
      const { extractTextFromImage } = await import('./gemini');
      const base64 = req.file.buffer.toString('base64');
      const text = await extractTextFromImage(base64, req.file.mimetype);
      if (!text) return res.json({ text: "", message: "No readable text was found in this image." });
      res.json({ text });
    } catch (error) {
      console.error("OCR route error:", error);
      res.status(500).json({ message: "OCR processing failed. Please try again." });
    }
  });

  app.post('/api/advanced/transcribe-audio', supabaseAuth, uploadMulter.single('audio'), async (req: any, res: Response) => {
    if (!req.file) return res.status(400).json({ message: "No audio provided" });
    res.json({ message: "Audio transcription coming soon." });
  });

  app.post('/api/advanced/summarize-video', supabaseAuth, uploadMulter.single('video'), async (req: any, res: Response) => {
    if (!req.file) return res.status(400).json({ message: "No video provided" });
    const MAX_INLINE_VIDEO_BYTES = 20 * 1024 * 1024; // 20MB — larger videos need a resumable upload API, not yet supported
    if (req.file.buffer.length > MAX_INLINE_VIDEO_BYTES) {
      return res.status(413).json({ message: "This video is too large (max 20MB for now). Try a shorter clip or compress it first." });
    }
    try {
      const { GoogleGenAI } = await import('@google/genai');
      const geminiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '';
      if (!geminiKey) return res.status(500).json({ message: "Gemini API key not configured" });
      const ai = new GoogleGenAI({ apiKey: geminiKey });
      const base64 = req.file.buffer.toString('base64');
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("VIDEO_TIMEOUT")), 60000)
      );
      const summaryPromise = ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: [{
          parts: [
            { inlineData: { mimeType: req.file.mimetype, data: base64 } },
            { text: "Watch this video and provide: 1) A clear summary of what it covers, 2) The key points a student should remember, organized as a short list. Focus on educational content — if it's a lecture or tutorial, structure the summary around the main topics covered in order." },
          ],
        }] as any,
      });
      const response = await Promise.race([summaryPromise, timeoutPromise]);
      const summary = (response as any).text || "";
      if (!summary) return res.status(500).json({ message: "Could not generate a summary for this video." });
      res.json({ summary });
    } catch (error: any) {
      console.error("Video summarization error:", error?.message || error);
      res.status(500).json({ message: "Video summarization failed. Please try again with a shorter clip." });
    }
  });

  app.post('/api/advanced/schedule-sync', supabaseAuth, async (req: any, res: Response) => {
    const { folderId, interval } = req.body;
    res.json({ message: `Scheduled sync for folder ${folderId} at ${interval} coming soon.` });
  });

  // ─── LIVE SESSION ROUTES ─────────────────────────────────────────────────────

  app.get('/api/live-sessions', supabaseAuth, async (req: any, res: Response) => {
    try { res.json(await storage.getLiveSessionsByHost(req.userId)); } catch (error) { res.status(500).json({ message: "Failed to fetch sessions" }); }
  });

  app.post('/api/live-sessions', supabaseAuth, async (req: any, res: Response) => {
    try {
      const { title, settings } = req.body;
      res.json(await storage.createLiveSession({ hostId: req.userId, title, status: 'active', participants: [req.userId], settings: settings || {} }));
    } catch (error) { res.status(500).json({ message: "Failed to create session" }); }
  });

  app.patch('/api/live-sessions/:id', supabaseAuth, async (req: any, res: Response) => {
    try { res.json(await storage.updateLiveSession(req.params.id, req.body)); } catch (error) { res.status(500).json({ message: "Failed to update session" }); }
  });

  // ─── STUDY PLANS ────────────────────────────────────────────────────────────

  app.get('/api/study-plans', supabaseAuth, async (req: any, res: Response) => {
    try { res.json(await storage.getStudyPlansByUser(req.userId)); } catch (error) { res.status(500).json({ message: "Failed to fetch study plans" }); }
  });

  app.get('/api/study-plans/:id', supabaseAuth, async (req: any, res: Response) => {
    try {
      const plan = await storage.getStudyPlan(req.params.id);
      if (!plan) return res.status(404).json({ message: "Study plan not found" });
      if (plan.userId !== req.userId) return res.status(403).json({ message: "Unauthorized" });
      res.json(plan);
    } catch (error) { res.status(500).json({ message: "Failed to fetch study plan" }); }
  });

  app.post('/api/study-plans', supabaseAuth, async (req: any, res: Response) => {
    try {
      const { title, subjects, examType, deadline, hoursPerDay, weakAreas, schedule } = req.body;
      if (!title || !subjects || subjects.length === 0) return res.status(400).json({ message: "Title and subjects are required" });
      res.json(await storage.createStudyPlan({ userId: req.userId, title, subjects, examType, deadline: deadline ? new Date(deadline) : null, hoursPerDay, weakAreas, schedule, progress: { completedDays: 0, totalDays: schedule?.days?.length || 0 } }));
    } catch (error) { res.status(500).json({ message: "Failed to create study plan" }); }
  });

  app.post('/api/study-plans/generate', supabaseAuth, async (req: any, res: Response) => {
    try {
      const { subjects, examType, deadline, hoursPerDay, weakAreas, goal } = req.body;
      if (!subjects || subjects.length === 0) return res.status(400).json({ message: "Subjects are required" });
      const daysUntilDeadline = deadline ? Math.ceil((new Date(deadline).getTime() - Date.now()) / (1000 * 60 * 60 * 24)) : 30;
      const prompt = `Generate a detailed study plan for a student preparing for ${examType || 'exams'}.\n\nSubjects: ${subjects.join(', ')}\nDays available: ${daysUntilDeadline} days\nStudy hours per day: ${hoursPerDay || 3} hours\n${weakAreas?.length ? `Weak areas: ${weakAreas.join(', ')}` : ''}\n${goal ? `Goal: ${goal}` : ''}\n\nRespond in JSON format: { "title": "...", "summary": "...", "days": [...], "tips": [...], "weeklyGoals": [...] }`;
      const aiResponse = await chatWithGemini([{ role: "system", content: "You are an expert educational planner. Always respond with valid JSON." }, { role: "user", content: prompt }]);
      let schedule;
      try {
        const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
        schedule = jsonMatch ? JSON.parse(jsonMatch[0]) : { title: `Study Plan for ${subjects.join(', ')}`, days: subjects.map((subj: string, i: number) => ({ day: i + 1, date: `Day ${i + 1}`, subjects: [subj], topics: [`${subj} fundamentals`], duration: hoursPerDay || 3, activities: ["Study", "Practice", "Review"], focus: "Core concepts" })), tips: ["Stay consistent", "Take breaks"], weeklyGoals: ["Complete all topics"] };
      } catch (parseError) {
        schedule = { title: `Study Plan for ${subjects.join(', ')}`, days: subjects.map((subj: string, i: number) => ({ day: i + 1, date: `Day ${i + 1}`, subjects: [subj], topics: [`${subj} fundamentals`], duration: hoursPerDay || 3, activities: ["Study", "Practice", "Review"], focus: "Core concepts" })), tips: ["Stay consistent"], weeklyGoals: ["Complete all topics"] };
      }
      res.json(await storage.createStudyPlan({ userId: req.userId, title: schedule.title, subjects, examType, deadline: deadline ? new Date(deadline) : null, hoursPerDay, weakAreas, schedule, progress: { completedDays: 0, totalDays: schedule.days?.length || 0 } }));
    } catch (error) { res.status(500).json({ message: "Failed to generate study plan" }); }
  });

  app.patch('/api/study-plans/:id', supabaseAuth, async (req: any, res: Response) => {
    try {
      const existingPlan = await storage.getStudyPlan(req.params.id);
      if (!existingPlan) return res.status(404).json({ message: "Study plan not found" });
      if (existingPlan.userId !== req.userId) return res.status(403).json({ message: "Unauthorized" });
      res.json(await storage.updateStudyPlan(req.params.id, req.body));
    } catch (error) { res.status(500).json({ message: "Failed to update study plan" }); }
  });

  // ─── TRANSCRIPT ROUTES ──────────────────────────────────────────────────────

  app.post('/api/transcripts', supabaseAuth, async (req: any, res: Response) => {
    try {
      const { sessionId, segments, audioUrl } = req.body;
      res.json(await storage.createTranscript({ sessionId, segments, audioUrl, createdById: req.userId }));
    } catch (error) { res.status(500).json({ message: "Failed to create transcript" }); }
  });

  // ─── LESSON ROUTES ──────────────────────────────────────────────────────────

  app.get('/api/lessons', supabaseAuth, async (req: any, res: Response) => {
    try {
      const { courseId } = req.query;
      res.json(courseId ? await storage.getLessonsByCourse(courseId as string) : []);
    } catch (error) { res.status(500).json({ message: "Failed to fetch lessons" }); }
  });

  app.post('/api/lessons/generate', supabaseAuth, async (req: any, res: Response) => {
    try {
      const { transcriptText, courseId } = req.body;
      const lessonData = await generateLesson(transcriptText);
      res.json(await storage.createLesson({ courseId: courseId || null, title: lessonData.title, content: lessonData, createdById: req.userId }));
    } catch (error) { res.status(500).json({ message: "Failed to generate lesson" }); }
  });

  // ─── COURSE ROUTES ──────────────────────────────────────────────────────────

  app.get('/api/courses', supabaseAuth, async (req: any, res: Response) => {
    try {
      const user = await storage.getUser(req.userId);
      res.json((user?.role === 'teacher' || user?.role === 'lecturer' || user?.role === 'school') ? await storage.getCoursesByTeacher(req.userId) : await storage.getAllCourses());
    } catch (error) { res.status(500).json({ message: "Failed to fetch courses" }); }
  });

  app.post('/api/courses', supabaseAuth, uploadMulter.array('materials', 10), async (req: any, res: Response) => {
    try {
      const userId = req.userId;
      const { title, description, price, category, duration } = req.body;
      const files = req.files as any[];
      let materials: any[] = [];
      if (files && files.length > 0) {
        materials = await Promise.all(files.map(async (file) => {
          let extractedContent = null;
          if (file.mimetype === 'application/pdf') {
            try {
              extractedContent = await analyzeFileWithGeminiVision(file.buffer, file.mimetype, "Extract key learning content from this educational material");
            } catch (err) {}
          }
          return { name: file.originalname, size: file.size, type: file.mimetype, uploadedAt: new Date().toISOString(), extractedContent };
        }));
      }
      let syllabus = null;
      if (materials.length > 0 && materials.some(m => m.extractedContent)) {
        const contentSummary = materials.filter(m => m.extractedContent).map(m => m.extractedContent).join('\n\n');
        try {
          const syllabusResponse = await chatWithGemini([{ role: "system", content: "You are an educational curriculum designer." }, { role: "user", content: `Generate a structured syllabus in JSON format from:\n${contentSummary.substring(0, 5000)}` }]);
          const jsonMatch = syllabusResponse.match(/\{[\s\S]*\}/);
          if (jsonMatch) syllabus = JSON.parse(jsonMatch[0]);
        } catch (err) {}
      }
      const course = await storage.createCourse({ teacherId: userId, title, description, price: price || '0', syllabus, isPublished: true, schoolId: null });
      await storage.updateCourse(course.id, { syllabus: { ...syllabus, category, duration, materials } });
      res.json(course);
    } catch (error) { res.status(500).json({ message: "Failed to create course" }); }
  });

  app.post('/api/courses/generate-syllabus', supabaseAuth, async (req: any, res: Response) => {
    try {
      const { topic } = req.body;
      const user = await storage.getUser(req.userId);
      const tier = (user as any)?.subscriptionTier || 'free';
      const gate = await checkCreditGate(req.userId, user?.email, tier, 5, "Course syllabus generation");
      if (!gate.allowed) return res.status(402).json({ message: gate.message, error: gate.error, balance: gate.balance });
      const syllabus = await generateSyllabus(topic);
      if (user?.email !== ADMIN_EMAIL) await deductCredits(req.userId, 5);
      res.json(syllabus);
    } catch (error) { res.status(500).json({ message: "Failed to generate syllabus" }); }
  });

  // ─── QUIZ ROUTES ─────────────────────────────────────────────────────────────

  app.get('/api/quizzes', supabaseAuth, async (req: any, res: Response) => {
    try {
      const { courseId } = req.query;
      res.json(courseId ? await storage.getQuizzesByCourse(courseId as string) : []);
    } catch (error) { res.status(500).json({ message: "Failed to fetch quizzes" }); }
  });

  app.post('/api/quizzes', supabaseAuth, async (req: any, res: Response) => {
    try {
      const { courseId, title, description, difficulty, timeLimit, questions, rubric } = req.body;
      res.json(await storage.createQuiz({ courseId, title, description, difficulty: difficulty || 'medium', timeLimit, questions, rubric, createdById: req.userId }));
    } catch (error) { res.status(500).json({ message: "Failed to create quiz" }); }
  });

  app.post('/api/quiz-attempts', supabaseAuth, async (req: any, res: Response) => {
    try {
      const { quizId, answers } = req.body;
      const quiz = await storage.getQuiz(quizId);
      if (!quiz) return res.status(404).json({ message: "Quiz not found" });
      const grading = await gradeQuiz(answers, quiz.rubric);
      const attempt = await storage.createQuizAttempt({ quizId, studentId: req.userId, answers, score: grading.score.toString(), feedback: grading });
      await storage.createMemoryEntry({ userId: req.userId, type: 'quiz_result', data: { quizId, score: grading.score, weakTopics: grading.feedback.filter((f: any) => f.points < f.maxPoints).map((f: any) => f.topic) } });
      res.json(attempt);
    } catch (error) { res.status(500).json({ message: "Failed to submit quiz attempt" }); }
  });

  // ─── FILE UPLOAD (generic) ──────────────────────────────────────────────────

  app.post('/api/files/upload', supabaseAuth, async (req: any, res: Response) => {
    try {
      const { fileName, fileType, fileSize, fileUrl } = req.body;
      res.json(await storage.createFileUpload({ userId: req.userId, fileName, fileType, fileSize, fileUrl, processingStatus: 'pending', extractedText: null }));
    } catch (error) { res.status(500).json({ message: "Failed to upload file" }); }
  });

  // ─── NOTES & EXPORT ─────────────────────────────────────────────────────────

  app.post('/api/notes/summarize', supabaseAuth, async (req: any, res: Response) => {
    try {
      const { text, length } = req.body;
      res.json({ summary: await summarizeText(text, length || 'medium') });
    } catch (error) { res.status(500).json({ message: "Failed to summarize" }); }
  });

  app.post('/api/notes/flashcards', supabaseAuth, async (req: any, res: Response) => {
    try {
      const { text } = req.body;
      res.json(await generateFlashcards(text));
    } catch (error) { res.status(500).json({ message: "Failed to generate flashcards" }); }
  });

  // ─── PURCHASE / MARKETPLACE ─────────────────────────────────────────────────

  app.post('/api/purchases', supabaseAuth, async (req: any, res: Response) => {
    try {
      const userId = req.userId;
      const { courseId, amount } = req.body;
      const user = await storage.getUser(userId);
      if (!user || !user.email) return res.status(400).json({ message: "User email required for payment" });
      const reference = `LENORY_${nanoid(16)}`;
      const purchase = await storage.createPurchase({ buyerId: userId, courseId, amount, paymentStatus: 'pending', paystackReference: reference });
      try {
        const amountInKobo = await convertNairaToKobo(parseFloat(amount));
        const paymentInit = await initializePayment(user.email, amountInKobo, reference, { courseId, userId, purchaseId: purchase.id });
        res.json({ purchase, authorizationUrl: paymentInit.data.authorization_url, accessCode: paymentInit.data.access_code, reference: paymentInit.data.reference });
      } catch (paystackError) {
        res.json({ purchase, authorizationUrl: `/marketplace?error=paystack_unavailable`, reference });
      }
    } catch (error) { res.status(500).json({ message: "Failed to create purchase" }); }
  });

  app.post('/api/purchases/verify', supabaseAuth, async (req: any, res: Response) => {
    try {
      const { reference } = req.body;
      const verification = await verifyPayment(reference);
      if (verification.data.status === 'success') {
        const purchases = await storage.getPurchasesByBuyer(req.userId);
        const purchase = purchases.find(p => p.paystackReference === reference);
        if (purchase) {
          await storage.updatePurchaseStatus(purchase.id, 'completed');
          res.json({ success: true, verified: true });
        } else {
          res.status(404).json({ message: "Purchase not found" });
        }
      } else {
        res.json({ success: false, verified: false, status: verification.data.status });
      }
    } catch (error) { res.status(500).json({ message: "Payment verification failed" }); }
  });

  // ─── ANALYTICS ──────────────────────────────────────────────────────────────

  app.post('/api/analytics/event', supabaseAuth, async (req: any, res: Response) => {
    try {
      await storage.createAnalyticsEvent({ userId: req.userId, eventType: req.body.eventType, eventData: req.body.eventData, schoolId: null });
      res.json({ success: true });
    } catch (error) { res.status(500).json({ message: "Failed to create analytics event" }); }
  });

  // ─── MEMORY ENTRIES ─────────────────────────────────────────────────────────

  app.get('/api/memory/entries', supabaseAuth, async (req: any, res: Response) => {
    try { res.json(await storage.getMemoryEntriesByUser(req.userId)); } catch (error) { res.status(500).json({ message: "Failed to fetch memory entries" }); }
  });

  // ─── GENERATE LESSON ────────────────────────────────────────────────────────

  app.post('/api/generate-lesson', supabaseAuth, async (req: any, res: Response) => {
    try {
      const { text } = req.body;
      if (!text) return res.status(400).json({ message: "Transcript text is required" });
      res.json(await generateLesson(text));
    } catch (error) { res.status(500).json({ message: "Failed to generate lesson" }); }
  });

  app.post('/api/generate-lesson-from-text', supabaseAuth, async (req: any, res: Response) => {
    try {
      const userId = req.userId;
      const { text, recordingId } = req.body;
      if (!text?.trim()) return res.status(400).json({ message: "Text is required" });
      const geminiData = await generateLessonFromTextWithGemini(text);
      res.json(await storage.createGeneratedLesson({ userId, recordingId: recordingId || null, title: geminiData.title, objectives: geminiData.objectives, keyPoints: geminiData.keyPoints, summary: geminiData.summary, originalText: text }));
    } catch (error) { res.status(500).json({ message: "Failed to generate lesson" }); }
  });

  // ─── AI FIX TEXT ────────────────────────────────────────────────────────────

  app.post('/api/ai-fix-text', supabaseAuth, async (req: any, res: Response) => {
    try {
      const { text } = req.body;
      if (!text?.trim()) return res.status(400).json({ message: "Text is required" });
      res.json(await fixTextWithLENORY(text));
    } catch (error) { res.status(500).json({ message: "Failed to fix text" }); }
  });

  // ─── SUMMARIZE AND CORRECT ─────────────────────────────────────────────────

  app.post('/api/summarize-and-correct', supabaseAuth, async (req: any, res: Response) => {
    try {
      const { text } = req.body;
      if (!text) return res.status(400).json({ message: "Text is required" });
      const response = await chatWithAI([{ role: "user", content: `Fix spelling and grammar, then summarize in 2-3 sentences. Extract key points.\n\nText: ${text.slice(0, 500)}\n\nFormat:\nCORRECTED: [fixed text]\nSUMMARY: [2-3 sentences]\nKEY_WORDS: [keywords]` }]);
      const correctedMatch = response.match(/CORRECTED:\s*([\s\S]*?)(?:\nSUMMARY:|$)/);
      const summaryMatch = response.match(/SUMMARY:\s*([\s\S]*?)(?:\nKEY_WORDS:|$)/);
      const keywordsMatch = response.match(/KEY_WORDS:\s*(.+?)$/);
      res.json({ correctedText: correctedMatch ? correctedMatch[1].trim() : text, summary: summaryMatch ? summaryMatch[1].trim() : "", keywords: keywordsMatch ? keywordsMatch[1].trim().split(',').map((k: string) => k.trim()) : [] });
    } catch (error) { res.status(500).json({ message: "Failed to process text" }); }
  });

  // ─── HTTP SERVER & WEBSOCKETS ──────────────────────────────────────────────

  const httpServer = createServer(app);

  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });
  const geminiLiveWss = new WebSocketServer({ server: httpServer, path: '/ws/gemini-live' });

  geminiLiveWss.on('connection', (ws: WebSocket, req) => {
    console.log('New Gemini Live WebSocket connection');
    const url = new URL(req.url || '', `http://${req.headers.host}`);
    const userId = url.searchParams.get('userId') || 'anonymous';
    const sessionId = url.searchParams.get('sessionId') || '';
    handleGeminiLiveConnection(ws, userId, sessionId);
  });

  wss.on('connection', (ws: WebSocket) => {
    console.log('New WebSocket connection established');
    const audioBuffer: Buffer[] = [];

    ws.on('message', async (message: string) => {
      try {
        const data = JSON.parse(message.toString());

        if (data.type === 'audio_chunk' && data.data) {
          const base64Data = data.data.split(',')[1];
          if (base64Data) {
            audioBuffer.push(Buffer.from(base64Data, 'base64'));

            if (audioBuffer.length >= 2) {
              const combinedAudio = Buffer.concat(audioBuffer);
              const tempDir = os.tmpdir();
              const tempFile = path.join(tempDir, `audio_${Date.now()}.webm`);
              
              fs.writeFileSync(tempFile, combinedAudio);
              
              try {
                const transcription = await transcribeAudio(tempFile);
                ws.send(JSON.stringify({
                  type: 'transcript_segment',
                  data: { speaker: 'Speaker', text: transcription.text, timestamp: Date.now() },
                }));
                fs.unlinkSync(tempFile);
              } catch (transcriptionError) {
                console.error('Transcription error:', transcriptionError);
                if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
                ws.send(JSON.stringify({ type: 'error', data: { message: 'Transcription failed' } }));
              }
              audioBuffer.length = 0;
            }
          }
        }
      } catch (error) {
        console.error('WebSocket error:', error);
      }
    });

    ws.on('close', () => {
      console.log('WebSocket connection closed');
      audioBuffer.length = 0;
    });
  });

  // ─── TOPIC EXPLANATION ──────────────────────────────────────────────────────

  app.post('/api/explain-topic', supabaseAuth, async (req: any, res: Response) => {
    try {
      const userId = req.userId;
      const { subject, topic, difficulty = 'medium' } = req.body;
      if (!subject?.trim() || !topic?.trim()) return res.status(400).json({ message: "Subject and topic are required" });
      const existing = await storage.getTopicExplanation(userId, subject, topic);
      if (existing) return res.json(existing);
      const explanation = await explainTopicWithLENORY(subject, topic, difficulty);
      const imagePrompt = `${subject} - ${topic}`;
      const image = await generateImageWithLENORY(imagePrompt);
      const stored = await storage.createTopicExplanation({ userId, subject, topic, explanation: explanation.explanation, examples: explanation.examples, relatedTopics: explanation.relatedTopics });
      await storage.createGeneratedImage({ userId, prompt: imagePrompt, imageUrl: image.url, relatedTopic: topic });
      await storage.createLearningHistory({ userId, subject, topic });
      res.json(stored);
    } catch (error) {
      console.error("Error explaining topic:", error);
      res.status(500).json({ message: "Failed to explain topic" });
    }
  });

  // ─── GENERATE IMAGE ─────────────────────────────────────────────────────────

  app.post('/api/generate-image', supabaseAuth, async (req: any, res: Response) => {
    try {
      const userId = req.userId;
      const { prompt, relatedTopic, style } = req.body;
      if (!prompt?.trim()) return res.status(400).json({ message: "Prompt is required" });
      const user = await storage.getUser(userId);
      const tier = user?.subscriptionTier || 'free';
      const isAdmin = user?.email === ADMIN_EMAIL;
      if (!isAdmin) {
        const MONTHLY_IMAGE_LIMITS: Record<string, number> = { free: 5, pro: 50, premium: Infinity };
        const limit = MONTHLY_IMAGE_LIMITS[tier] ?? 5;
        if (isFinite(limit)) {
          const allImages = await storage.getGeneratedImagesByUser(userId);
          const thisMonth = new Date().toISOString().slice(0, 7);
          const monthlyCount = allImages.filter((img: any) => {
            const created = img.createdAt || img.created_at || "";
            return typeof created === "string" ? created.startsWith(thisMonth) : false;
          }).length;
          if (monthlyCount >= limit) return res.status(403).json({ message: `Image generation limit reached (${limit}/month on ${tier} plan).`, limit, used: monthlyCount, tier });
        }
        const credits = await getOrCreateCredits(userId, tier);
        if (credits.balance < 2) return res.status(403).json({ message: "Insufficient credits. You need at least 2 credits.", balance: credits.balance });
      }
      const styleHints: Record<string, string> = {
        illustrated: "illustrated, vector art, flat design",
        sketch: "pencil sketch, hand-drawn, monochrome line art",
        "3d": "3D render, CGI, octane render, volumetric lighting",
        watercolor: "watercolor painting, soft brush strokes, artistic",
        neon: "neon glow, cyberpunk, dark background, neon lights",
        photorealistic: "photorealistic, ultra-detailed, 8K, sharp focus",
      };
      const styleTag = styleHints[style] || "";
      const effectivePrompt = styleTag ? `${prompt}, ${styleTag}` : prompt;
      const image = await generateImageWithLENORY(effectivePrompt);
      logApiUsage("stability-image", userId, "/api/generate-image");
      const stored = await storage.createGeneratedImage({ userId, prompt, imageUrl: image.url, relatedTopic });
      if (!isAdmin) {
        const newBalance = await deductCredits(userId, 2);
        console.log(`💰 Deducted 2 credits for image — user ${userId}, new balance: ${newBalance}`);
      }
      res.json(stored);
    } catch (error) {
      console.error("Error generating image:", error);
      res.status(500).json({ message: "Failed to generate image" });
    }
  });

  app.get('/api/generated-images', supabaseAuth, async (req: any, res: Response) => {
    try { res.json(await storage.getGeneratedImagesByUser(req.userId)); } catch (error) { res.status(500).json({ message: "Failed to fetch generated images" }); }
  });

  app.delete('/api/generated-images/:id', supabaseAuth, async (req: any, res: Response) => {
    try {
      await storage.deleteGeneratedImage(req.userId, req.params.id);
      res.json({ message: "Image deleted successfully", id: req.params.id });
    } catch (error) { res.status(500).json({ message: "Failed to delete image" }); }
  });

  // ─── LEARNING HISTORY ───────────────────────────────────────────────────────

  app.get('/api/learning-history', supabaseAuth, async (req: any, res: Response) => {
    try { res.json(await storage.getLearningHistoryByUser(req.userId, req.query.limit ? parseInt(req.query.limit) : 50)); } catch (error) { res.status(500).json({ message: "Failed to fetch learning history" }); }
  });

  app.get('/api/learning/insights', supabaseAuth, async (req: any, res: Response) => {
    try {
      const { generateLearningInsights } = await import("./tutorSystem");
      res.json(await generateLearningInsights(req.userId));
    } catch (error) { res.status(500).json({ message: "Failed to fetch learning insights" }); }
  });

  app.get('/api/focus-areas', supabaseAuth, async (req: any, res: Response) => {
    try {
      const history = await storage.getLearningHistoryByUser(req.userId, 100);
      const subjectMap = new Map<string, { count: number; topics: string[] }>();
      history.forEach((entry: any) => {
        if (!subjectMap.has(entry.subject)) subjectMap.set(entry.subject, { count: 0, topics: [] });
        const data = subjectMap.get(entry.subject)!;
        data.count++;
        if (!data.topics.includes(entry.topic)) data.topics.push(entry.topic);
      });
      res.json(Array.from(subjectMap.entries()).map(([subject, data]) => ({ subject, topicsLearned: data.count, recentTopics: data.topics.slice(-5), strength: data.count > 5 ? 'strong' : data.count > 2 ? 'developing' : 'beginner' })));
    } catch (error) { res.status(500).json({ message: "Failed to analyze focus areas" }); }
  });

  // ─── EXPORT USER DATA ──────────────────────────────────────────────────────

  app.post('/api/export-data', supabaseAuth, async (req: any, res: Response) => {
    try {
      const userId = req.userId;
      const { format = 'json' } = req.body;
      const history = await storage.getLearningHistoryByUser(userId, 100);
      const explanations = await storage.getTopicExplanationsByUser(userId);
      const user = await storage.getUser(userId);
      const exportData = { user: user?.firstName + ' ' + user?.lastName, exportedAt: new Date().toISOString(), learningHistory: history, topicExplanations: explanations.map(e => ({ subject: e.subject, topic: e.topic, explanation: e.explanation, generatedAt: e.createdAt })) };
      res.json(exportData);
    } catch (error) { res.status(500).json({ message: "Failed to export data" }); }
  });

  // ─── NOTIFICATIONS ──────────────────────────────────────────────────────────

  app.get('/api/notifications', supabaseAuth, async (req: any, res: Response) => {
    try { res.json(await storage.getNotificationsByUser(req.userId, req.query.limit ? parseInt(req.query.limit as string) : 50)); } catch (error) { res.status(500).json({ message: "Failed to fetch notifications" }); }
  });

  app.post('/api/notifications', supabaseAuth, async (req: any, res: Response) => {
    try {
      const { type, title, message, icon, actionUrl } = req.body;
      res.status(201).json(await storage.createNotification({ userId: req.userId, type: type || 'system', title, message, icon, actionUrl, read: false }));
    } catch (error) { res.status(500).json({ message: "Failed to create notification" }); }
  });

  app.get('/api/notifications/:id', supabaseAuth, async (req: any, res: Response) => {
    try {
      const notification = await storage.getNotification(req.params.id);
      if (!notification) return res.status(404).json({ message: "Notification not found" });
      res.json(notification);
    } catch (error) { res.status(500).json({ message: "Failed to fetch notification" }); }
  });

  app.patch('/api/notifications/:id/read', supabaseAuth, async (req: any, res: Response) => {
    try {
      const notification = await storage.markNotificationAsRead(req.params.id);
      if (!notification) return res.status(404).json({ message: "Notification not found" });
      res.json(notification);
    } catch (error) { res.status(500).json({ message: "Failed to mark notification as read" }); }
  });

  app.delete('/api/notifications/:id', supabaseAuth, async (req: any, res: Response) => {
    try { await storage.deleteNotification(req.params.id); res.json({ message: "Notification deleted successfully" }); } catch (error) { res.status(500).json({ message: "Failed to delete notification" }); }
  });

  // ─── LIVE AI ROUTES ─────────────────────────────────────────────────────────

  app.post('/api/live-ai/voice-start', supabaseAuth, async (req: any, res: Response) => {
    try {
      const userId = req.userId;
      const user = await storage.getUser(userId);
      if (user?.email !== ADMIN_EMAIL) {
        const tier = (user as any)?.subscriptionTier || 'free';
        const credits = await getOrCreateCredits(userId, tier);
        if (credits.balance < 20) {
          return res.status(402).json({
            message: "You need at least 20 credits to start a voice session. Please top up.",
            error: "INSUFFICIENT_CREDITS",
            balance: credits.balance,
          });
        }
      }
      res.status(201).json(await storage.createVoiceConversation({ userId: req.userId }));
    } catch (error) {
      console.error("Error starting voice conversation:", error);
      res.status(500).json({ message: "Failed to start voice conversation" });
    }
  });

  app.post('/api/live-ai/document-upload', supabaseAuth, uploadMulter.single('file'), async (req: any, res: Response) => {
    try {
      const userId = req.userId;
      if (!req.file) return res.status(400).json({ message: "No file provided" });
      const fileName = req.body.fileName || req.file.originalname || 'document';
      const fileType = req.body.fileType || req.file.mimetype || 'application/octet-stream';
      const fileSize = req.file.size;
      const doc = await storage.createDocumentUpload({ userId, fileName, fileType, fileUrl: `file://${nanoid()}`, fileSize, isProcessing: true, extractedText: '', aiAnalysis: null });
      (async () => {
        try {
          const result = await analyzeFileWithGeminiVision(req.file.buffer, fileType, fileName);
          await storage.updateDocumentUpload(doc.id, { extractedText: result.extractedText, aiAnalysis: result, isProcessing: false });
        } catch (error) {
          await storage.updateDocumentUpload(doc.id, { isProcessing: false, extractedText: 'Analysis failed', aiAnalysis: { error: error instanceof Error ? error.message : 'Unknown error' } });
        }
      })();
      res.status(201).json({ ...doc, message: "File uploaded successfully. Analyzing content..." });
    } catch (error) { res.status(500).json({ message: "Failed to upload document" }); }
  });

  app.get('/api/live-ai/documents', supabaseAuth, async (req: any, res: Response) => {
    try {
      const userId = req.userId;
      const docs = await storage.getDocumentUploadsByUser(userId);
      res.json(docs);
    } catch (error) {
      console.error("Error fetching documents:", error);
      res.status(500).json({ message: "Failed to fetch documents" });
    }
  });

  app.get('/api/live-ai/conversations', supabaseAuth, async (req: any, res: Response) => {
    try {
      const userId = req.userId;
      const conversations = await storage.getVoiceConversationsByUser(userId);
      res.json(conversations);
    } catch (error) {
      console.error("Error fetching conversations:", error);
      res.status(500).json({ message: "Failed to fetch conversations" });
    }
  });

  app.post('/api/live-ai/feature', supabaseAuth, async (req: any, res: Response) => {
    try {
      const userId = req.userId;
      const { featureType, context } = req.body;
      const feature = await storage.createLiveAiFeature({ userId, featureType, context, status: 'pending' });
      res.status(201).json(feature);
    } catch (error) {
      console.error("Error creating feature:", error);
      res.status(500).json({ message: "Failed to create feature" });
    }
  });

  // ─── AUDIO TRANSCRIBE ──────────────────────────────────────────────────────

  app.post('/api/audio/transcribe', supabaseAuth, uploadMulter.single('audio'), async (req: any, res: Response) => {
    try {
      if (!req.file) return res.status(400).json({ message: "No audio file provided" });
      const tempFile = path.join(os.tmpdir(), `voice_${Date.now()}.wav`);
      fs.writeFileSync(tempFile, req.file.buffer);
      try {
        const { text } = await transcribeAudio(tempFile);
        console.log("✓ Transcribed:", text);
        res.json({ text, success: true });
      } finally {
        if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
      }
    } catch (error: any) {
      console.error("Transcription error:", error);
      res.status(500).json({ message: error?.message || "Transcription failed", text: "" });
    }
  });

  // ─── LIVE SESSION TRANSCRIBE ──────────────────────────────────────────────

  app.post('/api/live-session/transcribe', supabaseAuth, uploadMulter.single('audio'), async (req: any, res: Response) => {
    try {
      const userId = req.userId;
      if (!req.file) return res.status(400).json({ message: "No audio file provided" });
      const audioBuffer = req.file.buffer;
      const ext = req.file.originalname?.split('.').pop() || 'webm';
      const tempFile = path.join(os.tmpdir(), `live_${Date.now()}.${ext}`);
      fs.writeFileSync(tempFile, audioBuffer);
      let transcriptText = "";
      let durationSeconds = 0;
      let engineUsed = "gemini";
      try {
        const OpenAI = (await import("openai")).default;
        const groqKey = process.env.GROQ_API_KEY;
        const openaiKey = process.env.OPENAI_API_KEY;
        if (groqKey) {
          const groq = new OpenAI({ apiKey: groqKey, baseURL: "https://api.groq.com/openai/v1" });
          const { toFile } = await import("openai");
          const audioFile = await toFile(fs.createReadStream(tempFile), `audio.${ext}`, { type: req.file.mimetype || "audio/webm" });
          const result = await groq.audio.transcriptions.create({
            file: audioFile,
            model: "whisper-large-v3-turbo",
            response_format: "verbose_json",
            language: "en",
          } as any);
          transcriptText = (result as any).text || "";
          durationSeconds = (result as any).duration || 0;
          engineUsed = "groq-whisper-large-v3-turbo";
          console.log(`✓ Groq Whisper transcribed ${durationSeconds.toFixed(1)}s of audio`);
        } else if (openaiKey) {
          const openai = new OpenAI({ apiKey: openaiKey });
          const { toFile } = await import("openai");
          const audioFile = await toFile(fs.createReadStream(tempFile), `audio.${ext}`, { type: req.file.mimetype || "audio/webm" });
          const result = await openai.audio.transcriptions.create({
            file: audioFile,
            model: "whisper-1",
            response_format: "verbose_json",
          } as any);
          transcriptText = (result as any).text || "";
          durationSeconds = (result as any).duration || 0;
          engineUsed = "openai-whisper-1";
          console.log(`✓ OpenAI Whisper transcribed ${durationSeconds.toFixed(1)}s of audio`);
        } else {
          const result = await transcribeAudio(tempFile);
          transcriptText = result.text;
          durationSeconds = result.duration || 0;
          engineUsed = "gemini-2.5-flash";
        }
      } finally {
        if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
      }
      const user = await storage.getUser(userId);
      const ADMIN_EMAIL = REAL_ADMIN_EMAIL;
      let creditsDeducted = 0;
      if (user?.email !== ADMIN_EMAIL && durationSeconds > 0) {
        const durationMinutes = Math.ceil(durationSeconds / 60);
        const tier = (user as any)?.subscriptionTier || 'free';
        const credits = await getOrCreateCredits(userId, tier);
        creditsDeducted = Math.min(durationMinutes, credits.balance);
        await deductCredits(userId, creditsDeducted);
        console.log(`💳 Deducted ${creditsDeducted} credits for ${durationMinutes} min transcription`);
      }
      logApiUsage(engineUsed, userId, "/api/transcribe");
      res.json({ text: transcriptText, duration_seconds: durationSeconds, credits_deducted: creditsDeducted, engine: engineUsed, success: true });
    } catch (error: any) {
      console.error("Live session transcription error:", error);
      res.status(500).json({ message: error?.message || "Transcription failed", text: "" });
    }
  });

  app.post('/api/transcribe', uploadMulter.single('audio'), async (req: any, res: Response) => {
    try {
      if (!req.file) return res.status(400).json({ message: "No audio file provided" });
      const tempFile = path.join(os.tmpdir(), `voice_${Date.now()}.wav`);
      fs.writeFileSync(tempFile, req.file.buffer);
      try {
        const { text } = await transcribeAudio(tempFile);
        console.log("✓ Transcribed:", text);
        res.json({ text, success: true });
      } finally {
        if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
      }
    } catch (error: any) {
      console.error("Transcription error:", error);
      res.status(500).json({ message: error?.message || "Transcription failed", text: "" });
    }
  });

  // ─── TEXT TO SPEECH ─────────────────────────────────────────────────────────

  app.post('/api/audio/speak', supabaseAuth, async (req: any, res: Response) => {
    try {
      const { text, voice = "alloy" } = req.body;
      if (!text?.trim()) return res.status(400).json({ message: "Text is required" });
      const audioBuffer = await generateSpeech(text);
      res.setHeader('Content-Type', 'audio/mpeg');
      res.setHeader('Content-Length', audioBuffer.length);
      res.send(audioBuffer);
    } catch (error: any) {
      console.error("Speech generation error:", error);
      res.status(500).json({ message: error?.message || "Speech generation failed" });
    }
  });

  // ─── NOTIFICATIONS SEND CHAT HISTORY ───────────────────────────────────────

  app.post('/api/notifications/send-chat-history', supabaseAuth, async (req: any, res: Response) => {
    try {
      const userId = req.userId;
      const sessions = await storage.getChatSessionsByUser(userId);
      if (!sessions || sessions.length === 0) return res.json({ message: "No chat sessions found", count: 0, sessions: [] });
      let notificationCount = 0;
      const sessionData: any[] = [];
      for (const session of sessions) {
        try {
          await storage.createNotification({
            userId,
            type: "chat_history" as any,
            title: session.title || "Previous Chat",
            message: `From ${new Date(session.createdAt).toLocaleDateString()}`,
            icon: "💬",
            actionUrl: `/chat?sessionId=${session.id}`,
            read: false,
          });
          notificationCount++;
          sessionData.push({ id: session.id, title: session.title, createdAt: session.createdAt });
        } catch (err) { console.error("Failed to create notification for session:", session.id, err); }
      }
      res.json({ message: `Created ${notificationCount} notifications for chat history`, count: notificationCount, sessions: sessionData });
    } catch (error) {
      console.error("Error sending chat history notifications:", error);
      res.status(500).json({ message: "Failed to send chat history notifications" });
    }
  });

  // ─── RECORDINGS ─────────────────────────────────────────────────────────────

  app.get('/api/recordings', supabaseAuth, async (req: any, res: Response) => {
    try {
      const recordings = await storage.getRecordingsByUser(req.userId);
      res.json(recordings);
    } catch (error: any) {
      console.error("Error fetching recordings:", error);
      res.status(500).json({ message: error?.message || 'Failed to fetch recordings' });
    }
  });

  app.post('/api/recordings', supabaseAuth, async (req: any, res: Response) => {
    try {
      const userId = req.userId;
      const { title, audioData, transcript, duration, sessionId } = req.body;
      if (!title?.trim()) return res.status(400).json({ message: 'Title is required' });
      let transcriptArray = [];
      if (Array.isArray(transcript)) transcriptArray = transcript;
      else if (typeof transcript === 'string') {
        try { transcriptArray = JSON.parse(transcript); } catch { transcriptArray = []; }
      }
      const recording = await storage.createRecording({ userId, sessionId: sessionId || null, title, audioData: audioData || '', transcript: transcriptArray, duration: duration || 0 });
      console.log("Recording created successfully:", recording.id);
      res.json(recording);
    } catch (error: any) {
      console.error("Error creating recording:", error);
      res.status(500).json({ message: error?.message || 'Failed to save recording' });
    }
  });

  app.delete('/api/recordings/:id', supabaseAuth, async (req: any, res: Response) => {
    try {
      await storage.deleteRecording(req.params.id);
      res.json({ message: 'Recording deleted successfully' });
    } catch (error: any) {
      console.error("Error deleting recording:", error);
      res.status(500).json({ message: error?.message || 'Failed to delete recording' });
    }
  });

  // ─── GENERATED LESSONS ──────────────────────────────────────────────────────

  app.get('/api/generated-lessons', supabaseAuth, async (req: any, res: Response) => {
    try {
      const lessons = await storage.getGeneratedLessonsByUser(req.userId);
      res.json(lessons);
    } catch (error: any) {
      console.error("Error fetching lessons:", error);
      res.status(500).json({ message: error?.message || 'Failed to fetch lessons' });
    }
  });

  app.post('/api/generated-lessons', supabaseAuth, async (req: any, res: Response) => {
    try {
      const userId = req.userId;
      const { title, objectives, keyPoints, summary, recordingId } = req.body;
      if (!title?.trim()) return res.status(400).json({ message: 'Title is required' });
      const lesson = await storage.createGeneratedLesson({ userId, recordingId: recordingId || null, title, objectives: objectives || [], keyPoints: keyPoints || [], summary: summary || '' });
      res.json(lesson);
    } catch (error: any) {
      console.error("Error creating lesson:", error);
      res.status(500).json({ message: error?.message || 'Failed to save lesson' });
    }
  });

  app.delete('/api/generated-lessons/:id', supabaseAuth, async (req: any, res: Response) => {
    try {
      await storage.deleteGeneratedLesson(req.params.id);
      res.json({ message: 'Lesson deleted successfully' });
    } catch (error: any) {
      console.error("Error deleting lesson:", error);
      res.status(500).json({ message: error?.message || 'Failed to delete lesson' });
    }
  });

  // ─── CBT MODE ───────────────────────────────────────────────────────────────

  app.post('/api/cbt/generate-questions', supabaseAuth, async (req: any, res: Response) => {
    try {
      const { examType, subject, count = 250 } = req.body;
      const userId = req.userId;
      if (!examType || !subject) return res.status(400).json({ message: 'Exam type and subject required' });
      const user = await storage.getUser(userId);
      const tier = (user as any)?.subscriptionTier || 'free';
      const ADMIN_EMAIL = REAL_ADMIN_EMAIL;
      const gate = await checkCreditGate(userId, user?.email, tier, 5, "CBT question generation");
      if (!gate.allowed) return res.status(402).json({ message: gate.message, error: gate.error, balance: gate.balance });
      console.log(`📚 Generating ${count} questions for ${subject} (${examType})...`);
      const questions = await generateQuestionsWithLENORY(examType, subject, Math.min(count, 250));
      if (user?.email !== ADMIN_EMAIL) await deductCredits(userId, 5);
      res.json({ questions });
    } catch (error: any) {
      console.error("Question generation error:", error);
      res.status(500).json({ message: error?.message || 'Failed to generate questions' });
    }
  });

  app.post('/api/cbt/grade', supabaseAuth, async (req: any, res: Response) => {
    try {
      const { questions, answers, sessionId, examType, subjects } = req.body;
      const userId = req.userId;
      if (!questions || !answers) return res.status(400).json({ message: 'Questions and answers required' });
      const gradingResult = await gradeAnswersWithLENORY(questions, answers);
      const examHistory = await storage.createCbtExamHistory({ userId, sessionId: sessionId || 'temp', examType: examType || 'custom', subjects: subjects || [], score: String(gradingResult.score), totalQuestions: questions.length, correctAnswers: Math.round((gradingResult.score / 100) * questions.length), timeSpent: 0, summary: gradingResult.summary, aiAnalysis: gradingResult, questions, userAnswers: answers });
      await storage.createNotification({ userId, type: 'exam', title: `Exam Complete: ${gradingResult.score}%`, message: gradingResult.summary, icon: 'CheckCircle2' });
      for (const topic of gradingResult.strongTopics) await storage.updateCbtAnalytics(userId, topic, true);
      for (const topic of gradingResult.weakTopics) await storage.updateCbtAnalytics(userId, topic, false);
      res.json({ gradingResult, examHistory, recommendations: gradingResult.recommendations });
    } catch (error: any) {
      console.error("Grading error:", error);
      res.status(500).json({ message: error?.message || 'Grading failed' });
    }
  });

  app.get('/api/cbt/history', supabaseAuth, async (req: any, res: Response) => {
    try {
      const history = await storage.getCbtExamHistoryByUser(req.userId);
      res.json(history);
    } catch (error: any) {
      res.status(500).json({ message: error?.message || 'Failed to fetch history' });
    }
  });

  app.get('/api/cbt/analytics', supabaseAuth, async (req: any, res: Response) => {
    try {
      const analytics = await storage.getCbtAnalyticsByUser(req.userId);
      res.json(analytics);
    } catch (error: any) {
      res.status(500).json({ message: error?.message || 'Failed to fetch analytics' });
    }
  });

  app.delete('/api/cbt/history/:id', supabaseAuth, async (req: any, res: Response) => {
    try {
      const { id } = req.params;
      const userId = req.userId;
      const history = await storage.getCbtExamHistoryByUser(userId);
      const examToDelete = history.find((h: any) => h.id === id);
      if (!examToDelete) return res.status(404).json({ message: 'Exam not found' });
      await storage.deleteCbtExamHistory(id);
      console.log(`✅ Exam ${id} deleted by user ${userId}`);
      res.json({ message: 'Exam deleted successfully', id });
    } catch (error: any) {
      console.error("Delete exam error:", error);
      res.status(500).json({ message: error?.message || 'Failed to delete exam' });
    }
  });

  app.post('/api/admin/cbt/import-questions', supabaseAuth, async (req: any, res: Response) => {
    try {
      const { examId, subject, questions } = req.body;
      if (!examId || !subject || !Array.isArray(questions)) return res.status(400).json({ message: 'Invalid import data' });
      const imported = [];
      for (const q of questions) {
        const question = await storage.createCbtQuestion({ examId, subject, questionNumber: q.number || 1, questionText: q.question, options: q.options || [], correctAnswer: q.correct || 'A', explanation: q.explanation || '' });
        if (q.source) {
          await storage.createCbtQuestionLicensing({ questionId: question.id, source: q.source, licenseId: q.licenseId, licenseProvider: q.provider, year: q.year, copyright: q.copyright });
        }
        imported.push(question);
      }
      res.json({ message: `Imported ${imported.length} questions`, questions: imported });
    } catch (error: any) {
      res.status(500).json({ message: error?.message || 'Import failed' });
    }
  });

  app.get('/api/cbt/licensing/:questionId', supabaseAuth, async (req: any, res: Response) => {
    try {
      const licensing = await storage.getCbtQuestionLicensing(req.params.questionId);
      res.json(licensing);
    } catch (error: any) {
      res.status(500).json({ message: error?.message || 'Failed to fetch licensing info' });
    }
  });

  // ─── PROJECT WORKSPACE ──────────────────────────────────────────────────────

  app.post('/api/projects', supabaseAuth, async (req: any, res: Response) => {
    try {
      const { name, description } = req.body;
      const project = await storage.createProject({ userId: req.userId, name, description });
      res.json(project);
    } catch (error: any) {
      res.status(500).json({ message: 'Failed to create project' });
    }
  });

  app.delete('/api/projects/:id', supabaseAuth, async (req: any, res: Response) => {
    try {
      await storage.deleteProject(req.params.id);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ message: 'Failed to delete project' });
    }
  });

  app.get('/api/projects/:projectId/files', supabaseAuth, async (req: any, res: Response) => {
    try {
      const files = await storage.getFilesByProject(req.params.projectId);
      res.json(files);
    } catch (error: any) {
      res.status(500).json({ message: 'Failed to fetch files' });
    }
  });

  app.post('/api/projects/:projectId/files', supabaseAuth, async (req: any, res: Response) => {
    try {
      const { name, content } = req.body;
      const file = await storage.createFile({ projectId: req.params.projectId, name, content });
      res.json(file);
    } catch (error: any) {
      res.status(500).json({ message: 'Failed to create file' });
    }
  });

  app.delete('/api/files/:id', supabaseAuth, async (req: any, res: Response) => {
    try {
      await storage.deleteFile(req.params.id);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ message: 'Failed to delete file' });
    }
  });

  app.get('/api/projects/:projectId/tasks', supabaseAuth, async (req: any, res: Response) => {
    try {
      const tasks = await storage.getTasksByProject(req.params.projectId);
      res.json(tasks);
    } catch (error: any) {
      res.status(500).json({ message: 'Failed to fetch tasks' });
    }
  });

  app.post('/api/projects/:projectId/tasks', supabaseAuth, async (req: any, res: Response) => {
    try {
      const { title, status } = req.body;
      const task = await storage.createTask({ projectId: req.params.projectId, title, status: status || 'pending' });
      res.json(task);
    } catch (error: any) {
      res.status(500).json({ message: 'Failed to create task' });
    }
  });

  app.patch('/api/tasks/:id', supabaseAuth, async (req: any, res: Response) => {
    try {
      const task = await storage.updateTask(req.params.id, req.body);
      res.json(task);
    } catch (error: any) {
      res.status(500).json({ message: 'Failed to update task' });
    }
  });

  app.delete('/api/tasks/:id', supabaseAuth, async (req: any, res: Response) => {
    try {
      await storage.deleteTask(req.params.id);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ message: 'Failed to delete task' });
    }
  });

  // ─── GLOBAL SEARCH ──────────────────────────────────────────────────────────

  app.get('/api/search', supabaseAuth, async (req: any, res: Response) => {
    try {
      const userId = req.userId;
      const query = (req.query.q as string)?.toLowerCase() || "";
      if (!query.trim()) {
        return res.json({ results: [] });
      }
      const results: any[] = [];
      // Search Chat History
      const chatSessions = await storage.getChatSessionsByUser(userId);
      const chatResults = chatSessions
        .filter(s => s.title.toLowerCase().includes(query) || s.summary?.toLowerCase().includes(query))
        .map(s => ({ type: 'chat', id: s.id, title: s.title, description: s.summary || 'No description', icon: 'MessageSquare', href: `/advanced-chat` }))
        .slice(0, 3);
      results.push(...chatResults);
      // Search Memory Entries
      const memoryEntries = await storage.getMemoryEntriesByUser(userId);
      const memoryResults = memoryEntries
        .filter(m => JSON.stringify(m.data).toLowerCase().includes(query))
        .map(m => ({ type: 'memory', id: m.id, title: `Memory: ${m.type}`, description: JSON.stringify(m.data).substring(0, 50), icon: 'Brain', href: `/memory` }))
        .slice(0, 3);
      results.push(...memoryResults);
      // Search Study Plans
      const studyPlans = await storage.getStudyPlansByUser(userId);
      const planResults = studyPlans
        .filter(p => p.title.toLowerCase().includes(query) || p.subjects.some((s: string) => s.toLowerCase().includes(query)))
        .map(p => ({ type: 'study_plan', id: p.id, title: p.title, description: `${p.subjects.join(", ")}`, icon: 'BookOpen', href: `/study-plans` }))
        .slice(0, 3);
      results.push(...planResults);
      // Search Exam Results
      const examResults = await storage.getExamResultsByUser(userId);
      const examResultsFiltered = examResults
        .filter(e => e.examName.toLowerCase().includes(query) || e.subject?.toLowerCase().includes(query))
        .map(e => ({ type: 'exam', id: e.id, title: e.examName, description: `${e.subject} - Score: ${e.score}`, icon: 'Monitor', href: `/cbt-mode` }))
        .slice(0, 3);
      results.push(...examResultsFiltered);
      // Search Generated Websites
      const websites = await storage.getGeneratedWebsitesByUser(userId);
      const websiteResults = websites
        .filter(w => w.title.toLowerCase().includes(query) || w.description?.toLowerCase().includes(query))
        .map(w => ({ type: 'website', id: w.id, title: w.title, description: w.description || w.prompt.substring(0, 50), icon: 'Code2', href: `/website-generator` }))
        .slice(0, 3);
      results.push(...websiteResults);
      // Search Generated Images
      const images = await storage.getGeneratedImagesByUser(userId);
      const imageResults = images
        .filter(i => i.prompt.toLowerCase().includes(query) || i.relatedTopic?.toLowerCase().includes(query))
        .map(i => ({ type: 'image', id: i.id, title: i.relatedTopic || 'Generated Image', description: i.prompt.substring(0, 50), icon: 'ImageIcon', imageUrl: i.imageUrl, href: `/image-gen` }))
        .slice(0, 3);
      results.push(...imageResults);
      // Search Projects
      const projects = await storage.getProjectsByUser(userId);
      const projectResults = projects
        .filter(p => p.name.toLowerCase().includes(query) || p.description?.toLowerCase().includes(query))
        .map(p => ({ type: 'project', id: p.id, title: p.name, description: p.description || 'No description', icon: 'FolderOpen', href: `/project-workspace` }))
        .slice(0, 3);
      results.push(...projectResults);
      // Search Generated Lessons
      const lessons = await storage.getGeneratedLessonsByUser(userId);
      const lessonResults = lessons
        .filter(l => l.title.toLowerCase().includes(query) || l.summary?.toLowerCase().includes(query))
        .map(l => ({ type: 'lesson', id: l.id, title: l.title, description: l.summary?.substring(0, 50) || '', icon: 'BookOpen', href: `/advanced-chat` }))
        .slice(0, 3);
      results.push(...lessonResults);
      const allResults = [...chatResults, ...memoryResults, ...planResults, ...examResultsFiltered, ...websiteResults, ...imageResults, ...projectResults, ...lessonResults].slice(0, 20);
      res.json({ results: allResults });
    } catch (error) {
      console.error("Error searching:", error);
      res.status(500).json({ message: "Search failed", results: [] });
    }
  });

  // ─── PRICING & PAYMENT ──────────────────────────────────────────────────────

  app.post('/api/payments/initialize', supabaseAuth, async (req: any, res: Response) => {
    try {
      const userId = req.userId;
      const { tierId } = req.body;
      const user = await storage.getUser(userId);
      if (!user?.email) {
        return res.status(400).json({ message: "User email not found" });
      }
      const reference = `sub_${generateId()}`;
      const tierPricing: { [key: string]: number } = { free: 0, pro: 5000, premium: 15000 };
      const priceNaira = tierPricing[tierId] || 5000;
      if (priceNaira === 0) {
        await storage.updateUser(userId, { subscriptionTier: "free" });
        return res.json({ success: true, message: "Free tier activated" });
      }
      const kobo = await convertNairaToKobo(priceNaira);
      const paystackResponse = await initializePayment(
        user.email,
        kobo,
        reference,
        { userId, tierId, email: user.email }
      );
      if (paystackResponse.status) {
        res.json({
          success: true,
          authorizationUrl: paystackResponse.data.authorization_url,
          reference: paystackResponse.data.reference,
        });
      } else {
        res.status(400).json({ message: "Payment initialization failed" });
      }
    } catch (error) {
      console.error("Payment initialization error:", error);
      res.status(500).json({ message: "Failed to initialize payment" });
    }
  });

  app.post('/api/payments/verify', supabaseAuth, async (req: any, res: Response) => {
    try {
      const { reference, tierId } = req.body;
      const userId = req.userId;
      const paystackResponse = await verifyPayment(reference);
      if (paystackResponse.status && paystackResponse.data?.status === "success") {
        const expiresAt = new Date();
        expiresAt.setMonth(expiresAt.getMonth() + 1);
        await storage.updateUser(userId, {
          subscriptionTier: tierId,
          subscriptionExpiresAt: expiresAt,
          paystackCustomerId: paystackResponse.data.customer.email,
        });
        res.json({ success: true, message: "Subscription activated" });
      } else {
        res.status(400).json({ message: "Payment verification failed" });
      }
    } catch (error) {
      console.error("Payment verification error:", error);
      res.status(500).json({ message: "Failed to verify payment" });
    }
  });

  // ─── PAYSTACK WEBHOOK ──────────────────────────────────────────────────────

  app.post('/api/webhooks/paystack', async (req: any, res: Response) => {
    try {
      const crypto = await import('crypto');
      const secret = process.env.PAYSTACK_SECRET_KEY;
      const signature = req.headers['x-paystack-signature'];
      if (!secret) {
        console.error("Paystack webhook received but PAYSTACK_SECRET_KEY is not set");
        return res.status(500).send("Not configured");
      }
      if (!req.rawBody) {
        logAdminError("paystack-webhook", "Missing rawBody — signature cannot be verified");
        return res.status(400).send("Bad request");
      }
      const expectedSignature = crypto
        .createHmac('sha512', secret)
        .update(req.rawBody)
        .digest('hex');
      if (expectedSignature !== signature) {
        logAdminError("paystack-webhook", `Signature mismatch — possible spoofed request from ${req.ip}`);
        return res.status(401).send("Invalid signature");
      }
      res.status(200).send("OK");
      const event = req.body;
      if (event.event === "charge.success") {
        const { userId, tierId } = event.data.metadata || {};
        if (!userId || !tierId) {
          logAdminError("paystack-webhook", `charge.success missing metadata: ${JSON.stringify(event.data.metadata)}`);
          return;
        }
        const expiresAt = new Date();
        expiresAt.setMonth(expiresAt.getMonth() + 1);
        await storage.updateUser(userId, {
          subscriptionTier: tierId,
          subscriptionExpiresAt: expiresAt,
          paystackCustomerId: event.data.customer?.email,
        } as any);
        const { dailyAdd } = getTierLimits(tierId);
        await getOrCreateCredits(userId, tierId);
        await addCredits(userId, dailyAdd, tierId);
        console.log(`✅ Paystack webhook: user ${userId} upgraded to ${tierId}, credits topped up`);
      } else if (event.event === "subscription.disable" || event.event === "subscription.not_renew") {
        const { userId } = event.data.metadata || event.data || {};
        if (userId) {
          await storage.updateUser(userId, { subscriptionTier: "free" } as any);
          console.log(`Paystack webhook: user ${userId} downgraded to free (${event.event})`);
        }
      }
    } catch (error) {
      logAdminError("paystack-webhook", error);
      if (!res.headersSent) res.status(500).send("Error");
    }
  });

  // ─── SUBSCRIPTION STATUS ───────────────────────────────────────────────────

  app.get('/api/subscription/status', supabaseAuth, async (req: any, res: Response) => {
    try {
      const userId = req.userId;
      const user = await storage.getUser(userId);
      res.json({
        tier: user?.subscriptionTier || 'free',
        expiresAt: user?.subscriptionExpiresAt,
        isActive: user?.subscriptionExpiresAt ? new Date(user.subscriptionExpiresAt) > new Date() : user?.subscriptionTier === 'free',
      });
    } catch (error) {
      res.status(500).json({ message: "Failed to get subscription status" });
    }
  });

  app.post('/api/subscription/cancel', supabaseAuth, async (req: any, res: Response) => {
    try {
      const userId = req.userId;
      await storage.updateUser(userId, { subscriptionTier: 'free', subscriptionExpiresAt: null });
      res.json({ success: true, message: "Subscription cancelled" });
    } catch (error) {
      res.status(500).json({ message: "Failed to cancel subscription" });
    }
  });

  app.post('/api/subscription/downgrade', supabaseAuth, async (req: any, res: Response) => {
    try {
      const userId = req.userId;
      const { targetTier } = req.body;
      const VALID_TIERS = ['free', 'pro', 'premium'];
      if (!VALID_TIERS.includes(targetTier)) {
        return res.status(400).json({ message: "Invalid target tier" });
      }
      const user = await storage.getUser(userId);
      const currentTier = user?.subscriptionTier || 'free';
      const tierRank: Record<string, number> = { free: 0, pro: 1, premium: 2 };
      if ((tierRank[targetTier] ?? 0) >= (tierRank[currentTier] ?? 0)) {
        return res.status(400).json({ message: "Use the upgrade flow to move to a higher tier" });
      }
      await storage.updateUser(userId, {
        subscriptionTier: targetTier,
        subscriptionExpiresAt: targetTier === 'free' ? null : user?.subscriptionExpiresAt,
      } as any);
      console.log(`📉 User ${userId} downgraded from ${currentTier} → ${targetTier}`);
      res.json({ success: true, tier: targetTier, message: `Downgraded to ${targetTier}` });
    } catch (error) {
      console.error("Downgrade error:", error);
      res.status(500).json({ message: "Failed to downgrade subscription" });
    }
  });

  // ─── CREDIT SYSTEM ──────────────────────────────────────────────────────────

  const ADMIN_EMAIL = REAL_ADMIN_EMAIL;

  app.get('/api/user/credits', supabaseAuth, async (req: any, res: Response) => {
    try {
      const userId = req.userId;
      const user = await storage.getUser(userId);
      const tier = user?.subscriptionTier || 'free';
      const credits = await getOrCreateCredits(userId, tier);
      const { maxBalance } = getTierLimits(tier);
      res.json({
        credits: credits.balance,
        used: credits.monthlyUsed,
        limit: maxBalance,
        tier,
        isAdmin: user?.email === ADMIN_EMAIL,
      });
    } catch {
      res.status(500).json({ message: "Failed to get credits" });
    }
  });

  app.get('/api/credits', supabaseAuth, async (req: any, res: Response) => {
    try {
      const userId = req.userId;
      const user = await storage.getUser(userId);
      const tier = user?.subscriptionTier || 'free';
      const credits = await getOrCreateCredits(userId, tier);
      const { dailyAdd, maxBalance } = getTierLimits(tier);
      res.json({
        balance: credits.balance,
        monthlyUsed: credits.monthlyUsed,
        maxMonthly: maxBalance,
        dailyLimit: dailyAdd,
        tier,
        isAdmin: user?.email === ADMIN_EMAIL,
        dailyGiven: credits.dailyGiven,
      });
    } catch (error) {
      res.status(500).json({ message: "Failed to get credits" });
    }
  });

  app.post('/api/credits/deduct', supabaseAuth, async (req: any, res: Response) => {
    try {
      const userId = req.userId;
      const { amount = 1 } = req.body;
      const user = await storage.getUser(userId);
      if (user?.email === ADMIN_EMAIL) {
        return res.json({ success: true, balance: 9999, message: "Admin: unlimited" });
      }
      const tier = user?.subscriptionTier || 'free';
      const credits = await getOrCreateCredits(userId, tier);
      if (credits.balance < amount) {
        return res.status(402).json({ error: "Insufficient credits", balance: credits.balance });
      }
      const newBalance = await deductCredits(userId, amount);
      res.json({ success: true, balance: newBalance ?? (credits.balance - amount) });
    } catch (error) {
      res.status(500).json({ message: "Failed to deduct credits" });
    }
  });

  app.post('/api/credits/topup', supabaseAuth, async (req: any, res: Response) => {
    try {
      const userId = req.userId;
      const user = await storage.getUser(userId);
      const { amount = 10 } = req.body;
      const nairaAmount = amount * 100;
      const paystackKey = process.env.PAYSTACK_SECRET_KEY;
      if (!paystackKey) return res.status(500).json({ error: "Payment not configured" });
      const response = await fetch('https://api.paystack.co/transaction/initialize', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${paystackKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: user?.email || 'unknown@lenory.ai',
          amount: nairaAmount * 100,
          metadata: { userId, creditAmount: amount, type: 'credit_topup' },
          callback_url: `${req.protocol}://${req.get('host')}/api/credits/topup/callback`,
        }),
      });
      const data = await response.json();
      if (data.data?.authorization_url) {
        res.json({ authorizationUrl: data.data.authorization_url, reference: data.data.reference });
      } else {
        res.status(500).json({ error: "Payment initialization failed" });
      }
    } catch (error) {
      res.status(500).json({ message: "Failed to initialize top-up" });
    }
  });

  app.get('/api/credits/topup/callback', async (req: Request, res: Response) => {
    try {
      const { reference } = req.query as { reference: string };
      const paystackKey = process.env.PAYSTACK_SECRET_KEY;
      const verifyRes = await fetch(`https://api.paystack.co/transaction/verify/${reference}`, {
        headers: { Authorization: `Bearer ${paystackKey}` },
      });
      const data = await verifyRes.json();
      if (data.data?.status === 'success') {
        const { userId, creditAmount } = data.data.metadata;
        const user = await storage.getUser(userId);
        const tier = (user as any)?.subscriptionTier || 'free';
        await getOrCreateCredits(userId, tier);
        await addCredits(userId, Number(creditAmount), tier, true);
        res.redirect('/dashboard?topup=success');
      } else {
        res.redirect('/pricing?topup=failed');
      }
    } catch (error) {
      res.redirect('/pricing?topup=error');
    }
  });

  // ─── ADMIN CREDIT ADJUSTMENTS ──────────────────────────────────────────────

  app.get('/api/admin/credits/:userId', supabaseAuth, async (req: any, res: Response) => {
    try {
      const adminUser = await storage.getUser(req.userId);
      if (adminUser?.email !== ADMIN_EMAIL) return res.status(403).json({ error: "Forbidden" });
      const { userId } = req.params;
      const targetUser = await storage.getUser(userId);
      const tier = (targetUser as any)?.subscriptionTier || 'free';
      const credits = await getOrCreateCredits(userId, tier);
      res.json({ balance: credits.balance, monthlyUsed: credits.monthlyUsed });
    } catch (error) {
      res.status(500).json({ message: "Failed to get credits" });
    }
  });

  app.post('/api/admin/credits/:userId/reset-daily', supabaseAuth, async (req: any, res: Response) => {
    try {
      const adminUser = await storage.getUser(req.userId);
      if (adminUser?.email !== ADMIN_EMAIL) return res.status(403).json({ error: "Forbidden" });
      const { userId } = req.params;
      const targetUser = await storage.getUser(userId);
      const tier = (targetUser as any)?.subscriptionTier || 'free';
      const result = await resetDailyCredits(userId, tier);
      if (!result) return res.status(500).json({ message: "Reset failed" });
      res.json({ success: true, newBalance: result.balance, tier });
    } catch (error) {
      res.status(500).json({ message: "Failed to reset daily credits" });
    }
  });

  app.post('/api/admin/credits/:userId/reset-monthly', supabaseAuth, async (req: any, res: Response) => {
    try {
      const adminUser = await storage.getUser(req.userId);
      if (adminUser?.email !== ADMIN_EMAIL) return res.status(403).json({ error: "Forbidden" });
      const { userId } = req.params;
      const targetUser = await storage.getUser(userId);
      const tier = (targetUser as any)?.subscriptionTier || 'free';
      const result = await resetMonthlyCredits(userId, tier);
      if (!result) return res.status(500).json({ message: "Reset failed" });
      res.json({ success: true, newBalance: result.balance, monthlyUsed: result.monthlyUsed, tier });
    } catch (error) {
      res.status(500).json({ message: "Failed to reset monthly credits" });
    }
  });

  app.post('/api/admin/credits/:userId', supabaseAuth, async (req: any, res: Response) => {
    try {
      const adminUser = await storage.getUser(req.userId);
      if (adminUser?.email !== ADMIN_EMAIL) return res.status(403).json({ error: "Forbidden" });
      const { userId } = req.params;
      const { amount, action } = req.body;
      const targetUser = await storage.getUser(userId);
      const tier = (targetUser as any)?.subscriptionTier || 'free';
      const credits = await getOrCreateCredits(userId, tier);
      let newBalance = credits.balance;
      if (action === 'set') {
        newBalance = Number(amount);
        await addCredits(userId, newBalance - credits.balance, tier, true);
      } else if (action === 'add') {
        await addCredits(userId, Number(amount), tier, true);
        newBalance = credits.balance + Number(amount);
      } else if (action === 'deduct') {
        const deducted = await deductCredits(userId, Math.min(Number(amount), credits.balance));
        newBalance = deducted ?? Math.max(0, credits.balance - Number(amount));
      }
      res.json({ success: true, balance: newBalance });
    } catch (error) {
      res.status(500).json({ message: "Failed to adjust credits" });
    }
  });

  // ─── GEMINI VISION ──────────────────────────────────────────────────────────

  app.post('/api/chat/analyze-vision', supabaseAuth, async (req: any, res: Response) => {
    try {
      const { base64, mimeType, fileName, prompt, sessionId } = req.body;
      if (!base64 || !mimeType) return res.status(400).json({ error: "Missing base64 or mimeType" });
      let noteContextInstruction = "";
      if (sessionId) {
        try {
          const session = await storage.getChatSession(sessionId);
          if (session?.summary?.startsWith("__NOTE_CONTEXT__")) {
            const noteContent = session.summary.substring("__NOTE_CONTEXT__".length);
            noteContextInstruction = `You are helping a student practise using their own uploaded notes. Answer using ONLY the note content below — if the note doesn't cover the question, say so clearly.\n\nSTUDENT'S NOTE:\n${noteContent}\n\n`;
          }
        } catch {}
      }
      const textInstruction = prompt
        ? `${noteContextInstruction}${prompt}`
        : `${noteContextInstruction}Extract and describe all content from this file. If it is an image, describe what you see in detail. If it is a document or PDF, extract the full text.`;
      const { GoogleGenAI } = await import('@google/genai');
      const geminiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '';
      if (!geminiKey) return res.status(500).json({ error: "Gemini API key not configured" });
      const ai = new GoogleGenAI({ apiKey: geminiKey });
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("GEMINI_TIMEOUT")), 25000)
      );
      const analysisPromise = ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: [{
          parts: [
            { inlineData: { mimeType: mimeType || "application/octet-stream", data: base64 } },
            { text: textInstruction },
          ],
        }] as any,
      });
      const response = await Promise.race([analysisPromise, timeoutPromise]);
      const analysis = (response as any).text || "I could not extract content from this file.";
      console.log(`✅ Vision analysis complete for ${fileName || 'file'} (${analysis.length} chars)`);
      res.json({ analysis });
    } catch (error: any) {
      const msg: string = error?.message || String(error);
      console.error("Vision analyze error:", msg);
      if (msg.includes("GEMINI_TIMEOUT")) {
        return res.status(408).json({ error: "File analysis timed out — try a smaller or simpler file.", detail: "TIMEOUT" });
      }
      res.status(500).json({ error: "Failed to analyze file", detail: msg });
    }
  });

  // ─── ASSEMBLYAI TOKEN ──────────────────────────────────────────────────────

  app.post('/api/assemblyai/token', supabaseAuth, async (req: any, res: Response) => {
    try {
      const apiKey = process.env.ASSEMBLYAI_API_KEY;
      if (!apiKey) return res.status(500).json({ error: "AssemblyAI not configured" });
      const response = await fetch('https://api.assemblyai.com/v2/realtime/token', {
        method: 'POST',
        headers: { authorization: apiKey, 'content-type': 'application/json' },
        body: JSON.stringify({ expires_in: 480 }),
      });
      if (!response.ok) {
        const text = await response.text();
        console.error('AssemblyAI token error:', text);
        return res.status(response.status).json({ error: 'Token request failed' });
      }
      const data = await response.json();
      res.json({ token: data.token });
    } catch (error) {
      console.error('AssemblyAI token error:', error);
      res.status(500).json({ error: "Token generation failed" });
    }
  });

  // ─── VOICE CREDIT TRACKING ─────────────────────────────────────────────────

  app.post('/api/voice/heartbeat', supabaseAuth, async (req: any, res: Response) => {
    try {
      const userId = req.userId;
      const user = await storage.getUser(userId);
      if (user?.email === ADMIN_EMAIL) {
        return res.json({ success: true, creditsDeducted: 0, newBalance: null, lowCredits: false });
      }
      const tier = (user as any)?.subscriptionTier || 'free';
      const CREDITS_PER_10S = Math.round(20 / 60 * 10);
      const credits = await getOrCreateCredits(userId, tier);
      if (credits.balance < CREDITS_PER_10S) {
        return res.status(402).json({
          error: "INSUFFICIENT_CREDITS",
          balance: credits.balance,
          message: "Not enough credits to continue — voice call will end.",
        });
      }
      const newBalance = await deductCredits(userId, CREDITS_PER_10S);
      const lowCredits = newBalance < 20;
      res.json({ success: true, creditsDeducted: CREDITS_PER_10S, newBalance, lowCredits });
    } catch (error) {
      res.status(500).json({ message: "Heartbeat failed" });
    }
  });

  app.post('/api/voice/end-call', supabaseAuth, async (req: any, res: Response) => {
    try {
      const userId = req.userId;
      const { durationSeconds = 0 } = req.body;
      const user = await storage.getUser(userId);
      const isAdmin = user?.email === ADMIN_EMAIL;
      if (isAdmin || durationSeconds <= 0) {
        return res.json({ success: true, creditsDeducted: 0, durationSeconds, minutes: 0 });
      }
      const minutes = Math.ceil(durationSeconds / 60);
      const creditsToDeduct = minutes * 20;
      const newBalance = await deductCredits(userId, creditsToDeduct);
      console.log(`🎙️ Voice call ended — user ${userId}, duration: ${durationSeconds}s (${minutes} min), deducted ${creditsToDeduct} credits, new balance: ${newBalance}`);
      res.json({ success: true, creditsDeducted: creditsToDeduct, durationSeconds, minutes, newBalance });
    } catch (error) {
      console.error("Voice end-call credit error:", error);
      res.status(500).json({ message: "Failed to process voice credits" });
    }
  });

  // ─── YARNGPT TTS ────────────────────────────────────────────────────────────

  app.post('/api/tts/yarngpt', supabaseAuth, async (req: any, res: Response) => {
    try {
      const { text, speaker = "idera" } = req.body;
      if (!text) return res.status(400).json({ error: "text is required" });
      const hfResponse = await fetch("https://olamilekan-yarngpt.hf.space/run/predict", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: [text.slice(0, 500), speaker] }),
        signal: AbortSignal.timeout(30000),
      });
      if (!hfResponse.ok) {
        const errText = await hfResponse.text().catch(() => "");
        console.warn(`YarnGPT failed (${hfResponse.status}): ${errText.slice(0, 200)}`);
        return res.status(502).json({ error: "YarnGPT TTS service unavailable" });
      }
      const data: any = await hfResponse.json();
      const audioData = data?.data?.[0];
      if (!audioData) return res.status(502).json({ error: "No audio data in YarnGPT response" });
      if (typeof audioData === "string" && audioData.startsWith("http")) {
        return res.json({ audioUrl: audioData });
      }
      if (audioData?.data) {
        return res.json({ audioBase64: audioData.data, mimeType: audioData.mime_type || "audio/wav" });
      }
      return res.json({ audioData });
    } catch (error: any) {
      console.error("YarnGPT TTS error:", error);
      res.status(500).json({ error: "TTS request failed" });
    }
  });

  // ─── ELEVENLABS TTS ─────────────────────────────────────────────────────────

  app.post('/api/elevenlabs/speech', supabaseAuth, async (req: any, res: Response) => {
    try {
      const apiKey = process.env.ELEVENLABS_API_KEY;
      if (!apiKey) return res.status(500).json({ error: "ElevenLabs not configured" });
      const { text, voiceId = 'pNInz6obpgDQGcFmaJgB' } = req.body;
      if (!text) return res.status(400).json({ error: "text is required" });
      const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
        method: 'POST',
        headers: {
          'xi-api-key': apiKey,
          'content-type': 'application/json',
          'accept': 'audio/mpeg',
        },
        body: JSON.stringify({
          text: text.slice(0, 500),
          model_id: 'eleven_monolingual_v1',
          voice_settings: { stability: 0.5, similarity_boost: 0.75 },
        }),
      });
      if (!response.ok) return res.status(500).json({ error: "TTS failed" });
      const buffer = await response.arrayBuffer();
      res.set('Content-Type', 'audio/mpeg');
      res.send(Buffer.from(buffer));
    } catch (error) {
      res.status(500).json({ error: "ElevenLabs error" });
    }
  });

  // ─── VIDEO GENERATION ──────────────────────────────────────────────────────

  app.post('/api/video/generate', supabaseAuth, async (req: any, res: Response) => {
    try {
      const replicateToken = process.env.REPLICATE_API_TOKEN || process.env['Replicate api'] || process.env['REPLICATE_API'];
      if (!replicateToken) return res.status(500).json({ error: "Video generation not configured on this server." });
      const userId = req.userId;
      const user = await storage.getUser(userId);
      if ((user as any)?.subscriptionTier !== 'premium' && user?.email !== ADMIN_EMAIL) {
        return res.status(403).json({ error: "Video generation is only available in Premium plan." });
      }
      const { prompt } = req.body;
      if (!prompt) return res.status(400).json({ error: "prompt is required" });
      if (user?.email !== ADMIN_EMAIL) {
        const tier = (user as any)?.subscriptionTier || 'free';
        const credits = await getOrCreateCredits(userId, tier);
        if (credits.balance < 5) {
          return res.status(402).json({ error: "Insufficient credits. Video generation costs 5 credits." });
        }
        await deductCredits(userId, 5);
      }
      let prediction: any;
      try {
        const createRes = await fetch('https://api.replicate.com/v1/models/anotherjesse/zeroscope-v2-xl/predictions', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${replicateToken}`,
            'Content-Type': 'application/json',
            Prefer: 'wait',
          },
          body: JSON.stringify({
            input: {
              prompt,
              num_frames: 24,
              fps: 8,
              width: 576,
              height: 320,
              num_inference_steps: 20,
            },
          }),
          signal: AbortSignal.timeout(55000),
        });
        prediction = await createRes.json();
      } catch (fetchErr) {
        logAdminError("/api/video/generate", fetchErr);
        return res.status(500).json({ error: "Video generation timed out. Try a shorter, simpler prompt, or try again." });
      }
      if (prediction.error) {
        logAdminError("/api/video/generate (replicate)", new Error(JSON.stringify(prediction.error)));
        return res.status(500).json({ error: typeof prediction.error === 'string' ? prediction.error : "Video generation failed on Replicate's side." });
      }
      logApiUsage("replicate-video", userId, "/api/video/generate");
      res.json({ id: prediction.id, status: prediction.status, output: prediction.output });
    } catch (error) {
      console.error('Video generation error:', error);
      logAdminError("/api/video/generate", error);
      res.status(500).json({ error: "Video generation failed" });
    }
  });

  app.get('/api/video/status/:id', supabaseAuth, async (req: any, res: Response) => {
    try {
      const replicateToken = process.env.REPLICATE_API_TOKEN || process.env['Replicate api'] || process.env['REPLICATE_API'];
      const { id } = req.params;
      const response = await fetch(`https://api.replicate.com/v1/predictions/${id}`, {
        headers: { Authorization: `Bearer ${replicateToken}` },
      });
      const data = await response.json();
      res.json({ status: data.status, output: data.output, error: data.error });
    } catch (error) {
      res.status(500).json({ error: "Status check failed" });
    }
  });

  // ─── GROQ WHISPER ──────────────────────────────────────────────────────────

  const groqUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 26 * 1024 * 1024 },
  });

  app.post('/api/groq/transcribe', supabaseAuth, groqUpload.single('audio'), async (req: any, res: Response) => {
    try {
      const apiKey = process.env.GROQ_API_KEY;
      if (!apiKey) return res.status(500).json({ error: "Speech-to-text is temporarily unavailable." });
      if (!req.file) return res.status(400).json({ error: "No audio file provided." });
      const { language = 'en' } = req.body;
      const tmpFile = path.join(os.tmpdir(), `groq_audio_${Date.now()}_${req.file.originalname || 'audio.webm'}`);
      fs.writeFileSync(tmpFile, req.file.buffer);
      let groqResData: any;
      try {
        const { default: OpenAI } = await import('openai');
        const groqClient = new OpenAI({
          apiKey,
          baseURL: 'https://api.groq.com/openai/v1',
        });
        const transcription = await groqClient.audio.transcriptions.create({
          file: fs.createReadStream(tmpFile) as any,
          model: 'whisper-large-v3-turbo',
          response_format: 'verbose_json',
          ...(language && language !== 'auto' ? { language } : {}),
        } as any);
        groqResData = transcription;
      } finally {
        try { fs.unlinkSync(tmpFile); } catch {}
      }
      const userId = req.userId;
      const user = await storage.getUser(userId);
      const data = groqResData as any;
      if (user?.email !== ADMIN_EMAIL && data.duration) {
        const minutes = Math.ceil(data.duration / 60 / 5);
        const tier = (user as any)?.subscriptionTier || 'free';
        const credits = await getOrCreateCredits(userId, tier);
        await deductCredits(userId, Math.min(minutes, credits.balance));
      }
      res.json({
        text: data.text || '',
        segments: (data.segments || []).map((s: any) => ({
          text: s.text,
          start: s.start,
          end: s.end,
          speaker: 'Speaker',
        })),
        language: data.language,
        duration: data.duration,
      });
    } catch (error: any) {
      console.error('Groq transcribe error:', error);
      res.status(500).json({ error: 'Transcription failed', detail: error?.message });
    }
  });

  // ─── WRITE MY NOTE ─────────────────────────────────────────────────────────

  app.post('/api/groq/format-notes', supabaseAuth, async (req: any, res: Response) => {
    try {
      const { transcript, subject } = req.body;
      if (!transcript) return res.status(400).json({ error: 'transcript required' });
      const prompt = `You are an expert note-taker. Convert this lecture/audio transcript into clear, well-structured study notes.
      ${subject ? `Subject: ${subject}` : ''}

      Transcript:
      """
      ${transcript.slice(0, 8000)}
      """

      Format as markdown with:
      - A clear title
      - Key objectives (bullet points)
      - Main content sections with headers
      - Key terms bolded
      - Summary at the end
      - Action items / things to study further`;
      const { chatWithGemini } = await import('./gemini');
      const notes = await chatWithGemini([{ role: 'user', content: prompt }]);
      res.json({ notes: notes || transcript });
    } catch (error) {
      console.error('Format notes error:', error);
      res.status(500).json({ error: 'Failed to format notes' });
    }
  });

  // ─── LOGOUT ─────────────────────────────────────────────────────────────────

  app.get('/api/logout', (req: Request, res: Response) => {
    res.redirect('/');
  });

  // ─── NEW: EXTERNAL INTEGRATIONS (Google Drive, Google Docs, GitHub) ──────
  // ─── These replace the old placeholders ───────────────────────────────────

  // ============================================================
  // 1. GOOGLE DRIVE / DOCS INTEGRATION
  // ============================================================

  // Unauthenticated diagnostic — no secrets exposed, just tells us if/what Render actually loaded
  app.get('/api/integrations/debug-config', async (req: Request, res: Response) => {
    const mask = (v: string) => v ? `${v.substring(0, 6)}...${v.substring(v.length - 4)} (${v.length} chars)` : "❌ NOT SET / EMPTY";
    res.json({
      GOOGLE_CLIENT_ID: mask(GOOGLE_CLIENT_ID),
      GOOGLE_REDIRECT_URI: GOOGLE_REDIRECT_URI || "❌ NOT SET (using localhost fallback)",
      GITHUB_CLIENT_ID: mask(GITHUB_CLIENT_ID),
      GITHUB_REDIRECT_URI: GITHUB_REDIRECT_URI || "❌ NOT SET (using localhost fallback)",
      note: "If GOOGLE_CLIENT_ID or GITHUB_CLIENT_ID show NOT SET, or the redirect URIs show the localhost fallback, Render is not passing those env vars to the running app.",
    });
  });

  app.get('/api/integrations/google-drive/auth', supabaseAuth, async (req: any, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: 'Unauthorized' });
      const authUrl = getGoogleAuthUrl(userId);
      res.json({ authUrl });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/integrations/google-drive/callback', async (req: Request, res: Response) => {
    const { code, state } = req.query;
    if (!code || !state) return res.status(400).send('Missing code or state');
    try {
      const tokenRes = await axios.post('https://oauth2.googleapis.com/token', {
        code,
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri: GOOGLE_REDIRECT_URI,
        grant_type: 'authorization_code',
      });
      const { access_token, refresh_token, expires_in } = tokenRes.data;
      await storage.saveIntegrationToken({
        id: `google_${Date.now()}`,
        userId: state as string,
        provider: 'google',
        accessToken: access_token,
        refreshToken: refresh_token,
        expiresAt: new Date(Date.now() + expires_in * 1000),
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      res.send(`
        <html>
          <body>
            <h2>✅ Google Drive connected!</h2>
            <p>You can close this window and return to LENORY.</p>
            <script>setTimeout(() => window.close(), 2000);</script>
          </body>
        </html>
      `);
    } catch (e: any) {
      res.status(500).send(`Error: ${e.message}`);
    }
  });

  app.get('/api/integrations/google-drive/status', supabaseAuth, async (req: any, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: 'Unauthorized' });
      const token = await storage.getIntegrationToken(userId, 'google');
      res.json({ connected: !!token });
    } catch (e: any) {
      res.json({ connected: false });
    }
  });

  app.get('/api/integrations/google-drive/files', supabaseAuth, async (req: any, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: 'Unauthorized' });
      const token = await storage.getIntegrationToken(userId, 'google');
      if (!token) return res.status(401).json({ error: 'Not connected to Google Drive' });
      const folderId = req.query.folderId || 'root';
      const query = `'${folderId}' in parents and trashed=false`;
      const driveRes = await axios.get(
        `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id,name,mimeType,webViewLink,webContentLink,size,createdTime,modifiedTime,parents,iconLink,thumbnailLink)&pageSize=100`,
        { headers: { Authorization: `Bearer ${token.accessToken}` } }
      );
      const files = driveRes.data.files.map((f: any) => ({
        ...f,
        isFolder: f.mimeType === 'application/vnd.google-apps.folder',
      }));
      res.json({ files });
    } catch (e: any) {
      console.error('Google Drive files error:', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/integrations/google-drive/import', supabaseAuth, async (req: any, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: 'Unauthorized' });
      const { fileId, fileName, mimeType, kbFolderId } = req.body;
      if (!fileId || !kbFolderId) return res.status(400).json({ error: 'fileId and kbFolderId are required' });
      const token = await storage.getIntegrationToken(userId, 'google');
      if (!token) return res.status(401).json({ error: 'Not connected to Google Drive' });

      let extractedText = '';
      const isTextLike = mimeType?.includes('text') || mimeType?.includes('json') || mimeType?.includes('csv') || mimeType?.includes('html');
      if (isTextLike) {
        const fileRes = await axios.get(
          `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
          { headers: { Authorization: `Bearer ${token.accessToken}` }, responseType: 'text' }
        );
        extractedText = typeof fileRes.data === 'string' ? fileRes.data : JSON.stringify(fileRes.data);
      }

      const kbFile = await storage.createKBFile({
        folder_id: kbFolderId,
        user_id: userId,
        name: fileName || 'Google Drive file',
        file_type: isTextLike ? 'text' : 'drive_file',
        source_type: 'google_drive',
        external_id: fileId,
        extracted_text: extractedText || null,
        mime_type: mimeType || null,
      });

      await storage.saveSyncedFile({
        id: `google_drive_${fileId}_${Date.now()}`,
        userId,
        sourceType: 'google_drive',
        externalId: fileId,
        externalParentId: kbFolderId,
        name: fileName || 'Google Drive file',
        type: 'file',
        mimeType: mimeType || null,
        content: extractedText || undefined,
        syncedAt: new Date(),
      });

      res.json({ file: kbFile, imported: true, extractedText: !!extractedText });
    } catch (e: any) {
      console.error('Google Drive import error:', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/integrations/google-docs/files', supabaseAuth, async (req: any, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: 'Unauthorized' });
      const token = await storage.getIntegrationToken(userId, 'google');
      if (!token) return res.status(401).json({ error: 'Not connected to Google Drive' });
      const folderId = req.query.folderId || 'root';
      const query = `mimeType='application/vnd.google-apps.document' and '${folderId}' in parents and trashed=false`;
      const driveRes = await axios.get(
        `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id,name,mimeType,webViewLink,size,createdTime,modifiedTime,parents,iconLink,thumbnailLink)&pageSize=100`,
        { headers: { Authorization: `Bearer ${token.accessToken}` } }
      );
      const files = driveRes.data.files.map((f: any) => ({
        ...f,
        isFolder: false,
        isDoc: true,
      }));
      res.json({ files });
    } catch (e: any) {
      console.error('Google Docs error:', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/integrations/google-docs/extract', supabaseAuth, async (req: any, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: 'Unauthorized' });
      const { fileId, folderId, kbFolderId } = req.body;
      if (!fileId) return res.status(400).json({ error: 'File ID required' });
      const token = await storage.getIntegrationToken(userId, 'google');
      if (!token) return res.status(401).json({ error: 'Not connected to Google Drive' });
      const docRes = await axios.get(
        `https://docs.googleapis.com/v1/documents/${fileId}`,
        { headers: { Authorization: `Bearer ${token.accessToken}` } }
      );
      let fullText = '';
      const doc = docRes.data;
      if (doc.body && doc.body.content) {
        for (const element of doc.body.content) {
          if (element.paragraph) {
            for (const paraElement of element.paragraph.elements || []) {
              if (paraElement.textRun) fullText += paraElement.textRun.content;
            }
          }
          if (element.table) {
            for (const row of element.table.tableRows || []) {
              for (const cell of row.tableCells || []) {
                for (const cellElement of cell.content || []) {
                  if (cellElement.paragraph) {
                    for (const paraElement of cellElement.paragraph.elements || []) {
                      if (paraElement.textRun) fullText += paraElement.textRun.content + ' ';
                    }
                  }
                }
              }
            }
          }
        }
      }
      await storage.saveSyncedFile({
        id: `google_doc_${fileId}_${Date.now()}`,
        userId,
        sourceType: 'google_docs',
        externalId: fileId,
        externalParentId: folderId || 'root',
        name: doc.title || 'Untitled',
        type: 'file',
        mimeType: 'application/vnd.google-apps.document',
        content: fullText,
        metadata: { docUrl: docRes.data.documentId },
        syncedAt: new Date(),
      });

      let kbFile = null;
      if (kbFolderId) {
        kbFile = await storage.createKBFile({
          folder_id: kbFolderId,
          user_id: userId,
          name: doc.title || 'Untitled Google Doc',
          file_type: 'text',
          source_type: 'google_docs',
          external_id: fileId,
          extracted_text: fullText,
          mime_type: 'application/vnd.google-apps.document',
        });
      }

      res.json({
        content: fullText,
        wordCount: fullText.split(/\s+/).filter(Boolean).length,
        title: doc.title,
        file: kbFile,
      });
    } catch (e: any) {
      console.error('Extract error:', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // ============================================================
  // 2. GITHUB INTEGRATION
  // ============================================================

  app.get('/api/integrations/github/auth', supabaseAuth, async (req: any, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: 'Unauthorized' });
      const authUrl = getGitHubAuthUrl(userId);
      res.json({ authUrl });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/integrations/github/callback', async (req: Request, res: Response) => {
    const { code, state } = req.query;
    if (!code || !state) return res.status(400).send('Missing code or state');
    try {
      const tokenRes = await axios.post(
        'https://github.com/login/oauth/access_token',
        {
          client_id: GITHUB_CLIENT_ID,
          client_secret: GITHUB_CLIENT_SECRET,
          code,
          redirect_uri: GITHUB_REDIRECT_URI,
        },
        { headers: { Accept: 'application/json' } }
      );
      const { access_token } = tokenRes.data;
      await storage.saveIntegrationToken({
        id: `github_${Date.now()}`,
        userId: state as string,
        provider: 'github',
        accessToken: access_token,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      res.send(`
        <html>
          <body>
            <h2>✅ GitHub connected!</h2>
            <p>You can close this window and return to LENORY.</p>
            <script>setTimeout(() => window.close(), 2000);</script>
          </body>
        </html>
      `);
    } catch (e: any) {
      res.status(500).send(`Error: ${e.message}`);
    }
  });

  app.get('/api/integrations/github/status', supabaseAuth, async (req: any, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: 'Unauthorized' });
      const token = await storage.getIntegrationToken(userId, 'github');
      res.json({ connected: !!token });
    } catch (e: any) {
      res.json({ connected: false });
    }
  });

  app.get('/api/integrations/github/repos', supabaseAuth, async (req: any, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: 'Unauthorized' });
      const token = await storage.getIntegrationToken(userId, 'github');
      if (!token) return res.status(401).json({ error: 'Not connected to GitHub' });
      const reposRes = await axios.get(
        'https://api.github.com/user/repos?sort=updated&per_page=100',
        { headers: { Authorization: `token ${token.accessToken}` } }
      );
      res.json({ repos: reposRes.data });
    } catch (e: any) {
      console.error('GitHub repos error:', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/integrations/github/repos/:repo/branches', supabaseAuth, async (req: any, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: 'Unauthorized' });
      const token = await storage.getIntegrationToken(userId, 'github');
      if (!token) return res.status(401).json({ error: 'Not connected to GitHub' });
      const { repo } = req.params;
      const owner = await getGitHubOwner(token);
      const branchesRes = await axios.get(
        `https://api.github.com/repos/${owner}/${repo}/branches`,
        { headers: { Authorization: `token ${token.accessToken}` } }
      );
      const branches = branchesRes.data.map((b: any) => b.name);
      res.json({ branches });
    } catch (e: any) {
      console.error('GitHub branches error:', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/integrations/github/repos/:repo/contents', supabaseAuth, async (req: any, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: 'Unauthorized' });
      const token = await storage.getIntegrationToken(userId, 'github');
      if (!token) return res.status(401).json({ error: 'Not connected to GitHub' });
      const { repo } = req.params;
      const branch = req.query.branch as string || 'main';
      const path = req.query.path as string || '';
      const owner = await getGitHubOwner(token);
      const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}?ref=${branch}`;
      try {
        const contentsRes = await axios.get(
          url,
          { headers: { Authorization: `token ${token.accessToken}` } }
        );
        let contents = contentsRes.data;
        if (!Array.isArray(contents)) contents = [contents];
        res.json({ contents });
      } catch (e: any) {
        if (e.response?.status === 404) {
          res.json({ contents: [] });
        } else {
          throw e;
        }
      }
    } catch (e: any) {
      console.error('GitHub contents error:', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/integrations/github/import', supabaseAuth, async (req: any, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: 'Unauthorized' });
      const user = await storage.getUser(userId);
      const tier = (user as any)?.subscriptionTier || 'free';
      if (tier !== 'pro' && tier !== 'premium' && user?.email !== REAL_ADMIN_EMAIL) {
        return res.status(403).json({ error: 'GitHub integration is a Premium feature' });
      }
      const { repoName, branch, path, kbFolderId } = req.body;
      if (!repoName || !path || !kbFolderId) return res.status(400).json({ error: 'repoName, path, and kbFolderId are required' });
      const token = await storage.getIntegrationToken(userId, 'github');
      if (!token) return res.status(401).json({ error: 'Not connected to GitHub' });

      const contentRes = await axios.get(
        `https://api.github.com/repos/${await getGitHubOwner(token)}/${repoName}/contents/${path}?ref=${branch || 'main'}`,
        { headers: { Authorization: `token ${token.accessToken}` } }
      );
      const data = contentRes.data;
      const decoded = data.encoding === 'base64' ? Buffer.from(data.content, 'base64').toString('utf-8') : data.content;
      const fileName = path.split('/').pop() || repoName;

      const kbFile = await storage.createKBFile({
        folder_id: kbFolderId,
        user_id: userId,
        name: fileName,
        file_type: 'code',
        source_type: 'github',
        external_id: `${repoName}:${path}`,
        extracted_text: decoded,
        file_size: data.size || decoded.length,
      });

      await storage.saveSyncedFile({
        id: `github_${repoName}_${Date.now()}`,
        userId,
        sourceType: 'github',
        externalId: `${repoName}:${path}`,
        externalParentId: kbFolderId,
        name: fileName,
        type: 'file',
        content: decoded,
        metadata: { repoName, branch, path },
        syncedAt: new Date(),
      });

      res.json({ file: kbFile, imported: true });
    } catch (e: any) {
      console.error('GitHub import error:', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  const SKIP_DIRS = ['node_modules', 'dist', 'build', '.git', 'vendor', '.next', 'coverage'];
  const TEXT_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.py', '.java', '.c', '.cpp', '.cs', '.go', '.rb', '.php',
    '.md', '.txt', '.json', '.yml', '.yaml', '.html', '.css', '.scss', '.sql', '.sh', '.env.example', '.gitignore'];
  const MAX_CLONE_FILES = 40;
  const MAX_FILE_BYTES = 60000;

  app.post('/api/integrations/github/clone-repo', supabaseAuth, async (req: any, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: 'Unauthorized' });
      const user = await storage.getUser(userId);
      const tier = (user as any)?.subscriptionTier || 'free';
      if (tier !== 'pro' && tier !== 'premium' && user?.email !== REAL_ADMIN_EMAIL) {
        return res.status(403).json({ error: 'GitHub integration is a Premium feature' });
      }
      const { repoName, branch, kbFolderId } = req.body;
      if (!repoName || !kbFolderId) return res.status(400).json({ error: 'repoName and kbFolderId are required' });
      const token = await storage.getIntegrationToken(userId, 'github');
      if (!token) return res.status(401).json({ error: 'Not connected to GitHub' });
      const owner = token.userLogin || (await axios.get('https://api.github.com/user', { headers: { Authorization: `token ${token.accessToken}` } })).data.login;

      const treeRes = await axios.get(
        `https://api.github.com/repos/${owner}/${repoName}/git/trees/${branch || 'main'}?recursive=1`,
        { headers: { Authorization: `token ${token.accessToken}` } }
      );
      const allFiles = (treeRes.data.tree || []).filter((item: any) =>
        item.type === 'blob' &&
        !SKIP_DIRS.some((d) => item.path.includes(`${d}/`)) &&
        TEXT_EXTENSIONS.some((ext) => item.path.endsWith(ext)) &&
        (item.size || 0) < MAX_FILE_BYTES
      ).slice(0, MAX_CLONE_FILES);

      let cloned = 0;
      const errors: string[] = [];
      for (const item of allFiles) {
        try {
          const blobRes = await axios.get(item.url, { headers: { Authorization: `token ${token.accessToken}` } });
          const content = blobRes.data.encoding === 'base64' ? Buffer.from(blobRes.data.content, 'base64').toString('utf-8') : blobRes.data.content;
          await storage.createKBFile({
            folder_id: kbFolderId, user_id: userId, name: item.path,
            file_type: 'code', source_type: 'github', external_id: `${repoName}:${item.path}`,
            extracted_text: content, file_size: item.size || content.length,
          });
          cloned++;
        } catch (e: any) {
          errors.push(item.path);
        }
      }

      res.json({
        cloned, totalFound: allFiles.length, skippedTooMany: (treeRes.data.tree || []).length > MAX_CLONE_FILES,
        errors: errors.length ? errors : undefined,
      });
    } catch (e: any) {
      console.error('GitHub clone-repo error:', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // ============================================================
  // 3. SYNC ENDPOINT (Common for all integrations)
  // ============================================================

  app.post('/api/integrations/sync', supabaseAuth, async (req: any, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: 'Unauthorized' });
      const { sourceType, folderId, repoId, repoName, branch } = req.body;
      await storage.saveSyncedFile({
        id: `sync_${Date.now()}`,
        userId,
        sourceType: sourceType || 'unknown',
        externalId: repoId || folderId || 'unknown',
        name: repoName || 'Synced Folder',
        type: 'folder',
        metadata: { branch, syncedAt: new Date() },
        syncedAt: new Date(),
      });
      res.json({
        success: true,
        message: `Sync started for ${sourceType}`,
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ============================================================
  // 4. LEARNING SYSTEM ENDPOINTS (Phase 3)
  // ============================================================

  app.get('/api/learn/path/:pathId', supabaseAuth, async (req: any, res: Response) => {
    const paths: Record<string, any> = {
      'html-basics': {
        id: 'html-basics',
        title: 'HTML Basics',
        steps: [
          { id: 'html-1', title: 'What is HTML?', description: 'Understand the purpose of HTML...', type: 'lesson', content: 'HTML (HyperText Markup Language) is the standard markup language...', is_completed: false, order: 1 },
          { id: 'html-2', title: 'Your First HTML Page', description: 'Write your first HTML document.', type: 'exercise', content: 'Create a basic HTML page...', code_snippet: '<!DOCTYPE html>\n<html>\n<head>\n  <title>My First Page</title>\n</head>\n<body>\n  \n</body>\n</html>', is_completed: false, order: 2 },
          { id: 'html-3', title: 'Common HTML Tags', description: 'Learn headings, paragraphs, lists...', type: 'lesson', content: 'HTML provides many tags...', is_completed: false, order: 3 },
          { id: 'html-4', title: 'Build a Simple Webpage', description: 'Combine everything you\'ve learned.', type: 'project', content: 'Build a personal profile page...', is_completed: false, order: 4 },
        ],
      },
      'css-basics': {
        id: 'css-basics',
        title: 'CSS Basics',
        steps: [
          { id: 'css-1', title: 'What is CSS?', description: 'Understand how CSS styles HTML elements.', type: 'lesson', content: 'CSS (Cascading Style Sheets) is used to style...', is_completed: false, order: 1 },
          { id: 'css-2', title: 'CSS Selectors & Properties', description: 'Learn how to target elements and apply styles.', type: 'lesson', content: 'CSS selectors allow you to target...', is_completed: false, order: 2 },
          { id: 'css-3', title: 'Styling Your HTML', description: 'Apply CSS to your HTML page.', type: 'exercise', content: 'Style your personal profile page...', is_completed: false, order: 3 },
        ],
      },
      'javascript-basics': {
        id: 'javascript-basics',
        title: 'JavaScript Basics',
        steps: [
          { id: 'js-1', title: 'What is JavaScript?', description: 'Understand the role of JavaScript.', type: 'lesson', content: 'JavaScript is a programming language...', is_completed: false, order: 1 },
          { id: 'js-2', title: 'Variables & Data Types', description: 'Learn how to store and manipulate data.', type: 'lesson', content: 'Variables are containers for storing data...', is_completed: false, order: 2 },
          { id: 'js-3', title: 'Functions & Events', description: 'Write functions and handle user interactions.', type: 'exercise', content: 'Add a button that changes the page color...', is_completed: false, order: 3 },
        ],
      },
      'full-stack': {
        id: 'full-stack',
        title: 'Full Stack Web Development',
        is_premium: true,
        steps: [
          { id: 'fs-1', title: 'Introduction to Full Stack', description: 'Understand the full stack architecture.', type: 'lesson', content: 'Full stack development involves both frontend and backend...', is_completed: false, order: 1 },
          { id: 'fs-2', title: 'Building the Frontend', description: 'Create a React application.', type: 'project', content: 'Build a todo list application with React.', is_completed: false, order: 2 },
          { id: 'fs-3', title: 'Building the Backend', description: 'Create a Node.js API.', type: 'project', content: 'Build a REST API for your todo list.', is_completed: false, order: 3 },
          { id: 'fs-4', title: 'Connecting Frontend to Backend', description: 'Connect your React app to your API.', type: 'project', content: 'Make API calls from your React app.', is_completed: false, order: 4 },
        ],
      },
    };
    const path = paths[req.params.pathId];
    if (!path) return res.status(404).json({ error: 'Path not found' });
    res.json(path);
  });

  app.get('/api/learn/progress', supabaseAuth, async (req: any, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: 'Unauthorized' });
      // TODO: fetch from storage
      res.json({});
    } catch (e: any) {
      res.json({});
    }
  });

  app.post('/api/learn/progress', supabaseAuth, async (req: any, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: 'Unauthorized' });
      const { pathId, stepId, completed } = req.body;
      // TODO: save to storage
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/learn/review', supabaseAuth, async (req: any, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: 'Unauthorized' });
      const { code, stepId } = req.body;
      // TODO: AI review with credits
      res.json({
        review: "✅ Your code looks good! Consider adding comments for clarity. Try using more descriptive variable names."
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/learn/hint', supabaseAuth, async (req: any, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: 'Unauthorized' });
      const { stepId } = req.body;
      res.json({
        hint: "💡 Start by creating a variable to store your data. Then use a loop to iterate over it."
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/learn/generate', supabaseAuth, async (req: any, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: 'Unauthorized' });
      const user = await storage.getUser(userId);
      if (user?.subscriptionTier !== 'premium' && user?.subscriptionTier !== 'pro' && user?.email !== REAL_ADMIN_EMAIL) {
        return res.status(403).json({ error: 'Premium feature' });
      }
      const { prompt, stepId } = req.body;
      // TODO: AI generation with credits
      res.json({
        code: `// Generated code for: ${prompt}\nconsole.log('Hello from AI!');`
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ─── RETURN HTTP SERVER ────────────────────────────────────────────────────

  return httpServer;
}

