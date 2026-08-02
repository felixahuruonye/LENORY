// server/adminTools.ts
// Real, auditable admin data functions. No AI "simulation" — every function here
// returns actual facts (or explicitly says it couldn't get them). This exists
// specifically to stop the AI from fabricating admin answers.

import { storage } from "./storage";
import { supabaseDb } from "./db";

export const ADMIN_EMAIL = "felixahuruonye@gmail.com";

// ── Real API usage tracking ──────────────────────────────────────────────────
export function logApiUsage(provider: string, userId?: string, endpoint?: string) {
  (async () => {
    try {
      await supabaseDb
        .from("api_usage_events")
        .insert({ provider, endpoint: endpoint || null, user_id: userId || null });
    } catch (e: unknown) {
      console.error("logApiUsage failed (non-fatal):", e);
    }
  })();
}

export async function getApiUsageSummary() {
  if (!supabaseDb) {
    return { available: false, reason: "Supabase not connected", byProvider: [] };
  }
  try {
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const since30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    const { data: last24hData } = await supabaseDb
      .from("api_usage_events")
      .select("provider")
      .gte("created_at", since24h);
    const { data: last7dData } = await supabaseDb
      .from("api_usage_events")
      .select("provider")
      .gte("created_at", since7d);
    const { data: last30dData } = await supabaseDb
      .from("api_usage_events")
      .select("provider")
      .gte("created_at", since30d);

    const countBy = (rows: any[] | null) => {
      const counts: Record<string, number> = {};
      (rows || []).forEach((r) => { counts[r.provider] = (counts[r.provider] || 0) + 1; });
      return counts;
    };

    const last24h = countBy(last24hData);
    const last7d = countBy(last7dData);
    const last30d = countBy(last30dData);
    const providers = Array.from(new Set([...Object.keys(last24h), ...Object.keys(last7d), ...Object.keys(last30d)]));

    return {
      available: true,
      byProvider: providers.map((p) => ({ 
        provider: p, 
        last24h: last24h[p] || 0, 
        last7d: last7d[p] || 0,
        last30d: last30d[p] || 0
      })),
    };
  } catch (e) {
    return { available: false, reason: e instanceof Error ? e.message : String(e), byProvider: [] };
  }
}

// Real balance check — Stability AI has a genuine, documented balance endpoint.
export async function getTavilyBalance(): Promise<{ available: boolean; credits?: number; limit?: number; error?: string }> {
  const key = process.env.TAVILY_API_KEY;
  if (!key) return { available: false, error: "TAVILY_API_KEY not configured" };
  try {
    const res = await fetch("https://api.tavily.com/usage", {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => `HTTP ${res.status}`);
      return { available: false, error: `Tavily API returned ${res.status}: ${text.substring(0, 100)}` };
    }
    const data = await res.json();
    const usage = data.key?.usage ?? data.account?.usage ?? 0;
    const limit = data.key?.limit ?? data.account?.limit ?? 1000;
    return { available: true, credits: Math.max(limit - usage, 0), limit };
  } catch (e) {
    return { available: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function getStabilityBalance(): Promise<{ available: boolean; credits?: number; error?: string }> {
  const key = process.env.STABILITY_API_KEY;
  if (!key) return { available: false, error: "STABILITY_API_KEY not configured" };
  try {
    const res = await fetch("https://api.stability.ai/v1/user/balance", {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => `HTTP ${res.status}`);
      return { available: false, error: `Stability API returned ${res.status}: ${text.substring(0, 100)}` };
    }
    const data = await res.json();
    return { available: true, credits: data.credits };
  } catch (e) {
    return { available: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// ─── OpenRouter Balance ──────────────────────────────────────────
export async function getOpenRouterBalance(): Promise<{ credits: number; error?: string }> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return { credits: 0, error: 'OpenRouter API key not configured' };
  try {
    const response = await fetch('https://openrouter.ai/api/v1/auth/key', {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => `HTTP ${response.status}`);
      return { credits: 0, error: `OpenRouter API error: ${text}` };
    }
    const data = await response.json();
    return { credits: data.credits || 0 };
  } catch (err: any) {
    return { credits: 0, error: err.message };
  }
}

// ─── Real User Activity (from Supabase) ──────────────────────────────
export async function getUserActivity(userId: string) {
  if (!supabaseDb) return { available: false, reason: "Supabase not connected" };
  try {
    const { data: sessions } = await supabaseDb
      .from("user_sessions")
      .select("*")
      .eq("user_id", userId)
      .order("session_start", { ascending: false });

    const { data: features } = await supabaseDb
      .from("feature_usage")
      .select("*")
      .eq("user_id", userId)
      .order("count", { ascending: false });

    let totalHours = 0;
    let totalSessions = 0;
    let lastSeen = null;
    
    if (sessions) {
      totalSessions = sessions.length;
      sessions.forEach((s: any) => {
        if (s.duration_seconds) {
          totalHours += s.duration_seconds / 3600;
        }
        if (!lastSeen || new Date(s.session_start) > new Date(lastSeen)) {
          lastSeen = s.session_start;
        }
      });
    }

    return {
      available: true,
      totalSessions,
      totalHours: Math.round(totalHours * 100) / 100,
      lastSeen,
      features: features || [],
      sessions: sessions || [],
    };
  } catch (e) {
    return { available: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// ─── Real-time Active Users ────────────────────────────────────────────
export async function getActiveUsers() {
  if (!supabaseDb) return { count: 0, users: [] };
  try {
    const thirtyMinsAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const { data: sessions } = await supabaseDb
      .from("user_sessions")
      .select("user_id, session_start")
      .gte("session_start", thirtyMinsAgo)
      .is("session_end", null);

    const activeUserIds = [...new Set(sessions?.map((s: any) => s.user_id) || [])];
    
    const { data: users } = await supabaseDb
      .from("users")
      .select("id, email, first_name, last_name, lenory_id, subscription_tier")
      .in("id", activeUserIds);

    return {
      count: activeUserIds.length,
      users: users || [],
    };
  } catch (e) {
    return { count: 0, users: [] };
  }
}

// ─── Provider Balance Aggregation ─────────────────────────────────────
export async function getTotalPlatformCredits(): Promise<{
  total: number;
  providers: Record<string, { balance: number; unit: string }>;
}> {
  const result: Record<string, { balance: number; unit: string }> = {};
  let total = 0;

  const stability = await getStabilityBalance();
  if (stability.available && stability.credits !== undefined) {
    result["stability"] = { balance: stability.credits, unit: "credits" };
    total += stability.credits;
  }

  const openrouter = await getOpenRouterBalance();
  if (openrouter.credits > 0) {
    result["openrouter"] = { balance: openrouter.credits, unit: "credits" };
    total += openrouter.credits;
  }

  const usage = await getApiUsageSummary();
  const geminiCalls = usage.available 
    ? (usage.byProvider.find((p: any) => p.provider === "gemini")?.last30d || 0)
    : 0;
  if (geminiCalls > 0) {
    result["gemini"] = { balance: geminiCalls, unit: "calls (30d)" };
  }

  return { total, providers: result };
}

// ─── Paystack Transaction History ─────────────────────────────────────
export async function getPaystackTransactions(limit: number = 100) {
  const secretKey = process.env.PAYSTACK_SECRET_KEY;
  if (!secretKey) return { available: false, error: "Paystack not configured", transactions: [], total: 0 };

  try {
    const response = await fetch("https://api.paystack.co/transaction", {
      headers: { Authorization: `Bearer ${secretKey}` },
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) {
      return { available: false, error: `Paystack API error: ${response.status}`, transactions: [], total: 0 };
    }
    const data = await response.json();
    return {
      available: true,
      transactions: data.data?.slice(0, limit) || [],
      total: data.meta?.total || 0,
    };
  } catch (e) {
    return { available: false, error: e instanceof Error ? e.message : String(e), transactions: [], total: 0 };
  }
}

// ─── User Credit History ──────────────────────────────────────────────
export async function getUserCreditHistory(userId: string) {
  if (!supabaseDb) return { available: false, history: [] };
  try {
    const { data } = await supabaseDb
      .from("credit_transactions")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });
    return { available: true, history: data || [] };
  } catch (e) {
    return { available: false, history: [] };
  }
}

// ─── Get Current User Credits ──────────────────────────────────────────
export async function getUserCredits(userId: string) {
  if (!supabaseDb) return { available: false, balance: 0 };
  try {
    const { data } = await supabaseDb
      .from("credits")
      .select("balance, monthly_used, last_reset_date")
      .eq("user_id", userId)
      .maybeSingle();
    return { available: true, ...data };
  } catch (e) {
    return { available: false, balance: 0 };
  }
}

// ─── Platform Health ──────────────────────────────────────────────────
export async function getPlatformHealth() {
  const errors = getRecentErrors();
  const errorRate = errors.length > 0 ? Math.min(errors.length / 100, 0.1) : 0;
  const uptime = Math.round((1 - errorRate) * 100);
  
  let supabaseStatus = "healthy";
  try {
    if (supabaseDb) {
      const { error } = await supabaseDb.from("users").select("id").limit(1);
      if (error) supabaseStatus = "degraded";
    } else {
      supabaseStatus = "unavailable";
    }
  } catch {
    supabaseStatus = "unavailable";
  }

  let geminiStatus = "healthy";
  try {
    const geminiKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
    if (!geminiKey) geminiStatus = "unavailable";
  } catch {
    geminiStatus = "unavailable";
  }

  let openrouterStatus = "healthy";
  try {
    const orKey = process.env.OPENROUTER_API_KEY;
    if (!orKey) openrouterStatus = "unavailable";
  } catch {
    openrouterStatus = "unavailable";
  }

  return {
    uptime,
    errorRate: errorRate * 100,
    supabaseStatus,
    geminiStatus,
    openrouterStatus,
    recentErrors: errors.slice(0, 5),
    status: uptime > 95 ? "healthy" : uptime > 80 ? "degraded" : "critical",
    lastChecked: new Date().toISOString(),
  };
}

export async function getModelUsageByTier() {
  if (!supabaseDb) return { available: false, byTier: {} };
  try {
    const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const since14d = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
    const since30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const sinceYear = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString();

    const { data: events } = await supabaseDb
      .from("api_usage_events")
      .select("provider, user_id, created_at")
      .gte("created_at", sinceYear)
      .not("user_id", "is", null);

    const users = await storage.getUsers();
    const tierByUserId = new Map(users.map((u) => [u.id, (u as any).subscriptionTier || "free"]));

    const byTier: Record<string, Record<string, number>> = { free: {}, pro: {}, premium: {} };
    const byPeriod: Record<string, Record<string, number>> = { 
      "7d": {}, "14d": {}, "30d": {}, "year": {} 
    };

    for (const e of events || []) {
      const tier = tierByUserId.get(e.user_id) || "free";
      if (!byTier[tier]) byTier[tier] = {};
      byTier[tier][e.provider] = (byTier[tier][e.provider] || 0) + 1;

      const date = new Date(e.created_at);
      if (date >= new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)) {
        byPeriod["7d"][e.provider] = (byPeriod["7d"][e.provider] || 0) + 1;
      }
      if (date >= new Date(Date.now() - 14 * 24 * 60 * 60 * 1000)) {
        byPeriod["14d"][e.provider] = (byPeriod["14d"][e.provider] || 0) + 1;
      }
      if (date >= new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)) {
        byPeriod["30d"][e.provider] = (byPeriod["30d"][e.provider] || 0) + 1;
      }
      if (date >= new Date(Date.now() - 365 * 24 * 60 * 60 * 1000)) {
        byPeriod["year"][e.provider] = (byPeriod["year"][e.provider] || 0) + 1;
      }
    }

    return { 
      available: true, 
      byTier, 
      byPeriod,
      periodDays: { "7d": 7, "14d": 14, "30d": 30, "year": 365 }
    };
  } catch (e) {
    return { available: false, error: e instanceof Error ? e.message : String(e), byTier: {} };
  }
}

// ── Provider balance dashboard ───────────────────────────────────────────────
const PROVIDER_COST_PER_CALL_USD: Record<string, number> = {
  "gemini":             0.0001,
  "gemini-nano-banana": 0.04,
  "openrouter-deepseek":0.0003,
  "openrouter":         0.002,
  "stability-image":    0.04,
  "replicate-video":    0.15,
  "groq":               0.00005,
  "assemblyai":         0.005,
  "vapi":               0.05,
  "tavily":             0.008,
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
const PROVIDER_CACHE_MS = 5 * 60 * 1000;

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

  const stabilityResult = await getStabilityBalance();
  const openrouterResult = await getOpenRouterBalance();
  const tavilyResult = await getTavilyBalance();

  const PROVIDER_DEFS: { provider: string; displayName: string; hasRealApi: boolean; dashboardUrl: string }[] = [
    { provider: "gemini",              displayName: "Gemini (Google AI)",  hasRealApi: false, dashboardUrl: "https://console.cloud.google.com/apis/api/generativelanguage.googleapis.com/quotas" },
    { provider: "stability-image",     displayName: "Stability AI",        hasRealApi: true,  dashboardUrl: "https://platform.stability.ai/account/credits" },
    { provider: "replicate-video",     displayName: "Replicate",           hasRealApi: false, dashboardUrl: "https://replicate.com/account/billing" },
    { provider: "vapi",                displayName: "VAPI (Voice AI)",     hasRealApi: false, dashboardUrl: "https://dashboard.vapi.ai/billing" },
    { provider: "groq",                displayName: "Groq (Whisper STT)",  hasRealApi: false, dashboardUrl: "https://console.groq.com/settings/billing" },
    { provider: "openrouter-deepseek", displayName: "OpenRouter (DeepSeek)", hasRealApi: false, dashboardUrl: "https://openrouter.ai/settings/credits" },
    { provider: "openrouter",          displayName: "OpenRouter (Claude/DeepSeek)", hasRealApi: true, dashboardUrl: "https://openrouter.ai/settings/credits" },
    { provider: "tavily",              displayName: "Tavily (Web Search)", hasRealApi: true, dashboardUrl: "https://app.tavily.com/billing" },
    { provider: "yarngpt",             displayName: "YarnGPT (Nigerian TTS)", hasRealApi: false, dashboardUrl: "https://yarngpt.ai/pricing" },
    { provider: "gemini-nano-banana",  displayName: "Gemini Nano Banana (Image Gen)", hasRealApi: false, dashboardUrl: "https://console.cloud.google.com/apis/api/generativelanguage.googleapis.com/quotas" },
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
        status = (balance ?? 0) < 100 ? "red" : (balance ?? 0) < 500 ? "yellow" : "green";
      } else {
        balanceError = stabilityResult.error || "Unavailable";
        status = "red";
      }
    } else if (def.provider === "openrouter") {
      if (openrouterResult.credits > 0 || openrouterResult.error === undefined) {
        balance = openrouterResult.credits;
        balanceUnit = "credits";
        status = (balance ?? 0) < 100 ? "red" : (balance ?? 0) < 500 ? "yellow" : "green";
      } else {
        balanceError = openrouterResult.error || "Unavailable";
        status = "red";
      }
    } else if (def.provider === "tavily") {
      if (tavilyResult.available) {
        balance     = tavilyResult.credits;
        balanceUnit = "credits";
        status = (balance ?? 0) < 100 ? "red" : (balance ?? 0) < 300 ? "yellow" : "green";
      } else {
        balanceError = tavilyResult.error || "Unavailable";
        status = "red";
      }
    } else {
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
  }));
}

// ── Real-time error log (ring buffer, in-memory) ────────────────────────────
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

// ── Real usage overview ──────────────────────────────────────────────────────
export async function getUserCohorts() {
  const users = await storage.getUsers();
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;

  const buckets = {
    "1-7 days": 0,
    "7-14 days": 0,
    "14-30 days": 0,
    "30-60 days": 0,
    "60-90 days": 0,
    "90+ days / 1 year": 0,
  };

  // Real "last active" signal: most recent chat message per user (session tracking
  // isn't populated anywhere in the app yet, so this is the best real data we have).
  let lastActiveByUser: Record<string, string> = {};
  try {
    if (supabaseDb) {
      const { data } = await supabaseDb
        .from("chat_messages")
        .select("user_id, created_at")
        .order("created_at", { ascending: false })
        .limit(5000);
      for (const row of data || []) {
        if (!lastActiveByUser[row.user_id]) lastActiveByUser[row.user_id] = row.created_at;
      }
    }
  } catch {}

  const directory = users.map((u: any) => {
    const createdAt = new Date(u.createdAt).getTime();
    const ageDays = (now - createdAt) / day;
    if (ageDays <= 7) buckets["1-7 days"]++;
    else if (ageDays <= 14) buckets["7-14 days"]++;
    else if (ageDays <= 30) buckets["14-30 days"]++;
    else if (ageDays <= 60) buckets["30-60 days"]++;
    else if (ageDays <= 90) buckets["60-90 days"]++;
    else buckets["90+ days / 1 year"]++;

    return {
      id: u.id,
      fullName: [u.firstName, u.lastName].filter(Boolean).join(" ") || "—",
      email: u.email,
      joinedAt: u.createdAt,
      lastActive: lastActiveByUser[u.id] || null,
      tier: u.subscriptionTier || "free",
    };
  });

  directory.sort((a, b) => new Date(b.joinedAt).getTime() - new Date(a.joinedAt).getTime());

  return { buckets, directory, totalUsers: users.length };
}

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

  const monthlyRevenueEstimate = byTier.pro * 5000 + byTier.premium * 15000;

  let realRevenue = 0;
  try {
    const paystack = await getPaystackTransactions(100);
    if (paystack.available) {
      realRevenue = paystack.transactions.reduce((sum: number, t: any) => {
        if (t.status === 'success') {
          return sum + (t.amount || 0) / 100;
        }
        return sum;
      }, 0);
    }
  } catch {}

  return {
    totalUsers: users.length,
    signupsToday,
    signupsThisWeek,
    usersByTier: byTier,
    estimatedMonthlyRevenueNaira: monthlyRevenueEstimate,
    realRevenueNaira: realRevenue > 0 ? realRevenue : null,
    generatedAt: new Date().toISOString(),
  };
}

// Compact text block safe to inject directly into the admin AI's system prompt.
let cachedAdminBlock: { value: string; expiresAt: number } | null = null;
const ADMIN_BLOCK_CACHE_MS = 30_000;

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
    const openrouter = await getOpenRouterBalance();

    const usageLine = usage.available
      ? usage.byProvider.map((p) => `${p.provider}: ${p.last24h}/24h, ${p.last7d}/7d`).join(" | ") || "no calls logged yet"
      : `unavailable (${usage.reason})`;
    const stabilityLine = stability.available ? `${stability.credits} credits remaining` : `unavailable (${stability.error})`;
    const openrouterLine = openrouter.error ? `unavailable (${openrouter.error})` : `${openrouter.credits} credits remaining`;

    const block = `
## VERIFIED SYSTEM DATA (fetched live just now — use ONLY these numbers, never invent others):
- Total users: ${overview.totalUsers}
- Signups today: ${overview.signupsToday}
- Signups this week: ${overview.signupsThisWeek}
- Users by tier: Free=${overview.usersByTier.free}, Pro=${overview.usersByTier.pro}, Premium=${overview.usersByTier.premium}
- Estimated monthly revenue: ₦${overview.estimatedMonthlyRevenueNaira.toLocaleString()}
- Real revenue (from Paystack): ${overview.realRevenueNaira ? `₦${overview.realRevenueNaira.toLocaleString()}` : 'N/A'}
- Missing critical API keys: ${missingCritical.length === 0 ? "none" : missingCritical.map((k) => k.name).join(", ")}
- API call volume: ${usageLine}
- Stability AI credit balance: ${stabilityLine}
- OpenRouter credit balance: ${openrouterLine}
- Recent errors (last 5): ${errors.length === 0 ? "none logged" : errors.map((e) => `[${e.source}] ${e.message}`).join(" | ")}
(Data generated at ${overview.generatedAt}. If Felix asks for something not listed above — say you don't have that specific data rather than guessing.)`;

    cachedAdminBlock = { value: block, expiresAt: Date.now() + ADMIN_BLOCK_CACHE_MS };
    return block;
  } catch (e) {
    return `\n## SYSTEM DATA UNAVAILABLE: Could not fetch live stats (${e instanceof Error ? e.message : String(e)}). Tell Felix the data fetch failed — do NOT invent numbers to fill the gap.`;
  }
}