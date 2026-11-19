/**
 * Playwright actions against an existing Browserbase (or runtime) session.
 * Connects over CDP, performs one or more ops, disconnects without killing remote session.
 */
import { getActiveRuntime } from "./sessionManager";
import { getActionTask, appendEvent, setWorkflowState } from "./taskService";
import { assertPublicHttpUrl } from "./security";

export type PageAction =
  | { op: "navigate"; url: string }
  | { op: "click"; selector: string; timeoutMs?: number }
  | { op: "fill"; selector: string; value: string; timeoutMs?: number }
  | { op: "select"; selector: string; value: string; timeoutMs?: number }
  | { op: "scroll"; direction?: "up" | "down"; amount?: number }
  | { op: "wait"; ms?: number; selector?: string }
  | { op: "extract"; selector?: string; maxChars?: number }
  | { op: "screenshot"; fullPage?: boolean }
  | { op: "press"; key: string }
  | { op: "evaluate_text"; scriptNote?: string };

export interface PageActionResult {
  success: boolean;
  summary: string;
  error?: string;
  title?: string;
  url?: string;
  text?: string;
  /** PNG base64 without data: prefix — client stores in IndexedDB */
  screenshotBase64?: string;
  mimeType?: string;
}

async function touchActivity(taskId: string, userId: string) {
  const task = await getActionTask(taskId, userId);
  const ws = { ...(task?.workflowState || {}), lastActivityAt: new Date().toISOString() };
  await setWorkflowState(taskId, userId, ws);
}

export async function runPageActions(input: {
  userId: string;
  taskId: string;
  actions: PageAction[];
}): Promise<PageActionResult> {
  const task = await getActionTask(input.taskId, input.userId);
  if (!task) return { success: false, summary: "Task not found", error: "not_found" };
  if (!task.browserSessionId) {
    return {
      success: false,
      summary: "No browser session on this task. Call browser_open_session first.",
      error: "no_session",
    };
  }
  if (["failed", "cancelled", "timed_out", "completed"].includes(task.status) && !task.browserSessionId) {
    return { success: false, summary: `Task status is ${task.status}`, error: "bad_status" };
  }

  let browser: any = null;
  try {
    const runtime = await getActiveRuntime();
    const connectUrl = await runtime.getConnectUrl(task.browserSessionId);
    const { chromium } = await import("playwright-core");
    browser = await chromium.connectOverCDP(connectUrl);
    const context = browser.contexts()[0] || (await browser.newContext());
    const page = context.pages()[0] || (await context.newPage());
    page.setDefaultTimeout(25000);

    let lastText = "";
    let screenshotBase64: string | undefined;
    const notes: string[] = [];

    for (const action of input.actions) {
      const op = action.op;
      if (op === "navigate") {
        const block = assertPublicHttpUrl(action.url);
        if (block) return { success: false, summary: block, error: block };
        await page.goto(action.url, { waitUntil: "domcontentloaded", timeout: 45000 });
        notes.push(`navigated:${action.url}`);
        await appendEvent(input.taskId, input.userId, "navigate", action.url);
      } else if (op === "click") {
        await page.locator(action.selector).first().click({ timeout: action.timeoutMs || 20000 });
        notes.push(`clicked:${action.selector}`);
        await appendEvent(input.taskId, input.userId, "click", action.selector);
      } else if (op === "fill") {
        const loc = page.locator(action.selector).first();
        await loc.fill(String(action.value ?? ""), { timeout: action.timeoutMs || 20000 });
        notes.push(`filled:${action.selector}`);
        await appendEvent(input.taskId, input.userId, "fill", action.selector);
      } else if (op === "select") {
        await page.locator(action.selector).first().selectOption(String(action.value), {
          timeout: action.timeoutMs || 20000,
        });
        notes.push(`selected:${action.selector}`);
        await appendEvent(input.taskId, input.userId, "select", action.selector);
      } else if (op === "scroll") {
        const amount = action.amount || 600;
        const dy = (action.direction || "down") === "up" ? -amount : amount;
        await page.mouse.wheel(0, dy);
        notes.push(`scroll:${action.direction || "down"}`);
      } else if (op === "wait") {
        if (action.selector) {
          await page.locator(action.selector).first().waitFor({ state: "visible", timeout: action.ms || 20000 });
        } else {
          await page.waitForTimeout(Math.min(action.ms || 1000, 15000));
        }
        notes.push("wait");
      } else if (op === "press") {
        await page.keyboard.press(action.key);
        notes.push(`press:${action.key}`);
      } else if (op === "extract") {
        if (action.selector) {
          lastText = (await page.locator(action.selector).first().innerText({ timeout: 15000 }).catch(() => "")) || "";
        } else {
          lastText = await page.evaluate(() => {
            const body = document.body;
            return body ? (body.innerText || "").slice(0, 50000) : "";
          });
        }
        const max = action.maxChars || 12000;
        if (lastText.length > max) lastText = lastText.slice(0, max) + "\n…[truncated]";
        notes.push(`extract:${lastText.length}chars`);
        await appendEvent(input.taskId, input.userId, "extract", `${lastText.length} chars`);
      } else if (op === "screenshot") {
        const buf = await page.screenshot({
          type: "png",
          fullPage: !!action.fullPage,
          timeout: 30000,
        });
        screenshotBase64 = Buffer.from(buf).toString("base64");
        notes.push("screenshot");
        await appendEvent(input.taskId, input.userId, "screenshot", action.fullPage ? "fullPage" : "viewport");
      }
    }

    const title = await page.title().catch(() => "");
    const url = page.url();
    await touchActivity(input.taskId, input.userId);

    // Disconnect CDP client only — remote Browserbase session stays alive when keepAlive
    await browser.close().catch(() => {});
    browser = null;

    return {
      success: true,
      summary: notes.join(" · ") || "ok",
      title,
      url,
      text: lastText || undefined,
      screenshotBase64,
      mimeType: screenshotBase64 ? "image/png" : undefined,
    };
  } catch (e: any) {
    try {
      if (browser) await browser.close();
    } catch {}
    const msg = e?.message || String(e);
    await appendEvent(input.taskId, input.userId, "action_error", msg.slice(0, 300));
    return { success: false, summary: msg, error: msg };
  }
}
