// Simple durable-enough in-process job queue for transcription / note jobs.
// Survives concurrent requests better than fire-and-forget; does NOT survive
// process restarts (use a Redis/BullMQ layer later for multi-instance).
// Caps concurrent heavy AI work so we stay under provider rate limits.

export type JobStatus = "queued" | "running" | "done" | "failed";

export interface JobRecord {
  id: string;
  type: string;
  userId: string;
  status: JobStatus;
  payload: any;
  result?: any;
  error?: string;
  createdAt: number;
  updatedAt: number;
  attempts: number;
}

const jobs = new Map<string, JobRecord>();
const queue: string[] = [];
const MAX_CONCURRENT = 2;
const MAX_JOBS_RETAINED = 500;
let running = 0;

type Handler = (job: JobRecord) => Promise<any>;
const handlers = new Map<string, Handler>();

export function registerJobHandler(type: string, handler: Handler) {
  handlers.set(type, handler);
}

function prune() {
  if (jobs.size <= MAX_JOBS_RETAINED) return;
  const sorted = [...jobs.values()].sort((a, b) => a.createdAt - b.createdAt);
  const drop = sorted.slice(0, jobs.size - MAX_JOBS_RETAINED);
  for (const j of drop) {
    if (j.status === "done" || j.status === "failed") jobs.delete(j.id);
  }
}

export function enqueueJob(type: string, userId: string, payload: any): JobRecord {
  const id = `job_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  const job: JobRecord = {
    id,
    type,
    userId,
    status: "queued",
    payload,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    attempts: 0,
  };
  jobs.set(id, job);
  queue.push(id);
  prune();
  setImmediate(pump);
  return job;
}

export function getJob(id: string): JobRecord | undefined {
  return jobs.get(id);
}

export function getUserJobs(userId: string, limit = 20): JobRecord[] {
  return [...jobs.values()]
    .filter((j) => j.userId === userId)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, limit);
}

export function getQueueStats() {
  const byStatus: Record<string, number> = { queued: 0, running: 0, done: 0, failed: 0 };
  for (const j of jobs.values()) byStatus[j.status] = (byStatus[j.status] || 0) + 1;
  return { ...byStatus, concurrent: running, maxConcurrent: MAX_CONCURRENT, queueLength: queue.length };
}

async function pump() {
  while (running < MAX_CONCURRENT && queue.length > 0) {
    const id = queue.shift();
    if (!id) break;
    const job = jobs.get(id);
    if (!job || job.status !== "queued") continue;
    running++;
    job.status = "running";
    job.updatedAt = Date.now();
    job.attempts += 1;
    const handler = handlers.get(job.type);
    if (!handler) {
      job.status = "failed";
      job.error = `No handler for job type ${job.type}`;
      job.updatedAt = Date.now();
      running--;
      continue;
    }
    handler(job)
      .then((result) => {
        job.result = result;
        job.status = "done";
        job.updatedAt = Date.now();
      })
      .catch((err: any) => {
        job.error = err?.message || String(err);
        job.status = "failed";
        job.updatedAt = Date.now();
      })
      .finally(() => {
        running--;
        setImmediate(pump);
      });
  }
}
