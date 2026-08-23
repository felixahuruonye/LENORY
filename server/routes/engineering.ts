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
} from "../engineering";
import { logAdminError } from "../adminTools";

const ADMIN_EMAIL = "felixahuruonye@gmail.com";

function isAdmin(req: AuthenticatedRequest): boolean {
  return req.user?.email === ADMIN_EMAIL;
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
        req.user.id,
        req.user.email
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
        req.user.id,
        req.user.email,
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
}
