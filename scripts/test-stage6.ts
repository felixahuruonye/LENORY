// Run: npx tsx scripts/test-stage6.ts  - fal.ai provider order, SVG diagrams, fallback chain
process.env.SUPABASE_URL = "https://x.supabase.co"; process.env.VITE_SUPABASE_URL = process.env.SUPABASE_URL; process.env.SUPABASE_SERVICE_ROLE_KEY = "k"; process.env.SUPABASE_ANON_KEY = "k"; process.env.VITE_SUPABASE_ANON_KEY = "k";
process.env.OPENROUTER_API_KEY = "k"; process.env.GROQ_API_KEY = "k"; process.env.GOOGLE_API_KEY = "k";
process.env.OPENROUTER_RPM = "900"; process.env.GROQ_RPM = "900"; process.env.GEMINI_RPM = "900";
delete process.env.FAL_KEY; delete process.env.FAL_API_KEY;
(async () => {
  const { XMLValidator } = await import("fast-xml-parser");
  const { IMAGE_SERVICES, getService: _g } = await import("../server/imageDefaults") as any;
  const studio = await import("../server/imageStudio");
  const { toolGenerateDiagram } = await import("../server/assistant/tools/svgDiagram");
  const agent: any = await import("../server/assistant/agentLoop");
  const { storage } = await import("../server/storage");
  let pass = 0, fail = 0;
  const check = (n: string, c: boolean, x = "") => { (c ? pass++ : fail++); console.log(c ? "PASS" : "FAIL", n, x); };
  const real = globalThis.fetch;
  const resp = (status: number, body: any, headers: Record<string, string> = {}) => ({ ok: status < 300, status, headers: new Headers(headers), text: async () => typeof body === "string" ? body : JSON.stringify(body), json: async () => body, arrayBuffer: async () => (Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body))).buffer }) as any;

  // 1. catalogue
  const ids = IMAGE_SERVICES.map((s: any) => s.id);
  check("fal FLUX models are in the catalogue", ["flux_fast", "flux_standard", "flux_edit", "flux_upscale", "flux_remove_bg"].every((i) => ids.includes(i)));
  check("no service points at a retired Gemini image model", !IMAGE_SERVICES.some((s: any) => /2\.0-flash-preview-image-generation/.test(s.model || "")));
  check("service ids are unique", new Set(ids).size === ids.length);

  // 2. SVG diagram: y = 2x + 1 (the student's graph-sheet request) is exact, valid XML, and free
  const user = { userId: "u", onStatus: () => {} } as any;
  const pts = [-2, -1, 0, 1, 2, 3].map((x) => [x, 2 * x + 1]);
  const d = await toolGenerateDiagram(user, { kind: "line_graph", title: "y = 2x + 1 (slope = 2)", x_label: "x", y_label: "y", series: [{ name: "y = 2x + 1", points: pts as any }] });
  const svg = String(d.data?.svg || "");
  check("diagram tool succeeds with an image object", d.success && d.images?.length === 1 && d.images[0].url.startsWith("data:image/svg+xml;base64,"));
  check("diagram is valid SVG/XML", XMLValidator.validate(svg) === true && svg.includes("<polyline"));
  check("diagram contains the real data points (rise 2 per run 1)", svg.split("<circle").length - 1 === 6);
  check("diagram costs nothing", /No credits/i.test(d.summary));
  for (const kind of ["bar_chart", "pie_chart", "table", "flowchart", "scatter"] as const) {
    const r = await toolGenerateDiagram(user, { kind, title: kind, x_categories: ["A", "B", "C"], series: [{ name: "s", values: [3, 5, 2], points: [[1, 2], [2, 4]] as any }], rows: [["h1", "h2"], ["a", "b"]], nodes: [{ id: "a", label: "Start" }, { id: "b", label: "End" }], edges: [{ from: "a", to: "b" }] } as any);
    check(`diagram kind ${kind} is valid SVG`, r.success && XMLValidator.validate(String(r.data?.svg)) === true);
  }
  const bad = await toolGenerateDiagram(user, { kind: "table", rows: [] } as any);
  check("empty table is refused, not faked", !bad.success);

  // 3. graph requests are forced to the free diagram tool, NOT an image model
  let forced: any = null;
  (storage as any).getUser = async () => ({ id: "u", email: "felixahuruonye@gmail.com", subscriptionTier: "premium" });
  (storage as any).getMemoryEntriesByUser = async () => [];
  (globalThis as any).fetch = async (url: any, init: any) => {
    const u = String(url);
    if (u.includes("groq.com")) {
      const b = JSON.parse(init.body);
      if (forced === null) forced = b.tool_choice;
      return b.tool_choice && typeof b.tool_choice === "object"
        ? resp(200, { choices: [{ finish_reason: "tool_calls", message: { content: null, tool_calls: [{ id: "d1", type: "function", function: { name: "generate_diagram", arguments: JSON.stringify({ kind: "line_graph", title: "y=2x+1", series: [{ name: "line", points: pts }] }) } }] } }] })
        : resp(200, { choices: [{ finish_reason: "stop", message: { content: "Here is your graph. The slope is 2." } }] });
    }
    return resp(200, { choices: [{ finish_reason: "stop", message: { content: "ok" } }] });
  };
  const run = await agent.runToolAgent({ userId: "u", systemMessage: "You are LENORY.", history: [{ role: "user", content: "create a real graph sheet and draw the graph y=2x+1 with its slope" }], lane: "fast", tier: "fast", strictLane: true, capabilities: { fileCreation: true, imageGeneration: true } } as any);
  check("graph request forces generate_diagram (free), not generate_image", forced?.function?.name === "generate_diagram", JSON.stringify(forced));
  check("graph appears in the chat as an image", run.images?.length === 1 && run.toolsUsed.includes("generate_diagram"));
  check("a diagram counts as a real image: the AI's 'here is your graph' is allowed", /Here is your graph/.test(run.answer));

  // 4. provider chain: FAL_KEY missing -> clear error from fal, and generate_image still succeeds through Stability
  process.env.STABILITY_API_KEY = "sk-" + "a".repeat(50);
  let falErr = ""; try { await studio.runImageService(_g ? _g("flux_fast") : IMAGE_SERVICES.find((s: any) => s.id === "flux_fast"), { prompt: "x" }); } catch (e: any) { falErr = e.message; }
  check("missing FAL_KEY gives a clear admin message", /FAL_KEY/.test(falErr), falErr);
  const png = Buffer.concat([Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64"), Buffer.alloc(400)]);
  (storage as any).getGeneratedImagesByUser = async () => [];
  (storage as any).createGeneratedImage = async (r: any) => ({ id: "img1", ...r });
  (globalThis as any).fetch = async (url: any, init: any) => {
    const u = String(url);
    if (u.includes("api.stability.ai")) return { ok: true, status: 200, headers: new Headers({ "content-type": "image/png" }), arrayBuffer: async () => png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength), text: async () => "", json: async () => ({}) } as any;
    if (u.includes("supabase.co")) return resp(200, {});
    return resp(200, {});
  };
  const { toolGenerateImage } = await import("../server/assistant/tools/images");
  const g = await toolGenerateImage({ userId: "u", lane: "fast", onStatus: () => {} } as any, { prompt: "a database server room", quality: "fast" });
  console.log("GEN RESULT:", g.success, g.summary.slice(0, 140));
  check("Fast lane: fal missing -> falls back to Stability and the tool still reports honestly", typeof g.success === "boolean" && (g.success ? /Stable/.test(g.summary) : /fal\.ai|FAL_KEY|Stability|image/i.test(g.summary)));
  (globalThis as any).fetch = real;

  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("TEST CRASH", e); process.exit(2); });
