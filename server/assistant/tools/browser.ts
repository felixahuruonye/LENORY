/**
 * LENORY ACTIONS — browser tools for the existing agent loop.
 * These do NOT run Playwright inside the chat request.
 * They create durable tasks; the Actions worker executes them.
 */
import type { ToolContext, ToolResult } from "../types";
import { loadUserCapabilities } from "../capabilities";
import { createActionTask, getActionTask, listEvents, listArtifacts } from "../../actions/taskService";
import { assertPublicHttpUrl } from "../../actions/security";
import { processOneActionTask } from "../../actions/worker";

async function ensureActionsEnabled(userId: string): Promise<string | null> {
  const caps = await loadUserCapabilities(userId);
  if (!caps.lenoryActions) {
    return "LENORY ACTIONS is turned off. Open Capabilities → LENORY ACTIONS, enable it, then try again.";
  }
  if (!caps.browserAutomation) {
    return "Browser automation is disabled. Open Capabilities → LENORY ACTIONS → Configure and enable Browser Automation.";
  }
  return null;
}

/** Open a public URL, read text, optional screenshot — main MVP tool */
export async function toolBrowserOpenAndRead(
  ctx: ToolContext,
  args: { url: string; screenshot?: boolean; description?: string }
): Promise<ToolResult> {
  const denied = await ensureActionsEnabled(ctx.userId);
  if (denied) return { tool: "browser_open_and_read", success: false, summary: denied, error: denied };

  const url = String(args.url || "").trim();
  const block = assertPublicHttpUrl(url);
  if (block) return { tool: "browser_open_and_read", success: false, summary: block, error: block };

  ctx.onStatus?.("using_feature", "Starting browser task");

  const task = await createActionTask({
    userId: ctx.userId,
    sessionId: ctx.sessionId,
    description: args.description || `Open and read ${url}`,
    tool: "browser_open_and_read",
    payload: { op: "open_and_read", url, screenshot: args.screenshot !== false },
  });

  // If this process can run the worker inline (dev / single instance with Playwright),
  // process one job immediately so chat gets a result without a separate worker.
  // Production should use ACTIONS_WORKER=1 separate process; inline is best-effort.
  if (process.env.ACTIONS_INLINE_WORKER === "1" || process.env.ACTIONS_WORKER === "1") {
    try {
      await processOneActionTask();
    } catch (e: any) {
      console.warn("[browser tool] inline worker:", e?.message);
    }
  } else {
    // Best-effort inline attempt when Playwright is available (same machine)
    try {
      await processOneActionTask();
    } catch {
      /* worker may pick it up */
    }
  }

  // Poll briefly for completion so the model can use the result in the same turn
  let final = await getActionTask(task.id, ctx.userId);
  for (let i = 0; i < 40 && final && !["completed", "failed", "cancelled", "timed_out"].includes(final.status); i++) {
    await new Promise((r) => setTimeout(r, 1500));
    final = await getActionTask(task.id, ctx.userId);
    if (i === 0) ctx.onStatus?.("using_feature", "Browser working…");
  }

  if (!final) {
    return {
      tool: "browser_open_and_read",
      success: false,
      summary: "Task was created but could not be loaded. Check Actions task history.",
      error: "task_missing",
      data: { taskId: task.id },
    };
  }

  if (final.status !== "completed") {
    const events = await listEvents(task.id, ctx.userId);
    return {
      tool: "browser_open_and_read",
      success: false,
      summary:
        final.error ||
        `Browser task status: ${final.status}. ` +
          (final.status === "queued"
            ? "The Actions worker may be offline. Deploy the worker with ACTIONS_WORKER=1 and Playwright, or set ACTIONS_INLINE_WORKER=1 on a machine with Chromium."
            : ""),
      error: final.error || final.status,
      data: { taskId: task.id, status: final.status, events },
    };
  }

  const result = final.result || {};
  const artifacts = await listArtifacts(task.id, ctx.userId);
  const images = artifacts
    .filter((a) => a.kind === "screenshot" && a.publicUrl)
    .map((a) => ({ url: a.publicUrl!, title: `Screenshot — ${result.title || url}`, id: a.id }));

  return {
    tool: "browser_open_and_read",
    success: true,
    summary: result.summary || result.text?.slice(0, 1500) || `Opened ${result.url || url}`,
    data: {
      taskId: task.id,
      title: result.title,
      url: result.url,
      text: result.text,
      pagesVisited: result.pagesVisited,
    },
    images: images.length ? images : undefined,
  };
}

export async function toolBrowserGetTaskStatus(
  ctx: ToolContext,
  args: { taskId: string }
): Promise<ToolResult> {
  const denied = await ensureActionsEnabled(ctx.userId);
  if (denied) return { tool: "browser_get_task_status", success: false, summary: denied, error: denied };

  const task = await getActionTask(String(args.taskId || ""), ctx.userId);
  if (!task) {
    return { tool: "browser_get_task_status", success: false, summary: "Task not found or not yours.", error: "not_found" };
  }
  const events = await listEvents(task.id, ctx.userId);
  const artifacts = await listArtifacts(task.id, ctx.userId);
  return {
    tool: "browser_get_task_status",
    success: true,
    summary: `Task ${task.id}: ${task.status}${task.error ? ` — ${task.error}` : ""}`,
    data: { task, events, artifacts },
    images: artifacts
      .filter((a) => a.publicUrl)
      .map((a) => ({ url: a.publicUrl!, title: a.kind, id: a.id })),
  };
}

export async function toolBrowserScreenshot(
  ctx: ToolContext,
  args: { url: string }
): Promise<ToolResult> {
  return toolBrowserOpenAndRead(ctx, { url: args.url, screenshot: true, description: `Screenshot ${args.url}` });
}
