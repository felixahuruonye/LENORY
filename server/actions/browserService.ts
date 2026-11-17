/**
 * Playwright browser execution for LENORY ACTIONS.
 * Runs only in the worker process. Isolated context per task.
 * If Playwright is not installed, returns a clear error (do not fake success).
 */
import { assertPublicHttpUrl, BROWSER_LIMITS } from "./security";
import { appendEvent, updateTaskStatus, addArtifact, type ActionTask } from "./taskService";
import { uploadEvidence } from "./evidenceService";

export interface BrowserRunResult {
  success: boolean;
  title?: string;
  url?: string;
  text?: string;
  summary?: string;
  screenshotUrl?: string;
  error?: string;
  pagesVisited?: string[];
}

async function loadPlaywright(): Promise<any | null> {
  try {
    // Dynamic import so the web service can start without playwright installed
    const pw = await import("playwright");
    return pw;
  } catch {
    return null;
  }
}

/**
 * Execute a browser task payload.
 * Supported ops: open | navigate | read | screenshot | open_and_read
 */
export async function runBrowserTask(task: ActionTask): Promise<BrowserRunResult> {
  const { userId, id: taskId, payload } = task;
  const op = String(payload?.op || "open_and_read");
  const targetUrl = String(payload?.url || "").trim();

  const blocked = assertPublicHttpUrl(targetUrl);
  if (blocked) {
    await updateTaskStatus(taskId, userId, "failed", { error: blocked });
    return { success: false, error: blocked };
  }

  const pw = await loadPlaywright();
  if (!pw) {
    const msg =
      "Playwright is not installed on this worker. Set up the Actions worker with `npx playwright install chromium` (see docs/ACTIONS.md).";
    await updateTaskStatus(taskId, userId, "failed", { error: msg });
    return { success: false, error: msg };
  }

  await updateTaskStatus(taskId, userId, "running");
  await appendEvent(taskId, userId, "running", "Launching browser");

  let browser: any = null;
  const pagesVisited: string[] = [];

  try {
    browser = await pw.chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
    });
    const context = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      userAgent:
        "Mozilla/5.0 (compatible; LENORY-Actions/1.0; +https://lenory.app) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
    });
    const page = await context.newPage();
    page.setDefaultTimeout(BROWSER_LIMITS.navigationTimeoutMs);

    // Block navigations to private hosts even after redirects
    page.on("framenavigated", async (frame: any) => {
      if (frame !== page.mainFrame()) return;
      const u = frame.url();
      if (u && u !== "about:blank") {
        const reason = assertPublicHttpUrl(u);
        if (reason) {
          await page.close().catch(() => {});
          throw new Error(`Blocked redirect: ${reason}`);
        }
      }
    });

    await appendEvent(taskId, userId, "opening", `Opening ${targetUrl}`);
    const response = await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: BROWSER_LIMITS.navigationTimeoutMs });
    const finalUrl = page.url();
    const redirBlock = assertPublicHttpUrl(finalUrl);
    if (redirBlock) throw new Error(`Blocked final URL: ${redirBlock}`);
    pagesVisited.push(finalUrl);

    const title = await page.title();
    await appendEvent(taskId, userId, "reading", `Page title: ${title}`);

    // Extract main text (cap size)
    const text = await page.evaluate(() => {
      const body = document.body?.innerText || "";
      return body.replace(/\s+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, 12000);
    });

    let screenshotUrl: string | undefined;
    if (op === "screenshot" || op === "open_and_read" || payload?.screenshot !== false) {
      await appendEvent(taskId, userId, "screenshot", "Capturing screenshot");
      const buf: Buffer = await page.screenshot({ fullPage: false, type: "png" });
      if (buf.length <= BROWSER_LIMITS.maxScreenshotBytes) {
        const uploaded = await uploadEvidence({
          userId,
          taskId,
          buffer: buf,
          mimeType: "image/png",
          fileName: `screenshot-${Date.now()}.png`,
        });
        if (uploaded?.url) {
          screenshotUrl = uploaded.url;
          await addArtifact({
            taskId,
            userId,
            kind: "screenshot",
            path: uploaded.path,
            publicUrl: uploaded.url,
            mimeType: "image/png",
          });
          await appendEvent(taskId, userId, "screenshot_uploaded", uploaded.url);
        }
      }
    }

    // Optional controlled click (only if selector provided and allowlisted page)
    if (op === "click" && payload?.selector) {
      await appendEvent(taskId, userId, "clicking", `Click ${payload.selector}`);
      await page.click(String(payload.selector), { timeout: 10_000 });
      pagesVisited.push(page.url());
    }

    if (op === "fill" && payload?.selector && typeof payload?.value === "string") {
      await appendEvent(taskId, userId, "filling", `Fill ${payload.selector}`);
      await page.fill(String(payload.selector), String(payload.value).slice(0, 2000));
    }

    const summary = `Visited ${finalUrl}\nTitle: ${title}\nHTTP: ${response?.status() ?? "n/a"}\n\n${text.slice(0, 3000)}`;

    const result: BrowserRunResult = {
      success: true,
      title,
      url: finalUrl,
      text: text.slice(0, 8000),
      summary,
      screenshotUrl,
      pagesVisited,
    };

    await updateTaskStatus(taskId, userId, "completed", { result });
    await appendEvent(taskId, userId, "completed", "Browser task finished");
    return result;
  } catch (e: any) {
    const msg = e?.message || String(e);
    await updateTaskStatus(taskId, userId, "failed", { error: msg });
    await appendEvent(taskId, userId, "failed", msg);
    return { success: false, error: msg, pagesVisited };
  } finally {
    try {
      await browser?.close();
    } catch {
      /* ignore */
    }
  }
}
