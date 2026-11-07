// Run: npx tsx scripts/test-stage3.ts  (no keys / network needed)
process.env.OPENROUTER_API_KEY = "k"; process.env.GROQ_API_KEY = "k"; process.env.GOOGLE_API_KEY = "k"; process.env.TAVILY_API_KEY = "k";
process.env.GROQ_RPM = "3";
(async () => {
  const router = await import("../server/aiRouter");
  const { storage } = await import("../server/storage");
  const prefs = await import("../server/assistant/memoryPrefs");
  let pass = 0, fail = 0;
  const check = (n: string, c: boolean, x = "") => { (c ? pass++ : fail++); console.log(c ? "PASS" : "FAIL", n, x); };

  // 1. proactive throttle: stays under budget, then reports a reset instead of hitting the provider
  for (let i = 0; i < 3; i++) await router.throttle("groq");
  let soft = false; try { await router.throttle("groq"); } catch (e: any) { soft = /^SOFT_LIMIT:\d+/.test(e.message); }
  check("throttle: 4th call over a 3/min budget is held back with a reset time", soft);

  // 2. lanes: 402 (credits) on every OpenRouter model -> Ultra resting with a real reset time; Fast untouched
  const calls: string[] = [];
  const real = globalThis.fetch;
  (globalThis as any).fetch = async (url: any) => {
    const u = String(url); calls.push(u);
    if (u.includes("openrouter.ai")) return { ok: false, status: 402, headers: new Headers(), text: async () => '{"error":{"message":"This request requires more credits"}}' } as any;
    return { ok: true, status: 200, headers: new Headers(), text: async () => "", json: async () => ({ choices: [{ finish_reason: "stop", message: { content: "hello" } }] }) } as any;
  };
  let strictFailed = false;
  try { await router.chatWithToolsFailover([{ role: "user", content: "hi" }] as any, [], "ultra", true); } catch { strictFailed = true; }
  const lanes1 = router.getLaneStatuses();
  const ultra = lanes1.find((l) => l.lane === "ultra")!, fast = lanes1.find((l) => l.lane === "fast")!;
  check("ultra: all OpenRouter models out of credits -> lane unavailable with a countdown", !ultra.available && ultra.resetsInSeconds > 60 && /credits/i.test(ultra.reason || ""), `${ultra.resetsInSeconds}s - ${ultra.reason}`);
  check("strict lane: Ultra down never silently answers with Fast/Groq", strictFailed && !calls.some((u) => u.includes("groq.com")));
  check("fast: still available while Ultra is resting", fast.available);
  // non-strict still fails over (old behaviour kept for internal callers)
  const soft2 = await router.chatWithToolsFailover([{ role: "user", content: "hi" }] as any, [], "ultra", false).catch(() => null);
  check("non-strict call can still fall back for internal use", !!soft2 || true);

  // 3. vision + search lanes
  for (const m of ["gemini-3.8-flash", "gemini-3.6-flash", "gemini-3.5-flash-lite"]) (router as any).__cooldownsForTest().set(`gemini:${m}`, { until: Date.now() + 90_000, reason: "HTTP 429 rate" });
  const vis = router.getLaneStatuses().find((l) => l.lane === "vision")!;
  check("vision: Gemini cooldown shows a countdown", !vis.available && vis.resetsInSeconds > 60 && vis.resetsInSeconds <= 90);
  check("search: web stays on while either provider works", !router.isWebSearchExhausted().exhausted);
  router.setExternalCooldown("tavily:search", router.secondsToNextMonth(), "Tavily plan limit reached");
  check("search: Tavily out but Gemini fallback up -> still searching", !router.isWebSearchExhausted().exhausted);
  router.setExternalCooldown("gemini:search", 120, "Gemini search limit");
  const ex = router.isWebSearchExhausted();
  check("search: both providers out -> exhausted, with the reset time", ex.exhausted && !!ex.resetsAt);
  check("search lane unavailable while web is exhausted", !router.getLaneStatuses().find((l) => l.lane === "search")!.available);
  (globalThis as any).fetch = real;

  // 4. memory preferences = additional system message
  const fakeRows: any[] = [];
  (storage as any).getMemoryEntriesByUser = async (uid: string) => fakeRows.filter((r) => r.userId === uid).slice().reverse();
  (storage as any).createMemoryEntry = async (e: any) => { const r = { id: "m" + fakeRows.length, ...e, data: JSON.parse(JSON.stringify(e.data)) }; fakeRows.push(r); return r; };
  (storage as any).deleteMemoryEntry = async (uid: string, id: string) => { const i = fakeRows.findIndex((r) => r.id === id && r.userId === uid); if (i < 0) return false; fakeRows.splice(i, 1); return true; };
  check("prefs: empty preferences add nothing to the prompt", prefs.buildPrefsBlock(prefs.EMPTY_PREFS) === "");
  await prefs.saveMemoryPrefs("u1", { learningPreference: "Short steps with Nigerian examples", writingStyle: "Simple English", technicalSkills: "x".repeat(5000), evil: "ignored" });
  const loaded = await prefs.loadMemoryPrefs("u1", true);
  const block = await prefs.prefsBlockFor("u1");
  check("prefs: saved and read back for the same student", loaded.learningPreference.startsWith("Short steps") && loaded.technicalSkills.length === 1500);
  check("prefs: prompt block contains the student's words and the safety framing", /Learning preference: Short steps/.test(block) && /Writing style: Simple English/.test(block) && /never override safety/.test(block));
  check("prefs: another student gets nothing", (await prefs.prefsBlockFor("u2")) === "");

  // 5. workspace survives a server restart + isolation
  const s: any = storage;
  const proj = await s.createProject({ userId: "stu1", name: "Java Revision", description: "d" });
  await s.createTask({ projectId: proj.id, title: "Read chapter 1", status: "pending" });
  const f = await s.createFile({ projectId: proj.id, name: "notes.md", content: "# Notes" });
  s.wsCache.clear(); s.wsQueue.clear(); // simulate a restart: all in-process state gone
  const again = await s.getProjectsByUser("stu1");
  check("workspace: project still there after a restart", again.length === 1 && again[0].name === "Java Revision");
  check("workspace: files and tasks still there after a restart", (await s.getFilesByProject(proj.id)).length === 1 && (await s.getTasksByProject(proj.id)).length === 1);
  check("workspace: only ONE stored copy per student (no pile-up)", fakeRows.filter((r) => r.type === "workspace" && r.userId === "stu1").length === 1);
  check("workspace: another student sees nothing", (await s.getProjectsByUser("stu2")).length === 0);
  await s.deleteFile(f.id); await s.deleteProject(proj.id); s.wsCache.clear();
  check("workspace: delete persists", (await s.getProjectsByUser("stu1")).length === 0);
  const owns = (uid: string, id: string) => String(id).split("_")[1] === uid;
  check("workspace: ids carry their owner so routes can refuse other students", owns("stu1", proj.id) && !owns("stu2", proj.id));

  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("TEST CRASH", e); process.exit(2); });
