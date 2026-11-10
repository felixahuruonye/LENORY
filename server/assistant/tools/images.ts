/** Chat tools for pictures. Ultra/Fast use Stability; Vision uses Google Nano Banana. Nothing is claimed unless an image was really made and saved. */
import type { ToolContext, ToolResult } from "../types";
import { IMAGE_SERVICES, MAX_IMAGES_AT_ONCE } from "../../imageDefaults";
import { getService, runImageService, saveImage, loadOwnImage, imageGate, chargeImages, type ImgInput, type ImgOut } from "../../imageStudio";
import { storeArtifact } from "./index";

const SWITCH = "Switch to LENORY Fast or Ultra for this (Vision makes and edits pictures with Nano Banana, but cannot do this specific job).";
const lane = (ctx: ToolContext) => ctx.lane || "fast";

async function source(ctx: ToolContext, ref?: string): Promise<{ buffer: Buffer; mime: string; id: string } | null> {
  const r = String(ref || "last").trim();
  if (!r || r === "last") return loadOwnImage(ctx.userId, { last: true });
  return loadOwnImage(ctx.userId, /^https?:/.test(r) ? { url: r } : { imageId: r });
}
const fail = (tool: string, msg: string, error = "FAILED"): ToolResult => ({ tool, success: false, summary: msg, error });

async function make(ctx: ToolContext, svcId: string, input: ImgInput): Promise<ImgOut> {
  const svc = getService(svcId)!;
  return runImageService(svc, input);
}

export async function toolGenerateImage(ctx: ToolContext, args: { prompt: string; count?: number; aspect_ratio?: string; quality?: string }): Promise<ToolResult> {
  const prompt = String(args?.prompt || "").trim();
  if (prompt.length < 3) return fail("generate_image", "I need a description of the picture to make.", "EMPTY");
  const l = lane(ctx);
  const count = Math.max(1, Math.min(Number(args?.count) || 1, MAX_IMAGES_AT_ONCE[l]));
  const q = String(args?.quality || (l === "ultra" ? "best" : l === "fast" ? "fast" : "balanced"));
  // Vision → Gemini Nano Banana. Ultra/Fast → Stability first, then Gemini fallback
  // so a zeroed Stability account does not block every picture request.
  const order = l === "vision"
    ? q === "best" ? ["nano_banana_pro", "nano_banana_lite", "nano_banana_lite"] : q === "fast" ? ["nano_banana_lite", "nano_banana_lite"] : ["nano_banana", "nano_banana_lite"]
    : q === "best" ? ["stable_image_ultra", "sd35_large", "sd35_flash", "nano_banana", "nano_banana_lite"]
      : q === "balanced" ? ["sd35_large", "sd35_flash", "stable_image_ultra", "nano_banana", "nano_banana_lite"]
      : ["sd35_flash", "sd35_large", "stable_image_ultra", "nano_banana_lite", "nano_banana"];
  let used = "", gateMsg = "", unit = 0, admin = false;
  for (const id of order) {
    const g = await imageGate(ctx.userId, getService(id)!, count);
    if (g.ok) { used = id; unit = g.unit; admin = g.admin; break; }
    gateMsg = g.message;
  }
  if (!used) return fail("generate_image", gateMsg || "Image generation is not available right now.", "GATE");
  ctx.onStatus?.("generating_image", `${count} image${count > 1 ? "s" : ""} - ${getService(used)!.label}`);
  const results = await Promise.allSettled(Array.from({ length: count }, async () => {
    let out: ImgOut | null = null; const tried: string[] = [];
    for (const id of order.slice(order.indexOf(used))) {
      const label = getService(id)!.label;
      try { out = await make(ctx, id, { prompt, aspectRatio: args?.aspect_ratio }); used = id; break; }
      catch (e) {
        const msg = String((e as any)?.message || e);
        // Every provider's own reason is kept, so the student sees WHY each one failed (not just the last fallback's error).
        if (!tried.some((t) => t.endsWith(msg))) tried.push(`${label}: ${msg}`);
        if (/safety|blocked/i.test(msg)) break;
      }
    }
    if (!out) throw new Error(tried.slice(0, 3).join(" | "));
    return saveImage(ctx.userId, out, { prompt, provider: `${getService(used)!.provider}:${used}` });
  }));
  const ok = results.filter((r): r is PromiseFulfilledResult<{ id: string; url: string }> => r.status === "fulfilled").map((r) => r.value);
  const firstErr = (results.find((r) => r.status === "rejected") as PromiseRejectedResult | undefined)?.reason?.message;
  if (!ok.length) {
    const hint = /out of credits|402|provider account/i.test(String(firstErr || ""))
      ? " Stability provider credits may be empty — an admin must top up at platform.stability.ai and ensure STABILITY_API_KEY on Render matches the new key (then restart). LENORY user credits on /pricing are separate."
      : "";
    return fail("generate_image", `No image was made. ${firstErr || ""}${hint}`.trim(), "PROVIDER");
  }
  if (!admin) await chargeImages(ctx.userId, unit, ok.length);
  return { tool: "generate_image", success: true, images: ok.map((i, n) => ({ url: i.url, id: i.id, title: `${prompt.slice(0, 60)}${ok.length > 1 ? ` (${n + 1})` : ""}` })),
    summary: `Made ${ok.length} of ${count} image(s) with ${getService(used)!.label}. They are already shown in the chat and saved to the student's image history - do not paste links.${ok.length < count ? ` ${count - ok.length} failed: ${firstErr}.` : ""} Charged ${admin ? 0 : unit * ok.length} credits.`, data: { ids: ok.map((i) => i.id) } };
}

export async function toolEditImage(ctx: ToolContext, args: { operation: string; source?: string; prompt?: string; search_prompt?: string; select_prompt?: string; background_prompt?: string; left?: number; right?: number; up?: number; down?: number }): Promise<ToolResult> {
  const op = String(args?.operation || "");
  const l = lane(ctx);
  const img = await source(ctx, args?.source);
  if (!img) return fail("edit_image", "I could not find that picture in your image history. Generate one first, or say which one to edit.", "NO_SOURCE");
  // Vision: Nano Banana edits with a plain instruction
  if (l === "vision") {
    if (!args?.prompt) return fail("edit_image", "Tell me what to change in the picture.", "EMPTY");
    const g = await imageGate(ctx.userId, getService("nano_banana")!, 1);
    if (!g.ok) return fail("edit_image", g.message, "GATE");
    ctx.onStatus?.("generating_image", "Editing image - Nano Banana");
    try {
      const out = await runNanoBanana(getService("nano_banana")!, { prompt: args.prompt, image: { buffer: img.buffer, mime: img.mime } });
      const saved = await saveImage(ctx.userId, out, { prompt: `Edit: ${args.prompt}`, provider: "gemini:nano_banana" });
      if (!g.admin) await chargeImages(ctx.userId, g.unit, 1);
      return { tool: "edit_image", success: true, images: [{ url: saved.url, id: saved.id, title: `Edited: ${args.prompt.slice(0, 50)}` }], summary: `Edited the picture with Nano Banana. The result is shown in the chat; the original is unchanged. Charged ${g.admin ? 0 : g.unit} credits.` };
    } catch (e: any) { return fail("edit_image", `The edit failed: ${e?.message}`, "PROVIDER"); }
  }
  const map: Record<string, string> = { remove_background: "remove_background", search_replace: "search_replace", search_recolor: "search_recolor", outpaint: "outpaint", erase: "erase", inpaint: "inpaint", replace_background: "replace_bg_relight" };
  const id = map[op];
  if (!id) return fail("edit_image", `Unknown edit "${op}". Use: ${Object.keys(map).join(", ")}.`, "BAD_OP");
  const svc = getService(id)!;
  const g = await imageGate(ctx.userId, svc, 1);
  if (!g.ok) return fail("edit_image", g.message, "GATE");
  ctx.onStatus?.("generating_image", `Editing image - ${svc.label}`);
  try {
    const out = await runStability(svc, {
      prompt: args.prompt, image: { buffer: img.buffer, mime: img.mime },
      params: { search_prompt: args.search_prompt, select_prompt: args.select_prompt, background_prompt: args.background_prompt || args.prompt, left: args.left, right: args.right, up: args.up, down: args.down },
    });
    const saved = await saveImage(ctx.userId, out, { prompt: `${svc.label}: ${args.prompt || args.search_prompt || ""}`, provider: `stability:${id}` });
    if (!g.admin) await chargeImages(ctx.userId, g.unit, 1);
    return { tool: "edit_image", success: true, images: [{ url: saved.url, id: saved.id, title: svc.label }], summary: `${svc.label} done. The result is shown in the chat and saved to the image history; the original is unchanged. Charged ${g.admin ? 0 : g.unit} credits.` };
  } catch (e: any) { return fail("edit_image", `${svc.label} failed: ${e?.message}`, "PROVIDER"); }
}

export async function toolUpscaleImage(ctx: ToolContext, args: { mode?: string; source?: string; prompt?: string }): Promise<ToolResult> {
  if (lane(ctx) === "vision") return fail("upscale_image", SWITCH, "WRONG_MODE");
  const svc = getService(args?.mode === "creative" ? "upscale_creative" : "upscale_fast")!;
  const img = await source(ctx, args?.source);
  if (!img) return fail("upscale_image", "I could not find that picture in your image history.", "NO_SOURCE");
  const g = await imageGate(ctx.userId, svc, 1);
  if (!g.ok) return fail("upscale_image", g.message, "GATE");
  ctx.onStatus?.("generating_image", `Upscaling - ${svc.label}`);
  try {
    const out = await runStability(svc, { prompt: args.prompt, image: { buffer: img.buffer, mime: img.mime } });
    const saved = await saveImage(ctx.userId, out, { prompt: `${svc.label}`, provider: `stability:${svc.id}` });
    if (!g.admin) await chargeImages(ctx.userId, g.unit, 1);
    return { tool: "upscale_image", success: true, images: [{ url: saved.url, id: saved.id, title: svc.label }], summary: `${svc.label} done and shown in the chat. Charged ${g.admin ? 0 : g.unit} credits.` };
  } catch (e: any) { return fail("upscale_image", `Upscaling failed: ${e?.message}`, "PROVIDER"); }
}

export async function toolControlImage(ctx: ToolContext, args: { mode: string; source?: string; style_source?: string; prompt?: string; strength?: number }): Promise<ToolResult> {
  if (lane(ctx) === "vision") return fail("control_image", SWITCH, "WRONG_MODE");
  const map: Record<string, string> = { sketch: "sketch", structure: "structure", style_guide: "style_guide", style_transfer: "style_transfer" };
  const id = map[String(args?.mode)];
  if (!id) return fail("control_image", `Unknown mode. Use: ${Object.keys(map).join(", ")}.`, "BAD_OP");
  const svc = getService(id)!;
  const img = await source(ctx, args?.source);
  if (!img) return fail("control_image", "I could not find that picture in your image history.", "NO_SOURCE");
  const style = id === "style_transfer" ? await source(ctx, args?.style_source) : null;
  if (id === "style_transfer" && !style) return fail("control_image", "Style Transfer needs a second picture to copy the style from (style_source).", "NO_SOURCE");
  const g = await imageGate(ctx.userId, svc, 1);
  if (!g.ok) return fail("control_image", g.message, "GATE");
  ctx.onStatus?.("generating_image", `${svc.label}`);
  try {
    const out = await runStability(svc, { prompt: args.prompt, image: { buffer: img.buffer, mime: img.mime }, styleImage: style ? { buffer: style.buffer, mime: style.mime } : undefined, params: { control_strength: args.strength } });
    const saved = await saveImage(ctx.userId, out, { prompt: `${svc.label}: ${args.prompt || ""}`, provider: `stability:${id}` });
    if (!g.admin) await chargeImages(ctx.userId, g.unit, 1);
    return { tool: "control_image", success: true, images: [{ url: saved.url, id: saved.id, title: svc.label }], summary: `${svc.label} done and shown in the chat. Charged ${g.admin ? 0 : g.unit} credits.` };
  } catch (e: any) { return fail("control_image", `${svc.label} failed: ${e?.message}`, "PROVIDER"); }
}

export async function toolImageTo3D(ctx: ToolContext, args: { source?: string }): Promise<ToolResult> {
  if (lane(ctx) === "vision") return fail("image_to_3d", SWITCH, "WRONG_MODE");
  const svc = getService("spar3d")!;
  const img = await source(ctx, args?.source);
  if (!img) return fail("image_to_3d", "I could not find that picture in your image history.", "NO_SOURCE");
  const g = await imageGate(ctx.userId, svc, 1);
  if (!g.ok) return fail("image_to_3d", g.message, "GATE");
  ctx.onStatus?.("generating_image", "Building 3D model - Stable Point Aware 3D");
  try {
    const out = await runStability(svc, { image: { buffer: img.buffer, mime: img.mime } });
    const artifact = await (storeArtifact as any)(ctx.userId, null, { buffer: out.buffer, mimeType: "model/gltf-binary", fileName: `model-${Date.now()}.glb` });
    if (!g.admin) await chargeImages(ctx.userId, g.unit, 1);
    return { tool: "image_to_3d", success: true, artifacts: [artifact], summary: `3D model (GLB) made and ready to download. Charged ${g.admin ? 0 : g.unit} credits.` };
  } catch (e: any) { return fail("image_to_3d", `3D model failed: ${e?.message}`, "PROVIDER"); }
}
void IMAGE_SERVICES;
