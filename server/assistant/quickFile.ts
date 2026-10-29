/**
 * Server-side task path for file generation + optional KB folder.
 * Runs BEFORE the chat LLM so models cannot deny these capabilities.
 */
import { toolGenerateFile } from "./tools/index";
import { storage } from "../storage";
import type { ArtifactRef, AssistantStatus } from "./types";
import { chatCompletionWithFailover } from "../aiRouter";

export function isFileGenerationRequest(content: string): boolean {
  const t = (content || "").toLowerCase();
  if (!t.trim()) return false;
  return (
    /\b(pdf|docx?|pptx?|xlsx?|csv|rtf|\.md\b|markdown|html|zip)\b/.test(t) ||
    /\b(generate|create|make|export|download)\b.{0,60}\b(file|document|report|assignment|slides|presentation|spreadsheet)\b/.test(t) ||
    /\b(file|document|assignment|presentation)\b.{0,40}\b(pdf|docx?|pptx?|download)\b/.test(t) ||
    /\bpowerpoint\b/.test(t)
  );
}

export function wantsKbFolder(content: string): boolean {
  const t = (content || "").toLowerCase();
  return (
    /\b(knowledge base|kb folder|new folder|create (a )?folder|add (them |the files )?to (my )?folder|save (them |it )?to (my )?(knowledge base|kb|folder))\b/.test(t)
  );
}

export function detectFormats(content: string): string[] {
  const t = (content || "").toLowerCase();
  const formats: string[] = [];
  if (/\bpdf\b/.test(t)) formats.push("pdf");
  if (/\bpptx|powerpoint|slides|presentation\b/.test(t)) formats.push("pptx");
  if (/\bdocx|\bword\b/.test(t)) formats.push("docx");
  if (/\bxlsx|excel|spreadsheet\b/.test(t)) formats.push("xlsx");
  if (/\bcsv\b/.test(t)) formats.push("csv");
  if (/\brtf\b/.test(t)) formats.push("rtf");
  if (/\bmarkdown|\.md\b/.test(t)) formats.push("md");
  if (/\bhtml\b/.test(t)) formats.push("html");
  if (/\btxt\b/.test(t)) formats.push("txt");
  if (!formats.length) formats.push("pdf");
  // unique
  return [...new Set(formats)];
}

function extractField(content: string, labels: RegExp): string | null {
  const m = content.match(labels);
  return m?.[1]?.trim() || null;
}

export function isEmailAccountAssignment(content: string): boolean {
  const t = (content || "").toLowerCase();
  return /email account|creating an email|create (an )?email|steps for creating an email/.test(t);
}

export function buildEmailAccountAssignment(content: string, userName?: string): string {
  const name =
    extractField(content, /(?:name|full name)\s*[:\-]\s*([^\n,]+)/i) ||
    userName ||
    "[Your Full Name]";
  const dept =
    extractField(content, /(?:department|dept|course)\s*[:\-]\s*([^\n,]+)/i) || "ICT";
  const matric =
    extractField(content, /(?:matric|mat\.?\s*no\.?|matriculation)\s*[:\-]\s*([^\n,]+)/i) || null;
  const lines = [`Name: ${name}`, `Department: ${dept}`];
  if (matric) lines.push(`Matric No.: ${matric}`);
  lines.push(
    "",
    "Steps for Creating an Email Account",
    "",
    "1. Open Google Chrome or any web browser on your phone or computer.",
    "2. Go to www.gmail.com.",
    "3. Click Create Account.",
    "4. Enter your first name and last name.",
    "5. Choose a unique email address (username).",
    "6. Create a strong password and confirm it.",
    "7. Enter your phone number if required and verify it with the code sent to you.",
    "8. Fill in your date of birth and other required details.",
    "9. Read and accept the Terms and Conditions.",
    "10. Click Next to complete the registration.",
    "",
    "Conclusion: An email account allows a person to send and receive messages, files, and important information online."
  );
  return lines.join("\n");
}

function topicFromContent(content: string): string {
  const t = content
    .replace(/\b(research|explain|generate|create|make|turn it into|download|pdf|pptx|powerpoint|presentation|knowledge base|folder|share)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (/java/i.test(content)) return "Java Programming Language";
  return t.slice(0, 80) || "Study Topic";
}

async function draftTopicContent(content: string, mode: "report" | "slides"): Promise<string> {
  const topic = topicFromContent(content);
  const system =
    mode === "report"
      ? `Write a clear student study report on the topic. Use plain ASCII.
Structure:
Title
1. Introduction (short)
2. History / Background
3. Key Features
4. Core Concepts (with short explanations)
5. Real-world Uses
6. Simple code example if relevant
7. Conclusion
Keep it under ~800 words. No markdown tables. No "how to convert to PDF".`
      : `Write a PowerPoint-ready outline on the topic. Plain ASCII.
Format EXACTLY like:
Slide 1: Title
- bullet
Slide 2: ...
Include 10-14 slides. Short bullets only. No markdown tables. No export instructions.`;

  try {
    const result = await chatCompletionWithFailover(
      [
        { role: "system", content: system },
        { role: "user", content: `Topic request: ${content}\n\nFocus topic: ${topic}` },
      ] as any,
      "fast"
    );
    return String(result?.text || "")
      .replace(new RegExp("^`{3}[a-z]*\\n?", "i"), "")
      .replace(new RegExp("\\n?`{3}$", "i"), "")
      .trim();
  } catch {
    if (mode === "slides") {
      return [
        `Slide 1: ${topic}`,
        "- Overview",
        `Slide 2: What is ${topic}?`,
        "- Definition",
        "- Why it matters",
        "Slide 3: Key Features",
        "- Feature 1",
        "- Feature 2",
        "Slide 4: Core Concepts",
        "- Concept A",
        "- Concept B",
        "Slide 5: How it works",
        "- High-level flow",
        "Slide 6: Advantages",
        "- Point 1",
        "- Point 2",
        "Slide 7: Limitations",
        "- Point 1",
        "Slide 8: Real-world use",
        "- Example",
        "Slide 9: Getting started",
        "- Step 1",
        "- Step 2",
        "Slide 10: Summary",
        "- Key takeaways",
      ].join("\n");
    }
    return `${topic}\n\n1. Introduction\n${topic} is an important topic in computing.\n\n2. Key points\n- Core ideas\n- Practical use\n\n3. Conclusion\nUnderstanding ${topic} helps students build stronger programming skills.`;
  }
}

async function createKbFolderWithFiles(
  userId: string,
  folderName: string,
  artifacts: ArtifactRef[]
): Promise<{ folderId: string; folderName: string } | null> {
  try {
    const folder = await storage.createKBFolder({
      user_id: userId,
      name: folderName.slice(0, 80),
      description: "Created by LENORY assistant",
    });
    const folderId = folder?.id;
    if (!folderId) return null;
    for (const art of artifacts) {
      try {
        await storage.createKBFile({
          folder_id: folderId,
          user_id: userId,
          name: art.name,
          file_type: "assistant_artifact",
          mime_type: art.mimeType,
          file_size: art.size,
          full_text_url: art.url,
          source_type: "assistant_file",
          extracted_text: `Generated by LENORY: ${art.name}`,
        });
      } catch (e) {
        console.warn("KB file attach failed", e);
      }
    }
    return { folderId, folderName: folder.name || folderName };
  } catch (e) {
    console.error("KB folder create failed", e);
    return null;
  }
}

export async function runQuickFileGeneration(opts: {
  userId: string;
  content: string;
  userName?: string;
  onStatus?: (s: AssistantStatus, detail?: string) => void;
}): Promise<{ answer: string; artifacts: ArtifactRef[]; folder?: { id: string; name: string } | null }> {
  const formats = detectFormats(opts.content);
  const needFolder = wantsKbFolder(opts.content);
  const artifacts: ArtifactRef[] = [];
  const toolsUsed: string[] = [];

  opts.onStatus?.("planning", formats.join(","));

  // Email assignment: short deterministic template for every requested format
  if (isEmailAccountAssignment(opts.content)) {
    const body = buildEmailAccountAssignment(opts.content, opts.userName);
    const title = "Steps for Creating an Email Account";
    const nameBit =
      extractField(opts.content, /(?:name|full name)\s*[:\-]\s*([^\n,]+)/i) ||
      opts.userName ||
      "Assignment";
    for (const format of formats) {
      opts.onStatus?.("generating_file", format);
      const fileName = `Steps_Email_Account_${String(nameBit).replace(/[^\w]+/g, "_").slice(0, 24)}`;
      const result = await toolGenerateFile(
        { userId: opts.userId, onStatus: opts.onStatus },
        { format, title, content: body, fileName }
      );
      toolsUsed.push("generate_file");
      if (result.artifacts?.length) artifacts.push(...result.artifacts);
    }
  } else {
    // Research / topic documents
    opts.onStatus?.("writing", "drafting content");
    const topic = topicFromContent(opts.content);
    let reportBody = "";
    let slidesBody = "";

    if (formats.includes("pdf") || formats.includes("docx") || formats.includes("txt") || formats.includes("md")) {
      reportBody = await draftTopicContent(opts.content, "report");
    }
    if (formats.includes("pptx")) {
      slidesBody = await draftTopicContent(opts.content, "slides");
    }
    // fallback shared body
    if (!reportBody && !slidesBody) {
      reportBody = await draftTopicContent(opts.content, "report");
    }

    for (const format of formats) {
      opts.onStatus?.("generating_file", format);
      const isSlides = format === "pptx";
      const body = isSlides ? slidesBody || reportBody : reportBody || slidesBody;
      const title = isSlides ? `${topic} - Presentation` : topic;
      const fileName = `${topic.replace(/[^\w]+/g, "_").slice(0, 40)}_${format}`;
      const result = await toolGenerateFile(
        { userId: opts.userId, onStatus: opts.onStatus },
        { format, title, content: body, fileName }
      );
      toolsUsed.push("generate_file");
      if (result.artifacts?.length) artifacts.push(...result.artifacts);
    }
  }

  if (!artifacts.length) {
    throw new Error("File generation produced no downloadable artifacts");
  }

  let folder: { id: string; name: string } | null = null;
  if (needFolder) {
    opts.onStatus?.("saving", "knowledge base folder");
    const topic = topicFromContent(opts.content);
    const created = await createKbFolderWithFiles(opts.userId, topic, artifacts);
    if (created) {
      folder = { id: created.folderId, name: created.folderName };
      toolsUsed.push("kb_create_folder");
    }
  }

  opts.onStatus?.("completed");

  const fileLines = artifacts
    .map((a) => `- **${a.name}** (${Math.max(1, Math.round(a.size / 1024))} KB)`)
    .join("\n");

  let answer =
    `Your file${artifacts.length > 1 ? "s are" : " is"} ready.\n\n` +
    `Tap **Download** on each file card below to save to your device.\n\n` +
    fileLines;

  if (folder) {
    answer +=
      `\n\n**Knowledge Base folder created:** ${folder.name}\n` +
      `Open it from **Knowledge Base** in the app to share with your lecturer.`;
  } else if (needFolder) {
    answer +=
      `\n\nI created the downloadable files. Creating the Knowledge Base folder did not complete — you can still download the files above and upload them manually.`;
  }

  return { answer, artifacts, folder };
}
