/**
 * Handwriting / document OCR abstraction for Write My Note → Scan notes.
 * Isolated from Live Session recording / transcription paths.
 */
export interface OcrPageInput {
  index: number;
  buffer: Buffer;
  mimeType: string;
  fileName: string;
}

export interface OcrPageResult {
  index: number;
  fileName: string;
  text: string;
  confidence: "high" | "medium" | "low" | "none";
  warnings: string[];
  isBlank: boolean;
}

export interface OcrProvider {
  id: string;
  label: string;
  available(): boolean;
  extractPage(page: OcrPageInput): Promise<OcrPageResult>;
}

const HANDWRITING_PROMPT = `You are a strict handwriting OCR engine for student lecture notes.

Task: Copy ONLY the text that is visibly written on this page. Character-accurate transcription.

ABSOLUTE RULES:
- Transcribe EXACTLY what is on the page. Do not add headings, titles, conclusions, or explanations that are not written.
- Do NOT summarize, paraphrase, correct grammar, expand abbreviations, or "improve" the notes.
- Do NOT invent missing words, complete unfinished sentences, or fill gaps with guessed content.
- Preserve original structure: headings, numbering, bullets, indentation, line breaks, examples.
- Math: copy symbols as written (Unicode or plain text). Do not reformat into LaTeX unless the page shows LaTeX.
- Illegible word → write [[unclear]] — never guess.
- Blank / no text → reply with exactly: NO_TEXT_FOUND
- Output ONLY the transcribed text. No preamble, no "Here is the transcription", no commentary.`;

async function geminiExtract(buffer: Buffer, mimeType: string): Promise<string> {
  const key = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY || "";
  if (!key) throw new Error("Gemini API key not configured (GOOGLE_API_KEY or GEMINI_API_KEY)");

  // Always use the strict handwriting prompt (do not use generic extractTextFromImage — it may invent structure)
  const { GoogleGenAI } = await import("@google/genai");
  const ai = new GoogleGenAI({ apiKey: key });
  // gemini-2.0-flash was retired (404). Prefer current flash models; allow env override.
  const models = [
    process.env.GEMINI_OCR_MODEL,
    process.env.GEMINI_VISION_MODEL,
    "gemini-3.8-flash",
    "gemini-3.6-flash",
    "gemini-3.5-flash-lite",
    "gemini-2.5-flash",
  ].filter((m, i, a): m is string => !!m && a.indexOf(m) === i);

  let lastErr = "";
  for (const model of models) {
    try {
      const timeout = new Promise<never>((_, rej) =>
        setTimeout(() => rej(new Error("OCR_TIMEOUT")), 45_000)
      );
      const run = ai.models.generateContent({
        model,
        contents: [
          {
            inlineData: {
              mimeType: mimeType || "image/jpeg",
              data: buffer.toString("base64"),
            },
          },
          { text: HANDWRITING_PROMPT },
        ] as any,
        config: { thinkingConfig: { thinkingBudget: 0 } } as any,
      });
      const response = await Promise.race([run, timeout]);
      const text = String((response as any).text || "").trim();
      // SDK sometimes embeds JSON error as "text"
      if (/NOT_FOUND|"code"\s*:\s*404|no longer available/i.test(text)) {
        lastErr = text.slice(0, 200);
        continue;
      }
      return text;
    } catch (e: any) {
      const msg = String(e?.message || e || "");
      lastErr = msg.slice(0, 240);
      // Try next model on 404 / not found / deprecated
      if (/404|NOT_FOUND|no longer available|not found|invalid model/i.test(msg)) continue;
      if (/OCR_TIMEOUT/i.test(msg)) continue;
      throw e;
    }
  }
  throw new Error(
    lastErr
      ? `OCR model unavailable: ${lastErr.slice(0, 180)}`
      : "OCR failed — no working Gemini model"
  );
}

function scoreConfidence(text: string): OcrPageResult["confidence"] {
  if (!text || text === "NO_TEXT_FOUND") return "none";
  const unclear = (text.match(/\[\[unclear\]\]/gi) || []).length;
  const words = text.split(/\s+/).filter(Boolean).length;
  if (words < 3) return "low";
  if (unclear === 0 && words > 20) return "high";
  if (unclear / Math.max(words, 1) > 0.08) return "low";
  if (unclear > 0) return "medium";
  return "high";
}

export const geminiOcrProvider: OcrProvider = {
  id: "gemini",
  label: "Gemini Vision OCR",
  available: () => !!(process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY),
  async extractPage(page) {
    const warnings: string[] = [];
    let text = "";
    try {
      text = await geminiExtract(page.buffer, page.mimeType);
    } catch (e: any) {
      warnings.push(e?.message || "OCR failed");
      return {
        index: page.index,
        fileName: page.fileName,
        text: "",
        confidence: "none",
        warnings,
        isBlank: true,
      };
    }
    if (!text || text === "NO_TEXT_FOUND") {
      return {
        index: page.index,
        fileName: page.fileName,
        text: "",
        confidence: "none",
        warnings: ["No readable text detected on this page"],
        isBlank: true,
      };
    }
    const confidence = scoreConfidence(text);
    if (confidence === "low") warnings.push("Low confidence — review against the original photo");
    if (/\[\[unclear\]\]/i.test(text)) warnings.push("Some words marked [[unclear]]");
    return {
      index: page.index,
      fileName: page.fileName,
      text,
      confidence,
      warnings,
      isBlank: false,
    };
  },
};

export function getOcrProvider(): OcrProvider {
  if (geminiOcrProvider.available()) return geminiOcrProvider;
  throw new Error(
    "No OCR provider configured. Set GOOGLE_API_KEY or GEMINI_API_KEY on the server."
  );
}

/** Combine page texts in order without summarizing. */
export function combinePageTexts(pages: OcrPageResult[]): string {
  const parts: string[] = [];
  for (const p of pages) {
    if (p.isBlank || !p.text.trim()) {
      parts.push(`\n\n--- Page ${p.index + 1} (no readable text) ---\n`);
      continue;
    }
    parts.push(`\n\n--- Page ${p.index + 1} ---\n\n${p.text.trim()}`);
  }
  return parts.join("").trim();
}
