import { db } from "./db";
import { kbFolders, kbFiles, type KbFolder, type KbFile } from "@shared/schema";
import { eq, desc } from "drizzle-orm";
import { nanoid } from "nanoid";
export async function getFoldersByUser(userId: string): Promise<KbFolder[]> {
  return db.select().from(kbFolders).where(eq(kbFolders.userId, userId)).orderBy(desc(kbFolders.createdAt));
}
export async function getFolderById(id: string): Promise<KbFolder | undefined> {
  const [folder] = await db.select().from(kbFolders).where(eq(kbFolders.id, id));
  return folder;
}
export async function createFolder(userId: string, name: string, description?: string): Promise<KbFolder> {
  const [folder] = await db.insert(kbFolders).values({ userId, name, description: description || null }).returning();
  return folder;
}
export async function deleteFolder(id: string): Promise<void> {
  await db.delete(kbFolders).where(eq(kbFolders.id, id));
}
export async function shareFolder(id: string, permission: string): Promise<KbFolder> {
  const token = nanoid(16);
  const [folder] = await db.update(kbFolders)
    .set({ shareToken: token, sharePermission: permission, updatedAt: new Date() })
    .where(eq(kbFolders.id, id)).returning();
  return folder;
}
export async function unshareFolder(id: string): Promise<void> {
  await db.update(kbFolders).set({ shareToken: null, sharePermission: null, updatedAt: new Date() }).where(eq(kbFolders.id, id));
}
export async function getFilesByFolder(folderId: string): Promise<KbFile[]> {
  return db.select().from(kbFiles).where(eq(kbFiles.folderId, folderId)).orderBy(desc(kbFiles.createdAt));
}
export async function addFile(data: {
  folderId: string; userId: string; name: string; fileType: string;
  mimeType?: string; sizeBytes: number; sourceUrl?: string; extractedText?: string;
}): Promise<KbFile> {
  const [file] = await db.insert(kbFiles).values(data).returning();
  await db.update(kbFolders)
    .set({ storageUsed: (await getFolderById(data.folderId))!.storageUsed + data.sizeBytes, updatedAt: new Date() })
    .where(eq(kbFolders.id, data.folderId));
  return file;
}
export async function deleteFile(id: string): Promise<void> {
  await db.delete(kbFiles).where(eq(kbFiles.id, id));
}
export async function deductFolderCredits(id: string, amount: number): Promise<number> {
  const folder = await getFolderById(id);
  if (!folder) throw new Error("Folder not found");
  const newBalance = Math.max(0, folder.creditsBalance - amount);
  await db.update(kbFolders).set({ creditsBalance: newBalance, updatedAt: new Date() }).where(eq(kbFolders.id, id));
  return newBalance;
}
export async function addFolderCredits(id: string, amount: number): Promise<number> {
  const folder = await getFolderById(id);
  if (!folder) throw new Error("Folder not found");
  const newBalance = folder.creditsBalance + amount;
  await db.update(kbFolders).set({ creditsBalance: newBalance, updatedAt: new Date() }).where(eq(kbFolders.id, id));
  return newBalance;
}
