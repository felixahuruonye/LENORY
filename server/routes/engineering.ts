// server/routes/engineering.ts
// Engineering Agent API routes

import type { Express, Request, Response } from "express";
import { supabaseAuth, type AuthenticatedRequest } from "../supabaseAuth";
import {
  submitEngineeringRequest,
  approveTask,
  getAllTasks,
  getTask,
  getTaskEvents,
  deleteTask,
} from "../engineering";
import { logAdminError } from "../adminTools";

const ADMIN_EMAIL = "felixahuruonye@gmail.com";

function isAdmin(req: AuthenticatedRequest): boolean {
  return req.userEmail === ADMIN_EMAIL;
}

export function registerEngineeringRoutes(app: Express): void {
  // ─── Create Engineering Task ─────────────────────────────────────────────
  app.post("/api/engineering/tasks", supabaseAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      if (!isAdmin(req)) {
        return res.status(403).json({ message: "Admin access required" });
      }

      const { request } = req.body;
      if (!request || typeof request !== "string") {
        return res.status(400).json({ message: "Request text is required" });
      }

      const task = await submitEngineeringRequest(
        request,
        req.userId,
        req.userEmail
      );

      res.status(201).json(task);
    } catch (err: any) {
      logAdminError("/api/engineering/tasks", err);
      res.status(500).json({ message: err.message || "Failed to create task" });
    }
  });

  // ─── Get All Tasks ────────────────────────────────────────────────────────
  app.get("/api/engineering/tasks", supabaseAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      if (!isAdmin(req)) {
        return res.status(403).json({ message: "Admin access required" });
      }

      const tasks = await getAllTasks(100);
      res.json(tasks);
    } catch (err: any) {
      logAdminError("/api/engineering/tasks", err);
      res.status(500).json({ message: err.message || "Failed to fetch tasks" });
    }
  });

  // ─── Get Single Task ──────────────────────────────────────────────────────
  app.get("/api/engineering/tasks/:taskId", supabaseAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      if (!isAdmin(req)) {
        return res.status(403).json({ message: "Admin access required" });
      }

      const task = await getTask(req.params.taskId);
      if (!task) {
        return res.status(404).json({ message: "Task not found" });
      }

      res.json(task);
    } catch (err: any) {
      logAdminError("/api/engineering/tasks/:taskId", err);
      res.status(500).json({ message: err.message || "Failed to fetch task" });
    }
  });

  // ─── Get Task Events ────────────────────────────────────────────────────
  app.get("/api/engineering/tasks/:taskId/events", supabaseAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      if (!isAdmin(req)) {
        return res.status(403).json({ message: "Admin access required" });
      }

      const events = await getTaskEvents(req.params.taskId);
      res.json(events);
    } catch (err: any) {
      logAdminError("/api/engineering/tasks/:taskId/events", err);
      res.status(500).json({ message: err.message || "Failed to fetch events" });
    }
  });

  // ─── Approve / Reject Task ──────────────────────────────────────────────
  app.post("/api/engineering/tasks/:taskId/approve", supabaseAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      if (!isAdmin(req)) {
        return res.status(403).json({ message: "Admin access required" });
      }

      const { approved, notes } = req.body;
      if (typeof approved !== "boolean") {
        return res.status(400).json({ message: "approved (boolean) is required" });
      }

      const task = await approveTask(
        req.params.taskId,
        approved,
        req.userId,
        req.userEmail,
        notes
      );

      res.json(task);
    } catch (err: any) {
      logAdminError("/api/engineering/tasks/:taskId/approve", err);
      res.status(500).json({ message: err.message || "Failed to process approval" });
    }
  });

  // ─── Get Model Configuration ────────────────────────────────────────────
  app.get("/api/engineering/models", supabaseAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      if (!isAdmin(req)) {
        return res.status(403).json({ message: "Admin access required" });
      }

      const { getModelConfig } = await import("../engineering/modelRouter");
      res.json(getModelConfig());
    } catch (err: any) {
      logAdminError("/api/engineering/models", err);
      res.status(500).json({ message: err.message || "Failed to fetch model config" });
    }
  });

  // ─── SSE STREAMING ───────────────────────────────────────────────────────
  app.get("/api/engineering/tasks/:taskId/stream", supabaseAuth, async (req: AuthenticatedRequest, res: Response) => {
    const { taskId } = req.params;

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");

    const sendEvent = (event: any) => {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    sendEvent({ type: "connected", taskId, timestamp: new Date().toISOString() });

    const listener = (event: any) => {
      if (event.taskId === taskId) {
        sendEvent(event);
      }
    };

    taskStream.on("all", listener);

    const heartbeat = setInterval(() => {
      sendEvent({ type: "heartbeat", taskId, timestamp: new Date().toISOString() });
    }, 15000);

    req.on("close", () => {
      clearInterval(heartbeat);
      taskStream.off("all", listener);
      res.end();
    });

    req.on("error", () => {
      clearInterval(heartbeat);
      taskStream.off("all", listener);
      res.end();
    });
  });

  // ─── DELETE TASK ─────────────────────────────────────────────────────────
  app.delete("/api/engineering/tasks/:taskId", supabaseAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      if (!isAdmin(req)) {
        return res.status(403).json({ message: "Admin access required" });
      }

      const { taskId } = req.params;
      await deleteTask(taskId);
      res.json({ success: true, message: "Task deleted" });
    } catch (err: any) {
      logAdminError("DELETE /api/engineering/tasks/:taskId", err);
      res.status(500).json({ message: err.message || "Failed to delete task" });
    }
  });

  // ─── PROVIDER STATS ──────────────────────────────────────────────────────
  app.get("/api/engineering/provider", supabaseAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      if (!isAdmin(req)) {
        return res.status(403).json({ message: "Admin access required" });
      }
      const balance = await getDeepSeekBalance();
      const config = getDeepSeekModelConfig();
      res.json({ balance, config, usage: getUsageHistory(), totalCost: getTotalCost() });
    } catch (err: any) {
      logAdminError("/api/engineering/provider", err);
      res.status(500).json({ message: err.message || "Failed to fetch provider stats" });
    }
  });
}
