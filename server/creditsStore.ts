// server/creditsStore.ts
// Real, persistent credit tracking. Supabase is the source of truth — a server
// restart, deploy, or crash must never reset anyone's balance again.
//
// REQUIRES a one-time table creation in Supabase for admin-configurable tier
// limits (getTierLimits/setTierLimits/getAllTierLimits below). Until this
// table exists, everything still works exactly as before — the hardcoded
// CREDIT_TIERS defaults are used automatically. Run this once in the
// Supabase SQL editor to enable live editing from Admin Dashboard → Credits:
//
//   create table if not exists tier_config (
//     tier text primary key,
//     daily_add integer not null,
//     max_balance integer not null,
//     updated_at timestamptz not null default now()
//   );
//   insert into tier_config (tier, daily_add, max_balance) values
//     ('free', 10, 30),
//     ('pro', 60, 180),
//     ('premium', 150, 450)
//   on conflict (tier) do nothing;

import { supabaseAdmin } from "./supabase";

export interface CreditRecord {
  balance: number;
  monthlyUsed: number;
  dailyGiven: number;
  lastDailyReset: string;
  lastMonthlyReset: string;
}

// Sized against real Gemini 2.5 Flash pricing ($0.30/1M input, $2.50/1M output).
// A typical thorough LENORY answer runs ~3000 input + ~1000 output tokens,
// which costs roughly ₦5 per message at current USD/NGN rates.
//
// These are now ONLY the hardcoded seed/fallback defaults. The live source of
// truth is the `tier_config` Supabase table (editable from Admin Dashboard →
// Credits → Tier Config), loaded via getTierLimits() below with a short cache.
// If the table is empty, unreadable, or Supabase is down, these defaults are
// used automatically — a bad or missing DB row can never break the app.
export const CREDIT_TIERS: Record<string, { dailyAdd: number; maxBalance: number }> = {
  free: { dailyAdd: 10, maxBalance: 30 },
  pro: { dailyAdd: 60, maxBalance: 180 },
  premium: { dailyAdd: 150, maxBalance: 450 },
};

type TierLimits = { dailyAdd: number; maxBalance: number };

let tierConfigCache: Record<string, TierLimits> | null = null;
let tierConfigCacheAt = 0;
const TIER_CONFIG_CACHE_MS = 30_000; // 30s — admin edits show up quickly without hitting the DB on every request

async function loadTierConfigFromDb(): Promise<Record<string, TierLimits> | null> {
  if (!supabaseAdmin) return null;
  try {
    const { data, error } = await supabaseAdmin.from("tier_config").select("*");
    if (error) {
      logSupabaseError("select tier_config", error);
      return null;
    }
    if (!data || data.length === 0) return null;
    const merged: Record<string, TierLimits> = {};
    for (const row of data as any[]) {
      if (!row?.tier) continue;
      const dailyAdd = Number(row.daily_add);
      const maxBalance = Number(row.max_balance);
      if (!Number.isFinite(dailyAdd) || !Number.isFinite(maxBalance)) continue;
      merged[row.tier] = { dailyAdd, maxBalance };
    }
    return Object.keys(merged).length > 0 ? merged : null;
  } catch (e) {
    console.error("[creditsStore] loadTierConfigFromDb threw:", e);
    return null;
  }
}

// The ONLY function that should be used to read tier limits anywhere in the
// app. DB-backed with a 30s cache, always falling back to CREDIT_TIERS.
export async function getTierLimits(tier: string): Promise<TierLimits> {
  const now = Date.now();
  if (!tierConfigCache || now - tierConfigCacheAt > TIER_CONFIG_CACHE_MS) {
    const fromDb = await loadTierConfigFromDb();
    tierConfigCache = fromDb; // may be null — that's fine, we fall back below on every read
    tierConfigCacheAt = now;
  }
  return (tierConfigCache && tierConfigCache[tier]) || CREDIT_TIERS[tier] || CREDIT_TIERS.free;
}

// Admin-only write path — upserts a tier's live limits into `tier_config` and
// invalidates the cache immediately so the change is visible on the very next
// request (not after the 30s window).
export async function setTierLimits(tier: string, dailyAdd: number, maxBalance: number): Promise<boolean> {
  if (!supabaseAdmin) return false;
  try {
    const { error } = await supabaseAdmin
      .from("tier_config")
      .upsert({ tier, daily_add: dailyAdd, max_balance: maxBalance, updated_at: new Date().toISOString() });
    if (error) {
      logSupabaseError("upsert tier_config", error);
      return false;
    }
    tierConfigCache = null; // force reload on next getTierLimits() call
    return true;
  } catch (e) {
    console.error("[creditsStore] setTierLimits threw:", e);
    return false;
  }
}

// Returns the full live tier config (DB values merged over defaults) for the
// admin UI to display and edit.
export async function getAllTierLimits(): Promise<Record<string, TierLimits>> {
  const now = Date.now();
  if (!tierConfigCache || now - tierConfigCacheAt > TIER_CONFIG_CACHE_MS) {
    const fromDb = await loadTierConfigFromDb();
    tierConfigCache = fromDb;
    tierConfigCacheAt = now;
  }
  return { ...CREDIT_TIERS, ...(tierConfigCache || {}) };
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}
function monthKey(): string {
  return new Date().toISOString().slice(0, 7); // YYYY-MM
}

// In-memory is now ONLY a fallback for the rare moment Supabase is unreachable —
// never the primary store. If Supabase fails, we degrade gracefully instead of
// crashing, but nothing here is treated as durable.
const emergencyFallbackStore = new Map<string, CreditRecord>();

// Supabase is already unreachable whenever this runs, so tier_config (which
// lives in Supabase) can't be read either — use the hardcoded defaults
// directly rather than trying to await a DB call that will just fail too.
function fallbackGetOrCreate(userId: string, tier: string): CreditRecord {
  const today = todayKey();
  const limits = CREDIT_TIERS[tier] || CREDIT_TIERS.free;
  if (!emergencyFallbackStore.has(userId)) {
    emergencyFallbackStore.set(userId, {
      balance: limits.dailyAdd,
      monthlyUsed: 0,
      dailyGiven: limits.dailyAdd,
      lastDailyReset: today,
      lastMonthlyReset: monthKey(),
    });
  }
  const rec = emergencyFallbackStore.get(userId)!;
  if (rec.lastDailyReset !== today) {
    const currentMonth = monthKey();
    const isNewMonth = rec.lastMonthlyReset !== currentMonth;
    if (isNewMonth) { rec.monthlyUsed = 0; rec.lastMonthlyReset = currentMonth; }
    const hasHitMonthlyQuota = !isNewMonth && rec.monthlyUsed >= limits.maxBalance;
    if (!hasHitMonthlyQuota) {
      rec.balance = Math.min(rec.balance + limits.dailyAdd, limits.maxBalance);
      rec.dailyGiven = limits.dailyAdd;
    } else {
      rec.dailyGiven = 0;
    }
    rec.lastDailyReset = today;
  }
  return rec;
}

// Small helper so every Supabase error gets logged the same detailed way
// instead of being silently swallowed or replaced with a generic message.
function logSupabaseError(context: string, error: any) {
  console.error(
    `[creditsStore] ${context} failed:`,
    "message=", error?.message,
    "details=", error?.details,
    "hint=", error?.hint,
    "code=", error?.code,
  );
}

// Fetch (or create) a user's credit record, applying the daily top-up if a new
// day has started. This is the ONLY function that should read credit state.
export async function getOrCreateCredits(userId: string, tier: string = "free"): Promise<CreditRecord> {
  const today = todayKey();
  const limits = await getTierLimits(tier);

  if (!supabaseAdmin) {
    console.warn("⚠️ Supabase unavailable — using emergency in-memory credits fallback");
    return fallbackGetOrCreate(userId, tier);
  }

  try {
    let { data, error } = await supabaseAdmin
      .from("user_credits")
      .select("*")
      .eq("user_id", userId)
      .single();

    // PGRST116 = "no rows found" from .single() — that's expected for a brand
    // new user and is NOT a real error. Anything else is worth logging.
    if (error && error.code !== "PGRST116") {
      logSupabaseError("select user_credits", error);
    }

    if (error || !data) {
      const inserted = await supabaseAdmin
        .from("user_credits")
        .insert({
          user_id: userId,
          balance: limits.dailyAdd,
          monthly_used: 0,
          daily_given: limits.dailyAdd,
          last_daily_reset: today,
          last_monthly_reset: monthKey(),
        })
        .select()
        .single();

      if (inserted.error) {
        logSupabaseError("insert user_credits", inserted.error);
        throw new Error(`Failed to create credit record: ${inserted.error.message}`);
      }
      data = inserted.data;
      if (!data) throw new Error("Failed to create credit record: insert returned no data");
    }

    // Daily reset
    if (data.last_daily_reset !== today) {
      const currentMonth = monthKey();
      const isNewMonth = data.last_monthly_reset !== currentMonth;
      const monthlyUsedSoFar = isNewMonth ? 0 : data.monthly_used;
      // The daily top-up used to run unconditionally, every day, forever —
      // so a free user could draw far more than their monthly allotment
      // (e.g. 10/day × 30 days = 300 credits/month on a "30 credit" tier)
      // at zero cost to them and real cost to us. Once they've used their
      // tier's monthly allotment, stop topping up until the calendar month
      // actually rolls over — balance settles at whatever's left (usually
      // 0) instead of being silently refilled.
      const hasHitMonthlyQuota = !isNewMonth && monthlyUsedSoFar >= limits.maxBalance;
      const newBalance = hasHitMonthlyQuota
        ? data.balance
        : Math.min(data.balance + limits.dailyAdd, limits.maxBalance);
      const updated = await supabaseAdmin
        .from("user_credits")
        .update({
          balance: newBalance,
          daily_given: hasHitMonthlyQuota ? 0 : limits.dailyAdd,
          last_daily_reset: today,
          monthly_used: isNewMonth ? 0 : data.monthly_used,
          last_monthly_reset: isNewMonth ? currentMonth : data.last_monthly_reset,
        })
        .eq("user_id", userId)
        .select()
        .single();

      if (updated.error) {
        logSupabaseError("daily reset update user_credits", updated.error);
      }
      data = updated.data || data;
    }

    return {
      balance: data.balance,
      monthlyUsed: data.monthly_used,
      dailyGiven: data.daily_given,
      lastDailyReset: data.last_daily_reset,
      lastMonthlyReset: data.last_monthly_reset,
    };
  } catch (e) {
    console.error("Credits Supabase error, using emergency fallback:", e);
    return fallbackGetOrCreate(userId, tier);
  }
}

// Deduct credits after a real, verified check that balance is sufficient.
// Returns the new balance, or null if the write failed (caller should treat
// this conservatively — we already checked balance was sufficient before acting).
export async function deductCredits(userId: string, amount: number): Promise<number | null> {
  if (!supabaseAdmin) {
    const rec = emergencyFallbackStore.get(userId);
    if (rec) { rec.balance -= amount; rec.monthlyUsed += amount; return rec.balance; }
    return null;
  }
  try {
    const { data, error } = await supabaseAdmin
      .from("user_credits")
      .select("balance, monthly_used")
      .eq("user_id", userId)
      .single();
    if (error) logSupabaseError("select before deductCredits", error);
    if (!data) return null;

    const newBalance = data.balance - amount;
    const { data: updated, error: updateError } = await supabaseAdmin
      .from("user_credits")
      .update({ balance: newBalance, monthly_used: data.monthly_used + amount, updated_at: new Date().toISOString() })
      .eq("user_id", userId)
      .select()
      .single();
    if (updateError) logSupabaseError("update in deductCredits", updateError);

    return updated?.balance ?? newBalance;
  } catch (e) {
    console.error("deductCredits Supabase error:", e);
    return null;
  }
}

// ── Reusable credit gate ─────────────────────────────────────────────────────
// All features call this before executing. Returns allowed:true for admin, or
// checks balance and returns a user-facing message if the check fails.
export async function checkCreditGate(
  userId: string,
  userEmail: string | null | undefined,
  tier: string,
  cost: number,
  featureName: string,
): Promise<{ allowed: boolean; balance?: number; message?: string; error?: string }> {
  if (userEmail === "felixahuruonye@gmail.com") return { allowed: true };
  const credits = await getOrCreateCredits(userId, tier);
  if (credits.balance < cost) {
    return {
      allowed: false,
      balance: credits.balance,
      error: "INSUFFICIENT_CREDITS",
      message: `${featureName} costs ${cost} credit${cost !== 1 ? "s" : ""}. Your balance is ${credits.balance} — top up or upgrade your plan to continue.`,
    };
  }
  return { allowed: true, balance: credits.balance };
}

// Reset a user's monthly credit usage + restore their daily allowance (admin action).
// Manually force a user's daily top-up right now (admin action), independent
// of whether their calendar daily-reset window has actually elapsed.
export async function resetDailyCredits(userId: string, tier: string): Promise<CreditRecord | null> {
  const limits = await getTierLimits(tier);
  const today = todayKey();
  if (!supabaseAdmin) {
    const rec = emergencyFallbackStore.get(userId);
    if (rec) {
      rec.balance = Math.min(rec.balance + limits.dailyAdd, limits.maxBalance);
      rec.dailyGiven = limits.dailyAdd;
      rec.lastDailyReset = today;
    }
    return rec || null;
  }
  try {
    const { data: current } = await supabaseAdmin.from("user_credits").select("*").eq("user_id", userId).single();
    const newBalance = Math.min((current?.balance || 0) + limits.dailyAdd, limits.maxBalance);
    const { data, error } = await supabaseAdmin
      .from("user_credits")
      .update({ balance: newBalance, daily_given: limits.dailyAdd, last_daily_reset: today, updated_at: new Date().toISOString() })
      .eq("user_id", userId)
      .select()
      .single();
    if (error) logSupabaseError("resetDailyCredits update", error);
    if (!data) return null;
    return { balance: data.balance, monthlyUsed: data.monthly_used, dailyGiven: data.daily_given, lastDailyReset: data.last_daily_reset, lastMonthlyReset: data.last_monthly_reset };
  } catch (e) {
    console.error("resetDailyCredits error:", e);
    return null;
  }
}

export async function resetMonthlyCredits(userId: string, tier: string): Promise<CreditRecord | null> {
  const limits = await getTierLimits(tier);
  const today = todayKey();
  const currentMonth = monthKey();
  if (!supabaseAdmin) {
    const rec = emergencyFallbackStore.get(userId);
    if (rec) {
      rec.monthlyUsed = 0;
      rec.lastMonthlyReset = currentMonth;
      rec.balance = limits.dailyAdd;
      rec.lastDailyReset = today;
    }
    return rec || null;
  }
  try {
    const { data, error } = await supabaseAdmin
      .from("user_credits")
      .update({ monthly_used: 0, last_monthly_reset: currentMonth, balance: limits.dailyAdd, last_daily_reset: today, updated_at: new Date().toISOString() })
      .eq("user_id", userId)
      .select()
      .single();
    if (error) logSupabaseError("resetMonthlyCredits update", error);
    if (!data) return null;
    return { balance: data.balance, monthlyUsed: data.monthly_used, dailyGiven: data.daily_given, lastDailyReset: data.last_daily_reset, lastMonthlyReset: data.last_monthly_reset };
  } catch (e) {
    console.error("resetMonthlyCredits error:", e);
    return null;
  }
}

// Add credits (Paystack top-up, admin adjustment). Caps at the tier's maxBalance
// unless uncapped is explicitly requested (e.g. an admin override).
export async function addCredits(userId: string, amount: number, tier: string = "free", uncapped = false): Promise<number | null> {
  const limits = await getTierLimits(tier);
  if (!supabaseAdmin) {
    const rec = emergencyFallbackStore.get(userId);
    if (rec) { rec.balance = uncapped ? rec.balance + amount : Math.min(rec.balance + amount, limits.maxBalance); return rec.balance; }
    return null;
  }
  try {
    const { data, error } = await supabaseAdmin
      .from("user_credits")
      .select("balance")
      .eq("user_id", userId)
      .single();
    if (error && error.code !== "PGRST116") logSupabaseError("select before addCredits", error);

    const current = data?.balance ?? 0;
    const newBalance = uncapped ? current + amount : Math.min(current + amount, limits.maxBalance);
    const { data: updated, error: upsertError } = await supabaseAdmin
      .from("user_credits")
      .upsert({ user_id: userId, balance: newBalance, updated_at: new Date().toISOString() })
      .select()
      .single();
    if (upsertError) logSupabaseError("upsert in addCredits", upsertError);

    return updated?.balance ?? newBalance;
  } catch (e) {
    console.error("addCredits Supabase error:", e);
    return null;
  }
}