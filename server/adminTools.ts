// server/adminTools.ts
// Real, auditable admin data functions. No AI "simulation" — every function here
// returns actual facts (or explicitly says it couldn't get them). This exists
// specifically to stop the AI from fabricating admin answers.

import { storage } from "./storage";
import { supabaseDb } from "./db";

export const ADMIN_EMAIL = "felixahuruonye@gmail.com";

// ── Real API usage tracking ──────────────────────────────────────────────────
// Every call site that hits an external AI provider should call this. Fire-and-
// forget by design — a logging failure must never break the actual feature.
export function logApiUsage(provider: string, userId?: string, endpoint?: string) {
  if (!supabaseDb) return;
  supabaseDb
    .from("api_usage_events")
    .insert({ provider, endpoint: endpoint || null, user_id: userId || null })
    .then(() => {})
    .catch((e: unknown) => console.error("logApiUsage failed (non-fatal):", e));
}

export async function getApiUsageSummary() {
  if (!supabaseDb) {
    return { available: false, reason: "Supabase not connected", byProvider: [] };
  }
  try {
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const { data: last24hData } = await supabaseDb
      .from("api_usage_events")
      .select("provider")
      .gte("created_at", since24h);
    const { data: last7dData } = await supabaseDb
      .from("api_usage_events")
      .select("provider")
      .gte("created_at", since7d);

    const countBy = (rows: any[] | null) => {
      const counts: Record<string, number> = {};
      (rows || []).forEach((r) => { counts[r.provider] = (counts[r.provider] || 0) + 1; });
      return counts;
    };

    const last24h = countBy(last24hData);
    const last7d = countBy(last7dData);
    const providers = Array.from(new Set([...Object.keys(last24h), ...Object.keys(last7d)]));

    return {
      available: true,
      byProvider: providers.map((p) => ({ provider: p, last24h: last24h[p] || 0, last7d: last7d[p] || 0 })),
    };
  } catch (e) {
    return { available: false, reason: e instanceof Error ? e.message : String(e), byProvider: [] };
  }
}

// Real balance check — Stability AI has a genuine, documented balance endpoint.
// Other providers (Gemini, Replicate) don't expose a simple equivalent via API
// key alone, so we don't fabricate a number for them — we report call counts
// instead (see getApiUsageSummary), which is honest and fully in our control.
export async function getStabilityBalance(): Promise<{ available: boolean; credits?: number; error?: string }> {
  const key = process.env.STABILITY_API_KEY;
  if (!key) return { available: false, error: "STABILITY_API_KEY not configured" };
  try {
    const res = await fetch("https://api.stability.ai/v1/user/balance", {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(3000), // never let this hang a whole chat message
    });
    if (!res.ok) return { available: false, error: `Stability API returned ${res.status}` };
    const data = await res.json();
    return { available: true, credits: data.credits };
  } catch (e) {
    return { available: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function getModelUsageByTier() {
  if (!supabaseDb) return { available: false, byTier: {} };
  try {
    const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data: events } = await supabaseDb
      .from("api_usage_events")
      .select("provider, user_id")
      .gte("created_at", since7d)
      .not("user_id", "is", null);

    const users = await storage.getUsers();
    const tierByUserId = new Map(users.map((u) => [u.id, (u as any).subscriptionTier || "free"]));

    const byTier: Record<string, Record<string, number>> = { free: {}, pro: {}, premium: {} };
    for (const e of events || []) {
      const tier = tierByUserId.get(e.user_id) || "free";
      if (!byTier[tier]) byTier[tier] = {};
      byTier[tier][e.provider] = (byTier[tier][e.provider] || 0) + 1;
    }
    return { available: true, byTier, periodDays: 7 };
  } catch (e) {
    return { available: false, error: e instanceof Error ? e.message : String(e), byTier: {} };
  }
}

// ── Provider balance dashboard ───────────────────────────────────────────────
// Rough cost-per-call estimates (USD). Clearly labeled as estimates in the UI —
// we never claim these are exact charges, just budget planning numbers.
const PROVIDER_COST_PER_CALL_USD: Record<string, number> = {
  "gemini":             0.0001,  // Gemini Flash: ~$0.10/1M tokens, ~1k tokens/call
  "openrouter-deepseek":0.0003,  // DeepSeek-R1 via OpenRouter: ~$0.30/1M tokens
  "stability-image":    0.04,    // ~$0.04/image (4 credits at ~$0.01/credit)
  "replicate-video":    0.15,    // Video gen: ~$0.15/run
  "groq":               0.00005, // Whisper STT on Groq: ~$0.05/1M tokens
  "assemblyai":         0.005,   // AssemblyAI: ~$0.005/min
  "vapi":               0.05,    // VAPI: ~$0.05/min average session
};

export interface ProviderBalanceEntry {
  provider: string;
  displayName: string;
  hasRealApi: boolean;
  balance?: number;
  balanceUnit?: string;
  balanceError?: string;
  dashboardUrl: string;
  weeklyCallCount: number;
  monthlyCallCount: number;
  estimatedWeeklyCostUsd: number;
  estimatedMonthlyCostUsd: number;
  status: "green" | "yellow" | "red" | "unknown";
}

export interface ProviderBalancesResult {
  providers: ProviderBalanceEntry[];
  totalMonthlyBurnUsd: number;
  fetchedAt: string;
  fromCache: boolean;
}

let cachedProviderBalances: (ProviderBalancesResult & { expiresAt: number }) | null = null;
const PROVIDER_CACHE_MS = 5 * 60 * 1000; // 5 minutes

export async function getProviderBalances(): Promise<ProviderBalancesResult> {
  if (cachedProviderBalances && cachedProviderBalances.expiresAt > Date.now()) {
    return {
      providers: cachedProviderBalances.providers,
      totalMonthlyBurnUsd: cachedProviderBalances.totalMonthlyBurnUsd,
      fetchedAt: cachedProviderBalances.fetchedAt,
      fromCache: true,
    };
  }

  const since7d  = new Date(Date.now() - 7  * 24 * 60 * 60 * 1000).toISOString();
  const since30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  let weeklyByProvider:  Record<string, number> = {};
  let monthlyByProvider: Record<string, number> = {};

  if (supabaseDb) {
    try {
      const countBy = (rows: any[] | null) => {
        const c: Record<string, number> = {};
        (rows || []).forEach((r) => { c[r.provider] = (c[r.provider] || 0) + 1; });
        return c;
      };
      const [w, m] = await Promise.all([
        supabaseDb.from("api_usage_events").select("provider").gte("created_at", since7d),
        supabaseDb.from("api_usage_events").select("provider").gte("created_at", since30d),
      ]);
      weeklyByProvider  = countBy(w.data);
      monthlyByProvider = countBy(m.data);
    } catch { /* non-fatal — usage data just shows 0 */ }
  }

  // Stability is the only provider with a real balance API we can call server-side.
  const stabilityResult = await getStabilityBalance();

  const PROVIDER_DEFS: { provider: string; displayName: string; hasRealApi: boolean; dashboardUrl: string }[] = [
    { provider: "gemini",              displayName: "Gemini (Google AI)",  hasRealApi: false, dashboardUrl: "https://console.cloud.google.com/apis/api/generativelanguage.googleapis.com/quotas" },
    { provider: "stability-image",     displayName: "Stability AI",        hasRealApi: true,  dashboardUrl: "https://platform.stability.ai/account/credits" },
    { provider: "replicate-video",     displayName: "Replicate",           hasRealApi: false, dashboardUrl: "https://replicate.com/account/billing" },
    { provider: "vapi",                displayName: "VAPI (Voice AI)",     hasRealApi: false, dashboardUrl: "https://dashboard.vapi.ai/billing" },
    { provider: "groq",                displayName: "Groq (Whisper STT)",  hasRealApi: false, dashboardUrl: "https://console.groq.com/settings/billing" },
    { provider: "openrouter-deepseek", displayName: "OpenRouter",          hasRealApi: false, dashboardUrl: "https://openrouter.ai/settings/credits" },
  ];

  const fetchedAt = new Date().toISOString();
  let totalMonthlyBurnUsd = 0;

  const providers: ProviderBalanceEntry[] = PROVIDER_DEFS.map((def) => {
    const weeklyCallCount  = weeklyByProvider[def.provider]  || 0;
    const monthlyCallCount = monthlyByProvider[def.provider] || 0;
    const costPerCall = PROVIDER_COST_PER_CALL_USD[def.provider] || 0;
    const estimatedWeeklyCostUsd  = parseFloat((weeklyCallCount  * costPerCall).toFixed(4));
    const estimatedMonthlyCostUsd = parseFloat((monthlyCallCount * costPerCall).toFixed(4));
    totalMonthlyBurnUsd += estimatedMonthlyCostUsd;

    let balance: number | undefined;
    let balanceUnit: string | undefined;
    let balanceError: string | undefined;
    let status: ProviderBalanceEntry["status"] = "unknown";

    if (def.provider === "stability-image") {
      if (stabilityResult.available) {
        balance     = stabilityResult.credits;
        balanceUnit = "credits";
        // 1000 Stability credits ≈ $10. Thresholds: <100 = critical, <500 = warning
        status = (balance ?? 0) < 100 ? "red" : (balance ?? 0) < 500 ? "yellow" : "green";
      } else {
        balanceError = stabilityResult.error;
        status = "red";
      }
    } else {
      // No real balance API — status based on whether it has been called recently
      status = monthlyCallCount > 0 ? "green" : "unknown";
    }

    return {
      ...def,
      balance,
      balanceUnit,
      balanceError,
      weeklyCallCount,
      monthlyCallCount,
      estimatedWeeklyCostUsd,
      estimatedMonthlyCostUsd,
      status,
    };
  });

  totalMonthlyBurnUsd = parseFloat(totalMonthlyBurnUsd.toFixed(4));

  const result: ProviderBalancesResult = { providers, totalMonthlyBurnUsd, fetchedAt, fromCache: false };
  cachedProviderBalances = { ...result, expiresAt: Date.now() + PROVIDER_CACHE_MS };
  return result;
}

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
let cachedAdminBlock: { value: string; expiresAt: number } | null = null;
const ADMIN_BLOCK_CACHE_MS = 30_000; // 30 seconds — fresh enough for admin chat, far fewer calls

export async function buildAdminContextBlock(): Promise<string> {
  if (cachedAdminBlock && cachedAdminBlock.expiresAt > Date.now()) {
    return cachedAdminBlock.value;
  }
  try {
    const overview = await getAdminOverview();
    const keys = getApiKeyStatus();
    const missingCritical = keys.filter((k) => k.critical && !k.configured);
    const errors = getRecentErrors().slice(0, 5);
    const usage = await getApiUsageSummary();
    const stability = await getStabilityBalance();

    const usageLine = usage.available
      ? usage.byProvider.map((p) => `${p.provider}: ${p.last24h}/24h, ${p.last7d}/7d`).join(" | ") || "no calls logged yet"
      : `unavailable (${usage.reason})`;
    const stabilityLine = stability.available ? `${stability.credits} credits remaining` : `unavailable (${stability.error})`;

    const block = `
## VERIFIED SYSTEM DATA (fetched live just now — use ONLY these numbers, never invent others):
- Total users: ${overview.totalUsers}
- Signups today: ${overview.signupsToday}
- Signups this week: ${overview.signupsThisWeek}
- Users by tier: Free=${overview.usersByTier.free}, Pro=${overview.usersByTier.pro}, Premium=${overview.usersByTier.premium}
- Estimated monthly revenue: ₦${overview.estimatedMonthlyRevenueNaira.toLocaleString()}
- Missing critical API keys: ${missingCritical.length === 0 ? "none" : missingCritical.map((k) => k.name).join(", ")}
- API call volume: ${usageLine}
- Stability AI credit balance: ${stabilityLine}
- Recent errors (last 5): ${errors.length === 0 ? "none logged" : errors.map((e) => `[${e.source}] ${e.message}`).join(" | ")}
(Data generated at ${overview.generatedAt}. If Felix asks for something not listed above — e.g. a named user's individual history — say you don't have that specific data rather than guessing.)`;

    cachedAdminBlock = { value: block, expiresAt: Date.now() + ADMIN_BLOCK_CACHE_MS };
    return block;
  } catch (e) {
    return `\n## SYSTEM DATA UNAVAILABLE: Could not fetch live stats (${e instanceof Error ? e.message : String(e)}). Tell Felix the data fetch failed — do NOT invent numbers to fill the gap.`;
  }
}
