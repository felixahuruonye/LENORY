// Run: npx tsx scripts/test-stage2.ts   (no API keys or network needed; model/search calls are scripted)
process.env.OPENROUTER_API_KEY = "test"; process.env.GROQ_API_KEY = "test"; process.env.TAVILY_API_KEY = "test"; delete process.env.STABILITY_API_KEY; delete process.env.CODE_SANDBOX_URL;
import JSZip from "jszip";
import { toolGenerateFile } from "../server/assistant/tools/index";
import { readLocalArtifact } from "../server/assistant/artifactStore";
import { readPdfText } from "../server/assistant/formats";
import { toolDeepResearch, assertPublicUrl } from "../server/assistant/tools/research";
import { runToolAgent } from "../server/assistant/agentLoop";
import { storage } from "../server/storage";
import { toolAddProjectTask } from "../server/assistant/tools/extra";

let pass = 0, fail = 0;
const check = (n: string, c: boolean, extra = "") => { (c ? pass++ : fail++); console.log(c ? "PASS" : "FAIL", n, extra); };
const U = "stage2-user";
const md = "# Java Programming Language\n\nJava is a **high-level**, class-based language - \"write once, run anywhere\". \u{1F680}\n\n## History\n- 1991 \u2013 Began as Oak\n- 1995 \u2013 Renamed Java\n\n## Core Concepts\n| Concept | Meaning |\n|---|---|\n| Class | Blueprint |\n| Object | Instance |\n\n---\n\n## Example\n```java\npublic class Hello {}\n```\n\n1. Install the JDK\n2. Run javac\n\n> Note: see [Oracle](https://oracle.com/java).";
const csv = "Course,Score\nDatabases,80\nNetworks,75";
const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="150"><rect width="300" height="150" fill="#123"/><text x="20" y="80" fill="#fff">LENORY</text></svg>';
const gen = async (format: string, content: string) => {
  const r = await toolGenerateFile({ userId: U, onStatus: () => {} } as any, { format, title: "Java Programming Language", content });
  const a = r.artifacts?.[0]; const got = a ? readLocalArtifact(a.id, U) : null;
  return { r, a, buf: got?.buffer || null };
};
const textOf = async (buf: Buffer, re: RegExp) => { const z = await JSZip.loadAsync(buf); let t = ""; for (const n of Object.keys(z.files)) if (re.test(n)) t += await z.files[n].async("string"); return t; };

(async () => {
  // ── every format produces a real, readable file
  const good: [string, string][] = [["pdf", md], ["docx", md], ["pptx", md], ["xlsx", csv], ["txt", md], ["rtf", md], ["md", md], ["csv", csv], ["ods", csv], ["png", svg], ["jpeg", svg], ["webp", svg], ["svg", svg], ["json", '{"a":[1,2]}'], ["xml", "<r><s n='1'/></r>"], ["yaml", "a: 1\nb:\n  - x\n"], ["html", "<h1>Hi</h1><p>there</p>"], ["css", "body{margin:0}"], ["js", "console.log('hi')"], ["ts", "const x: number = 1;"], ["py", "print('hi')"], ["sql", "SELECT 1;"], ["zip", JSON.stringify({ files: [{ path: "a/b.txt", content: "hello" }, { path: "README.md", content: "# Hi" }] })]];
  const out: Record<string, Buffer> = {};
  for (const [f, c] of good) { const { a, buf, r } = await gen(f, c); if (buf) out[f] = buf; check(`${f}: real file created and downloadable`, !!a && !!buf && buf.length > 5, a ? `${a.name} ${a.size}B` : r.summary.slice(0, 100)); }

  // ── content is clean (no markdown symbols) and actually present
  const pdf = await readPdfText(out.pdf);
  check("pdf: text present and clean", /Java Programming Language/.test(pdf.text) && /Core Concepts/.test(pdf.text) && !/\*\*|###|\|---|\u{1F680}/u.test(pdf.text), pdf.text.slice(0, 80).replace(/\n/g, " "));
  const docx = await textOf(out.docx, /word\/document\.xml/);
  check("docx: text present, no ** # | symbols, emoji removed", /high-level/.test(docx) && !/\*\*|>#+ |\|---|\u{1F680}/u.test(docx));
  const pptx = await textOf(out.pptx, /ppt\/slides\/slide\d+\.xml/);
  const slides = Object.keys((await JSZip.loadAsync(out.pptx)).files).filter((n) => /ppt\/slides\/slide\d+\.xml$/.test(n));
  check("pptx: multiple slides with real text, no markdown symbols", slides.length >= 5 && /History/.test(pptx) && /Blueprint/.test(pptx) && !/\*\*|###|\|---/.test(pptx), `${slides.length} slides`);
  const xl = await textOf(out.xlsx, /sharedStrings|sheet1/);
  check("xlsx: table cells present", /Databases/.test(xl) && /Networks/.test(xl));
  check("txt: plain readable text", /JAVA|History|HISTORY/.test(out.txt.toString()) && !/\*\*|###|\|---/.test(out.txt.toString()));
  check("rtf: valid header", out.rtf.toString("latin1").startsWith("{\\rtf1"));
  check("csv: header + rows", /Course,Score/.test(out.csv.toString()) && /Databases,80/.test(out.csv.toString()));
  check("ods: contains rows", /Networks/.test(await textOf(out.ods, /content\.xml/)));
  check("png/jpeg/webp magic bytes", out.png.subarray(1, 4).toString() === "PNG" && out.jpeg[0] === 0xff && out.webp.subarray(8, 12).toString() === "WEBP");
  check("js: fence wrapper not required / code kept", /console\.log/.test(out.js.toString()));
  check("zip: both files inside", Object.keys((await JSZip.loadAsync(out.zip)).files).includes("a/b.txt"));

  // ── invalid content is rejected honestly (never a fake file)
  for (const [f, c, why] of [["json", "{bad json", "invalid JSON"], ["xml", "<a><b></a>", "bad XML"], ["yaml", "a: [1, 2\nb: : :", "bad YAML"], ["zip", JSON.stringify({ files: [{ path: "../evil.txt", content: "x" }] }), "path traversal"], ["png", "a cat in a hat", "no image generator configured"], ["csv", "justonecolumnonly", "not tabular"]] as const) {
    const { a, r } = await gen(f, c); check(`${f}: ${why} rejected, no artifact`, !a && !r.success, r.summary.slice(0, 70));
  }

  // ── SSRF protection
  for (const u of ["http://127.0.0.1/x", "http://localhost/admin", "http://169.254.169.254/latest/meta-data", "http://10.0.0.5/", "file:///etc/passwd"]) {
    let blocked = false; try { await assertPublicUrl(u); } catch { blocked = true; }
    check(`SSRF blocked: ${u}`, blocked);
  }

  // ── deep research with scripted search + models
  const realFetch = globalThis.fetch;
  let searches = 0;
  (globalThis as any).fetch = async (url: any, init: any) => {
    const u = String(url);
    if (u.includes("api.tavily.com")) {
      searches++;
      const q = JSON.parse(init.body).query;
      return { ok: true, status: 200, json: async () => ({ answer: "", results: searches === 3 ? [] : [{ title: "Java overview - Oracle", url: "https://www.oracle.com/java/", content: "Java overview", raw_content: "Java is a general purpose language. ".repeat(40) }, { title: "Java history " + q, url: "https://en.wikipedia.org/wiki/Java_(programming_language)", content: "history", raw_content: "Java was released in 1995 by Sun Microsystems. ".repeat(30) }] }) } as any;
    }
    if (u.includes("groq.com") || u.includes("openrouter.ai")) return { ok: true, status: 200, headers: new Headers(), text: async () => "", json: async () => ({ choices: [{ message: { content: '["java overview","java history 1995","java latest release"]' } }] }) } as any;
    throw new Error("network blocked in test");
  };
  const seen: string[] = [];
  const rr = await toolDeepResearch({ userId: U, onStatus: (s: string, d?: string) => seen.push(`${s}:${d || ""}`) } as any, { topic: "History of Java", depth: "deep" });
  check("research: succeeded with numbered, cited sources", rr.success && /\[1\]/.test(rr.summary) && (rr.citations?.length || 0) >= 2, `${rr.citations?.length} sources`);
  check("research: status events are real and detailed", seen.some((x) => x.startsWith("planning")) && seen.filter((x) => x.startsWith("searching:")).length >= 3 && seen.some((x) => x.startsWith("reading_sources:")) && seen.some((x) => x.startsWith("validating")), seen.slice(0, 4).join(" | "));
  check("research: reliability and date caveats included", /Reliability: official|Reliability: established|Reliability: encyclopedia/.test(rr.summary) && /date not found|Published/.test(rr.summary));
  (globalThis as any).fetch = async (u: any) => { if (String(u).includes("tavily")) return { ok: true, status: 200, json: async () => ({ results: [] }) } as any; return { ok: true, status: 200, headers: new Headers(), text: async () => "", json: async () => ({ choices: [{ message: { content: '["a b c"]' } }] }) } as any; };
  const none = await toolDeepResearch({ userId: U } as any, { topic: "zzz nothing", depth: "quick" });
  check("research: no results reported honestly", !none.success && /no usable results/i.test(none.summary));
  (globalThis as any).fetch = realFetch;

  // ── safety-flag model switch + cancellation + status detail through the agent loop
  let calls = 0; const models: string[] = [];
  (globalThis as any).fetch = async (_u: any, init: any) => {
    const body = JSON.parse(init.body); models.push(body.model); calls++;
    const flagged = calls === 1;
    const msg = flagged ? { content: "", refusal: "blocked" } : { content: "Here is a clear answer." };
    return { ok: true, status: 200, headers: new Headers(), text: async () => "", json: async () => ({ choices: [{ finish_reason: flagged ? "content_filter" : "stop", message: msg }] }) } as any;
  };
  const base = { userId: U, systemMessage: "You are LENORY.", sessionId: null, capabilities: { memory: false, knowledgeBase: false, kbWrite: false, webSearch: false, projects: false } };
  const flaggedRun = await runToolAgent({ ...base, history: [{ role: "user", content: "explain recursion" }] });
  check("safety flag: switched to a different model automatically", /clear answer/.test(flaggedRun.answer) && new Set(models).size >= 2, models.join(" -> "));
  const stopped = await runToolAgent({ ...base, isCancelled: () => true, history: [{ role: "user", content: "hi" }] });
  check("cancellation: stops before calling a model", stopped.cancelled === true);
  (globalThis as any).fetch = realFetch;

  // ── projects: a student cannot touch another student's project
  (storage as any).getProjectsByUser = async (uid: string) => (uid === "owner" ? [{ id: "p1", userId: "owner", name: "Mine" }] : []);
  let created = 0; (storage as any).createTask = async () => { created++; return { id: "t1" }; };
  const intruder = await toolAddProjectTask({ userId: "intruder" } as any, { projectId: "p1", title: "hack" });
  const owner = await toolAddProjectTask({ userId: "owner" } as any, { projectId: "p1", title: "study" });
  check("projects: other student blocked, owner allowed", !intruder.success && owner.success && created === 1);

  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("TEST CRASH", e); process.exit(2); });
