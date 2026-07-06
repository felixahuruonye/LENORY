// server/adminTools.ts
// Real, auditable admin data functions. No AI "simulation" — every function here
// returns actual facts (or explicitly says it couldn't get them). This exists
// specifically to stop the AI from fabricating admin answers.

import { storage } from "./storage";

export const ADMIN_EMAIL = "felixahuruonye@gmail.com";

// ── API key registry ─────────────────────────────────────────────────────────
// Add new keys here as the app grows — this is the single source of truth.
const KEY_REGISTRY: { name: string; envVar: string; usedFor: string; critical: boolean }[] = [
  { name: "Gemini (Google AI)", envVar: "GOOGLE_API_KEY", usedFor: "Main chat brain, vision, image gen", critical: true },
  { name: "Supabase URL", envVar: "SUPABASE_URL", usedFor: "Database (backend)", critical: true },
  { name: "Supabase Service Role", envVar: "SUPABASE_SERVICE_ROLE_KEY", usedFor: "Database writes (backend)", critical: true },
  { name: "Supabase Anon (backend)", envVar: "SUPABASE_ANON_KEY", usedFor: "Database auth (backend)", critical: false },
  { name: "Supabase URL (frontend build)", envVar: "VITE_SUPABASE_URL", usedFor: "Frontend Supabase client", critical: true },
  { name: "Supabase Anon (frontend build)", envVar: "VITE_SUPABASE_ANON_KEY", usedFor: "Frontend Supabase client", critical: true },
  { name: "Paystack", envVar: "PAYSTACK_SECRET_KEY", usedFor: "Payments and subscriptions", critical: true },
  { name: "Vapi", envVar: "VAPI_PUBLIC_KEY", usedFor: "Live voice sessions", critical: false },
  { name: "Groq (Whisper)", envVar: "GROQ_API_KEY", usedFor: "Speech-to-text transcription", critical: false },
  { name: "AssemblyAI", envVar: "ASSEMBLYAI_API_KEY", usedFor: "Backup transcription", critical: false },
  { name: "ElevenLabs", envVar: "ELEVENLABS_API_KEY", usedFor: "Text-to-speech voices", critical: false },
  { name: "Stability AI", envVar: "STABILITY_API_KEY", usedFor: "Image generation (alt engine)", critical: false },
  { name: "Replicate", envVar: "REPLICATE_API_TOKEN", usedFor: "Image/video generation (alt engine)", critical: false },
  { name: "OpenRouter", envVar: "OPENROUTER_API_KEY", usedFor: "Advanced/DeepSeek coding fallback", critical: false },
  { name: "OpenAI", envVar: "OPENAI_API_KEY", usedFor: "Fallback model access", critical: false },
];

export function getApiKeyStatus() {
  return KEY_REGISTRY.map((k) => ({
    name: k.name,
    usedFor: k.usedFor,
    critical: k.critical,
    configured: !!process.env[k.envVar] && process.env[k.envVar]!.trim().length > 0,
    // We deliberately never expose the actual key value here — only presence.
  }));
}

// ── Real-time error log (ring buffer, in-memory) ────────────────────────────
// Not a replacement for real log aggregation, but gives Felix visibility
// without needing a third-party logging service he'd have to pay for.
interface LoggedError {
  timestamp: string;
  source: string;
  message: string;
}
const MAX_ERRORS = 100;
const recentErrors: LoggedError[] = [];

export function logAdminError(source: string, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  recentErrors.unshift({ timestamp: new Date().toISOString(), source, message });
  if (recentErrors.length > MAX_ERRORS) recentErrors.length = MAX_ERRORS;
}

export function getRecentErrors() {
  return recentErrors;
}

// ── Real usage overview — every number here comes from an actual query ─────
export async function getAdminOverview() {
  const users = await storage.getUsers();

  const now = Date.now();
  const oneWeekAgo = now - 7 * 24 * 60 * 60 * 1000;
  const oneDayAgo = now - 24 * 60 * 60 * 1000;

  const byTier: Record<string, number> = { free: 0, pro: 0, premium: 0 };
  let signupsThisWeek = 0;
  let signupsToday = 0;

  for (const u of users) {
    const tier = (u as any).subscriptionTier || "free";
    byTier[tier] = (byTier[tier] || 0) + 1;
    const created = new Date(u.createdAt).getTime();
    if (created >= oneWeekAgo) signupsThisWeek++;
    if (created >= oneDayAgo) signupsToday++;
  }

  // Revenue estimate based on real published prices (₦5,000 Pro, ₦15,000 Premium)
  const monthlyRevenueEstimate = byTier.pro * 5000 + byTier.premium * 15000;

  return {
    totalUsers: users.length,
    signupsToday,
    signupsThisWeek,
    usersByTier: byTier,
    estimatedMonthlyRevenueNaira: monthlyRevenueEstimate,
    generatedAt: new Date().toISOString(),
  };
}

// Compact text block safe to inject directly into the admin AI's system prompt.
// Every line here is a real fetched fact — nothing invented.
export async function buildAdminContextBlock(): Promise<string> {
  try {
    const overview = await getAdminOverview();
    const keys = getApiKeyStatus();
    const missingCritical = keys.filter((k) => k.critical && !k.configured);
    const errors = getRecentErrors().slice(0, 5);

    return `
## VERIFIED SYSTEM DATA (fetched live just now — use ONLY these numbers, never invent others):
- Total users: ${overview.totalUsers}
- Signups today: ${overview.signupsToday}
- Signups this week: ${overview.signupsThisWeek}
- Users by tier: Free=${overview.usersByTier.free}, Pro=${overview.usersByTier.pro}, Premium=${overview.usersByTier.premium}
- Estimated monthly revenue: ₦${overview.estimatedMonthlyRevenueNaira.toLocaleString()}
- Missing critical API keys: ${missingCritical.length === 0 ? "none" : missingCritical.map((k) => k.name).join(", ")}
- Recent errors (last 5): ${errors.length === 0 ? "none logged" : errors.map((e) => `[${e.source}] ${e.message}`).join(" | ")}
(Data generated at ${overview.generatedAt}. If Felix asks for something not listed above — e.g. a named user's individual history — say you don't have that specific data rather than guessing.)`;
  } catch (e) {
    return `\n## SYSTEM DATA UNAVAILABLE: Could not fetch live stats (${e instanceof Error ? e.message : String(e)}). Tell Felix the data fetch failed — do NOT invent numbers to fill the gap.`;
  }
}
