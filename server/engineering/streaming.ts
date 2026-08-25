// server/engineering/streaming.ts
// Real-time event streaming for engineering tasks via SSE

import { EventEmitter } from "events";

export interface StreamEvent {
  type: "phase" | "model" | "log" | "error" | "complete" | "file" | "review" | "cooldown";
  taskId: string;
  timestamp: string;
  data: any;
}

class TaskStreamEmitter extends EventEmitter {
  emitEvent(event: StreamEvent): void {
    this.emit(event.taskId, event);
    this.emit("all", event);
  }
}

export const taskStream = new TaskStreamEmitter();

export function emitTaskEvent(
  taskId: string,
  type: StreamEvent["type"],
  data: any
): void {
  taskStream.emitEvent({
    type,
    taskId,
    timestamp: new Date().toISOString(),
    data,
  });
}

// Helper for common events
export function emitPhase(taskId: string, phase: string, message?: string): void {
  emitTaskEvent(taskId, "phase", { phase, message });
}

export function emitModel(taskId: string, role: string, model: string): void {
  emitTaskEvent(taskId, "model", { role, model });
}

export function emitLog(taskId: string, message: string, level: "info" | "warn" | "error" = "info"): void {
  emitTaskEvent(taskId, "log", { message, level });
}

export function emitError(taskId: string, error: string, phase?: string): void {
  emitTaskEvent(taskId, "error", { error, phase });
}

export function emitFile(taskId: string, path: string, action: "read" | "modified" | "created"): void {
  emitTaskEvent(taskId, "file", { path, action });
}

export function emitReview(taskId: string, reviewer: string, verdict: string, feedback: string): void {
  emitTaskEvent(taskId, "review", { reviewer, verdict, feedback });
}

export function emitComplete(taskId: string, status: string, result?: any): void {
  emitTaskEvent(taskId, "complete", { status, result });
}
