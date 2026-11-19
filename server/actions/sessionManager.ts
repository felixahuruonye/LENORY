/**
 * High-level browser session lifecycle for LENORY ACTIONS.
 * Cost controls → runtime create → task attach → live view → close/settle.
 */
import { getRuntimeProviderName } from "./browserRuntime";
import { browserbaseRuntime } from "./browserbaseRuntime";
import {
  reserveBrowserUsage,
  trackSessionOpen,
  trackSessionClose,
  settleBrowserUsage,
  loadCostLimits,
} from "./costControl";
import { attachBrowserSession, updateTaskStatus, appendEvent, getActionTask } from "./taskService";

export async function getActiveRuntime() {
  const name = getRuntimeProviderName();
  if (name === "browserbase") {
    if (!(await browserbaseRuntime.isAvailable())) {
      throw new Error(
        "Browser sessions unavailable: BROWSERBASE_API_KEY is not configured on this server. The app can start, but open-session is disabled until the key is set."
      );
    }
    return browserbaseRuntime;
  }
  throw new Error(
    "Local Playwright runtime is not fully wired in this build. Set BROWSER_RUNTIME=browserbase and BROWSERBASE_API_KEY."
  );
}

export async function openBrowserSessionForTask(input: {
  userId: string;
  taskId: string;
  viewport?: { width: number; height: number };
}): Promise<
  | { ok: true; sessionId: string; provider: string; reservationId: string }
  | { ok: false; reason: string }
> {
  const reserved = await reserveBrowserUsage({
    userId: input.userId,
    taskId: input.taskId,
  });
  if (!reserved.ok) return reserved;

  try {
    const runtime = await getActiveRuntime();
    const handle = await runtime.createSession({
      userId: input.userId,
      taskId: input.taskId,
      viewport: input.viewport,
      keepAlive: true,
    });
    trackSessionOpen(input.userId, handle.sessionId);
    await attachBrowserSession(input.taskId, input.userId, {
      provider: handle.provider,
      browserSessionId: handle.sessionId,
      workflowState: {
        reservationId: reserved.reservation.reservationId,
        openedAt: handle.createdAt,
      },
    });
    await appendEvent(input.taskId, input.userId, "browser_session", `Opened ${handle.provider} session`);
    return {
      ok: true,
      sessionId: handle.sessionId,
      provider: handle.provider,
      reservationId: reserved.reservation.reservationId,
    };
  } catch (e: any) {
    // Fail closed: release reservation so unused capacity is not held indefinitely
    try {
      const { releaseReservation } = await import("./costControl");
      releaseReservation(reserved.reservation.reservationId);
    } catch {}
    return { ok: false, reason: e?.message || "Failed to open browser session" };
  }
}

export async function liveViewForTask(taskId: string, userId: string) {
  const task = await getActionTask(taskId, userId);
  if (!task?.browserSessionId) throw new Error("No browser session on this task");
  const runtime = await getActiveRuntime();
  return runtime.getLiveView(task.browserSessionId, userId);
}

export async function pauseForHuman(taskId: string, userId: string, detail?: string) {
  await updateTaskStatus(taskId, userId, "awaiting_human");
  await appendEvent(taskId, userId, "awaiting_human", detail || "Waiting for user in Browser Workspace");
}

export async function resumeFromHuman(taskId: string, userId: string) {
  const task = await getActionTask(taskId, userId);
  if (!task) throw new Error("Task not found");
  if (task.status !== "awaiting_human" && task.status !== "awaiting_approval") {
    throw new Error(`Task is not waiting for human (status=${task.status})`);
  }
  await updateTaskStatus(taskId, userId, "running");
  await appendEvent(taskId, userId, "resumed", "User returned control to LENORY");
  return task;
}

export async function closeBrowserSessionForTask(taskId: string, userId: string) {
  const task = await getActionTask(taskId, userId);
  if (!task?.browserSessionId) return;
  const openedAt = task.workflowState?.openedAt
    ? Date.parse(task.workflowState.openedAt)
    : Date.now();
  const durationSec = Math.max(1, Math.round((Date.now() - openedAt) / 1000));
  const limits = loadCostLimits();
  const capped = Math.min(durationSec, limits.maxSessionDurationSec);

  try {
    const runtime = await getActiveRuntime();
    await runtime.closeSession(task.browserSessionId, userId);
  } catch (e: any) {
    console.warn("[sessionManager] close:", e?.message);
  }

  await settleBrowserUsage({
    userId,
    taskId,
    sessionId: task.browserSessionId,
    provider: task.browserProvider || "browserbase",
    durationSec: capped,
    reservationId: task.workflowState?.reservationId,
  });
  trackSessionClose(userId, task.browserSessionId);
  await appendEvent(taskId, userId, "browser_closed", `Session closed after ${capped}s`);
}
