/**
 * LENORY ACTIONS background worker.
 * Start with: ACTIONS_WORKER=1 npx tsx server/actions/worker.ts
 * Or production: ACTIONS_WORKER=1 node dist/actions-worker.js
 *
 * Polls durable action_tasks, runs Playwright jobs, reports progress.
 * Deploy as a separate Render Background Worker (same repo).
 */
import { randomUUID } from "crypto";
import { claimNextTask, updateTaskStatus, appendEvent } from "./taskService";
import { runBrowserTask } from "./browserService";
import { BROWSER_LIMITS } from "./security";

const WORKER_ID = `worker_${process.env.RENDER_INSTANCE_ID || randomUUID().slice(0, 8)}`;
const POLL_MS = Number(process.env.ACTIONS_POLL_MS || 2500);

async function processOne(): Promise<boolean> {
  const task = await claimNextTask(WORKER_ID, Math.ceil(BROWSER_LIMITS.taskTimeoutMs / 1000) + 30);
  if (!task) return false;

  console.log(`[actions-worker] claimed ${task.id} tool=${task.tool} user=${task.userId}`);
  await appendEvent(task.id, task.userId, "worker", `Worker ${WORKER_ID} started`);

  const timer = setTimeout(async () => {
    await updateTaskStatus(task.id, task.userId, "timed_out", {
      error: `Task exceeded ${BROWSER_LIMITS.taskTimeoutMs}ms`,
    });
  }, BROWSER_LIMITS.taskTimeoutMs);

  try {
    if (task.tool.startsWith("browser_") || task.tool === "browser") {
      const result = await runBrowserTask(task);
      if (!result.success) {
        console.warn(`[actions-worker] task ${task.id} failed:`, result.error);
      } else {
        console.log(`[actions-worker] task ${task.id} completed`);
      }
    } else {
      await updateTaskStatus(task.id, task.userId, "failed", {
        error: `Unknown tool type: ${task.tool}`,
      });
    }
  } catch (e: any) {
    await updateTaskStatus(task.id, task.userId, "failed", {
      error: e?.message || String(e),
    });
  } finally {
    clearTimeout(timer);
  }
  return true;
}

async function loop() {
  console.log(`[actions-worker] started id=${WORKER_ID} poll=${POLL_MS}ms`);
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const worked = await processOne();
      if (!worked) await sleep(POLL_MS);
      else await sleep(200);
    } catch (e: any) {
      console.error("[actions-worker] loop error:", e?.message || e);
      await sleep(POLL_MS);
    }
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// Only auto-start when explicitly marked as worker process
if (process.env.ACTIONS_WORKER === "1") {
  loop().catch((e) => {
    console.error("[actions-worker] fatal:", e);
    process.exit(1);
  });
}

export { loop as startActionsWorker, processOne as processOneActionTask };
