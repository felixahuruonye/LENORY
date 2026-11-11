/**
 * Search tools: the student's past chats and their notes / Knowledge Base / project files.
 * Hybrid ranking: keywords first (cheap, exact), then a meaning-based re-rank with Gemini embeddings.
 * If embeddings are unavailable the keyword result is still returned - search never fails because of them.
 */
import type { ToolContext, ToolResult } from "../types";
import { storage } from "../../storage";

const STOP = new Set("the a an and or of to in on for with is are was were be been it this that these those my me i you your we our at by from as about what how when where which who do does did can could should would will just please tell show find search".split(" "));
const tokens = (s: string) => (String(s).toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) || []).filter((t) => !STOP.has(t));

interface Chunk { text: string; title: string; where: string; when?: string; link: string; kind: string }

function keywordScore(chunk: string, q: string[], phrase: string): number {
  const low = chunk.toLowerCase();
  let score = 0;
  for (const t of q) { const m = low.split(t).length - 1; if (m) score += 1 + Math.min(m, 5) * 0.25; }
  if (phrase.length > 4 && low.includes(phrase)) score += 3;
  return q.length ? score / q.length : 0;
}

async function embed(texts: string[]): Promise<number[][] | null> {
  const key = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
  if (!key || !texts.length) return null;
  try {
    const r = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:batchEmbedContents", {
      method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({ requests: texts.map((t) => ({ model: "models/gemini-embedding-001", content: { parts: [{ text: t.slice(0, 700) }] }, outputDimensionality: 256 })) }),
      signal: AbortSignal.timeout(12_000),
    });
    if (!r.ok) return null;
    const d: any = await r.json();
    const v = (d.embeddings || []).map((e: any) => e.values as number[]);
    return v.length === texts.length ? v : null;
  } catch { return null; }
}
const cos = (a: number[], b: number[]) => { let d = 0, x = 0, y = 0; for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; x += a[i] * a[i]; y += b[i] * b[i]; } return d / (Math.sqrt(x) * Math.sqrt(y) || 1); };

/** Rank chunks for a query: keywords, then meaning. Returns the best `limit`. */
export async function rankChunks(chunks: Chunk[], query: string, limit = 6): Promise<{ chunk: Chunk; score: number; semantic: boolean }[]> {
  const q = tokens(query); const phrase = query.toLowerCase().trim();
  const scored = chunks.map((c, i) => ({ c, i, k: keywordScore(c.text + " " + c.title, q, phrase) }));
  // candidates: everything with a keyword hit, topped up with the newest chunks so meaning-only matches can still be found
  const hits = scored.filter((s) => s.k > 0).sort((a, b) => b.k - a.k).slice(0, 40);
  const pool = new Map<number, typeof scored[number]>(hits.map((h) => [h.i, h]));
  for (const s of scored.slice(0, 30)) if (pool.size < 40 && !pool.has(s.i)) pool.set(s.i, s);
  const cand = [...pool.values()];
  if (!cand.length) return [];
  const maxK = Math.max(...cand.map((c) => c.k), 1);
  const vecs = await embed([query, ...cand.map((c) => c.c.text)]);
  if (!vecs) return cand.filter((c) => c.k > 0).sort((a, b) => b.k - a.k).slice(0, limit).map((c) => ({ chunk: c.c, score: c.k, semantic: false }));
  const qv = vecs[0];
  return cand
    .map((c, n) => { const sem = Math.max(0, cos(qv, vecs[n + 1])); return { chunk: c.c, score: 0.45 * (c.k / maxK) + 0.55 * sem, semantic: true, sem, k: c.k }; })
    .filter((r) => r.k > 0 || r.sem > 0.55)
    .sort((a, b) => b.score - a.score).slice(0, limit);
}

const fmt = (rs: { chunk: Chunk; score: number }[], what: string) =>
  rs.map((r, i) => `[${i + 1}] ${r.chunk.kind}: ${r.chunk.title}${r.chunk.when ? ` (${r.chunk.when})` : ""}\n${r.chunk.where ? `Where: ${r.chunk.where}\n` : ""}Open: ${r.chunk.link}\n"${r.chunk.text.replace(/\s+/g, " ").slice(0, 520)}"`).join("\n\n")
  || `Nothing matching was found in ${what}.`;

export async function toolSearchPastChats(ctx: ToolContext, args: { query: string }): Promise<ToolResult> {
  const query = String(args?.query || "").trim();
  if (query.length < 2) return { tool: "search_past_chats", success: false, summary: "I need something to search for.", error: "EMPTY" };
  ctx.onStatus?.("searching_memory", query.slice(0, 50));
  try {
    const sessions = ((await storage.getChatSessionsByUser(ctx.userId)) || []).slice().sort((a: any, b: any) => String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt))).slice(0, 40);
    const chunks: Chunk[] = [];
    await Promise.all(sessions.map(async (s: any) => {
      if (s.id === ctx.sessionId) return; // current chat is already in context
      const msgs = (await storage.getChatMessagesBySession(s.id).catch(() => [])) as any[];
      for (const m of msgs.slice(-60)) {
        const text = String(m.content || "").trim();
        if (text.length < 12) continue;
        chunks.push({ text: text.slice(0, 1500), title: s.title || "Chat", where: m.role === "user" ? "You wrote" : "LENORY answered", when: new Date(m.createdAt || s.createdAt).toISOString().slice(0, 10), link: `/chat?sessionId=${s.id}`, kind: "Past chat" });
      }
    }));
    chunks.sort((a, b) => String(b.when).localeCompare(String(a.when)));
    const ranked = await rankChunks(chunks, query, 6);
    return { tool: "search_past_chats", success: true, summary: `Searched ${sessions.length} earlier chats (${ranked[0]?.semantic ? "keywords + meaning" : "keywords"}).\n\n${fmt(ranked, "your earlier chats")}\n\nQuote or summarise only what appears above and include the Open links.`, data: { hits: ranked.length } };
  } catch (e: any) { return { tool: "search_past_chats", success: false, summary: `Searching past chats failed: ${e?.message}`, error: "ERR" }; }
}

export async function toolSearchKnowledge(ctx: ToolContext, args: { query: string }): Promise<ToolResult> {
  const query = String(args?.query || "").trim();
  if (query.length < 2) return { tool: "search_knowledge_base", success: false, summary: "I need something to search for.", error: "EMPTY" };
  ctx.onStatus?.("searching_documents", query.slice(0, 50));
  try {
    const chunks: Chunk[] = [];
    const folders = ((await storage.getKBFolders(ctx.userId)) || []).slice(0, 40);
    await Promise.all(folders.map(async (f: any) => {
      const files = ((await storage.getKBFiles(f.id).catch(() => [])) || []) as any[];
      for (const file of files.slice(0, 40)) {
        const text = String(file.extracted_text || "").slice(0, 60_000);
        if (!text.trim()) continue;
        for (let i = 0; i < text.length; i += 900) {
          const part = text.slice(i, i + 1100);
          if (part.trim().length > 8) chunks.push({ text: part, title: file.name, where: `Folder: ${f.name}`, link: `/knowledge-base?folder=${f.id}`, kind: "Note/file" });
        }
      }
    }));
    try {
      for (const p of (await storage.getProjectsByUser(ctx.userId)) || []) for (const file of ((await storage.getFilesByProject(p.id)) || []).slice(0, 30)) {
        const text = String((file as any).content || "").slice(0, 40_000);
        for (let i = 0; i < text.length; i += 900) { const part = text.slice(i, i + 1100); if (part.trim().length > 8) chunks.push({ text: part, title: (file as any).name, where: `Project: ${p.name}`, link: "/projects", kind: "Project file" }); }
      }
    } catch {}
    if (!chunks.length) return { tool: "search_knowledge_base", success: true, summary: "The student has no readable notes or files yet, so there is nothing to search." };
    const ranked = await rankChunks(chunks, query, 6);
    return { tool: "search_knowledge_base", success: true, summary: `Searched ${chunks.length} passages from ${folders.length} folders and projects (${ranked[0]?.semantic ? "keywords + meaning" : "keywords"}).\n\n${fmt(ranked, "your notes and files")}\n\nAnswer only from these passages and mention which file each fact came from.`, data: { hits: ranked.length } };
  } catch (e: any) { return { tool: "search_knowledge_base", success: false, summary: `Searching notes failed: ${e?.message}`, error: "ERR" }; }
}
