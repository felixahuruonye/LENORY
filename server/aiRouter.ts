// server/aiRouter.ts
//
// Central multi-provider chat completion router with automatic quota-based
// failover. Previously EVERY chat response — regardless of tier — went
// through Gemini only (chatWithAISmartFallback's own comment said "now just
// uses Gemini directly"), so a single Gemini quota limit took the entire
// chat product down for every user, paid or free, at once. Groq and
// OpenRouter keys existed in the codebase but were either unused or only
// used as one extra branch that still fell straight back to Gemini on
// failure.
//
// "ultra" tier (Advanced mode / Pro+) → OpenRouter chain (5 strong models,
//   including DeepSeek) → falls through to the "fast" chain → Gemini.
// "fast" tier (default/free chat)     → Groq chain (cheap, fast)
//   → falls through to the "ultra" chain → Gemini.
// Gemini is always the last resort, never the only option.
//
// A model that comes back rate-limited or over quota is put on a cooldown
// so we don't keep re-trying it on every message — we just skip straight to
// the next model until the cooldown expires. Use getProviderCooldownStatus()
// to see what's currently down and when it resets.

import { chatWithGemini } from "./gemini";

import { laneContext } from "./laneContext";
export type ChatMsg = { role: string; content: string };

interface ModelSpec {
  provider: "openrouter" | "groq" | "gemini";
  model: string;
  label: string;
}

// ─── ULTRA (OpenRouter) ──────────────────────────────────────────────────
// OpenRouter model IDs shift over time — if one of these starts returning
// HTTP 400 "model not found" instead of 429, check https://openrouter.ai/models
// and swap the ID here. A 400 is treated like any other failure: skip to
// the next model in the chain, no special handling needed.
// --- THE THREE LANES (3 models each; the student's mode decides the provider) ---
//   Ultra  -> OpenRouter   Fast -> Groq   Vision -> Gemini
// Order differs by job: simple chat tries the CHEAPEST model first, heavy work tries
// the STRONGEST first. A model that hits its quota hands over to the next one in the
// same lane; only when all three rest does the lane show a countdown.
const M = (provider: ModelSpec["provider"], model: string, label: string): ModelSpec => ({ provider, model, label });
const SONNET = M("openrouter", "anthropic/claude-sonnet-5", "Claude Sonnet 5");
const GLM = M("openrouter", "z-ai/glm-5.2", "GLM 5.2");
const DSEEK = M("openrouter", "deepseek/deepseek-v4.1-flash", "DeepSeek V4.1 Flash");
const OSS120 = M("groq", "openai/gpt-oss-120b", "GPT-OSS 120B");
const QWEN = M("groq", "qwen/qwen3.8-27b", "Qwen 3.8 27B");
const OSS20 = M("groq", "openai/gpt-oss-20b", "GPT-OSS 20B");
const G35 = M("gemini", "gemini-3.5-flash", "Gemini 3.5 Flash");
const G3 = M("gemini", "gemini-3-flash-preview", "Gemini 3 Flash");
const GLITE = M("gemini", "gemini-3.1-flash-lite", "Gemini 3.1 Flash-Lite");
export type ChatLane = "ultra" | "fast" | "vision";
export const LANE_ORDER: Record<ChatLane, { heavy: ModelSpec[]; simple: ModelSpec[] }> = {
  ultra: { heavy: [SONNET, GLM, DSEEK], simple: [DSEEK, GLM, SONNET] },
  fast: { heavy: [OSS120, QWEN, OSS20], simple: [OSS20, OSS120, QWEN] },
  vision: { heavy: [G3, G35, GLITE], simple: [GLITE, G3, G35] },
};
export const LANE_NAMES: Record<ChatLane, string> = { ultra: "Ultra", fast: "Fast", vision: "Vision" };
const laneKeyOk = (spec: ModelSpec) => (spec.provider === "openrouter" ? !!process.env.OPENROUTER_API_KEY : spec.provider === "groq" ? !!process.env.GROQ_API_KEY : !!(process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY));
export const laneChain = (lane: ChatLane, heavy = true): ModelSpec[] => (heavy ? LANE_ORDER[lane].heavy : LANE_ORDER[lane].simple);
// Legacy names (kept so older callers/tests still work)
const ULTRA_CHAIN = LANE_ORDER.ultra.heavy;
const FAST_CHAIN = LANE_ORDER.fast.heavy;

const cooldowns = new Map<string, { until: number; reason: string }>();

function cooldownKey(spec: ModelSpec) {
  return `${spec.provider}:${spec.model}`;
}

function isOnCooldown(spec: ModelSpec): boolean {
  const c = cooldowns.get(cooldownKey(spec));
  if (!c) return false;
  if (Date.now() > c.until) {
    cooldowns.delete(cooldownKey(spec));
    return false;
  }
  return true;
}

function setCooldown(spec: ModelSpec, retryAfterSeconds: number | null, reason: string) {
  // Generic rate limits reset in ~60s. If the error text smells like a hard
  // quota/billing cutoff rather than a per-minute limit, cool down for 6h
  // instead so we're not hammering a dead key every request.
  const isHardQuota = /quota|billing|insufficient_quota|credit/i.test(reason);
  const is402 = /\b402\b/.test(reason); // credits can be topped up any minute, so re-check every 10 min
  const seconds = retryAfterSeconds ?? (is402 ? 600 : isHardQuota ? 6 * 60 * 60 : 60);
  const until = Date.now() + seconds * 1000;
  cooldowns.set(cooldownKey(spec), { until, reason });
  console.warn(`⏸️  ${spec.label} on cooldown for ${seconds}s — resets ${new Date(until).toISOString()} — ${reason}`);
}

/** test helper */
export const __cooldownsForTest = () => cooldowns;

function parseRetryAfterSeconds(headers: Headers): number | null {
  const ra = headers.get("retry-after");
  if (ra && !isNaN(Number(ra))) return Number(ra);
  return null;
}

async function callOpenAICompatible(
  baseUrl: string,
  apiKey: string,
  spec: ModelSpec,
  messages: ChatMsg[],
  extraHeaders?: Record<string, string>,
): Promise<string> {
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      ...(extraHeaders || {}),
    },
    body: JSON.stringify({
      model: spec.model,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      temperature: 0.5,
      max_tokens: 4096,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    if (res.status === 429 || res.status === 402 || res.status === 403) {
      const retryAfter = res.status === 429 ? parseRetryAfterSeconds(res.headers) : null;
      setCooldown(spec, retryAfter, `HTTP ${res.status}: ${text.slice(0, 200)}`);
    }
    throw new Error(`${spec.label} error ${res.status}: ${text.slice(0, 300)}`);
  }

  const data = await res.json();
  const content = data.choices?.[0]?.message?.content || "";
  if (!content.trim()) throw new Error(`${spec.label} returned an empty response`);
  return content;
}

async function callModel(spec: ModelSpec, messages: ChatMsg[]): Promise<string> {
  if (spec.provider === "openrouter") {
    const key = process.env.OPENROUTER_API_KEY;
    if (!key) throw new Error("No OPENROUTER_API_KEY configured");
    return callOpenAICompatible("https://openrouter.ai/api/v1", key, spec, messages, {
      "HTTP-Referer": "https://lenory.app",
      "X-Title": "LENORY AI",
    });
  }
  if (spec.provider === "groq") {
    const key = process.env.GROQ_API_KEY;
    if (!key) throw new Error("No GROQ_API_KEY configured");
    return callOpenAICompatible("https://api.groq.com/openai/v1", key, spec, messages);
  }
  if (spec.provider === "gemini") {
    const out = await callGemini(spec, messages.map((m) => ({ role: m.role === "assistant" ? "assistant" : m.role === "system" ? "system" : "user", content: m.content })) as any, []);
    return out.content;
  }
  throw new Error("Unknown provider: " + spec.provider);
}

async function runChain(
  chain: ModelSpec[],
  messages: ChatMsg[],
  trail: string[],
): Promise<{ text: string; modelUsed: string } | null> {
  for (const spec of chain) {
    if (isOnCooldown(spec)) {
      trail.push(`${spec.label} (skipped — cooling down)`);
      continue;
    }
    try {
      const text = await callModel(spec, messages);
      trail.push(spec.label);
      return { text, modelUsed: spec.label };
    } catch (e: any) {
      trail.push(`${spec.label} (failed: ${String(e?.message || "").slice(0, 80)})`);
      console.warn(`Model failed, trying next in chain — ${spec.label}:`, e?.message);
    }
  }
  return null;
}

// Main entry point every chat response should go through. Inside a signed-in request the
// student's lane decides the provider (Ultra=OpenRouter, Fast=Groq, Vision=Gemini) and we
// NEVER silently answer with another lane. Outside a request (cron/admin) the legacy
// Fast-then-Ultra order still applies.
export async function chatCompletionWithFailover(
  messages: ChatMsg[],
  tier: "ultra" | "fast" = "fast",
): Promise<{ text: string; modelUsed: string }> {
  const ctx = laneContext.getStore();
  const trail: string[] = [];
  if (ctx) {
    const heavy = messages.reduce((n, m) => n + (m.content?.length || 0), 0) > 6000;
    const result = await runChain(laneChain(ctx.lane, heavy), messages, trail);
    if (!result) throw new Error(`LANE_UNAVAILABLE:${ctx.lane}`);
    return result;
  }
  const primaryChain = tier === "ultra" ? ULTRA_CHAIN : FAST_CHAIN;
  const secondaryChain = tier === "ultra" ? FAST_CHAIN : ULTRA_CHAIN;
  let result = await runChain(primaryChain, messages, trail);
  if (!result) result = await runChain(secondaryChain, messages, trail);
  if (!result) result = await runChain(LANE_ORDER.vision.simple, messages, trail);
  if (!result) {
    console.error(`All AI providers failed. Chain tried: ${trail.join(" -> ")}`);
    throw new Error("All AI providers are currently unavailable");
  }
  return result;
}

/** Best currently-working Gemini model id (used by every direct Gemini feature call). */
export function pickGeminiModel(heavy = false): string {
  for (const spec of laneChain("vision", heavy)) if (!isOnCooldown(spec)) return spec.model;
  return laneChain("vision", heavy)[0].model;
}

// Lets Felix (or an admin panel) check what's currently on cooldown and when
// it resets, instead of guessing from logs.

// --- PRE-EMPTIVE RATE LIMITING + LANE STATUS ------------------------------
// We slow ourselves down BEFORE a provider throws 429, and we publish exactly
// when each lane (Ultra / Fast / Vision / Search) works again. Nobody bypasses
// this - admins included.
const RPM: Record<string, number> = {
  openrouter: Number(process.env.OPENROUTER_RPM || 16),
  groq: Number(process.env.GROQ_RPM || 22),
  gemini: Number(process.env.GEMINI_RPM || 10),
  tavily: Number(process.env.TAVILY_RPM || 30),
};
const windows = new Map<string, number[]>();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Waits a little (max ~6s) to stay under the provider's per-minute budget; throws SOFT_LIMIT:<ms> if the wait would be longer. */
export async function throttle(provider: string, maxWaitMs = 6000): Promise<void> {
  const limit = RPM[provider] || 20;
  for (let i = 0; i < 3; i++) {
    const now = Date.now();
    const w = (windows.get(provider) || []).filter((t) => now - t < 60_000);
    if (w.length < limit) { w.push(now); windows.set(provider, w); return; }
    const wait = 60_000 - (now - w[0]) + 30;
    windows.set(provider, w);
    if (wait > maxWaitMs) throw new Error(`SOFT_LIMIT:${wait}`);
    await sleep(wait);
  }
  throw new Error("SOFT_LIMIT:60000");
}

/** Cooldowns for non-chain providers (Gemini vision chat, Tavily/Gemini search). */
const external = new Map<string, { until: number; reason: string }>();
export function setExternalCooldown(key: string, seconds: number, reason: string) {
  external.set(key, { until: Date.now() + Math.max(5, seconds) * 1000, reason });
  console.warn(`[limits] ${key} unavailable for ${Math.round(seconds)}s: ${reason}`);
}
export function getExternalCooldown(key: string): { until: number; reason: string } | null {
  const c = external.get(key);
  if (!c) return null;
  if (Date.now() > c.until) { external.delete(key); return null; }
  return c;
}
/** Seconds until the next UTC month starts (Tavily plan limits reset monthly). */
export function secondsToNextMonth(): number {
  const n = new Date();
  return Math.ceil((Date.UTC(n.getUTCFullYear(), n.getUTCMonth() + 1, 1) - n.getTime()) / 1000);
}
export function parseRetryDelaySeconds(text: string): number | null {
  const m = String(text).match(/retry(?:Delay)?"?[:\s]+"?(\d+(?:\.\d+)?)s/i) || String(text).match(/retry in (\d+(?:\.\d+)?)s/i);
  return m ? Math.ceil(Number(m[1])) : null;
}

export type LaneId = "ultra" | "fast" | "vision" | "search";
export interface LaneStatus { lane: LaneId; label: string; available: boolean; resetsAt: string | null; resetsInSeconds: number; reason: string | null }

function chainStatus(chain: ModelSpec[]): { available: boolean; until: number | null; reason: string | null } {
  let earliest: number | null = null; let reason: string | null = null; let anyKey = false;
  for (const spec of chain) {
    if (!laneKeyOk(spec)) continue;
    anyKey = true;
    const c = cooldowns.get(cooldownKey(spec));
    if (!c || Date.now() > c.until) return { available: true, until: null, reason: null };
    if (earliest === null || c.until < earliest) { earliest = c.until; reason = c.reason; }
  }
  if (!anyKey) return { available: false, until: null, reason: "Not configured on the server" };
  return { available: false, until: earliest, reason };
}
function friendlyReason(r: string | null): string | null {
  if (!r) return null;
  if (/402|credit|quota|billing/i.test(r)) return "Provider credits or quota used up";
  if (/429|rate/i.test(r)) return "Provider rate limit reached";
  if (/throttl|SOFT/i.test(r)) return "Busy - protecting the provider limit";
  return "Temporarily unavailable";
}
export function getLaneStatuses(): LaneStatus[] {
  const now = Date.now();
  const mk = (lane: LaneId, label: string, st: { available: boolean; until: number | null; reason: string | null }): LaneStatus => ({
    lane, label, available: st.available,
    resetsAt: st.until ? new Date(st.until).toISOString() : null,
    resetsInSeconds: st.until ? Math.max(0, Math.ceil((st.until - now) / 1000)) : 0,
    reason: st.available ? null : friendlyReason(st.reason),
  });
  const ext = (key: string, hasKey: boolean) => {
    if (!hasKey) return { available: false, until: null as number | null, reason: "Not configured on the server" };
    const c = getExternalCooldown(key);
    return c ? { available: false, until: c.until, reason: c.reason } : { available: true, until: null as number | null, reason: null as string | null };
  };
  const fast = chainStatus(LANE_ORDER.fast.heavy);
  // Search needs a working web provider (Tavily and/or Gemini) AND a chat model to write the answer.
  const tav = ext("tavily:search", !!process.env.TAVILY_API_KEY);
  const gem = ext("gemini:search", !!(process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY));
  const searchWeb = tav.available || gem.available ? { available: true, until: null as number | null, reason: null as string | null }
    : { available: false, until: (() => { const v = [tav.until, gem.until].filter((x): x is number => !!x); return v.length ? Math.min(...v) : null; })(), reason: tav.until || gem.until ? "Search provider limit reached" : "Search is not configured on the server" };
  const searchAll = !searchWeb.available ? searchWeb : fast.available ? searchWeb : fast;
  return [
    mk("ultra", "LENORY Ultra", chainStatus(LANE_ORDER.ultra.heavy)),
    mk("fast", "LENORY Fast", fast),
    mk("vision", "LENORY Vision", chainStatus(LANE_ORDER.vision.heavy)),
    mk("search", "LENORY Search", searchAll),
  ];
}
/** True only when the WEB provider itself is exhausted (used to switch the Web search capability off). */
export function isWebSearchExhausted(): { exhausted: boolean; resetsAt: string | null } {
  const s = getLaneStatuses().find((l) => l.lane === "search")!;
  const tav = getExternalCooldown("tavily:search"); const gem = getExternalCooldown("gemini:search");
  const hasGem = !!(process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY);
  const exhausted = (!!tav || !process.env.TAVILY_API_KEY) && (!!gem || !hasGem) && !!(tav || gem);
  void s;
  return { exhausted, resetsAt: exhausted ? new Date(Math.min(...[tav?.until, gem?.until].filter((x): x is number => !!x))).toISOString() : null };
}

export function getProviderCooldownStatus() {
  const now = Date.now();
  const rows: { model: string; resetsInSeconds: number; resetsAt: string; reason: string }[] = [];
  for (const [key, c] of cooldowns.entries()) {
    if (c.until <= now) continue;
    rows.push({
      model: key,
      resetsInSeconds: Math.ceil((c.until - now) / 1000),
      resetsAt: new Date(c.until).toISOString(),
      reason: c.reason,
    });
  }
  return rows;
}

// ─── NATIVE TOOL CALLING ────────────────────────────────────────────────
// Same provider chains and cooldowns as chatCompletionWithFailover, but sends
// OpenAI-style `tools` and returns structured tool calls. Providers that fail
// or ignore tools are skipped. There is NO text-parsing fallback and NO
// Gemini fallback here: if no provider can do tool calling, we say so.

export interface ToolSchema {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, any> };
}
export interface ToolCall {
  id: string;
  name: string;
  arguments: any; // parsed JSON (or {} if the model sent invalid JSON)
  argumentsRaw: string;
}
export type AgentMsg =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: any[] }
  | { role: "tool"; tool_call_id: string; content: string };

// --- Gemini (REST) with native function calling ---------------------------------
const stripSchema = (sch: any): any => {
  if (Array.isArray(sch)) return sch.map(stripSchema);
  if (sch && typeof sch === "object") {
    const out: any = {};
    for (const [k, v] of Object.entries(sch)) { if (k === "additionalProperties" || k === "$schema" || k === "default") continue; out[k] = stripSchema(v); }
    return out;
  }
  return sch;
};
async function callGemini(spec: ModelSpec, messages: AgentMsg[], tools: ToolSchema[]): Promise<{ content: string; toolCalls: ToolCall[]; rawAssistant: any }> {
  const key = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
  if (!key) throw new Error("No Gemini API key configured");
  const names = new Map<string, string>();
  const contents: any[] = [];
  let system = "";
  for (const m of messages as any[]) {
    if (m.role === "system") { system += (system ? "\n\n" : "") + m.content; continue; }
    if (m.role === "user") { contents.push({ role: "user", parts: [{ text: String(m.content ?? "") }] }); continue; }
    if (m.role === "assistant") {
      for (const tc of m.tool_calls || []) names.set(tc.id, tc.function?.name);
      const parts = m._geminiParts || [
        ...(m.content ? [{ text: m.content }] : []),
        ...(m.tool_calls || []).map((tc: any) => ({ functionCall: { name: tc.function.name, args: (() => { try { return JSON.parse(tc.function.arguments || "{}"); } catch { return {}; } })() } })),
      ];
      if (parts.length) contents.push({ role: "model", parts });
      continue;
    }
    if (m.role === "tool") {
      const part = { functionResponse: { name: names.get(m.tool_call_id) || "tool", response: { result: String(m.content ?? "") } } };
      const last = contents[contents.length - 1];
      if (last && last.role === "user" && last.parts.every((p: any) => p.functionResponse)) last.parts.push(part);
      else contents.push({ role: "user", parts: [part] });
    }
  }
  if (!contents.length) contents.push({ role: "user", parts: [{ text: "Hello" }] });
  const body: any = { contents, generationConfig: { temperature: 0.4, maxOutputTokens: 8192 } };
  if (system) body.systemInstruction = { parts: [{ text: system }] };
  if (tools.length) body.tools = [{ functionDeclarations: tools.map((t) => ({ name: t.function.name, description: t.function.description, ...(Object.keys(t.function.parameters?.properties || {}).length ? { parameters: stripSchema(t.function.parameters) } : {}) })) }];
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${spec.model}:generateContent`, {
    method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": key }, body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    if (res.status === 429 || res.status === 403) setCooldown(spec, parseRetryDelaySeconds(text) ?? (/per day|daily/i.test(text) ? 3600 : 60), `HTTP ${res.status}: ${text.slice(0, 200)}`);
    throw new Error(`${spec.label} error ${res.status}: ${text.slice(0, 300)}`);
  }
  const data: any = await res.json();
  if (data.promptFeedback?.blockReason) throw new Error(`${spec.label} flagged this request (${data.promptFeedback.blockReason}) - switching model`);
  const cand = data.candidates?.[0];
  if (cand?.finishReason === "SAFETY" || cand?.finishReason === "PROHIBITED_CONTENT") throw new Error(`${spec.label} flagged this request - switching model`);
  const parts: any[] = cand?.content?.parts || [];
  const content = parts.filter((p) => typeof p.text === "string" && !p.thought).map((p) => p.text).join("");
  const toolCalls: ToolCall[] = parts.filter((p) => p.functionCall).map((p, i) => ({ id: `gem_${Date.now()}_${i}`, name: p.functionCall.name, arguments: p.functionCall.args || {}, argumentsRaw: JSON.stringify(p.functionCall.args || {}) }));
  if (!content.trim() && !toolCalls.length) throw new Error(`${spec.label} returned an empty response`);
  return {
    content, toolCalls,
    rawAssistant: { role: "assistant", content: content || null, _geminiParts: parts, ...(toolCalls.length ? { tool_calls: toolCalls.map((t) => ({ id: t.id, type: "function", function: { name: t.name, arguments: t.argumentsRaw } })) } : {}) },
  };
}

/** One call for a lane: tries that lane's 3 models in order (cheapest-first for simple, strongest-first for heavy). */
export async function chatWithLane(
  messages: AgentMsg[], tools: ToolSchema[], lane: ChatLane, heavy: boolean,
): Promise<{ content: string; toolCalls: ToolCall[]; rawAssistant: any; modelUsed: string }> {
  const trail: string[] = [];
  for (const spec of laneChain(lane, heavy)) {
    if (!laneKeyOk(spec)) { trail.push(`${spec.label} (no key)`); continue; }
    if (isOnCooldown(spec)) { trail.push(`${spec.label} (resting)`); continue; }
    try { await throttle(spec.provider); } catch (te: any) {
      setCooldown(spec, Math.ceil((Number(String(te?.message).split(":")[1]) || 30000) / 1000), "throttled to protect the provider limit");
      trail.push(`${spec.label} (busy)`); continue;
    }
    try {
      let out;
      if (spec.provider === "gemini") out = await callGemini(spec, messages, tools);
      else {
        const key = spec.provider === "openrouter" ? process.env.OPENROUTER_API_KEY! : process.env.GROQ_API_KEY!;
        const base = spec.provider === "openrouter" ? "https://openrouter.ai/api/v1" : "https://api.groq.com/openai/v1";
        const extra = spec.provider === "openrouter" ? { "HTTP-Referer": "https://lenory.app", "X-Title": "LENORY AI" } : undefined;
        out = await callOpenAICompatibleTools(base, key, spec, messages, tools, extra);
      }
      return { ...out, modelUsed: spec.label };
    } catch (e: any) {
      trail.push(`${spec.label}: ${String(e?.message || "").slice(0, 80)}`);
      console.warn(`[lane ${lane}] ${spec.label} failed, trying next:`, e?.message);
    }
  }
  throw new Error(`LANE_UNAVAILABLE:${lane}:${trail.join(" | ")}`);
}

async function callOpenAICompatibleTools(
  baseUrl: string,
  apiKey: string,
  spec: ModelSpec,
  messages: AgentMsg[],
  tools: ToolSchema[],
  extraHeaders?: Record<string, string>,
): Promise<{ content: string; toolCalls: ToolCall[]; rawAssistant: any }> {
  const body: any = { model: spec.model, messages, temperature: 0.4, max_tokens: 6000 };
  if (tools.length) {
    body.tools = tools;
    body.tool_choice = "auto";
  }
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", ...(extraHeaders || {}) },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    if (res.status === 429 || res.status === 402 || res.status === 403) {
      const retryAfter = res.status === 429 ? parseRetryAfterSeconds(res.headers) : null;
      setCooldown(spec, retryAfter, `HTTP ${res.status}: ${text.slice(0, 200)}`);
    }
    throw new Error(`${spec.label} error ${res.status}: ${text.slice(0, 300)}`);
  }
  const data = await res.json();
  const msg = data.choices?.[0]?.message;
  const content: string = msg?.content || "";
  // Safety-flag switch: if this model's safety layer blocked or refused the reply,
  // throw so the failover moves on to the NEXT model instead of showing a false refusal.
  const finish = data.choices?.[0]?.finish_reason;
  if (finish === "content_filter" || msg?.refusal || (!msg?.tool_calls?.length && content.length < 220 && /^(i'?m sorry,? but )?i (can(no|')t|am (not able|unable) to|won'?t) (help|assist|comply|do that|provide)/i.test(content.trim()))) {
    throw new Error(`${spec.label} flagged/refused this request - switching model`);
  }
  const toolCalls: ToolCall[] = (msg?.tool_calls || [])
    .filter((c: any) => c?.function?.name)
    .map((c: any, i: number) => {
      const raw = String(c.function.arguments || "{}");
      let parsed: any = {};
      try { parsed = JSON.parse(raw); } catch { parsed = {}; }
      return { id: c.id || `call_${Date.now()}_${i}`, name: c.function.name, arguments: parsed, argumentsRaw: raw };
    });
  if (!content.trim() && toolCalls.length === 0) throw new Error(`${spec.label} returned an empty response`);
  return {
    content,
    toolCalls,
    rawAssistant: {
      role: "assistant",
      content: content || null,
      ...(toolCalls.length
        ? { tool_calls: toolCalls.map((t) => ({ id: t.id, type: "function", function: { name: t.name, arguments: t.argumentsRaw } })) }
        : {}),
    },
  };
}

export async function chatWithToolsFailover(
  messages: AgentMsg[],
  tools: ToolSchema[],
  tier: "ultra" | "fast" = "fast",
  strict = false,
): Promise<{ content: string; toolCalls: ToolCall[]; rawAssistant: any; modelUsed: string }> {
  const lanes: ChatLane[] = strict ? [tier] : tier === "ultra" ? ["ultra", "fast"] : ["fast", "ultra"];
  let lastErr: any;
  for (const lane of lanes) {
    try { return await chatWithLane(messages, tools, lane, true); } catch (e) { lastErr = e; }
  }
  throw new Error("All AI providers are currently unavailable. " + String(lastErr?.message || ""));
}
