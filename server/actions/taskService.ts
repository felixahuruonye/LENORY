/**
 * Durable LENORY ACTIONS task store.
 * Uses Supabase tables when available; falls back to in-memory for local/dev
 * so the feature still degrades gracefully without migrations applied.
 *
 * Run supabase_actions_migration.sql on your Supabase project for production.
 */
import { randomUUID } from "crypto";
import { supabaseDb } from "../db";

export type ActionTaskStatus =
  | "queued"
  | "starting"
  | "running"
  | "awaiting_approval"
  | "awaiting_human"
  | "completed"
  | "failed"
  | "cancelled"
  | "timed_out";

export interface ActionTask {
  id: string;
  userId: string;
  sessionId: string | null;
  description: string;
  status: ActionTaskStatus;
  tool: string;
  payload: any;
  result: any;
  error: string | null;
  leaseOwner: string | null;
  leaseUntil: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  /** browserbase | local */
  browserProvider: string | null;
  browserSessionId: string | null;
  workflowState: any;
}

export interface ActionEvent {
  id: string;
  taskId: string;
  userId: string;
  status: string;
  detail: string | null;
  createdAt: string;
}

export interface ActionArtifact {
  id: string;
  taskId: string;
  userId: string;
  kind: string;
  path: string;
  publicUrl: string | null;
  mimeType: string | null;
  createdAt: string;
}

const memTasks = new Map<string, ActionTask>();
const memEvents = new Map<string, ActionEvent[]>();
const memArtifacts = new Map<string, ActionArtifact[]>();

function nowIso() {
  return new Date().toISOString();
}

export async function createActionTask(input: {
  userId: string;
  sessionId?: string | null;
  description: string;
  tool: string;
  payload: any;
}): Promise<ActionTask> {
  const task: ActionTask = {
    id: randomUUID(),
    userId: input.userId,
    sessionId: input.sessionId || null,
    description: input.description.slice(0, 2000),
    status: "queued",
    tool: input.tool,
    payload: input.payload || {},
    result: null,
    error: null,
    leaseOwner: null,
    leaseUntil: null,
    createdAt: nowIso(),
    startedAt: null,
    completedAt: null,
    browserProvider: null,
    browserSessionId: null,
    workflowState: null,
  };

  if (supabaseDb) {
    try {
      const { error } = await supabaseDb.from("action_tasks").insert({
        id: task.id,
        user_id: task.userId,
        session_id: task.sessionId,
        description: task.description,
        status: task.status,
        tool: task.tool,
        payload: task.payload,
        result: null,
        error: null,
        created_at: task.createdAt,
      });
      if (error) throw error;
      await appendEvent(task.id, task.userId, "queued", "Task created");
      return task;
    } catch (e: any) {
      console.warn("[actions] Supabase create failed, using memory:", e?.message);
    }
  }

  memTasks.set(task.id, task);
  memEvents.set(task.id, []);
  memArtifacts.set(task.id, []);
  await appendEvent(task.id, task.userId, "queued", "Task created (memory)");
  return task;
}

export async function getActionTask(taskId: string, userId?: string): Promise<ActionTask | null> {
  if (supabaseDb) {
    try {
      let q = supabaseDb.from("action_tasks").select("*").eq("id", taskId);
      if (userId) q = q.eq("user_id", userId);
      const { data, error } = await q.maybeSingle();
      if (error) throw error;
      if (data) return rowToTask(data);
    } catch (e: any) {
      console.warn("[actions] get task failed:", e?.message);
    }
  }
  const t = memTasks.get(taskId);
  if (!t) return null;
  if (userId && t.userId !== userId) return null;
  return t;
}

export async function listUserTasks(userId: string, limit = 30): Promise<ActionTask[]> {
  if (supabaseDb) {
    try {
      const { data, error } = await supabaseDb
        .from("action_tasks")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) throw error;
      return (data || []).map(rowToTask);
    } catch (e: any) {
      console.warn("[actions] list tasks failed:", e?.message);
    }
  }
  return [...memTasks.values()]
    .filter((t) => t.userId === userId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit);
}

export async function updateTaskStatus(
  taskId: string,
  userId: string,
  status: ActionTaskStatus,
  patch: Partial<{ result: any; error: string | null; startedAt: string; completedAt: string }> = {}
): Promise<void> {
  if (supabaseDb) {
    try {
      const row: any = { status, updated_at: nowIso() };
      if (patch.result !== undefined) row.result = patch.result;
      if (patch.error !== undefined) row.error = patch.error;
      if (patch.startedAt) row.started_at = patch.startedAt;
      if (patch.completedAt) row.completed_at = patch.completedAt;
      if (status === "starting" || status === "running") row.started_at = row.started_at || nowIso();
      if (["completed", "failed", "cancelled", "timed_out"].includes(status)) {
        row.completed_at = row.completed_at || nowIso();
      }
      await supabaseDb.from("action_tasks").update(row).eq("id", taskId).eq("user_id", userId);
    } catch (e: any) {
      console.warn("[actions] update status failed:", e?.message);
    }
  }
  const t = memTasks.get(taskId);
  if (t && t.userId === userId) {
    t.status = status;
    if (patch.result !== undefined) t.result = patch.result;
    if (patch.error !== undefined) t.error = patch.error;
    if (status === "starting" || status === "running") t.startedAt = t.startedAt || nowIso();
    if (["completed", "failed", "cancelled", "timed_out"].includes(status)) {
      t.completedAt = t.completedAt || nowIso();
    }
  }
  await appendEvent(taskId, userId, status, patch.error || status);
}

/**
 * Atomic-ish claim: only claim if still queued (or lease expired).
 * Uses lease columns when Supabase is available.
 */
export async function claimNextTask(workerId: string, leaseSeconds = 180): Promise<ActionTask | null> {
  if (supabaseDb) {
    try {
      const now = nowIso();
      // Fetch candidates then claim one (Supabase JS lacks FOR UPDATE SKIP LOCKED;
      // lease_until check reduces double-runs across workers).
      const { data: candidates } = await supabaseDb
        .from("action_tasks")
        .select("*")
        .eq("status", "queued")
        .order("created_at", { ascending: true })
        .limit(5);
      for (const row of candidates || []) {
        const leaseUntil = new Date(Date.now() + leaseSeconds * 1000).toISOString();
        const { data: claimed, error } = await supabaseDb
          .from("action_tasks")
          .update({
            status: "starting",
            lease_owner: workerId,
            lease_until: leaseUntil,
            started_at: now,
            updated_at: now,
          })
          .eq("id", row.id)
          .eq("status", "queued")
          .select("*")
          .maybeSingle();
        if (!error && claimed) {
          const task = rowToTask(claimed);
          await appendEvent(task.id, task.userId, "starting", `Claimed by ${workerId}`);
          return task;
        }
      }
      return null;
    } catch (e: any) {
      console.warn("[actions] claim failed:", e?.message);
    }
  }

  // Memory fallback — single process only
  for (const t of memTasks.values()) {
    if (t.status === "queued") {
      t.status = "starting";
      t.leaseOwner = workerId;
      t.startedAt = nowIso();
      await appendEvent(t.id, t.userId, "starting", `Claimed by ${workerId}`);
      return t;
    }
  }
  return null;
}

export async function appendEvent(taskId: string, userId: string, status: string, detail?: string) {
  const ev: ActionEvent = {
    id: randomUUID(),
    taskId,
    userId,
    status,
    detail: detail || null,
    createdAt: nowIso(),
  };
  if (supabaseDb) {
    try {
      await supabaseDb.from("action_events").insert({
        id: ev.id,
        task_id: taskId,
        user_id: userId,
        status,
        detail: detail || null,
        created_at: ev.createdAt,
      });
    } catch {
      /* table may not exist yet */
    }
  }
  const list = memEvents.get(taskId) || [];
  list.push(ev);
  memEvents.set(taskId, list);
}

export async function listEvents(taskId: string, userId: string): Promise<ActionEvent[]> {
  if (supabaseDb) {
    try {
      const { data } = await supabaseDb
        .from("action_events")
        .select("*")
        .eq("task_id", taskId)
        .eq("user_id", userId)
        .order("created_at", { ascending: true });
      return (data || []).map((r: any) => ({
        id: r.id,
        taskId: r.task_id,
        userId: r.user_id,
        status: r.status,
        detail: r.detail,
        createdAt: r.created_at,
      }));
    } catch {
      /* fall through */
    }
  }
  return (memEvents.get(taskId) || []).filter((e) => e.userId === userId);
}

export async function addArtifact(input: {
  taskId: string;
  userId: string;
  kind: string;
  path: string;
  publicUrl?: string | null;
  mimeType?: string | null;
}): Promise<ActionArtifact> {
  const art: ActionArtifact = {
    id: randomUUID(),
    taskId: input.taskId,
    userId: input.userId,
    kind: input.kind,
    path: input.path,
    publicUrl: input.publicUrl || null,
    mimeType: input.mimeType || null,
    createdAt: nowIso(),
  };
  if (supabaseDb) {
    try {
      await supabaseDb.from("action_artifacts").insert({
        id: art.id,
        task_id: art.taskId,
        user_id: art.userId,
        kind: art.kind,
        path: art.path,
        public_url: art.publicUrl,
        mime_type: art.mimeType,
        created_at: art.createdAt,
      });
    } catch {
      /* optional */
    }
  }
  const list = memArtifacts.get(input.taskId) || [];
  list.push(art);
  memArtifacts.set(input.taskId, list);
  return art;
}

export async function listArtifacts(taskId: string, userId: string): Promise<ActionArtifact[]> {
  if (supabaseDb) {
    try {
      const { data } = await supabaseDb
        .from("action_artifacts")
        .select("*")
        .eq("task_id", taskId)
        .eq("user_id", userId);
      return (data || []).map((r: any) => ({
        id: r.id,
        taskId: r.task_id,
        userId: r.user_id,
        kind: r.kind,
        path: r.path,
        publicUrl: r.public_url,
        mimeType: r.mime_type,
        createdAt: r.created_at,
      }));
    } catch {
      /* fall through */
    }
  }
  return (memArtifacts.get(taskId) || []).filter((a) => a.userId === userId);
}

function rowToTask(r: any): ActionTask {
  return {
    id: r.id,
    userId: r.user_id,
    sessionId: r.session_id,
    description: r.description,
    status: r.status,
    tool: r.tool,
    payload: r.payload,
    result: r.result,
    error: r.error,
    leaseOwner: r.lease_owner,
    leaseUntil: r.lease_until,
    createdAt: r.created_at,
    startedAt: r.started_at,
    completedAt: r.completed_at,
    browserProvider: r.browser_provider ?? null,
    browserSessionId: r.browser_session_id ?? null,
    workflowState: r.workflow_state ?? null,
  };
}

/** Attach browser session metadata to a task (pause/resume support). */
export async function attachBrowserSession(
  taskId: string,
  userId: string,
  info: { provider: string; browserSessionId: string; workflowState?: any }
): Promise<void> {
  if (supabaseDb) {
    try {
      await supabaseDb
        .from("action_tasks")
        .update({
          browser_provider: info.provider,
          browser_session_id: info.browserSessionId,
          workflow_state: info.workflowState ?? null,
          updated_at: nowIso(),
        })
        .eq("id", taskId)
        .eq("user_id", userId);
    } catch (e: any) {
      console.warn("[actions] attachBrowserSession:", e?.message);
    }
  }
  const t = memTasks.get(taskId);
  if (t && t.userId === userId) {
    t.browserProvider = info.provider;
    t.browserSessionId = info.browserSessionId;
    if (info.workflowState !== undefined) t.workflowState = info.workflowState;
  }
}

export async function setWorkflowState(taskId: string, userId: string, state: any): Promise<void> {
  if (supabaseDb) {
    try {
      await supabaseDb
        .from("action_tasks")
        .update({ workflow_state: state, updated_at: nowIso() })
        .eq("id", taskId)
        .eq("user_id", userId);
    } catch {}
  }
  const t = memTasks.get(taskId);
  if (t && t.userId === userId) t.workflowState = state;
}
