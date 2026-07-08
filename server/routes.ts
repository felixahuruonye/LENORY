// WebSocket integration blueprint reference: javascript_websocket
// Gemini integration blueprint reference: javascript_gemini
import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import fs from "fs";
import os from "os";
import path from "path";
// @ts-ignore - multer types not available but package is installed
import multer from "multer";
import { ADMIN_EMAIL as REAL_ADMIN_EMAIL, getApiKeyStatus, logAdminError, getRecentErrors, getAdminOverview, buildAdminContextBlock, logApiUsage, getApiUsageSummary, getStabilityBalance, getModelUsageByTier } from "./adminTools";
import { getOrCreateCredits, deductCredits, addCredits, getTierLimits } from "./creditsStore";
import { storage } from "./storage";
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
import { registerImageRoutes } from "./replit_integrations/image";
import { handleGeminiLiveConnection, GEMINI_VOICES } from "./geminiLive";

export async function registerRoutes(app: Express): Promise<Server> {
  // Wire up Replit AI Integrations
  registerChatRoutes(app);
  registerImageRoutes(app);

  // Auth routes (using Supabase JWT authentication)
  app.get('/api/auth/user', supabaseAuth, async (req: any, res: Response) => {
    try {
      const userId = req.userId;
      const user = await storage.getUser(userId);
      // If user not in storage yet, return a minimal user object built from auth data
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

  // ─── Lenory Auth Routes ────────────────────────────────────────────────────

  // Helper: get Supabase admin client
  async function getSupabaseAdmin() {
    const { createClient } = await import('@supabase/supabase-js');
    const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '';
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
    if (!supabaseUrl || !supabaseServiceKey) return null;
    return createClient(supabaseUrl, supabaseServiceKey, { auth: { autoRefreshToken: false, persistSession: false } });
  }

  // Save device session + generate Lenory ID if missing (auth required)
  app.post('/api/auth/save-device', supabaseAuth, async (req: any, res: Response) => {
    try {
      const userId = req.userId;
      const userEmail = req.userEmail;
      const { deviceInfo } = req.body;

      const admin = await getSupabaseAdmin();
      if (!admin) return res.status(500).json({ message: 'Auth not configured' });

      // Get existing user metadata
      const { data: userData, error: userErr } = await admin.auth.admin.getUserById(userId);
      if (userErr || !userData?.user) return res.status(404).json({ message: 'User not found' });

      let lenoryId = userData.user.user_metadata?.lenory_id;
      let firstName = userData.user.user_metadata?.full_name?.split(' ')[0] ||
                      userData.user.user_metadata?.name?.split(' ')[0] ||
                      userData.user.user_metadata?.firstName || '';

      // Generate Lenory ID if not set
      if (!lenoryId) {
        lenoryId = generateLenoryId();
        await admin.auth.admin.updateUserById(userId, {
          user_metadata: { ...userData.user.user_metadata, lenory_id: lenoryId },
        });
      }

      // Create signed device token (no DB needed)
      const deviceToken = createDeviceToken({ userId, lenoryId, email: userEmail });

      res.json({ deviceToken, lenoryId, firstName });
    } catch (error) {
      console.error('Save device error:', error);
      res.status(500).json({ message: 'Failed to save device session' });
    }
  });

  // Verify device token (HMAC-signed JWT, no DB lookup needed)
  app.post('/api/auth/verify-device', async (req: Request, res: Response) => {
    try {
      const { deviceToken } = req.body;
      if (!deviceToken) return res.json({ valid: false });

      const payload = verifyDeviceToken(deviceToken);
      if (!payload) return res.json({ valid: false });

      // Get user details from Supabase to verify account still exists + get fresh name
      const admin = await getSupabaseAdmin();
      if (!admin) return res.json({ valid: false });

      const { data: userData, error } = await admin.auth.admin.getUserById(payload.userId);
      if (error || !userData?.user) return res.json({ valid: false });

      const user = userData.user;
      const lenoryId = user.user_metadata?.lenory_id || payload.lenoryId;
      const firstName = user.user_metadata?.full_name?.split(' ')[0] ||
                        user.user_metadata?.name?.split(' ')[0] ||
                        user.user_metadata?.firstName || '';

      res.json({
        valid: true,
        userId: payload.userId,
        email: user.email,
        lenoryId,
        firstName,
      });
    } catch (error) {
      res.json({ valid: false });
    }
  });

  // Lenory ID lookup - returns masked email (Supabase admin search)
  app.get('/api/auth/lernory-lookup/:lenoryId', async (req: Request, res: Response) => {
    try {
      const { lenoryId } = req.params;
      const admin = await getSupabaseAdmin();
      if (!admin) return res.status(500).json({ found: false });

      // Search users by metadata lenory_id - paginate through users
      let page = 1;
      const perPage = 1000;
      let found = false;
      let maskedEmail = '';
      let firstName = '';

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

  // Lenory ID server-side login (keeps email private, uses Supabase admin search)
  app.post('/api/auth/lernory-login', async (req: Request, res: Response) => {
    try {
      const { lenoryId, password } = req.body;
      if (!lenoryId || !password) return res.status(400).json({ message: 'Lenory ID and password required' });

      const admin = await getSupabaseAdmin();
      if (!admin) return res.status(500).json({ message: 'Auth not configured' });

      // Find user by lenory_id in metadata
      let foundEmail: string | null = null;
      let foundFirstName = '';
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

      // Authenticate via Supabase with anon key
      const { createClient } = await import('@supabase/supabase-js');
      const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '';
      const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';
      if (!supabaseAnonKey) return res.status(500).json({ message: 'Auth not configured' });

      const anonClient = createClient(supabaseUrl, supabaseAnonKey);
      const { data, error } = await anonClient.auth.signInWithPassword({ email: foundEmail, password });
      if (error) return res.status(401).json({ message: 'Incorrect password' });

      res.json({
        accessToken: data.session?.access_token,
        refreshToken: data.session?.refresh_token,
        firstName: foundFirstName,
      });
    } catch (error) {
      console.error('Lenory login error:', error);
      res.status(500).json({ message: 'Login failed' });
    }
  });

  // Remove device session (clear from client - token is self-contained)
  app.delete('/api/auth/device', supabaseAuth, async (req: any, res: Response) => {
    res.json({ success: true });
  });

  // Vapi public key endpoint
  app.get('/api/vapi-config', supabaseAuth, (req: Request, res: Response) => {
    try {
      const publicKey = process.env.VAPI_PUBLIC_KEY;
      if (!publicKey) {
        return res.status(500).json({ message: "Vapi not configured" });
      }
      res.json({ publicKey });
    } catch (error) {
      console.error("Error fetching Vapi config:", error);
      res.status(500).json({ message: "Failed to fetch Vapi config" });
    }
  });

  // Chat routes
  app.get('/api/chat/messages', supabaseAuth, async (req: any, res: Response) => {
    try {
      const userId = req.userId;
      const sessionId = req.query.sessionId as string;
      
      if (sessionId) {
        // Verify session belongs to this user before returning messages
        const session = await storage.getChatSession(sessionId);
        if (!session || session.userId !== userId) {
          return res.status(403).json({ message: "Unauthorized" });
        }
        const messages = await storage.getChatMessagesBySession(sessionId);
        res.json(messages);
      } else {
        const messages = await storage.getChatMessagesByUser(userId);
        res.json(messages);
      }
    } catch (error) {
      console.error("Error fetching messages:", error);
      res.status(500).json({ message: "Failed to fetch messages" });
    }
  });

  // Save message to permanent transcript (used for greetings and system messages)
  app.post('/api/chat/save-message', supabaseAuth, async (req: any, res: Response) => {
    try {
      const userId = req.userId;
      const { sessionId, role, content } = req.body;

      if (!sessionId) {
        return res.status(400).json({ message: "Session ID is required" });
      }

      if (!content?.trim()) {
        return res.status(400).json({ message: "Message content is required" });
      }

      // Verify session exists and belongs to user
      const session = await storage.getChatSession(sessionId);
      if (!session || session.userId !== userId) {
        return res.status(403).json({ message: "Unauthorized" });
      }

      // Save message to database
      const message = await storage.createChatMessage({
        userId,
        sessionId,
        role: role || "assistant",
        content,
        attachments: null,
      });

      // Learn from user messages (not assistant responses)
      if (role === "user") {
        const learned = await learnFromUserMessage(content);
        if (Object.keys(learned).length > 0) {
          await storage.createMemoryEntry({
            userId,
            type: "auto_learned",
            data: { learned, timestamp: new Date().toISOString() },
          });
        }
      }

      console.log(`✓ Message saved to transcript: ${role} - ${content.substring(0, 50)}`);
      res.json(message);
    } catch (error) {
      console.error("Error saving message:", error);
      res.status(500).json({ message: "Failed to save message" });
    }
  });

  app.post('/api/chat/send', supabaseAuth, async (req: any, res: Response) => {
    try {
      const userId = req.userId;
      let { content, sessionId, includeUserContext, context: extraContext, isAdvanced, overrideResponse, isLongPaste } = req.body;

      if (!content?.trim()) {
        return res.status(400).json({ message: "Message content is required" });
      }

      console.log("Received message:", content.substring(0, 50));

      // Get user info for personalization
      const user = await storage.getUser(userId);
      const userName = user?.firstName || "Friend";

      // ── CREDIT CHECK (1 credit per chat message, +12 for long-paste-as-file) ──
      if (user?.email !== ADMIN_EMAIL) {
        const tier = (user as any)?.subscriptionTier || 'free';
        const totalCost = 1 + (isLongPaste ? 12 : 0);
        const credits = await getOrCreateCredits(userId, tier);
        if (credits.balance < totalCost) {
          return res.status(402).json({
            message: isLongPaste
              ? "That long paste needs 13 credits to process (1 + 12 for the attachment) and your balance is too low."
              : "You've run out of credits. You earn 10 free credits each day, or top up for more.",
            error: "INSUFFICIENT_CREDITS",
            balance: credits.balance,
          });
        }
        await deductCredits(userId, totalCost);
      }
      // ──────────────────────────────────────────────────────────────────────

      // Verify session exists if provided, otherwise create a new one
      let currentSession: any = null;
      if (sessionId) {
        currentSession = await storage.getChatSession(sessionId);
        if (!currentSession) {
          console.warn("Session not found, creating new session");
          const newSession = await storage.createChatSession({ userId, title: "New Chat", mode: "chat", summary: "" });
          sessionId = newSession.id;
          currentSession = newSession;
          
          // Send notification for new chat
          try {
            await storage.createNotification({
              userId,
              type: "chat",
              title: "New Chat Started",
              message: `You started a new chat session`,
              icon: "💬",
              actionUrl: `/chat?sessionId=${sessionId}`,
              read: false,
            });
          } catch (err) {
            console.log("Notification skipped");
          }
        }
      }

      // Save user message
      await storage.createChatMessage({
        userId,
        sessionId: sessionId || null,
        role: "user",
        content,
        attachments: null,
      });

      // Get FULL conversation history across ALL sessions for context
      // This allows the AI to remember everything the user has studied and asked about
      const allUserMessages = await storage.getChatMessagesByUser(userId, 500);
      
      // Get current session messages to prioritize recent context
      const currentSessionMessages = sessionId 
        ? await storage.getChatMessagesBySession(sessionId)
        : [];
      
      // Smart memory strategy:
      // 1. Use current session messages as main conversation (prevents greeting loops)
      // 2. Extract key learning topics from OTHER previous sessions
      const otherMessages = allUserMessages.filter(m => !currentSessionMessages.find(sm => sm.id === m.id));
      
      // Build conversation history: ONLY use current session messages
      // DO NOT mix with other sessions - this causes the AI to respond to old patterns instead of current questions
      const history = [
        ...currentSessionMessages
      ];
      
      // Get user memory/progress for context
      const userProgress = await storage.getUserProgressByUser(userId);
      const examResults = await storage.getExamResultsByUser(userId);
      const userMemories = await storage.getMemoryEntriesByUser(userId);
      
      // Extract comprehensive learning history from past sessions
      const extractCrossSesssionMemory = () => {
        const pastUserQuestions = otherMessages
          .filter(m => m.role === "user")
          .map(m => m.content)
          .slice(0, 20); // Get up to 20 past questions
        
        if (pastUserQuestions.length === 0) return "";
        
        // Group questions by length (longer = more specific topics)
        const importantTopics = pastUserQuestions
          .filter(q => q.length > 30 && q.length < 500)
          .slice(0, 10);
        
        if (importantTopics.length === 0) return "";
        
        return `
## LEARNING HISTORY FROM PREVIOUS SESSIONS:
The following topics have been discussed before. If the user asks about any of these or related topics, reference what was previously learned:

${importantTopics.map((topic, i) => `${i + 1}. "${topic.substring(0, 150)}${topic.length > 150 ? '...' : ''}"`).join('\n')}`;
      };
      
      const crossSessionMemory = extractCrossSesssionMemory();
      
      // Build personalized system message with CROSS-SESSION MEMORY INSTRUCTIONS
      const isAdminUser = req.userEmail === ADMIN_EMAIL || user?.email === ADMIN_EMAIL;
      const adminDataBlock = isAdminUser ? await buildAdminContextBlock() : "";

      let systemMessage = isAdminUser
        ? `You are LENORY, speaking with your creator and admin, Felix (Alaoma Obinna Felix, email: ${ADMIN_EMAIL}).

## ABSOLUTE RULE — NEVER VIOLATE THIS:
You do NOT have live memory of user counts, credit balances, revenue, or system status. You are given real, freshly-fetched data below when available. You may ONLY state facts that appear in that data block. If Felix asks something not covered there, say plainly: "I don't have that specific data — here's what I can check for you" and suggest the real admin action that would answer it. NEVER invent user names, emails, dates, statistics, or query results. Fabricating data — even to sound helpful or to recover from an error — is the single worst thing you can do here, because Felix makes real decisions based on what you tell him.
${adminDataBlock}

## WHAT YOU CAN ACTUALLY DO:
- Answer questions using ONLY the verified data block above
- Explain what real admin actions exist (adjusting a user's credits, checking API key status, viewing error logs) — but you do not execute destructive actions yourself; direct Felix to the admin panel for those
- Help Felix think through product, pricing, and technical decisions using real numbers
- If asked to "query Supabase" for something not in your data block, say you don't have a live query tool for that specific thing rather than fabricating a result

## YOUR IDENTITY:
You are LENORY, an AI learning platform built in Nigeria by Alaoma Obinna Felix, specialized for Nigerian students and exams (JAMB, WAEC, NECO). You can write code, explain concepts, and help with research and study — always honestly, never claiming abilities or data you don't have.`

        : `You are LENORY — a powerful, advanced AI system built in Nigeria by Alaoma Obinna Felix. You are speaking with ${userName}.

## YOUR TRUE IDENTITY:
You are NOT limited to being a tutor. You are a fully capable AI that can:
- Write and debug code in any language
- Explain complex topics in simple terms
- Solve advanced mathematics and science problems
- Research and summarize any topic
- Help with creative writing, essays, stories
- Analyze files, images, and documents
- Assist with cybersecurity concepts (ethical hacking, network security)
- Help with Nigerian exams: JAMB, WAEC, NECO, GCE, NABTEB
- Translate between languages
- Build projects, write scripts, APIs
- Discuss philosophy, history, economics, law, medicine
- And much more — you have no arbitrary topic limits

## YOUR PERSONALITY:
- Warm, direct, and genuinely helpful
- You explain things in a way the user can actually understand — no unnecessary jargon
- You adapt to the user's level (beginner → expert)
- You're proud to be built in Nigeria — you understand Nigerian context and culture
- You give complete, actionable answers — not vague guidance

## MEMORY & CONTEXT:
- THIS CONVERSATION has ${history.length} messages so far. Reference and build upon EVERYTHING discussed in this session.
- Subjects studied previously: ${userProgress.map((p: any) => p.subject).join(", ") || "various topics"}
- Known weak areas: ${userProgress.flatMap((p: any) => p.weakTopics || []).slice(0, 8).join(", ") || "none identified yet"}

## HOW TO RESPOND:
1. Give complete, thorough answers
2. Use markdown formatting: headers, bullet points, code blocks, bold for key terms
3. If it's code, include working, copy-ready code with explanations
4. If it's a math problem, show all steps clearly
5. If it's a concept, give real examples the user can relate to
6. Never say "I cannot help with that" unless it violates serious ethical boundaries
7. Build on previous messages in this conversation — don't repeat yourself`;
      
      if (crossSessionMemory) {
        systemMessage += crossSessionMemory;
      }
      
      if (examResults.length > 0) {
        const lastExam = examResults[0];
        systemMessage += `\n\n## Recent Performance:
- Last exam: ${lastExam.examName} (${lastExam.score}%)
- Focus on weak areas identified in exams`;
      }

      if (extraContext) {
        systemMessage += `\n\n## ADDITIONAL CONTEXT:\n${extraContext}`;
      }

      // If this session is grounded in an uploaded note, keep re-injecting that note's
      // content on every turn so answers (including photos of questions) stay based on it.
      const noteContextMarker = "__NOTE_CONTEXT__";
      if (currentSession?.summary?.startsWith(noteContextMarker)) {
        const noteText = currentSession.summary.substring(noteContextMarker.length);
        systemMessage += `\n\n## THE STUDENT'S UPLOADED NOTE (answer strictly based on this, do not use outside knowledge unless the note doesn't cover it — say so if it doesn't):\n${noteText}`;
      }

      // SECURITY FIX: never trust the client's isAdvanced flag directly — a free
      // user could send isAdvanced:true and get the pricier model for free.
      // Advanced mode is now only honored if the user's real, server-verified
      // tier actually allows it.
      const realUserTier = (user as any)?.subscriptionTier || 'free';
      const canUseAdvanced = realUserTier === 'pro' || realUserTier === 'premium' || user?.email === ADMIN_EMAIL;
      isAdvanced = !!isAdvanced && canUseAdvanced;

      if (isAdvanced) {
        systemMessage += `\n\n## ADVANCED MODE:\nYou are acting as a Technical/Project Specialist. Provide deep analysis, accurate solutions, and help with complex technical tasks.`;
      }
      
      systemMessage += `\n\nYour PRIMARY goal: Answer the current question thoroughly while remembering EVERYTHING from this session AND relevant learning from previous sessions.`;
      
      const messages = [
        { role: "system" as const, content: systemMessage },
        ...history.map(msg => ({
          role: msg.role as "user" | "assistant",
          content: msg.content
        }))
      ];

      console.log("Getting AI response with", messages.length, "messages (including user context)");
      
      // Enhanced memory logging showing cross-session context
      const crossSessionTopics = otherMessages
        .filter(m => m.role === "user")
        .map(m => m.content.substring(0, 80))
        .slice(0, 8);
      
      console.log("🧠 CROSS-SESSION MEMORY SYSTEM:", {
        "Session ID": sessionId,
        "Current session messages": history.length,
        "User": userName,
        "All previous questions available": otherMessages.filter(m => m.role === "user").length,
        "Subjects previously studied": userProgress.map((p: any) => p.subject).join(", ") || "None yet",
        "Topics covered in previous sessions": userProgress.flatMap((p: any) => p.topicsStudied || []).slice(0, 8).join(", ") || "None",
        "Identified weak areas across all sessions": userProgress.flatMap((p: any) => p.weakTopics || []).join(", ") || "None identified",
        "AI will reference": crossSessionTopics.length > 0 ? "✓ Past questions from other sessions" : "Only current session"
      });

      // If overrideResponse is provided, skip AI and use it directly (e.g. for video generation)
      let aiResponse: string;
      if (overrideResponse) {
        aiResponse = overrideResponse;
      } else if (isAdvanced) {
        // Advanced mode: DeepSeek Coder via OpenRouter for deep technical responses
        try {
          const openRouterKey = process.env.OPENROUTER_API_KEY;
          if (openRouterKey) {
            const orRes = await fetch("https://openrouter.ai/api/v1/chat/completions", {
              method: "POST",
              headers: {
                "Authorization": `Bearer ${openRouterKey}`,
                "Content-Type": "application/json",
                "HTTP-Referer": "https://lenory.app",
                "X-Title": "LENORY AI",
              },
              body: JSON.stringify({
                model: "deepseek/deepseek-coder",
                messages: messages.map((m: any) => ({ role: m.role, content: m.content })),
                temperature: 0.3,
                max_tokens: 4096,
              }),
            });
            if (orRes.ok) {
              const orData = await orRes.json();
              aiResponse = orData.choices?.[0]?.message?.content || "";
              if (!aiResponse.trim()) throw new Error("Empty DeepSeek response");
              console.log("✓ Advanced mode: DeepSeek Coder responded");
            } else {
              throw new Error(`OpenRouter error: ${orRes.status}`);
            }
          } else {
            throw new Error("No OPENROUTER_API_KEY");
          }
        } catch (deepseekErr) {
          console.error("DeepSeek fallback:", deepseekErr);
          aiResponse = await chatWithAISmartFallback(messages as any);
        }
      } else {
        // Get AI response with smart fallback (Gemini → OpenRouter → OpenAI)
        try {
          aiResponse = await chatWithAISmartFallback(messages as any);
          console.log("Got AI response:", aiResponse.substring(0, 150));
          if (!aiResponse || aiResponse.trim() === "") {
            console.warn("Empty AI response!");
            aiResponse = "I received your message but had trouble formulating a response. Please try again.";
          }
        } catch (aiError) {
          console.error("AI API error:", aiError);
          aiResponse = "I'm having trouble connecting to my AI services right now. Please try again in a moment.";
        }
      }

      // Auto-save to memory for AI learning
      try {
        await storage.createMemoryEntry({
          userId,
          type: "chat_interaction",
          data: {
            userMessage: content.substring(0, 500),
            aiResponse: aiResponse.substring(0, 500),
            timestamp: new Date().toISOString(),
          }
        });
        console.log("✓ Memory auto-updated from chat interaction");
      } catch (memErr) {
        console.log("Memory auto-save skipped (non-critical)");
      }

      // Check if user asked for image explanation
      // FIX: Don't add LENORY branding to generated images - just return the response
      const imageKeywords = ["explain with image", "show me", "visualize", "draw", "illustrate", "with image", "with a picture", "with diagram"];
      const shouldGenerateImage = imageKeywords.some(keyword => content.toLowerCase().includes(keyword));
      
      let attachments: any = null;
      if (shouldGenerateImage) {
        try {
          console.log("🎨 Generating image for chat response...");
          const imagePrompt = `Create a visual representation for: ${aiResponse.substring(0, 200)}`;
          const image = await generateImageWithLENORY(imagePrompt);
          
          // Store generated image - NO LENORY BRANDING ADDED
          await storage.createGeneratedImage({
            userId,
            prompt: imagePrompt,
            imageUrl: image.url,
            relatedTopic: content.substring(0, 100)
          });
          
          attachments = {
            images: [
              {
                url: image.url,
                title: "Visual Explanation"
              }
            ]
          };
          console.log("✅ Image generated successfully (no branding added to image)");
        } catch (imgErr) {
          console.error("Image generation skipped:", imgErr);
        }
      }
      
      // Save AI response
      await storage.createChatMessage({
        userId,
        sessionId: sessionId || null,
        role: "assistant",
        content: aiResponse,
        attachments,
      });

      // AUTO-LEARNING: Analyze message and automatically update user profile
      if (req.body.autoLearn) {
        try {
          const { analyzeMessageForLearning } = await import("./tutorSystem");
          await analyzeMessageForLearning(userId, content, aiResponse);
          console.log("✓ Auto-learning: User profile updated from conversation");
        } catch (err) {
          console.error("Error in auto-learning:", err);
          // Don't fail the response if analysis fails
        }
      }

      // Generate smart title after both messages for better context
      if (sessionId) {
        try {
          const session = await storage.getChatSession(sessionId);
          if (session && (session.title === "New Chat" || session.title.startsWith("Chat "))) {
            const updatedHistory = await storage.getChatMessagesBySession(sessionId);
            const conversationMessages = updatedHistory.map(msg => ({
              role: msg.role,
              content: msg.content
            }));
            
            const smartTitle = await generateSmartChatTitle(conversationMessages);
            await storage.updateChatSession(sessionId, { title: smartTitle });
            console.log("Updated chat session title to:", smartTitle);
          }
        } catch (titleError) {
          console.error("Error generating smart title:", titleError);
        }
      }

      // CRITICAL FIX: Don't add LENORY branding to the AI response itself
      // The response should be pure - branding stays in UI, not in generated content
      // This prevents AI from overwriting user's requested branding on websites, images, PDFs
      logApiUsage(isAdvanced ? "openrouter-deepseek" : "gemini", userId, "/api/chat/send");
      res.json({ 
        success: true, 
        message: aiResponse  // Plain response - NO branding injection
      });
    } catch (error) {
      console.error("Error sending message:", error);
      logAdminError("/api/chat/send", error);
      const errorMsg = error instanceof Error ? error.message : String(error);
      res.status(500).json({ message: errorMsg.includes("Empty response") ? "LENORY had trouble with that message — it may be too long or complex. Try breaking it into smaller parts." : "Failed to send message. Please try again." });
    }
  });

  // Clear all chat messages for user
  app.post('/api/chat/clear', supabaseAuth, async (req: any, res: Response) => {
    try {
      const userId = req.userId;
      await storage.deleteChatMessagesByUser(userId);
      res.json({ message: "Chat cleared successfully" });
    } catch (error) {
      console.error("Error clearing chat:", error);
      res.status(500).json({ message: "Failed to clear chat" });
    }
  });

  // Memory export/backup routes
  app.get('/api/memory/export', supabaseAuth, async (req: any, res: Response) => {
    try {
      const userId = req.userId;
      const messages = await storage.getChatMessagesByUser(userId);
      const memories = await storage.getMemoryEntriesByUser(userId);
      
      const exportData = {
        exported: new Date().toISOString(),
        user: userId,
        messages: messages.length,
        memories: memories.length,
        data: { messages, memories }
      };
      
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', 'attachment; filename=memory-export.json');
      res.json(exportData);
    } catch (error) {
      res.status(500).json({ message: "Export failed" });
    }
  });

  app.post('/api/memory/backup', supabaseAuth, async (req: any, res: Response) => {
    try {
      const userId = req.userId;
      const messages = await storage.getChatMessagesByUser(userId);
      const backup = {
        backupId: `backup_${Date.now()}`,
        userId,
        timestamp: new Date().toISOString(),
        messageCount: messages.length
      };
      res.json({ success: true, backup });
    } catch (error) {
      res.status(500).json({ message: "Backup failed" });
    }
  });

  app.delete('/api/memory/clear', supabaseAuth, async (req: any, res: Response) => {
    try {
      const userId = req.userId;
      await storage.deleteChatMessagesByUser(userId);
      res.json({ success: true, message: "Memory cleared" });
    } catch (error) {
      res.status(500).json({ message: "Clear failed" });
    }
  });

  // Admin routes
  // Supabase SQL schema for table creation — open to all authenticated users
  app.get('/api/admin/db-schema', supabaseAuth, async (_req: any, res: Response) => {
    const sql = `-- Run this SQL in your Supabase SQL Editor to enable full data persistence
-- Project URL: https://nfudflrajpmluhwwhhrc.supabase.co

CREATE TABLE IF NOT EXISTS public.chat_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT 'New Chat',
  mode TEXT NOT NULL DEFAULT 'chat',
  summary TEXT DEFAULT '',
  message_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS chat_sessions_user_id_idx ON public.chat_sessions(user_id);

CREATE TABLE IF NOT EXISTS public.chat_messages (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  session_id TEXT REFERENCES public.chat_sessions(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  attachments JSONB DEFAULT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS chat_messages_user_id_idx ON public.chat_messages(user_id);
CREATE INDEX IF NOT EXISTS chat_messages_session_id_idx ON public.chat_messages(session_id);

CREATE TABLE IF NOT EXISTS public.memory_entries (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  type TEXT NOT NULL DEFAULT 'note',
  subject TEXT DEFAULT NULL,
  content TEXT NOT NULL,
  importance INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS memory_entries_user_id_idx ON public.memory_entries(user_id);

CREATE TABLE IF NOT EXISTS public.generated_lessons (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  recording_id TEXT DEFAULT NULL,
  title TEXT NOT NULL,
  objectives JSONB NOT NULL DEFAULT '[]',
  key_points JSONB NOT NULL DEFAULT '[]',
  summary TEXT NOT NULL DEFAULT '',
  original_text TEXT DEFAULT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS generated_lessons_user_id_idx ON public.generated_lessons(user_id);

-- Enable Row Level Security
ALTER TABLE public.chat_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.memory_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.generated_lessons ENABLE ROW LEVEL SECURITY;

-- RLS Policies: users can only access their own data
CREATE POLICY IF NOT EXISTS "Users own their chat sessions" ON public.chat_sessions FOR ALL USING (auth.uid()::text = user_id);
CREATE POLICY IF NOT EXISTS "Users own their chat messages" ON public.chat_messages FOR ALL USING (auth.uid()::text = user_id);
CREATE POLICY IF NOT EXISTS "Users own their memory entries" ON public.memory_entries FOR ALL USING (auth.uid()::text = user_id);
CREATE POLICY IF NOT EXISTS "Users own their lessons" ON public.generated_lessons FOR ALL USING (auth.uid()::text = user_id);

-- Service role bypass (for server-side operations)
CREATE POLICY IF NOT EXISTS "Service role bypass sessions" ON public.chat_sessions FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY IF NOT EXISTS "Service role bypass messages" ON public.chat_messages FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY IF NOT EXISTS "Service role bypass memory" ON public.memory_entries FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY IF NOT EXISTS "Service role bypass lessons" ON public.generated_lessons FOR ALL TO service_role USING (true) WITH CHECK (true);
`;
    res.json({ sql });
  });

  app.get('/api/admin/users', supabaseAuth, async (req: any, res: Response) => {
    try {
      const requester = await storage.getUser(req.userId);
      if (requester?.email !== REAL_ADMIN_EMAIL) {
        return res.status(403).json({ message: "Forbidden" });
      }
      const users = await storage.getUsers();
      res.json(users);
    } catch (error) {
      logAdminError("/api/admin/users", error);
      res.status(500).json({ message: "Failed to fetch users" });
    }
  });

  app.get('/api/admin/stats', supabaseAuth, async (req: any, res: Response) => {
    try {
      const requester = await storage.getUser(req.userId);
      if (requester?.email !== REAL_ADMIN_EMAIL) {
        return res.status(403).json({ message: "Forbidden" });
      }
      const overview = await getAdminOverview();
      res.json(overview);
    } catch (error) {
      logAdminError("/api/admin/stats", error);
      res.status(500).json({ message: "Failed to fetch stats" });
    }
  });

  // Real API key configuration status (never exposes actual key values)
  app.get('/api/admin/api-keys', supabaseAuth, async (req: any, res: Response) => {
    try {
      const requester = await storage.getUser(req.userId);
      if (requester?.email !== REAL_ADMIN_EMAIL) {
        return res.status(403).json({ message: "Forbidden" });
      }
      res.json(getApiKeyStatus());
    } catch (error) {
      logAdminError("/api/admin/api-keys", error);
      res.status(500).json({ message: "Failed to fetch key status" });
    }
  });

  // Recent error log
  app.get('/api/admin/errors', supabaseAuth, async (req: any, res: Response) => {
    try {
      const requester = await storage.getUser(req.userId);
      if (requester?.email !== REAL_ADMIN_EMAIL) {
        return res.status(403).json({ message: "Forbidden" });
      }
      res.json(getRecentErrors());
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch errors" });
    }
  });

  // Real per-provider API call counts + real Stability credit balance
  app.get('/api/admin/api-usage', supabaseAuth, async (req: any, res: Response) => {
    try {
      const requester = await storage.getUser(req.userId);
      if (requester?.email !== REAL_ADMIN_EMAIL) {
        return res.status(403).json({ message: "Forbidden" });
      }
      const [usage, stabilityBalance] = await Promise.all([
        getApiUsageSummary(),
        getStabilityBalance(),
      ]);
      res.json({ usage, stabilityBalance });
    } catch (error) {
      logAdminError("/api/admin/api-usage", error);
      res.status(500).json({ message: "Failed to fetch API usage" });
    }
  });

  // Which model/tier combination is actually being used, last 7 days
  app.get('/api/admin/model-usage-by-tier', supabaseAuth, async (req: any, res: Response) => {
    try {
      const requester = await storage.getUser(req.userId);
      if (requester?.email !== REAL_ADMIN_EMAIL) {
        return res.status(403).json({ message: "Forbidden" });
      }
      res.json(await getModelUsageByTier());
    } catch (error) {
      logAdminError("/api/admin/model-usage-by-tier", error);
      res.status(500).json({ message: "Failed to fetch model usage" });
    }
  });

  // Dashboard stats endpoint
  app.get('/api/dashboard/stats', supabaseAuth, async (req: any, res: Response) => {
    try {
      const userId = req.userId;
      const user = await storage.getUser(userId);
      
      // Get chat sessions count
      const chatSessions = await storage.getChatSessionsByUser(userId);
      const totalSessions = chatSessions?.length || 0;
      
      // Get learning history and progress
      const learningHistory = await storage.getLearningHistoryByUser(userId);
      const examResults = await storage.getExamResultsByUser(userId);
      
      // Calculate XP and level
      const xp = learningHistory?.reduce((acc: number, h: any) => acc + (h.xpEarned || 0), 0) || 0;
      const level = Math.floor(xp / 100) + 1;
      
      // Calculate completion percentage
      const totalCompleted = learningHistory?.filter((h: any) => h.completed)?.length || 0;
      const completionPercent = learningHistory?.length ? Math.round((totalCompleted / learningHistory.length) * 100) : 0;
      
      // Get exam average
      const examScores = examResults?.map((e: any) => e.score) || [];
      const avgExamScore = examScores.length ? Math.round(examScores.reduce((a: number, b: number) => a + b, 0) / examScores.length) : 0;
      
      // Get weak topics from exam results
      const weakTopics = examResults?.reduce((acc: string[], e: any) => {
        if (e.weakTopics) {
          const topics = Array.isArray(e.weakTopics) ? e.weakTopics : [];
          return [...acc, ...topics];
        }
        return acc;
      }, [] as string[]) || [];
      const uniqueWeakTopics = Array.from(new Set(weakTopics)).slice(0, 5);
      
      // Get streak (days studied in a row)
      const dates = learningHistory?.map((h: any) => new Date(h.createdAt).toDateString()) || [];
      const uniqueDates = Array.from(new Set(dates));
      const streak = uniqueDates.length;
      
      // Teacher-specific stats
      const isTeacher = user?.role === "teacher" || user?.role === "lecturer" || user?.role === "school";
      let teacherStats = null;
      
      if (isTeacher) {
        // Get courses created by teacher
        const courses = await storage.getCoursesByTeacher(userId) || [];
        const liveSessions = await storage.getLiveSessionsByHost(userId) || [];
        
        // Calculate total students (placeholder - would need enrollment data)
        const totalStudents = courses.reduce((acc: number, c: any) => acc + (c.enrollmentCount || 0), 0);
        
        // Calculate earnings (from subscriptions/course sales)
        const earnings = courses.reduce((acc: number, c: any) => acc + ((c.price || 0) * (c.enrollmentCount || 0)), 0);
        
        teacherStats = {
          totalStudents,
          activeCourses: courses.length,
          liveSessions: liveSessions.length,
          earnings,
        };
      }
      
      res.json({
        totalSessions,
        xp,
        level,
        streak,
        completionPercent,
        avgExamScore,
        weakTopics: uniqueWeakTopics,
        studyHours: Math.round((learningHistory?.length || 0) * 0.5), // Estimate 30 min per session
        teacherStats,
      });
    } catch (error) {
      console.error("Dashboard stats error:", error);
      res.status(500).json({ message: "Failed to fetch dashboard stats" });
    }
  });

  // Memory preferences routes
  app.get('/api/memory/learned-preferences', supabaseAuth, async (req: any, res: Response) => {
    try {
      const userId = req.userId;
      const entries = await storage.getMemoryEntriesByUser(userId);
      
      // Aggregate learned preferences from all auto_learned entries
      let aggregated = {
        preferences: {},
        goals: {},
        skills: {},
        interests: {},
        business: {},
        writing: {},
        autoLearned: {
          subjects: [] as string[],
          goals: [] as string[],
          skills: [] as string[],
          educationDetails: {} as Record<string, string>,
          writingStyle: {} as Record<string, string>,
        }
      };

      (entries || []).forEach((entry: any) => {
        if (entry.type === "auto_learned" && entry.data?.learned) {
          const learned = entry.data.learned;
          
          // Collect raw learned data
          if (learned.subjects?.length) {
            aggregated.autoLearned.subjects = Array.from(new Set([...aggregated.autoLearned.subjects, ...learned.subjects]));
            aggregated.interests = { primary: aggregated.autoLearned.subjects.join(", ") };
          }
          if (learned.goals?.length) {
            aggregated.autoLearned.goals = Array.from(new Set([...aggregated.autoLearned.goals, ...learned.goals]));
            aggregated.goals = { learningGoal: aggregated.autoLearned.goals.join(", ") };
          }
          if (learned.skills?.length) {
            aggregated.autoLearned.skills = Array.from(new Set([...aggregated.autoLearned.skills, ...learned.skills]));
            aggregated.skills = { languages: aggregated.autoLearned.skills.join(", ") };
          }
          if (learned.educationDetails) {
            aggregated.autoLearned.educationDetails = { ...aggregated.autoLearned.educationDetails, ...learned.educationDetails };
            aggregated.business = { ...aggregated.business, ...aggregated.autoLearned.educationDetails };
          }
          if (learned.writingStyle) {
            aggregated.autoLearned.writingStyle = { ...aggregated.autoLearned.writingStyle, ...learned.writingStyle };
            aggregated.writing = { ...aggregated.writing, ...aggregated.autoLearned.writingStyle };
          }
        }
      });

      console.log(`✅ AI Auto-learned ${aggregated.autoLearned.subjects.length} subjects, ${aggregated.autoLearned.goals.length} goals, ${aggregated.autoLearned.skills.length} skills`);
      res.json(aggregated);
    } catch (error) {
      console.error("Fetch learned preferences failed:", error);
      res.status(500).json({ message: "Failed to fetch preferences" });
    }
  });

  app.post('/api/memory/preferences', supabaseAuth, async (req: any, res: Response) => {
    try {
      const userId = req.userId;
      const { categoryId, itemKey, value } = req.body;
      
      await storage.createMemoryEntry({
        userId,
        type: 'preference_manual',
        data: { categoryId, key: itemKey, value, timestamp: new Date().toISOString() },
      });
      
      res.json({ success: true, message: "Preference saved" });
    } catch (error) {
      console.error("Save preference failed:", error);
      res.status(500).json({ message: "Failed to save preference" });
    }
  });

  app.post('/api/memory/preferences/add', supabaseAuth, async (req: any, res: Response) => {
    try {
      const userId = req.userId;
      const { categoryId, key, value } = req.body;
      
      await storage.createMemoryEntry({
        userId,
        type: 'preference_manual',
        data: { categoryId, key, value, timestamp: new Date().toISOString() },
      });
      
      res.json({ success: true, message: "Item added" });
    } catch (error) {
      console.error("Add item failed:", error);
      res.status(500).json({ message: "Failed to add item" });
    }
  });

  // Courses routes
  app.get('/api/courses', supabaseAuth, async (req: any, res: Response) => {
    try {
      const courses = await storage.getAllCourses();
      res.json(courses);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch courses" });
    }
  });

  // Project routes
  app.get('/api/projects', supabaseAuth, async (req: any, res: Response) => {
    try {
      const userId = req.userId;
      const projects = await storage.getProjectsByUser(userId);
      res.json(projects);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch projects" });
    }
  });

  app.get('/api/projects/:id/tasks', supabaseAuth, async (req: any, res: Response) => {
    try {
      const tasks = await storage.getTasksByProject(req.params.id);
      res.json(tasks);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch tasks" });
    }
  });
  app.get('/api/chat/sessions', supabaseAuth, async (req: any, res: Response) => {
    try {
      const userId = req.userId;
      const sessions = await storage.getChatSessionsByUser(userId);
      res.json(sessions);
    } catch (error) {
      console.error("Error fetching chat sessions:", error);
      res.status(500).json({ message: "Failed to fetch chat sessions" });
    }
  });

  app.post('/api/chat/sessions', supabaseAuth, async (req: any, res: Response) => {
    try {
      const userId = req.userId;
      const { title, mode } = req.body;
      const session = await storage.createChatSession({ userId, title: title || "New Chat", mode: mode || "chat", summary: "" });
      res.json(session);
    } catch (error) {
      console.error("Error creating chat session:", error);
      res.status(500).json({ message: "Failed to create chat session" });
    }
  });

  app.patch('/api/chat/sessions/:id', supabaseAuth, async (req: any, res: Response) => {
    try {
      const { id } = req.params;
      const userId = req.userId;
      const updates = req.body;
      const existing = await storage.getChatSession(id);
      if (!existing || existing.userId !== userId) {
        return res.status(403).json({ message: "Unauthorized" });
      }
      const session = await storage.updateChatSession(id, updates);
      res.json(session);
    } catch (error) {
      console.error("Error updating chat session:", error);
      res.status(500).json({ message: "Failed to update chat session" });
    }
  });

  app.delete('/api/chat/sessions/:id', supabaseAuth, async (req: any, res: Response) => {
    try {
      const { id } = req.params;
      const userId = req.userId;
      
      // Verify ownership before deleting
      const session = await storage.getChatSession(id);
      if (!session || session.userId !== userId) {
        return res.status(403).json({ message: "Unauthorized" });
      }

      // Delete session messages (memory cleanup happens automatically through cascade)
      const sessionMessages = await storage.getChatMessagesBySession(id);
      console.log(`Deleting ${sessionMessages.length} messages from session ${id}`);

      await storage.deleteChatSession(id);
      res.json({ message: "Chat session deleted successfully" });
    } catch (error) {
      console.error("Error deleting chat session:", error);
      res.status(500).json({ message: "Failed to delete chat session" });
    }
  });

  // Internet search route
  app.post('/api/chat/search', supabaseAuth, async (req: any, res: Response) => {
    try {
      const { query } = req.body;
      if (!query?.trim()) {
        return res.status(400).json({ message: "Search query is required" });
      }

      console.log("🔍 Processing search request:", query);
      const searchResults = await searchInternetWithGemini(query);
      res.json(searchResults);
    } catch (error) {
      console.error("Search error:", error);
      res.status(500).json({ message: "Search failed", error: error instanceof Error ? error.message : "Unknown error" });
    }
  });

  // Bulk delete chat sessions
  app.post('/api/chat/sessions/bulk-delete', supabaseAuth, async (req: any, res: Response) => {
    try {
      const userId = req.userId;
      const { sessionIds } = req.body;

      if (!Array.isArray(sessionIds) || sessionIds.length === 0) {
        return res.status(400).json({ message: "Session IDs are required" });
      }

      let deletedCount = 0;
      for (const sessionId of sessionIds) {
        try {
          const session = await storage.getChatSession(sessionId);
          if (session && session.userId === userId) {
            await storage.deleteChatSession(sessionId);
            deletedCount++;
            console.log(`✓ Deleted session ${sessionId}`);
          }
        } catch (err) {
          console.error(`Error deleting session ${sessionId}:`, err);
        }
      }

      res.json({ 
        message: `Successfully deleted ${deletedCount} chat sessions`,
        deletedCount 
      });
    } catch (error) {
      console.error("Error in bulk delete:", error);
      res.status(500).json({ message: "Failed to delete chat sessions" });
    }
  });

  // File upload handler with Gemini API fallback to OpenAI/OpenRouter
  const uploadMulter = multer({ storage: multer.memoryStorage() });
  
  app.post('/api/chat/analyze-file', supabaseAuth, uploadMulter.single('file'), async (req: any, res: Response) => {
    try {
      if (!req.file) {
        return res.status(400).json({ message: "No file uploaded" });
      }
      
      const userId = req.userId;
      const { originalname, mimetype, buffer } = req.file;
      const { description } = req.body;
      
      let analysis = "";
      let extractedText = "";
      let usedApi = "gemini-vision";
      
      console.log(`🔍 Analyzing file: ${originalname} (${mimetype})`);
      
      // Use Gemini Vision to extract content from file
      try {
        const visionResult = await analyzeFileWithGeminiVision(buffer, mimetype, originalname);
        extractedText = visionResult.extractedText;
        
        // Build analysis response combining extracted content with user's request
        const userRequest = description ? `\n\nUser's specific request: ${description}` : "";
        
        // Now use the extracted text with LLM to answer the user's specific question
        if (description && description.trim()) {
          try {
            const llmAnalysis = await chatWithAI([
              {
                role: "user",
                content: `I've extracted the following content from a file:\n\n${extractedText.substring(0, 2000)}\n\nPlease help me with this request about the file:\n${description}`
              }
            ]);
            analysis = llmAnalysis || "File analyzed successfully";
          } catch (llmErr) {
            console.error("LLM analysis failed, using extracted content:", llmErr);
            analysis = `Extracted Content:\n\n${extractedText.substring(0, 1000)}...`;
          }
        } else {
          // If no specific request, just return extracted content
          analysis = extractedText || "File content extracted successfully";
        }
        
        console.log(`✅ File analyzed successfully - extracted ${extractedText.length} chars`);
      } catch (visionErr) {
        console.error("Gemini Vision analysis failed:", visionErr);
        usedApi = "learnory-fallback";
        
        // Fallback to LLM only (less capable but still works)
        try {
          const fileContext = `Analyzing file: ${originalname} (${mimetype})${description ? `\n\nUser request: ${description}` : ""}`;
          analysis = await chatWithAI([
            { role: "user", content: `Please help analyze this file: ${fileContext}` }
          ]);
          analysis = analysis || "File analyzed with LENORY";
        } catch (fallbackErr) {
          console.error("Fallback analysis failed:", fallbackErr);
          usedApi = "failed";
          analysis = "Unable to analyze file - please try again";
        }
      }
      
      // Save file upload record
      const fileRecord = await storage.createFileUpload({
        userId,
        fileName: originalname,
        fileType: mimetype,
        fileSize: buffer.length,
        fileUrl: `/api/uploads/${userId}/${nanoid()}`,
        processingStatus: "completed",
        extractedText: extractedText || analysis,
      });
      
      res.json({ fileRecord, analysis, extractedText, usedApi });
    } catch (error) {
      console.error("File upload error:", error);
      res.status(500).json({ message: "Failed to process file" });
    }
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // NOTES / KNOWLEDGE BASE
  // ─────────────────────────────────────────────────────────────────────────────

  // List all notes for the logged-in user
  app.get('/api/notes', supabaseAuth, async (req: any, res: Response) => {
    try {
      const userId = req.userId;
      const notes = await storage.getFileUploadsByUser(userId);
      res.json(notes);
    } catch (error) {
      console.error("Error fetching notes:", error);
      res.status(500).json({ message: "Failed to fetch notes" });
    }
  });

  // Upload a note (image/PDF/text) — extracts text with Gemini Vision and saves it
  app.post('/api/notes/upload', supabaseAuth, uploadMulter.single('file'), async (req: any, res: Response) => {
    try {
      if (!req.file) {
        return res.status(400).json({ message: "No file uploaded" });
      }
      const userId = req.userId;
      const { originalname, mimetype, buffer } = req.file;

      // ── CREDIT CHECK: first 10 notes free, then 20 credits each ──────────
      const user = await storage.getUser(userId);
      let creditsCharged = 0;
      if (user?.email !== ADMIN_EMAIL) {
        const existingNotes = await storage.getFileUploadsByUser(userId);
        const isBeyondFreeLimit = existingNotes.length >= 10;
        if (isBeyondFreeLimit) {
          const tier = (user as any)?.subscriptionTier || 'free';
          const credits = await getOrCreateCredits(userId, tier);
          if (credits.balance < 20) {
            return res.status(402).json({
              message: "You've used your 10 free note uploads. Uploading more notes costs 20 credits each, and your balance is too low.",
              error: "INSUFFICIENT_CREDITS",
              balance: credits.balance,
            });
          }
          await deductCredits(userId, 20);
          creditsCharged = 20;
        }
      }
      // ──────────────────────────────────────────────────────────────────────

      console.log(`📚 Uploading note: ${originalname} (${mimetype})`);

      let extractedText = "";
      try {
        const visionResult = await analyzeFileWithGeminiVision(buffer, mimetype, originalname);
        extractedText = visionResult.extractedText;
      } catch (visionErr) {
        console.error("Note text extraction failed:", visionErr);
        return res.status(500).json({ message: "Could not read this file. Try a clearer photo or a different format." });
      }

      const note = await storage.createFileUpload({
        userId,
        fileName: originalname,
        fileType: mimetype,
        fileSize: buffer.length,
        fileUrl: `/api/uploads/${userId}/${nanoid()}`,
        processingStatus: "completed",
        extractedText,
      });

      res.json({ ...note, creditsCharged });
    } catch (error) {
      console.error("Note upload error:", error);
      res.status(500).json({ message: "Failed to upload note" });
    }
  });

  // Save raw text (e.g. a Live Session transcript) directly as a note
  app.post('/api/notes/from-text', supabaseAuth, async (req: any, res: Response) => {
    try {
      const userId = req.userId;
      const { fileName, text } = req.body;
      if (!text || text.trim().length < 10) {
        return res.status(400).json({ message: "Not enough text to save as a note" });
      }

      const user = await storage.getUser(userId);
      let creditsCharged = 0;
      if (user?.email !== ADMIN_EMAIL) {
        const existingNotes = await storage.getFileUploadsByUser(userId);
        if (existingNotes.length >= 10) {
          const tier = (user as any)?.subscriptionTier || 'free';
          const credits = await getOrCreateCredits(userId, tier);
          if (credits.balance < 20) {
            return res.status(402).json({
              message: "You've used your 10 free note uploads. Saving more notes costs 20 credits each, and your balance is too low.",
              error: "INSUFFICIENT_CREDITS",
              balance: credits.balance,
            });
          }
          await deductCredits(userId, 20);
          creditsCharged = 20;
        }
      }

      const note = await storage.createFileUpload({
        userId,
        fileName: fileName || `Live Session Transcript - ${new Date().toLocaleDateString()}`,
        fileType: "text/plain",
        fileSize: text.length,
        fileUrl: `/api/uploads/${userId}/${nanoid()}`,
        processingStatus: "completed",
        extractedText: text,
      });

      res.json({ ...note, creditsCharged });
    } catch (error) {
      console.error("Save transcript as note error:", error);
      res.status(500).json({ message: "Failed to save note" });
    }
  });

  // Delete a note
  app.delete('/api/notes/:id', supabaseAuth, async (req: any, res: Response) => {
    try {
      const userId = req.userId;
      const note = await storage.getFileUpload(req.params.id);
      if (!note || note.userId !== userId) {
        return res.status(404).json({ message: "Note not found" });
      }
      await storage.deleteFileUpload(req.params.id);
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting note:", error);
      res.status(500).json({ message: "Failed to delete note" });
    }
  });

  // Practice mode 1: MCQ quiz generated from a note
  app.post('/api/notes/:id/quiz', supabaseAuth, async (req: any, res: Response) => {
    try {
      const userId = req.userId;
      const note = await storage.getFileUpload(req.params.id);
      if (!note || note.userId !== userId) {
        return res.status(404).json({ message: "Note not found" });
      }
      if (!note.extractedText || note.extractedText.trim().length < 20) {
        return res.status(400).json({ message: "This note doesn't have enough text to generate a quiz from" });
      }
      const questionCount = Math.min(Math.max(parseInt(req.body?.questionCount) || 5, 1), 15);
      const quiz = await generateQuizFromText(note.extractedText, questionCount);
      res.json(quiz);
    } catch (error) {
      console.error("Error generating quiz from note:", error);
      res.status(500).json({ message: "Failed to generate quiz" });
    }
  });

  // Practice mode 2: Flashcards generated from a note
  app.post('/api/notes/:id/flashcards', supabaseAuth, async (req: any, res: Response) => {
    try {
      const userId = req.userId;
      const note = await storage.getFileUpload(req.params.id);
      if (!note || note.userId !== userId) {
        return res.status(404).json({ message: "Note not found" });
      }
      if (!note.extractedText || note.extractedText.trim().length < 20) {
        return res.status(400).json({ message: "This note doesn't have enough text to generate flashcards from" });
      }
      const flashcards = await generateFlashcards(note.extractedText);
      res.json(flashcards);
    } catch (error) {
      console.error("Error generating flashcards from note:", error);
      res.status(500).json({ message: "Failed to generate flashcards" });
    }
  });

  // Practice mode 3: Conversational quiz — starts a real chat session seeded with the note
  app.post('/api/notes/:id/chat', supabaseAuth, async (req: any, res: Response) => {
    try {
      const userId = req.userId;
      const note = await storage.getFileUpload(req.params.id);
      if (!note || note.userId !== userId) {
        return res.status(404).json({ message: "Note not found" });
      }
      if (!note.extractedText || note.extractedText.trim().length < 20) {
        return res.status(400).json({ message: "This note doesn't have enough text to practice with" });
      }

      const session = await storage.createChatSession({
        userId,
        title: `Practice: ${note.fileName}`,
        mode: "chat",
        summary: `__NOTE_CONTEXT__${note.extractedText.substring(0, 6000)}`,
      });

      const kickoffPrompt = `You are LENORY, a friendly Nigerian exam tutor. A student uploaded these notes titled "${note.fileName}". Quiz them on it one question at a time — ask a question, wait for their answer, then tell them if they're right, explain briefly, and ask the next one. Start now with your first question. Keep questions based only on this content:\n\n${note.extractedText.substring(0, 6000)}`;

      const firstQuestion = await chatWithAI([{ role: "user", content: kickoffPrompt }]);

      await storage.createChatMessage({
        sessionId: session.id,
        userId,
        role: "assistant",
        content: firstQuestion || "Let's begin! What's the first thing you remember from this note?",
      });

      res.json({ sessionId: session.id, firstMessage: firstQuestion });
    } catch (error) {
      console.error("Error starting note practice chat:", error);
      res.status(500).json({ message: "Failed to start practice session" });
    }
  });

  // Website Generator routes
  app.get('/api/websites', supabaseAuth, async (req: any, res: Response) => {
    try {
      const userId = req.userId;
      const websites = await storage.getGeneratedWebsitesByUser(userId);
      res.json(websites);
    } catch (error) {
      console.error("Error fetching websites:", error);
      res.status(500).json({ message: "Failed to fetch websites" });
    }
  });

  app.get('/api/websites/:id', supabaseAuth, async (req: any, res: Response) => {
    try {
      const website = await storage.getGeneratedWebsite(req.params.id);
      if (!website) {
        return res.status(404).json({ message: "Website not found" });
      }
      await storage.incrementViewCount(req.params.id);
      res.json(website);
    } catch (error) {
      console.error("Error fetching website:", error);
      res.status(500).json({ message: "Failed to fetch website" });
    }
  });

  app.post('/api/websites/generate', supabaseAuth, async (req: any, res: Response) => {
    try {
      const userId = req.userId;
      const { prompt } = req.body;

      if (!prompt?.trim()) {
        return res.status(400).json({ message: "Prompt is required" });
      }

      // Generate website using Gemini
      const generated = await generateWebsiteWithGemini(prompt);

      // Save to database
      const website = await storage.createGeneratedWebsite({
        userId,
        title: generated.title,
        description: `Generated from: ${prompt.substring(0, 100)}...`,
        prompt,
        htmlCode: generated.html || "",
        cssCode: generated.css || "",
        jsCode: generated.js || "",
        tags: [],
        isFavorite: false,
      });

      res.json(website);
    } catch (error) {
      console.error("Error generating website:", error);
      res.status(500).json({ message: `Failed to generate website: ${error instanceof Error ? error.message : "Unknown error"}` });
    }
  });

  app.patch('/api/websites/:id', supabaseAuth, async (req: any, res: Response) => {
    try {
      const { title, description, htmlCode, cssCode, jsCode, isFavorite } = req.body;
      
      const updated = await storage.updateGeneratedWebsite(req.params.id, {
        ...(title && { title }),
        ...(description && { description }),
        ...(htmlCode && { htmlCode }),
        ...(cssCode && { cssCode }),
        ...(jsCode && { jsCode }),
        ...(isFavorite !== undefined && { isFavorite }),
      });

      if (!updated) {
        return res.status(404).json({ message: "Website not found" });
      }

      res.json(updated);
    } catch (error) {
      console.error("Error updating website:", error);
      res.status(500).json({ message: "Failed to update website" });
    }
  });

  app.delete('/api/websites/:id', supabaseAuth, async (req: any, res: Response) => {
    try {
      await storage.deleteGeneratedWebsite(req.params.id);
      res.json({ message: "Website deleted successfully" });
    } catch (error) {
      console.error("Error deleting website:", error);
      res.status(500).json({ message: "Failed to delete website" });
    }
  });

  app.post('/api/websites/:id/explain', supabaseAuth, async (req: any, res: Response) => {
    try {
      const website = await storage.getGeneratedWebsite(req.params.id);
      if (!website) {
        return res.status(404).json({ message: "Website not found" });
      }

      const explanation = await explainCodeForBeginners(
        website.htmlCode,
        website.cssCode,
        website.jsCode || ""
      );

      res.json({ explanation });
    } catch (error) {
      console.error("Error explaining code:", error);
      res.status(500).json({ message: `Failed to explain code: ${error instanceof Error ? error.message : "Unknown error"}` });
    }
  });

  app.post('/api/websites/:id/debug', supabaseAuth, async (req: any, res: Response) => {
    try {
      const { debugPrompt } = req.body;
      
      if (!debugPrompt?.trim()) {
        return res.status(400).json({ message: "Debug prompt is required" });
      }

      const website = await storage.getGeneratedWebsite(req.params.id);
      if (!website) {
        return res.status(404).json({ message: "Website not found" });
      }

      console.log("🔍 LENORY AI Debug Started:", debugPrompt.substring(0, 50));
      
      const debugResult = await debugCodeWithLENORY(
        website.htmlCode,
        website.cssCode,
        website.jsCode || "",
        debugPrompt
      );

      console.log("✅ Debug complete, checking updates...");

      const htmlUpdated = debugResult.htmlCode !== website.htmlCode;
      const cssUpdated = debugResult.cssCode !== website.cssCode;
      const jsUpdated = (debugResult.jsCode || "") !== (website.jsCode || "");

      await storage.updateGeneratedWebsite(req.params.id, {
        htmlCode: debugResult.htmlCode,
        cssCode: debugResult.cssCode,
        jsCode: debugResult.jsCode,
      });

      console.log("💾 Website saved. Updates:", { html: htmlUpdated, css: cssUpdated, js: jsUpdated });

      res.json({
        success: true,
        updates: {
          html: htmlUpdated,
          css: cssUpdated,
          js: jsUpdated,
        }
      });
    } catch (error) {
      console.error("❌ Debug endpoint error:", error);
      res.status(500).json({
        success: false,
        message: error instanceof Error ? error.message : "Debug failed"
      });
    }
  });

  // Transcribe audio from chat voice input
  app.post('/api/chat/transcribe-voice', supabaseAuth, async (req: any, res: Response) => {
    try {
      const { audioDataUrl } = req.body;
      
      if (!audioDataUrl) {
        return res.status(400).json({ message: "Audio data is required" });
      }

      // Convert data URL to Buffer
      const base64Data = audioDataUrl.split(',')[1];
      if (!base64Data) {
        return res.status(400).json({ message: "Invalid audio data format" });
      }

      const audioBuffer = Buffer.from(base64Data, 'base64');
      const tempDir = os.tmpdir();
      const tempFile = path.join(tempDir, `chat_audio_${Date.now()}.webm`);
      
      fs.writeFileSync(tempFile, audioBuffer);
      
      try {
        const transcription = await transcribeAudio(tempFile);
        fs.unlinkSync(tempFile);
        
        res.json({ text: transcription.text });
      } catch (transcriptionError) {
        console.error("Transcription error:", transcriptionError);
        if (fs.existsSync(tempFile)) {
          fs.unlinkSync(tempFile);
        }
        res.status(500).json({ message: "Transcription failed. Please try again." });
      }
    } catch (error) {
      console.error("Error transcribing voice:", error);
      res.status(500).json({ message: "Failed to process voice input" });
    }
  });

  // Live Session routes
  app.get('/api/live-sessions', supabaseAuth, async (req: any, res: Response) => {
    try {
      const userId = req.userId;
      const sessions = await storage.getLiveSessionsByHost(userId);
      res.json(sessions);
    } catch (error) {
      console.error("Error fetching sessions:", error);
      res.status(500).json({ message: "Failed to fetch sessions" });
    }
  });

  app.post('/api/live-sessions', supabaseAuth, async (req: any, res: Response) => {
    try {
      const userId = req.userId;
      const { title, settings } = req.body;

      const session = await storage.createLiveSession({
        hostId: userId,
        title,
        status: 'active',
        participants: [userId],
        settings: settings || {},
      });

      res.json(session);
    } catch (error) {
      console.error("Error creating session:", error);
      res.status(500).json({ message: "Failed to create session" });
    }
  });

  app.patch('/api/live-sessions/:id', supabaseAuth, async (req: any, res: Response) => {
    try {
      const { id } = req.params;
      const updates = req.body;

      const session = await storage.updateLiveSession(id, updates);
      res.json(session);
    } catch (error) {
      console.error("Error updating session:", error);
      res.status(500).json({ message: "Failed to update session" });
    }
  });

  // Study Plans routes
  app.get('/api/study-plans', supabaseAuth, async (req: any, res: Response) => {
    try {
      const userId = req.userId;
      const plans = await storage.getStudyPlansByUser(userId);
      res.json(plans);
    } catch (error) {
      console.error("Error fetching study plans:", error);
      res.status(500).json({ message: "Failed to fetch study plans" });
    }
  });

  app.get('/api/study-plans/:id', supabaseAuth, async (req: any, res: Response) => {
    try {
      const userId = req.userId;
      const { id } = req.params;
      const plan = await storage.getStudyPlan(id);
      if (!plan) {
        return res.status(404).json({ message: "Study plan not found" });
      }
      // Verify ownership
      if (plan.userId !== userId) {
        return res.status(403).json({ message: "Unauthorized access to study plan" });
      }
      res.json(plan);
    } catch (error) {
      console.error("Error fetching study plan:", error);
      res.status(500).json({ message: "Failed to fetch study plan" });
    }
  });

  app.post('/api/study-plans', supabaseAuth, async (req: any, res: Response) => {
    try {
      const userId = req.userId;
      const { title, subjects, examType, deadline, hoursPerDay, weakAreas, schedule } = req.body;

      if (!title || !subjects || subjects.length === 0) {
        return res.status(400).json({ message: "Title and subjects are required" });
      }

      const plan = await storage.createStudyPlan({
        userId,
        title,
        subjects,
        examType,
        deadline: deadline ? new Date(deadline) : null,
        hoursPerDay,
        weakAreas,
        schedule,
        progress: { completedDays: 0, totalDays: schedule?.days?.length || 0 },
      });

      res.json(plan);
    } catch (error) {
      console.error("Error creating study plan:", error);
      res.status(500).json({ message: "Failed to create study plan" });
    }
  });

  app.post('/api/study-plans/generate', supabaseAuth, async (req: any, res: Response) => {
    try {
      const userId = req.userId;
      const { subjects, examType, deadline, hoursPerDay, weakAreas, goal } = req.body;

      if (!subjects || subjects.length === 0) {
        return res.status(400).json({ message: "Subjects are required" });
      }

      // Calculate days until deadline
      const daysUntilDeadline = deadline 
        ? Math.ceil((new Date(deadline).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
        : 30; // Default 30 days

      // Generate study plan with Gemini
      const prompt = `Generate a detailed study plan for a student preparing for ${examType || 'exams'}.

Subjects: ${subjects.join(', ')}
Days available: ${daysUntilDeadline} days
Study hours per day: ${hoursPerDay || 3} hours
${weakAreas?.length ? `Weak areas to focus on: ${weakAreas.join(', ')}` : ''}
${goal ? `Student's goal: ${goal}` : ''}

Create a structured day-by-day study schedule with:
1. Specific topics for each subject
2. Time allocation for each topic
3. Practice exercises and revision days
4. Focus on weak areas

Respond in this JSON format:
{
  "title": "Personalized Study Plan for [Exam Type]",
  "summary": "Brief overview of the study plan",
  "days": [
    {
      "day": 1,
      "date": "Day 1",
      "subjects": ["Math"],
      "topics": ["Algebra - Quadratic Equations"],
      "duration": 3,
      "activities": ["Study theory", "Practice 10 problems", "Review notes"],
      "focus": "Introduction"
    }
  ],
  "tips": ["Study tip 1", "Study tip 2"],
  "weeklyGoals": ["Week 1 goal", "Week 2 goal"]
}`;

      const aiResponse = await chatWithGemini([
        { role: "system", content: "You are an expert educational planner. Generate structured, realistic study plans optimized for exam success. Always respond with valid JSON." },
        { role: "user", content: prompt }
      ]);

      // Parse AI response
      let schedule;
      try {
        const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          schedule = JSON.parse(jsonMatch[0]);
        } else {
          throw new Error("No JSON found in response");
        }
      } catch (parseError) {
        console.error("Failed to parse AI study plan:", parseError);
        // Create fallback schedule
        schedule = {
          title: `Study Plan for ${subjects.join(', ')}`,
          summary: "Generated study plan",
          days: subjects.map((subj: string, i: number) => ({
            day: i + 1,
            date: `Day ${i + 1}`,
            subjects: [subj],
            topics: [`${subj} fundamentals`],
            duration: hoursPerDay || 3,
            activities: ["Study", "Practice", "Review"],
            focus: "Core concepts"
          })),
          tips: ["Stay consistent", "Take breaks", "Review regularly"],
          weeklyGoals: ["Complete all topics", "Do practice tests"]
        };
      }

      // Save to database
      const plan = await storage.createStudyPlan({
        userId,
        title: schedule.title,
        subjects,
        examType,
        deadline: deadline ? new Date(deadline) : null,
        hoursPerDay,
        weakAreas,
        schedule,
        progress: { completedDays: 0, totalDays: schedule.days?.length || 0 },
      });

      res.json(plan);
    } catch (error) {
      console.error("Error generating study plan:", error);
      res.status(500).json({ message: "Failed to generate study plan" });
    }
  });

  app.patch('/api/study-plans/:id', supabaseAuth, async (req: any, res: Response) => {
    try {
      const userId = req.userId;
      const { id } = req.params;
      const updates = req.body;

      // Verify ownership before update
      const existingPlan = await storage.getStudyPlan(id);
      if (!existingPlan) {
        return res.status(404).json({ message: "Study plan not found" });
      }
      if (existingPlan.userId !== userId) {
        return res.status(403).json({ message: "Unauthorized to update this study plan" });
      }

      const plan = await storage.updateStudyPlan(id, updates);
      res.json(plan);
    } catch (error) {
      console.error("Error updating study plan:", error);
      res.status(500).json({ message: "Failed to update study plan" });
    }
  });

  // Setup multer for file uploads
  const upload = multer({ storage: multer.memoryStorage() });

  // Transcript routes
  app.post('/api/transcripts', supabaseAuth, async (req: any, res: Response) => {
    try {
      const userId = req.userId;
      const { sessionId, segments, audioUrl } = req.body;

      const transcript = await storage.createTranscript({
        sessionId,
        segments,
        audioUrl,
        createdById: userId,
      });

      res.json(transcript);
    } catch (error) {
      console.error("Error creating transcript:", error);
      res.status(500).json({ message: "Failed to create transcript" });
    }
  });


  // Lesson routes
  app.get('/api/lessons', supabaseAuth, async (req: any, res: Response) => {
    try {
      const { courseId } = req.query;
      let lessons: any[] = [];

      if (courseId) {
        lessons = await storage.getLessonsByCourse(courseId as string);
      }

      res.json(lessons);
    } catch (error) {
      console.error("Error fetching lessons:", error);
      res.status(500).json({ message: "Failed to fetch lessons" });
    }
  });

  app.post('/api/lessons/generate', supabaseAuth, async (req: any, res: Response) => {
    try {
      const userId = req.userId;
      const { transcriptText, courseId } = req.body;

      // Use AI to generate structured lesson
      const lessonData = await generateLesson(transcriptText);

      const lesson = await storage.createLesson({
        courseId: courseId || null,
        title: lessonData.title,
        content: lessonData,
        createdById: userId,
      });

      res.json(lesson);
    } catch (error) {
      console.error("Error generating lesson:", error);
      res.status(500).json({ message: "Failed to generate lesson" });
    }
  });

  // Course routes
  app.get('/api/courses', supabaseAuth, async (req: any, res: Response) => {
    try {
      const userId = req.userId;
      const user = await storage.getUser(userId);

      let courses;
      if (user?.role === 'teacher' || user?.role === 'lecturer' || user?.role === 'school') {
        courses = await storage.getCoursesByTeacher(userId);
      } else {
        courses = await storage.getAllCourses();
      }

      res.json(courses);
    } catch (error) {
      console.error("Error fetching courses:", error);
      res.status(500).json({ message: "Failed to fetch courses" });
    }
  });

  app.post('/api/courses', supabaseAuth, upload.array('materials', 10), async (req: any, res: Response) => {
    try {
      const userId = req.userId;
      const { title, description, price, category, duration } = req.body;
      const files = req.files as Express.Multer.File[];

      // Process uploaded files
      let materials: any[] = [];
      if (files && files.length > 0) {
        materials = await Promise.all(files.map(async (file) => {
          // Analyze file content with Gemini Vision if it's a PDF
          let extractedContent = null;
          if (file.mimetype === 'application/pdf') {
            try {
              extractedContent = await analyzeFileWithGeminiVision(
                file.buffer.toString('base64'),
                file.mimetype,
                "Extract key learning content, topics, and concepts from this educational material"
              );
            } catch (err) {
              console.log("File analysis skipped:", err);
            }
          }

          return {
            name: file.originalname,
            size: file.size,
            type: file.mimetype,
            uploadedAt: new Date().toISOString(),
            extractedContent,
          };
        }));
      }

      // Generate syllabus from materials if available
      let syllabus = null;
      if (materials.length > 0 && materials.some(m => m.extractedContent)) {
        const contentSummary = materials
          .filter(m => m.extractedContent)
          .map(m => m.extractedContent)
          .join('\n\n');

        try {
          const syllabusResponse = await chatWithGemini([
            { role: "system", content: "You are an educational curriculum designer. Generate structured syllabi from course materials." },
            { role: "user", content: `Based on these course materials, generate a structured syllabus in JSON format:

Materials content:
${contentSummary.substring(0, 5000)}

Generate a syllabus with:
{
  "weeks": [{"week": 1, "title": "...", "topics": ["..."], "objectives": ["..."]}],
  "learningOutcomes": ["..."],
  "assessments": ["..."]
}` }
          ]);

          const jsonMatch = syllabusResponse.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            syllabus = JSON.parse(jsonMatch[0]);
          }
        } catch (err) {
          console.log("Syllabus generation skipped:", err);
        }
      }

      const course = await storage.createCourse({
        teacherId: userId,
        title,
        description,
        price: price || '0',
        syllabus,
        isPublished: true,
        schoolId: null,
      });

      // Store additional course metadata
      await storage.updateCourse(course.id, {
        syllabus: {
          ...syllabus,
          category,
          duration,
          materials,
        },
      });

      res.json(course);
    } catch (error) {
      console.error("Error creating course:", error);
      res.status(500).json({ message: "Failed to create course" });
    }
  });

  app.post('/api/courses/generate-syllabus', supabaseAuth, async (req: any, res: Response) => {
    try {
      const { topic } = req.body;

      // Use AI to generate syllabus
      const syllabus = await generateSyllabus(topic);

      res.json(syllabus);
    } catch (error) {
      console.error("Error generating syllabus:", error);
      res.status(500).json({ message: "Failed to generate syllabus" });
    }
  });

  // Quiz/Exam routes
  app.get('/api/quizzes', supabaseAuth, async (req: any, res: Response) => {
    try {
      const { courseId } = req.query;
      let quizzes: any[] = [];

      if (courseId) {
        quizzes = await storage.getQuizzesByCourse(courseId as string);
      }

      res.json(quizzes);
    } catch (error) {
      console.error("Error fetching quizzes:", error);
      res.status(500).json({ message: "Failed to fetch quizzes" });
    }
  });

  app.post('/api/quizzes', supabaseAuth, async (req: any, res: Response) => {
    try {
      const userId = req.userId;
      const { courseId, title, description, difficulty, timeLimit, questions, rubric } = req.body;

      const quiz = await storage.createQuiz({
        courseId,
        title,
        description,
        difficulty: difficulty || 'medium',
        timeLimit,
        questions,
        rubric,
        createdById: userId,
      });

      res.json(quiz);
    } catch (error) {
      console.error("Error creating quiz:", error);
      res.status(500).json({ message: "Failed to create quiz" });
    }
  });

  app.post('/api/quiz-attempts', supabaseAuth, async (req: any, res: Response) => {
    try {
      const userId = req.userId;
      const { quizId, answers } = req.body;

      // Get quiz for rubric
      const quiz = await storage.getQuiz(quizId);
      if (!quiz) {
        return res.status(404).json({ message: "Quiz not found" });
      }

      // Use AI to grade
      const grading = await gradeQuiz(answers, quiz.rubric);

      const attempt = await storage.createQuizAttempt({
        quizId,
        studentId: userId,
        answers,
        score: grading.score.toString(),
        feedback: grading,
      });

      // Track weak topics
      await storage.createMemoryEntry({
        userId,
        type: 'quiz_result',
        data: {
          quizId,
          score: grading.score,
          weakTopics: grading.feedback.filter((f: any) => f.points < f.maxPoints).map((f: any) => f.topic),
        },
      });

      res.json(attempt);
    } catch (error) {
      console.error("Error submitting quiz attempt:", error);
      res.status(500).json({ message: "Failed to submit quiz attempt" });
    }
  });

  // File upload routes
  app.post('/api/files/upload', supabaseAuth, async (req: any, res: Response) => {
    try {
      const userId = req.userId;
      const { fileName, fileType, fileSize, fileUrl } = req.body;

      const upload = await storage.createFileUpload({
        userId,
        fileName,
        fileType,
        fileSize,
        fileUrl,
        processingStatus: 'pending',
        extractedText: null,
      });

      // In a real implementation, you would trigger background processing here
      res.json(upload);
    } catch (error) {
      console.error("Error uploading file:", error);
      res.status(500).json({ message: "Failed to upload file" });
    }
  });

  // Notes & Export routes
  app.post('/api/notes/summarize', supabaseAuth, async (req: any, res: Response) => {
    try {
      const { text, length } = req.body;

      const summary = await summarizeText(text, length || 'medium');

      res.json({ summary });
    } catch (error) {
      console.error("Error summarizing:", error);
      res.status(500).json({ message: "Failed to summarize" });
    }
  });

  app.post('/api/notes/flashcards', supabaseAuth, async (req: any, res: Response) => {
    try {
      const { text } = req.body;

      const flashcards = await generateFlashcards(text);

      res.json(flashcards);
    } catch (error) {
      console.error("Error generating flashcards:", error);
      res.status(500).json({ message: "Failed to generate flashcards" });
    }
  });

  // Purchase/Marketplace routes
  app.post('/api/purchases', supabaseAuth, async (req: any, res: Response) => {
    try {
      const userId = req.userId;
      const { courseId, amount } = req.body;

      const user = await storage.getUser(userId);
      if (!user || !user.email) {
        return res.status(400).json({ message: "User email required for payment" });
      }

      // Create unique reference
      const reference = `LENORY_${nanoid(16)}`;

      // Create purchase with pending status
      const purchase = await storage.createPurchase({
        buyerId: userId,
        courseId,
        amount,
        paymentStatus: 'pending',
        paystackReference: reference,
      });

      // Initialize Paystack transaction
      try {
        const { initializePayment, convertNairaToKobo } = await import('./paystack');
        const amountInKobo = await convertNairaToKobo(parseFloat(amount));
        
        const paymentInit = await initializePayment(
          user.email,
          amountInKobo,
          reference,
          { courseId, userId, purchaseId: purchase.id }
        );

        res.json({
          purchase,
          authorizationUrl: paymentInit.data.authorization_url,
          accessCode: paymentInit.data.access_code,
          reference: paymentInit.data.reference,
        });
      } catch (paystackError) {
        console.error("Paystack initialization error:", paystackError);
        res.json({
          purchase,
          authorizationUrl: `/marketplace?error=paystack_unavailable`,
          reference,
        });
      }
    } catch (error) {
      console.error("Error creating purchase:", error);
      res.status(500).json({ message: "Failed to create purchase" });
    }
  });

  app.post('/api/purchases/verify', supabaseAuth, async (req: any, res: Response) => {
    try {
      const { reference } = req.body;

      // Verify with Paystack API
      try {
        const { verifyPayment } = await import('./paystack');
        const verification = await verifyPayment(reference);

        if (verification.data.status === 'success') {
          // Find and update purchase
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
      } catch (paystackError) {
        console.error("Paystack verification error:", paystackError);
        res.status(500).json({ message: "Payment verification failed" });
      }
    } catch (error) {
      console.error("Error verifying purchase:", error);
      res.status(500).json({ message: "Failed to verify purchase" });
    }
  });

  // Analytics routes
  app.post('/api/analytics/event', supabaseAuth, async (req: any, res: Response) => {
    try {
      const userId = req.userId;
      const { eventType, eventData } = req.body;

      await storage.createAnalyticsEvent({
        userId,
        eventType,
        eventData,
        schoolId: null,
      });

      res.json({ success: true });
    } catch (error) {
      console.error("Error creating analytics event:", error);
      res.status(500).json({ message: "Failed to create analytics event" });
    }
  });

  // Memory/Performance tracking routes
  app.get('/api/memory/entries', supabaseAuth, async (req: any, res: Response) => {
    try {
      const userId = req.userId;
      const entries = await storage.getMemoryEntriesByUser(userId);
      res.json(entries);
    } catch (error) {
      console.error("Error fetching memory entries:", error);
      res.status(500).json({ message: "Failed to fetch memory entries" });
    }
  });

  // Generate lesson from transcript
  app.post('/api/generate-lesson', supabaseAuth, async (req: any, res: Response) => {
    try {
      const { text } = req.body;
      
      if (!text) {
        return res.status(400).json({ message: "Transcript text is required" });
      }

      const lesson = await generateLesson(text);
      res.json(lesson);
    } catch (error) {
      console.error("Error generating lesson:", error);
      res.status(500).json({ message: "Failed to generate lesson" });
    }
  });

  // Generate lesson from text using LENORY AI (for manual text entries)
  app.post('/api/generate-lesson-from-text', supabaseAuth, async (req: any, res: Response) => {
    try {
      const userId = req.userId;
      const { text, recordingId } = req.body;
      
      if (!text?.trim()) {
        return res.status(400).json({ message: "Text is required" });
      }

      console.log("📚 Generating lesson from manual text with LENORY AI...");
      const geminiData = await generateLessonFromTextWithGemini(text);

      const lesson = await storage.createGeneratedLesson({
        userId,
        recordingId: recordingId || null,
        title: geminiData.title,
        objectives: geminiData.objectives,
        keyPoints: geminiData.keyPoints,
        summary: geminiData.summary,
        originalText: text,
      });

      console.log("✅ Lesson created and saved:", lesson.id);
      res.json(lesson);
    } catch (error) {
      console.error("Error generating lesson from text:", error);
      res.status(500).json({ message: "Failed to generate lesson" });
    }
  });

  // AI Fix endpoint - Fix text with LENORY AI
  app.post('/api/ai-fix-text', supabaseAuth, async (req: any, res: Response) => {
    try {
      const { text } = req.body;
      
      if (!text?.trim()) {
        return res.status(400).json({ message: "Text is required" });
      }

      console.log("🔧 Fixing text with LENORY AI...");
      const fixed = await fixTextWithLENORY(text);

      res.json(fixed);
    } catch (error) {
      console.error("Error fixing text:", error);
      res.status(500).json({ message: "Failed to fix text" });
    }
  });

  // Summarize and correct text using OpenAI
  app.post('/api/summarize-and-correct', supabaseAuth, async (req: any, res: Response) => {
    try {
      const { text } = req.body;
      
      if (!text) {
        return res.status(400).json({ message: "Text is required" });
      }

      // Use OpenAI to summarize and correct
      const response = await chatWithAI([
        {
          role: "user",
          content: `Fix spelling and grammar, then summarize in 2-3 sentences. Extract key points.

Text: ${text.slice(0, 500)}

Format your response as:
CORRECTED: [fixed text]
SUMMARY: [2-3 sentences]
KEY_WORDS: [keywords separated by commas]`,
        },
      ]);

      const correctedMatch = response.match(/CORRECTED:\s*([\s\S]*?)(?:\nSUMMARY:|$)/);
      const summaryMatch = response.match(/SUMMARY:\s*([\s\S]*?)(?:\nKEY_WORDS:|$)/);
      const keywordsMatch = response.match(/KEY_WORDS:\s*(.+?)$/);
      if (!keywordsMatch) response.match(/KEY_WORDS:\s*([\s\S]+)$/);

      const correctedText = correctedMatch ? correctedMatch[1].trim() : text;
      const summary = summaryMatch ? summaryMatch[1].trim() : "";
      const keywords = keywordsMatch ? keywordsMatch[1].trim().split(',').map(k => k.trim()) : [];

      res.json({
        correctedText,
        summary,
        keywords,
      });
    } catch (error) {
      console.error("Error summarizing and correcting:", error);
      res.status(500).json({ message: "Failed to process text" });
    }
  });

  const httpServer = createServer(app);

  // WebSocket integration for real-time transcription
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

  // Gemini Live WebSocket for real-time voice chat
  const geminiLiveWss = new WebSocketServer({ server: httpServer, path: '/ws/gemini-live' });

  geminiLiveWss.on('connection', (ws: WebSocket, req) => {
    console.log('New Gemini Live WebSocket connection');
    const url = new URL(req.url || '', `http://${req.headers.host}`);
    const userId = url.searchParams.get('userId') || 'anonymous';
    handleGeminiLiveConnection(ws, userId);
  });

  wss.on('connection', (ws: WebSocket) => {
    console.log('New WebSocket connection established');
    const audioBuffer: Buffer[] = [];

    ws.on('message', async (message: string) => {
      try {
        const data = JSON.parse(message.toString());

        if (data.type === 'audio_chunk' && data.data) {
          // Data comes as data:audio/webm;base64,...
          const base64Data = data.data.split(',')[1];
          if (base64Data) {
            // Collect audio chunks
            audioBuffer.push(Buffer.from(base64Data, 'base64'));

            // Process every 2 chunks to send back transcripts (faster live preview)
            if (audioBuffer.length >= 2) {
              // Combine audio chunks and transcribe
              const combinedAudio = Buffer.concat(audioBuffer);
              
              // Save to temporary file for Whisper API
              const tempDir = os.tmpdir();
              const tempFile = path.join(tempDir, `audio_${Date.now()}.webm`);
              
              fs.writeFileSync(tempFile, combinedAudio);
              
              try {
                // Transcribe audio using Whisper API
                const transcription = await transcribeAudio(tempFile);
                
                // Send transcript segment back to client
                ws.send(JSON.stringify({
                  type: 'transcript_segment',
                  data: {
                    speaker: 'Speaker',
                    text: transcription.text,
                    timestamp: Date.now(),
                  },
                }));
                
                // Clean up temp file
                fs.unlinkSync(tempFile);
              } catch (transcriptionError) {
                console.error('Transcription error:', transcriptionError);
                // Send error response
                ws.send(JSON.stringify({
                  type: 'error',
                  data: { message: 'Transcription failed' },
                }));
              }
              
              // Clear audio buffer for next batch
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

  // Topic explanation endpoint
  app.post('/api/explain-topic', supabaseAuth, async (req: any, res: Response) => {
    try {
      const userId = req.userId;
      const { subject, topic, difficulty = 'medium' } = req.body;

      if (!subject?.trim() || !topic?.trim()) {
        return res.status(400).json({ message: "Subject and topic are required" });
      }

      // Check if already explained
      const existing = await storage.getTopicExplanation(userId, subject, topic);
      if (existing) {
        return res.json(existing);
      }

      // Generate explanation
      const explanation = await explainTopicWithLENORY(subject, topic, difficulty);
      
      // @ts-ignore - Generate image with provided topic as prompt
      const imagePrompt = `${subject} - ${topic}`;
      const image = await generateImageWithLENORY(imagePrompt);

      // Store explanation
      // @ts-ignore - Store explanation with available fields
      const stored = await storage.createTopicExplanation({
        userId,
        subject,
        topic,
        explanation: explanation.explanation,
        examples: explanation.examples,
        relatedTopics: explanation.relatedTopics
      });

      // Store image record
      await storage.createGeneratedImage({
        userId,
        prompt: imagePrompt,
        imageUrl: image.url,
        relatedTopic: topic
      });

      // Log learning history
      // @ts-ignore - Create learning history record
      await storage.createLearningHistory({
        userId,
        subject,
        topic
      });

      res.json(stored);
    } catch (error) {
      console.error("Error explaining topic:", error);
      res.status(500).json({ message: "Failed to explain topic" });
    }
  });

  // Generate custom image endpoint
  app.post('/api/generate-image', supabaseAuth, async (req: any, res: Response) => {
    try {
      const userId = req.userId;
      const { prompt, relatedTopic } = req.body;

      if (!prompt?.trim()) {
        return res.status(400).json({ message: "Prompt is required" });
      }

      const image = await generateImageWithLENORY(prompt);
      logApiUsage("stability-image", userId, "/api/generate-image");      const stored = await storage.createGeneratedImage({
        userId,
        prompt,
        imageUrl: image.url,
        relatedTopic
      });

      res.json(stored);
    } catch (error) {
      console.error("Error generating image:", error);
      res.status(500).json({ message: "Failed to generate image" });
    }
  });

  // Get all generated images by user
  app.get('/api/generated-images', supabaseAuth, async (req: any, res: Response) => {
    try {
      const userId = req.userId;
      const images = await storage.getGeneratedImagesByUser(userId);
      res.json(images);
    } catch (error) {
      console.error("Error fetching generated images:", error);
      res.status(500).json({ message: "Failed to fetch generated images" });
    }
  });

  // Delete a generated image
  app.delete('/api/generated-images/:id', supabaseAuth, async (req: any, res: Response) => {
    try {
      const userId = req.userId;
      const imageId = req.params.id;

      if (!imageId) {
        return res.status(400).json({ message: "Image ID is required" });
      }

      console.log(`🗑️ Deleting image ${imageId} for user ${userId}`);
      await storage.deleteGeneratedImage(userId, imageId);
      console.log(`✅ Image ${imageId} deleted successfully`);
      res.json({ message: "Image deleted successfully", id: imageId });
    } catch (error) {
      console.error("Error deleting image:", error);
      res.status(500).json({ message: "Failed to delete image" });
    }
  });

  // Learning history endpoint
  app.get('/api/learning-history', supabaseAuth, async (req: any, res: Response) => {
    try {
      const userId = req.userId;
      const limit = req.query.limit ? parseInt(req.query.limit) : 50;
      const history = await storage.getLearningHistoryByUser(userId, limit);
      res.json(history);
    } catch (error) {
      console.error("Error fetching learning history:", error);
      res.status(500).json({ message: "Failed to fetch learning history" });
    }
  });

  // Learning insights endpoint (for dashboard analytics)
  app.get('/api/learning/insights', supabaseAuth, async (req: any, res: Response) => {
    try {
      const userId = req.userId;
      const { generateLearningInsights } = await import("./tutorSystem");
      const insights = await generateLearningInsights(userId);
      res.json(insights);
    } catch (error) {
      console.error("Error fetching learning insights:", error);
      res.status(500).json({ message: "Failed to fetch learning insights" });
    }
  });

  // Focus areas analysis endpoint
  app.get('/api/focus-areas', supabaseAuth, async (req: any, res: Response) => {
    try {
      const userId = req.userId;
      const history = await storage.getLearningHistoryByUser(userId, 100);
      
      // Analyze subjects and topics
      const subjectMap = new Map<string, { count: number; topics: string[] }>();
      
      history.forEach((entry: any) => {
        if (!subjectMap.has(entry.subject)) {
          subjectMap.set(entry.subject, { count: 0, topics: [] });
        }
        const data = subjectMap.get(entry.subject)!;
        data.count++;
        if (!data.topics.includes(entry.topic)) {
          data.topics.push(entry.topic);
        }
      });

      const focusAreas = Array.from(subjectMap.entries()).map(([subject, data]) => ({
        subject,
        topicsLearned: data.count,
        recentTopics: data.topics.slice(-5),
        strength: data.count > 5 ? 'strong' : data.count > 2 ? 'developing' : 'beginner'
      }));

      res.json(focusAreas);
    } catch (error) {
      console.error("Error analyzing focus areas:", error);
      res.status(500).json({ message: "Failed to analyze focus areas" });
    }
  });

  // Export user data endpoint (PDF/JSON)
  app.post('/api/export-data', supabaseAuth, async (req: any, res: Response) => {
    try {
      const userId = req.userId;
      const { format = 'json', dataType = 'all' } = req.body;

      const history = await storage.getLearningHistoryByUser(userId, 100);
      const explanations = await storage.getTopicExplanationsByUser(userId);
      const user = await storage.getUser(userId);

      const exportData = {
        user: user?.firstName + ' ' + user?.lastName,
        exportedAt: new Date().toISOString(),
        learningHistory: history,
        topicExplanations: explanations.map(e => ({
          subject: e.subject,
          topic: e.topic,
          explanation: e.explanation,
          generatedAt: e.createdAt
        }))
      };

      if (format === 'json') {
        res.json(exportData);
      } else {
        // For PDF, return JSON with base64 encoded PDF (can be generated client-side)
        res.json({ ...exportData, format: 'json', note: 'Use client-side PDF generation library' });
      }
    } catch (error) {
      console.error("Error exporting data:", error);
      res.status(500).json({ message: "Failed to export data" });
    }
  });

  // Notification routes
  app.get('/api/notifications', supabaseAuth, async (req: any, res: Response) => {
    try {
      const userId = req.userId;
      const limit = req.query.limit ? parseInt(req.query.limit as string) : 50;
      const notifications = await storage.getNotificationsByUser(userId, limit);
      res.json(notifications);
    } catch (error) {
      console.error("Error fetching notifications:", error);
      res.status(500).json({ message: "Failed to fetch notifications" });
    }
  });

  app.post('/api/notifications', supabaseAuth, async (req: any, res: Response) => {
    try {
      const userId = req.userId;
      const { type, title, message, icon, actionUrl } = req.body;

      const notification = await storage.createNotification({
        userId,
        type: type || 'system',
        title,
        message,
        icon,
        actionUrl,
        read: false,
      });

      res.status(201).json(notification);
    } catch (error) {
      console.error("Error creating notification:", error);
      res.status(500).json({ message: "Failed to create notification" });
    }
  });

  app.get('/api/notifications/:id', supabaseAuth, async (req: any, res: Response) => {
    try {
      const notification = await storage.getNotification(req.params.id);
      if (!notification) {
        return res.status(404).json({ message: "Notification not found" });
      }
      res.json(notification);
    } catch (error) {
      console.error("Error fetching notification:", error);
      res.status(500).json({ message: "Failed to fetch notification" });
    }
  });

  app.patch('/api/notifications/:id/read', supabaseAuth, async (req: any, res: Response) => {
    try {
      const notification = await storage.markNotificationAsRead(req.params.id);
      if (!notification) {
        return res.status(404).json({ message: "Notification not found" });
      }
      res.json(notification);
    } catch (error) {
      console.error("Error marking notification as read:", error);
      res.status(500).json({ message: "Failed to mark notification as read" });
    }
  });

  app.delete('/api/notifications/:id', supabaseAuth, async (req: any, res: Response) => {
    try {
      await storage.deleteNotification(req.params.id);
      res.json({ message: "Notification deleted successfully" });
    } catch (error) {
      console.error("Error deleting notification:", error);
      res.status(500).json({ message: "Failed to delete notification" });
    }
  });

  // LIVE AI Routes
  app.post('/api/live-ai/voice-start', supabaseAuth, async (req: any, res: Response) => {
    try {
      const userId = req.userId;

      const conversation = await storage.createVoiceConversation({
        userId,
      });

      res.status(201).json(conversation);
    } catch (error) {
      console.error("Error starting voice conversation:", error);
      res.status(500).json({ message: "Failed to start voice conversation" });
    }
  });

  app.post('/api/live-ai/document-upload', supabaseAuth, upload.single('file'), async (req: any, res: Response) => {
    try {
      const userId = req.userId;
      const { fileName: bodyFileName, fileType: bodyFileType } = req.body;

      // Get file from upload
      if (!req.file) {
        return res.status(400).json({ message: "No file provided" });
      }

      const fileName = bodyFileName || req.file.originalname || 'document';
      const fileType = bodyFileType || req.file.mimetype || 'application/octet-stream';
      const fileSize = req.file.size;

      // Create document record initially with isProcessing=true
      const doc = await storage.createDocumentUpload({
        userId,
        fileName,
        fileType,
        fileUrl: `file://${nanoid()}`,
        fileSize,
        isProcessing: true,
        extractedText: '',
        aiAnalysis: null,
      });

      // Analyze file with Gemini vision in background (non-blocking)
      (async () => {
        try {
          console.log(`🔍 Starting Gemini vision analysis for: ${fileName}`);
          const result = await analyzeFileWithGeminiVision(
            req.file.buffer,
            fileType,
            fileName
          );
          const extractedText = result.extractedText;

          // Update document with extracted content
          console.log(`✅ Updating document with extracted content (${extractedText.length} chars)`);
          await storage.updateDocumentUpload(doc.id, {
            extractedText,
            aiAnalysis: result,
            isProcessing: false,
          });

          console.log(`✅ Gemini vision analysis completed for: ${fileName}`);
        } catch (error) {
          console.error(`❌ Error analyzing file with Gemini vision:`, error);
          // Update to mark processing as failed but keep document
          try {
            const errorMsg = error instanceof Error ? error.message : 'Unknown error';
            await storage.updateDocumentUpload(doc.id, {
              isProcessing: false,
              extractedText: 'Analysis failed - please try again',
              aiAnalysis: { error: errorMsg },
            });
          } catch (e) {
            console.error("Could not update document status:", e);
          }
        }
      })();

      res.status(201).json({
        ...doc,
        message: "File uploaded successfully. Analyzing content with Gemini...",
      });
    } catch (error) {
      console.error("Error uploading document:", error);
      res.status(500).json({ message: "Failed to upload document" });
    }
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

      const feature = await storage.createLiveAiFeature({
        userId,
        featureType,
        context,
        status: 'pending',
      });

      res.status(201).json(feature);
    } catch (error) {
      console.error("Error creating feature:", error);
      res.status(500).json({ message: "Failed to create feature" });
    }
  });

  // Real-time Audio API: Transcribe voice to text
  app.post('/api/audio/transcribe', supabaseAuth, upload.single('audio'), async (req: any, res: Response) => {
    try {
      if (!req.file) {
        return res.status(400).json({ message: "No audio file provided" });
      }

      const tempFile = path.join(os.tmpdir(), `voice_${Date.now()}.wav`);
      fs.writeFileSync(tempFile, req.file.buffer);

      try {
        const { text } = await transcribeAudio(tempFile);
        console.log("✓ Transcribed:", text);
        res.json({ text, success: true });
      } finally {
        if (fs.existsSync(tempFile)) {
          fs.unlinkSync(tempFile);
        }
      }
    } catch (error: any) {
      console.error("Transcription error:", error);
      res.status(500).json({ 
        message: error?.message || "Transcription failed",
        text: ""
      });
    }
  });

  // ── Groq Whisper transcription for Live Sessions ─────────────────────────
  app.post('/api/live-session/transcribe', supabaseAuth, upload.single('audio'), async (req: any, res: Response) => {
    try {
      const userId = req.userId;
      if (!req.file) {
        return res.status(400).json({ message: "No audio file provided" });
      }

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
          // Use Groq Whisper Large v3 Turbo (OpenAI-compatible SDK)
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
          // Fallback: OpenAI Whisper-1
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
          // Final fallback: Gemini transcription
          const result = await transcribeAudio(tempFile);
          transcriptText = result.text;
          durationSeconds = result.duration || 0;
          engineUsed = "gemini-2.5-flash";
        }
      } finally {
        if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
      }

      // Credit deduction: round up to nearest minute
      const user = await storage.getUser(userId);
      const ADMIN_EMAIL_CHECK = "felixahuruonye@gmail.com";
      let creditsDeducted = 0;
      if (user?.email !== ADMIN_EMAIL_CHECK && durationSeconds > 0) {
        const durationMinutes = Math.ceil(durationSeconds / 60);
        const tier = (user as any)?.subscriptionTier || 'free';
        const credits = await getOrCreateCredits(userId, tier);
        creditsDeducted = Math.min(durationMinutes, credits.balance);
        await deductCredits(userId, creditsDeducted);
        console.log(`💳 Deducted ${creditsDeducted} credits for ${durationMinutes} min transcription`);
      }

      logApiUsage(engineUsed, userId, "/api/transcribe");
      res.json({
        text: transcriptText,
        duration_seconds: durationSeconds,
        credits_deducted: creditsDeducted,
        engine: engineUsed,
        success: true,
      });
    } catch (error: any) {
      console.error("Live session transcription error:", error);
      res.status(500).json({ message: error?.message || "Transcription failed", text: "" });
    }
  });

  // Simple transcribe endpoint for Live AI (Whisper)
  app.post('/api/transcribe', upload.single('audio'), async (req: any, res: Response) => {
    try {
      if (!req.file) {
        return res.status(400).json({ message: "No audio file provided" });
      }

      const tempFile = path.join(os.tmpdir(), `voice_${Date.now()}.wav`);
      fs.writeFileSync(tempFile, req.file.buffer);

      try {
        const { text } = await transcribeAudio(tempFile);
        console.log("✓ Transcribed:", text);
        res.json({ text, success: true });
      } finally {
        if (fs.existsSync(tempFile)) {
          fs.unlinkSync(tempFile);
        }
      }
    } catch (error: any) {
      console.error("Transcription error:", error);
      res.status(500).json({ 
        message: error?.message || "Transcription failed",
        text: ""
      });
    }
  });

  // Real-time Audio API: Convert text to speech
  app.post('/api/audio/speak', supabaseAuth, async (req: any, res: Response) => {
    try {
      const { text, voice = "alloy" } = req.body;

      if (!text?.trim()) {
        return res.status(400).json({ message: "Text is required" });
      }

      // Generate speech using OpenAI TTS
      const audioBuffer = await generateSpeech(text);
      
      res.setHeader('Content-Type', 'audio/mpeg');
      res.setHeader('Content-Length', audioBuffer.length);
      res.send(audioBuffer);
    } catch (error: any) {
      console.error("Speech generation error:", error);
      res.status(500).json({ message: error?.message || "Speech generation failed" });
    }
  });


  // Send notifications for all previous chat history
  app.post('/api/notifications/send-chat-history', supabaseAuth, async (req: any, res: Response) => {
    try {
      const userId = req.userId;
      console.log(`[Notifications] Fetching chat history for user: ${userId}`);
      
      // Get all chat sessions for user
      const sessions = await storage.getChatSessionsByUser(userId);
      console.log(`[Notifications] Found ${sessions?.length || 0} sessions`);
      
      if (!sessions || sessions.length === 0) {
        console.log(`[Notifications] No sessions found for user`);
        return res.json({ message: "No chat sessions found", count: 0, sessions: [] });
      }

      // Create and store notifications for each chat
      const notificationCount = sessions.length;
      const sessionData: any[] = [];
      
      for (const session of sessions) {
        try {
          const notification = await storage.createNotification({
            userId,
            type: "chat_history" as any,
            title: session.title || "Previous Chat",
            message: `From ${new Date(session.createdAt).toLocaleDateString()}`,
            icon: "💬",
            actionUrl: `/chat?sessionId=${session.id}`,
            read: false,
          });
          console.log(`[Notifications] Created notification for session: ${session.id}`);
          sessionData.push({ id: session.id, title: session.title, createdAt: session.createdAt });
        } catch (err) {
          console.error("Failed to create notification for session:", session.id, err);
        }
      }

      console.log(`[Notifications] Sending ${notificationCount} notifications to client`);
      res.json({ 
        message: `Created ${notificationCount} notifications for chat history`, 
        count: notificationCount,
        sessions: sessionData
      });
    } catch (error) {
      console.error("Error sending chat history notifications:", error);
      res.status(500).json({ message: "Failed to send chat history notifications" });
    }
  });

  // CBT Mode API Routes - Generate questions with LENORY AI
  // (Other CBT methods simplified - focusing on question generation for MVP)

  // Recording API endpoints
  app.get('/api/recordings', supabaseAuth, async (req: any, res: Response) => {
    try {
      const userId = req.userId;
      const recordings = await storage.getRecordingsByUser(userId);
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

      console.log("Saving recording for user:", userId, "Title:", title, "Transcript length:", transcript?.length);

      if (!title?.trim()) {
        return res.status(400).json({ message: 'Title is required' });
      }

      // Ensure transcript is an array
      let transcriptArray = [];
      if (Array.isArray(transcript)) {
        transcriptArray = transcript;
      } else if (typeof transcript === 'string') {
        try {
          transcriptArray = JSON.parse(transcript);
        } catch {
          transcriptArray = [];
        }
      }

      const recording = await storage.createRecording({
        userId,
        sessionId: sessionId || null,
        title,
        audioData: audioData || '',
        transcript: transcriptArray,
        duration: duration || 0,
      });

      console.log("Recording created successfully:", recording.id);
      res.json(recording);
    } catch (error: any) {
      console.error("Error creating recording:", error);
      res.status(500).json({ message: error?.message || 'Failed to save recording' });
    }
  });

  app.delete('/api/recordings/:id', supabaseAuth, async (req: any, res: Response) => {
    try {
      const userId = req.userId;
      const { id } = req.params;
      
      // Verify recording belongs to user before deleting
      // (In production, add this verification)
      await storage.deleteRecording(id);
      
      res.json({ message: 'Recording deleted successfully' });
    } catch (error: any) {
      console.error("Error deleting recording:", error);
      res.status(500).json({ message: error?.message || 'Failed to delete recording' });
    }
  });

  // Generated Lessons API endpoints
  app.get('/api/generated-lessons', supabaseAuth, async (req: any, res: Response) => {
    try {
      const userId = req.userId;
      const lessons = await storage.getGeneratedLessonsByUser(userId);
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

      if (!title?.trim()) {
        return res.status(400).json({ message: 'Title is required' });
      }

      const lesson = await storage.createGeneratedLesson({
        userId,
        recordingId: recordingId || null,
        title,
        objectives: objectives || [],
        keyPoints: keyPoints || [],
        summary: summary || '',
      });

      res.json(lesson);
    } catch (error: any) {
      console.error("Error creating lesson:", error);
      res.status(500).json({ message: error?.message || 'Failed to save lesson' });
    }
  });

  app.delete('/api/generated-lessons/:id', supabaseAuth, async (req: any, res: Response) => {
    try {
      const { id } = req.params;
      await storage.deleteGeneratedLesson(id);
      res.json({ message: 'Lesson deleted successfully' });
    } catch (error: any) {
      console.error("Error deleting lesson:", error);
      res.status(500).json({ message: error?.message || 'Failed to delete lesson' });
    }
  });

  // Generate exam questions with LENORY - Feature: Real exam questions generated by AI (up to 250 per subject)
  app.post('/api/cbt/generate-questions', supabaseAuth, async (req: any, res: Response) => {
    try {
      const { examType, subject, count = 250 } = req.body;

      if (!examType || !subject) {
        return res.status(400).json({ message: 'Exam type and subject required' });
      }

      console.log(`📚 Generating ${count} questions for ${subject} (${examType})...`);
      const questions = await generateQuestionsWithLENORY(examType, subject, Math.min(count, 250));
      res.json({ questions });
    } catch (error: any) {
      console.error("Question generation error:", error);
      res.status(500).json({ message: error?.message || 'Failed to generate questions' });
    }
  });

  // CBT Grading with LENORY - Feature 1: AI-powered grading and explanations
  app.post('/api/cbt/grade', supabaseAuth, async (req: any, res: Response) => {
    try {
      const { questions, answers, sessionId, examType, subjects } = req.body;
      const userId = req.userId;

      if (!questions || !answers) {
        return res.status(400).json({ message: 'Questions and answers required' });
      }

      // Grade with LENORY AI
      const gradingResult = await gradeAnswersWithLENORY(questions, answers);

      // Save exam history - Feature 2: Exam history database
      const examHistory = await storage.createCbtExamHistory({
        userId,
        sessionId: sessionId || 'temp',
        examType: examType || 'custom',
        subjects: subjects || [],
        score: gradingResult.score,
        totalQuestions: questions.length,
        correctAnswers: Math.round((gradingResult.score / 100) * questions.length),
        timeSpent: 0,
        summary: gradingResult.summary,
        aiAnalysis: gradingResult,
        questions: questions,
        userAnswers: answers,
      });

      // Create notification - Feature 6: Notifications
      await storage.createNotification({
        userId,
        type: 'exam',
        title: `Exam Complete: ${gradingResult.score}%`,
        message: gradingResult.summary,
        icon: 'CheckCircle2',
      });

      // Update analytics - Feature 5: Advanced analytics
      for (const topic of gradingResult.strongTopics) {
        await storage.updateCbtAnalytics(userId, topic, true);
      }
      for (const topic of gradingResult.weakTopics) {
        await storage.updateCbtAnalytics(userId, topic, false);
      }

      res.json({
        gradingResult,
        examHistory,
        recommendations: gradingResult.recommendations,
      });
    } catch (error: any) {
      console.error("Grading error:", error);
      res.status(500).json({ message: error?.message || 'Grading failed' });
    }
  });

  // Exam History - Feature 2: Retrieve past exam attempts
  app.get('/api/cbt/history', supabaseAuth, async (req: any, res: Response) => {
    try {
      const userId = req.userId;
      const history = await storage.getCbtExamHistoryByUser(userId);
      res.json(history);
    } catch (error: any) {
      res.status(500).json({ message: error?.message || 'Failed to fetch history' });
    }
  });

  // Analytics Dashboard - Feature 5: Performance tracking per topic
  app.get('/api/cbt/analytics', supabaseAuth, async (req: any, res: Response) => {
    try {
      const userId = req.userId;
      const analytics = await storage.getCbtAnalyticsByUser(userId);
      res.json(analytics);
    } catch (error: any) {
      res.status(500).json({ message: error?.message || 'Failed to fetch analytics' });
    }
  });

  // Delete exam from history - Feature: Remove exam records
  app.delete('/api/cbt/history/:id', supabaseAuth, async (req: any, res: Response) => {
    try {
      const { id } = req.params;
      const userId = req.userId;
      
      // Verify ownership before deleting
      const history = await storage.getCbtExamHistoryByUser(userId);
      const examToDelete = history.find((h: any) => h.id === id);
      
      if (!examToDelete) {
        return res.status(404).json({ message: 'Exam not found' });
      }

      // Delete the exam
      await storage.deleteCbtExamHistory(id);
      
      console.log(`✅ Exam ${id} deleted by user ${userId}`);
      res.json({ message: 'Exam deleted successfully', id });
    } catch (error: any) {
      console.error("Delete exam error:", error);
      res.status(500).json({ message: error?.message || 'Failed to delete exam' });
    }
  });

  // Admin Content Management - Feature 3: Upload and manage question banks
  app.post('/api/admin/cbt/import-questions', supabaseAuth, async (req: any, res: Response) => {
    try {
      const { examId, subject, questions } = req.body;

      if (!examId || !subject || !Array.isArray(questions)) {
        return res.status(400).json({ message: 'Invalid import data' });
      }

      const imported = [];
      for (const q of questions) {
        const question = await storage.createCbtQuestion({
          examId,
          subject,
          questionNumber: q.number || 1,
          questionText: q.question,
          options: q.options || [],
          correctAnswer: q.correct || 'A',
          explanation: q.explanation || '',
        });

        // Add licensing metadata - Feature 4: Question licensing
        if (q.source) {
          await storage.createCbtQuestionLicensing({
            questionId: question.id,
            source: q.source, // 'licensed', 'public', 'simulated'
            licenseId: q.licenseId,
            licenseProvider: q.provider,
            year: q.year,
            copyright: q.copyright,
          });
        }

        imported.push(question);
      }

      res.json({ message: `Imported ${imported.length} questions`, questions: imported });
    } catch (error: any) {
      res.status(500).json({ message: error?.message || 'Import failed' });
    }
  });

  // Question Licensing Info - Feature 4: Retrieve licensing metadata
  app.get('/api/cbt/licensing/:questionId', supabaseAuth, async (req: any, res: Response) => {
    try {
      const licensing = await storage.getCbtQuestionLicensing(req.params.questionId);
      res.json(licensing);
    } catch (error: any) {
      res.status(500).json({ message: error?.message || 'Failed to fetch licensing info' });
    }
  });

  // Project Workspace Routes
  app.get('/api/projects', supabaseAuth, async (req: any, res: Response) => {
    try {
      const userId = req.userId;
      const projects = await storage.getProjectsByUser(userId);
      res.json(projects);
    } catch (error: any) {
      res.status(500).json({ message: 'Failed to fetch projects' });
    }
  });

  app.post('/api/projects', supabaseAuth, async (req: any, res: Response) => {
    try {
      const userId = req.userId;
      const { name, description } = req.body;
      const project = await storage.createProject({ userId, name, description });
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

  // Global Search API - queries all data types
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

      // Combine and limit results
      const allResults = [...chatResults, ...memoryResults, ...planResults, ...examResultsFiltered, ...websiteResults, ...imageResults, ...projectResults, ...lessonResults].slice(0, 20);

      res.json({ results: allResults });
    } catch (error) {
      console.error("Error searching:", error);
      res.status(500).json({ message: "Search failed", results: [] });
    }
  });

  // Pricing & Payment Routes
  app.post('/api/payments/initialize', supabaseAuth, async (req: any, res: Response) => {
    try {
      const userId = req.userId;
      const { tierId } = req.body;
      
      const user = await storage.getUser(userId);
      if (!user?.email) {
        return res.status(400).json({ message: "User email not found" });
      }

      const reference = `sub_${generateId()}`;
      
      // Pricing tiers hardcoded (can be expanded to database later)
      const tierPricing: { [key: string]: number } = {
        free: 0,
        pro: 5000,
        premium: 15000,
      };

      const priceNaira = tierPricing[tierId] || 5000;
      
      if (priceNaira === 0) {
        // Free tier - just update subscription
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
        // Update user subscription
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

  // ─────────────────────────────────────────────────────────────────────────────
  // PAYSTACK WEBHOOK — server-to-server, doesn't depend on the user's browser
  // returning to the site. This is what actually makes upgrades automatic.
  // ─────────────────────────────────────────────────────────────────────────────
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

      // Acknowledge immediately — Paystack expects a fast 200
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

        // Top up credits immediately to the new tier's allowance
        const { dailyAdd } = getTierLimits(tierId);
        await getOrCreateCredits(userId, tierId); // ensure a row exists first
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
      // Response may already be sent above; only send if not
      if (!res.headersSent) res.status(500).send("Error");
    }
  });

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

  // ─────────────────────────────────────────────────────────────────────────────
  // CREDIT SYSTEM
  // ─────────────────────────────────────────────────────────────────────────────
  const ADMIN_EMAIL = 'felixahuruonye@gmail.com';

  // Credits are now handled by ./creditsStore.ts, backed by real Supabase
  // storage — see getOrCreateCredits, deductCredits, addCredits, getTierLimits
  // imported near the top of this file. The old in-memory Map is gone.

  // Alias for /api/credits used by the Chat UI
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
      const { amount = 10 } = req.body; // credits to purchase
      const nairaAmount = amount * 100; // N100 per credit, N1000 = 10 credits
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
          amount: nairaAmount * 100, // kobo
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
        await addCredits(userId, Number(creditAmount), tier, true); // uncapped — this was a direct purchase
        res.redirect('/dashboard?topup=success');
      } else {
        res.redirect('/pricing?topup=failed');
      }
    } catch (error) {
      res.redirect('/pricing?topup=error');
    }
  });

  // Admin: manually adjust credits
  app.post('/api/admin/credits/:userId', supabaseAuth, async (req: any, res: Response) => {
    try {
      const adminUser = await storage.getUser(req.userId);
      if (adminUser?.email !== ADMIN_EMAIL) return res.status(403).json({ error: "Forbidden" });
      const { userId } = req.params;
      const { amount, action } = req.body; // action: 'add' | 'set' | 'deduct'
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

  // ─────────────────────────────────────────────────────────────────────────────
  // GEMINI VISION – Analyze file/image from chat
  // ─────────────────────────────────────────────────────────────────────────────
  app.post('/api/chat/analyze-vision', supabaseAuth, async (req: any, res: Response) => {
    try {
      const { base64, mimeType, fileName, prompt, sessionId } = req.body;
      if (!base64 || !mimeType) return res.status(400).json({ error: "Missing base64 or mimeType" });

      const buffer = Buffer.from(base64, 'base64');
      const { analyzeFileWithGeminiVision } = await import('./gemini');
      const { extractedText } = await analyzeFileWithGeminiVision(buffer, mimeType, fileName || 'file');

      // If this chat session is grounded in an uploaded note, answer strictly from that note
      let noteContext = "";
      if (sessionId) {
        const noteContextMarker = "__NOTE_CONTEXT__";
        const session = await storage.getChatSession(sessionId);
        if (session?.summary?.startsWith(noteContextMarker)) {
          noteContext = session.summary.substring(noteContextMarker.length);
        }
      }

      // If a specific prompt was provided, do an additional pass using the prompt + extracted content
      let analysis = extractedText;
      if (prompt && extractedText) {
        const { chatWithAI } = await import('./gemini');
        const groundedInstruction = noteContext
          ? `You are helping a student practice using their own uploaded notes. Answer the question in the image/file below using ONLY the note content provided — do not use outside knowledge unless the note doesn't cover it (say so clearly if it doesn't).\n\nSTUDENT'S NOTE:\n${noteContext}\n\n`
          : "";
        const enhanced = await chatWithAI([
          { role: "user", content: `${groundedInstruction}${prompt}\n\nFile content/description:\n${extractedText}` }
        ]);
        analysis = enhanced || extractedText;
      }

      res.json({ analysis: analysis || "I could not extract content from this file." });
    } catch (error) {
      console.error("Vision analyze error:", error);
      res.status(500).json({ error: "Failed to analyze file" });
    }
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // ASSEMBLYAI – Real-time transcription token
  // ─────────────────────────────────────────────────────────────────────────────
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

  // ─────────────────────────────────────────────────────────────────────────────
  // ELEVENLABS – TTS
  // ─────────────────────────────────────────────────────────────────────────────
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

  // ─────────────────────────────────────────────────────────────────────────────
  // VIDEO GENERATION – Replicate
  // ─────────────────────────────────────────────────────────────────────────────
  app.post('/api/video/generate', supabaseAuth, async (req: any, res: Response) => {
    try {
      const replicateToken = process.env.REPLICATE_API_TOKEN || process.env['Replicate api'] || process.env['REPLICATE_API'];
      if (!replicateToken) return res.status(500).json({ error: "Video generation not configured. Add REPLICATE_API_TOKEN in Render environment variables." });
      const { prompt } = req.body;
      if (!prompt) return res.status(400).json({ error: "prompt is required" });
      // Deduct credits (video = 5 credits)
      const userId = req.userId;
      const user = await storage.getUser(userId);
      if (user?.email !== ADMIN_EMAIL) {
        const tier = (user as any)?.subscriptionTier || 'free';
        const credits = await getOrCreateCredits(userId, tier);
        if (credits.balance < 5) {
          return res.status(402).json({ error: "Insufficient credits. Video generation costs 5 credits." });
        }
        await deductCredits(userId, 5);
      }
      // Start prediction with Replicate
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
      });
      const prediction = await createRes.json();
      if (prediction.error) return res.status(500).json({ error: prediction.error });
      logApiUsage("replicate-video", userId, "/api/video/generate");
      res.json({ id: prediction.id, status: prediction.status, output: prediction.output });
    } catch (error) {
      console.error('Video generation error:', error);
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

  // ─────────────────────────────────────────────────────────────────────────────
  // GROQ WHISPER – Transcribe audio (record-first strategy)
  // ─────────────────────────────────────────────────────────────────────────────
  const groqUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 26 * 1024 * 1024 },
  });

  app.post('/api/groq/transcribe', supabaseAuth, groqUpload.single('audio'), async (req: any, res: Response) => {
    try {
      const apiKey = process.env.GROQ_API_KEY;
      if (!apiKey) return res.status(500).json({ error: "Groq not configured. Add GROQ_API_KEY to Replit Secrets." });
      if (!req.file) return res.status(400).json({ error: "No audio file provided." });

      const { language = 'en' } = req.body;

      // Node 18+ has native FormData/Blob; write buffer to a temp file so Groq can read it
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

      // Deduct 1 credit per 5 minutes (rounded up)
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

  // Write My Note – format transcript into structured notes via Gemini
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

  // ─────────────────────────────────────────────────────────────────────────────
  // LOGOUT
  // ─────────────────────────────────────────────────────────────────────────────
  app.get('/api/logout', (req: Request, res: Response) => {
    res.redirect('/');
  });

  return httpServer;
}
