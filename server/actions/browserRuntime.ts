/**
 * Provider-independent browser runtime for LENORY ACTIONS.
 * Browserbase now; local Playwright / VPS later via same interface.
 *
 * Security: CDP connect URLs never leave the backend.
 * Frontend only receives authenticated Live View URLs.
 */

export type BrowserProvider = "browserbase" | "local";

export interface CreateSessionOptions {
  userId: string;
  taskId?: string;
  viewport?: { width: number; height: number };
  /** Keep session alive while awaiting human (provider-dependent). */
  keepAlive?: boolean;
}

export interface BrowserSessionHandle {
  provider: BrowserProvider;
  sessionId: string;
  /** Internal only — never send to frontend */
  connectUrl?: string;
  createdAt: string;
  userId: string;
  taskId?: string;
}

export interface LiveViewInfo {
  sessionId: string;
  /** Short-lived embeddable Live View URL for the authenticated owner */
  liveViewUrl: string;
  debuggerUrl?: string;
  pages?: { url?: string; debuggerFullscreenUrl?: string }[];
}

export interface BrowserRuntime {
  readonly provider: BrowserProvider;
  isAvailable(): Promise<boolean>;
  createSession(opts: CreateSessionOptions): Promise<BrowserSessionHandle>;
  /** Connect Playwright to an existing session (backend only). */
  getConnectUrl(sessionId: string): Promise<string>;
  getLiveView(sessionId: string, userId: string): Promise<LiveViewInfo>;
  closeSession(sessionId: string, userId: string): Promise<void>;
}

/** In-memory registry of active sessions owned by this process (supplemented by DB). */
const sessionRegistry = new Map<
  string,
  BrowserSessionHandle & { closed?: boolean }
>();

export function registerSession(handle: BrowserSessionHandle) {
  sessionRegistry.set(handle.sessionId, { ...handle, closed: false });
}

export function getRegisteredSession(sessionId: string): BrowserSessionHandle | null {
  const s = sessionRegistry.get(sessionId);
  if (!s || s.closed) return null;
  return s;
}

export function markSessionClosed(sessionId: string) {
  const s = sessionRegistry.get(sessionId);
  if (s) s.closed = true;
}

export function listRegisteredSessionsForUser(userId: string): BrowserSessionHandle[] {
  return [...sessionRegistry.values()].filter((s) => s.userId === userId && !s.closed);
}

export function getRuntimeProviderName(): BrowserProvider {
  const p = (process.env.BROWSER_RUNTIME || "browserbase").toLowerCase();
  return p === "local" ? "local" : "browserbase";
}
