import { type Express, Response } from "express";
import multer from "multer";
import fs from "fs";
import os from "os";
import path from "path";
import { supabaseAuth } from "./supabaseAuth";
import { deductCredits } from "./creditsStore";
import { chatWithAI } from "./gemini";
import { storage } from "./storage";
const kbUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 80 * 1024 * 1024 },
});

const REAL_ADMIN_EMAIL = "felixahuruonye@gmail.com";
const KB_MEDIA_BUCKET = "lenory-kb-media";
let kbMediaBucketReady = false;

async function ensureKbMediaBucket() {
  const { supabaseDb } = await import("./db");
  if (!supabaseDb || kbMediaBucketReady) return supabaseDb;
  try {
    const { error: createErr } = await supabaseDb.storage.createBucket(KB_MEDIA_BUCKET, {
      public: true,
      fileSizeLimit: 80 * 1024 * 1024,
    });
    if (createErr && !/already exists/i.test(createErr.message || "")) {
      console.warn("[kb media] createBucket:", createErr.message);
    }
    try {
      await (supabaseDb.storage as any).updateBucket(KB_MEDIA_BUCKET, { public: true });
    } catch {}
    kbMediaBucketReady = true;
  } catch (e) {
    console.error("[kb media] ensure bucket failed:", e);
  }
  return supabaseDb;
}

/** Upload binary to permanent public storage. Returns public URL or null. */
async function uploadKbMediaBuffer(
  buffer: Buffer,
  mimeType: string,
  originalName: string,
  userId: string,
  folderId: string
): Promise<string | null> {
  const supabaseDb = await ensureKbMediaBucket();
  if (!supabaseDb) return null;
  const safeName = (originalName || "file").replace(/[^\w.\-]+/g, "_").slice(0, 80);
  const ext = safeName.includes(".")
    ? safeName.split(".").pop()
    : (mimeType.split("/")[1] || "bin");
  const pathKey = `${userId}/${folderId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  let { error } = await supabaseDb.storage
    .from(KB_MEDIA_BUCKET)
    .upload(pathKey, buffer, { contentType: mimeType || "application/octet-stream", upsert: false });
  if (error && /bucket not found/i.test(error.message || "")) {
    kbMediaBucketReady = false;
    await ensureKbMediaBucket();
    ({ error } = await supabaseDb.storage
      .from(KB_MEDIA_BUCKET)
      .upload(pathKey, buffer, { contentType: mimeType || "application/octet-stream", upsert: false }));
  }
  if (error) {
    console.error("[kb media] upload error:", error.message);
    return null;
  }
  const { data } = supabaseDb.storage.from(KB_MEDIA_BUCKET).getPublicUrl(pathKey);
  return data?.publicUrl || null;
}

// Write My Note / Knowledge Base hard storage caps (enforced server-side)
const FOLDER_STORAGE_LIMIT = 100 * 1024 * 1024; // 100 MB per notebook/folder
const TOPIC_FILE_LIMIT = 50 * 1024 * 1024; // 50 MB per topic/file

// Mirrors the client's UPLOAD_BATCH_LIMITS in Notes.tsx — that check is
// client-side only (a user can bypass the UI and call this endpoint
// directly), so it's re-enforced here. The endpoint itself only ever
// accepts one file per request, so "batch" is approximated as a rolling
// 60s window: uploading more files than your tier's batch limit within
// one minute is treated the same as selecting too many at once.
const UPLOAD_BATCH_LIMITS: Record<string, number> = { free: 1, pro: 5, premium: 15 };
const UPLOAD_WINDOW_MS = 60_000;
const recentUploads = new Map<string, number[]>();

async function assertFolderStorageRoom(folderId: string, incomingBytes: number): Promise<{ ok: true } | { ok: false; message: string; used: number }> {
  const files = await storage.getKBFiles(folderId);
  const used = (files || []).reduce((sum: number, f: any) => sum + (Number(f.file_size ?? f.size_bytes ?? f.sizeBytes ?? 0) || 0), 0);
  if (incomingBytes > TOPIC_FILE_LIMIT) {
    return { ok: false, message: `Each topic/file is limited to ${Math.round(TOPIC_FILE_LIMIT / (1024 * 1024))} MB. Delete content or upgrade your plan.`, used };
  }
  if (used + incomingBytes > FOLDER_STORAGE_LIMIT) {
    return { ok: false, message: `Notebook storage full (${Math.round(used / (1024 * 1024))} MB / 100 MB). Delete topics or upgrade your plan.`, used };
  }
  return { ok: true };
}

function checkUploadRateLimit(userId: string, tier: string): { allowed: boolean; limit: number } {
  const limit = UPLOAD_BATCH_LIMITS[tier] ?? UPLOAD_BATCH_LIMITS.free;
  const now = Date.now();
  const timestamps = (recentUploads.get(userId) || []).filter((t) => now - t < UPLOAD_WINDOW_MS);
  if (timestamps.length >= limit) {
    recentUploads.set(userId, timestamps);
    return { allowed: false, limit };
  }
  timestamps.push(now);
  recentUploads.set(userId, timestamps);
  return { allowed: true, limit };
}

async function transcribeAudioBuffer(buffer: Buffer, originalname: string): Promise<string | null> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return null;
  const tmpFile = path.join(os.tmpdir(), `kb_audio_${Date.now()}_${originalname || 'audio.webm'}`);
  fs.writeFileSync(tmpFile, buffer);
  try {
    const { default: OpenAI } = await import('openai');
    const groqClient = new OpenAI({ apiKey, baseURL: 'https://api.groq.com/openai/v1' });
    const transcription = await groqClient.audio.transcriptions.create({
      file: fs.createReadStream(tmpFile) as any,
      model: 'whisper-large-v3-turbo',
      response_format: 'verbose_json',
    } as any);
    return (transcription as any).text || null;
  } catch (e) {
    console.error("KB audio transcription error:", e);
    return null;
  } finally {
    try { fs.unlinkSync(tmpFile); } catch {}
  }
}

async function buildFolderContext(folderId: string): Promise<string> {
  const files = await storage.getKBFiles(folderId);
  return files.map((f: any) => `--- ${f.name} ---\n${(f.extracted_text || "").substring(0, 3000)}`).join("\n\n").substring(0, 12000);
}
function parseJsonFromAI(text: string): any {
  return JSON.parse(text.replace(/```json|```/g, "").trim());
}
export function registerKbRoutes(app: Express) {
  app.get('/api/kb/folders', supabaseAuth, async (req: any, res: Response) => {
    try {
      const folders = await storage.getKBFolders(req.userId);
      res.json(folders);
    } catch (error) { console.error("KB FOLDERS ERROR:", error); res.status(500).json({ message: "Failed to fetch folders" }); }
  });
  app.get('/api/kb/folders/:id', supabaseAuth, async (req: any, res: Response) => {
    try {
      const files = await storage.getKBFiles(req.params.id);
      res.json(files);
    } catch (error) { res.status(500).json({ message: "Failed to fetch files" }); }
  });
  app.post('/api/kb/save-transcript', supabaseAuth, async (req: any, res: Response) => {
    try {
      const { content, title } = req.body;
      if (!content?.trim()) return res.status(400).json({ message: "Transcript content is required" });
      const folders = await storage.getKBFolders(req.userId);
      let folder = folders.find((f: any) => f.name === "Live Session Notes");
      if (!folder) {
        folder = await storage.createKBFolder({
          user_id: req.userId, name: "Live Session Notes",
          description: "Auto-saved transcripts from your Live Voice Sessions",
        });
      }
      const file = await storage.createKBFile({
        folder_id: folder.id, user_id: req.userId,
        name: title || `Session - ${new Date().toLocaleString()}`,
        file_type: "audio", source_type: "live_session",
        extracted_text: content, file_size: content.length,
      });
      res.status(201).json({ folder, file });
    } catch (error) { console.error("SAVE TRANSCRIPT ERROR:", error); res.status(500).json({ message: "Failed to save transcript" }); }
  });

  // Shared-folder lookup — public notebooks are readable without login;
  // private ones require auth. Original recordings are never exposed on public previews.
  app.get('/api/kb/shared/:code', async (req: any, res: Response) => {
    try {
      const folder = await storage.getKBFolderByShareCode(req.params.code);
      if (!folder) return res.status(404).json({ message: "This share link is invalid or has been revoked." });

      const perm = String(folder.share_permission || folder.sharePermission || "private").toLowerCase();
      const isPublic = perm === "public" || perm === "view";

      // Optional auth: attach userId if Bearer token present
      let userId: string | null = null;
      try {
        const auth = req.headers.authorization || "";
        const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
        if (token) {
          const { createClient } = await import("@supabase/supabase-js");
          const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "";
          const anon = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || "";
          if (url && anon) {
            const client = createClient(url, anon);
            const { data } = await client.auth.getUser(token);
            userId = data?.user?.id || null;
          }
        }
      } catch {}

      if (!isPublic && !userId) {
        return res.status(401).json({
          message: "This notebook is private. Sign in to view it.",
          error: "LOGIN_REQUIRED",
          requiresAuth: true,
        });
      }

      const files = await storage.getKBFiles(folder.id);
      const owner = await storage.getUser(folder.user_id || folder.userId);
      const safeFiles = (files || []).map((f: any) => {
        const base: any = {
          id: f.id,
          name: f.name,
          file_type: f.file_type,
          file_size: f.file_size ?? f.size_bytes ?? 0,
          created_at: f.created_at,
        };
        // Public: allow text/notes preview only — never audio blobs or raw recording payloads
        if (isPublic && !userId) {
          const text = f.extracted_text || f.extractedText || "";
          // Strip embedded audioDataUrl from topic JSON if present
          try {
            const parsed = JSON.parse(text);
            if (parsed && typeof parsed === "object") {
              const { transcript, formattedNotes, segments, duration, language } = parsed;
              base.extracted_text = JSON.stringify({
                transcript: transcript || "",
                formattedNotes: formattedNotes || "",
                segments: Array.isArray(segments) ? segments.slice(0, 50) : [],
                duration,
                language,
              });
              base.preview_notes = formattedNotes || (transcript || "").slice(0, 500);
            } else {
              base.extracted_text = String(text).slice(0, 4000);
              base.preview_notes = String(text).slice(0, 500);
            }
          } catch {
            base.extracted_text = String(text).slice(0, 4000);
            base.preview_notes = String(text).slice(0, 500);
          }
        } else {
          base.extracted_text = f.extracted_text || f.extractedText || "";
        }
        return base;
      });

      // Parse notebook meta from description JSON when present
      let meta: any = {};
      try {
        meta = folder.description ? JSON.parse(folder.description) : {};
        if (typeof meta !== "object" || !meta) meta = {};
      } catch {
        meta = {};
      }

      res.json({
        folder: {
          id: folder.id,
          name: folder.name,
          description: folder.description,
          created_at: folder.created_at,
          meta,
          share_permission: perm,
        },
        files: safeFiles,
        ownerName: owner?.firstName || owner?.first_name || "A Lenory user",
        isOwnFolder: !!userId && (folder.user_id === userId || folder.userId === userId),
        isPublic,
        requiresAuth: !isPublic,
      });
    } catch (error) {
      console.error("SHARED FOLDER LOOKUP ERROR:", error);
      res.status(500).json({ message: "Failed to load shared folder" });
    }
  });

  // Lightweight metadata for link previews (WhatsApp / Telegram / Slack crawlers)
  app.get('/api/kb/shared/:code/meta', async (req: any, res: Response) => {
    try {
      const folder = await storage.getKBFolderByShareCode(req.params.code);
      if (!folder) return res.status(404).json({ message: "Not found" });
      const files = await storage.getKBFiles(folder.id);
      const perm = String(folder.share_permission || "private").toLowerCase();
      res.json({
        title: folder.name || "LENORY Notebook",
        description: `Shared notebook on LENORY · ${(files || []).length} topic${(files || []).length === 1 ? "" : "s"}`,
        isPublic: perm === "public" || perm === "view",
        fileCount: (files || []).length,
      });
    } catch {
      res.status(500).json({ message: "Failed" });
    }
  });

  // Copy a shared folder + its files into the visiting user's own library (Write My Note)
  app.post('/api/kb/shared/:code/save', supabaseAuth, async (req: any, res: Response) => {
    try {
      const sourceFolder = await storage.getKBFolderByShareCode(req.params.code);
      if (!sourceFolder) return res.status(404).json({ message: "This share link is invalid or has been revoked." });
      if (sourceFolder.user_id === req.userId || sourceFolder.userId === req.userId) {
        return res.status(400).json({ message: "This is already your folder." });
      }
      const newFolder = await storage.createKBFolder({
        user_id: req.userId,
        name: `${sourceFolder.name} (shared copy)`,
        description: sourceFolder.description || null,
      });
      const sourceFiles = await storage.getKBFiles(sourceFolder.id);
      for (const f of sourceFiles) {
        await storage.createKBFile({
          folder_id: newFolder.id,
          user_id: req.userId,
          name: f.name,
          file_type: f.file_type,
          mime_type: f.mime_type,
          file_size: f.file_size ?? f.size_bytes ?? 0,
          extracted_text: f.extracted_text,
          source_type: f.source_type || "shared_import",
        });
      }
      res.status(201).json({ folder: newFolder, filesCopied: sourceFiles.length });
    } catch (error) {
      console.error("SAVE SHARED FOLDER ERROR:", error);
      res.status(500).json({ message: "Failed to save shared folder" });
    }
  });

  app.post('/api/kb/folders', supabaseAuth, async (req: any, res: Response) => {
    try {
      const { name, description } = req.body;
      if (!name) return res.status(400).json({ message: "Folder name is required" });
      const folder = await storage.createKBFolder({ user_id: req.userId, name, description: description || null });
      res.status(201).json(folder);
    } catch (error) { console.error("CREATE FOLDER ERROR:", error); res.status(500).json({ message: "Failed to create folder" }); }
  });
  app.delete('/api/kb/folders/:id', supabaseAuth, async (req: any, res: Response) => {
    try {
      await storage.deleteKBFolder(req.params.id);
      res.json({ success: true });
    } catch (error) { res.status(500).json({ message: "Failed to delete folder" }); }
  });
  app.post('/api/kb/folders/:id/share', supabaseAuth, async (req: any, res: Response) => {
    try {
      const { permission } = req.body;
      const shareCode = Math.random().toString(36).substring(2, 12);
      const folder = await storage.updateKBFolder(req.params.id, { share_code: shareCode, share_permission: permission || 'view' });
      res.json({ shareToken: folder.share_code, permission: folder.share_permission });
    } catch (error) { res.status(500).json({ message: "Failed to share folder" }); }
  });
  app.delete('/api/kb/folders/:id/share', supabaseAuth, async (req: any, res: Response) => {
    try {
      await storage.updateKBFolder(req.params.id, { share_code: null, share_permission: null });
      res.json({ success: true });
    } catch (error) { res.status(500).json({ message: "Failed to unshare folder" }); }
  });
  app.post('/api/kb/folders/:id/files', supabaseAuth, kbUpload.single('file'), async (req: any, res: Response) => {
    try {
      if (!req.file) return res.status(400).json({ message: "No file uploaded" });
      const uploader = await storage.getUser(req.userId);
      const uploaderTier = (uploader as any)?.subscriptionTier || 'free';
      if (uploader?.email !== REAL_ADMIN_EMAIL) {
        const rate = checkUploadRateLimit(req.userId, uploaderTier);
        if (!rate.allowed) {
          return res.status(403).json({
            message: `Your plan allows ${rate.limit} file${rate.limit === 1 ? "" : "s"} per minute. Upgrade to upload more at once.`,
            error: "TIER_LOCKED",
          });
        }
      }
      const { originalname, mimetype, buffer } = req.file;
      const room = await assertFolderStorageRoom(req.params.id, buffer.length);
      if (!room.ok) {
        return res.status(413).json({ message: room.message, error: "STORAGE_FULL", used: room.used, folderLimit: FOLDER_STORAGE_LIMIT, fileLimit: TOPIC_FILE_LIMIT });
      }
      let extractedText = "";
      let fileType = "upload";
      if (mimetype.startsWith("text/") || originalname.endsWith(".txt") || originalname.endsWith(".md")) {
        extractedText = buffer.toString("utf-8");
      } else if (mimetype.startsWith("audio/")) {
        fileType = "audio";
        // Permanent storage first; skip auto-transcribe for speed (user uses Write My Note)
        if (!(req.body?.skipExtract === "1" || req.body?.skipExtract === "true")) {
          try {
            const transcript = await transcribeAudioBuffer(buffer, originalname);
            extractedText = transcript || "";
          } catch {}
        }
      } else if (mimetype.startsWith("image/")) {
        fileType = "image";
        if (!(req.body?.skipExtract === "1" || req.body?.skipExtract === "true")) {
          try {
            const { extractTextFromImage } = await import('./gemini');
            const ocrText = await extractTextFromImage(buffer.toString('base64'), mimetype);
            extractedText = ocrText || "";
          } catch {}
        }
      } else if (mimetype.startsWith("video/")) {
        fileType = "video";
        if (buffer.length <= 20 * 1024 * 1024 && !(req.body?.skipExtract === "1" || req.body?.skipExtract === "true")) {
          try {
            const { GoogleGenAI } = await import('@google/genai');
            const geminiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '';
            if (geminiKey) {
              const ai = new GoogleGenAI({ apiKey: geminiKey });
              const result = await ai.models.generateContent({
                model: "gemini-2.5-flash",
                contents: [{ parts: [
                  { inlineData: { mimeType: mimetype, data: buffer.toString('base64') } },
                  { text: "Summarize this video for a student: what it covers and the key points to remember, as a short structured list." },
                ] }] as any,
              });
              extractedText = (result as any).text || "";
            }
          } catch (e) {
            console.error("KB video summarization error:", e);
          }
        }
      }

      // Permanent binary storage (photos, audio, video)
      let publicUrl: string | null = null;
      if (mimetype.startsWith("image/") || mimetype.startsWith("audio/") || mimetype.startsWith("video/")) {
        publicUrl = await uploadKbMediaBuffer(buffer, mimetype, originalname, req.userId, req.params.id);
      }

      const file = await storage.createKBFile({
        folder_id: req.params.id, user_id: req.userId, name: originalname,
        file_type: fileType, mime_type: mimetype, file_size: buffer.length,
        extracted_text: extractedText, full_text_url: publicUrl,
      });
      res.status(201).json({ ...file, url: publicUrl || file.full_text_url || null });
    } catch (error) { console.error("KB FILE UPLOAD ERROR:", error); res.status(500).json({ message: "Failed to upload file" }); }
  });

  /**
   * Fast permanent media upload for Write My Note (board photos / lecture audio).
   * Skips OCR/transcription by default so capture stays snappy; stores public URL.
   * Accepts multipart `file` OR JSON { dataUrl, name, mimeType }.
   */
  app.post('/api/kb/folders/:id/media', supabaseAuth, kbUpload.single('file'), async (req: any, res: Response) => {
    try {
      let buffer: Buffer | null = null;
      let mimetype = "application/octet-stream";
      let originalname = "media.bin";

      if (req.file) {
        buffer = req.file.buffer;
        mimetype = req.file.mimetype || mimetype;
        originalname = req.file.originalname || originalname;
      } else if (req.body?.dataUrl && typeof req.body.dataUrl === "string") {
        const match = String(req.body.dataUrl).match(/^data:([^;]+);base64,(.+)$/);
        if (!match) return res.status(400).json({ message: "Invalid dataUrl" });
        mimetype = match[1] || "image/jpeg";
        buffer = Buffer.from(match[2], "base64");
        originalname = req.body.name || `board-${Date.now()}.jpg`;
      } else {
        return res.status(400).json({ message: "No file or dataUrl provided" });
      }

      const room = await assertFolderStorageRoom(req.params.id, buffer.length);
      if (!room.ok) {
        return res.status(413).json({ message: room.message, error: "STORAGE_FULL", used: room.used });
      }

      const publicUrl = await uploadKbMediaBuffer(buffer, mimetype, originalname, req.userId, req.params.id);
      if (!publicUrl) {
        return res.status(500).json({ message: "Storage upload failed. Check Supabase storage is configured." });
      }

      let fileType = "upload";
      if (mimetype.startsWith("image/")) fileType = "image";
      else if (mimetype.startsWith("audio/")) fileType = "audio";
      else if (mimetype.startsWith("video/")) fileType = "video";

      const topicId = req.body?.topicId || null;
      const label = req.body?.label || originalname;

      const file = await storage.createKBFile({
        folder_id: req.params.id,
        user_id: req.userId,
        name: label,
        file_type: fileType,
        mime_type: mimetype,
        file_size: buffer.length,
        extracted_text: topicId ? JSON.stringify({ topicId, role: req.body?.role || "board_photo" }) : null,
        full_text_url: publicUrl,
        source_type: "write_my_note_media",
      });

      res.status(201).json({
        id: file.id,
        name: file.name,
        url: publicUrl,
        full_text_url: publicUrl,
        file_type: fileType,
        mime_type: mimetype,
        file_size: buffer.length,
      });
    } catch (error) {
      console.error("KB MEDIA UPLOAD ERROR:", error);
      res.status(500).json({ message: "Failed to store media permanently" });
    }
  });
  app.post('/api/kb/folders/:id/files/url', supabaseAuth, async (req: any, res: Response) => {
    try {
      const { url, name } = req.body;
      if (!url) return res.status(400).json({ message: "URL is required" });
      let extractedText = "";
      try {
        const resp = await fetch(url);
        extractedText = (await resp.text()).substring(0, 20000);
      } catch {}
      const size = Buffer.byteLength(extractedText || "", "utf8");
      const room = await assertFolderStorageRoom(req.params.id, size);
      if (!room.ok) {
        return res.status(413).json({ message: room.message, error: "STORAGE_FULL", used: room.used });
      }
      const file = await storage.createKBFile({
        folder_id: req.params.id, user_id: req.userId, name: name || url,
        file_type: "url", full_text_url: url, file_size: size, extracted_text: extractedText,
      });
      res.status(201).json(file);
    } catch (error) { res.status(500).json({ message: "Failed to add file from URL" }); }
  });
  app.post('/api/kb/folders/:id/files/text', supabaseAuth, async (req: any, res: Response) => {
    try {
      const { name, content } = req.body;
      if (!name || content === undefined || content === null) {
        return res.status(400).json({ message: "Name and content are required" });
      }
      const contentStr = typeof content === "string" ? content : JSON.stringify(content);
      const size = Buffer.byteLength(contentStr, "utf8");
      if (size > TOPIC_FILE_LIMIT) {
        return res.status(413).json({
          message: `Topic content is too large (${Math.round(size / (1024 * 1024))} MB). Remove embedded images and try again.`,
          error: "STORAGE_FULL",
        });
      }
      const room = await assertFolderStorageRoom(req.params.id, size);
      if (!room.ok) {
        return res.status(413).json({ message: room.message, error: "STORAGE_FULL", used: room.used, folderLimit: FOLDER_STORAGE_LIMIT, fileLimit: TOPIC_FILE_LIMIT });
      }
      const file = await storage.createKBFile({
        folder_id: req.params.id, user_id: req.userId, name,
        file_type: "text", file_size: size, extracted_text: contentStr,
      });
      res.status(201).json(file);
    } catch (error) { console.error("KB text create error:", error); res.status(500).json({ message: "Failed to add note" }); }
  });

  // Update an existing topic/file in place (avoids delete+recreate and huge payload races)
  app.put('/api/kb/folders/:folderId/files/:fileId', supabaseAuth, async (req: any, res: Response) => {
    try {
      const { name, content } = req.body;
      const existing = await storage.getKBFile(req.params.fileId);
      if (!existing) return res.status(404).json({ message: "File not found" });
      if (existing.folder_id !== req.params.folderId && existing.folderId !== req.params.folderId) {
        return res.status(400).json({ message: "File does not belong to this folder" });
      }
      const contentStr = content === undefined || content === null
        ? (existing.extracted_text || "")
        : (typeof content === "string" ? content : JSON.stringify(content));
      const size = Buffer.byteLength(contentStr, "utf8");
      if (size > TOPIC_FILE_LIMIT) {
        return res.status(413).json({
          message: `Topic content is too large (${Math.round(size / (1024 * 1024))} MB). Try saving without board photos embedded.`,
          error: "STORAGE_FULL",
        });
      }
      const updated = await storage.updateKBFile(req.params.fileId, {
        name: name || existing.name,
        extracted_text: contentStr,
        file_size: size,
      });
      if (!updated) return res.status(500).json({ message: "Failed to update file" });
      res.json(updated);
    } catch (error) {
      console.error("KB file update error:", error);
      res.status(500).json({ message: "Failed to update note" });
    }
  });

  app.delete('/api/kb/folders/:folderId/files/:fileId', supabaseAuth, async (req: any, res: Response) => {
    try {
      await storage.deleteKBFile(req.params.fileId);
      res.json({ success: true });
    } catch (error) { res.status(500).json({ message: "Failed to delete file" }); }
  });
  app.post('/api/kb/folders/:id/chat', supabaseAuth, async (req: any, res: Response) => {
    try {
      const { message } = req.body;
      const context = await buildFolderContext(req.params.id);
      const response = await chatWithAI([{ role: "user", content: `Study material context:\n${context}\n\nQuestion: ${message}` }]);
      res.json({ response });
    } catch (error) { res.status(500).json({ message: "Failed to chat with folder" }); }
  });
  app.post('/api/kb/folders/:id/quiz', supabaseAuth, async (req: any, res: Response) => {
    try {
      const { questionCount = 5 } = req.body;
      const credits = await storage.getKBFolderCredits(req.params.id);
      if (credits.balance < 1) return res.status(402).json({ message: "This folder is out of credits. Top up to keep generating." });
      const context = await buildFolderContext(req.params.id);
      const raw = await chatWithAI([{ role: "user", content: `Based on this material:\n${context}\n\nGenerate ${questionCount} multiple-choice quiz questions. Respond with ONLY valid JSON array: [{"question":"...","options":["A","B","C","D"],"correctAnswer":"A","explanation":"..."}]` }]);
      const questions = parseJsonFromAI(raw);
      const saved = await storage.createKBFile({
        folder_id: req.params.id, user_id: req.userId,
        name: `Quiz (${questionCount} questions)`, file_type: "quiz",
        extracted_text: JSON.stringify(questions), file_size: raw.length,
      });
      await storage.deductKBCredits(req.params.id, 1, "Generated quiz");
      res.json({ questions, file: saved });
    } catch (error) { res.status(500).json({ message: "Failed to generate quiz" }); }
  });
  app.post('/api/kb/folders/:id/flashcards', supabaseAuth, async (req: any, res: Response) => {
    try {
      const { count = 10 } = req.body;
      const credits = await storage.getKBFolderCredits(req.params.id);
      if (credits.balance < 1) return res.status(402).json({ message: "This folder is out of credits. Top up to keep generating." });
      const context = await buildFolderContext(req.params.id);
      const raw = await chatWithAI([{ role: "user", content: `Based on this material:\n${context}\n\nGenerate ${count} flashcards. Respond with ONLY valid JSON array: [{"front":"...","back":"..."}]` }]);
      const flashcards = parseJsonFromAI(raw);
      const saved = await storage.createKBFile({
        folder_id: req.params.id, user_id: req.userId,
        name: `Flashcards (${count} cards)`, file_type: "flashcards",
        extracted_text: JSON.stringify(flashcards), file_size: raw.length,
      });
      await storage.deductKBCredits(req.params.id, 1, "Generated flashcards");
      res.json({ flashcards, file: saved });
    } catch (error) { res.status(500).json({ message: "Failed to generate flashcards" }); }
  });
  app.post('/api/kb/folders/:id/summary', supabaseAuth, async (req: any, res: Response) => {
    try {
      const credits = await storage.getKBFolderCredits(req.params.id);
      if (credits.balance < 1) return res.status(402).json({ message: "This folder is out of credits. Top up to keep generating." });
      const context = await buildFolderContext(req.params.id);
      const summary = await chatWithAI([{ role: "user", content: `Summarize this study material clearly and concisely:\n${context}` }]);
      const saved = await storage.createKBFile({
        folder_id: req.params.id, user_id: req.userId,
        name: `Summary - ${new Date().toLocaleDateString()}`, file_type: "text",
        extracted_text: summary, file_size: summary.length,
      });
      await storage.deductKBCredits(req.params.id, 1, "Generated summary");
      res.json({ summary, file: saved });
    } catch (error) { res.status(500).json({ message: "Failed to generate summary" }); }
  });
  app.get('/api/kb/folders/:id/credits', supabaseAuth, async (req: any, res: Response) => {
    try {
      const credits = await storage.getKBFolderCredits(req.params.id);
      res.json(credits);
    } catch (error) { res.status(500).json({ message: "Failed to fetch folder credits" }); }
  });
  app.post('/api/kb/folders/:id/credits/topup', supabaseAuth, async (req: any, res: Response) => {
    try {
      const { amount } = req.body;
      if (!amount || amount <= 0) return res.status(400).json({ message: "Invalid amount" });
      await deductCredits(req.userId, amount);
      res.json({ success: true });
    } catch (error) { res.status(500).json({ message: "Failed to top up folder credits" }); }
  });
}
