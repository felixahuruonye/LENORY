// Run: npx tsx scripts/test-stage4.ts  (no keys/network: providers are scripted)
process.env.SUPABASE_URL = process.env.SUPABASE_URL || "https://x.supabase.co"; process.env.VITE_SUPABASE_URL = process.env.SUPABASE_URL; process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "k"; process.env.SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || "k"; process.env.VITE_SUPABASE_ANON_KEY = "k";
process.env.OPENROUTER_API_KEY = "k"; process.env.GROQ_API_KEY = "k"; process.env.GOOGLE_API_KEY = "k"; process.env.TAVILY_API_KEY = "k";
process.env.OPENROUTER_RPM = "500"; process.env.GROQ_RPM = "500"; process.env.GEMINI_RPM = "500";
(async () => {
  const router = await import("../server/aiRouter");
  const { laneContext } = await import("../server/laneContext");
  const { storage } = await import("../server/storage");
  const lanes = await import("../server/assistant/lanes");
  const stats = await import("../server/jobStats");
  const credits = await import("../server/creditsStore");
  let pass = 0, fail = 0;
  const check = (n: string, c: boolean, x = "") => { (c ? pass++ : fail++); console.log(c ? "PASS" : "FAIL", n, x); };
  const real = globalThis.fetch;
  const hit: string[] = [];
  const ok = (content: string, extra: any = {}) => ({ ok: true, status: 200, headers: new Headers(), text: async () => "", json: async () => ({ choices: [{ finish_reason: "stop", message: { content, ...extra } }] }) }) as any;
  const fail429 = (retry = "120") => ({ ok: false, status: 429, headers: new Headers({ "retry-after": retry }), text: async () => "rate limited" }) as any;

  // 1. each lane uses ONLY its own provider, in the right order
  (globalThis as any).fetch = async (url: any, init: any) => { const b = JSON.parse(init.body); hit.push(`${String(url).includes("openrouter") ? "OR" : "GROQ"}:${b.model}`); return ok("hi"); };
  await router.chatWithLane([{ role: "user", content: "hi" }] as any, [], "ultra", false);
  check("ultra simple chat tries the cheapest model first (DeepSeek)", hit[0] === "OR:deepseek/deepseek-v4.1-flash", hit[0]);
  hit.length = 0; await router.chatWithLane([{ role: "user", content: "hi" }] as any, [], "ultra", true);
  check("ultra heavy task tries the strongest first (Claude Sonnet 5)", hit[0] === "OR:anthropic/claude-sonnet-5", hit[0]);
  hit.length = 0; await router.chatWithLane([{ role: "user", content: "hi" }] as any, [], "fast", true);
  check("fast heavy uses Groq GPT-OSS 120B first and never OpenRouter", hit[0] === "GROQ:openai/gpt-oss-120b" && !hit.some((h) => h.startsWith("OR")), hit[0]);

  // 2. quota on model 1 -> model 2 takes over without the student noticing; lane stays available
  hit.length = 0;
  (globalThis as any).fetch = async (url: any, init: any) => { const b = JSON.parse(init.body); hit.push(b.model); return b.model === "anthropic/claude-sonnet-5" ? fail429("300") : ok("from glm"); };
  const r2 = await router.chatWithLane([{ role: "user", content: "hi" }] as any, [], "ultra", true);
  check("model 1 hits quota -> model 2 answers automatically", r2.modelUsed === "GLM 5.2" && r2.content === "from glm", hit.join(" > "));
  check("lane still available while one model rests", router.getLaneStatuses().find((l) => l.lane === "ultra")!.available);

  // 3. all three resting -> lane unavailable with a real reset time; another lane unaffected
  (globalThis as any).fetch = async () => fail429("90");
  let err = ""; try { await router.chatWithLane([{ role: "user", content: "hi" }] as any, [], "ultra", true); } catch (e: any) { err = e.message; }
  const u = router.getLaneStatuses().find((l) => l.lane === "ultra")!;
  check("all 3 models resting -> LANE_UNAVAILABLE", /^LANE_UNAVAILABLE:ultra/.test(err));
  check("countdown = earliest model coming back", !u.available && u.resetsInSeconds > 0 && u.resetsInSeconds <= 300, `${u.resetsInSeconds}s`);
  check("fast and vision lanes are untouched by Ultra resting", router.getLaneStatuses().find((l) => l.lane === "fast")!.available && router.getLaneStatuses().find((l) => l.lane === "vision")!.available);
  // reset: when a model's time is up the lane returns by itself
  const cd = (router as any).__cooldownsForTest?.(); if (cd) for (const k of [...cd.keys()]) cd.delete(k);
  (globalThis as any).fetch = async () => ok("back");
  const r3 = await router.chatWithLane([{ role: "user", content: "hi" }] as any, [], "ultra", true).catch(() => null);
  check("lane works again once cooldowns clear", !!r3 && router.getLaneStatuses().find((l) => l.lane === "ultra")!.available);

  // 4. Vision lane = Gemini with native tool calling (same tools as the others)
  let geminiBody: any[] = []; let n = 0;
  (globalThis as any).fetch = async (url: any, init: any) => {
    geminiBody.push({ url: String(url), body: JSON.parse(init.body) }); n++;
    const parts = n === 1 ? [{ functionCall: { name: "memory_save", args: { text: "I write exams in December" } }, thoughtSignature: "SIG123" }] : [{ text: "Saved it." }];
    return { ok: true, status: 200, headers: new Headers(), text: async () => "", json: async () => ({ candidates: [{ finishReason: "STOP", content: { role: "model", parts } }] }) } as any;
  };
  const tool = { type: "function", function: { name: "memory_save", description: "save", parameters: { type: "object", properties: { text: { type: "string" } }, required: ["text"], additionalProperties: false } } } as any;
  const g1 = await router.chatWithLane([{ role: "system", content: "sys" }, { role: "user", content: "remember I write exams in December" }] as any, [tool], "vision", true);
  check("vision: Gemini returns a real tool call", g1.toolCalls.length === 1 && g1.toolCalls[0].name === "memory_save" && /generativelanguage\.googleapis\.com/.test(geminiBody[0].url));
  check("vision: tool schema sent in Gemini format without unsupported keys", geminiBody[0].body.tools[0].functionDeclarations[0].name === "memory_save" && !JSON.stringify(geminiBody[0].body).includes("additionalProperties"));
  const g2 = await router.chatWithLane([{ role: "system", content: "sys" }, { role: "user", content: "remember" }, g1.rawAssistant, { role: "tool", tool_call_id: g1.toolCalls[0].id, content: "Saved to memory" }] as any, [tool], "vision", true);
  const sent = geminiBody[1].body.contents;
  check("vision: tool result goes back as functionResponse and thought signature is preserved", g2.content === "Saved it." && sent[sent.length - 1].parts[0].functionResponse?.name === "memory_save" && JSON.stringify(sent).includes("SIG123"));

  // 5. every other AI feature follows the student's lane (notes, quizzes, CBT...)
  hit.length = 0;
  (globalThis as any).fetch = async (url: any, init: any) => { hit.push(String(url).includes("groq") ? "groq" : String(url).includes("openrouter") ? "openrouter" : "other"); return ok("note text"); };
  const { chatWithGemini } = await import("../server/gemini");
  const viaFast = await laneContext.run({ lane: "fast", userId: "u" }, () => chatWithGemini([{ role: "user", content: "make notes" }]));
  check("feature call on Fast is answered by Groq, not Gemini", viaFast === "note text" && hit.every((h) => h === "groq"), hit.join(","));
  hit.length = 0;
  const viaUltra = await laneContext.run({ lane: "ultra", userId: "u" }, () => router.chatCompletionWithFailover([{ role: "user", content: "quiz" }]));
  check("feature call on Ultra is answered by OpenRouter only", hit.every((h) => h === "openrouter") && !!viaUltra.text, hit.join(","));
  (globalThis as any).fetch = real;

  // 6. plans: free=Vision, pro=+Fast, premium=all; admin=all; choice saved on the server
  const rows: any[] = [];
  (storage as any).getMemoryEntriesByUser = async (uid: string) => rows.filter((r) => r.userId === uid).slice().reverse();
  (storage as any).createMemoryEntry = async (e: any) => { const r = { id: "m" + rows.length, ...e }; rows.push(r); return r; };
  (storage as any).deleteMemoryEntry = async (uid: string, id: string) => { const i = rows.findIndex((r) => r.id === id); if (i < 0) return false; rows.splice(i, 1); return true; };
  const free = await lanes.getLaneProfile("a", { email: "x@y.z", subscriptionTier: "free" });
  const pro = await lanes.getLaneProfile("b", { email: "x@y.z", subscriptionTier: "pro" });
  const prem = await lanes.getLaneProfile("c", { email: "x@y.z", subscriptionTier: "premium" });
  const adm = await lanes.getLaneProfile("d", { email: "felixahuruonye@gmail.com", subscriptionTier: "free" });
  check("free plan: Vision only", free.lane === "vision" && free.allowed.join() === "vision");
  check("pro plan: Fast by default, Vision allowed, Ultra not", pro.lane === "fast" && pro.allowed.includes("vision") && !pro.allowed.includes("ultra"));
  check("premium plan: Ultra by default, can switch to any", prem.lane === "ultra" && prem.allowed.length === 3);
  check("admin: everything", adm.allowed.length === 3);
  await lanes.saveLane("c", "fast");
  check("premium choice is remembered (survives restart)", (await lanes.getLaneProfile("c", { email: "x@y.z", subscriptionTier: "premium" })).lane === "fast" && rows.filter((r) => r.type === "model_lane").length === 1);
  await lanes.saveLane("b", "vision");
  const lapsed = await lanes.getLaneProfile("c", { email: "x@y.z", subscriptionTier: "free" });
  check("plan ended: saved Fast is not honoured, falls back to Vision", lapsed.lane === "vision");

  // 7. credits: six editable prices, charged by what the job really was
  const d = credits.DEFAULT_FEATURE_COSTS;
  check("six mode prices exist and heavy costs more than simple", (["ultra", "fast", "vision"] as const).every((m) => d[`chat_${m}_heavy`] > d[`chat_${m}_simple`] && d[`chat_${m}_simple`] >= 1));
  check("heavy = tools / several steps / long work; simple chat stays simple", lanes.isHeavyJob({ toolsUsed: ["generate_file"] }) && lanes.isHeavyJob({ steps: 3 }) && !lanes.isHeavyJob({ question: "what is RAM", answer: "Memory.", steps: 1, toolsUsed: [] }));

  // 8. job statistics are real and filterable by period
  const end1 = stats.trackJob("chat:fast"); const end2 = stats.trackJob("chat:ultra");
  const live = await stats.getJobStats("now");
  check("job stats: running shows live tasks", live.running === 2);
  end1(true); end2(false);
  const today = await stats.getJobStats("today");
  check("job stats: done/failed counted for today and by type", today.done === 1 && today.failed === 1 && today.byType["chat:fast"]?.done === 1);
  const y = await stats.getJobStats("yesterday"); const w = await stats.getJobStats("7d"); const c = await stats.getJobStats("custom", "2020-01-01", "2020-01-02");
  check("job stats: yesterday empty, 7d includes today, custom range works", y.done === 0 && w.done === 1 && c.done === 0 && c.from === "2020-01-01");

  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("TEST CRASH", e); process.exit(2); });
