import { type Express, Request, Response } from "express";
import multer from "multer";
import { supabaseAuth } from "./supabaseAuth";
import { deductCredits } from "./creditsStore";
import { chatWithAI } from "./gemini";
import * as kb from "./kbStorage";

const kbUpload = multer({ storage: multer.memoryStorage() });

async function buildFolderContext(folderId: string): Promise<string> {
  const files = await kb.getFilesByFolder(folderId);
  return files.map(f => `--- ${f.name} ---\n${(f.extractedText || "").substring(0, 3000)}`).join("\n\n").substring(0, 12000);
}

function parseJsonFromAI(text: string): any {
  const cleaned = text.replace(/```json|```/g, "").trim();
  return JSON.parse(cleaned);
}

export function registerKbRoutes(app: Express) {
  app.get('/api/kb/folders', supabaseAuth, async (req: any, res: Response) => {
    try {
      const folders = await kb.getFoldersByUser(req.userId).catch(e => { console.error("KB FOLDERS ERROR:", e); throw e; });
      res.json(folders.map(f => ({
        id: f.id, name: f.name, description: f.description,
        storage_used: f.storageUsed, credits_balance: f.creditsBalance,
        created_at: f.createdAt, updated_at: f.updatedAt,
      })));
    } catch (error) { res.status(500).json({ message: "Failed to fetch folders" }); }
  });

  app.get('/api/kb/folders/:id', supabaseAuth, async (req: any, res: Response) => {
    try {
      const files = await kb.getFilesByFolder(req.params.id);
      res.json(files);
    } catch (error) { res.status(500).json({ message: "Failed to fetch files" }); }
  });

  app.post('/api/kb/folders', supabaseAuth, async (req: any, res: Response) => {
    try {
      const { name, description } = req.body;
      if (!name) return res.status(400).json({ message: "Folder name is required" });
      const folder = await kb.createFolder(req.userId, name, description);
      res.status(201).json(folder);
    } catch (error) { res.status(500).json({ message: "Failed to create folder" }); }
  });

  app.delete('/api/kb/folders/:id', supabaseAuth, async (req: any, res: Response) => {
    try {
      await kb.deleteFolder(req.params.id);
      res.json({ success: true });
    } catch (error) { res.status(500).json({ message: "Failed to delete folder" }); }
  });

  app.post('/api/kb/folders/:id/share', supabaseAuth, async (req: any, res: Response) => {
    try {
      const { permission } = req.body;
      const folder = await kb.shareFolder(req.params.id, permission || 'view');
      res.json({ shareToken: folder.shareToken, permission: folder.sharePermission });
    } catch (error) { res.status(500).json({ message: "Failed to share folder" }); }
  });

  app.delete('/api/kb/folders/:id/share', supabaseAuth, async (req: any, res: Response) => {
    try {
      await kb.unshareFolder(req.params.id);
      res.json({ success: true });
    } catch (error) { res.status(500).json({ message: "Failed to unshare folder" }); }
  });

  app.post('/api/kb/folders/:id/files', supabaseAuth, kbUpload.single('file'), async (req: any, res: Response) => {
    try {
      if (!req.file) return res.status(400).json({ message: "No file uploaded" });
      const { originalname, mimetype, buffer } = req.file;
      let extractedText = "";
      if (mimetype.startsWith("text/") || originalname.endsWith(".txt") || originalname.endsWith(".md")) {
        extractedText = buffer.toString("utf-8");
      }
      const file = await kb.addFile({
        folderId: req.params.id, userId: req.userId, name: originalname,
        fileType: "upload", mimeType: mimetype, sizeBytes: buffer.length, extractedText,
      });
      res.status(201).json(file);
    } catch (error) { res.status(500).json({ message: "Failed to upload file" }); }
  });

  app.post('/api/kb/folders/:id/files/url', supabaseAuth, async (req: any, res: Response) => {
    try {
      const { url, name } = req.body;
      if (!url) return res.status(400).json({ message: "URL is required" });
      let extractedText = "";
      try {
        const resp = await fetch(url);
        extractedText = (await resp.text()).substring(0, 20000);
      } catch { /* leave extractedText empty if fetch fails */ }
      const file = await kb.addFile({
        folderId: req.params.id, userId: req.userId, name: name || url,
        fileType: "url", sourceUrl: url, sizeBytes: extractedText.length, extractedText,
      });
      res.status(201).json(file);
    } catch (error) { res.status(500).json({ message: "Failed to add file from URL" }); }
  });

  app.post('/api/kb/folders/:id/files/text', supabaseAuth, async (req: any, res: Response) => {
    try {
      const { name, content } = req.body;
      if (!name || !content) return res.status(400).json({ message: "Name and content are required" });
      const file = await kb.addFile({
        folderId: req.params.id, userId: req.userId, name,
        fileType: "text", sizeBytes: content.length, extractedText: content,
      });
      res.status(201).json(file);
    } catch (error) { res.status(500).json({ message: "Failed to add note" }); }
  });

  app.delete('/api/kb/folders/:folderId/files/:fileId', supabaseAuth, async (req: any, res: Response) => {
    try {
      await kb.deleteFile(req.params.fileId);
      res.json({ success: true });
    } catch (error) { res.status(500).json({ message: "Failed to delete file" }); }
  });

  app.post('/api/kb/folders/:id/chat', supabaseAuth, async (req: any, res: Response) => {
    try {
      const { message } = req.body;
      const context = await buildFolderContext(req.params.id);
      const response = await chatWithAI([
        { role: "user", content: `Study material context:\n${context}\n\nQuestion: ${message}` }
      ]);
      await kb.deductFolderCredits(req.params.id, 1);
      res.json({ response });
    } catch (error) { res.status(500).json({ message: "Failed to chat with folder" }); }
  });

  app.post('/api/kb/folders/:id/quiz', supabaseAuth, async (req: any, res: Response) => {
    try {
      const { questionCount = 5 } = req.body;
      const context = await buildFolderContext(req.params.id);
      const raw = await chatWithAI([
        { role: "user", content: `Based on this material:\n${context}\n\nGenerate ${questionCount} multiple-choice quiz questions. Respond with ONLY valid JSON array: [{"question":"...","options":["A","B","C","D"],"correctAnswer":"A","explanation":"..."}]` }
      ]);
      const questions = parseJsonFromAI(raw);
      await kb.deductFolderCredits(req.params.id, 2);
      res.json({ questions });
    } catch (error) { res.status(500).json({ message: "Failed to generate quiz" }); }
  });

  app.post('/api/kb/folders/:id/flashcards', supabaseAuth, async (req: any, res: Response) => {
    try {
      const { count = 10 } = req.body;
      const context = await buildFolderContext(req.params.id);
      const raw = await chatWithAI([
        { role: "user", content: `Based on this material:\n${context}\n\nGenerate ${count} flashcards. Respond with ONLY valid JSON array: [{"front":"...","back":"..."}]` }
      ]);
      const flashcards = parseJsonFromAI(raw);
      await kb.deductFolderCredits(req.params.id, 2);
      res.json({ flashcards });
    } catch (error) { res.status(500).json({ message: "Failed to generate flashcards" }); }
  });

  app.post('/api/kb/folders/:id/summary', supabaseAuth, async (req: any, res: Response) => {
    try {
      const context = await buildFolderContext(req.params.id);
      const summary = await chatWithAI([
        { role: "user", content: `Summarize this study material clearly and concisely:\n${context}` }
      ]);
      await kb.deductFolderCredits(req.params.id, 1);
      res.json({ summary });
    } catch (error) { res.status(500).json({ message: "Failed to generate summary" }); }
  });

  app.get('/api/kb/folders/:id/credits', supabaseAuth, async (req: any, res: Response) => {
    try {
      const folder = await kb.getFolderById(req.params.id);
      if (!folder) return res.status(404).json({ message: "Folder not found" });
      res.json({ balance: folder.creditsBalance });
    } catch (error) { res.status(500).json({ message: "Failed to fetch folder credits" }); }
  });

  app.post('/api/kb/folders/:id/credits/topup', supabaseAuth, async (req: any, res: Response) => {
    try {
      const { amount } = req.body;
      if (!amount || amount <= 0) return res.status(400).json({ message: "Invalid amount" });
      await deductCredits(req.userId, amount);
      const balance = await kb.addFolderCredits(req.params.id, amount);
      res.json({ success: true, balance });
    } catch (error) { res.status(500).json({ message: "Failed to top up folder credits" }); }
  });
}