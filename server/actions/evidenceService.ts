/**
 * Private evidence storage for Actions screenshots/reports.
 * Uses existing Supabase storage; falls back to data URL only in memory mode
 * (not ideal for production — configure Supabase).
 */
import { supabaseDb } from "../db";

const BUCKET = process.env.ACTIONS_EVIDENCE_BUCKET || "lenory-actions-evidence";

export async function uploadEvidence(input: {
  userId: string;
  taskId: string;
  buffer: Buffer;
  mimeType: string;
  fileName: string;
}): Promise<{ url: string; path: string } | null> {
  const pathKey = `${input.userId}/${input.taskId}/${input.fileName.replace(/[^\w.\-]+/g, "_")}`;

  if (!supabaseDb) {
    // Dev fallback: inline data URL (small screenshots only)
    if (input.buffer.length < 900_000) {
      return {
        path: pathKey,
        url: `data:${input.mimeType};base64,${input.buffer.toString("base64")}`,
      };
    }
    return null;
  }

  try {
    await supabaseDb.storage.createBucket(BUCKET, { public: false, fileSizeLimit: 10 * 1024 * 1024 }).catch(() => {});
    const { error } = await supabaseDb.storage
      .from(BUCKET)
      .upload(pathKey, input.buffer, { contentType: input.mimeType, upsert: true });
    if (error) {
      console.warn("[actions evidence] upload failed:", error.message);
      // Try public bucket as last resort for MVP visibility
      const pub = "lenory-kb-media";
      await supabaseDb.storage.from(pub).upload(pathKey, input.buffer, { contentType: input.mimeType, upsert: true }).catch(() => {});
      const { data } = supabaseDb.storage.from(pub).getPublicUrl(pathKey);
      if (data?.publicUrl) return { url: data.publicUrl, path: pathKey };
      return null;
    }
    // Signed URL (1 hour) for private bucket
    const { data: signed, error: signErr } = await supabaseDb.storage
      .from(BUCKET)
      .createSignedUrl(pathKey, 3600);
    if (!signErr && signed?.signedUrl) {
      return { url: signed.signedUrl, path: pathKey };
    }
    const { data } = supabaseDb.storage.from(BUCKET).getPublicUrl(pathKey);
    return data?.publicUrl ? { url: data.publicUrl, path: pathKey } : { url: "", path: pathKey };
  } catch (e: any) {
    console.warn("[actions evidence]", e?.message);
    return null;
  }
}
