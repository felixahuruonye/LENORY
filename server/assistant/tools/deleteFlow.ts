/**
 * Deleting is never done by the AI alone. The AI can only ASK: this creates a confirmation card
 * with a one-time token. The student presses Delete (or Cancel) and only then does the server act.
 */
import { randomBytes } from "crypto";
import type { ToolContext, ToolResult } from "../types";
import { storage } from "../../storage";

export type DeleteKind = "kb_file" | "kb_folder" | "project" | "project_file" | "project_task" | "memory_fact" | "image";
interface Pending { userId: string; kind: DeleteKind; id: string; name: string; expires: number }
const pending = new Map<string, Pending>();
const TTL = 15 * 60_000;
const sweep = () => { const n = Date.now(); for (const [k, v] of pending) if (v.expires < n) pending.delete(k); };
const ownsId = (userId: string, id: string) => String(id || "").split("_")[1] === userId;

/** Find the item AND prove it belongs to this student. Returns its display name, or null. */
async function verify(userId: string, kind: DeleteKind, id: string): Promise<string | null> {
  switch (kind) {
    case "kb_folder": { const f = ((await storage.getKBFolders(userId)) || []).find((x: any) => x.id === id); return f ? `Folder "${f.name}" and every file in it` : null; }
    case "kb_file": {
      for (const f of (await storage.getKBFolders(userId)) || []) { const file = ((await storage.getKBFiles(f.id)) || []).find((x: any) => x.id === id); if (file) return `File "${file.name}" (in folder "${f.name}")`; }
      return null;
    }
    case "project": { const p = ((await storage.getProjectsByUser(userId)) || []).find((x: any) => x.id === id); return p ? `Project "${p.name}" with all its files and tasks` : null; }
    case "project_file": { if (!ownsId(userId, id)) return null; for (const p of (await storage.getProjectsByUser(userId)) || []) { const f = ((await storage.getFilesByProject(p.id)) || []).find((x: any) => x.id === id); if (f) return `File "${(f as any).name}" in project "${p.name}"`; } return null; }
    case "project_task": { if (!ownsId(userId, id)) return null; for (const p of (await storage.getProjectsByUser(userId)) || []) { const t = ((await storage.getTasksByProject(p.id)) || []).find((x: any) => x.id === id); if (t) return `Task "${(t as any).title}" in project "${p.name}"`; } return null; }
    case "memory_fact": { const r: any = ((await storage.getMemoryEntriesByUser(userId)) || []).find((x: any) => x.id === id && x.type === "user_fact"); return r ? `Memory: "${String(r.data?.text || "").slice(0, 80)}"` : null; }
    case "image": { const r: any = ((await storage.getGeneratedImagesByUser(userId)) || []).find((x: any) => x.id === id); return r ? `Image: "${String(r.prompt || "").slice(0, 60)}"` : null; }
  }
}

export async function toolRequestDelete(ctx: ToolContext, args: { kind: string; id: string }): Promise<ToolResult> {
  sweep();
  const kind = args?.kind as DeleteKind; const id = String(args?.id || "");
  if (!["kb_file", "kb_folder", "project", "project_file", "project_task", "memory_fact", "image"].includes(kind) || !id) return { tool: "request_delete", success: false, summary: "Say what to delete: kind (kb_file, kb_folder, project, project_file, project_task, memory_fact, image) and its id (look it up first with the list or search tools).", error: "BAD_ARGS" };
  const name = await verify(ctx.userId, kind, id).catch(() => null);
  if (!name) return { tool: "request_delete", success: false, summary: "I could not find that item in this student's account, so nothing can be deleted.", error: "NOT_FOUND" };
  const token = randomBytes(16).toString("hex");
  pending.set(token, { userId: ctx.userId, kind, id, name, expires: Date.now() + TTL });
  return {
    tool: "request_delete", success: true,
    summary: `A confirmation card is now showing in the chat for: ${name}. NOTHING has been deleted. Tell the student, in one short sentence, that deleting is permanent and cannot be undone, and that they must press Delete on the card to go ahead. Do not say it is deleted.`,
    confirmations: [{ token, kind, name, warning: "This will be permanently deleted and cannot be retrieved." }],
  };
}

export async function executeConfirmedDelete(userId: string, token: string, confirm: boolean): Promise<{ ok: boolean; message: string }> {
  sweep();
  const p = pending.get(String(token));
  if (!p || p.userId !== userId) return { ok: false, message: "This confirmation expired or is not yours. Ask LENORY again." };
  pending.delete(String(token)); // one use only
  if (!confirm) return { ok: true, message: "Cancelled. Nothing was deleted." };
  try {
    if (!(await verify(userId, p.kind, p.id))) return { ok: false, message: "That item no longer exists." };
    switch (p.kind) {
      case "kb_folder": await storage.deleteKBFolder(p.id); break;
      case "kb_file": await storage.deleteKBFile(p.id); break;
      case "project": await storage.deleteProject(p.id); break;
      case "project_file": await storage.deleteFile(p.id); break;
      case "project_task": await storage.deleteTask(p.id); break;
      case "memory_fact": if (!(await storage.deleteMemoryEntry(userId, p.id))) return { ok: false, message: "Could not delete that memory." }; break;
      case "image": await storage.deleteGeneratedImage(userId, p.id); break;
    }
    return { ok: true, message: `Deleted: ${p.name}.` };
  } catch (e: any) { return { ok: false, message: `Delete failed: ${e?.message || "error"}` }; }
}
