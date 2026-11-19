/**
 * Extended browser tools for Phase 3 (session + human handoff).
 * Reuses capability checks from browser.ts patterns.
 */
import type { ToolContext, ToolResult } from "../types";
import { loadUserCapabilities } from "../capabilities";
import { createActionTask, getActionTask, updateTaskStatus, appendEvent } from "../../actions/taskService";
import { assertPublicHttpUrl } from "../../actions/security";
import {
  openBrowserSessionForTask,
  liveViewForTask,
  pauseForHuman,
  resumeFromHuman,
  closeBrowserSessionForTask,
  getActiveRuntime,
} from "../../actions/sessionManager";

async function ensureActions(userId: string): Promise<string | null> {
  const caps = await loadUserCapabilities(userId);
  if (!caps.lenoryActions) {
    return "LENORY ACTIONS is off. Enable it under Capabilities → LENORY ACTIONS.";
  }
  if (!caps.browserAutomation) {
    return "Browser automation is off. Enable it in LENORY ACTIONS → Configure.";
  }
  return null;
}

export async function toolBrowserOpenSession(
  ctx: ToolContext,
  args: { url: string; description?: string }
): Promise<ToolResult> {
  const denied = await ensureActions(ctx.userId);
  if (denied) return { tool: "browser_open_session", success: false, summary: denied, error: denied };

  const url = String(args.url || "").trim();
  const block = assertPublicHttpUrl(url);
  if (block) return { tool: "browser_open_session", success: false, summary: block, error: block };

  ctx.onStatus?.("using_feature", "Opening browser session");

  const task = await createActionTask({
    userId: ctx.userId,
    sessionId: ctx.sessionId,
    description: args.description || `Browser session: ${url}`,
    tool: "browser_open_session",
    payload: { url },
  });

  const opened = await openBrowserSessionForTask({ userId: ctx.userId, taskId: task.id });
  if (!opened.ok) {
    await updateTaskStatus(task.id, ctx.userId, "failed", { error: opened.reason });
    return { tool: "browser_open_session", success: false, summary: opened.reason, error: opened.reason, data: { taskId: task.id } };
  }

  // Navigate with Playwright CDP
  try {
    const runtime = await getActiveRuntime();
    const connectUrl = await runtime.getConnectUrl(opened.sessionId);
    const { chromium } = await import("playwright-core");
    const browser = await chromium.connectOverCDP(connectUrl);
    const context = browser.contexts()[0] || (await browser.newContext());
    const page = context.pages()[0] || (await context.newPage());
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    const title = await page.title();
    // Do not close browser — session stays alive for human/AI
    await browser.close(); // disconnects CDP client only; Browserbase keepAlive retains remote session
    await updateTaskStatus(task.id, ctx.userId, "running");
    await appendEvent(task.id, ctx.userId, "navigated", title || url);

    let liveViewUrl: string | undefined;
    try {
      const lv = await liveViewForTask(task.id, ctx.userId);
      liveViewUrl = lv.liveViewUrl;
    } catch (e: any) {
      console.warn("[browser_open_session] live view:", e?.message);
    }

    return {
      tool: "browser_open_session",
      success: true,
      summary: `Browser session open on ${url}${title ? ` (title: ${title})` : ""}. Task ${task.id}.`,
      data: {
        taskId: task.id,
        browserSessionId: opened.sessionId,
        liveViewUrl,
        title,
        url,
        note: "Use Browser Workspace to view/interact. Call browser_handoff_human when the user must act.",
      },
    };
  } catch (e: any) {
    const msg = e?.message || String(e);
    await updateTaskStatus(task.id, ctx.userId, "failed", { error: msg });
    await closeBrowserSessionForTask(task.id, ctx.userId).catch(() => {});
    return { tool: "browser_open_session", success: false, summary: msg, error: msg, data: { taskId: task.id } };
  }
}

export async function toolBrowserHandoffHuman(
  ctx: ToolContext,
  args: { taskId: string; reason?: string }
): Promise<ToolResult> {
  const denied = await ensureActions(ctx.userId);
  if (denied) return { tool: "browser_handoff_human", success: false, summary: denied, error: denied };

  const taskId = String(args.taskId || "");
  const task = await getActionTask(taskId, ctx.userId);
  if (!task) return { tool: "browser_handoff_human", success: false, summary: "Task not found", error: "not_found" };

  await pauseForHuman(taskId, ctx.userId, args.reason);
  let liveViewUrl: string | undefined;
  try {
    liveViewUrl = (await liveViewForTask(taskId, ctx.userId)).liveViewUrl;
  } catch {}

  return {
    tool: "browser_handoff_human",
    success: true,
    summary: `Paused for human: ${args.reason || "user action required"}. Open Browser Workspace for this task.`,
    data: { taskId, liveViewUrl, status: "awaiting_human" },
  };
}

export async function toolBrowserResume(
  ctx: ToolContext,
  args: { taskId: string }
): Promise<ToolResult> {
  const denied = await ensureActions(ctx.userId);
  if (denied) return { tool: "browser_resume", success: false, summary: denied, error: denied };
  try {
    const task = await resumeFromHuman(String(args.taskId), ctx.userId);
    return {
      tool: "browser_resume",
      success: true,
      summary: `Resumed task ${task.id}. Continue automation on the same browser session.`,
      data: { taskId: task.id, browserSessionId: task.browserSessionId },
    };
  } catch (e: any) {
    return { tool: "browser_resume", success: false, summary: e?.message || String(e), error: e?.message };
  }
}

export async function toolBrowserCloseSession(
  ctx: ToolContext,
  args: { taskId: string }
): Promise<ToolResult> {
  const denied = await ensureActions(ctx.userId);
  if (denied) return { tool: "browser_close_session", success: false, summary: denied, error: denied };
  const taskId = String(args.taskId || "");
  await closeBrowserSessionForTask(taskId, ctx.userId);
  await updateTaskStatus(taskId, ctx.userId, "completed", { result: { closed: true } });
  return {
    tool: "browser_close_session",
    success: true,
    summary: `Closed browser session for task ${taskId}.`,
    data: { taskId },
  };
}
