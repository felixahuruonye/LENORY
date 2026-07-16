// server/creditsStore.ts
// Real, persistent credit tracking. Supabase is the source of truth — a server
// restart, deploy, or crash must never reset anyone's balance again.

import { supabaseDb } from "./db";

export interface CreditRecord {
  balance: number;
  monthlyUsed: number;
  dailyGiven: number;
  lastDailyReset: string;
  lastMonthlyReset: string;
}

// Sized against real Gemini 2.5 Flash pricing ($0.30/1M input, $2.50/1M output).
// A typical thorough LENORY answer runs ~3000 input + ~1000 output tokens,
// which costs roughly ₦5 per message at current USD/NGN rates. Adjust here —
// and only here — as real usage data comes in from the admin dashboard.
export const CREDIT_TIERS: Record<string, { dailyAdd: number; maxBalance: number }> = {
  free: { dailyAdd: 10, maxBalance: 30 },
  pro: { dailyAdd: 60, maxBalance: 180 },
  premium: { dailyAdd: 150, maxBalance: 450 },
};

export function getTierLimits(tier: string) {
  return CREDIT_TIERS[tier] || CREDIT_TIERS.free;
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

function fallbackGetOrCreate(userId: string, tier: string): CreditRecord {
  const today = todayKey();
  if (!emergencyFallbackStore.has(userId)) {
    const limits = getTierLimits(tier);
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
    const limits = getTierLimits(tier);
    rec.balance = Math.min(rec.balance + limits.dailyAdd, limits.maxBalance);
    rec.dailyGiven = limits.dailyAdd;
    rec.lastDailyReset = today;
  }
  return rec;
}

// Fetch (or create) a user's credit record, applying the daily top-up if a new
// day has started. This is the ONLY function that should read credit state.
export async function getOrCreateCredits(userId: string, tier: string = "free"): Promise<CreditRecord> {
  const today = todayKey();
  const limits = getTierLimits(tier);

  if (!supabaseDb) {
    console.warn("⚠️ Supabase unavailable — using emergency in-memory credits fallback");
    return fallbackGetOrCreate(userId, tier);
  }

  try {
    let { data, error } = await supabaseDb
      .from("user_credits")
      .select("*")
      .eq("user_id", userId)
      .single();

    if (error || !data) {
      const inserted = await supabaseDb
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
      data = inserted.data;
      if (!data) throw new Error("Failed to create credit record");
    }

    // Daily reset
    if (data.last_daily_reset !== today) {
      const newBalance = Math.min(data.balance + limits.dailyAdd, limits.maxBalance);
      const currentMonth = monthKey();
      const isNewMonth = data.last_monthly_reset !== currentMonth;
      const updated = await supabaseDb
        .from("user_credits")
        .update({
          balance: newBalance,
          daily_given: limits.dailyAdd,
          last_daily_reset: today,
          monthly_used: isNewMonth ? 0 : data.monthly_used,
          last_monthly_reset: isNewMonth ? currentMonth : data.last_monthly_reset,
        })
        .eq("user_id", userId)
        .select()
        .single();
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
  if (!supabaseDb) {
    const rec = emergencyFallbackStore.get(userId);
    if (rec) { rec.balance -= amount; rec.monthlyUsed += amount; return rec.balance; }
    return null;
  }
  try {
    const { data } = await supabaseDb.from("user_credits").select("balance, monthly_used").eq("user_id", userId).single();
    if (!data) return null;
    const newBalance = data.balance - amount;
    const { data: updated } = await supabaseDb
      .from("user_credits")
      .update({ balance: newBalance, monthly_used: data.monthly_used + amount, updated_at: new Date().toISOString() })
      .eq("user_id", userId)
      .select()
      .single();
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
export async function resetMonthlyCredits(userId: string, tier: string): Promise<CreditRecord | null> {
  const limits = getTierLimits(tier);
  const today = todayKey();
  const currentMonth = monthKey();
  if (!supabaseDb) {
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
    const { data } = await supabaseDb
      .from("user_credits")
      .update({ monthly_used: 0, last_monthly_reset: currentMonth, balance: limits.dailyAdd, last_daily_reset: today, updated_at: new Date().toISOString() })
      .eq("user_id", userId)
      .select()
      .single();
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
  const limits = getTierLimits(tier);
  if (!supabaseDb) {
    const rec = emergencyFallbackStore.get(userId);
    if (rec) { rec.balance = uncapped ? rec.balance + amount : Math.min(rec.balance + amount, limits.maxBalance); return rec.balance; }
    return null;
  }
  try {
    const { data } = await supabaseDb.from("user_credits").select("balance").eq("user_id", userId).single();
    const current = data?.balance ?? 0;
    const newBalance = uncapped ? current + amount : Math.min(current + amount, limits.maxBalance);
    const { data: updated } = await supabaseDb
      .from("user_credits")
      .upsert({ user_id: userId, balance: newBalance, updated_at: new Date().toISOString() })
      .select()
      .single();
    return updated?.balance ?? newBalance;
  } catch (e) {
    console.error("addCredits Supabase error:", e);
    return null;
  }
}
