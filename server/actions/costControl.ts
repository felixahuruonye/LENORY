/**
 * LENORY ACTIONS cost-control engine (fail closed).
 *
 * IMPORTANT — estimated vs actual cost:
 * - `ACTIONS_EST_USD_PER_HOUR` and `estimated_cost_usd` are INTERNAL ACCOUNTING
 *   estimates for quotas and circuit breakers only.
 * - They are NOT Browserbase invoices and must not be shown as "what Browserbase charged".
 * - Actual provider billing is determined solely by Browserbase (browser hours, proxies, etc.).
 *
 * Quotas apply before any session is created. Fail closed on check errors.
 */
import { supabaseDb } from "../db";

export interface CostLimits {
  maxSessionDurationSec: number;
  idleTimeoutSec: number;
  maxConcurrentPerUser: number;
  maxConcurrentGlobal: number;
  dailyUserSessionMinutes: number;
  monthlyUserSessionMinutes: number;
  maxTaskMinutes: number;
  /** Estimated USD per browser-hour for reservation accounting */
  estimatedUsdPerHour: number;
  /** Hard monthly USD ceiling across all users (circuit breaker) */
  globalMonthlySpendCeilingUsd: number;
  freeDailyMinutes: number;
  freeMonthlyMinutes: number;
}

export function loadCostLimits(): CostLimits {
  const n = (key: string, def: number) => {
    const v = Number(process.env[key]);
    return Number.isFinite(v) && v >= 0 ? v : def;
  };
  return {
    maxSessionDurationSec: n("ACTIONS_MAX_SESSION_SEC", 15 * 60),
    idleTimeoutSec: n("ACTIONS_IDLE_TIMEOUT_SEC", 3 * 60),
    maxConcurrentPerUser: n("ACTIONS_MAX_CONCURRENT_PER_USER", 1),
    maxConcurrentGlobal: n("ACTIONS_MAX_CONCURRENT_GLOBAL", 10),
    dailyUserSessionMinutes: n("ACTIONS_DAILY_USER_MINUTES", 30),
    monthlyUserSessionMinutes: n("ACTIONS_MONTHLY_USER_MINUTES", 120),
    maxTaskMinutes: n("ACTIONS_MAX_TASK_MINUTES", 20),
    estimatedUsdPerHour: n("ACTIONS_EST_USD_PER_HOUR", 0.12),
    globalMonthlySpendCeilingUsd: n("ACTIONS_GLOBAL_MONTHLY_SPEND_USD", 50),
    freeDailyMinutes: n("ACTIONS_FREE_DAILY_MINUTES", 10),
    freeMonthlyMinutes: n("ACTIONS_FREE_MONTHLY_MINUTES", 30),
  };
}

export interface UsageReservation {
  reservationId: string;
  userId: string;
  taskId?: string;
  reservedMinutes: number;
  estimatedCostUsd: number;
  createdAt: string;
}

/** Process-local meters (supplemented by DB when available). */
const activeByUser = new Map<string, Set<string>>();
const activeGlobal = new Set<string>();
const reservations = new Map<string, UsageReservation>();
let monthlySpendEstimateUsd = 0;

function monthKey() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export async function getUserPlanTier(userId: string): Promise<"free" | "paid"> {
  if (!supabaseDb) return "free";
  try {
    const { data } = await supabaseDb.from("users").select("subscription_tier").eq("id", userId).maybeSingle();
    const tier = String(data?.subscription_tier || "free").toLowerCase();
    if (tier === "free" || !tier) return "free";
    return "paid";
  } catch {
    return "free";
  }
}

/** When true, usage DB is required; failures reject new sessions (fail closed). */
function requireUsageDb(): boolean {
  return process.env.ACTIONS_REQUIRE_USAGE_DB !== "0";
}

async function sumUserMinutes(userId: string, sinceIso: string): Promise<{ ok: true; minutes: number } | { ok: false; reason: string }> {
  if (!supabaseDb) {
    if (requireUsageDb()) return { ok: false, reason: "Usage database unavailable; browser sessions blocked (fail closed)." };
    return { ok: true, minutes: 0 };
  }
  try {
    const { data, error } = await supabaseDb
      .from("action_usage")
      .select("duration_sec")
      .eq("user_id", userId)
      .gte("created_at", sinceIso);
    if (error) {
      if (requireUsageDb()) return { ok: false, reason: `Usage check failed: ${error.message}` };
      return { ok: true, minutes: 0 };
    }
    const secs = (data || []).reduce((a: number, r: any) => a + (Number(r.duration_sec) || 0), 0);
    return { ok: true, minutes: secs / 60 };
  } catch (e: any) {
    if (requireUsageDb()) return { ok: false, reason: `Usage check error: ${e?.message || e}` };
    return { ok: true, minutes: 0 };
  }
}

async function sumGlobalSpendThisMonth(): Promise<{ ok: true; spend: number } | { ok: false; reason: string }> {
  if (!supabaseDb) {
    if (requireUsageDb()) return { ok: false, reason: "Usage database unavailable; browser sessions blocked (fail closed)." };
    return { ok: true, spend: monthlySpendEstimateUsd };
  }
  try {
    const start = `${monthKey()}-01T00:00:00.000Z`;
    const { data, error } = await supabaseDb
      .from("action_usage")
      .select("estimated_cost_usd")
      .gte("created_at", start);
    if (error) {
      if (requireUsageDb()) return { ok: false, reason: `Global spend check failed: ${error.message}` };
      return { ok: true, spend: monthlySpendEstimateUsd };
    }
    const spend = (data || []).reduce((a: number, r: any) => a + (Number(r.estimated_cost_usd) || 0), 0);
    return { ok: true, spend };
  } catch (e: any) {
    if (requireUsageDb()) return { ok: false, reason: `Global spend check error: ${e?.message || e}` };
    return { ok: true, spend: monthlySpendEstimateUsd };
  }
}

/**
 * Reserve capacity before creating a browser session. Fail closed on any uncertainty.
 */

/** Cross-instance concurrent slot using action_browser_slots (fail closed on error). */
async function claimDbConcurrentSlot(userId: string, sessionHint: string): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!supabaseDb) {
    if (requireUsageDb()) return { ok: false, reason: "Usage database unavailable; cannot claim browser slot." };
    return { ok: true };
  }
  const limits = loadCostLimits();
  try {
    // Count open slots for user
    const { count: userCount, error: e1 } = await supabaseDb
      .from("action_browser_slots")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("open", true);
    if (e1) {
      const msg = String(e1.message || "");
      // Table not migrated yet — fall back to in-process limits so browsing still works
      if (/action_browser_slots|schema cache|does not exist|Could not find the table/i.test(msg)) {
        console.warn("[costControl] action_browser_slots missing — using in-memory concurrent limits only. Run supabase_actions_phase3_migration.sql");
        return { ok: true };
      }
      return { ok: false, reason: `Slot check failed: ${e1.message}` };
    }
    if ((userCount || 0) >= limits.maxConcurrentPerUser) {
      return { ok: false, reason: `Concurrent browser limit reached (${limits.maxConcurrentPerUser} per user)` };
    }
    const { count: globalCount, error: e2 } = await supabaseDb
      .from("action_browser_slots")
      .select("id", { count: "exact", head: true })
      .eq("open", true);
    if (e2) return { ok: false, reason: `Global slot check failed: ${e2.message}` };
    if ((globalCount || 0) >= limits.maxConcurrentGlobal) {
      return { ok: false, reason: `Global concurrent browser limit reached (${limits.maxConcurrentGlobal})` };
    }
    const id = `slot_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const { error: e3 } = await supabaseDb.from("action_browser_slots").insert({
      id,
      user_id: userId,
      session_hint: sessionHint || null,
      open: true,
      created_at: new Date().toISOString(),
    });
    if (e3) return { ok: false, reason: `Slot claim failed: ${e3.message}` };
    return { ok: true };
  } catch (e: any) {
    return { ok: false, reason: `Slot claim error: ${e?.message || e}` };
  }
}

async function releaseDbConcurrentSlot(userId: string, sessionId?: string) {
  if (!supabaseDb) return;
  try {
    // Mark oldest open slot closed for user (best-effort)
    const { data } = await supabaseDb
      .from("action_browser_slots")
      .select("id")
      .eq("user_id", userId)
      .eq("open", true)
      .order("created_at", { ascending: true })
      .limit(1);
    const id = data?.[0]?.id;
    if (id) {
      await supabaseDb.from("action_browser_slots").update({ open: false, closed_at: new Date().toISOString(), session_id: sessionId || null }).eq("id", id);
    }
  } catch (e: any) {
    console.warn("[costControl] releaseDbConcurrentSlot:", e?.message);
  }
}


export async function reserveBrowserUsage(input: {
  userId: string;
  taskId?: string;
  sessionIdHint?: string;
}): Promise<{ ok: true; reservation: UsageReservation } | { ok: false; reason: string }> {
  const limits = loadCostLimits();
  const userId = input.userId;
  if (!userId) return { ok: false, reason: "Unauthenticated" };

  // Concurrent per user
  const userSet = activeByUser.get(userId) || new Set<string>();
  if (userSet.size >= limits.maxConcurrentPerUser) {
    return { ok: false, reason: `Concurrent browser limit reached (${limits.maxConcurrentPerUser} per user)` };
  }
  if (activeGlobal.size >= limits.maxConcurrentGlobal) {
    return { ok: false, reason: `Global concurrent browser limit reached (${limits.maxConcurrentGlobal})` };
  }

  const slot = await claimDbConcurrentSlot(userId, input.sessionIdHint || input.taskId || "");
  if (!slot.ok) return { ok: false, reason: slot.reason };

  // Circuit breaker (fail closed if usage DB check fails)
  const globalSpendRes = await sumGlobalSpendThisMonth();
  if (!globalSpendRes.ok) return { ok: false, reason: globalSpendRes.reason };
  const globalSpend = globalSpendRes.spend;
  if (globalSpend >= limits.globalMonthlySpendCeilingUsd) {
    return { ok: false, reason: "Global monthly browser spend ceiling reached. Try again next period." };
  }

  const plan = await getUserPlanTier(userId);
  const now = new Date();
  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
  const monthStart = `${monthKey()}-01T00:00:00.000Z`;

  const dailyRes = await sumUserMinutes(userId, dayStart);
  if (!dailyRes.ok) return { ok: false, reason: dailyRes.reason };
  const monthlyRes = await sumUserMinutes(userId, monthStart);
  if (!monthlyRes.ok) return { ok: false, reason: monthlyRes.reason };
  const dailyUsed = dailyRes.minutes;
  const monthlyUsed = monthlyRes.minutes;

  const dailyCap = plan === "free" ? limits.freeDailyMinutes : limits.dailyUserSessionMinutes;
  const monthlyCap = plan === "free" ? limits.freeMonthlyMinutes : limits.monthlyUserSessionMinutes;

  if (dailyUsed >= dailyCap) {
    return { ok: false, reason: `Daily browser allowance used (${dailyCap} min).` };
  }
  if (monthlyUsed >= monthlyCap) {
    return { ok: false, reason: `Monthly browser allowance used (${monthlyCap} min).` };
  }

  const reservedMinutes = Math.min(limits.maxTaskMinutes, dailyCap - dailyUsed, monthlyCap - monthlyUsed);
  if (reservedMinutes <= 0) {
    return { ok: false, reason: "No remaining browser allowance." };
  }

  const estimatedCostUsd = (reservedMinutes / 60) * limits.estimatedUsdPerHour;
  if (globalSpend + estimatedCostUsd > limits.globalMonthlySpendCeilingUsd) {
    return { ok: false, reason: "Would exceed global monthly spend ceiling." };
  }

  const reservationId = `rsv_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  const reservation: UsageReservation = {
    reservationId,
    userId,
    taskId: input.taskId,
    reservedMinutes,
    estimatedCostUsd,
    createdAt: new Date().toISOString(),
  };
  reservations.set(reservationId, reservation);
  return { ok: true, reservation };
}

/** Track an opened session against concurrent quotas (call after session create). */
/** Release a reservation that was never turned into a settled session (create failed / cancelled). */
export function releaseReservation(reservationId: string | undefined | null): void {
  if (!reservationId) return;
  reservations.delete(reservationId);
}

/** Force-close concurrent tracking for a session without settling (use settleBrowserUsage for real closes). */
export function abandonSessionSlot(userId: string, sessionId: string, reservationId?: string) {
  trackSessionClose(userId, sessionId);
  releaseReservation(reservationId);
}

export function trackSessionOpen(userId: string, sessionId: string) {

  const set = activeByUser.get(userId) || new Set<string>();
  set.add(sessionId);
  activeByUser.set(userId, set);
  activeGlobal.add(sessionId);
}

export function trackSessionClose(userId: string, sessionId: string) {
  activeByUser.get(userId)?.delete(sessionId);
  activeGlobal.delete(sessionId);
  void releaseDbConcurrentSlot(userId, sessionId);
}

export async function settleBrowserUsage(input: {
  userId: string;
  taskId?: string;
  sessionId: string;
  provider: string;
  durationSec: number;
  reservationId?: string;
}): Promise<void> {
  const limits = loadCostLimits();
  const durationSec = Math.max(0, Math.min(input.durationSec, limits.maxSessionDurationSec));
  const estimatedCostUsd = (durationSec / 3600) * limits.estimatedUsdPerHour;
  monthlySpendEstimateUsd += estimatedCostUsd;

  if (input.reservationId) reservations.delete(input.reservationId);
  trackSessionClose(input.userId, input.sessionId);

  if (!supabaseDb) return;
  try {
    await supabaseDb.from("action_usage").insert({
      id: `usage_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      user_id: input.userId,
      task_id: input.taskId || null,
      session_id: input.sessionId,
      provider: input.provider,
      duration_sec: durationSec,
      estimated_cost_usd: estimatedCostUsd, // accounting estimate only — not provider invoice
      created_at: new Date().toISOString(),
    });
  } catch (e: any) {
    console.warn("[costControl] settle failed:", e?.message);
  }
}

export function getActiveSessionCounts() {
  return {
    global: activeGlobal.size,
    byUser: Object.fromEntries([...activeByUser.entries()].map(([k, v]) => [k, v.size])),
    limits: loadCostLimits(),
  };
}
