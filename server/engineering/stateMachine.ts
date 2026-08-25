// server/engineering/stateMachine.ts
// Engineering task state persistence using Supabase

import { supabaseDb } from "../db";
import type {
  EngineeringTask,
  EngineeringTaskEvent,
  EngineeringTaskStatus,
  EngineeringTaskEventType,
} from "./types";

const TASKS_TABLE = "engineering_tasks";
const EVENTS_TABLE = "engineering_task_events";

function generateTaskId(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  const random = Math.floor(Math.random() * 10000).toString().padStart(4, "0");
  return `eng_${year}${month}${day}_${random}`;
}

// ─── CamelCase ↔ Snake_case conversion helpers ─────────────────────────────

function taskToDb(task: Partial<EngineeringTask>): Record<string, any> {
  const map: Record<string, string> = {
    id: "id",
    request: "request",
    status: "status",
    createdAt: "created_at",
    updatedAt: "updated_at",
    adminId: "admin_id",
    adminEmail: "admin_email",
    baseCommit: "base_commit",
    branchName: "branch_name",
    prUrl: "pr_url",
    investigation: "investigation",
    rootCause: "root_cause",
    implementation: "implementation",
    testResults: "test_results",
    buildResult: "build_result",
    reviewResult: "review_result",
    riskAssessment: "risk_assessment",
    diff: "diff",
    errorLog: "error_log",
    sandboxPath: "sandbox_path",
    maxAttempts: "max_attempts",
    currentAttempt: "current_attempt",
    metadata: "metadata",
  };
  const result: Record<string, any> = {};
  for (const [key, value] of Object.entries(task)) {
    if (value !== undefined && map[key]) {
      result[map[key]] = value;
    }
  }
  return result;
}

function taskFromDb(row: Record<string, any>): EngineeringTask {
  return {
    id: row.id,
    request: row.request,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    adminId: row.admin_id,
    adminEmail: row.admin_email,
    baseCommit: row.base_commit,
    branchName: row.branch_name ?? null,
    prUrl: row.pr_url ?? null,
    investigation: row.investigation ?? null,
    rootCause: row.root_cause ?? null,
    implementation: row.implementation ?? null,
    testResults: row.test_results ?? null,
    buildResult: row.build_result ?? null,
    reviewResult: row.review_result ?? null,
    riskAssessment: row.risk_assessment ?? null,
    diff: row.diff ?? null,
    errorLog: row.error_log ?? null,
    sandboxPath: row.sandbox_path ?? null,
    maxAttempts: row.max_attempts ?? 5,
    currentAttempt: row.current_attempt ?? 0,
    metadata: row.metadata ?? {},
  };
}

function eventToDb(event: Partial<EngineeringTaskEvent>): Record<string, any> {
  const result: Record<string, any> = {};
  if (event.id !== undefined) result.id = event.id;
  if (event.taskId !== undefined) result.task_id = event.taskId;
  if (event.eventType !== undefined) result.event_type = event.eventType;
  if (event.actor !== undefined) result.actor = event.actor;
  if (event.message !== undefined) result.message = event.message;
  if (event.metadata !== undefined) result.metadata = event.metadata;
  if (event.createdAt !== undefined) result.created_at = event.createdAt;
  return result;
}

function eventFromDb(row: Record<string, any>): EngineeringTaskEvent {
  return {
    id: row.id,
    taskId: row.task_id,
    eventType: row.event_type,
    actor: row.actor,
    message: row.message,
    metadata: row.metadata ?? {},
    createdAt: row.created_at,
  };
}

// ─── Task CRUD ─────────────────────────────────────────────────────────────

export async function createTask(
  request: string,
  adminId: string,
  adminEmail: string,
  baseCommit: string
): Promise<EngineeringTask> {
  if (!supabaseDb) throw new Error("Supabase not available");

  const taskId = generateTaskId();
  const task: Omit<EngineeringTask, "id"> = {
    request,
    status: "received",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    adminId,
    adminEmail,
    baseCommit,
    branchName: null,
    prUrl: null,
    investigation: null,
    rootCause: null,
    implementation: null,
    testResults: null,
    buildResult: null,
    reviewResult: null,
    riskAssessment: null,
    diff: null,
    errorLog: null,
    sandboxPath: null,
    maxAttempts: 5,
    currentAttempt: 0,
    metadata: {},
  };

  const dbRecord = taskToDb({ ...task, id: taskId });

  const { data, error } = await supabaseDb
    .from(TASKS_TABLE)
    .insert(dbRecord)
    .select()
    .single();

  if (error) throw new Error(`Failed to create task: ${error.message}`);
  return taskFromDb(data);
}

export async function getTask(taskId: string): Promise<EngineeringTask | null> {
  if (!supabaseDb) return null;
  const { data, error } = await supabaseDb
    .from(TASKS_TABLE)
    .select("*")
    .eq("id", taskId)
    .single();
  if (error || !data) return null;
  return taskFromDb(data);
}

export async function updateTaskStatus(
  taskId: string,
  status: EngineeringTaskStatus,
  updates: Partial<EngineeringTask> = {}
): Promise<EngineeringTask> {
  if (!supabaseDb) throw new Error("Supabase not available");

  const dbRecord = taskToDb({ status, updatedAt: new Date().toISOString(), ...updates });

  const { data, error } = await supabaseDb
    .from(TASKS_TABLE)
    .update(dbRecord)
    .eq("id", taskId)
    .select()
    .single();

  if (error) throw new Error(`Failed to update task: ${error.message}`);
  return taskFromDb(data);
}

// ─── Events ────────────────────────────────────────────────────────────────

export async function logEvent(
  taskId: string,
  eventType: EngineeringTaskEventType,
  actor: string,
  message: string,
  metadata: Record<string, any> = {}
): Promise<void> {
  if (!supabaseDb) {
    console.log(`[ENGINEERING EVENT] ${taskId} | ${eventType} | ${actor}: ${message}`);
    return;
  }

  const event = eventToDb({
    taskId,
    eventType,
    actor,
    message,
    metadata,
    createdAt: new Date().toISOString(),
  });

  const { error } = await supabaseDb.from(EVENTS_TABLE).insert(event);
  if (error) {
    console.error("Failed to log engineering event:", error.message);
  }
}

export async function getTaskEvents(taskId: string): Promise<EngineeringTaskEvent[]> {
  if (!supabaseDb) return [];
  const { data, error } = await supabaseDb
    .from(EVENTS_TABLE)
    .select("*")
    .eq("task_id", taskId)
    .order("created_at", { ascending: true });
  if (error || !data) return [];
  return (data || []).map(eventFromDb);
}

export async function getAllTasks(limit = 50): Promise<EngineeringTask[]> {
  if (!supabaseDb) return [];
  const { data, error } = await supabaseDb
    .from(TASKS_TABLE)
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error || !data) return [];
  return (data || []).map(taskFromDb);
}

export async function getTasksByStatus(status: EngineeringTaskStatus): Promise<EngineeringTask[]> {
  if (!supabaseDb) return [];
  const { data, error } = await supabaseDb
    .from(TASKS_TABLE)
    .select("*")
    .eq("status", status)
    .order("created_at", { ascending: false });
  if (error || !data) return [];
  return (data || []).map(taskFromDb);
}

// ─── State Machine ─────────────────────────────────────────────────────────

export const VALID_TRANSITIONS: Record<EngineeringTaskStatus, EngineeringTaskStatus[]> = {
  idle: ["received"],
  received: ["planning", "failed"],
  planning: ["investigating", "failed"],
  investigating: ["sandbox_creating", "failed"],
  sandbox_creating: ["implementing", "failed"],
  implementing: ["testing", "failed"],
  testing: ["test_failed", "reviewing", "failed"],
  test_failed: ["debugging", "failed"],
  debugging: ["testing", "failed"],
  reviewing: ["ready_for_approval", "failed"],
  ready_for_approval: ["approved", "rejected", "failed"],
  approved: ["merging", "failed"],
  rejected: ["investigating", "failed"],
  merging: ["deploying", "failed"],
  deploying: ["verifying_deployment", "failed"],
  verifying_deployment: ["completed", "rolled_back", "failed"],
  completed: [],
  rolled_back: [],
  failed: ["investigating"],
};

export function canTransition(from: EngineeringTaskStatus, to: EngineeringTaskStatus): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) || false;
}

export async function transitionTask(
  taskId: string,
  toStatus: EngineeringTaskStatus,
  updates: Partial<EngineeringTask> = {}
): Promise<EngineeringTask> {
  const task = await getTask(taskId);
  if (!task) throw new Error(`Task ${taskId} not found`);
  if (!canTransition(task.status, toStatus)) {
    throw new Error(`Invalid transition: ${task.status} -> ${toStatus}`);
  }
  const updated = await updateTaskStatus(taskId, toStatus, updates);
  await logEvent(taskId, "state_transition", "system", `Transitioned from ${task.status} to ${toStatus}`, {
    from: task.status,
    to: toStatus,
  });
  return updated;
}
