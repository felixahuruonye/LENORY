// Run: npx tsx scripts/test-assistant.ts  (scripted model; no API keys or database needed)
process.env.OPENROUTER_API_KEY = "test"; process.env.GROQ_API_KEY = "test";
import { runToolAgent } from "../server/assistant/agentLoop";
import { readLocalArtifact } from "../server/assistant/artifactStore";
let script: any[] = []; let seenTools: string[][] = [];
(globalThis as any).fetch = async (_u: string, init: any) => {
  const body = JSON.parse(init.body); seenTools.push((body.tools || []).map((t: any) => t.function.name));
  const next = script.shift(); if (!next) throw new Error("script exhausted");
  const msg = next.tool ? { content: next.content || null, tool_calls: [{ id: "c1", type: "function", function: { name: next.tool, arguments: JSON.stringify(next.args) } }] } : { content: next.content };
  return { ok: true, status: 200, json: async () => ({ choices: [{ message: msg }] }), headers: new Headers(), text: async () => "" } as any;
};
const base = { userId: "user-A", systemMessage: "You are LENORY.", sessionId: null, capabilities: { memory: false, knowledgeBase: false, kbWrite: false, webSearch: false } };
let pass = 0, fail = 0;
const check = (n: string, c: boolean, extra = "") => { (c ? pass++ : fail++); console.log(c ? "PASS" : "FAIL", n, extra); };
(async () => {
  // 1 simple question -> no tool use
  script = [{ content: "An operating system manages hardware." }];
  let r = await runToolAgent({ ...base, history: [{ role: "user", content: "What is an OS?" }] });
  check("simple question answered, no tools", r.toolsUsed.length === 0 && /operating system/i.test(r.answer));

  // 2 real PDF end to end
  const doc = "# Database Systems\n\nA database is an organised collection of data stored electronically.\n\n## Types\n- Relational databases\n- Document databases\n\nConclusion: databases power modern applications.";
  for (const fmt of ["pdf", "docx", "pptx", "xlsx"]) {
    const content = fmt === "xlsx" ? "| Course | Score |\n|---|---|\n| Databases | 80 |\n| Networks | 75 |" : doc;
    script = [{ tool: "generate_file", args: { format: fmt, title: "Database Systems", content } }, { content: "Your file is ready - use the download card." }];
    r = await runToolAgent({ ...base, history: [{ role: "user", content: `make a ${fmt}` }] }).catch((e: any) => { console.log("AGENT ERR", fmt, e.message); throw e; });
    const art = r.artifacts[0];
    const got = art ? readLocalArtifact(art.id, "user-A") : null;
    check(`${fmt}: tool executed, artifact stored & downloadable`, !!art && !!got && got.buffer.length > 500 && art.url.startsWith("/api/assistant/artifacts/"), art ? `${art.name} ${art.size}B got=${got?.buffer.length} fail=${JSON.stringify(r.failedTools)} n=${r.artifacts.length}` : "NO ART");
    check(`${fmt}: other user cannot download it`, !!art && readLocalArtifact(art.id, "user-B") === null);
  }

  // 3 empty content -> tool fails, model must not be allowed to claim success
  script = [{ tool: "generate_file", args: { format: "pdf", title: "X", content: "" } }, { content: "Your PDF is ready, tap download." }, { content: "Sorry, I could not create the PDF." }];
  r = await runToolAgent({ ...base, history: [{ role: "user", content: "make a pdf" }] });
  check("empty doc rejected, no artifact", r.artifacts.length === 0 && r.failedTools.length === 1);
  check("false 'ready' claim was caught and corrected", !/ready, tap download/i.test(r.answer) && /could not/i.test(r.answer), r.answer);

  // 4 model lies twice with no tool -> honest warning appended
  script = [{ content: "Your PDF is ready! Tap download." }, { content: "Your PDF is ready! Tap download." }];
  r = await runToolAgent({ ...base, history: [{ role: "user", content: "make a pdf" }] });
  check("persistent false claim gets honest warning", r.artifacts.length === 0 && /Not completed/.test(r.answer));

  // 5 disabled capability is not even offered
  script = [{ content: "ok" }]; seenTools = [];
  await runToolAgent({ ...base, capabilities: { ...base.capabilities, fileCreation: false }, history: [{ role: "user", content: "hi" }] });
  check("file tool hidden when File creation is off", !seenTools[0].includes("generate_file"));

  // 6 unknown/disabled tool call is refused
  script = [{ tool: "generate_file", args: { format: "pdf", title: "x", content: doc } }, { content: "I can't create files right now." }];
  r = await runToolAgent({ ...base, capabilities: { ...base.capabilities, fileCreation: false }, history: [{ role: "user", content: "make pdf" }] });
  check("model cannot call a disabled tool", r.artifacts.length === 0 && r.failedTools[0]?.error === "NOT_AVAILABLE");

  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("TEST CRASH", e); process.exit(2); });
