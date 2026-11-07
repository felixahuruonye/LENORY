// Run: npx tsx scripts/test-stage5.ts - reproduces the real production failures from the Render logs.
process.env.SUPABASE_URL = "https://x.supabase.co"; process.env.VITE_SUPABASE_URL = process.env.SUPABASE_URL; process.env.SUPABASE_SERVICE_ROLE_KEY = "k"; process.env.SUPABASE_ANON_KEY = "k"; process.env.VITE_SUPABASE_ANON_KEY = "k";
process.env.OPENROUTER_API_KEY = "k"; process.env.GROQ_API_KEY = "k"; process.env.GOOGLE_API_KEY = "k";
process.env.OPENROUTER_RPM = "900"; process.env.GROQ_RPM = "900"; process.env.GEMINI_RPM = "900";
(async () => {
  const router = await import("../server/aiRouter");
  const agent: any = await import("../server/assistant/agentLoop");
  const img = await import("../server/imageStudio");
  let pass = 0, fail = 0;
  const check = (n: string, c: boolean, x = "") => { (c ? pass++ : fail++); console.log(c ? "PASS" : "FAIL", n, x); };
  const real = globalThis.fetch;
  const resp = (status: number, body: any, headers: Record<string, string> = {}) => ({ ok: status < 300, status, headers: new Headers(headers), text: async () => typeof body === "string" ? body : JSON.stringify(body), json: async () => body, clone() { return resp(status, body, headers); } }) as any;
  const clearAll = () => { const c = (router as any).__cooldownsForTest(); for (const k of [...c.keys()]) c.delete(k); };

  // 1. the tool list the models receive has NO duplicate names (Gemini rejects duplicates with HTTP 400)
  const names: string[] = agent.__defsForTest().map((d: any) => d.schema.function.name);
  const dups = names.filter((n, i) => names.indexOf(n) !== i);
  check("tool list has unique names (the bug that broke every Vision call)", dups.length === 0, dups.join(","));

  // 2. a malformed-request 400 must NOT put a lane to rest for 10 minutes
  clearAll();
  (globalThis as any).fetch = async () => resp(400, { error: { code: 400, message: "Duplicate function declaration found: generate_image" } });
  const tool = { type: "function", function: { name: "generate_image", description: "d", parameters: { type: "object", properties: { prompt: { type: "string" } } } } } as any;
  let e1 = ""; try { await router.chatWithLane([{ role: "user", content: "hi" }] as any, [tool], "vision", true); } catch (e: any) { e1 = e.message; }
  const vis = router.getLaneStatuses().find((l) => l.lane === "vision")!;
  check("HTTP 400 is reported but the lane is NOT marked resting", /LANE_TEMPORARY/.test(e1) && vis.available, e1.slice(0, 60));

  // 3. Gemini never receives duplicate function declarations, even if the list has one
  let sentNames: string[] = [];
  (globalThis as any).fetch = async (_u: any, init: any) => { const b = JSON.parse(init.body); sentNames = (b.tools?.[0]?.functionDeclarations || []).map((f: any) => f.name); return resp(200, { candidates: [{ finishReason: "STOP", content: { role: "model", parts: [{ text: "ok" }] } }] }); };
  await router.chatWithLane([{ role: "user", content: "hi" }] as any, [tool, tool, tool], "vision", true);
  check("Gemini request has unique function declarations", sentNames.length === 1 && sentNames[0] === "generate_image");

  // 4. the real tool schemas translate into a Gemini request with unique names
  const realSchemas = agent.__defsForTest().map((d: any) => d.schema);
  await router.chatWithLane([{ role: "user", content: "hi" }] as any, realSchemas, "vision", true);
  check("all real tools sent to Gemini are unique", new Set(sentNames).size === sentNames.length && sentNames.length > 5, `${sentNames.length} tools`);

  // 5. wrong model id (404) -> that model is skipped, the next one answers, lane stays available
  clearAll();
  const seen: string[] = [];
  (globalThis as any).fetch = async (url: any) => { const u = String(url); seen.push(u); return u.includes("gemini-3.6-flash") ? resp(404, "model not found") : resp(200, { candidates: [{ finishReason: "STOP", content: { role: "model", parts: [{ text: "from next" }] } }] }); };
  const r5 = await router.chatWithLane([{ role: "user", content: "hi" }] as any, [], "vision", true);
  check("404 model is skipped and the next model answers", r5.content === "from next" && router.getLaneStatuses().find((l) => l.lane === "vision")!.available, r5.modelUsed);

  // 6. Groq per-minute limit: wait the few seconds and retry instead of failing the whole turn
  clearAll();
  let groqCalls = 0; let maxTok = 0;
  (globalThis as any).fetch = async (_u: any, init: any) => { groqCalls++; maxTok = JSON.parse(init.body).max_tokens; return groqCalls === 1 ? resp(429, { error: { message: "Rate limit reached ... Limit 8000, Used 5522, Requested 6117. Please try again in 1.2s." } }) : resp(200, { choices: [{ finish_reason: "stop", message: { content: "done after wait" } }] }); };
  const t0 = Date.now();
  const r6 = await router.chatWithLane([{ role: "user", content: "hi" }] as any, [], "fast", true);
  check("short Groq rate limit is waited out and the same model answers", r6.content === "done after wait" && groqCalls === 2 && Date.now() - t0 >= 1000);
  check("Groq max_tokens no longer reserves 6000 of an 8000/min budget", maxTok <= 2800, `max_tokens=${maxTok}`);

  // 7. model ids are checked against the provider lists; a renamed Qwen is found automatically
  clearAll();
  (globalThis as any).fetch = async (url: any) => {
    const u = String(url);
    if (u.includes("openrouter.ai")) return resp(200, { data: [{ id: "anthropic/claude-sonnet-5" }, { id: "z-ai/glm-5.2" }, { id: "deepseek/deepseek-v4.1-flash" }] });
    if (u.includes("groq.com")) return resp(200, { data: [{ id: "openai/gpt-oss-120b" }, { id: "openai/gpt-oss-20b" }, { id: "qwen/qwen3.8-27b" }] });
    if (u.includes("generativelanguage")) return resp(200, { models: ["gemini-3.8-flash", "gemini-3.6-flash", "gemini-3.5-flash-lite"].map((n) => ({ name: `models/${n}`, supportedGenerationMethods: ["generateContent"] })) });
    return resp(404, "");
  };
  const checks = await router.validateLaneModels();
  const qwen = checks.find((c) => /qwen/i.test(c.label))!;
  check("renamed Groq model is found from the provider's own list", qwen.status === "renamed" && /3\.8/.test(qwen.detail || ""), qwen.detail);
  check("all other lane models confirmed", checks.filter((c) => c.status === "ok").length >= 8, `${checks.filter((c) => c.status === "ok").length}/${checks.length}`);

  // 8. image aspect ratios are mapped to values the providers accept (Stability rejected 4:3)
  check("Stability: 4:3 -> accepted ratio", ["5:4", "3:2"].includes(img.normalizeAspect("4:3", "stability")));
  check("Stability: valid ratios pass through", img.normalizeAspect("16:9", "stability") === "16:9" && img.normalizeAspect("21:9", "stability") === "21:9");
  check("Stability: junk -> 1:1", img.normalizeAspect("wide", "stability") === "1:1");
  check("Gemini: 4:3 stays 4:3", img.normalizeAspect("4:3", "gemini") === "4:3");
  (globalThis as any).fetch = real;

  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("TEST CRASH", e); process.exit(2); });
