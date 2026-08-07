// server/paymentLedger.ts
//
// Idempotency guard for Paystack payments. Both the webhook
// (POST /api/webhooks/paystack) and the browser-redirect callback
// (GET /api/credits/topup/callback) can end up processing the SAME
// successful charge — Paystack retries webhooks that don't get a fast
// 200, and a user's browser can land on the callback URL more than once
// (back button, refresh, double-tap). Without a shared idempotency check,
// that means double-crediting a real payment, both ways: a user could get
// free extra credits, or — if you ever reverse the logic — get shorted.
//
// tryClaimReference() does an atomic INSERT ... ON CONFLICT DO NOTHING
// against a small dedicated table, so whichever caller (webhook or
// callback) gets there first "claims" the reference and proceeds to
// credit the account; the other sees the conflict and skips.
//
// REQUIRES a one-time table creation in Supabase — see the SQL comment
// at the bottom of this file. Until that table exists, tryClaimReference
// fails safe: it treats the DB error as "not claimed" so payments still
// go through (rather than silently blocking real payments), but you lose
// the double-credit protection until the table exists — run the SQL below
// as soon as possible.

import { supabaseAdmin } from "./supabase";

export async function tryClaimReference(
  reference: string,
  purpose: "credit_topup" | "tier_upgrade",
  userId: string,
  amount: number,
): Promise<boolean> {
  if (!supabaseAdmin) return true; // no DB configured — fail open, can't dedupe
  try {
    const { error } = await supabaseAdmin
      .from("processed_payment_references")
      .insert({ reference, purpose, user_id: userId, amount });
    if (error) {
      // Unique-violation (23505) means someone already claimed this
      // reference — that's the expected "already processed" case, not a
      // real error.
      if (error.code === "23505") return false;
      // Table doesn't exist yet, or some other DB issue — fail open so a
      // missing migration doesn't block real payments, but log loudly
      // since double-credit protection is off until this is fixed.
      console.error("⚠️ tryClaimReference DB error (failing OPEN — payments still work, but double-credit protection is OFF until this table exists):", error.message);
      return true;
    }
    return true;
  } catch (e: any) {
    console.error("⚠️ tryClaimReference threw (failing open):", e?.message);
    return true;
  }
}

/*
Run this once in Supabase's SQL editor to enable double-credit protection:

create table if not exists processed_payment_references (
  reference text primary key,
  purpose text not null,
  user_id text not null,
  amount integer not null,
  created_at timestamptz not null default now()
);
*/
