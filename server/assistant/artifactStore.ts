/**
 * Local durable-enough artifact store used when Supabase Storage is unavailable.
 * Files live under os.tmpdir() and are served via authenticated GET /api/assistant/artifacts/:id
 */
import fs from "fs";
import path from "path";
import os from "os";
import { randomBytes } from "crypto";

export interface StoredArtifact {
  id: string;
  userId: string;
  fileName: string;
  mimeType: string;
  size: number;
  path: string;
  createdAt: number;
  expiresAt: number;
}

const TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const ROOT = path.join(os.tmpdir(), "lenory-artifacts");
const index = new Map<string, StoredArtifact>();

function ensureRoot() {
  if (!fs.existsSync(ROOT)) fs.mkdirSync(ROOT, { recursive: true });
}

function prune() {
  const now = Date.now();
  for (const [id, art] of index.entries()) {
    if (art.expiresAt < now) {
      try { fs.unlinkSync(art.path); } catch {}
      index.delete(id);
    }
  }
  // Cap map size
  if (index.size > 2000) {
    const oldest = [...index.values()].sort((a, b) => a.createdAt - b.createdAt).slice(0, 200);
    for (const art of oldest) {
      try { fs.unlinkSync(art.path); } catch {}
      index.delete(art.id);
    }
  }
}

export function saveLocalArtifact(opts: {
  userId: string;
  fileName: string;
  mimeType: string;
  buffer: Buffer;
}): StoredArtifact {
  ensureRoot();
  prune();
  const id = `laf_${Date.now()}_${randomBytes(6).toString("hex")}`;
  const safe = opts.fileName.replace(/[^\w.\-]+/g, "_").slice(0, 100);
  const filePath = path.join(ROOT, `${id}_${safe}`);
  fs.writeFileSync(filePath, opts.buffer);
  const art: StoredArtifact = {
    id,
    userId: opts.userId,
    fileName: opts.fileName,
    mimeType: opts.mimeType,
    size: opts.buffer.length,
    path: filePath,
    createdAt: Date.now(),
    expiresAt: Date.now() + TTL_MS,
  };
  index.set(id, art);
  return art;
}

export function getLocalArtifact(id: string): StoredArtifact | null {
  const art = index.get(id);
  if (!art) return null;
  if (art.expiresAt < Date.now()) {
    try { fs.unlinkSync(art.path); } catch {}
    index.delete(id);
    return null;
  }
  if (!fs.existsSync(art.path)) {
    index.delete(id);
    return null;
  }
  return art;
}

export function readLocalArtifact(id: string, userId: string): { art: StoredArtifact; buffer: Buffer } | null {
  const art = getLocalArtifact(id);
  if (!art || art.userId !== userId) return null;
  return { art, buffer: fs.readFileSync(art.path) };
}
