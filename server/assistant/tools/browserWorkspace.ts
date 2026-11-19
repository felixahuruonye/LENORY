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
import { runPageActions } from "../../actions/pageActions";

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


function requireTaskId(args: any): string {
  return String(args?.taskId || "").trim();
}

export async function toolBrowserNavigate(
  ctx: ToolContext,
  args: { taskId: string; url: string }
): Promise<ToolResult> {
  const denied = await ensureActions(ctx.userId);
  if (denied) return { tool: "browser_navigate", success: false, summary: denied, error: denied };
  const taskId = requireTaskId(args);
  const url = String(args.url || "").trim();
  const block = assertPublicHttpUrl(url);
  if (block) return { tool: "browser_navigate", success: false, summary: block, error: block };
  ctx.onStatus?.("using_feature", "Navigating");
  const r = await runPageActions({ userId: ctx.userId, taskId, actions: [{ op: "navigate", url }] });
  return {
    tool: "browser_navigate",
    success: r.success,
    summary: r.success ? `Opened ${r.url || url}${r.title ? ` — ${r.title}` : ""}` : r.summary,
    error: r.error,
    data: { taskId, url: r.url, title: r.title },
  };
}

export async function toolBrowserClick(
  ctx: ToolContext,
  args: { taskId: string; selector: string }
): Promise<ToolResult> {
  const denied = await ensureActions(ctx.userId);
  if (denied) return { tool: "browser_click", success: false, summary: denied, error: denied };
  const taskId = requireTaskId(args);
  const selector = String(args.selector || "").trim();
  if (!selector) return { tool: "browser_click", success: false, summary: "selector required", error: "selector" };
  ctx.onStatus?.("using_feature", "Clicking");
  const r = await runPageActions({ userId: ctx.userId, taskId, actions: [{ op: "click", selector }] });
  return {
    tool: "browser_click",
    success: r.success,
    summary: r.success ? `Clicked ${selector} on ${r.url || "page"}` : r.summary,
    error: r.error,
    data: { taskId, url: r.url, title: r.title },
  };
}

export async function toolBrowserFill(
  ctx: ToolContext,
  args: { taskId: string; selector: string; value: string }
): Promise<ToolResult> {
  const denied = await ensureActions(ctx.userId);
  if (denied) return { tool: "browser_fill", success: false, summary: denied, error: denied };
  const taskId = requireTaskId(args);
  const selector = String(args.selector || "").trim();
  const value = String(args.value ?? "");
  if (!selector) return { tool: "browser_fill", success: false, summary: "selector required", error: "selector" };
  ctx.onStatus?.("using_feature", "Filling field");
  const r = await runPageActions({
    userId: ctx.userId,
    taskId,
    actions: [{ op: "fill", selector, value }],
  });
  return {
    tool: "browser_fill",
    success: r.success,
    summary: r.success ? `Filled ${selector}` : r.summary,
    error: r.error,
    data: { taskId, url: r.url },
  };
}

export async function toolBrowserSelect(
  ctx: ToolContext,
  args: { taskId: string; selector: string; value: string }
): Promise<ToolResult> {
  const denied = await ensureActions(ctx.userId);
  if (denied) return { tool: "browser_select", success: false, summary: denied, error: denied };
  const taskId = requireTaskId(args);
  const selector = String(args.selector || "").trim();
  const value = String(args.value ?? "");
  ctx.onStatus?.("using_feature", "Selecting option");
  const r = await runPageActions({
    userId: ctx.userId,
    taskId,
    actions: [{ op: "select", selector, value }],
  });
  return {
    tool: "browser_select",
    success: r.success,
    summary: r.success ? `Selected ${value} on ${selector}` : r.summary,
    error: r.error,
    data: { taskId },
  };
}

export async function toolBrowserExtract(
  ctx: ToolContext,
  args: { taskId: string; selector?: string }
): Promise<ToolResult> {
  const denied = await ensureActions(ctx.userId);
  if (denied) return { tool: "browser_extract", success: false, summary: denied, error: denied };
  const taskId = requireTaskId(args);
  ctx.onStatus?.("using_feature", "Reading page");
  const r = await runPageActions({
    userId: ctx.userId,
    taskId,
    actions: [{ op: "extract", selector: args.selector, maxChars: 12000 }],
  });
  return {
    tool: "browser_extract",
    success: r.success,
    summary: r.success
      ? `Read ${r.title || r.url || "page"} (${(r.text || "").length} chars)`
      : r.summary,
    error: r.error,
    data: { taskId, url: r.url, title: r.title, text: r.text },
  };
}

export async function toolBrowserScreenshot(
  ctx: ToolContext,
  args: { taskId: string; fullPage?: boolean }
): Promise<ToolResult> {
  const denied = await ensureActions(ctx.userId);
  if (denied) return { tool: "browser_screenshot_session", success: false, summary: denied, error: denied };
  const taskId = requireTaskId(args);
  ctx.onStatus?.("using_feature", "Screenshot");
  const r = await runPageActions({
    userId: ctx.userId,
    taskId,
    actions: [{ op: "screenshot", fullPage: !!args.fullPage }],
  });
  const images =
    r.screenshotBase64
      ? [
          {
            url: `data:image/png;base64,${r.screenshotBase64}`,
            title: `Screenshot ${r.title || taskId}`,
            id: `shot_${taskId}_${Date.now()}`,
            storeLocally: true,
            taskId,
            base64: r.screenshotBase64,
            mimeType: "image/png",
          },
        ]
      : undefined;
  return {
    tool: "browser_screenshot_session",
    success: r.success,
    summary: r.success ? `Screenshot captured for task ${taskId}` : r.summary,
    error: r.error,
    data: {
      taskId,
      url: r.url,
      title: r.title,
      storeLocally: true,
      mimeType: "image/png",
      // base64 for client IndexedDB — prefer not logging this
      screenshotBase64: r.screenshotBase64,
    },
    images,
  };
}

export async function toolBrowserScroll(
  ctx: ToolContext,
  args: { taskId: string; direction?: "up" | "down"; amount?: number }
): Promise<ToolResult> {
  const denied = await ensureActions(ctx.userId);
  if (denied) return { tool: "browser_scroll", success: false, summary: denied, error: denied };
  const taskId = requireTaskId(args);
  const r = await runPageActions({
    userId: ctx.userId,
    taskId,
    actions: [{ op: "scroll", direction: args.direction || "down", amount: args.amount }],
  });
  return {
    tool: "browser_scroll",
    success: r.success,
    summary: r.success ? `Scrolled ${args.direction || "down"}` : r.summary,
    error: r.error,
    data: { taskId },
  };
}

export async function toolBrowserWait(
  ctx: ToolContext,
  args: { taskId: string; ms?: number; selector?: string }
): Promise<ToolResult> {
  const denied = await ensureActions(ctx.userId);
  if (denied) return { tool: "browser_wait", success: false, summary: denied, error: denied };
  const taskId = requireTaskId(args);
  const r = await runPageActions({
    userId: ctx.userId,
    taskId,
    actions: [{ op: "wait", ms: args.ms, selector: args.selector }],
  });
  return {
    tool: "browser_wait",
    success: r.success,
    summary: r.success ? "Waited" : r.summary,
    error: r.error,
    data: { taskId },
  };
}

/**
 * Multi-step helper: navigate → optional extract → optional screenshot in one tool call.
 * Prefer for "open this site, read it, screenshot".
 */
export async function toolBrowserRunSteps(
  ctx: ToolContext,
  args: {
    taskId: string;
    steps: Array<{
      op: string;
      url?: string;
      selector?: string;
      value?: string;
      ms?: number;
      fullPage?: boolean;
      direction?: string;
      amount?: number;
      key?: string;
    }>;
  }
): Promise<ToolResult> {
  const denied = await ensureActions(ctx.userId);
  if (denied) return { tool: "browser_run_steps", success: false, summary: denied, error: denied };
  const taskId = requireTaskId(args);
  const steps = Array.isArray(args.steps) ? args.steps : [];
  if (!steps.length) return { tool: "browser_run_steps", success: false, summary: "steps required", error: "steps" };

  const actions: any[] = [];
  for (const s of steps.slice(0, 12)) {
    const op = String(s.op || "").toLowerCase();
    if (op === "navigate" && s.url) actions.push({ op: "navigate", url: s.url });
    else if (op === "click" && s.selector) actions.push({ op: "click", selector: s.selector });
    else if (op === "fill" && s.selector) actions.push({ op: "fill", selector: s.selector, value: s.value ?? "" });
    else if (op === "select" && s.selector) actions.push({ op: "select", selector: s.selector, value: s.value ?? "" });
    else if (op === "scroll") actions.push({ op: "scroll", direction: s.direction || "down", amount: s.amount });
    else if (op === "wait") actions.push({ op: "wait", ms: s.ms, selector: s.selector });
    else if (op === "extract") actions.push({ op: "extract", selector: s.selector });
    else if (op === "screenshot") actions.push({ op: "screenshot", fullPage: !!s.fullPage });
    else if (op === "press" && s.key) actions.push({ op: "press", key: s.key });
  }
  if (!actions.length) {
    return { tool: "browser_run_steps", success: false, summary: "No valid steps", error: "invalid_steps" };
  }

  ctx.onStatus?.("using_feature", `Browser steps (${actions.length})`);
  const r = await runPageActions({ userId: ctx.userId, taskId, actions });
  const images =
    r.screenshotBase64
      ? [
          {
            url: `data:image/png;base64,${r.screenshotBase64}`,
            title: `Screenshot ${r.title || taskId}`,
            storeLocally: true,
            taskId,
            base64: r.screenshotBase64,
            mimeType: "image/png",
          },
        ]
      : undefined;

  return {
    tool: "browser_run_steps",
    success: r.success,
    summary: r.success
      ? `${r.summary}${r.title ? ` | ${r.title}` : ""}${r.text ? ` | text ${r.text.length} chars` : ""}`
      : r.summary,
    error: r.error,
    data: {
      taskId,
      url: r.url,
      title: r.title,
      text: r.text,
      screenshotBase64: r.screenshotBase64,
      storeLocally: !!r.screenshotBase64,
    },
    images,
  };
}
