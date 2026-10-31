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

export type ChatMsg = { role: string; content: string };

interface ModelSpec {
  provider: "openrouter" | "groq";
  model: string;
  label: string;
}

// ─── ULTRA (OpenRouter) ──────────────────────────────────────────────────
// OpenRouter model IDs shift over time — if one of these starts returning
// HTTP 400 "model not found" instead of 429, check https://openrouter.ai/models
// and swap the ID here. A 400 is treated like any other failure: skip to
// the next model in the chain, no special handling needed.
const ULTRA_CHAIN: ModelSpec[] = [
  { provider: "openrouter", model: "anthropic/claude-sonnet-5", label: "Claude Sonnet 5 (OpenRouter)" },
  { provider: "openrouter", model: "openai/gpt-5.1", label: "GPT-5.1 (OpenRouter)" },
  { provider: "openrouter", model: "deepseek/deepseek-v4", label: "DeepSeek V4 (OpenRouter)" },
  { provider: "openrouter", model: "x-ai/grok-4", label: "Grok 4 (OpenRouter)" },
  { provider: "openrouter", model: "openrouter/auto", label: "OpenRouter Auto (curated pool)" },
];

// ─── FAST (Groq) ─────────────────────────────────────────────────────────
// Groq's free-tier lineup changes often — check
// https://console.groq.com/docs/deprecations if one of these starts 400ing.
// Deliberately NOT using llama-3.1-8b-instant / llama-3.3-70b-versatile —
// Groq is fully retiring both on 2026-08-16.
const FAST_CHAIN: ModelSpec[] = [
  { provider: "groq", model: "openai/gpt-oss-120b", label: "GPT-OSS 120B (Groq)" },
  { provider: "groq", model: "qwen/qwen3-32b", label: "Qwen3 32B (Groq)" },
  { provider: "groq", model: "meta-llama/llama-4-scout-17b-16e-instruct", label: "Llama 4 Scout (Groq)" },
];

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

// Main entry point every chat response should go through. Never throws
// unless literally every provider (including Gemini) failed.
export async function chatCompletionWithFailover(
  messages: ChatMsg[],
  tier: "ultra" | "fast" = "fast",
): Promise<{ text: string; modelUsed: string }> {
  const trail: string[] = [];
  const primaryChain = tier === "ultra" ? ULTRA_CHAIN : FAST_CHAIN;
  const secondaryChain = tier === "ultra" ? FAST_CHAIN : ULTRA_CHAIN;

  let result = await runChain(primaryChain, messages, trail);
  if (!result) result = await runChain(secondaryChain, messages, trail);

  if (!result) {
    try {
      const text = await chatWithGemini(messages as any);
      trail.push("Gemini 2.5 Flash (last resort)");
      return { text, modelUsed: "Gemini 2.5 Flash" };
    } catch (e: any) {
      console.error(`🔥 All AI providers failed. Chain tried: ${trail.join(" → ")}`);
      throw new Error("All AI providers are currently unavailable");
    }
  }
  return result;
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
  let earliest: number | null = null; let reason: string | null = null;
  for (const spec of chain) {
    const key = spec.provider === "openrouter" ? process.env.OPENROUTER_API_KEY : process.env.GROQ_API_KEY;
    if (!key) continue;
    const c = cooldowns.get(cooldownKey(spec));
    if (!c || Date.now() > c.until) return { available: true, until: null, reason: null };
    if (earliest === null || c.until < earliest) { earliest = c.until; reason = c.reason; }
  }
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
  const fast = chainStatus(FAST_CHAIN);
  // Search needs a working web provider (Tavily and/or Gemini) AND a chat model to write the answer.
  const tav = ext("tavily:search", !!process.env.TAVILY_API_KEY);
  const gem = ext("gemini:search", !!(process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY));
  const searchWeb = tav.available || gem.available ? { available: true, until: null as number | null, reason: null as string | null }
    : { available: false, until: (() => { const v = [tav.until, gem.until].filter((x): x is number => !!x); return v.length ? Math.min(...v) : null; })(), reason: tav.until || gem.until ? "Search provider limit reached" : "Search is not configured on the server" };
  const searchAll = !searchWeb.available ? searchWeb : fast.available ? searchWeb : fast;
  return [
    mk("ultra", "LENORY Ultra", chainStatus(ULTRA_CHAIN)),
    mk("fast", "LENORY Fast", fast),
    mk("vision", "LENORY Vision", ext("gemini:vision", !!(process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY))),
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
  const trail: string[] = [];
  // strict = the student chose this exact model: never silently answer with a different one.
  const chains = strict ? [tier === "ultra" ? ULTRA_CHAIN : FAST_CHAIN] : tier === "ultra" ? [ULTRA_CHAIN, FAST_CHAIN] : [FAST_CHAIN, ULTRA_CHAIN];
  for (const chain of chains) {
    for (const spec of chain) {
      if (isOnCooldown(spec)) { trail.push(`${spec.label} (cooling down)`); continue; }
      try {
        try { await throttle(spec.provider); } catch (te: any) {
          const ms = Number(String(te?.message).split(":")[1]) || 30000;
          setCooldown(spec, Math.ceil(ms / 1000), "throttled to protect the provider limit");
          trail.push(`${spec.label} (busy)`); continue;
        }
        const key = spec.provider === "openrouter" ? process.env.OPENROUTER_API_KEY : process.env.GROQ_API_KEY;
        if (!key) throw new Error(`No ${spec.provider.toUpperCase()}_API_KEY configured`);
        const base = spec.provider === "openrouter" ? "https://openrouter.ai/api/v1" : "https://api.groq.com/openai/v1";
        const extra = spec.provider === "openrouter" ? { "HTTP-Referer": "https://lenory.app", "X-Title": "LENORY AI" } : undefined;
        const out = await callOpenAICompatibleTools(base, key, spec, messages, tools, extra);
        return { ...out, modelUsed: spec.label };
      } catch (e: any) {
        trail.push(`${spec.label} (failed: ${String(e?.message || "").slice(0, 80)})`);
        console.warn(`[tools] model failed, trying next — ${spec.label}:`, e?.message);
      }
    }
  }
  console.error(`🔥 No provider could run the tool agent. Tried: ${trail.join(" → ")}`);
  throw new Error("All AI providers are currently unavailable");
}
