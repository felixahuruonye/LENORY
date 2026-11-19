/**
 * Local-first temporary screenshot storage for LENORY ACTIONS (IndexedDB).
 * Screenshot binaries stay on device; Supabase only holds metadata.
 */

const DB_NAME = "lenory-actions-screenshots";
const STORE = "shots";
const DB_VERSION = 1;

/** Default retention: 7 days */
const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_MAX_ENTRIES = 80;

export interface LocalScreenshot {
  id: string;
  taskId: string;
  createdAt: number;
  mimeType: string;
  /** Blob stored in IDB */
  blob?: Blob;
  /** Only for in-memory preview after load */
  objectUrl?: string;
  label?: string;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB not available"));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error || new Error("IDB open failed"));
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const os = db.createObjectStore(STORE, { keyPath: "id" });
        os.createIndex("taskId", "taskId", { unique: false });
        os.createIndex("createdAt", "createdAt", { unique: false });
      }
    };
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error("aborted"));
  });
}

export async function saveScreenshot(input: {
  taskId: string;
  bytes: ArrayBuffer | Blob;
  mimeType?: string;
  label?: string;
}): Promise<LocalScreenshot> {
  const mimeType = input.mimeType || "image/png";
  const blob =
    input.bytes instanceof Blob ? input.bytes : new Blob([input.bytes], { type: mimeType });
  const record: LocalScreenshot = {
    id: `shot_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    taskId: input.taskId,
    createdAt: Date.now(),
    mimeType,
    blob,
    label: input.label,
  };
  const db = await openDb();
  const tx = db.transaction(STORE, "readwrite");
  tx.objectStore(STORE).put(record);
  await txDone(tx);
  db.close();
  await pruneExpired();
  return record;
}

export async function listScreenshots(taskId?: string): Promise<LocalScreenshot[]> {
  const db = await openDb();
  const tx = db.transaction(STORE, "readonly");
  const store = tx.objectStore(STORE);
  const rows: LocalScreenshot[] = await new Promise((resolve, reject) => {
    const req = taskId ? store.index("taskId").getAll(taskId) : store.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
  await txDone(tx);
  db.close();
  return rows.sort((a, b) => b.createdAt - a.createdAt);
}

export async function getScreenshotObjectUrl(id: string): Promise<string | null> {
  const db = await openDb();
  const tx = db.transaction(STORE, "readonly");
  const row: LocalScreenshot | undefined = await new Promise((resolve, reject) => {
    const req = tx.objectStore(STORE).get(id);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  await txDone(tx);
  db.close();
  if (!row?.blob) return null;
  return URL.createObjectURL(row.blob);
}

export async function downloadScreenshot(id: string, fileName?: string): Promise<boolean> {
  const url = await getScreenshotObjectUrl(id);
  if (!url) return false;
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName || `lenory-screenshot-${id}.png`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
  return true;
}

export async function pruneExpired(
  ttlMs = DEFAULT_TTL_MS,
  maxEntries = DEFAULT_MAX_ENTRIES
): Promise<number> {
  const db = await openDb();
  const tx = db.transaction(STORE, "readwrite");
  const store = tx.objectStore(STORE);
  const all: LocalScreenshot[] = await new Promise((resolve, reject) => {
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
  const cutoff = Date.now() - ttlMs;
  const sorted = all.sort((a, b) => b.createdAt - a.createdAt);
  let removed = 0;
  sorted.forEach((row, i) => {
    if (row.createdAt < cutoff || i >= maxEntries) {
      store.delete(row.id);
      removed++;
    }
  });
  await txDone(tx);
  db.close();
  return removed;
}

/** Accept base64 data URL or raw base64 from API and store locally. */
export async function saveScreenshotFromBase64(
  taskId: string,
  base64OrDataUrl: string,
  mimeType = "image/png",
  label?: string
): Promise<LocalScreenshot | null> {
  try {
    let b64 = base64OrDataUrl;
    let mime = mimeType;
    const m = /^data:([^;]+);base64,(.+)$/i.exec(base64OrDataUrl);
    if (m) {
      mime = m[1];
      b64 = m[2];
    }
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return await saveScreenshot({ taskId, bytes: bytes.buffer, mimeType: mime, label });
  } catch {
    return null;
  }
}
