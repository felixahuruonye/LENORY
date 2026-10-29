/**
 * Local artifact store with disk-backed index.
 * Served via authenticated GET /api/assistant/artifacts/:id
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

const TTL_MS = 7 * 24 * 60 * 60 * 1000;
const ROOT = path.join(os.tmpdir(), "lenory-artifacts");
const INDEX_PATH = path.join(ROOT, "index.json");
const index = new Map<string, StoredArtifact>();
let loaded = false;

function ensureRoot() {
  if (!fs.existsSync(ROOT)) fs.mkdirSync(ROOT, { recursive: true });
}

function loadIndex() {
  if (loaded) return;
  loaded = true;
  try {
    ensureRoot();
    if (fs.existsSync(INDEX_PATH)) {
      const rows = JSON.parse(fs.readFileSync(INDEX_PATH, "utf8")) as StoredArtifact[];
      for (const row of rows) {
        if (row?.id && row.path) index.set(row.id, row);
      }
    }
  } catch (e) {
    console.warn("[artifactStore] load index failed", e);
  }
}

function persistIndex() {
  try {
    ensureRoot();
    fs.writeFileSync(INDEX_PATH, JSON.stringify([...index.values()]));
  } catch (e) {
    console.warn("[artifactStore] persist index failed", e);
  }
}

function prune() {
  const now = Date.now();
  let changed = false;
  for (const [id, art] of index.entries()) {
    if (art.expiresAt < now || !fs.existsSync(art.path)) {
      try {
        if (fs.existsSync(art.path)) fs.unlinkSync(art.path);
      } catch {}
      index.delete(id);
      changed = true;
    }
  }
  if (index.size > 2000) {
    const oldest = [...index.values()].sort((a, b) => a.createdAt - b.createdAt).slice(0, 200);
    for (const art of oldest) {
      try {
        fs.unlinkSync(art.path);
      } catch {}
      index.delete(art.id);
      changed = true;
    }
  }
  if (changed) persistIndex();
}

export function saveLocalArtifact(opts: {
  userId: string;
  fileName: string;
  mimeType: string;
  buffer: Buffer;
}): StoredArtifact {
  loadIndex();
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
  persistIndex();
  return art;
}

export function getLocalArtifact(id: string): StoredArtifact | null {
  loadIndex();
  const art = index.get(id);
  if (!art) return null;
  if (art.expiresAt < Date.now()) {
    try {
      fs.unlinkSync(art.path);
    } catch {}
    index.delete(id);
    persistIndex();
    return null;
  }
  if (!fs.existsSync(art.path)) {
    index.delete(id);
    persistIndex();
    return null;
  }
  return art;
}

export function readLocalArtifact(
  id: string,
  userId: string
): { art: StoredArtifact; buffer: Buffer } | null {
  const art = getLocalArtifact(id);
  if (!art || art.userId !== userId) return null;
  return { art, buffer: fs.readFileSync(art.path) };
}
