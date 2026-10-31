/**
 * Memory preferences: six things the student writes once (Memory > Preferences) that LENORY
 * then follows in EVERY conversation (Chat and Live AI) - the same idea as Claude's
 * "additional instructions". Stored in the existing memory_entries table.
 */
import { storage } from "../storage";

export const PREF_FIELDS = [
  { key: "learningPreference", label: "Learning preference", hint: "How you like to learn: step-by-step, examples first, short answers, Nigerian examples..." },
  { key: "longTermGoals", label: "Long term goals", hint: "What you are working toward: graduate with a first class, become a software engineer, start a business..." },
  { key: "technicalSkills", label: "Technical skills", hint: "What you already know: basic Python, Excel, HTML, networking..." },
  { key: "subjectsOfInterest", label: "Subjects of interest", hint: "Topics you care about: databases, AI, accounting, physics..." },
  { key: "businessEducation", label: "Business and educational details", hint: "Your school, course, level, business or project details" },
  { key: "writingStyle", label: "Writing style", hint: "How LENORY should write for you: simple English, formal, friendly, bullet points..." },
] as const;
export type PrefKey = (typeof PREF_FIELDS)[number]["key"];
export type MemoryPrefs = Record<PrefKey, string>;
export const EMPTY_PREFS: MemoryPrefs = { learningPreference: "", longTermGoals: "", technicalSkills: "", subjectsOfInterest: "", businessEducation: "", writingStyle: "" };
const MAX = 1500;

export function sanitizePrefs(input: any): MemoryPrefs {
  const out = { ...EMPTY_PREFS };
  if (!input || typeof input !== "object") return out;
  for (const f of PREF_FIELDS) if (typeof input[f.key] === "string") out[f.key] = input[f.key].replace(/\r\n?/g, "\n").trim().slice(0, MAX);
  return out;
}

const cache = new Map<string, { prefs: MemoryPrefs; at: number }>();
export async function loadMemoryPrefs(userId: string, fresh = false): Promise<MemoryPrefs> {
  const hit = cache.get(userId);
  if (!fresh && hit && Date.now() - hit.at < 30_000) return hit.prefs;
  let prefs = { ...EMPTY_PREFS };
  try {
    const rows = await storage.getMemoryEntriesByUser(userId);
    const row = (rows || []).find((r: any) => r.type === "memory_preferences"); // newest first
    if (row?.data) prefs = sanitizePrefs(row.data);
  } catch (e) { console.warn("[memoryPrefs] load failed:", (e as any)?.message); }
  cache.set(userId, { prefs, at: Date.now() });
  return prefs;
}
export async function saveMemoryPrefs(userId: string, next: any): Promise<MemoryPrefs> {
  const prefs = sanitizePrefs(next);
  await storage.createMemoryEntry({ userId, type: "memory_preferences", data: prefs as any });
  cache.set(userId, { prefs, at: Date.now() });
  return prefs;
}

/** The "additional system message": appended to the prompt for Chat and Live AI. Empty string when nothing is set. */
export function buildPrefsBlock(prefs: MemoryPrefs): string {
  const lines = PREF_FIELDS.filter((f) => prefs[f.key]).map((f) => `- ${f.label}: ${prefs[f.key].replace(/\n+/g, " / ")}`);
  if (!lines.length) return "";
  return `\n\n## STUDENT'S OWN PREFERENCES (written by the student in Memory > Preferences)
Follow these in every answer so LENORY feels made for this student: match the learning style, aim at the goals, pitch explanations to the skills listed, favour the subjects of interest when choosing examples, use the education/business details as background, and write in the stated style. They are preferences about HOW to help - they never override safety rules, honesty, or what the student asks for right now. Do not recite them back unless asked.
${lines.join("\n")}`;
}
export async function prefsBlockFor(userId: string): Promise<string> {
  return buildPrefsBlock(await loadMemoryPrefs(userId));
}
