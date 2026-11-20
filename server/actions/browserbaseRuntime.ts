/**
 * Browserbase-backed BrowserRuntime.
 * Uses official REST API (no hard dependency on @browserbasehq/sdk at runtime).
 * Docs: https://api.browserbase.com/v1/sessions  (header: X-BB-API-Key)
 */
import type { BrowserRuntime, BrowserSessionInfo, LiveViewInfo } from "./browserRuntime";

function requireApiKey(): string {
  const k = process.env.BROWSERBASE_API_KEY || "";
  if (k.length < 8) throw new Error("BROWSERBASE_API_KEY is not configured");
  return k;
}

function projectId(): string | undefined {
  const p = process.env.BROWSERBASE_PROJECT_ID || "";
  return p || undefined;
}

const BB_API = "https://api.browserbase.com/v1";

const registry = new Map<string, { connectUrl?: string; liveViewUrl?: string; createdAt: number }>();

async function bbFetch(path: string, init: RequestInit = {}) {
  const apiKey = requireApiKey();
  const res = await fetch(`${BB_API}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "X-BB-API-Key": apiKey,
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  let body: any = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { raw: text };
  }
  if (!res.ok) {
    const msg = body?.message || body?.error || text || res.statusText;
    throw new Error(`Browserbase API ${res.status}: ${msg}`);
  }
  return body;
}

export class BrowserbaseRuntime implements BrowserRuntime {
  name = "browserbase" as const;

  async isAvailable(): Promise<boolean> {
    return (process.env.BROWSERBASE_API_KEY || "").length > 8;
  }

  async createSession(opts?: { keepAlive?: boolean; contextId?: string }): Promise<BrowserSessionInfo> {
    const body: Record<string, unknown> = {
      keepAlive: opts?.keepAlive !== false,
    };
    const pid = projectId();
    if (pid) body.projectId = pid;
    if (opts?.contextId) {
      body.browserSettings = { context: { id: opts.contextId, persist: true } };
    }

    const session = await bbFetch("/sessions", {
      method: "POST",
      body: JSON.stringify(body),
    });

    const id = session.id;
    if (!id) throw new Error("Browserbase did not return a session id");
    const connectUrl: string =
      session.connectUrl ||
      session.connect_url ||
      `wss://connect.browserbase.com?apiKey=${encodeURIComponent(requireApiKey())}&sessionId=${id}`;

    registry.set(id, { connectUrl, createdAt: Date.now() });

    return {
      sessionId: id,
      connectUrl,
      provider: "browserbase",
      createdAt: session.createdAt || new Date().toISOString(),
    };
  }

  async getConnectUrl(sessionId: string): Promise<string> {
    const reg = registry.get(sessionId);
    if (reg?.connectUrl) return reg.connectUrl;
    try {
      const detail = await bbFetch(`/sessions/${sessionId}`);
      const url =
        detail.connectUrl ||
        detail.connect_url ||
        `wss://connect.browserbase.com?apiKey=${encodeURIComponent(requireApiKey())}&sessionId=${sessionId}`;
      registry.set(sessionId, { ...(reg || { createdAt: Date.now() }), connectUrl: url });
      return url;
    } catch {
      return `wss://connect.browserbase.com?apiKey=${encodeURIComponent(requireApiKey())}&sessionId=${sessionId}`;
    }
  }

  async getLiveView(sessionId: string): Promise<LiveViewInfo> {
    let liveViewUrl = "";
    try {
      const debug = await bbFetch(`/sessions/${sessionId}/debug`);
      liveViewUrl =
        debug.debuggerFullscreenUrl ||
        debug.debuggerUrl ||
        (Array.isArray(debug.pages) && debug.pages[0]?.debuggerFullscreenUrl) ||
        (Array.isArray(debug.pages) && debug.pages[0]?.debuggerUrl) ||
        "";
    } catch (e: any) {
      console.warn("[browserbase] debug/live view:", e?.message || e);
    }

    if (!liveViewUrl) {
      liveViewUrl = `https://www.browserbase.com/sessions/${sessionId}`;
    }

    const reg = registry.get(sessionId) || { createdAt: Date.now() };
    registry.set(sessionId, { ...reg, liveViewUrl });

    return { sessionId, liveViewUrl };
  }

  async closeSession(sessionId: string): Promise<void> {
    // Prefer request release if supported; ignore errors
    try {
      await bbFetch(`/sessions/${sessionId}`, {
        method: "POST",
        body: JSON.stringify({ projectId: projectId(), status: "REQUEST_RELEASE" }),
      });
    } catch {
      try {
        await bbFetch(`/sessions/${sessionId}`, { method: "DELETE" });
      } catch (e: any) {
        console.warn("[browserbase] closeSession:", e?.message || e);
      }
    }
    registry.delete(sessionId);
  }
}

export const browserbaseRuntime = new BrowserbaseRuntime();
