/**
 * Browserbase-backed BrowserRuntime.
 * Uses @browserbasehq/sdk + playwright-core connectOverCDP.
 * API keys stay on the server only.
 */
import type {
  BrowserRuntime,
  BrowserSessionHandle,
  CreateSessionOptions,
  LiveViewInfo,
} from "./browserRuntime";
import { registerSession, markSessionClosed, getRegisteredSession } from "./browserRuntime";

function requireApiKey(): string {
  const key = process.env.BROWSERBASE_API_KEY || "";
  if (!key) throw new Error("BROWSERBASE_API_KEY is not configured");
  return key;
}

async function getSdk(): Promise<any> {
  try {
    const mod = await import("@browserbasehq/sdk");
    const Browserbase = mod.default || mod.Browserbase;
    return new Browserbase({ apiKey: requireApiKey() });
  } catch (e: any) {
    throw new Error(
      `Browserbase SDK unavailable: ${e?.message || e}. Install @browserbasehq/sdk`
    );
  }
}

export class BrowserbaseRuntime implements BrowserRuntime {
  readonly provider = "browserbase" as const;

  async isAvailable(): Promise<boolean> {
    const key = process.env.BROWSERBASE_API_KEY || "";
    return key.length > 8;
  }

  async createSession(opts: CreateSessionOptions): Promise<BrowserSessionHandle> {
    const bb = await getSdk();
    const projectId = process.env.BROWSERBASE_PROJECT_ID;
    const viewport = opts.viewport || { width: 1280, height: 720 };

    const createArgs: any = {
      keepAlive: opts.keepAlive !== false,
      browserSettings: {
        viewport,
      },
    };
    if (projectId) createArgs.projectId = projectId;

    const session = await bb.sessions.create(createArgs);
    const handle: BrowserSessionHandle = {
      provider: "browserbase",
      sessionId: session.id,
      connectUrl: session.connectUrl,
      createdAt: new Date().toISOString(),
      userId: opts.userId,
      taskId: opts.taskId,
    };
    registerSession(handle);
    return handle;
  }

  async getConnectUrl(sessionId: string): Promise<string> {
    const reg = getRegisteredSession(sessionId);
    if (reg?.connectUrl) return reg.connectUrl;
    // Re-fetch is not always available; fail closed if we lost the connect URL
    throw new Error("Session connect URL not available in this process (session may have expired)");
  }

  async getLiveView(sessionId: string, userId: string): Promise<LiveViewInfo> {
    const reg = getRegisteredSession(sessionId);
    if (reg && reg.userId !== userId) {
      throw new Error("Session not found or not owned by this user");
    }
    const bb = await getSdk();
    const debug = await bb.sessions.debug(sessionId);
    const liveViewUrl =
      debug.debuggerFullscreenUrl ||
      debug.debuggerUrl ||
      (debug.pages && debug.pages[0]?.debuggerFullscreenUrl) ||
      "";
    if (!liveViewUrl) throw new Error("Browserbase did not return a Live View URL");
    return {
      sessionId,
      liveViewUrl,
      debuggerUrl: debug.debuggerUrl,
      pages: debug.pages,
    };
  }

  async closeSession(sessionId: string, userId: string): Promise<void> {
    const reg = getRegisteredSession(sessionId);
    if (reg && reg.userId !== userId) {
      throw new Error("Session not found or not owned by this user");
    }
    try {
      const bb = await getSdk();
      // Best-effort request to end session if API supports it
      if (typeof bb.sessions?.update === "function") {
        await bb.sessions.update(sessionId, { status: "REQUEST_RELEASE" }).catch(() => {});
      }
    } catch {
      /* ignore */
    }
    markSessionClosed(sessionId);
  }
}

export const browserbaseRuntime = new BrowserbaseRuntime();
