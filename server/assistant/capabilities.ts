/**
 * Claude-style capability switches for LENORY, persisted per user in the
 * existing memory_entries table (type = "capabilities") so they survive
 * Render restarts. No new table / migration required.
 */
import { storage } from "../storage";

export type ToolAccessMode = "auto" | "on_demand" | "always";

export interface UserCapabilities {
  webSearch: boolean;
  fileCreation: boolean;
  artifacts: boolean;
  memory: boolean;
  knowledgeBase: boolean;
  toolAccess: ToolAccessMode;
  /** When true, the model may create KB folders and add notes/files to them */
  kbWrite: boolean;
  /** Run code in an isolated remote sandbox (only works when the server has CODE_SANDBOX_URL) */
  codeExecution: boolean;
  /** Let LENORY read/create items in the Project Workspace */
  projects: boolean;
}

export const DEFAULT_CAPABILITIES: UserCapabilities = {
  webSearch: true,
  fileCreation: true,
  artifacts: true,
  memory: true,
  knowledgeBase: true,
  toolAccess: "auto",
  kbWrite: true,
  codeExecution: false,
  projects: true,
};

const BOOL_KEYS = ["webSearch", "fileCreation", "artifacts", "memory", "knowledgeBase", "kbWrite", "codeExecution", "projects"] as const;

/** Accept only known keys with the right types (never trust raw client JSON). */
export function sanitizeCapabilities(input: any): Partial<UserCapabilities> {
  const out: Partial<UserCapabilities> = {};
  if (!input || typeof input !== "object") return out;
  for (const k of BOOL_KEYS) if (typeof input[k] === "boolean") (out as any)[k] = input[k];
  if (["auto", "on_demand", "always"].includes(input.toolAccess)) out.toolAccess = input.toolAccess;
  return out;
}

const cache = new Map<string, { caps: UserCapabilities; at: number }>();
const TTL = 60_000;

export function getUserCapabilities(userId: string, override?: Partial<UserCapabilities> | null): UserCapabilities {
  const base = { ...DEFAULT_CAPABILITIES, ...(cache.get(userId)?.caps || {}) };
  return override ? { ...base, ...sanitizeCapabilities(override) } : base;
}

/** Loads the saved capabilities from the database (cached for a minute). */
export async function loadUserCapabilities(userId: string): Promise<UserCapabilities> {
  const hit = cache.get(userId);
  if (hit && Date.now() - hit.at < TTL) return hit.caps;
  let caps = { ...DEFAULT_CAPABILITIES };
  try {
    const rows = await storage.getMemoryEntriesByUser(userId);
    const row = (rows || []).find((r: any) => r.type === "capabilities");
    if (row?.data) caps = { ...caps, ...sanitizeCapabilities(row.data) };
  } catch (e) {
    console.warn("[capabilities] load failed, using defaults:", (e as any)?.message);
  }
  cache.set(userId, { caps, at: Date.now() });
  return caps;
}

export async function saveUserCapabilities(userId: string, next: any): Promise<UserCapabilities> {
  const merged = { ...(await loadUserCapabilities(userId)), ...sanitizeCapabilities(next) };
  await storage.createMemoryEntry({ userId, type: "capabilities", data: merged as any });
  cache.set(userId, { caps: merged, at: Date.now() });
  return merged;
}
// Back-compat name used by routes
export const setUserCapabilities = saveUserCapabilities;

/** What the server can actually do right now (shown on the Capabilities page, never faked). */
export function capabilityAvailability() {
  return {
    codeExecution: !!process.env.CODE_SANDBOX_URL,
    imageGeneration: !!process.env.STABILITY_API_KEY,
    webSearch: !!(process.env.TAVILY_API_KEY || process.env.GEMINI_API_KEY),
  };
}
