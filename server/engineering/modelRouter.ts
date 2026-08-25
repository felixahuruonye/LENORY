// server/engineering/modelRouter.ts
// Unified model routing: Groq primary, OpenRouter fallback

import type { ModelRole, InvestigationResult, ReviewResult } from "./types";
import {
  callDeepSeekModel,
  runDeepSeekInvestigation,
  runDeepSeekCoder,
  runDeepSeekReviewer,
  getDeepSeekBalance,
  getDeepSeekModelConfig,
  getUsageHistory,
  getTotalCost,
} from "./deepseekRouter";
import { emitModel, emitLog } from "./streaming";

interface ModelConfig {
  model: string;
  temperature: number;
  maxTokens: number;
}

const DEFAULT_CONFIGS: Record<ModelRole, ModelConfig> = {
  investigator: {
    model: process.env.ENGINEERING_INVESTIGATOR_MODEL || "anthropic/claude-sonnet-4",
    temperature: 0.2,
    maxTokens: 4000,
  },
  coder: {
    model: process.env.ENGINEERING_CODER_MODEL || "deepseek/deepseek-chat-v3-0324",
    temperature: 0.1,
    maxTokens: 8000,
  },
  reviewer_1: {
    model: process.env.ENGINEERING_REVIEWER_1_MODEL || "anthropic/claude-sonnet-4",
    temperature: 0.2,
    maxTokens: 4000,
  },
  reviewer_2: {
    model: process.env.ENGINEERING_REVIEWER_2_MODEL || "google/gemini-2.5-flash",
    temperature: 0.2,
    maxTokens: 4000,
  },
};

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || "";

// ─── Unified call ──────────────────────────────────────────────────────────

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export async function callModel(
  role: ModelRole,
  messages: ChatMessage[],
  options: { temperature?: number; maxTokens?: number } = {},
  taskId?: string
): Promise<string> {
  // Try Groq first (exclusive if key is set)
  if (process.env.GROQ_API_KEY) {
    try {
      const result = await callGroqModel(role, messages, options, (model) => {
        if (taskId) emitModel(taskId, role, model);
        console.log(`[ENGINEERING] ${role} using Groq model: ${model}`);
      });
      return result;
    } catch (groqErr: any) {
      console.error(`[ENGINEERING] Groq failed for ${role}:`, groqErr.message);
      if (taskId) {
        emitError(taskId, `Groq error: ${groqErr.message}. Check GROQ_API_KEY is valid.`);
        emitLog(taskId, `Groq failed for ${role}: ${groqErr.message}`, "error");
      }
      throw new Error(`Groq failed for ${role}: ${groqErr.message}. GROQ_API_KEY may be invalid or models are unavailable.`);
    }
  }

  // Only use OpenRouter if GROQ_API_KEY is NOT set
  if (!OPENROUTER_API_KEY) {
    throw new Error("No AI provider available. Set GROQ_API_KEY or OPENROUTER_API_KEY.");
  }

  const config = DEFAULT_CONFIGS[role];
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
      "HTTP-Referer": "https://lenory.com",
      "X-Title": "LENORY Engineering Agent",
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
    throw new Error(`OpenRouter HTTP ${response.status}: ${errText.slice(0, 200)}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("Empty response from OpenRouter");

  if (taskId) emitModel(taskId, role, config.model);
  console.log(`[ENGINEERING] ${role} using OpenRouter model: ${config.model}`);
  return content;
}

// ─── Investigator ──────────────────────────────────────────────────────────

export async function runInvestigation(
  request: string,
  repoContext: string,
  relatedFiles: string[],
  recentErrors: string[],
  taskId?: string
): Promise<InvestigationResult> {
  // Use DeepSeek exclusively
  if (process.env.DEEPSEEK_API_KEY) {
    try {
      return await runDeepSeekInvestigation(request, repoContext, relatedFiles, recentErrors, (model) => {
        if (taskId) emitModel(taskId, "investigator", model);
      });
    } catch (e: any) {
      console.error("DeepSeek investigation failed:", e.message);
      if (taskId) emitError(taskId, `DeepSeek investigation failed: ${e.message}`);
      throw new Error(`DeepSeek investigation failed: ${e.message}`);
    }
  }

  // OpenRouter (only if no DeepSeek key)
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

  const response = await callModel("investigator", [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ], {}, taskId);

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

export async function runCoder(
  investigation: InvestigationResult,
  filesToModify: { path: string; content: string }[],
  taskId: string
): Promise<string> {
  // Use DeepSeek exclusively
  if (process.env.DEEPSEEK_API_KEY) {
    try {
      return await runDeepSeekCoder(investigation, filesToModify, taskId, (model) => {
        emitModel(taskId, "coder", model);
      });
    } catch (e: any) {
      console.error("DeepSeek coder failed:", e.message);
      emitError(taskId, `DeepSeek coder failed: ${e.message}`);
      throw new Error(`DeepSeek coder failed: ${e.message}`);
    }
  }

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

  return await callModel("coder", [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ], { maxTokens: 16000 }, taskId);
}

// ─── Reviewer ─────────────────────────────────────────────────────────────

export async function runReviewer(
  reviewerRole: "reviewer_1" | "reviewer_2",
  originalRequest: string,
  investigation: InvestigationResult,
  diff: string,
  testResults: string,
  buildResult: string,
  taskId?: string
): Promise<ReviewResult> {
  // Use DeepSeek exclusively
  if (process.env.DEEPSEEK_API_KEY) {
    try {
      return await runDeepSeekReviewer(reviewerRole, originalRequest, investigation, diff, testResults, buildResult, (model) => {
        if (taskId) emitModel(taskId, reviewerRole, model);
      });
    } catch (e: any) {
      console.error(`DeepSeek ${reviewerRole} failed:`, e.message);
      if (taskId) emitError(taskId, `DeepSeek ${reviewerRole} failed: ${e.message}`);
      throw new Error(`DeepSeek ${reviewerRole} failed: ${e.message}`);
    }
  }

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

  const response = await callModel(reviewerRole, [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ], {}, taskId);

  try {
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    const jsonStr = jsonMatch ? jsonMatch[0] : response;
    const parsed = JSON.parse(jsonStr);
    return {
      reviewerModel: parsed.reviewerModel || "openrouter-model",
      verdict: parsed.verdict,
      feedback: parsed.feedback,
      securityConcerns: parsed.securityConcerns || [],
      regressionRisks: parsed.regressionRisks || [],
    };
  } catch (e) {
    return {
      reviewerModel: "openrouter-model",
      verdict: "request_changes",
      feedback: `Parse error: ${response.slice(0, 500)}`,
      securityConcerns: ["Could not parse review response"],
      regressionRisks: [],
    };
  }
}

// ─── Exports ─────────────────────────────────────────────────────────────

export { getDeepSeekBalance, getDeepSeekModelConfig, getUsageHistory, getTotalCost };
