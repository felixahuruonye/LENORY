/**
 * fal.ai image provider — primary for Ultra and Fast lanes.
 * Wraps the fal client so every model call returns a standard ImgOut,
 * and every error is mapped to a plain message (never swallowed silently).
 */
import { fal } from "@fal-ai/client";
import type { ImgInput } from "./imageStudio";

export interface ImgOut { buffer: Buffer; mime: string }

function configure() {
  const key = process.env.FAL_KEY || process.env.FAL_API_KEY;
  if (!key) throw new Error("Image generation is not configured (FAL_KEY is missing on this server).");
  fal.config({ credentials: key });
}

type FalResult = { images?: { url?: string; content_type?: string }[]; image?: { url?: string; content_type?: string }; url?: string }

async function fetchFalImage(url: string): Promise<{ buffer: Buffer; mime: string }> {
  const r = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!r.ok) throw new Error(`Could not download the generated image (HTTP ${r.status})`);
  return { buffer: Buffer.from(await r.arrayBuffer()), mime: r.headers.get("content-type") || "image/png" };
}

function firstImageUrl(data: FalResult): string {
  const img = data.images?.[0] || data.image;
  const url = img?.url || (typeof data.url === "string" ? data.url : undefined);
  if (!url) throw new Error("fal.ai returned a result but no image URL was found in it");
  return url;
}

function toBase64Part(buf: Buffer, mime: string) {
  return { data: buf.toString("base64"), mimeType: mime };
}

export async function runFal(modelId: string, input: ImgInput): Promise<ImgOut> {
  configure();
  const payload: Record<string, any> = {
    prompt: input.prompt || "An image",
    ...(input.aspectRatio && modelId !== "fal-ai/birefnet" && modelId !== "fal-ai/aura-sr" ? { aspect_ratio: input.aspectRatio } : {}),
    ...(input.seed !== undefined ? { seed: input.seed } : {}),
    ...(input.negativePrompt ? { negative_prompt: input.negativePrompt } : {}),
  };
  if (input.image) {
    payload.image_url = `data:${input.image.mime};base64,${input.image.buffer.toString("base64")}`;
  }
  if (input.mask) {
    payload.mask_url = `data:${input.mask.mime};base64,${input.mask.buffer.toString("base64")}`;
  }
  if (input.styleImage) {
    payload.reference_image_url = `data:${input.styleImage.mime};base64,${input.styleImage.buffer.toString("base64")}`;
  }
  // Upscaler takes image_url directly
  if (modelId === "fal-ai/aura-sr" && input.image) {
    delete payload.prompt;
    payload.image_url = `data:${input.image.mime};base64,${input.image.buffer.toString("base64")}`;
  }
  // Background remover
  if (modelId === "fal-ai/birefnet" && input.image) {
    delete payload.prompt;
    payload.image_url = `data:${input.image.mime};base64,${input.image.buffer.toString("base64")}`;
  }
  try {
    const result = await fal.run(modelId, { input: payload }) as FalResult;
    const url = firstImageUrl(result);
    return await fetchFalImage(url);
  } catch (e: any) {
    const msg = String(e?.body?.detail || e?.message || e);
    if (/unauthorized|invalid.*(key|token)|authentication/i.test(msg)) throw new Error("fal.ai rejected the server key. An admin must set FAL_KEY in Render Environment.");
    if (/quota|credit|payment/i.test(msg)) throw new Error("fal.ai account is out of credits. An admin must top up at fal.ai/dashboard.");
    if (/content|safety|nsfw/i.test(msg)) throw new Error("The image request was blocked by fal.ai's safety filter. Try rewording your description.");
    throw new Error(`fal.ai error: ${msg.slice(0, 300)}`);
  }
}
