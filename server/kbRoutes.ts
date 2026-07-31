import { type Express, Response } from "express";
import multer from "multer";
import fs from "fs";
import os from "os";
import path from "path";
import { supabaseAuth } from "./supabaseAuth";
import { deductCredits } from "./creditsStore";
import { chatWithAI } from "./gemini";
import { storage } from "./storage";
const kbUpload = multer({ storage: multer.memoryStorage() });

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

  // Public shared-folder lookup (viewer must still be signed in)
  app.get('/api/kb/shared/:code', supabaseAuth, async (req: any, res: Response) => {
    try {
      const folder = await storage.getKBFolderByShareCode(req.params.code);
      if (!folder) return res.status(404).json({ message: "This share link is invalid or has been revoked." });
      const files = await storage.getKBFiles(folder.id);
      const owner = await storage.getUser(folder.user_id);
      res.json({
        folder: { id: folder.id, name: folder.name, description: folder.description, created_at: folder.created_at },
        files: files.map((f: any) => ({ id: f.id, name: f.name, file_type: f.file_type, file_size: f.file_size, created_at: f.created_at, extracted_text: f.extracted_text })),
        ownerName: owner?.firstName || "A Lenory user",
        isOwnFolder: folder.user_id === req.userId,
      });
    } catch (error) { console.error("SHARED FOLDER LOOKUP ERROR:", error); res.status(500).json({ message: "Failed to load shared folder" }); }
  });

  // Copy a shared folder + its files into the visiting user's own Knowledge Base
  app.post('/api/kb/shared/:code/save', supabaseAuth, async (req: any, res: Response) => {
    try {
      const sourceFolder = await storage.getKBFolderByShareCode(req.params.code);
      if (!sourceFolder) return res.status(404).json({ message: "This share link is invalid or has been revoked." });
      if (sourceFolder.user_id === req.userId) return res.status(400).json({ message: "This is already your folder." });
      const newFolder = await storage.createKBFolder({
        user_id: req.userId, name: `${sourceFolder.name} (shared copy)`,
        description: sourceFolder.description || null,
      });
      const sourceFiles = await storage.getKBFiles(sourceFolder.id);
      for (const f of sourceFiles) {
        await storage.createKBFile({
          folder_id: newFolder.id, user_id: req.userId, name: f.name,
          file_type: f.file_type, mime_type: f.mime_type, file_size: f.file_size,
          extracted_text: f.extracted_text, source_type: f.source_type,
        });
      }
      res.status(201).json({ folder: newFolder, filesCopied: sourceFiles.length });
    } catch (error) { console.error("SAVE SHARED FOLDER ERROR:", error); res.status(500).json({ message: "Failed to save shared folder" }); }
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
      const { originalname, mimetype, buffer } = req.file;
      let extractedText = "";
      let fileType = "upload";
      if (mimetype.startsWith("text/") || originalname.endsWith(".txt") || originalname.endsWith(".md")) {
        extractedText = buffer.toString("utf-8");
      } else if (mimetype.startsWith("audio/")) {
        fileType = "audio";
        const transcript = await transcribeAudioBuffer(buffer, originalname);
        extractedText = transcript || "";
      }
      const file = await storage.createKBFile({
        folder_id: req.params.id, user_id: req.userId, name: originalname,
        file_type: fileType, mime_type: mimetype, file_size: buffer.length, extracted_text: extractedText,
      });
      res.status(201).json(file);
    } catch (error) { console.error("KB FILE UPLOAD ERROR:", error); res.status(500).json({ message: "Failed to upload file" }); }
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
      const file = await storage.createKBFile({
        folder_id: req.params.id, user_id: req.userId, name: name || url,
        file_type: "url", full_text_url: url, file_size: extractedText.length, extracted_text: extractedText,
      });
      res.status(201).json(file);
    } catch (error) { res.status(500).json({ message: "Failed to add file from URL" }); }
  });
  app.post('/api/kb/folders/:id/files/text', supabaseAuth, async (req: any, res: Response) => {
    try {
      const { name, content } = req.body;
      if (!name || !content) return res.status(400).json({ message: "Name and content are required" });
      const file = await storage.createKBFile({
        folder_id: req.params.id, user_id: req.userId, name,
        file_type: "text", file_size: content.length, extracted_text: content,
      });
      res.status(201).json(file);
    } catch (error) { res.status(500).json({ message: "Failed to add note" }); }
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
      const context = await buildFolderContext(req.params.id);
      const raw = await chatWithAI([{ role: "user", content: `Based on this material:\n${context}\n\nGenerate ${questionCount} multiple-choice quiz questions. Respond with ONLY valid JSON array: [{"question":"...","options":["A","B","C","D"],"correctAnswer":"A","explanation":"..."}]` }]);
      const questions = parseJsonFromAI(raw);
      const saved = await storage.createKBFile({
        folder_id: req.params.id, user_id: req.userId,
        name: `Quiz (${questionCount} questions)`, file_type: "quiz",
        extracted_text: JSON.stringify(questions), file_size: raw.length,
      });
      res.json({ questions, file: saved });
    } catch (error) { res.status(500).json({ message: "Failed to generate quiz" }); }
  });
  app.post('/api/kb/folders/:id/flashcards', supabaseAuth, async (req: any, res: Response) => {
    try {
      const { count = 10 } = req.body;
      const context = await buildFolderContext(req.params.id);
      const raw = await chatWithAI([{ role: "user", content: `Based on this material:\n${context}\n\nGenerate ${count} flashcards. Respond with ONLY valid JSON array: [{"front":"...","back":"..."}]` }]);
      const flashcards = parseJsonFromAI(raw);
      const saved = await storage.createKBFile({
        folder_id: req.params.id, user_id: req.userId,
        name: `Flashcards (${count} cards)`, file_type: "flashcards",
        extracted_text: JSON.stringify(flashcards), file_size: raw.length,
      });
      res.json({ flashcards, file: saved });
    } catch (error) { res.status(500).json({ message: "Failed to generate flashcards" }); }
  });
  app.post('/api/kb/folders/:id/summary', supabaseAuth, async (req: any, res: Response) => {
    try {
      const context = await buildFolderContext(req.params.id);
      const summary = await chatWithAI([{ role: "user", content: `Summarize this study material clearly and concisely:\n${context}` }]);
      const saved = await storage.createKBFile({
        folder_id: req.params.id, user_id: req.userId,
        name: `Summary - ${new Date().toLocaleDateString()}`, file_type: "text",
        extracted_text: summary, file_size: summary.length,
      });
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
