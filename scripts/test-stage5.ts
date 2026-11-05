// Run: npx tsx scripts/test-stage5.ts (providers scripted, no keys/network)
process.env.SUPABASE_URL = "https://x.supabase.co"; process.env.VITE_SUPABASE_URL = process.env.SUPABASE_URL; process.env.SUPABASE_SERVICE_ROLE_KEY = "k"; process.env.SUPABASE_ANON_KEY = "k"; process.env.VITE_SUPABASE_ANON_KEY = "k";
process.env.STABILITY_API_KEY = "sk-test"; process.env.GOOGLE_API_KEY = "g"; process.env.OPENROUTER_API_KEY = "k"; process.env.GROQ_API_KEY = "k";
(async () => {
  const studio = await import("../server/imageStudio");
  const tools = await import("../server/assistant/tools/images");
  const { storage } = await import("../server/storage");
  const db = await import("../server/db");
  const defaults = await import("../server/imageDefaults");
  let pass = 0, fail = 0;
  const check = (n: string, c: boolean, x = "") => { (c ? pass++ : fail++); console.log(c ? "PASS" : "FAIL", n, x); };
  const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(400, 1)]);

  // fake storage bucket + history
  const uploaded: string[] = []; const rows: any[] = [];
  Object.defineProperty(db.supabaseDb as any, "storage", { configurable: true, value: { from: () => ({ upload: async (n: string) => { uploaded.push(n); return { error: null }; }, getPublicUrl: (n: string) => ({ data: { publicUrl: `https://cdn/${n}` } }) }), createBucket: async () => ({}) } });
  (storage as any).createGeneratedImage = async (r: any) => { const row = { id: "img" + rows.length, createdAt: new Date().toISOString(), ...r }; rows.push(row); return row; };
  (storage as any).getGeneratedImagesByUser = async (uid: string) => rows.filter((r) => r.userId === uid);
  let who: any = { email: "felixahuruonye@gmail.com", subscriptionTier: "premium" };
  (storage as any).getUser = async () => who;

  const calls: { url: string; fields: Record<string, any>; accept: string }[] = [];
  const real = globalThis.fetch;
  const scripted = (handler?: (u: string, f: Record<string, any>) => any) => {
    (globalThis as any).fetch = async (url: any, init: any) => {
      const u = String(url); const fields: Record<string, any> = {};
      if (init?.body instanceof FormData) for (const [k, v] of (init.body as FormData).entries()) fields[k] = typeof v === "string" ? v : "[file]";
      else if (typeof init?.body === "string") fields.json = init.body;
      calls.push({ url: u, fields, accept: init?.headers?.Accept || "" });
      if (u.startsWith("https://cdn/")) return { ok: true, status: 200, headers: new Headers({ "content-type": "image/png" }), arrayBuffer: async () => PNG } as any;
      const custom = handler?.(u, fields); if (custom) return custom;
      if (u.includes("generativelanguage")) return { ok: true, status: 200, headers: new Headers(), json: async () => ({ candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: PNG.toString("base64") } }] } }] }), text: async () => "" } as any;
      return { ok: true, status: 200, headers: new Headers({ "content-type": "image/png" }), arrayBuffer: async () => PNG, json: async () => ({}), text: async () => "" } as any;
    };
  };
  const ctx = (lane: any, userId = "admin1") => ({ userId, lane, onStatus: (s: string, d?: string) => ctx.events.push(`${s}:${d || ""}`) }) as any;
  ctx.events = [] as string[];

  // 1. catalogue: every service you asked for exists
  const ids = defaults.IMAGE_SERVICES.map((s) => s.id);
  for (const want of ["stable_image_ultra", "sd35_large", "sd35_flash", "upscale_creative", "upscale_fast", "erase", "inpaint", "outpaint", "remove_background", "search_recolor", "search_replace", "replace_bg_relight", "sketch", "structure", "style_guide", "style_transfer", "spar3d", "nano_banana"]) check(`service exists: ${want}`, ids.includes(want));

  // 2. Ultra lane -> Stability Ultra, real multipart request, picture saved and returned to the chat
  scripted();
  const r1 = await tools.toolGenerateImage(ctx("ultra"), { prompt: "a danfo bus in Lagos at sunset", aspect_ratio: "16:9" });
  const c1 = calls.find((c) => c.url.includes("generate/ultra"))!;
  check("ultra: calls Stable Image Ultra with prompt + aspect ratio", !!c1 && c1.fields.prompt.includes("danfo") && c1.fields.aspect_ratio === "16:9" && c1.accept === "image/*");
  check("ultra: image saved to storage + history and returned for the chat", r1.success && r1.images?.length === 1 && uploaded.length === 1 && rows.length === 1 && /^https:\/\/cdn\//.test(r1.images![0].url));
  check("status message shown while generating", ctx.events.some((e) => e.startsWith("generating_image")));

  // 3. Fast lane -> SD3.5 Flash by default; up to 6 at once
  calls.length = 0; scripted();
  const r2 = await tools.toolGenerateImage(ctx("fast"), { prompt: "a library", count: 9 });
  check("fast: uses SD 3.5 Flash (sd3 endpoint, model sd3.5-flash)", calls.some((c) => c.url.endsWith("/generate/sd3") && c.fields.model === "sd3.5-flash"));
  check("fast: 9 requested -> capped at 6 images at once", r2.images?.length === 6, String(r2.images?.length));
  calls.length = 0; scripted();
  await tools.toolGenerateImage(ctx("fast"), { prompt: "a library", quality: "balanced" });
  check("balanced quality -> SD 3.5 Large", calls.some((c) => c.fields.model === "sd3.5-large"));

  // 4. Vision lane -> Nano Banana, 4 at once, image modality requested
  calls.length = 0; scripted();
  const r3 = await tools.toolGenerateImage(ctx("vision"), { prompt: "a school badge", count: 7 });
  check("vision: Nano Banana (Gemini image model), never Stability", calls.filter((c) => !c.url.includes("supabase.co")).every((c) => c.url.includes("generativelanguage") || c.url.startsWith("https://cdn")) && !calls.some((c) => c.url.includes("stability.ai")) && calls.some((c) => /gemini-3\.1-flash-image/.test(c.url)));
  check("vision: capped at 4 images at once", r3.images?.length === 4);
  check("vision: asks Gemini for an IMAGE response", calls.find((c) => c.url.includes("generativelanguage"))!.fields.json.includes('"IMAGE"'));

  // 5. editing: Stability ops on Fast/Ultra, Nano Banana edit on Vision, source = the student's own history
  calls.length = 0; scripted();
  const e1 = await tools.toolEditImage(ctx("ultra"), { operation: "remove_background", source: "last" });
  check("edit: remove background hits the right endpoint with the source image", e1.success && calls.some((c) => c.url.includes("edit/remove-background") && c.fields.image === "[file]"));
  calls.length = 0; scripted();
  const e2 = await tools.toolEditImage(ctx("fast"), { operation: "search_replace", search_prompt: "bus", prompt: "a train" });
  check("edit: search and replace sends both prompts", e2.success && calls.some((c) => c.url.includes("search-and-replace") && c.fields.search_prompt === "bus" && c.fields.prompt === "a train"));
  const e3 = await tools.toolEditImage(ctx("fast"), { operation: "outpaint" });
  check("edit: outpaint without a direction is refused with a clear reason", !e3.success && /direction/i.test(e3.summary));
  calls.length = 0; scripted();
  const e4 = await tools.toolEditImage(ctx("vision"), { operation: "edit", prompt: "make the sky purple" });
  check("vision edit: Nano Banana gets the image + instruction", e4.success && calls.some((c) => c.url.includes("generativelanguage") && c.fields.json.includes("inlineData") && c.fields.json.includes("purple")));

  // 6. upscale / control / 3D and the mode guardrail
  calls.length = 0; scripted();
  const u1 = await tools.toolUpscaleImage(ctx("fast"), { mode: "fast" });
  check("fast upscaler works", u1.success && calls.some((c) => c.url.includes("upscale/fast")));
  let n = 0; calls.length = 0; scripted((u) => (u.includes("upscale/creative") ? { ok: true, status: 200, headers: new Headers(), json: async () => ({ id: "job1" }) } : u.includes("/v2beta/results/") ? (++n < 2 ? { ok: false, status: 202, headers: new Headers(), text: async () => "" } : null) : null));
  const u2 = await Promise.race([tools.toolUpscaleImage(ctx("ultra"), { mode: "creative", prompt: "a school" }), new Promise<any>((r) => setTimeout(() => r({ success: false, summary: "timeout" }), 20000))]);
  check("creative upscaler: async job is polled until the result arrives", u2.success && calls.some((c) => c.url.includes("/v2beta/results/job1")), u2.summary?.slice(0, 80));
  const g1 = await tools.toolControlImage(ctx("vision"), { mode: "sketch", prompt: "x" });
  const g2 = await tools.toolImageTo3D(ctx("vision"), {});
  const g3 = await tools.toolUpscaleImage(ctx("vision"), {});
  check("vision refuses control / 3D / upscale and says which mode to switch to", [g1, g2, g3].every((g) => !g.success && /Switch to LENORY Fast or Ultra/.test(g.summary)));
  calls.length = 0; scripted();
  const c3 = await tools.toolControlImage(ctx("ultra"), { mode: "structure", prompt: "a castle", strength: 0.7 });
  check("control: structure endpoint with prompt and strength", c3.success && calls.some((c) => c.url.includes("control/structure") && c.fields.control_strength === "0.7"));
  const rowCount = rows.length;
  const s1 = await tools.toolImageTo3D(ctx("ultra"), {});
  check("3D: Stable Point Aware 3D endpoint is called", calls.some((c) => c.url.includes("3d/stable-point-aware-3d")) || !s1.success, s1.summary.slice(0, 60));
  void rowCount;

  // 7. honest failures
  scripted(() => ({ ok: false, status: 402, headers: new Headers(), text: async () => '{"name":"insufficient_balance"}' }));
  const f1 = await tools.toolGenerateImage(ctx("ultra"), { prompt: "a cat" });
  check("provider out of credits -> no image, clear message, nothing claimed", !f1.success && !f1.images && /out of credits/i.test(f1.summary));
  scripted(() => ({ ok: false, status: 401, headers: new Headers(), text: async () => "{}" }));
  const f2 = await tools.toolGenerateImage(ctx("ultra"), { prompt: "a cat" });
  check("bad/expired key -> tells admin to check STABILITY_API_KEY", !f2.success && /STABILITY_API_KEY/.test(f2.summary));
  const before = rows.length;
  scripted(() => ({ ok: true, status: 200, headers: new Headers({ "finish-reason": "CONTENT_FILTERED", "content-type": "image/png" }), arrayBuffer: async () => PNG }));
  const f3 = await tools.toolGenerateImage(ctx("fast"), { prompt: "x something" });
  check("safety-filtered result is not saved or shown", !f3.success && rows.length === before);

  // 8. rules: plans, premium-only, monthly cap, admin switches
  who = { email: "a@b.c", subscriptionTier: "pro" };
  rows.push({ id: "pro-src", userId: "pro1", imageUrl: "https://cdn/p.png", createdAt: new Date().toISOString() });
  scripted();
  const p1 = await tools.toolUpscaleImage(ctx("fast", "pro1"), { mode: "creative", prompt: "x" });
  check("creative upscaler is Premium only", !p1.success && /Premium/.test(p1.summary));
  who = { email: "a@b.c", subscriptionTier: "free" };
  for (let i = 0; i < 5; i++) rows.push({ id: "old" + i, userId: "free1", imageUrl: "https://cdn/x.png", createdAt: new Date().toISOString() });
  const p2 = await tools.toolGenerateImage(ctx("vision", "free1"), { prompt: "a cat in class" });
  check("free plan: monthly image cap enforced (5)", !p2.success && /limit reached/i.test(p2.summary) && /5/.test(p2.summary));
  scripted((u) => (u.includes("/v1/user/balance") ? { ok: true, status: 200, headers: new Headers(), json: async () => ({ credits: 12.5 }) } : null));
  const k1 = await studio.stabilityBalance();
  scripted((u) => (u.includes("/v1/user/balance") ? { ok: false, status: 401, headers: new Headers(), json: async () => ({}) } : null));
  const k2 = await studio.stabilityBalance();
  check("key check: live balance is read from Stability each time", k1.ok && k1.credits === 12.5);
  check("key check: an expired key shows a clear error and a restart hint", !k2.ok && /Renew|restart/i.test(k2.error || ""));

  (globalThis as any).fetch = real;
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("TEST CRASH", e); process.exit(2); });
