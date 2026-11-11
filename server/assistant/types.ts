/** Shared types for the student-facing AI task orchestrator */

export type AssistantStatus =
  | "understanding"
  | "planning"
  | "searching"
  | "reading_files"
  | "reading_sources"
  | "running_code"
  | "saving_memory"
  | "remembering"
  | "searching_memory"
  | "searching_documents"
  | "editing_file"
  | "generating_image"
  | "generating_video"
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
  /** Durable public copy (Supabase) used if the authenticated server copy is gone after a redeploy */
  fallbackUrl?: string;
}

export interface ToolResult {
  tool: string;
  success: boolean;
  summary: string;
  data?: any;
  error?: string;
  citations?: Citation[];
  artifacts?: ArtifactRef[];
  /** Pictures to show inside the chat (generated or edited) */
  images?: { url: string; title: string; id?: string }[];
  /** Delete confirmation cards (nothing is deleted until the student presses Delete) */
  confirmations?: { token: string; kind: string; name: string; warning: string }[];
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
  /** The mode the student is on; image tools pick Stability (Ultra/Fast) or Nano Banana (Vision) from it */
  lane?: "ultra" | "fast" | "vision";
}
