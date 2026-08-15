// server/imageProviders.ts
//
// Fallback image providers for when Gemini's own image models (Nano Banana)
// fail — most commonly RESOURCE_EXHAUSTED/quota, but also auth or timeout.
// generateImageWithLENORY (in gemini.ts) already tries 2 Gemini models
// sequentially; these are the NEXT two providers in the chain if both of
// those fail: NexaAPI (paid, has free starting credits, needs NEXA_API_KEY),
// then Pollinations.AI (free, no key required, last resort).
//
// Implemented via direct REST calls rather than the `nexaapi` npm package —
// its exact response shape isn't independently verifiable without a live
// key, so this is deliberately defensive: it checks multiple plausible
// response shapes and throws a clear, specific error (not a silent/fake
// success) if none match, so a real failure here is just as diagnosable as
// the Gemini one already is.

export type ImageProviderResult = {
  dataUrl: string; // always a data: URL — normalized here so the caller
                    // (uploadImageToStorage) doesn't need to know which
                    // provider produced it, and so a generated image is
                    // never left depending on a third party's URL staying
                    // alive (that's exactly what broke via.placeholder.com).
  provider: "nexaapi" | "pollinations";
};

async function urlToDataUrl(url: string, fallbackMime = "image/png"): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch generated image from provider (${res.status})`);
  const contentType = res.headers.get("content-type") || fallbackMime;
  const buffer = await res.arrayBuffer();
  return `data:${contentType};base64,${Buffer.from(buffer).toString("base64")}`;
}

export async function generateWithNexaAPI(prompt: string, imageBase64?: string): Promise<ImageProviderResult> {
  const apiKey = process.env.NEXA_API_KEY;
  if (!apiKey) throw new Error("NEXA_API_KEY not configured");

  const model = imageBase64 ? "flux-kontext" : "flux-schnell";
  const body: Record<string, any> = {
    model,
    prompt,
    width: 512,
    height: 768,
    num_images: 1,
  };
  if (imageBase64) {
    // Strip a data: URL prefix if present — send raw base64 only, matching
    // the documented request shape.
    body.image = imageBase64.replace(/^data:image\/\w+;base64,/, "");
  }

  const res = await fetch("https://api.nexa-api.com/v1/images/generate", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(25000),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`NexaAPI error (${res.status}): ${errText.slice(0, 300)}`);
  }

  const data: any = await res.json();
  // Defensive: different NexaAPI examples in the wild show different
  // response shapes (data[0].b64_json, data[0].url, imageUrl, url) — check
  // all of them rather than assuming one, and fail loudly with the raw
  // response logged if none match, instead of silently returning garbage.
  const first = data?.data?.[0];
  const b64 = first?.b64_json;
  const urlField = first?.url || data?.imageUrl || data?.url;

  if (b64) {
    return { dataUrl: `data:image/png;base64,${b64}`, provider: "nexaapi" };
  }
  if (urlField) {
    return { dataUrl: await urlToDataUrl(urlField), provider: "nexaapi" };
  }
  console.error("NexaAPI returned an unrecognized response shape:", JSON.stringify(data).slice(0, 500));
  throw new Error("NexaAPI returned no image data");
}

export async function generateWithPollinations(prompt: string): Promise<ImageProviderResult> {
  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=512&height=768&model=flux&nologo=true`;
  const res = await fetch(url, { signal: AbortSignal.timeout(25000) });
  if (!res.ok) throw new Error(`Pollinations error (${res.status})`);
  const contentType = res.headers.get("content-type") || "";
  if (!contentType.startsWith("image/")) {
    throw new Error(`Pollinations did not return an image (got ${contentType || "unknown content-type"})`);
  }
  const buffer = await res.arrayBuffer();
  if (buffer.byteLength < 500) throw new Error("Pollinations returned an empty/invalid image");
  return { dataUrl: `data:${contentType};base64,${Buffer.from(buffer).toString("base64")}`, provider: "pollinations" };
}

// Vision/file analysis fallback — used when Gemini's text+vision model
// (gemini-2.5-flash) fails, most likely for the same reason image
// generation was failing: the Gemini API key's project has zero free-tier
// quota. Unlike NexaAPI, this needs no new key from Felix — OPENROUTER_API_KEY
// is already configured and used elsewhere (Ultra-tier chat), so this is
// ready to work immediately.
export async function analyzeFilesWithOpenRouterVision(
  files: { base64: string; mimeType: string; fileName?: string }[],
  instruction: string
): Promise<string> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY not configured");

  const content: any[] = [{ type: "text", text: instruction }];
  for (const f of files) {
    // OpenRouter's chat/completions is OpenAI-compatible: images go in as
    // image_url content blocks with a data: URL, not Gemini's inlineData
    // shape — files here already carry a bare base64 string (no data:
    // prefix, matching how the rest of this codebase stores them), so it
    // has to be added back.
    content.push({ type: "image_url", image_url: { url: `data:${f.mimeType};base64,${f.base64}` } });
  }

  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://lenory.app",
      "X-Title": "LENORY AI",
    },
    body: JSON.stringify({
      // gpt-4o-mini: reliable, cheap, genuinely vision-capable, broadly
      // available on OpenRouter — a different provider and quota bucket
      // entirely from Gemini, which is the whole point of this fallback.
      model: "openai/gpt-4o-mini",
      messages: [{ role: "user", content }],
      max_tokens: 4096,
    }),
    signal: AbortSignal.timeout(60000),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`OpenRouter vision error (${res.status}): ${errText.slice(0, 300)}`);
  }

  const data: any = await res.json();
  const text = data?.choices?.[0]?.message?.content;
  if (!text) throw new Error("OpenRouter vision returned no content");
  return text;
}
