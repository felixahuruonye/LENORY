// server/engineering/deepseekRouter.ts
// DeepSeek API client for engineering agent

import type { ModelRole, InvestigationResult, ReviewResult } from "./types";

interface DeepSeekModelConfig {
  model: string;
  temperature: number;
  maxTokens: number;
  label: string;
}

// DeepSeek model pools per role
const DEEPSEEK_MODEL_POOLS: Record<ModelRole, DeepSeekModelConfig[]> = {
  investigator: [
    { model: "deepseek-reasoner", temperature: 0.2, maxTokens: 8000, label: "DeepSeek R1 (Reasoner)" },
    { model: "deepseek-chat", temperature: 0.2, maxTokens: 8000, label: "DeepSeek V3 (Chat)" },
  ],
  coder: [
    { model: "deepseek-reasoner", temperature: 0.1, maxTokens: 16000, label: "DeepSeek R1 (Reasoner)" },
    { model: "deepseek-chat", temperature: 0.1, maxTokens: 16000, label: "DeepSeek V3 (Chat)" },
  ],
  reviewer_1: [
    { model: "deepseek-chat", temperature: 0.2, maxTokens: 8000, label: "DeepSeek V3 (Chat)" },
    { model: "deepseek-reasoner", temperature: 0.2, maxTokens: 8000, label: "DeepSeek R1 (Reasoner)" },
  ],
  reviewer_2: [
    { model: "deepseek-chat", temperature: 0.2, maxTokens: 8000, label: "DeepSeek V3 (Chat)" },
    { model: "deepseek-reasoner", temperature: 0.2, maxTokens: 8000, label: "DeepSeek R1 (Reasoner)" },
  ],
};

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || "";
const DEEPSEEK_URL = "https://api.deepseek.com/v1/chat/completions";
const DEEPSEEK_BALANCE_URL = "https://api.deepseek.com/user/balance";

if (!DEEPSEEK_API_KEY) {
  console.warn("[ENGINEERING] DEEPSEEK_API_KEY not set. Add it to Render environment variables.");
}

// ─── Usage tracking ────────────────────────────────────────────────────────

interface UsageRecord {
  model: string;
  role: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cost: number; // estimated USD
  timestamp: string;
}

const usageHistory: UsageRecord[] = [];

export function getUsageHistory(): UsageRecord[] {
  return usageHistory;
}

export function getTotalCost(): number {
  return usageHistory.reduce((sum, r) => sum + r.cost, 0);
}

// DeepSeek pricing per 1M tokens (as of 2026)
const PRICING: Record<string, { input: number; output: number }> = {
  "deepseek-chat": { input: 0.27, output: 1.10 },
  "deepseek-reasoner": { input: 0.55, output: 2.19 },
};

function estimateCost(model: string, promptTokens: number, completionTokens: number): number {
  const p = PRICING[model] || { input: 0.5, output: 2.0 };
  return (promptTokens / 1_000_000) * p.input + (completionTokens / 1_000_000) * p.output;
}

// ─── Balance check ───────────────────────────────────────────────────────

export interface DeepSeekBalance {
  isAvailable: boolean;
  balance: number;
  currency: string;
  totalBalance: number;
  grantedBalance: number;
  toppedUpBalance: number;
}

export async function getDeepSeekBalance(): Promise<DeepSeekBalance> {
  if (!DEEPSEEK_API_KEY) {
    return {
      isAvailable: false,
      balance: 0,
      currency: "CNY",
      totalBalance: 0,
      grantedBalance: 0,
      toppedUpBalance: 0,
    };
  }

  try {
    const response = await fetch(DEEPSEEK_BALANCE_URL, {
      headers: { "Authorization": `Bearer ${DEEPSEEK_API_KEY}` },
    });

    if (!response.ok) {
      return {
        isAvailable: false,
        balance: 0,
        currency: "CNY",
        totalBalance: 0,
        grantedBalance: 0,
        toppedUpBalance: 0,
      };
    }

    const data = await response.json();
    // DeepSeek returns balance info in CNY
    const bal = data.balance_infos?.[0] || {};
    const total = parseFloat(bal.total_balance || "0");
    return {
      isAvailable: total > 0,
      balance: total,
      currency: bal.currency || "CNY",
      totalBalance: total,
      grantedBalance: parseFloat(bal.granted_balance || "0"),
      toppedUpBalance: parseFloat(bal.topped_up_balance || "0"),
    };
  } catch (e) {
    return {
      isAvailable: false,
      balance: 0,
      currency: "CNY",
      totalBalance: 0,
      grantedBalance: 0,
      toppedUpBalance: 0,
    };
  }
}

// ─── Core API call ───────────────────────────────────────────────────────

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export async function callDeepSeekModel(
  role: ModelRole,
  messages: ChatMessage[],
  options: { temperature?: number; maxTokens?: number } = {},
  onModelUsed?: (model: string) => void
): Promise<string> {
  if (!DEEPSEEK_API_KEY) {
    throw new Error("DEEPSEEK_API_KEY not configured");
  }

  const pool = DEEPSEEK_MODEL_POOLS[role];
  const maxRetries = pool.length;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const config = pool[attempt];

    try {
      const response = await fetch(DEEPSEEK_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${DEEPSEEK_API_KEY}`,
        },
        body: JSON.stringify({
          model: config.model,
          messages,
          temperature: options.temperature ?? config.temperature,
          max_tokens: options.maxTokens ?? config.maxTokens,
        }),
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`DeepSeek HTTP ${response.status}: ${errText.slice(0, 200)}`);
      }

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content;
      if (!content) {
        throw new Error("Empty response from DeepSeek");
      }

      // Track usage
      const usage = data.usage || {};
      const promptTokens = usage.prompt_tokens || 0;
      const completionTokens = usage.completion_tokens || 0;
      const cost = estimateCost(config.model, promptTokens, completionTokens);
      usageHistory.push({
        model: config.model,
        role,
        promptTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens,
        cost,
        timestamp: new Date().toISOString(),
      });

      if (onModelUsed) onModelUsed(config.model);
      return content;
    } catch (err: any) {
      lastError = err;
      console.error(`DeepSeek attempt ${attempt + 1}/${maxRetries} failed for ${config.model}:`, err.message);
      if (attempt < maxRetries - 1) {
        await new Promise(r => setTimeout(r, 1000));
      }
    }
  }

  throw lastError || new Error(`All DeepSeek models exhausted for ${role}`);
}

// ─── Investigator ──────────────────────────────────────────────────────────

export async function runDeepSeekInvestigation(
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

  const response = await callDeepSeekModel("investigator", [
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

export async function runDeepSeekCoder(
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

  return await callDeepSeekModel("coder", [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ], { maxTokens: 16000 }, onModelUsed);
}

// ─── Reviewer ─────────────────────────────────────────────────────────────

export async function runDeepSeekReviewer(
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

  const response = await callDeepSeekModel(reviewerRole, [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ], {}, onModelUsed);

  try {
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    const jsonStr = jsonMatch ? jsonMatch[0] : response;
    const parsed = JSON.parse(jsonStr);
    return {
      reviewerModel: parsed.reviewerModel || "deepseek-model",
      verdict: parsed.verdict,
      feedback: parsed.feedback,
      securityConcerns: parsed.securityConcerns || [],
      regressionRisks: parsed.regressionRisks || [],
    };
  } catch (e) {
    return {
      reviewerModel: "deepseek-model",
      verdict: "request_changes",
      feedback: `Parse error: ${response.slice(0, 500)}`,
      securityConcerns: ["Could not parse review response"],
      regressionRisks: [],
    };
  }
}

// ─── Config export ───────────────────────────────────────────────────────

export function getDeepSeekModelConfig(): Record<ModelRole, { primary: string; pool: string[]; label: string }> {
  return {
    investigator: {
      primary: DEEPSEEK_MODEL_POOLS.investigator[0].model,
      pool: DEEPSEEK_MODEL_POOLS.investigator.map(m => m.model),
      label: "Investigator",
    },
    coder: {
      primary: DEEPSEEK_MODEL_POOLS.coder[0].model,
      pool: DEEPSEEK_MODEL_POOLS.coder.map(m => m.model),
      label: "Coder",
    },
    reviewer_1: {
      primary: DEEPSEEK_MODEL_POOLS.reviewer_1[0].model,
      pool: DEEPSEEK_MODEL_POOLS.reviewer_1.map(m => m.model),
      label: "Reviewer 1",
    },
    reviewer_2: {
      primary: DEEPSEEK_MODEL_POOLS.reviewer_2[0].model,
      pool: DEEPSEEK_MODEL_POOLS.reviewer_2.map(m => m.model),
      label: "Reviewer 2",
    },
  };
}
