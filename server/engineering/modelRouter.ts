// server/engineering/modelRouter.ts
// Centralized OpenRouter model routing for engineering agent roles

import type { ModelRole, InvestigationResult, ReviewResult } from "./types";

interface ModelConfig {
  model: string;
  temperature: number;
  maxTokens: number;
}

const DEFAULT_CONFIGS: Record<ModelRole, ModelConfig> = {
  investigator: {
    model: process.env.ENGINEERING_INVESTIGATOR_MODEL || "anthropic/claude-sonnet-4",
    temperature: 0.2,
    maxTokens: 8000,
  },
  coder: {
    model: process.env.ENGINEERING_CODER_MODEL || "deepseek/deepseek-chat-v3-0324",
    temperature: 0.1,
    maxTokens: 16000,
  },
  reviewer_1: {
    model: process.env.ENGINEERING_REVIEWER_1_MODEL || "anthropic/claude-sonnet-4",
    temperature: 0.2,
    maxTokens: 8000,
  },
  reviewer_2: {
    model: process.env.ENGINEERING_REVIEWER_2_MODEL || "google/gemini-2.5-pro-preview-06-05",
    temperature: 0.2,
    maxTokens: 8000,
  },
};

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || "";
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export async function callModel(
  role: ModelRole,
  messages: ChatMessage[],
  options: { temperature?: number; maxTokens?: number } = {}
): Promise<string> {
  const config = DEFAULT_CONFIGS[role];
  const model = config.model;
  const temperature = options.temperature ?? config.temperature;
  const maxTokens = options.maxTokens ?? config.maxTokens;

  if (!OPENROUTER_API_KEY) {
    throw new Error("OPENROUTER_API_KEY not configured");
  }

  const maxRetries = 3;
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(OPENROUTER_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
          "HTTP-Referer": process.env.VITE_APP_URL || "https://lenory-backend.onrender.com",
          "X-Title": "LENORY Engineering Agent",
        },
        body: JSON.stringify({
          model,
          messages,
          temperature,
          max_tokens: maxTokens,
        }),
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`OpenRouter HTTP ${response.status}: ${errText.slice(0, 200)}`);
      }

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content;
      if (!content) {
        throw new Error("Empty response from OpenRouter");
      }
      return content;
    } catch (err: any) {
      lastError = err;
      console.error(`Model call attempt ${attempt}/${maxRetries} failed for ${role}:`, err.message);
      if (attempt < maxRetries) {
        await new Promise(r => setTimeout(r, attempt * 2000));
      }
    }
  }

  throw lastError || new Error(`All ${maxRetries} attempts failed for ${role}`);
}

// ─── Investigator Prompts ──────────────────────────────────────────────────

export async function runInvestigation(
  request: string,
  repoContext: string,
  relatedFiles: string[],
  recentErrors: string[]
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

  const response = await callModel("investigator", [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ]);

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

// ─── Coder Prompts ─────────────────────────────────────────────────────────

export async function runCoder(
  investigation: InvestigationResult,
  filesToModify: { path: string; content: string }[],
  taskId: string
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

  return await callModel("coder", [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ], { maxTokens: 16000 });
}

// ─── Reviewer Prompts ───────────────────────────────────────────────────────

export async function runReviewer(
  reviewerRole: "reviewer_1" | "reviewer_2",
  originalRequest: string,
  investigation: InvestigationResult,
  diff: string,
  testResults: string,
  buildResult: string
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

  const response = await callModel(reviewerRole, [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ]);

  try {
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    const jsonStr = jsonMatch ? jsonMatch[0] : response;
    const parsed = JSON.parse(jsonStr);
    return {
      reviewerModel: DEFAULT_CONFIGS[reviewerRole].model,
      verdict: parsed.verdict,
      feedback: parsed.feedback,
      securityConcerns: parsed.securityConcerns || [],
      regressionRisks: parsed.regressionRisks || [],
    };
  } catch (e) {
    return {
      reviewerModel: DEFAULT_CONFIGS[reviewerRole].model,
      verdict: "request_changes",
      feedback: `Parse error: ${response.slice(0, 500)}`,
      securityConcerns: ["Could not parse review response"],
      regressionRisks: [],
    };
  }
}

export function getModelConfig(): Record<ModelRole, { model: string; label: string }> {
  return {
    investigator: { model: DEFAULT_CONFIGS.investigator.model, label: "Investigator" },
    coder: { model: DEFAULT_CONFIGS.coder.model, label: "Coder" },
    reviewer_1: { model: DEFAULT_CONFIGS.reviewer_1.model, label: "Reviewer 1" },
    reviewer_2: { model: DEFAULT_CONFIGS.reviewer_2.model, label: "Reviewer 2" },
  };
}
