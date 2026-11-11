// Run: npx tsx scripts/test-stage7.ts - search + delete-with-confirmation
process.env.SUPABASE_URL = "https://x.supabase.co"; process.env.VITE_SUPABASE_URL = process.env.SUPABASE_URL; process.env.SUPABASE_SERVICE_ROLE_KEY = "k"; process.env.SUPABASE_ANON_KEY = "k"; process.env.VITE_SUPABASE_ANON_KEY = "k";
process.env.GOOGLE_API_KEY = "k";
(async () => {
  const { storage } = await import("../server/storage");
  const search = await import("../server/assistant/tools/search");
  const del = await import("../server/assistant/tools/deleteFlow");
  const agent: any = await import("../server/assistant/agentLoop");
  let pass = 0, fail = 0;
  const check = (n: string, c: boolean, x = "") => { (c ? pass++ : fail++); console.log(c ? "PASS" : "FAIL", n, x); };
  const S: any = storage;
  const real = globalThis.fetch;
  (globalThis as any).fetch = async () => { throw new Error("embeddings unavailable"); }; // keyword path must work alone

  // ---- fake data for two students
  const chats: any = { s1: [{ role: "user", content: "Can you explain normalization in databases, first normal form and second normal form?", createdAt: "2026-10-01" }, { role: "assistant", content: "Normalization removes redundancy. 1NF means atomic values...", createdAt: "2026-10-01" }], s2: [{ role: "user", content: "Help me with my chemistry titration practical", createdAt: "2026-10-05" }], other: [{ role: "user", content: "secret normalization notes of another student", createdAt: "2026-10-02" }] };
  S.getChatSessionsByUser = async (uid: string) => (uid === "stuA" ? [{ id: "s1", title: "Databases help", createdAt: "2026-10-01" }, { id: "s2", title: "Chemistry", createdAt: "2026-10-05" }] : [{ id: "other", title: "Other", createdAt: "2026-10-02" }]);
  S.getChatMessagesBySession = async (id: string) => chats[id] || [];
  const folders: any = { stuA: [{ id: "f1", name: "Java Programming" }], stuB: [{ id: "fB", name: "Private" }] };
  const files: any = { f1: [{ id: "k1", name: "Java OOP notes", extracted_text: "Inheritance lets a subclass reuse code from a superclass. Polymorphism allows many forms. Encapsulation hides data." }, { id: "k2", name: "Math", extracted_text: "The derivative of x squared is 2x." }], fB: [{ id: "kB", name: "Secret", extracted_text: "Inheritance secret of student B" }] };
  S.getKBFolders = async (uid: string) => folders[uid] || [];
  S.getKBFiles = async (fid: string) => files[fid] || [];
  S.getProjectsByUser = async (uid: string) => (uid === "stuA" ? [{ id: "proj_stuA_1", userId: "stuA", name: "Revision" }] : []);
  S.getFilesByProject = async () => [{ id: "file_stuA_1", name: "plan.md", content: "Study polymorphism on Friday" }];
  S.getTasksByProject = async () => [{ id: "task_stuA_1", title: "Read chapter 1" }];
  S.getMemoryEntriesByUser = async (uid: string) => (uid === "stuA" ? [{ id: "mem1", type: "user_fact", data: { text: "I write exams in December" } }] : []);
  S.getGeneratedImagesByUser = async (uid: string) => (uid === "stuA" ? [{ id: "img1", prompt: "a database server" }] : []);
  const deleted: string[] = [];
  S.deleteKBFolder = async (id: string) => { deleted.push("folder:" + id); }; S.deleteKBFile = async (id: string) => { deleted.push("file:" + id); };
  S.deleteProject = async (id: string) => { deleted.push("project:" + id); }; S.deleteFile = async (id: string) => { deleted.push("pfile:" + id); }; S.deleteTask = async (id: string) => { deleted.push("task:" + id); };
  S.deleteMemoryEntry = async (_u: string, id: string) => { deleted.push("mem:" + id); return true; }; S.deleteGeneratedImage = async (_u: string, id: string) => { deleted.push("img:" + id); };
  const ctxA: any = { userId: "stuA", sessionId: "current", onStatus: (s: string) => statuses.push(s) }; const statuses: string[] = [];

  // ---- past-chat search
  const r1 = await search.toolSearchPastChats(ctxA, { query: "what did we discuss about normalization" });
  check("past chats: finds the earlier conversation", r1.success && /Databases help/.test(r1.summary) && /sessionId=s1/.test(r1.summary));
  check("past chats: never returns another student's chat", !/another student/i.test(r1.summary));
  check("past chats: shows 'Searching memory' status", statuses.includes("searching_memory"));
  const r1b = await search.toolSearchPastChats(ctxA, { query: "zzzqqq nothing like this" });
  check("past chats: no match is reported honestly", r1b.success && /Nothing matching/.test(r1b.summary));

  // ---- notes / KB search
  statuses.length = 0;
  const r2 = await search.toolSearchKnowledge(ctxA, { query: "polymorphism and inheritance" });
  check("notes: finds the Java note with its file name and folder", r2.success && /Java OOP notes/.test(r2.summary) && /Java Programming/.test(r2.summary));
  check("notes: also searches project files", /plan\.md/.test(r2.summary));
  check("notes: other student's files never appear", !/student B/i.test(r2.summary));
  check("notes: shows 'Searching documents' status", statuses.includes("searching_documents"));

  // ---- delete: the AI can only ASK, nothing is deleted until the student confirms
  const rq = await del.toolRequestDelete(ctxA, { kind: "kb_file", id: "k1" });
  check("delete request makes a confirmation card", rq.success && rq.confirmations?.length === 1 && /permanently/i.test(rq.confirmations![0].warning));
  check("delete request deletes NOTHING", deleted.length === 0);
  check("AI is told not to claim it is deleted", /NOTHING has been deleted/.test(rq.summary));
  const tok = rq.confirmations![0].token;
  const wrong = await del.executeConfirmedDelete("stuB", tok, true);
  check("another student cannot use the token", !wrong.ok && deleted.length === 0);
  const cancel = await del.toolRequestDelete(ctxA, { kind: "image", id: "img1" });
  const c = await del.executeConfirmedDelete("stuA", cancel.confirmations![0].token, false);
  check("Cancel deletes nothing", c.ok && /Cancelled/.test(c.message) && deleted.length === 0);
  const ok = await del.executeConfirmedDelete("stuA", tok, true);
  check("Delete button really deletes the file", ok.ok && deleted.includes("file:k1"), ok.message);
  const again = await del.executeConfirmedDelete("stuA", tok, true);
  check("token is one-time: replay does nothing", !again.ok && deleted.filter((d) => d === "file:k1").length === 1);
  for (const [kind, id, mark] of [["kb_folder", "f1", "folder:f1"], ["project", "proj_stuA_1", "project:proj_stuA_1"], ["project_task", "task_stuA_1", "task:task_stuA_1"], ["project_file", "file_stuA_1", "pfile:file_stuA_1"], ["memory_fact", "mem1", "mem:mem1"], ["image", "img1", "img:img1"]] as const) {
    const q = await del.toolRequestDelete(ctxA, { kind, id }); const x = await del.executeConfirmedDelete("stuA", q.confirmations![0].token, true);
    check(`delete ${kind} works after confirmation`, x.ok && deleted.includes(mark));
  }
  const foreign = await del.toolRequestDelete(ctxA, { kind: "kb_file", id: "kB" });
  check("cannot even request deletion of another student's file", !foreign.success && !foreign.confirmations);
  const fakeProj = await del.toolRequestDelete({ userId: "stuB" } as any, { kind: "project", id: "proj_stuA_1" });
  check("cannot request deletion of another student's project", !fakeProj.success);

  // ---- the agent exposes the tools
  const names: string[] = agent.__defsForTest().map((d: any) => d.schema.function.name);
  check("agent has search_past_chats, search_knowledge_base, request_delete", ["search_past_chats", "search_knowledge_base", "request_delete"].every((n) => names.includes(n)));
  check("no duplicate tool names", new Set(names).size === names.length);
  (globalThis as any).fetch = real;
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("TEST CRASH", e); process.exit(2); });
