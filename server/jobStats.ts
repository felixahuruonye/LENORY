/**
 * Real job statistics for Admin > Credit Usage. Every AI task (chat/agent runs, queue jobs like
 * transcription) is counted when it starts and when it finishes. Totals are kept per day in
 * memory and saved to the database, so history survives server restarts.
 */
import { supabaseAdmin } from "./supabase";

type Bucket = { done: number; failed: number; byType: Record<string, { done: number; failed: number }> };
const buckets = new Map<string, Bucket>();
const startedAt = Date.now();
const live = { running: 0 };
const liveByType = new Map<string, number>();
let sessionDone = 0, sessionFailed = 0;
let loaded: Promise<void> | null = null;
let dirty = false;
let adminId: string | null = null;
const TYPE = "job_stats";

// Nigeria is UTC+1, so "today" rolls over at midnight Lagos time
const dayKey = (ts: number) => new Date(ts + 3600_000).toISOString().slice(0, 10);

async function getAdminId(): Promise<string | null> {
  if (adminId) return adminId;
  if (!supabaseAdmin) return null;
  try {
    const { data } = await supabaseAdmin.from("users").select("id").eq("email", "felixahuruonye@gmail.com").limit(1);
    adminId = (data?.[0] as any)?.id || null;
  } catch {}
  return adminId;
}
function load(): Promise<void> {
  if (loaded) return loaded;
  loaded = (async () => {
    const id = await getAdminId();
    if (!id || !supabaseAdmin) return;
    try {
      const { data } = await supabaseAdmin.from("memory_entries").select("content").eq("type", TYPE).eq("user_id", id).order("created_at", { ascending: false }).limit(1);
      const obj = data?.[0]?.content ? JSON.parse((data[0] as any).content) : null;
      for (const [k, v] of Object.entries<any>(obj?.buckets || {})) {
        const cur = buckets.get(k);
        buckets.set(k, cur ? merge(cur, v) : v);
      }
    } catch {}
  })();
  return loaded;
}
function merge(a: Bucket, b: Bucket): Bucket {
  const out: Bucket = { done: a.done + b.done, failed: a.failed + b.failed, byType: { ...a.byType } };
  for (const [t, v] of Object.entries(b.byType || {})) out.byType[t] = { done: (out.byType[t]?.done || 0) + v.done, failed: (out.byType[t]?.failed || 0) + v.failed };
  return out;
}
async function flush() {
  if (!dirty || !supabaseAdmin) return;
  const id = await getAdminId();
  if (!id) return;
  dirty = false;
  try {
    const cutoff = dayKey(Date.now() - 120 * 86400_000);
    const keep: Record<string, Bucket> = {};
    for (const [k, v] of buckets) if (k >= cutoff) keep[k] = v;
    const { data: old } = await supabaseAdmin.from("memory_entries").select("id").eq("type", TYPE).eq("user_id", id);
    const { error } = await supabaseAdmin.from("memory_entries").insert({ id: `js_${Date.now()}`, user_id: id, type: TYPE, subject: "job_stats", content: JSON.stringify({ buckets: keep }) });
    if (error) { dirty = true; return; }
    for (const r of old || []) await supabaseAdmin.from("memory_entries").delete().eq("id", (r as any).id);
  } catch { dirty = true; }
}
setInterval(() => { flush().catch(() => {}); }, 30_000).unref?.();

/** Call when a task starts; call the returned function with true/false when it ends. */
export function trackJob(type: string): (ok: boolean) => void {
  live.running++;
  liveByType.set(type, (liveByType.get(type) || 0) + 1);
  load().catch(() => {});
  let finished = false;
  return (ok: boolean) => {
    if (finished) return; finished = true;
    live.running = Math.max(0, live.running - 1);
    liveByType.set(type, Math.max(0, (liveByType.get(type) || 1) - 1));
    const k = dayKey(Date.now());
    const b = buckets.get(k) || { done: 0, failed: 0, byType: {} };
    const t = b.byType[type] || { done: 0, failed: 0 };
    if (ok) { b.done++; t.done++; sessionDone++; } else { b.failed++; t.failed++; sessionFailed++; }
    b.byType[type] = t; buckets.set(k, b); dirty = true;
  };
}

export type Period = "now" | "today" | "yesterday" | "7d" | "30d" | "90d" | "custom";
export async function getJobStats(period: Period, from?: string, to?: string, queued = 0, maxConcurrent = 2, queueRunning = 0) {
  await load().catch(() => {});
  const now = Date.now();
  let start: string, end: string;
  if (period === "yesterday") { start = end = dayKey(now - 86400_000); }
  else if (period === "7d") { start = dayKey(now - 6 * 86400_000); end = dayKey(now); }
  else if (period === "30d") { start = dayKey(now - 29 * 86400_000); end = dayKey(now); }
  else if (period === "90d") { start = dayKey(now - 89 * 86400_000); end = dayKey(now); }
  else if (period === "custom" && from && to) { start = from.slice(0, 10); end = to.slice(0, 10); }
  else { start = end = dayKey(now); }
  let done = 0, failed = 0; const byType: Record<string, { done: number; failed: number }> = {};
  if (period === "now") { done = sessionDone; failed = sessionFailed; }
  else for (const [k, v] of buckets) {
    if (k < start || k > end) continue;
    done += v.done; failed += v.failed;
    for (const [t, c] of Object.entries(v.byType)) byType[t] = { done: (byType[t]?.done || 0) + c.done, failed: (byType[t]?.failed || 0) + c.failed };
  }
  const isLive = period === "now" || period === "today";
  return {
    period, from: start, to: end,
    queued: isLive ? queued : 0,
    running: isLive ? live.running + queueRunning : 0,
    done, failed, maxConcurrent,
    note: period === "now" ? `Live view. Done/failed counted since the server last started (${new Date(startedAt).toISOString()}).` : "Totals for the selected days (Lagos time).",
    byType,
    liveByType: Object.fromEntries([...liveByType].filter(([, n]) => n > 0)),
  };
}
