/**
 * Deterministic short assignment templates + early file path.
 * Used when the user asks for a real downloadable file so the
 * general chat model can never claim "I cannot create PDFs".
 */
import { toolGenerateFile } from "./tools/index";
import type { ArtifactRef, AssistantStatus } from "./types";

export function isFileGenerationRequest(content: string): boolean {
  const t = (content || "").toLowerCase();
  if (!t.trim()) return false;
  const wantsFile =
    /\b(pdf|docx?|pptx?|xlsx?|csv|rtf|\.md\b|markdown|html|zip)\b/.test(t) ||
    /\b(generate|create|make|export|download)\b.{0,40}\b(file|document|report|assignment|slides|spreadsheet)\b/.test(t) ||
    /\b(file|document|assignment)\b.{0,40}\b(pdf|docx?|download)\b/.test(t);
  return wantsFile;
}

export function detectFormat(content: string): string {
  const t = (content || "").toLowerCase();
  if (/\bxlsx|excel|spreadsheet\b/.test(t)) return "xlsx";
  if (/\bcsv\b/.test(t)) return "csv";
  if (/\bpptx|powerpoint|slides|presentation\b/.test(t)) return "pptx";
  if (/\bdocx|word\b/.test(t)) return "docx";
  if (/\brtf\b/.test(t)) return "rtf";
  if (/\bmarkdown|\.md\b/.test(t)) return "md";
  if (/\bhtml\b/.test(t)) return "html";
  if (/\bjson\b/.test(t)) return "json";
  if (/\btxt|text file\b/.test(t)) return "txt";
  return "pdf";
}

function extractField(content: string, labels: RegExp): string | null {
  const m = content.match(labels);
  return m?.[1]?.trim() || null;
}

/** Short one-page email-account assignment (Blessing-style). */
export function buildEmailAccountAssignment(content: string, userName?: string): string {
  const name =
    extractField(content, /(?:name|full name)\s*[:\-]\s*([^\n,]+)/i) ||
    userName ||
    "[Your Full Name]";
  const dept =
    extractField(content, /(?:department|dept|course)\s*[:\-]\s*([^\n,]+)/i) ||
    "ICT";
  const matric =
    extractField(content, /(?:matric|mat\.?\s*no\.?|matriculation)\s*[:\-]\s*([^\n,]+)/i) ||
    null;

  const lines = [
    `Name: ${name}`,
    `Department: ${dept}`,
  ];
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

export function isEmailAccountAssignment(content: string): boolean {
  const t = (content || "").toLowerCase();
  return (
    /email account/.test(t) ||
    /creating an email/.test(t) ||
    /create (an )?email/.test(t) ||
    /steps for creating an email/.test(t)
  );
}

export async function runQuickFileGeneration(opts: {
  userId: string;
  content: string;
  userName?: string;
  onStatus?: (s: AssistantStatus, detail?: string) => void;
}): Promise<{ answer: string; artifacts: ArtifactRef[] }> {
  const format = detectFormat(opts.content);
  opts.onStatus?.("generating_file", format);

  let body: string;
  let title: string;
  let fileName: string;

  if (isEmailAccountAssignment(opts.content)) {
    body = buildEmailAccountAssignment(opts.content, opts.userName);
    title = "Steps for Creating an Email Account";
    const nameBit =
      extractField(opts.content, /(?:name|full name)\s*[:\-]\s*([^\n,]+)/i) ||
      opts.userName ||
      "Assignment";
    fileName = `Steps_for_Creating_an_Email_Account_${String(nameBit).replace(/[^\w]+/g, "_").slice(0, 30)}`;
  } else {
    // Generic short document from the user request itself
    title = "Assignment";
    fileName = "Assignment";
    body =
      `${title}\n\nName: ${opts.userName || "[Your Full Name]"}\n\n` +
      opts.content.replace(/\b(generate|create|make)\b.{0,20}\b(pdf|docx?|file)\b/gi, "").trim() +
      "\n\nConclusion: End of document.";
  }

  const result = await toolGenerateFile(
    { userId: opts.userId, onStatus: opts.onStatus },
    { format, title, content: body, fileName }
  );

  if (!result.success || !result.artifacts?.length) {
    throw new Error(result.error || result.summary || "File generation failed");
  }

  opts.onStatus?.("completed");
  const artifacts = result.artifacts;
  const answer =
    `Your **${format.toUpperCase()}** is ready.\n\n` +
    `Tap **Download** on the file card below to save it to your device.\n\n` +
    artifacts.map((a) => `- **${a.name}** (${Math.max(1, Math.round(a.size / 1024))} KB)`).join("\n");

  return { answer, artifacts };
}
