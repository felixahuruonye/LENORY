/** Code sandbox + Project Workspace tools. Both act only for the signed-in student. */
import type { ToolContext, ToolResult } from "../types";
import { storage } from "../../storage";

// ── Code execution: ONLY through an isolated remote runner (Piston-compatible API).
// Running student/model code inside this web server would expose other users' data,
// so when CODE_SANDBOX_URL is not set the tool is simply not offered.
export const sandboxConfigured = () => !!process.env.CODE_SANDBOX_URL;
const LANGS: Record<string, string> = { python: "python", py: "python", javascript: "javascript", js: "javascript", node: "javascript", typescript: "typescript", ts: "typescript", java: "java", c: "c", cpp: "c++", "c++": "c++", go: "go", rust: "rust", ruby: "ruby", php: "php", bash: "bash", sql: "sqlite3" };

export async function toolRunCode(ctx: ToolContext, args: { language: string; code: string; stdin?: string }): Promise<ToolResult> {
  const language = LANGS[String(args?.language || "").toLowerCase()];
  const code = String(args?.code || "");
  if (!process.env.CODE_SANDBOX_URL) return { tool: "run_code", success: false, summary: "The code sandbox is not configured on this server, so nothing was run.", error: "NOT_CONFIGURED" };
  if (!language) return { tool: "run_code", success: false, summary: `Unsupported language. Use one of: ${Object.keys(LANGS).join(", ")}`, error: "UNSUPPORTED" };
  if (code.trim().length < 2 || code.length > 40_000) return { tool: "run_code", success: false, summary: "Code is empty or too large (max 40,000 characters).", error: "BAD_CODE" };
  ctx.onStatus?.("running_code", language);
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 25_000);
  try {
    const res = await fetch(`${process.env.CODE_SANDBOX_URL!.replace(/\/$/, "")}/api/v2/execute`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(process.env.CODE_SANDBOX_KEY ? { Authorization: process.env.CODE_SANDBOX_KEY } : {}) },
      body: JSON.stringify({ language, version: "*", files: [{ content: code }], stdin: String(args?.stdin || "").slice(0, 5000), run_timeout: 10_000, compile_timeout: 10_000, run_memory_limit: 256_000_000 }),
      signal: ctl.signal,
    });
    if (!res.ok) return { tool: "run_code", success: false, summary: `The sandbox returned an error (HTTP ${res.status}). Nothing was verified.`, error: `HTTP_${res.status}` };
    const d: any = await res.json();
    const out = String(d?.run?.stdout || "").slice(0, 6000);
    const err = String(d?.run?.stderr || d?.compile?.stderr || "").slice(0, 3000);
    const exit = d?.run?.code;
    return { tool: "run_code", success: true, summary: `Executed ${language} in the sandbox. Exit code: ${exit}.\nSTDOUT:\n${out || "(empty)"}${err ? `\nSTDERR:\n${err}` : ""}`, data: { exit } };
  } catch (e: any) {
    return { tool: "run_code", success: false, summary: e?.name === "AbortError" ? "The code run timed out." : `Sandbox unreachable: ${e?.message}`, error: e?.name === "AbortError" ? "TIMEOUT" : "UNREACHABLE" };
  } finally { clearTimeout(timer); }
}

// ── Project Workspace (uses the same storage methods as the Projects page) ──
async function ownProject(ctx: ToolContext, id: string) {
  const mine = await storage.getProjectsByUser(ctx.userId);
  return (mine || []).find((p: any) => p.id === id) || null;
}
export async function toolListProjects(ctx: ToolContext): Promise<ToolResult> {
  ctx.onStatus?.("using_feature", "Opening your projects");
  try {
    const list = await storage.getProjectsByUser(ctx.userId);
    if (!list?.length) return { tool: "project_list", success: true, summary: "The student has no projects yet." };
    const lines: string[] = [];
    for (const p of list.slice(0, 20)) {
      const [files, tasks] = await Promise.all([storage.getFilesByProject(p.id), storage.getTasksByProject(p.id)]);
      lines.push(`- ${p.name} (id: ${p.id}) - ${files?.length || 0} files, ${tasks?.length || 0} tasks${p.description ? ` - ${String(p.description).slice(0, 80)}` : ""}`);
    }
    return { tool: "project_list", success: true, summary: lines.join("\n") };
  } catch (e: any) { return { tool: "project_list", success: false, summary: "Could not read projects", error: e?.message }; }
}
export async function toolCreateProject(ctx: ToolContext, args: { name: string; description?: string }): Promise<ToolResult> {
  const name = String(args?.name || "").trim().slice(0, 120);
  if (!name) return { tool: "project_create", success: false, summary: "Project name is empty", error: "EMPTY" };
  ctx.onStatus?.("using_feature", `Creating project "${name}"`);
  try {
    const p = await storage.createProject({ userId: ctx.userId, name, description: String(args?.description || "").slice(0, 500) });
    if (!p?.id) return { tool: "project_create", success: false, summary: "The project was not created", error: "NOT_SAVED" };
    return { tool: "project_create", success: true, summary: `Project "${name}" created (id: ${p.id}). Open it at /projects.`, data: { id: p.id, name } };
  } catch (e: any) { return { tool: "project_create", success: false, summary: "Creating the project failed", error: e?.message }; }
}
export async function toolAddProjectFile(ctx: ToolContext, args: { projectId: string; name: string; content: string }): Promise<ToolResult> {
  const name = String(args?.name || "").trim().slice(0, 120); const content = String(args?.content || "");
  if (!name || !content.trim()) return { tool: "project_add_file", success: false, summary: "File name and content are required", error: "EMPTY" };
  ctx.onStatus?.("saving", `Adding ${name} to project`);
  try {
    if (!(await ownProject(ctx, args.projectId))) return { tool: "project_add_file", success: false, summary: "Project not found, or it does not belong to this student.", error: "NOT_FOUND" };
    const f = await storage.createFile({ projectId: args.projectId, name, content: content.slice(0, 200_000) });
    if (!f?.id) return { tool: "project_add_file", success: false, summary: "The file was not saved", error: "NOT_SAVED" };
    return { tool: "project_add_file", success: true, summary: `File "${name}" saved in the project (id: ${f.id}).` };
  } catch (e: any) { return { tool: "project_add_file", success: false, summary: "Saving the file failed", error: e?.message }; }
}
export async function toolAddProjectTask(ctx: ToolContext, args: { projectId: string; title: string }): Promise<ToolResult> {
  const title = String(args?.title || "").trim().slice(0, 200);
  if (!title) return { tool: "project_add_task", success: false, summary: "Task title is empty", error: "EMPTY" };
  ctx.onStatus?.("saving", "Adding task");
  try {
    if (!(await ownProject(ctx, args.projectId))) return { tool: "project_add_task", success: false, summary: "Project not found, or it does not belong to this student.", error: "NOT_FOUND" };
    const t = await storage.createTask({ projectId: args.projectId, title, status: "pending" });
    if (!t?.id) return { tool: "project_add_task", success: false, summary: "The task was not saved", error: "NOT_SAVED" };
    return { tool: "project_add_task", success: true, summary: `Task "${title}" added (id: ${t.id}).` };
  } catch (e: any) { return { tool: "project_add_task", success: false, summary: "Adding the task failed", error: e?.message }; }
}
