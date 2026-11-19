/**
 * Idle / max-duration session cleanup for LENORY ACTIONS.
 * Safe to call from web process interval or worker.
 */
import { supabaseDb } from "../db";
import { loadCostLimits } from "./costControl";
import { closeBrowserSessionForTask } from "./sessionManager";
import { updateTaskStatus, appendEvent } from "./taskService";

let cleanupRunning = false;

/**
 * Close browser sessions that exceeded idle or max duration.
 * Uses action_tasks.workflow_state.openedAt + lastActivityAt when present.
 */
export async function runIdleSessionCleanup(): Promise<{ closed: number; errors: string[] }> {
  if (cleanupRunning) return { closed: 0, errors: [] };
  cleanupRunning = true;
  const errors: string[] = [];
  let closed = 0;
  const limits = loadCostLimits();
  const now = Date.now();

  try {
    if (!supabaseDb) {
      return { closed: 0, errors: ["supabase unavailable"] };
    }
    const { data, error } = await supabaseDb
      .from("action_tasks")
      .select("id, user_id, browser_session_id, workflow_state, status, updated_at, created_at")
      .not("browser_session_id", "is", null)
      .in("status", ["running", "awaiting_human", "awaiting_approval", "starting"]);

    if (error) {
      errors.push(error.message);
      return { closed: 0, errors };
    }

    for (const row of data || []) {
      try {
        const ws = row.workflow_state || {};
        const openedAt = Date.parse(ws.openedAt || row.created_at || now);
        const lastAct = Date.parse(ws.lastActivityAt || row.updated_at || ws.openedAt || row.created_at || now);
        const ageSec = (now - openedAt) / 1000;
        const idleSec = (now - lastAct) / 1000;
        const expired =
          ageSec >= limits.maxSessionDurationSec || idleSec >= limits.idleTimeoutSec;
        if (!expired) continue;

        await closeBrowserSessionForTask(row.id, row.user_id);
        await updateTaskStatus(row.id, row.user_id, "timed_out", {
          error: ageSec >= limits.maxSessionDurationSec ? "max_session_duration" : "idle_timeout",
        });
        await appendEvent(row.id, row.user_id, "timeout", "Session closed by idle/max cleanup");
        closed++;
      } catch (e: any) {
        errors.push(`${row.id}: ${e?.message || e}`);
      }
    }
  } finally {
    cleanupRunning = false;
  }
  return { closed, errors };
}

/** Start periodic cleanup (call once from server bootstrap). */
export function startSessionCleanupInterval(everyMs = 60_000) {
  if (process.env.ACTIONS_DISABLE_CLEANUP === "1") return;
  const tick = () => {
    runIdleSessionCleanup()
      .then((r) => {
        if (r.closed || r.errors.length) {
          console.log("[actions-cleanup]", r);
        }
      })
      .catch((e) => console.warn("[actions-cleanup]", e?.message || e));
  };
  setInterval(tick, everyMs);
  // first run delayed so boot is not blocked
  setTimeout(tick, 15_000);
}
