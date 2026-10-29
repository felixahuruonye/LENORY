/**
 * Claude-style capability flags for LENORY.
 * Stored per-user; Chat/Live AI load them each request and only expose
 * tools the student has enabled.
 */

export type ToolAccessMode = "auto" | "on_demand" | "always";

export interface UserCapabilities {
  webSearch: boolean;
  fileCreation: boolean;
  artifacts: boolean;
  memory: boolean;
  knowledgeBase: boolean;
  toolAccess: ToolAccessMode;
  /** When true, model may create KB folders and attach files */
  kbWrite: boolean;
}

export const DEFAULT_CAPABILITIES: UserCapabilities = {
  webSearch: true,
  fileCreation: true,
  artifacts: true,
  memory: true,
  knowledgeBase: true,
  toolAccess: "auto",
  kbWrite: true,
};

/** In-memory store (per process). Prefer client localStorage + request body; DB optional later. */
const mem = new Map<string, UserCapabilities>();

export function getUserCapabilities(userId: string, override?: Partial<UserCapabilities> | null): UserCapabilities {
  const base = { ...DEFAULT_CAPABILITIES, ...(mem.get(userId) || {}) };
  if (override) Object.assign(base, override);
  return base;
}

export function setUserCapabilities(userId: string, next: Partial<UserCapabilities>): UserCapabilities {
  const merged = { ...getUserCapabilities(userId), ...next };
  mem.set(userId, merged);
  return merged;
}

export interface ToolDef {
  name: string;
  description: string;
  parameters: Record<string, string>;
  capability: keyof UserCapabilities | "always";
}

export const TOOL_CATALOG: ToolDef[] = [
  {
    name: "web_search",
    description: "Search the live web for current information. Returns titles, URLs, snippets.",
    parameters: { query: "string - search query" },
    capability: "webSearch",
  },
  {
    name: "generate_file",
    description:
      "Create a real downloadable file (pdf, docx, pptx, xlsx, csv, txt, rtf, md, html, json). Returns a working download artifact. NEVER claim success without calling this.",
    parameters: {
      format: "pdf|docx|pptx|xlsx|csv|txt|rtf|md|html|json",
      title: "string",
      content: "string - full document body, plain text",
      fileName: "string optional",
    },
    capability: "fileCreation",
  },
  {
    name: "kb_list_folders",
    description: "List the student's Knowledge Base / notebook folders.",
    parameters: {},
    capability: "knowledgeBase",
  },
  {
    name: "kb_read_folder",
    description: "Read files and text from one of the student's KB folders (must own it).",
    parameters: { folderId: "string" },
    capability: "knowledgeBase",
  },
  {
    name: "kb_create_folder",
    description: "Create a new Knowledge Base folder for the student.",
    parameters: { name: "string", description: "string optional" },
    capability: "kbWrite",
  },
];

export function toolsForCapabilities(caps: UserCapabilities): ToolDef[] {
  return TOOL_CATALOG.filter((t) => {
    if (t.capability === "always") return true;
    return !!(caps as any)[t.capability];
  });
}

/** System prompt block the model sees — real tools, not marketing. */
export function buildToolsSystemBlock(caps: UserCapabilities): string {
  const tools = toolsForCapabilities(caps);
  if (!tools.length) {
    return "No external tools are enabled for this user. Answer from knowledge only. Do not claim you generated files or searched the web.";
  }

  const lines = tools.map(
    (t) =>
      `- ${t.name}: ${t.description}\n  params: ${JSON.stringify(t.parameters)}`
  );

  return `## ENABLED TOOLS (you must use these to complete tasks)
${lines.join("\n")}

### How to call a tool
When you need a tool, output EXACTLY one block:

TOOL_CALL
{"name":"tool_name","arguments":{...}}
END_TOOL_CALL

Then stop. The server will run the tool and send TOOL_RESULT back.
You may call multiple tools across turns.
When finished, write the final user-facing answer WITHOUT claiming a file exists unless a TOOL_RESULT included a real artifact URL.

### Rules
- File requests (PDF, PPTX, DOCX, etc.): ALWAYS call generate_file. Never tell the user to use Google Docs/Word instead.
- Multiple files: call generate_file once per file.
- Knowledge Base folder: call kb_create_folder then mention the folder name.
- Web research when current info is needed: call web_search first.
- Never invent download links. Never say a tool is unavailable if it is listed above.
- Simple questions: answer directly with no tools.`;
}
