/**
 * Handwriting / document OCR abstraction for Write My Note → Scan notes.
 * Isolated from Live Session recording / transcription paths.
 *
 * Resilience: Gemini 503/high-demand → retry with backoff → next model →
 * OpenRouter vision fallback so one busy model does not blank every page.
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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function isApiErrorText(text: string): boolean {
  return /"error"\s*:|"code"\s*:\s*50[0-9]|"code"\s*:\s*404|NOT_FOUND|UNAVAILABLE|no longer available|high demand|RESOURCE_EXHAUSTED/i.test(
    text
  );
}

function isRetryable(msg: string): boolean {
  return /503|UNAVAILABLE|high demand|RESOURCE_EXHAUSTED|429|rate.?limit|timeout|OCR_TIMEOUT|ECONNRESET|fetch failed|temporar/i.test(
    msg
  );
}

function isModelDead(msg: string): boolean {
  return /404|NOT_FOUND|no longer available|not found|invalid model|deprecated/i.test(msg);
}

async function callGeminiOnce(
  ai: any,
  model: string,
  buffer: Buffer,
  mimeType: string
): Promise<string> {
  const timeout = new Promise<never>((_, rej) =>
    setTimeout(() => rej(new Error("OCR_TIMEOUT")), 50_000)
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
  if (isApiErrorText(text)) {
    throw new Error(text.slice(0, 220));
  }
  return text;
}

async function openRouterOcr(buffer: Buffer, mimeType: string): Promise<string> {
  if (!process.env.OPENROUTER_API_KEY) {
    throw new Error("OPENROUTER_API_KEY not configured");
  }
  const { analyzeFilesWithOpenRouterVision } = await import("./imageProviders");
  const text = await analyzeFilesWithOpenRouterVision(
    [{ base64: buffer.toString("base64"), mimeType: mimeType || "image/jpeg" }],
    HANDWRITING_PROMPT
  );
  const cleaned = String(text || "").trim();
  if (isApiErrorText(cleaned)) throw new Error(cleaned.slice(0, 200));
  return cleaned;
}

async function geminiExtract(buffer: Buffer, mimeType: string): Promise<string> {
  const key = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY || "";
  const hasGemini = !!key;
  const hasOr = !!process.env.OPENROUTER_API_KEY;
  if (!hasGemini && !hasOr) {
    throw new Error("No OCR provider key configured (need GOOGLE_API_KEY/GEMINI_API_KEY or OPENROUTER_API_KEY)");
  }

  const models = [
    process.env.GEMINI_OCR_MODEL,
    process.env.GEMINI_VISION_MODEL,
    "gemini-3.8-flash",
    "gemini-3.6-flash",
    "gemini-3.5-flash-lite",
    "gemini-2.5-flash",
  ].filter((m, i, a): m is string => !!m && a.indexOf(m) === i);

  let lastErr = "";
  let ai: any = null;
  if (hasGemini) {
    const { GoogleGenAI } = await import("@google/genai");
    ai = new GoogleGenAI({ apiKey: key });
  }

  // Each model: up to 3 attempts with backoff on 503/high demand
  if (ai) {
    for (const model of models) {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          if (attempt > 0) await sleep(800 * Math.pow(2, attempt - 1)); // 0.8s, 1.6s
          const text = await callGeminiOnce(ai, model, buffer, mimeType);
          return text;
        } catch (e: any) {
          const msg = String(e?.message || e || "");
          lastErr = msg.slice(0, 240);
          if (isModelDead(msg)) break; // next model
          if (isRetryable(msg)) continue; // retry same model
          // non-retryable for this model → try next
          break;
        }
      }
    }
  }

  // OpenRouter vision fallback (different quota bucket)
  if (hasOr) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        if (attempt > 0) await sleep(1200);
        return await openRouterOcr(buffer, mimeType);
      } catch (e: any) {
        lastErr = String(e?.message || e || "").slice(0, 240);
        if (!isRetryable(lastErr)) break;
      }
    }
  }

  throw new Error(
    lastErr
      ? `OCR temporarily unavailable (${lastErr.slice(0, 160)}). Try again in a moment.`
      : "OCR failed — no working model"
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
  id: "gemini+openrouter",
  label: "Gemini Vision OCR (OpenRouter fallback)",
  available: () =>
    !!(process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY || process.env.OPENROUTER_API_KEY),
  async extractPage(page) {
    const warnings: string[] = [];
    let text = "";
    try {
      text = await geminiExtract(page.buffer, page.mimeType);
    } catch (e: any) {
      const msg = String(e?.message || "OCR failed");
      // Never put raw JSON error bodies into the document text
      warnings.push(msg.replace(/\{[^}]*"error"[^}]*\}/g, "provider busy").slice(0, 180));
      return {
        index: page.index,
        fileName: page.fileName,
        text: "",
        confidence: "none",
        warnings,
        isBlank: true,
      };
    }
    if (!text || text === "NO_TEXT_FOUND" || isApiErrorText(text)) {
      return {
        index: page.index,
        fileName: page.fileName,
        text: "",
        confidence: "none",
        warnings: isApiErrorText(text)
          ? ["Provider returned an error instead of text — will retry on next run"]
          : ["No readable text detected on this page"],
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
    "No OCR provider configured. Set GOOGLE_API_KEY, GEMINI_API_KEY, or OPENROUTER_API_KEY on the server."
  );
}

/** Combine page texts in order without summarizing. Skip raw API error blobs. */
export function combinePageTexts(pages: OcrPageResult[]): string {
  const parts: string[] = [];
  for (const p of pages) {
    if (p.isBlank || !p.text.trim() || isApiErrorText(p.text)) {
      parts.push(`\n\n--- Page ${p.index + 1} (no readable text) ---\n`);
      continue;
    }
    parts.push(`\n\n--- Page ${p.index + 1} ---\n\n${p.text.trim()}`);
  }
  return parts.join("").trim();
}
