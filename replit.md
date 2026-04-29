# LENORY - Advanced AI-Powered EdTech Platform

## Overview
LENORY is a comprehensive EdTech platform that leverages multi-modal AI to transform education. It offers an 8D dashboard, advanced chat with AI tutoring modes, a comprehensive learning memory system, gamification, personalized study planning, and subject-specific expertise. The platform is designed for students, teachers, lecturers, and educational institutions, with a focus on enterprise-grade features tailored for the Nigerian education sector. Features include: time-based greeting, credit system, AssemblyAI voice ("Hey LENORY"), ChatGPT-like markdown chat, video generation (Replicate/Zeroscope), credit top-up packs, and admin dashboard with user management.

## User Preferences
Preferred communication style: Simple, everyday language. Prefers futuristic design with glassmorphism and neon effects. Wants faster, stronger backend logic without UI changes. Wants all learning data to persist permanently (auto-learned preferences, chat history, exam results, memory entries).

## System Architecture
### Frontend
The frontend is a React 18 application using TypeScript, Vite, Wouter for routing, TanStack Query for server state, and React hooks. UI components are built with Radix UI and styled using shadcn/ui and Tailwind CSS, featuring a glassmorphic design that adapts to dark/light modes. The design emphasizes a voice-first interface, progressive disclosure, clean typography (Inter, Space Grotesn, JetBrains Mono), and purposeful animations.

### Backend
The backend is an Express.js application written in TypeScript, providing RESTful endpoints and WebSocket support. It incorporates 8 specialized modules:
1.  **tutorSystem.ts**: AI tutor workflow, subject/difficulty detection, multi-format responses, weak topic detection, and learning insights.
2.  **learnorySystem.ts**: Master integrator, generates system prompts, personalizes responses, manages user dashboards, and coordinates gamification and tracking.
3.  **mockExamEngine.ts**: Auto-generates and marks mock exams, analyzes performance, identifies weak topics, predicts scores, and provides recommendations.
4.  **gamificationSystem.ts**: XP rewards, 50 levels, streak tracking, 15+ badge types, and unlockable tools.
5.  **motivationCoach.ts**: Personalized motivational messages, daily study reminders, exam-specific encouragement, and milestone celebrations.
6.  **personalizedPlanning.ts**: Generates custom study plans (90-day to 7-day), distributes subjects, sets difficulty progression, and tracks pace.
7.  **curriculumBrain.ts**: Complete curriculum for Nigerian exams (JAMB, WAEC, NECO), covering topics, key points, common mistakes, and study path recommendations.
8.  **advancedTutors.ts**: Six subject-specific tutor prompts (Mathematics, Physics, Chemistry, Biology, English, Government) with tailored strategies, including ASCII diagram generation for visual learning.

### Database & Storage
**IMPORTANT**: Neon Serverless PostgreSQL is currently broken (password authentication failure for all queries). The system uses a hybrid storage approach:
- **Primary Storage**: `SupabaseStorage` class — wraps `MemoryStorage` with best-effort Supabase REST API persistence for user data
- **Fallback**: In-memory storage (`MemoryStorage`) for all operations when Supabase DB is unreachable
- **Note**: Supabase REST API is also unreachable from server-side Node.js (DNS failure). Data persists only within the server process session (not across restarts). To fix permanently, add `SUPABASE_JWT_SECRET` env var and set up the `users` table in Supabase.

Drizzle ORM schema (`shared/schema.ts`) defines the data model for TypeScript type safety but is NOT actively used for DB operations (Neon is broken). The stub `db` object in `server/db.ts` is a TypeScript compatibility shim.

### AI & External Services
A three-tier fallback system is implemented for AI:
-   **OpenAI** (GPT-3.5-turbo) for primary chat.
-   **OpenRouter** as a fallback for chat completions.
-   **Google Gemini** (gemini-2.5-flash) for website generation, file analysis, and Vision API capabilities (OCR, content analysis, extraction from images, PDFs, DOCX, DOC, and TXT files).

### Key Architectural Patterns
-   **Monorepo structure** (`/client`, `/server`, `/shared`) for type safety.
-   **Integrated LEARNORY Ultra-Advanced System** coordinating all 8 modules.
-   **Subject auto-detection** from message content.
-   **Real-time learning analytics** with permanent memory.
-   **Multi-modal responses** (simple explanation → detailed → formulas → examples → applications → mistakes → practice).
-   **Personalization engine** adapting to user level and performance.
-   **AI Project Reading**: Advanced Chat detects "read my project workspace" requests, allows project selection, loads tasks, and injects project context into AI system prompts for contextual responses.
-   **CBT Mode**: Simulation of Computer-Based Testing for JAMB, WAEC, NECO with subject selection, flexible durations, real-time timer, and progress tracking.
-   **Pricing & Subscription System**: Three pricing tiers (Free, Pro, Premium) integrated with Paystack, with database schemas for `pricingTiers` and `subscriptions`.

## Recent Changes (April 2026)
- **Storage Architecture Overhaul**: Replaced broken Neon DB with `SupabaseStorage` (extends `MemoryStorage`). Server now uses in-memory + Supabase REST API hybrid. Neon is completely dead.
- **Local JWT Verification**: `supabaseAuth` middleware now decodes Supabase JWTs locally (no network call) instead of calling `supabase.auth.getUser(token)`. Checks expiry, role (`authenticated`), and issuer. Falls back to network if local decode fails.
- **User Sync via Storage**: `ensureUserExists` now calls `storage.upsertUser()` instead of Drizzle ORM. Awaited in auth middleware to prevent race conditions.
- **Auth User Route Fix**: `/api/auth/user` returns a minimal user object from JWT claims when user isn't in storage yet (prevents empty 200 response).
- **Supabase Project Mismatch Detected**: `SUPABASE_SERVICE_ROLE_KEY` is for project `almrajoumwliddtmppsm` but URL points to `nfudflrajpmluhwwhhrc`. Lernory admin features (user lookup, etc.) may fail.
- **Login/Signup Pages**: Properly handle email confirmation, Lernory ID login, device trust, active session detection.
- **Enhanced Authentication System**:
  - **Lernory ID**: Unique 8-char ID (LRN-XXXXXX format) assigned to every user, stored in Supabase user_metadata via admin API. Enables login by ID without remembering email.
  - **Device Trust**: HMAC-signed JWT device tokens saved in `lernory_device_token` localStorage. Verified on `/api/auth/verify-device` for trusted device auto-login banner.
  - **Active Session Detection**: Login page checks Supabase session on load. If user already authenticated → shows "Continue with Lernory" banner (skips re-entry of credentials).
  - **Login Page Views**: 5 states — checking, trusted-device, active-session, confirm-email, email/Lernory ID form

### Known Configuration Issues
- **Google OAuth**: Must be enabled in Supabase dashboard for OAuth login to work. Currently only email/password authentication is available.
- **Neon DB**: Completely broken — "password authentication failed for neondb_owner" on ALL queries including SELECT. Cannot be fixed without Neon dashboard access.
- **Supabase REST Unreachable from Server**: Node.js server can't resolve `nfudflrajpmluhwwhhrc.supabase.co` (DNS failure). All in-memory data is lost on server restart.
- **Supabase Key Mismatch**: Service role key is for a different project (`almrajoumwliddtmppsm`) than the URL project (`nfudflrajpmluhwwhhrc`). Admin features (listUsers, getUserById) will fail.
- **Fix for persistence**: To enable full persistence, either: (a) provide the correct Supabase service role key for project `nfudflrajpmluhwwhhrc`, or (b) provide `SUPABASE_JWT_SECRET` env var for proper JWT signature verification.

## External Dependencies
### Core Infrastructure
-   **Neon Database**: Serverless PostgreSQL (`@neondatabase/serverless`)

### Authentication & Session
-   **Supabase Auth**: OAuth (Google) and email magic link authentication
-   **Session Storage**: Supabase Auth handles session persistence
-   **Auth Pages**: `/login` and `/signup` for user authentication

### AI Services
-   **OpenAI**: GPT-3.5-turbo
-   **OpenRouter**: Fallback AI service
-   **Google Gemini**: gemini-2.5-flash

### Payment Gateway
-   **Paystack**: For subscription payments in the Nigerian market.

### Voice & Text-to-Speech
-   **Web Speech API** (Browser native)

### UI Components
-   **Radix UI**: Accessible primitives
-   **shadcn/ui**: Pre-built components
-   **Lucide React**: Icons
-   **Recharts**: Data visualization