/**
 * Who may use which LENORY mode, which mode each student is on, and what each costs.
 *   free -> Vision only | pro -> Vision + Fast | premium -> all three | admin -> all
 * The saved choice lives on the server (memory_entries, type "model_lane"), so a Render
 * restart, a new device or a new chat keeps the same mode until the plan changes.
 */
import { storage } from "../storage";
import type { ChatLane } from "../laneContext";
import { getFeatureCost } from "../creditsStore";

const ADMIN_EMAIL = "felixahuruonye@gmail.com";
export const PLAN_LANES: Record<string, ChatLane[]> = { free: ["vision"], pro: ["vision", "fast"], premium: ["vision", "fast", "ultra"] };
const PLAN_DEFAULT: Record<string, ChatLane> = { free: "vision", pro: "fast", premium: "ultra" };
export const ALL_LANES: ChatLane[] = ["vision", "fast", "ultra"];

export interface LaneProfile { lane: ChatLane; allowed: ChatLane[]; plan: string; isAdmin: boolean }
const cache = new Map<string, { saved: ChatLane | null; at: number }>();

async function loadSaved(userId: string, fresh = false): Promise<ChatLane | null> {
  const hit = cache.get(userId);
  if (!fresh && hit && Date.now() - hit.at < 30_000) return hit.saved;
  let saved: ChatLane | null = null;
  try {
    const rows = await storage.getMemoryEntriesByUser(userId);
    const row: any = (rows || []).find((r: any) => r.type === "model_lane");
    const v = row?.data?.lane;
    if (v === "ultra" || v === "fast" || v === "vision") saved = v;
  } catch {}
  cache.set(userId, { saved, at: Date.now() });
  return saved;
}

export async function getLaneProfile(userId: string, user?: any): Promise<LaneProfile> {
  const u = user ?? (await storage.getUser(userId));
  const isAdmin = u?.email === ADMIN_EMAIL;
  const plan = isAdmin ? "premium" : String(u?.subscriptionTier || "free");
  const allowed = isAdmin ? ALL_LANES : PLAN_LANES[plan] || PLAN_LANES.free;
  const saved = await loadSaved(userId);
  // a saved mode the plan no longer allows (e.g. subscription ended) falls back to the plan's default
  const lane = saved && allowed.includes(saved) ? saved : isAdmin ? "ultra" : PLAN_DEFAULT[plan] || "vision";
  return { lane, allowed, plan, isAdmin };
}

export async function saveLane(userId: string, lane: ChatLane): Promise<void> {
  const rows = await storage.getMemoryEntriesByUser(userId);
  const old = (rows || []).filter((r: any) => r.type === "model_lane");
  await storage.createMemoryEntry({ userId, type: "model_lane", data: { lane } as any } as any);
  for (const r of old) await storage.deleteMemoryEntry(userId, (r as any).id).catch(() => false);
  cache.set(userId, { saved: lane, at: Date.now() });
}

// --- credit cost keys (all editable in Admin > Credit Usage; nothing hard-coded in the chat path) ---
export const laneCostKey = (lane: ChatLane, heavy: boolean) => `chat_${lane}_${heavy ? "heavy" : "simple"}`;
export const laneCost = (lane: ChatLane, heavy: boolean) => getFeatureCost(laneCostKey(lane, heavy));

/** A job counts as heavy when it used tools, needed several model steps, or is long in or out. */
export function isHeavyJob(o: { toolsUsed?: string[]; steps?: number; question?: string; answer?: string; hasMedia?: boolean }): boolean {
  return !!(o.toolsUsed?.length || (o.steps || 1) > 1 || (o.question?.length || 0) > 800 || (o.answer?.length || 0) > 2500 || o.hasMedia);
}
