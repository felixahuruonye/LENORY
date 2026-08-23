// server/routes/complaints.ts
// User complaints and feedback management

import type { Express, Request, Response } from "express";
import { supabaseAuth, type AuthenticatedRequest } from "../supabaseAuth";
import { supabaseDb } from "../db";
import { logAdminError } from "../adminTools";

const ADMIN_EMAIL = "felixahuruonye@gmail.com";

function isAdmin(req: AuthenticatedRequest): boolean {
  return req.user?.email === ADMIN_EMAIL;
}

export function registerComplaintsRoutes(app: Express): void {
  // ─── Submit a complaint/feedback (any authenticated user) ───────────────────
  app.post("/api/complaints", supabaseAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { message, category } = req.body;
      if (!message || typeof message !== "string") {
        return res.status(400).json({ message: "Message is required" });
      }

      if (!supabaseDb) {
        return res.status(500).json({ message: "Database not available" });
      }

      const { data, error } = await supabaseDb
        .from("user_complaints")
        .insert({
          user_id: req.user.id,
          user_email: req.user.email,
          message: message.slice(0, 2000),
          category: category || "general",
          status: "open",
        })
        .select()
        .single();

      if (error) throw error;
      res.status(201).json(data);
    } catch (err: any) {
      logAdminError("/api/complaints", err);
      res.status(500).json({ message: err.message || "Failed to submit complaint" });
    }
  });

  // ─── Get all complaints (admin only) ──────────────────────────────────────
  app.get("/api/admin/complaints", supabaseAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      if (!isAdmin(req)) {
        return res.status(403).json({ message: "Admin access required" });
      }

      if (!supabaseDb) {
        return res.status(500).json({ message: "Database not available" });
      }

      const { data, error } = await supabaseDb
        .from("user_complaints")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) throw error;
      res.json(data || []);
    } catch (err: any) {
      logAdminError("/api/admin/complaints", err);
      res.status(500).json({ message: err.message || "Failed to fetch complaints" });
    }
  });

  // ─── Update complaint status (admin only) ─────────────────────────────────
  app.patch("/api/admin/complaints/:id", supabaseAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      if (!isAdmin(req)) {
        return res.status(403).json({ message: "Admin access required" });
      }

      const { status, notes, engineeringTaskId } = req.body;
      const id = parseInt(req.params.id);

      if (!supabaseDb) {
        return res.status(500).json({ message: "Database not available" });
      }

      const updates: any = {};
      if (status) updates.status = status;
      if (notes !== undefined) updates.admin_notes = notes;
      if (engineeringTaskId !== undefined) updates.engineering_task_id = engineeringTaskId;

      const { data, error } = await supabaseDb
        .from("user_complaints")
        .update(updates)
        .eq("id", id)
        .select()
        .single();

      if (error) throw error;
      res.json(data);
    } catch (err: any) {
      logAdminError("/api/admin/complaints/:id", err);
      res.status(500).json({ message: err.message || "Failed to update complaint" });
    }
  });
}
