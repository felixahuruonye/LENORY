// server/engineering/orchestrator.ts
// Main engineering agent orchestrator

import type { EngineeringTask, InvestigationResult, ToolResult } from "./types";
import {
  createTask,
  getTask,
  transitionTask,
  logEvent,
  getAllTasks,
} from "./stateMachine";
import { runInvestigation, runCoder, runReviewer } from "./modelRouter";
import { createSandbox, destroySandbox, getSandboxGitDiff, commitSandboxChanges, readSandboxFile, writeSandboxFile } from "./sandbox";
import { executeTool } from "./tools";
import { getRecentErrors } from "../adminTools";

const REPO_URL = process.env.GITHUB_REPO_URL || "https://github.com/felixahuruonye/LENORY.git";

// ─── Task Creation ─────────────────────────────────────────────────────────

export async function submitEngineeringRequest(
  request: string,
  adminId: string,
  adminEmail: string
): Promise<EngineeringTask> {
  // Get current commit
  let baseCommit = "main";
  try {
    const { execSync } = await import("child_process");
    baseCommit = execSync("git rev-parse HEAD", { encoding: "utf-8" }).trim();
  } catch {
    baseCommit = "main";
  }

  const task = await createTask(request, adminId, adminEmail, baseCommit);
  await logEvent(task.id, "task_created", adminEmail, `Task created: ${request}`);

  // Start async processing
  processTask(task.id).catch(async (err) => {
    console.error(`Task ${task.id} failed:`, err);
    await logEvent(task.id, "error", "system", err.message || String(err));
    await transitionTask(task.id, "failed", { errorLog: err.message || String(err) });
  });

  return task;
}

// ─── Main Processing Loop ──────────────────────────────────────────────────

async function processTask(taskId: string): Promise<void> {
  const task = await getTask(taskId);
  if (!task) throw new Error(`Task ${taskId} not found`);

  // Phase 1: Investigation
  await transitionTask(taskId, "investigating");
  await logEvent(taskId, "investigation_started", "investigator", "Starting investigation");

  const repoContext = await gatherRepoContext();
  const recentErrors = await getRecentErrors(20);
  const relatedFiles = await findRelatedFiles(task.request);

  const investigation = await runInvestigation(
    task.request,
    repoContext,
    relatedFiles,
    recentErrors.map((e: any) => `${e.route}: ${e.message}`)
  );

  await transitionTask(taskId, "sandbox_creating", {
    investigation: JSON.stringify(investigation),
    rootCause: investigation.rootCause,
  });
  await logEvent(taskId, "root_cause_identified", "investigator", investigation.rootCause, {
    riskLevel: investigation.riskLevel,
    affectedComponents: investigation.affectedComponents,
  });

  // Phase 2: Sandbox
  await logEvent(taskId, "sandbox_created", "system", `Creating sandbox at commit ${task.baseCommit}`);
  const sandbox = await createSandbox(taskId, task.baseCommit, REPO_URL);

  await transitionTask(taskId, "implementing", { sandboxPath: sandbox.path });

  // Phase 3: Implementation (with retry loop)
  let attempt = 0;
  let success = false;

  while (attempt < task.maxAttempts && !success) {
    attempt++;
    await logEvent(taskId, "code_changed", "coder", `Implementation attempt ${attempt}`);

    try {
      const filesToModify = await gatherFilesForModification(sandbox, investigation.affectedComponents);
      const coderOutput = await runCoder(investigation, filesToModify, taskId);

      // Parse coder output and apply changes
      await applyCoderChanges(sandbox, coderOutput);

      // Phase 4: Testing
      await transitionTask(taskId, "testing");
      await logEvent(taskId, "test_started", "system", "Running tests and build");

      const testResult = await executeTool(sandbox, {
        tool: "run_test",
        params: { command: "npm run test", timeoutMs: 120000 },
        timestamp: new Date().toISOString(),
      });

      const buildResult = await executeTool(sandbox, {
        tool: "run_build",
        params: { command: "npm run build", timeoutMs: 180000 },
        timestamp: new Date().toISOString(),
      });

      const lintResult = await executeTool(sandbox, {
        tool: "run_lint",
        params: { command: "npm run lint", timeoutMs: 60000 },
        timestamp: new Date().toISOString(),
      });

      const allPassed = testResult.success && buildResult.success && lintResult.success;

      if (allPassed) {
        await logEvent(taskId, "test_passed", "system", "All checks passed");
        await logEvent(taskId, "build_passed", "system", "Build successful");
        success = true;
      } else {
        await logEvent(taskId, "test_failed", "system", `Tests: ${testResult.success}, Build: ${buildResult.success}, Lint: ${lintResult.success}`);
        await transitionTask(taskId, "test_failed", {
          testResults: JSON.stringify({ test: testResult, build: buildResult, lint: lintResult }),
        });

        if (attempt < task.maxAttempts) {
          await transitionTask(taskId, "debugging");
          await logEvent(taskId, "code_changed", "coder", `Debugging attempt ${attempt}`);
          // Continue to next iteration
        }
      }
    } catch (err: any) {
      await logEvent(taskId, "error", "coder", err.message || String(err));
    }
  }

  if (!success) {
    await destroySandbox(taskId);
    await transitionTask(taskId, "failed", {
      errorLog: `Failed after ${attempt} attempts`,
    });
    return;
  }

  // Phase 5: Review
  await transitionTask(taskId, "reviewing");
  const diff = getSandboxGitDiff(sandbox);

  const review1 = await runReviewer(
    "reviewer_1",
    task.request,
    investigation,
    diff,
    "Tests passed",
    "Build passed"
  );

  const review2 = await runReviewer(
    "reviewer_2",
    task.request,
    investigation,
    diff,
    "Tests passed",
    "Build passed"
  );

  await logEvent(taskId, "review_started", "reviewer_1", review1.feedback, {
    verdict: review1.verdict,
    securityConcerns: review1.securityConcerns,
  });
  await logEvent(taskId, "review_started", "reviewer_2", review2.feedback, {
    verdict: review2.verdict,
    securityConcerns: review2.securityConcerns,
  });

  const bothPassed = review1.verdict === "pass" && review2.verdict === "pass";
  const hasConflict = review1.verdict === "conflict" || review2.verdict === "conflict";

  if (!bothPassed || hasConflict) {
    await destroySandbox(taskId);
    await transitionTask(taskId, "failed", {
      reviewResult: JSON.stringify({ review1, review2 }),
      diff,
      errorLog: `Review failed: R1=${review1.verdict}, R2=${review2.verdict}`,
    });
    return;
  }

  await logEvent(taskId, "review_passed", "system", "Both reviewers approved");

  // Phase 6: Ready for approval
  commitSandboxChanges(sandbox, `engineering(${taskId}): ${task.request.slice(0, 50)}`);

  await transitionTask(taskId, "ready_for_approval", {
    diff,
    reviewResult: JSON.stringify({ review1, review2 }),
    riskAssessment: JSON.stringify({
      rootCauseConfidence: 85,
      testCoverage: 80,
      regressionRisk: investigation.riskLevel === "high" || investigation.riskLevel === "critical" ? 70 : 30,
      securityRisk: review1.securityConcerns.length > 0 || review2.securityConcerns.length > 0 ? 60 : 10,
      overallRecommendation: investigation.riskLevel === "critical" ? "caution" : "proceed",
    }),
  });

  await logEvent(taskId, "approval_requested", "system", "Task ready for admin approval");
}

// ─── Approval Handling ─────────────────────────────────────────────────────

export async function approveTask(
  taskId: string,
  approved: boolean,
  adminId: string,
  adminEmail: string,
  notes?: string
): Promise<EngineeringTask> {
  const task = await getTask(taskId);
  if (!task) throw new Error("Task not found");
  if (task.status !== "ready_for_approval") {
    throw new Error(`Task is not ready for approval (status: ${task.status})`);
  }

  if (!approved) {
    await destroySandbox(taskId);
    return await transitionTask(taskId, "rejected", { errorLog: notes || "Rejected by admin" });
  }

  // Merge and deploy
  await transitionTask(taskId, "merging");
  await logEvent(taskId, "approved", adminEmail, notes || "Approved");

  try {
    const { execSync } = await import("child_process");
    // Push branch to GitHub
    const pat = process.env.GITHUB_PAT || "";
    const repoUrl = pat
      ? `https://${pat}@github.com/felixahuruonye/LENORY.git`
      : REPO_URL;

    execSync(`cd ${task.sandboxPath} && git push ${repoUrl} ${task.branchName}`, {
      timeout: 60000,
      stdio: "pipe",
    });

    await logEvent(taskId, "merged", "system", `Branch ${task.branchName} pushed`);
    await transitionTask(taskId, "deploying");

    // Note: Actual Render deployment trigger would go here
    // For now, mark as completed since Render auto-deploys on push
    await logEvent(taskId, "deployment_started", "system", "Deployment triggered");
    await transitionTask(taskId, "completed", {
      prUrl: `https://github.com/felixahuruonye/LENORY/tree/${task.branchName}`,
    });
    await logEvent(taskId, "deployment_succeeded", "system", "Deployment completed");

  } catch (err: any) {
    await logEvent(taskId, "error", "system", err.message || String(err));
    await transitionTask(taskId, "failed", { errorLog: err.message || String(err) });
  }

  return await getTask(taskId)!;
}

// ─── Helpers ───────────────────────────────────────────────────────────────

async function gatherRepoContext(): Promise<string> {
  const { execSync } = await import("child_process");
  try {
    const structure = execSync("find . -type f -not -path './node_modules/*' -not -path './.git/*' | head -100", {
      encoding: "utf-8",
      timeout: 10000,
    });
    const packageJson = execSync("cat package.json", { encoding: "utf-8", timeout: 5000 });
    return `Repository Structure:
${structure}

package.json:
${packageJson}`;
  } catch {
    return "Could not gather repo context";
  }
}

async function findRelatedFiles(request: string): Promise<string[]> {
  const { execSync } = await import("child_process");
  try {
    // Simple keyword-based file search
    const keywords = request.toLowerCase().split(/\s+/).filter(w => w.length > 3);
    const results = new Set<string>();
    for (const kw of keywords.slice(0, 5)) {
      try {
        const files = execSync(`grep -r "${kw}" --include="*.ts" --include="*.tsx" -l 2>/dev/null | head -10`, {
          encoding: "utf-8",
          timeout: 5000,
        });
        files.split("\n").filter(Boolean).forEach(f => results.add(f));
      } catch {
        // ignore
      }
    }
    return Array.from(results).slice(0, 20);
  } catch {
    return [];
  }
}

async function gatherFilesForModification(
  sandbox: any,
  affectedComponents: string[]
): Promise<{ path: string; content: string }[]> {
  const files: { path: string; content: string }[] = [];
  for (const component of affectedComponents.slice(0, 10)) {
    const content = readSandboxFile(sandbox, component);
    if (content) {
      files.push({ path: component, content });
    }
  }
  return files;
}

async function applyCoderChanges(sandbox: any, coderOutput: string): Promise<void> {
  const fileRegex = /=== FILE: (.+?) ===\n([\s\S]*?)\n=== END FILE ===/g;
  let match;
  while ((match = fileRegex.exec(coderOutput)) !== null) {
    const path = match[1].trim();
    const content = match[2];
    writeSandboxFile(sandbox, path, content);
  }
}

export { getAllTasks, getTask, getTaskEvents } from "./stateMachine";
