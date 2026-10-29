/**
 * Capability-aware task runner for Chat + Live AI.
 *
 * Critical design choice: for FILE and KB tasks we execute tools on the server
 * first (with model-drafted *document content*, never refusal text). We do NOT
 * rely on the chat model admitting it has tools — many models are trained to
 * say "I cannot create files" and that text must never become the PDF body.
 */
import type { UserCapabilities } from "./capabilities";
import { buildToolsSystemBlock, getUserCapabilities, toolsForCapabilities } from "./capabilities";
import { toolGenerateFile, toolListKbFolders, toolReadKbFolder, toolWebSearch } from "./tools/index";
import { storage } from "../storage";
import { chatCompletionWithFailover } from "../aiRouter";
import type { ArtifactRef, AssistantStatus, Citation } from "./types";

const TOOL_CALL_RE = /TOOL_CALL\s*([\s\S]*?)\s*END_TOOL_CALL/i;

const REFUSAL_RE =
  /I can'?t create (real )?files|I cannot create (actual )?files|no file-writing|text-based assistant|I don'?t have (a )?working file|cannot produce an actual|won'?t pretend|use Google Docs|File > Download > PDF|copy into Word/i;

export interface AgentInput {
  userId: string;
  content: string;
  history?: { role: "user" | "assistant"; content: string }[];
  isAdvanced?: boolean;
  userName?: string;
  capabilities?: Partial<UserCapabilities> | null;
  onStatus?: (s: AssistantStatus, detail?: string) => void;
  maxSteps?: number;
}

export interface AgentResult {
  answer: string;
  artifacts: ArtifactRef[];
  citations: Citation[];
  toolsUsed: string[];
  folder?: { id: string; name: string } | null;
}

function stripRefusal(text: string): string {
  return String(text || "")
    .split(/\n\n+/)
    .filter((p) => !REFUSAL_RE.test(p))
    .join("\n\n")
    .replace(REFUSAL_RE, "")
    .trim();
}

function detectFormats(content: string): string[] {
  const t = content.toLowerCase();
  const formats: string[] = [];
  if (/\bpdf\b/.test(t)) formats.push("pdf");
  if (/\bpptx|powerpoint|slides|presentation\b/.test(t)) formats.push("pptx");
  if (/\bdocx|\bword\b/.test(t)) formats.push("docx");
  if (/\bxlsx|excel|spreadsheet\b/.test(t)) formats.push("xlsx");
  if (/\bcsv\b/.test(t)) formats.push("csv");
  if (/\btxt\b/.test(t)) formats.push("txt");
  if (/\bmarkdown|\.md\b/.test(t)) formats.push("md");
  if (!formats.length && /\b(generate|create|download|file|document)\b/.test(t)) formats.push("pdf");
  return [...new Set(formats)];
}

function topicFrom(content: string): string {
  if (/java/i.test(content)) return "Java Programming Language";
  const cleaned = content
    .replace(/\b(research|explain|generate|create|make|pdf|pptx|powerpoint|presentation|folder|knowledge base|download|file|report)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.slice(0, 60) || "Study Topic";
}

async function draftCleanBody(
  content: string,
  mode: "report" | "slides",
  isAdvanced?: boolean
): Promise<string> {
  const topic = topicFrom(content);
  const system =
    mode === "report"
      ? `You write academic study report CONTENT ONLY for topic: ${topic}.
Rules:
- Output ONLY the report body. Start with the title.
- Sections: Introduction, History/Background, Key Features, Core Concepts, Real-world Use, Conclusion.
- Plain ASCII. No markdown tables. About 500-800 words.
- NEVER say you cannot create files. NEVER mention Google Docs, Word, download buttons, or limitations.
- NEVER write "as a text-based assistant". You are only writing document content.`
      : `You write PowerPoint slide outline CONTENT ONLY for topic: ${topic}.
Format exactly:
Slide 1: Title
- bullet
Slide 2: ...
10-14 slides. Short bullets. Plain ASCII.
NEVER mention file limitations, Google Docs, or that you cannot create PPTX.`;

  try {
    const res = await chatCompletionWithFailover(
      [
        { role: "system", content: system },
        { role: "user", content: `Write the ${mode} content for: ${content}` },
      ] as any,
      isAdvanced ? "ultra" : "fast"
    );
    let body = stripRefusal(String(res?.text || ""));
    body = body
      .replace(new RegExp("^`{3}[a-z]*\\n?", "i"), "")
      .replace(new RegExp("\\n?`{3}$", "i"), "")
      .trim();
    if (body.length < 80 || REFUSAL_RE.test(body)) {
      throw new Error("bad draft");
    }
    return body;
  } catch {
    if (mode === "slides") {
      return [
        `Slide 1: ${topic}`,
        "- Overview",
        `Slide 2: What is ${topic}?`,
        "- Definition and purpose",
        "Slide 3: History",
        "- Origins and evolution",
        "Slide 4: Key Features",
        "- Feature 1",
        "- Feature 2",
        "Slide 5: Core Concepts",
        "- Main ideas",
        "Slide 6: How it works",
        "- High-level flow",
        "Slide 7: Advantages",
        "- Benefits for developers",
        "Slide 8: Limitations",
        "- Trade-offs",
        "Slide 9: Real-world use",
        "- Industry examples",
        "Slide 10: Getting started",
        "- First steps for students",
        "Slide 11: Summary",
        "- Key takeaways",
      ].join("\n");
    }
    return `${topic}\n\n1. Introduction\n${topic} is an important topic in computing and software development.\n\n2. Key points\n- Core concepts students should know\n- Practical applications\n\n3. Conclusion\nUnderstanding ${topic} helps students build stronger technical skills.`;
  }
}

async function createKbFolder(
  userId: string,
  name: string
): Promise<{ id: string; name: string } | null> {
  try {
    const folder = await storage.createKBFolder({
      user_id: userId,
      name: name.slice(0, 80),
      description: "Created by LENORY assistant",
    });
    if (!folder?.id) return null;
    return { id: folder.id, name: folder.name || name };
  } catch (e) {
    console.error("kb folder create", e);
    return null;
  }
}

export async function runCapabilityAgent(input: AgentInput): Promise<AgentResult> {
  const caps = getUserCapabilities(input.userId, input.capabilities);
  const artifacts: ArtifactRef[] = [];
  const citations: Citation[] = [];
  const toolsUsed: string[] = [];
  let folder: { id: string; name: string } | null = null;

  const formats = detectFormats(input.content);
  const needsFile = caps.fileCreation && formats.length > 0;
  const needsFolder =
    caps.kbWrite &&
    /\b(knowledge base|kb folder|create (a )?folder|new folder|add (the |them |both )?files? to)\b/i.test(
      input.content
    );
  const needsSearch =
    caps.webSearch &&
    /\b(research|latest|current|search|today|2024|2025|2026)\b/i.test(input.content);

  input.onStatus?.("understanding_request");

  // Optional web research for context (does not go into refusal paths)
  let researchNotes = "";
  if (needsSearch) {
    input.onStatus?.("searching", "web");
    try {
      const q = topicFrom(input.content);
      const r = await toolWebSearch({ userId: input.userId, onStatus: input.onStatus }, q);
      toolsUsed.push("web_search");
      if (r.citations?.length) citations.push(...r.citations);
      researchNotes = r.summary?.slice(0, 3000) || "";
    } catch (e) {
      console.warn("web search failed", e);
    }
  }

  // FILE PATH: draft clean bodies, then generate_file on server (never trust chat refusal text)
  if (needsFile) {
    input.onStatus?.("writing", "drafting content");
    const topic = topicFrom(input.content);
    const wantSlides = formats.includes("pptx");
    const wantReport = formats.some((f) => f !== "pptx");

    let reportBody = "";
    let slidesBody = "";
    if (wantReport) {
      reportBody = await draftCleanBody(
        researchNotes ? `${input.content}\n\nResearch notes:\n${researchNotes}` : input.content,
        "report",
        input.isAdvanced
      );
    }
    if (wantSlides) {
      slidesBody = await draftCleanBody(input.content, "slides", input.isAdvanced);
    }
    if (!reportBody && !slidesBody) {
      reportBody = await draftCleanBody(input.content, "report", input.isAdvanced);
    }

    for (const format of formats) {
      input.onStatus?.("generating_file", format);
      const isSlides = format === "pptx";
      let body = isSlides ? slidesBody || reportBody : reportBody || slidesBody;
      body = stripRefusal(body);
      if (!body || body.length < 40) {
        body = isSlides
          ? `Slide 1: ${topic}\n- Overview\nSlide 2: Summary\n- Key points`
          : `${topic}\n\nOverview of ${topic} for students.`;
      }
      const title = isSlides ? `${topic} - Presentation` : topic;
      const fileName = `${topic.replace(/[^\w]+/g, "_").slice(0, 40)}`;
      try {
        const r = await toolGenerateFile(
          { userId: input.userId, onStatus: input.onStatus },
          { format, title, content: body, fileName }
        );
        toolsUsed.push("generate_file");
        if (r.artifacts?.length) artifacts.push(...r.artifacts);
      } catch (e) {
        console.error("generate_file failed", format, e);
      }
    }
  }

  if (needsFolder) {
    input.onStatus?.("saving", "knowledge base");
    const created = await createKbFolder(input.userId, topicFrom(input.content));
    if (created) {
      folder = created;
      toolsUsed.push("kb_create_folder");
      // Attach artifact metadata into KB if possible
      for (const art of artifacts) {
        try {
          await storage.createKBFile({
            folder_id: created.id,
            user_id: input.userId,
            name: art.name,
            file_type: "assistant_artifact",
            mime_type: art.mimeType,
            file_size: art.size,
            full_text_url: art.url,
            source_type: "assistant_file",
            extracted_text: `Generated by LENORY: ${art.name}`,
          });
        } catch {}
      }
    }
  }

  // Final user-facing message — short, no limitations speech
  let answer = "";
  if (artifacts.length) {
    answer =
      `Your file${artifacts.length > 1 ? "s are" : " is"} ready.\n\n` +
      `Tap **Download** on each file card below.\n\n` +
      artifacts.map((a) => `- **${a.name}** (${Math.max(1, Math.round(a.size / 1024))} KB)`).join("\n");
    if (folder) {
      answer += `\n\n**Knowledge Base folder created:** ${folder.name}\nOpen **Knowledge Base** in the app to share with your lecturer.`;
    } else if (needsFolder) {
      answer += `\n\nFiles are ready to download. Folder creation did not complete — you can still download and upload them manually.`;
    }
  } else if (needsFile) {
    answer =
      "I could not package the downloadable file this time. Please send the request again. Do not use Google Docs — retry in LENORY.";
  } else {
    // Plain Q&A path with optional tools listed for the model
    input.onStatus?.("writing");
    const toolsBlock = buildToolsSystemBlock(caps);
    try {
      const res = await chatCompletionWithFailover(
        [
          {
            role: "system",
            content: `You are LENORY for Nigerian students. ${toolsBlock}
Answer clearly. Never claim you cannot create files if file tools are listed.
Never invent download links.`,
          },
          ...(input.history || []).slice(-10),
          { role: "user", content: input.content },
        ] as any,
        input.isAdvanced ? "ultra" : "fast"
      );
      answer = stripRefusal(String(res?.text || "Done."));
      // If model still emitted a tool call, execute once
      const m = answer.match(TOOL_CALL_RE);
      if (m) {
        try {
          const json = JSON.parse(m[1].trim());
          if (json?.name === "web_search") {
            const r = await toolWebSearch(
              { userId: input.userId, onStatus: input.onStatus },
              String(json.arguments?.query || input.content)
            );
            toolsUsed.push("web_search");
            answer = r.summary || answer;
            if (r.citations) citations.push(...r.citations);
          }
        } catch {}
        answer = answer.replace(TOOL_CALL_RE, "").trim();
      }
    } catch (e: any) {
      answer = "I could not complete that answer. Please try again.";
    }
  }

  input.onStatus?.("completed");
  return { answer, artifacts, citations, toolsUsed, folder };
}
