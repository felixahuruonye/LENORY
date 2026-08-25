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

  const { data, error } = await supabaseDb
    .from(TASKS_TABLE)
    .insert({ ...task, id: taskId })
    .select()
    .single();

  if (error) throw new Error(`Failed to create task: ${error.message}`);
  return data as EngineeringTask;
}

export async function getTask(taskId: string): Promise<EngineeringTask | null> {
  if (!supabaseDb) return null;
  const { data, error } = await supabaseDb
    .from(TASKS_TABLE)
    .select("*")
    .eq("id", taskId)
    .single();
  if (error) return null;
  return data as EngineeringTask;
}

export async function updateTaskStatus(
  taskId: string,
  status: EngineeringTaskStatus,
  updates: Partial<EngineeringTask> = {}
): Promise<EngineeringTask> {
  if (!supabaseDb) throw new Error("Supabase not available");

  const { data, error } = await supabaseDb
    .from(TASKS_TABLE)
    .update({
      status,
      updatedAt: new Date().toISOString(),
      ...updates,
    })
    .eq("id", taskId)
    .select()
    .single();

  if (error) throw new Error(`Failed to update task: ${error.message}`);
  return data as EngineeringTask;
}

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

  const event = {
    taskId,
    eventType,
    actor,
    message,
    metadata,
    createdAt: new Date().toISOString(),
  };

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
    .eq("taskId", taskId)
    .order("createdAt", { ascending: true });
  if (error) return [];
  return (data || []) as EngineeringTaskEvent[];
}

export async function getAllTasks(limit = 50): Promise<EngineeringTask[]> {
  if (!supabaseDb) return [];
  const { data, error } = await supabaseDb
    .from(TASKS_TABLE)
    .select("*")
    .order("createdAt", { ascending: false })
    .limit(limit);
  if (error) return [];
  return (data || []) as EngineeringTask[];
}

export async function getTasksByStatus(status: EngineeringTaskStatus): Promise<EngineeringTask[]> {
  if (!supabaseDb) return [];
  const { data, error } = await supabaseDb
    .from(TASKS_TABLE)
    .select("*")
    .eq("status", status)
    .order("createdAt", { ascending: false });
  if (error) return [];
  return (data || []) as EngineeringTask[];
}

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
