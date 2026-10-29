/**
 * Capability-aware agent loop: model proposes TOOL_CALL → server executes → result fed back.
 * Shared by Chat and Live AI. Evidence-based: never claims file success without artifacts.
 */
import type { UserCapabilities } from "./capabilities";
import { buildToolsSystemBlock, getUserCapabilities, toolsForCapabilities } from "./capabilities";
import { toolGenerateFile, toolListKbFolders, toolReadKbFolder, toolWebSearch } from "./tools/index";
import { storage } from "../storage";
import { chatCompletionWithFailover } from "../aiRouter";
import type { ArtifactRef, AssistantStatus, Citation } from "./types";

const TOOL_CALL_RE = /TOOL_CALL\s*([\s\S]*?)\s*END_TOOL_CALL/i;

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

async function executeTool(
  userId: string,
  name: string,
  args: any,
  onStatus?: AgentInput["onStatus"]
): Promise<{ summary: string; artifacts?: ArtifactRef[]; citations?: Citation[]; data?: any }> {
  const ctx = { userId, onStatus };
  switch (name) {
    case "web_search": {
      const r = await toolWebSearch(ctx, String(args?.query || ""));
      return { summary: r.summary, citations: r.citations, data: r.data };
    }
    case "generate_file": {
      const r = await toolGenerateFile(ctx, {
        format: String(args?.format || "pdf"),
        title: String(args?.title || "Document"),
        content: String(args?.content || ""),
        fileName: args?.fileName ? String(args.fileName) : undefined,
      });
      return { summary: r.summary, artifacts: r.artifacts, data: r.data };
    }
    case "kb_list_folders": {
      const r = await toolListKbFolders(ctx);
      return { summary: r.summary, data: r.data };
    }
    case "kb_read_folder": {
      const r = await toolReadKbFolder(ctx, String(args?.folderId || ""));
      return { summary: r.summary, data: r.data };
    }
    case "kb_create_folder": {
      onStatus?.("saving", "knowledge base folder");
      try {
        const folder = await storage.createKBFolder({
          user_id: userId,
          name: String(args?.name || "LENORY Folder").slice(0, 80),
          description: String(args?.description || "Created by LENORY assistant"),
        });
        return {
          summary: `Created Knowledge Base folder "${folder?.name}" (id: ${folder?.id}). Student can open it from Knowledge Base.`,
          data: { folderId: folder?.id, name: folder?.name },
        };
      } catch (e: any) {
        return { summary: `Failed to create folder: ${e?.message || e}` };
      }
    }
    default:
      return { summary: `Unknown tool: ${name}` };
  }
}

function parseToolCall(text: string): { name: string; arguments: any } | null {
  const m = text.match(TOOL_CALL_RE);
  if (!m) return null;
  try {
    const json = JSON.parse(m[1].trim());
    if (json?.name) return { name: String(json.name), arguments: json.arguments || {} };
  } catch {
    // try to extract name loosely
    const nameM = m[1].match(/"name"\s*:\s*"([^"]+)"/);
    if (nameM) return { name: nameM[1], arguments: {} };
  }
  return null;
}

export async function runCapabilityAgent(input: AgentInput): Promise<AgentResult> {
  const caps = getUserCapabilities(input.userId, input.capabilities);
  const enabled = toolsForCapabilities(caps);
  const toolsBlock = buildToolsSystemBlock(caps);
  const maxSteps = input.maxSteps ?? 6;

  const artifacts: ArtifactRef[] = [];
  const citations: Citation[] = [];
  const toolsUsed: string[] = [];
  let folder: { id: string; name: string } | null = null;

  const messages: { role: string; content: string }[] = [
    {
      role: "system",
      content: `You are LENORY, a task-capable study assistant for Nigerian students.
User name: ${input.userName || "Student"}

${toolsBlock}

Write clear, natural English. Match the request length: short for simple questions, thorough for research.
When tools produce files, tell the student to use the Download button — do not invent links.`,
    },
    ...(input.history || []).slice(-12).map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: input.content },
  ];

  input.onStatus?.("understanding_request");

  // If file creation enabled and message clearly needs a file, bias the first turn
  const needsFile =
    caps.fileCreation &&
    /\b(pdf|docx?|pptx?|xlsx?|csv|generate|create|download|presentation|slides)\b/i.test(input.content);

  if (needsFile) {
    messages.push({
      role: "system",
      content:
        "This request requires real file generation. You MUST call generate_file (one TOOL_CALL per file). Do not give Google Docs/Word instructions.",
    });
  }

  let finalAnswer = "";

  for (let step = 0; step < maxSteps; step++) {
    input.onStatus?.(step === 0 ? "planning" : "writing", `step ${step + 1}`);
    const tier = input.isAdvanced ? "ultra" : "fast";
    let text = "";
    try {
      const res = await chatCompletionWithFailover(messages as any, tier);
      text = String(res?.text || "").trim();
    } catch (e: any) {
      if (step === 0) throw e;
      finalAnswer = finalAnswer || "I hit a model error while finishing. Any files already generated are still available below.";
      break;
    }

    const call = parseToolCall(text);
    if (call) {
      // Only allow tools that are enabled
      if (!enabled.find((t) => t.name === call.name)) {
        messages.push({ role: "assistant", content: text });
        messages.push({
          role: "user",
          content: `TOOL_RESULT\nTool "${call.name}" is not enabled for this user. Continue without it or ask them to enable it in Capabilities.`,
        });
        continue;
      }

      toolsUsed.push(call.name);
      input.onStatus?.(
        call.name === "web_search"
          ? "searching"
          : call.name.startsWith("kb_")
            ? "reading_files"
            : call.name === "generate_file"
              ? "generating_file"
              : "using_lenory_feature",
        call.name
      );

      const result = await executeTool(input.userId, call.name, call.arguments, input.onStatus);
      if (result.artifacts?.length) artifacts.push(...result.artifacts);
      if (result.citations?.length) citations.push(...result.citations);
      if (call.name === "kb_create_folder" && result.data?.folderId) {
        folder = { id: result.data.folderId, name: result.data.name };
      }

      messages.push({ role: "assistant", content: text });
      messages.push({
        role: "user",
        content:
          `TOOL_RESULT for ${call.name}:\n${result.summary}\n` +
          (result.artifacts?.length
            ? `Artifacts: ${JSON.stringify(result.artifacts.map((a) => ({ name: a.name, url: a.url, size: a.size })))}\n`
            : "") +
          (result.data ? `Data: ${JSON.stringify(result.data).slice(0, 2000)}\n` : "") +
          `Continue. If more tools are needed, emit another TOOL_CALL. Otherwise write the final answer for the student.`,
      });
      continue;
    }

    // No tool call → final answer
    finalAnswer = text
      .replace(TOOL_CALL_RE, "")
      .replace(/GOOGLE DOCS|use Microsoft Word to create a PDF/gi, "")
      .trim();
    break;
  }

  // Safety: if user asked for files and none were produced, force one PDF
  if (needsFile && !artifacts.length && caps.fileCreation) {
    input.onStatus?.("generating_file", "fallback");
    try {
      const body =
        finalAnswer ||
        `${input.content}\n\nName: ${input.userName || "[Your Name]"}\n\n(Generated by LENORY)`;
      const r = await toolGenerateFile(
        { userId: input.userId, onStatus: input.onStatus },
        {
          format: /\bpptx|powerpoint|slides/i.test(input.content)
            ? "pptx"
            : /\bdocx|word/i.test(input.content)
              ? "docx"
              : "pdf",
          title: "LENORY document",
          content: body.slice(0, 12000),
          fileName: "LENORY_document",
        }
      );
      if (r.artifacts?.length) {
        artifacts.push(...r.artifacts);
        toolsUsed.push("generate_file");
        finalAnswer =
          `Your file is ready.\n\nTap **Download** on the file card below.\n\n` +
          (finalAnswer ? finalAnswer.slice(0, 1500) : "");
      }
    } catch (e) {
      console.error("agent fallback file failed", e);
    }
  }

  if (!finalAnswer) {
    finalAnswer = artifacts.length
      ? `Your file${artifacts.length > 1 ? "s are" : " is"} ready. Tap **Download** below.`
      : "Done.";
  }

  if (folder) {
    finalAnswer += `\n\n**Knowledge Base folder:** ${folder.name} — open it from Knowledge Base to share.`;
  }

  input.onStatus?.("completed");
  return { answer: finalAnswer, artifacts, citations, toolsUsed, folder };
}
