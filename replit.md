# LERNORY ULTRA - Advanced AI-Powered EdTech Platform

## Overview
LERNORY ULTRA is a comprehensive EdTech platform that leverages multi-modal AI to transform education. It offers an 8D dashboard, advanced chat with AI tutoring modes, a comprehensive learning memory system, gamification, personalized study planning, and subject-specific expertise. The platform is designed for students, teachers, lecturers, and educational institutions, with a focus on enterprise-grade features tailored for the Nigerian education sector, aiming to provide a futuristic and engaging learning experience. It includes a complete pricing and subscription system with Paystack integration and enhanced AI capabilities for project reading and interactive onboarding.

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

### Database & ORM
PostgreSQL (Neon Serverless) with Drizzle ORM. The schema supports users, chat sessions, learning history, study plans, memory entries, exam results, generated content, projects, pricing tiers, and subscriptions.

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
- **Authentication Sync**: Added automatic user sync from Supabase Auth to local PostgreSQL database in both `supabaseAuth` and `optionalSupabaseAuth` middleware to prevent foreign key constraint violations
- **Database Schema**: Added `subscription_tier`, `subscription_expires_at`, and `paystack_customer_id` columns to users table
- **Gemini AI**: Fixed chatWithGemini function calls to use proper message format with system role
- **Code Fixes**: Fixed Set iteration using Array.from(), corrected getCoursesByCreator to getCoursesByTeacher
- **Design Compliance**: Removed hover-elevate/active-elevate classes from Button components per design guidelines
- **Enhanced Authentication System**:
  - **Lernory ID**: Unique 8-char ID (LRN-XXXXXX format) assigned to every user, stored in Supabase user_metadata via admin API. Enables login by ID without remembering email.
  - **Device Trust**: HMAC-signed JWT device tokens saved in `lernory_device_token` localStorage. Verified on `/api/auth/verify-device` for trusted device auto-login banner.
  - **Active Session Detection**: Login page checks Supabase session on load. If user already authenticated → shows "Continue with Lernory" banner (skips re-entry of credentials).
  - **New Auth Routes**: `POST /api/auth/save-device`, `POST /api/auth/verify-device`, `GET /api/auth/lernory-lookup/:lernoryId`, `POST /api/auth/lernory-login`, `DELETE /api/auth/device`
  - **Login Page Views**: 4 states — checking (spinner), trusted-device (auto-login), active-session (Continue with Lernory), standard email/Lernory ID tabs
  - **No DB Dependency**: All device trust and Lernory ID features use Supabase admin API + HMAC JWT. No Neon DB calls for auth features.

### Known Configuration Issues
- **Google OAuth**: Must be enabled in Supabase dashboard for OAuth login to work. Currently only email/password authentication is available until Google provider is configured in Supabase.
- **Neon DB**: DDL migrations fail with "password authentication failed for neondb_owner" — schema is already up to date and existing data persists. New auth features bypass this by using Supabase admin API.

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