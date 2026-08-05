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
  const seconds = retryAfterSeconds ?? (isHardQuota ? 6 * 60 * 60 : 60);
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
