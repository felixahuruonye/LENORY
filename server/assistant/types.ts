/** Shared types for the student-facing AI task orchestrator */

export type AssistantStatus =
  | "understanding"
  | "planning"
  | "searching"
  | "reading_files"
  | "using_feature"
  | "generating_file"
  | "validating"
  | "saving"
  | "writing"
  | "completed"
  | "failed"
  | "cancelled";

export type FileFormat =
  | "pdf"
  | "docx"
  | "txt"
  | "rtf"
  | "md"
  | "markdown"
  | "pptx"
  | "xlsx"
  | "csv"
  | "json"
  | "xml"
  | "yaml"
  | "yml"
  | "html"
  | "css"
  | "js"
  | "javascript"
  | "ts"
  | "typescript"
  | "py"
  | "python"
  | "sql"
  | "zip"
  | "png"
  | "jpeg"
  | "jpg"
  | "webp"
  | "svg";

export interface AssistantMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface Citation {
  title: string;
  url: string;
  snippet?: string;
}

export interface ArtifactRef {
  id: string;
  name: string;
  mimeType: string;
  format: string;
  size: number;
  url: string;
  createdAt: string;
}

export interface ToolResult {
  tool: string;
  success: boolean;
  summary: string;
  data?: any;
  error?: string;
  citations?: Citation[];
  artifacts?: ArtifactRef[];
}

export interface OrchestratorInput {
  userId: string;
  userEmail?: string;
  userName?: string;
  content: string;
  sessionId?: string | null;
  isAdvanced?: boolean;
  isAdmin?: boolean;
  history?: AssistantMessage[];
  kbFolderContext?: string;
  extraSystem?: string;
  /** Emit progress; safe to no-op */
  onStatus?: (status: AssistantStatus, detail?: string) => void;
  /** Emit streamed answer tokens if available */
  onToken?: (token: string) => void;
}

export interface OrchestratorResult {
  answer: string;
  status: AssistantStatus;
  citations: Citation[];
  artifacts: ArtifactRef[];
  toolsUsed: string[];
  modelUsed?: string;
  error?: string;
}

export interface ToolContext {
  userId: string;
  userEmail?: string;
  sessionId?: string | null;
  onStatus?: (status: AssistantStatus, detail?: string) => void;
}
