// server/engineering/groqRouter.ts
// Groq-based model routing with automatic fallback and cooldown tracking

import type { ModelRole, InvestigationResult, ReviewResult } from "./types";

interface GroqModelConfig {
  model: string;
  temperature: number;
  maxTokens: number;
  label: string;
}

// Groq model pools per role — ordered by preference
const GROQ_MODEL_POOLS: Record<ModelRole, GroqModelConfig[]> = {
  investigator: [
    { model: "llama-3.3-70b-versatile", temperature: 0.2, maxTokens: 8000, label: "Llama 3.3 70B" },
    { model: "llama-3.1-70b-versatile", temperature: 0.2, maxTokens: 8000, label: "Llama 3.1 70B" },
    { model: "deepseek-r1-distill-llama-70b", temperature: 0.2, maxTokens: 8000, label: "DeepSeek R1 70B" },
  ],
  coder: [
    { model: "llama-3.3-70b-versatile", temperature: 0.1, maxTokens: 16000, label: "Llama 3.3 70B" },
    { model: "llama-3.1-70b-versatile", temperature: 0.1, maxTokens: 16000, label: "Llama 3.1 70B" },
    { model: "deepseek-r1-distill-llama-70b", temperature: 0.1, maxTokens: 16000, label: "DeepSeek R1 70B" },
  ],
  reviewer_1: [
    { model: "llama-3.1-70b-versatile", temperature: 0.2, maxTokens: 8000, label: "Llama 3.1 70B" },
    { model: "gemma2-9b-it", temperature: 0.2, maxTokens: 8000, label: "Gemma 2 9B" },
    { model: "llama-3.3-70b-versatile", temperature: 0.2, maxTokens: 8000, label: "Llama 3.3 70B" },
  ],
  reviewer_2: [
    { model: "gemma2-9b-it", temperature: 0.2, maxTokens: 8000, label: "Gemma 2 9B" },
    { model: "llama-3.1-8b-instant", temperature: 0.2, maxTokens: 8000, label: "Llama 3.1 8B" },
    { model: "llama-3.1-70b-versatile", temperature: 0.2, maxTokens: 8000, label: "Llama 3.1 70B" },
  ],
};

const GROQ_API_KEY = process.env.GROQ_API_KEY || "";

if (!GROQ_API_KEY) {
  console.warn("[ENGINEERING] GROQ_API_KEY not set. Add it to Render environment variables.");
}
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

// ─── Cooldown tracking ─────────────────────────────────────────────────────

interface CooldownEntry {
  model: string;
  until: number; // timestamp ms
  reason: string;
}

const cooldowns = new Map<string, CooldownEntry>();

export function getCooldownStatus(): CooldownEntry[] {
  const now = Date.now();
  // Clean expired entries
  for (const [key, entry] of cooldowns) {
    if (entry.until < now) {
      cooldowns.delete(key);
    }
  }
  return Array.from(cooldowns.values()).sort((a, b) => a.until - b.until);
}

export function isModelOnCooldown(model: string): boolean {
  const entry = cooldowns.get(model);
  if (!entry) return false;
  if (entry.until < Date.now()) {
    cooldowns.delete(model);
    return false;
  }
  return true;
}

function putModelOnCooldown(model: string, reason: string, durationMs = 60000): void {
  cooldowns.set(model, {
    model,
    until: Date.now() + durationMs,
    reason,
  });
  console.log(`[GROQ COOLDOWN] ${model} cooling down for ${durationMs / 1000}s: ${reason}`);
}

// ─── Core API call ─────────────────────────────────────────────────────────

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export async function callGroqModel(
  role: ModelRole,
  messages: ChatMessage[],
  options: { temperature?: number; maxTokens?: number } = {},
  onModelUsed?: (model: string) => void
): Promise<string> {
  if (!GROQ_API_KEY) {
    throw new Error("GROQ_API_KEY not configured");
  }

  const pool = GROQ_MODEL_POOLS[role];
  const maxRetries = pool.length;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const config = pool[attempt];

    if (isModelOnCooldown(config.model)) {
      console.log(`[GROQ SKIP] ${config.model} is on cooldown, trying next...`);
      continue;
    }

    try {
      const response = await fetch(GROQ_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${GROQ_API_KEY}`,
        },
        body: JSON.stringify({
          model: config.model,
          messages,
          temperature: options.temperature ?? config.temperature,
          max_tokens: options.maxTokens ?? config.maxTokens,
        }),
      });

      if (response.status === 429) {
        const errText = await response.text();
        putModelOnCooldown(config.model, `Rate limited: ${errText.slice(0, 100)}`, 60000);
        lastError = new Error(`Groq 429 on ${config.model}: ${errText.slice(0, 200)}`);
        continue; // try next model
      }

      if (!response.ok) {
        const errText = await response.text();
        // Some errors are temporary (503, 502) — cooldown briefly
        if (response.status === 503 || response.status === 502 || response.status === 504) {
          putModelOnCooldown(config.model, `Service error ${response.status}`, 30000);
        }
        throw new Error(`Groq HTTP ${response.status}: ${errText.slice(0, 200)}`);
      }

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content;
      if (!content) {
        throw new Error("Empty response from Groq");
      }

      if (onModelUsed) onModelUsed(config.model);
      return content;
    } catch (err: any) {
      lastError = err;
      console.error(`Groq attempt ${attempt + 1}/${maxRetries} failed for ${config.model}:`, err.message);
      if (attempt < maxRetries - 1) {
        await new Promise(r => setTimeout(r, 1000));
      }
    }
  }

  const errMsg = lastError ? lastError.message : `All Groq models exhausted for ${role}`;
  throw new Error(`Groq failed: ${errMsg}. GROQ_API_KEY may be missing, invalid, or all models are rate-limited.`);
}

// ─── Investigator ──────────────────────────────────────────────────────────

export async function runGroqInvestigation(
  request: string,
  repoContext: string,
  relatedFiles: string[],
  recentErrors: string[],
  onModelUsed?: (model: string) => void
): Promise<InvestigationResult> {
  const systemPrompt = `You are the LENORY Engineering Investigator. Your job is to deeply investigate engineering requests BEFORE any code is written.

RULES:
1. Do NOT write code. Only investigate and analyze.
2. Read the provided repository context carefully.
3. Search for related files, errors, and patterns.
4. Determine the ACTUAL root cause, not just symptoms.
5. Consider side effects and systemic issues.
6. Be thorough — do not stop at the first plausible explanation.

OUTPUT FORMAT (JSON):
{
  "problem": "Clear problem statement",
  "evidence": ["fact 1", "fact 2", ...],
  "rootCause": "The actual root cause",
  "affectedComponents": ["file1", "route2", "component3"],
  "potentialSideEffects": ["side effect 1", ...],
  "proposedSolution": "High-level solution approach",
  "testingStrategy": "How to test the fix",
  "riskLevel": "low|medium|high|critical"
}`;

  const userPrompt = `ENGINEERING REQUEST: ${request}

REPOSITORY CONTEXT:
${repoContext}

RELATED FILES:
${relatedFiles.join("\n")}

RECENT ERRORS:
${recentErrors.join("\n") || "None"}

Investigate thoroughly and return ONLY the JSON response.`;

  const response = await callGroqModel("investigator", [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ], {}, onModelUsed);

  try {
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    const jsonStr = jsonMatch ? jsonMatch[0] : response;
    return JSON.parse(jsonStr) as InvestigationResult;
  } catch (e) {
    console.error("Failed to parse investigation result:", e);
    return {
      problem: request,
      evidence: ["Parse error — raw response used"],
      rootCause: "Unknown — investigation response could not be parsed",
      affectedComponents: [],
      potentialSideEffects: [],
      proposedSolution: response.slice(0, 500),
      testingStrategy: "Manual verification required",
      riskLevel: "high",
    };
  }
}

// ─── Coder ─────────────────────────────────────────────────────────────────

export async function runGroqCoder(
  investigation: InvestigationResult,
  filesToModify: { path: string; content: string }[],
  taskId: string,
  onModelUsed?: (model: string) => void
): Promise<string> {
  const systemPrompt = `You are the LENORY Engineering Coder. You implement fixes based on investigation results.

RULES:
1. Work ONLY inside the sandbox. Never modify production directly.
2. Follow the existing code style and patterns.
3. Write clean, maintainable code.
4. Add tests where appropriate.
5. Do NOT break existing functionality.
6. Return the COMPLETE file contents for any modified files.
7. Use TypeScript properly with correct types.
8. Do NOT use "any" unless absolutely necessary.

OUTPUT FORMAT:
For each file changed, output:

=== FILE: path/to/file.ts ===
<complete file content>

=== END FILE ===

Then provide a brief summary of changes.`;

  const filesContext = filesToModify.map(f =>
    `=== FILE: ${f.path} ===\n${f.content}\n=== END FILE ===`
  ).join("\n\n");

  const userPrompt = `TASK ID: ${taskId}

INVESTIGATION RESULT:
Problem: ${investigation.problem}
Root Cause: ${investigation.rootCause}
Proposed Solution: ${investigation.proposedSolution}
Risk Level: ${investigation.riskLevel}

FILES TO MODIFY:
${filesContext}

Implement the fix. Return complete file contents for all modified files.`;

  return await callGroqModel("coder", [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ], { maxTokens: 16000 }, onModelUsed);
}

// ─── Reviewer ─────────────────────────────────────────────────────────────

export async function runGroqReviewer(
  reviewerRole: "reviewer_1" | "reviewer_2",
  originalRequest: string,
  investigation: InvestigationResult,
  diff: string,
  testResults: string,
  buildResult: string,
  onModelUsed?: (model: string) => void
): Promise<ReviewResult> {
  const systemPrompt = `You are an independent code reviewer for the LENORY Engineering Agent. You do NOT trust the coder's explanation — you verify independently.

RULES:
1. Examine the diff carefully.
2. Check for security issues.
3. Check for regression risks.
4. Verify the fix actually solves the problem.
5. Look for edge cases.
6. Be critical — your job is to find problems.

OUTPUT FORMAT (JSON):
{
  "verdict": "pass|request_changes|conflict",
  "feedback": "Detailed review",
  "securityConcerns": ["concern 1", ...],
  "regressionRisks": ["risk 1", ...]
}`;

  const userPrompt = `ORIGINAL REQUEST: ${originalRequest}

INVESTIGATION:
Problem: ${investigation.problem}
Root Cause: ${investigation.rootCause}
Proposed Solution: ${investigation.proposedSolution}

DIFF:
${diff}

TEST RESULTS:
${testResults}

BUILD RESULT:
${buildResult}

Review independently and return ONLY the JSON response.`;

  const response = await callGroqModel(reviewerRole, [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ], {}, onModelUsed);

  try {
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    const jsonStr = jsonMatch ? jsonMatch[0] : response;
    const parsed = JSON.parse(jsonStr);
    return {
      reviewerModel: parsed.reviewerModel || "groq-model",
      verdict: parsed.verdict,
      feedback: parsed.feedback,
      securityConcerns: parsed.securityConcerns || [],
      regressionRisks: parsed.regressionRisks || [],
    };
  } catch (e) {
    return {
      reviewerModel: "groq-model",
      verdict: "request_changes",
      feedback: `Parse error: ${response.slice(0, 500)}`,
      securityConcerns: ["Could not parse review response"],
      regressionRisks: [],
    };
  }
}

// ─── Config export ───────────────────────────────────────────────────────

export function getGroqModelConfig(): Record<ModelRole, { primary: string; pool: string[]; label: string }> {
  return {
    investigator: {
      primary: GROQ_MODEL_POOLS.investigator[0].model,
      pool: GROQ_MODEL_POOLS.investigator.map(m => m.model),
      label: "Investigator",
    },
    coder: {
      primary: GROQ_MODEL_POOLS.coder[0].model,
      pool: GROQ_MODEL_POOLS.coder.map(m => m.model),
      label: "Coder",
    },
    reviewer_1: {
      primary: GROQ_MODEL_POOLS.reviewer_1[0].model,
      pool: GROQ_MODEL_POOLS.reviewer_1.map(m => m.model),
      label: "Reviewer 1",
    },
    reviewer_2: {
      primary: GROQ_MODEL_POOLS.reviewer_2[0].model,
      pool: GROQ_MODEL_POOLS.reviewer_2.map(m => m.model),
      label: "Reviewer 2",
    },
  };
}
