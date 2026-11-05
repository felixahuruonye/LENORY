/**
 * Image service catalogue defaults (pure data, no imports).
 * credits = what LENORY charges the student; providerUsd = what the provider charges us.
 * Stability: 1 provider credit = $0.01 (docs.stability.ai/pricing). Google prices from ai.google.dev.
 * Every number here is only a DEFAULT: admins change them in Admin > Credit Usage > Image controls.
 */
export type ImageKind = "generate" | "upscale" | "edit" | "control" | "3d";
export interface ImageService {
  id: string; label: string; kind: ImageKind; provider: "stability" | "gemini";
  path?: string; model?: string; async?: boolean; providerUsd: number; credits: number; premiumOnly?: boolean;
  help: string;
}
export const IMAGE_SERVICES: ImageService[] = [
  // --- Stability: generate
  { id: "stable_image_ultra", label: "Stable Image Ultra", kind: "generate", provider: "stability", path: "/v2beta/stable-image/generate/ultra", providerUsd: 0.08, credits: 45, help: "Highest quality and detail" },
  { id: "sd35_large", label: "Stable Diffusion 3.5 Large", kind: "generate", provider: "stability", path: "/v2beta/stable-image/generate/sd3", model: "sd3.5-large", providerUsd: 0.065, credits: 35, help: "Very good quality, follows prompts well" },
  { id: "sd35_flash", label: "Stable Diffusion 3.5 Flash", kind: "generate", provider: "stability", path: "/v2beta/stable-image/generate/sd3", model: "sd3.5-flash", providerUsd: 0.025, credits: 15, help: "Fast and cheap, good for drafts" },
  // --- Stability: upscale
  { id: "upscale_fast", label: "Fast Upscaler", kind: "upscale", provider: "stability", path: "/v2beta/stable-image/upscale/fast", providerUsd: 0.02, credits: 10, help: "4x bigger, up to 4 megapixels" },
  { id: "upscale_creative", label: "Creative Upscaler", kind: "upscale", provider: "stability", path: "/v2beta/stable-image/upscale/creative", async: true, providerUsd: 0.6, credits: 320, premiumOnly: true, help: "Turns a low-quality picture into a 4K image (slow and costly)" },
  // --- Stability: edit
  { id: "erase", label: "Erase Object", kind: "edit", provider: "stability", path: "/v2beta/stable-image/edit/erase", providerUsd: 0.05, credits: 30, help: "Remove an unwanted object (needs a mask or transparent area)" },
  { id: "inpaint", label: "Inpaint", kind: "edit", provider: "stability", path: "/v2beta/stable-image/edit/inpaint", providerUsd: 0.05, credits: 30, help: "Replace a masked area with something new" },
  { id: "outpaint", label: "Outpaint", kind: "edit", provider: "stability", path: "/v2beta/stable-image/edit/outpaint", providerUsd: 0.04, credits: 25, help: "Extend the picture in any direction" },
  { id: "remove_background", label: "Remove Background", kind: "edit", provider: "stability", path: "/v2beta/stable-image/edit/remove-background", providerUsd: 0.05, credits: 30, help: "Cut out the subject" },
  { id: "search_recolor", label: "Search and Recolor", kind: "edit", provider: "stability", path: "/v2beta/stable-image/edit/search-and-recolor", providerUsd: 0.05, credits: 30, help: "Change the colour of an object by naming it" },
  { id: "search_replace", label: "Search and Replace", kind: "edit", provider: "stability", path: "/v2beta/stable-image/edit/search-and-replace", providerUsd: 0.05, credits: 30, help: "Find an object by name and replace it" },
  { id: "replace_bg_relight", label: "Replace Background and Relight", kind: "edit", provider: "stability", path: "/v2beta/stable-image/edit/replace-background-and-relight", async: true, providerUsd: 0.08, credits: 48, help: "New background with matching lighting" },
  // --- Stability: control
  { id: "sketch", label: "Control: Sketch", kind: "control", provider: "stability", path: "/v2beta/stable-image/control/sketch", providerUsd: 0.05, credits: 30, help: "Turn a sketch into a finished image" },
  { id: "structure", label: "Control: Structure", kind: "control", provider: "stability", path: "/v2beta/stable-image/control/structure", providerUsd: 0.05, credits: 30, help: "Keep the layout of an image, change the content" },
  { id: "style_guide", label: "Control: Style Guide", kind: "control", provider: "stability", path: "/v2beta/stable-image/control/style", providerUsd: 0.05, credits: 30, help: "Use another image's style for a new picture" },
  { id: "style_transfer", label: "Control: Style Transfer", kind: "control", provider: "stability", path: "/v2beta/stable-image/control/style-transfer", providerUsd: 0.08, credits: 48, help: "Apply a reference style to your image" },
  // --- Stability: 3D
  { id: "spar3d", label: "Stable Point Aware 3D", kind: "3d", provider: "stability", path: "/v2beta/3d/stable-point-aware-3d", providerUsd: 0.04, credits: 25, help: "Turn one picture into a 3D model (GLB)" },
  // --- Google Nano Banana (Vision lane)
  { id: "nano_banana_lite", label: "Nano Banana 2 Lite", kind: "generate", provider: "gemini", model: "gemini-3.1-flash-lite-image", providerUsd: 0.034, credits: 20, help: "Cheapest Gemini image model (1K)" },
  { id: "nano_banana", label: "Nano Banana 2", kind: "generate", provider: "gemini", model: "gemini-3.1-flash-image", providerUsd: 0.067, credits: 40, help: "Everyday generation and editing" },
  { id: "nano_banana_pro", label: "Nano Banana Pro", kind: "generate", provider: "gemini", model: "gemini-3-pro-image", providerUsd: 0.134, credits: 80, premiumOnly: true, help: "Best text in images and detailed work" },
];
export const IMAGE_CAP_DEFAULTS = { image_cap_free: 5, image_cap_pro: 50, image_cap_premium: 150 };
export const imageCostKey = (id: string) => `img_${id}`;
export const imageOnKey = (id: string) => `img_on_${id}`;
/** Everything the credits store should know about by default. */
export function imageFeatureDefaults(): Record<string, number> {
  const d: Record<string, number> = { img_master: 1, ...IMAGE_CAP_DEFAULTS };
  for (const s of IMAGE_SERVICES) { d[imageCostKey(s.id)] = s.credits; d[imageOnKey(s.id)] = 1; }
  return d;
}
export const MAX_IMAGES_AT_ONCE = { ultra: 6, fast: 6, vision: 4 } as const;
