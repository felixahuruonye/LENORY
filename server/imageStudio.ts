/**
 * Image studio: calls Stability (Ultra/Fast lanes) and Google Nano Banana (Vision lane),
 * saves results to the student's image history, and enforces admin switches, monthly caps and credits.
 * Docs: docs.stability.ai (REST v2beta). 1 Stability credit = $0.01.
 */
import { supabaseDb } from "./db";
import { storage } from "./storage";
import { getFeatureCost, getOrCreateCredits, deductCredits } from "./creditsStore";
import { IMAGE_SERVICES, imageCostKey, imageOnKey, type ImageService } from "./imageDefaults";
import { setExternalCooldown, getExternalCooldown } from "./aiRouter";

const ADMIN_EMAIL = "felixahuruonye@gmail.com";
const STAB = "https://api.stability.ai";
export const getService = (id: string) => IMAGE_SERVICES.find((s) => s.id === id);

export interface ImgInput {
  prompt?: string; negativePrompt?: string; aspectRatio?: string; seed?: number;
  image?: { buffer: Buffer; mime: string }; mask?: { buffer: Buffer; mime: string }; styleImage?: { buffer: Buffer; mime: string };
  params?: Record<string, string | number | undefined>;
}
export interface ImgOut { buffer: Buffer; mime: string }

const blob = (b: { buffer: Buffer; mime: string }) => new Blob([b.buffer], { type: b.mime });
const ext = (m: string) => (m.includes("jpeg") ? "jpg" : m.includes("webp") ? "webp" : m.includes("gltf") || m.includes("glb") ? "glb" : "png");


const STAB_RATIOS = ["21:9", "16:9", "3:2", "5:4", "1:1", "4:5", "2:3", "9:16", "9:21"];
const GEM_RATIOS = ["1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"];
/** Map whatever the model asked for to the nearest ratio the provider really accepts (a bad value was failing every image). */
export function normalizeAspect(ratio: string | undefined, provider: "stability" | "gemini"): string {
  const list = provider === "stability" ? STAB_RATIOS : GEM_RATIOS;
  const r = String(ratio || "1:1").replace(/\s+/g, "").replace(/[xX\/]/, ":");
  if (list.includes(r)) return r;
  const [a, b] = r.split(":").map(Number);
  if (!a || !b) return "1:1";
  const want = a / b;
  return list.map((x) => ({ x, d: Math.abs(Number(x.split(":")[0]) / Number(x.split(":")[1]) - want) })).sort((m, n) => m.d - n.d)[0].x;
}

async function stabilityError(res: Response): Promise<Error> {
  const text = await res.text().catch(() => "");
  console.error(`[stability] HTTP ${res.status} ${res.url.replace("https://api.stability.ai", "")}: ${text.slice(0, 600)}`);
  let msg = text.slice(0, 220);
  try { const j = JSON.parse(text); msg = (j.errors?.join("; ") || j.message || j.name || msg); } catch {}
  if (res.status === 401 || res.status === 403) return new Error(`The image provider rejected the server's key (HTTP ${res.status}). An admin must check STABILITY_API_KEY.`);
  if (res.status === 402) return new Error("The image provider account is out of credits. An admin must top up Stability.");
  if (res.status === 429) { setExternalCooldown("stability", 30, "Stability rate limit"); return new Error("The image provider is busy right now. Try again in about 30 seconds."); }
  if (res.status === 400 && /content_moderation|flagged/i.test(text)) return new Error("The image provider's safety filter blocked this request. Try rewording it.");
  return new Error(`Image provider error ${res.status}: ${msg}`);
}

/** One Stability call (handles the async services by polling /results/{id}). */
export async function runStability(svc: ImageService, input: ImgInput): Promise<ImgOut> {
  const key = process.env.STABILITY_API_KEY; // read on every call so a renewed key works after a restart
  if (!key) throw new Error("Image generation is not configured (STABILITY_API_KEY is missing).");
  if (getExternalCooldown("stability")) throw new Error("The image provider is busy right now. Try again in a moment.");
  const f = new FormData();
  const p = input.params || {};
  const set = (k: string, v: any) => { if (v !== undefined && v !== null && v !== "") f.append(k, String(v)); };
  if (svc.model) set("model", svc.model);
  set("prompt", input.prompt); set("negative_prompt", input.negativePrompt); set("seed", input.seed);
  set("output_format", p.output_format || (svc.kind === "3d" ? undefined : "png"));
  if (svc.kind === "generate") set("aspect_ratio", normalizeAspect(input.aspectRatio, "stability"));
  const needImage = svc.kind !== "generate";
  if (needImage && !input.image) throw new Error(`${svc.label} needs a source image.`);
  switch (svc.id) {
    case "style_transfer": f.append("init_image", blob(input.image!), `init.${ext(input.image!.mime)}`); if (!input.styleImage) throw new Error("Style Transfer needs a style reference image."); f.append("style_image", blob(input.styleImage), `style.${ext(input.styleImage.mime)}`); for (const k of ["style_strength", "composition_fidelity", "change_strength"]) set(k, p[k]); break;
    case "replace_bg_relight": f.append("subject_image", blob(input.image!), `subject.${ext(input.image!.mime)}`); for (const k of ["background_prompt", "foreground_prompt", "light_source_direction", "light_source_strength", "preserve_original_subject", "original_background_depth", "keep_original_background"]) set(k, p[k]); if (!p.background_prompt && !input.prompt) throw new Error("Describe the new background."); break;
    default:
      if (input.image) f.append("image", blob(input.image), `image.${ext(input.image.mime)}`);
  }
  if (input.mask) f.append("mask", blob(input.mask), `mask.${ext(input.mask.mime)}`);
  switch (svc.id) {
    case "outpaint": for (const k of ["left", "right", "up", "down", "creativity"]) set(k, p[k]); if (!["left", "right", "up", "down"].some((k) => Number(p[k]) > 0)) throw new Error("Outpaint needs at least one direction (left, right, up or down) in pixels."); break;
    case "search_recolor": set("select_prompt", p.select_prompt); if (!p.select_prompt || !input.prompt) throw new Error("Say which object to recolor and the new colour."); break;
    case "search_replace": set("search_prompt", p.search_prompt); if (!p.search_prompt || !input.prompt) throw new Error("Say what to find and what to replace it with."); break;
    case "inpaint": if (!input.prompt) throw new Error("Describe what should fill the area."); break;
    case "sketch": case "structure": set("control_strength", p.control_strength); if (!input.prompt) throw new Error(`${svc.label} needs a prompt.`); break;
    case "style_guide": set("fidelity", p.fidelity); set("aspect_ratio", input.aspectRatio ? normalizeAspect(input.aspectRatio, "stability") : undefined); if (!input.prompt) throw new Error("Style Guide needs a prompt."); break;
    case "upscale_creative": set("creativity", p.creativity); if (!input.prompt) throw new Error("Creative Upscaler needs a short description of the picture."); break;
    case "spar3d": for (const k of ["texture_resolution", "foreground_ratio", "remesh"]) set(k, p[k]); break;
  }
  const accept = svc.kind === "3d" ? "model/gltf-binary" : "image/*";
  let res = await fetch(STAB + svc.path, { method: "POST", headers: { Authorization: `Bearer ${key}`, Accept: svc.async ? "application/json" : accept }, body: f, signal: AbortSignal.timeout(110_000) });
  if (res.status === 406 && svc.kind === "3d") res = await fetch(STAB + svc.path, { method: "POST", headers: { Authorization: `Bearer ${key}`, Accept: "*/*" }, body: f, signal: AbortSignal.timeout(110_000) });
  if (!res.ok) throw await stabilityError(res);
  if (svc.async) {
    const { id } = (await res.json()) as any;
    if (!id) throw new Error("The image provider did not return a job id.");
    const t0 = Date.now();
    while (Date.now() - t0 < 150_000) {
      await new Promise((r) => setTimeout(r, 4000));
      const r2 = await fetch(`${STAB}/v2beta/results/${id}`, { headers: { Authorization: `Bearer ${key}`, Accept: "image/*" }, signal: AbortSignal.timeout(30_000) });
      if (r2.status === 202) continue;
      if (!r2.ok) throw await stabilityError(r2);
      if (r2.headers.get("finish-reason") === "CONTENT_FILTERED") throw new Error("The image provider's safety filter blocked this result.");
      return { buffer: Buffer.from(await r2.arrayBuffer()), mime: r2.headers.get("content-type") || "image/png" };
    }
    throw new Error("The image took too long to finish. Nothing was charged.");
  }
  if (res.headers.get("finish-reason") === "CONTENT_FILTERED") throw new Error("The image provider's safety filter blocked this result.");
  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.length < 200) throw new Error("The image provider returned an empty file.");
  return { buffer, mime: res.headers.get("content-type") || (svc.kind === "3d" ? "model/gltf-binary" : "image/png") };
}

/** Google Nano Banana: text-to-image and editing with one or more input images. */
export async function runNanoBanana(svc: ImageService, input: ImgInput): Promise<ImgOut> {
  const key = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
  if (!key) throw new Error("Image generation is not configured (Gemini key missing).");
  const cd = getExternalCooldown(`gemini-image:${svc.id}`);
  if (cd) throw new Error("This image model is resting for a moment. Try again shortly.");
  const parts: any[] = [{ text: input.prompt || "Create an image" }];
  for (const im of [input.image, input.styleImage]) if (im) parts.push({ inlineData: { mimeType: im.mime, data: im.buffer.toString("base64") } });
  const body: any = { contents: [{ role: "user", parts }], generationConfig: { responseModalities: ["IMAGE", "TEXT"], ...(input.aspectRatio ? { imageConfig: { aspectRatio: normalizeAspect(input.aspectRatio, "gemini") } } : {}) } };
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${svc.model}:generateContent`, { method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": key }, body: JSON.stringify(body), signal: AbortSignal.timeout(110_000) });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    if (res.status === 429) setExternalCooldown(`gemini-image:${svc.id}`, 60, "Gemini image limit");
    throw new Error(res.status === 429 ? "The picture model hit its limit. Try again in a minute." : `Picture model error ${res.status}: ${t.slice(0, 160)}`);
  }
  const data: any = await res.json();
  if (data.promptFeedback?.blockReason) throw new Error("The picture model's safety filter blocked this request. Try rewording it.");
  const img = (data.candidates?.[0]?.content?.parts || []).find((p: any) => p.inlineData?.data);
  if (!img) throw new Error("The picture model did not return an image. Try a clearer description.");
  return { buffer: Buffer.from(img.inlineData.data, "base64"), mime: img.inlineData.mimeType || "image/png" };
}

// ---------------------------------------------------------------- storage + history
const BUCKET = "generated-images";
export async function saveImage(userId: string, out: ImgOut, meta: { prompt: string; provider: string; topic?: string }): Promise<{ id: string; url: string }> {
  if (!supabaseDb) throw new Error("Storage is not configured");
  const name = `${userId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext(out.mime)}`;
  let { error } = await supabaseDb.storage.from(BUCKET).upload(name, out.buffer, { contentType: out.mime, upsert: false });
  if (error && /bucket not found/i.test(error.message)) { await supabaseDb.storage.createBucket(BUCKET, { public: true }).catch(() => {}); ({ error } = await supabaseDb.storage.from(BUCKET).upload(name, out.buffer, { contentType: out.mime, upsert: false })); }
  if (error) throw new Error(`Could not save the image: ${error.message}`);
  const url = supabaseDb.storage.from(BUCKET).getPublicUrl(name).data.publicUrl;
  const row = await storage.createGeneratedImage({ userId, prompt: meta.prompt.slice(0, 500), imageUrl: url, relatedTopic: meta.topic, provider: meta.provider } as any);
  return { id: (row as any).id, url };
}

/** Find one of THIS student's own images: by id, by url, or the most recent one. */
export async function loadOwnImage(userId: string, ref: { imageId?: string; url?: string; last?: boolean }): Promise<{ buffer: Buffer; mime: string; id: string } | null> {
  const rows: any[] = await storage.getGeneratedImagesByUser(userId);
  if (!rows.length) return null;
  const sorted = rows.slice().sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
  const row = ref.imageId ? sorted.find((r) => r.id === ref.imageId) : ref.url ? sorted.find((r) => r.imageUrl === ref.url) : ref.last ? sorted[0] : null;
  if (!row?.imageUrl) return null;
  const r = await fetch(row.imageUrl, { signal: AbortSignal.timeout(30_000) });
  if (!r.ok) return null;
  return { buffer: Buffer.from(await r.arrayBuffer()), mime: r.headers.get("content-type") || "image/png", id: row.id };
}

// ---------------------------------------------------------------- admin switches, caps, credits
export async function serviceEnabled(id: string): Promise<boolean> {
  const [master, one] = await Promise.all([getFeatureCost("img_master"), getFeatureCost(imageOnKey(id))]);
  return master > 0 && one > 0;
}
export async function monthlyCap(plan: string): Promise<number> {
  return getFeatureCost(plan === "premium" ? "image_cap_premium" : plan === "pro" ? "image_cap_pro" : "image_cap_free");
}
export async function imageGate(userId: string, svc: ImageService, count: number): Promise<{ ok: true; unit: number; admin: boolean } | { ok: false; message: string }> {
  const user: any = await storage.getUser(userId);
  const admin = user?.email === ADMIN_EMAIL;
  const plan = admin ? "premium" : String(user?.subscriptionTier || "free");
  if (!(await serviceEnabled(svc.id))) return { ok: false, message: `${svc.label} is switched off by the admin right now.` };
  if (svc.premiumOnly && plan !== "premium") return { ok: false, message: `${svc.label} is a Premium feature.` };
  const unit = await getFeatureCost(imageCostKey(svc.id));
  if (admin) return { ok: true, unit, admin: true };
  const cap = await monthlyCap(plan);
  const rows: any[] = await storage.getGeneratedImagesByUser(userId);
  const month = new Date().toISOString().slice(0, 7);
  const used = rows.filter((r) => String(r.createdAt || "").startsWith(month)).length;
  if (used + count > cap) return { ok: false, message: `Image limit reached: your ${plan} plan allows ${cap} images a month and you have used ${used}.` };
  const bal = await getOrCreateCredits(userId, plan);
  if (bal.balance < unit * count) return { ok: false, message: `Not enough credits: ${count} image${count > 1 ? "s" : ""} cost ${unit * count} credits and you have ${bal.balance}.` };
  return { ok: true, unit, admin: false };
}
export async function chargeImages(userId: string, unit: number, n: number) { if (n > 0 && unit > 0) await deductCredits(userId, unit * n); }

export async function stabilityBalance(): Promise<{ ok: boolean; credits?: number; error?: string; keyPresent?: boolean }> {
  const key = process.env.STABILITY_API_KEY;
  if (!key) return { ok: false, keyPresent: false, error: "STABILITY_API_KEY is not set on Render. Add it under Environment, then restart the service." };
  try {
    // Primary balance endpoint
    const r = await fetch(`${STAB}/v1/user/balance`, { headers: { Authorization: `Bearer ${key}`, Accept: "application/json" }, signal: AbortSignal.timeout(10000) });
    const text = await r.text().catch(() => "");
    if (!r.ok) {
      if (r.status === 401 || r.status === 403)
        return { ok: false, keyPresent: true, error: `Stability rejected the API key (HTTP ${r.status}). Paste the NEW key into Render env STABILITY_API_KEY and restart.` };
      return { ok: false, keyPresent: true, error: `Stability HTTP ${r.status}: ${text.slice(0, 160)}` };
    }
    let j: any = {};
    try { j = JSON.parse(text); } catch { return { ok: false, keyPresent: true, error: "Stability returned non-JSON balance body" }; }
    // Stability has used several field names over time
    const credits = Number(
      j.credits ?? j.balance ?? j.credit_balance ?? j.credits_remaining ?? j?.data?.credits ?? NaN
    );
    if (!Number.isFinite(credits))
      return { ok: false, keyPresent: true, error: `Could not parse credits from: ${text.slice(0, 120)}` };
    return { ok: true, keyPresent: true, credits };
  } catch (e: any) {
    return { ok: false, keyPresent: true, error: e?.message || "Could not reach Stability" };
  }
}

/** Real end-to-end check of the image providers with the keys on this server (admin button). */
export async function imageSelfTest(): Promise<Record<string, any>> {
  const out: Record<string, any> = {};
  const key = process.env.STABILITY_API_KEY;
  out.stabilityKeyPresent = !!key;
  if (key) {
    try {
      const a = await fetch(`${STAB}/v1/user/account`, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(8000) });
      out.stabilityAccount = a.ok ? "ok" : `HTTP ${a.status}: ${(await a.text()).slice(0, 200)}`;
    } catch (e: any) { out.stabilityAccount = e?.message; }
    out.stabilityBalance = await stabilityBalance();
    // one real, cheap generation (SD 3.5 Flash) so the exact provider error, if any, is shown
    try {
      const svc = getService("sd35_flash")!;
      const img = await runStability(svc, { prompt: "a small blue circle on a white background", aspectRatio: "1:1" });
      out.stabilityGenerate = `ok (${img.buffer.length} bytes)`;
    } catch (e: any) { out.stabilityGenerate = `FAILED: ${e?.message}`; }
  }
  const gk = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
  out.geminiKeyPresent = !!gk;
  if (gk) {
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?pageSize=200&key=${gk}`, { signal: AbortSignal.timeout(10000) });
      const names: string[] = r.ok ? ((await r.json()) as any).models.map((m: any) => String(m.name).replace(/^models\//, "")) : [];
      out.geminiImageModelsOffered = names.filter((n) => /image/i.test(n));
      out.geminiNote = "Image models need a Google AI Studio project with billing enabled. On the free tier their quota is 0.";
    } catch (e: any) { out.geminiImageModelsOffered = e?.message; }
  }
  return out;
}
