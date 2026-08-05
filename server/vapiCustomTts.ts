// server/vapiCustomTts.ts
//
// Bridges Vapi's "Custom TTS" webhook to YarnGPT, so Live AI calls can
// actually use the Nigerian voice a user picked as their default in Voice
// Gallery — instead of Vapi's built-in voice providers (which don't include
// YarnGPT) silently approximating it with the nearest-gender OpenAI voice.
//
// Vapi calls this endpoint mid-conversation with the text to speak and a
// required sample rate; we call YarnGPT (which returns MP3), transcode it to
// raw 16-bit little-endian mono PCM at that exact sample rate with ffmpeg,
// and stream it back. Any deviation from that exact format causes distorted
// audio or a dropped call, per Vapi's docs — so the transcode step is not
// optional.
//
// Tradeoff worth knowing: this adds a network hop (our server → yarngpt.ai)
// plus a transcode step on top of Vapi's own pipeline, so it will likely add
// real latency compared to Vapi's built-in OpenAI voice. The assistant
// config that uses this always sets a fallbackPlan to the OpenAI
// approximation, so a slow/failed request degrades gracefully instead of
// dropping the call.

import { spawn } from "child_process";
// @ts-ignore — ffmpeg-static has no types; it just exports a binary path string
import ffmpegPath from "ffmpeg-static";
import type { Express, Request, Response } from "express";

const VALID_SAMPLE_RATES = new Set([8000, 16000, 22050, 24000, 44100]);

function mp3ToPcm(mp3Buffer: Buffer, sampleRate: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const ff = spawn(ffmpegPath as unknown as string, [
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      "pipe:0",
      "-f",
      "s16le",
      "-acodec",
      "pcm_s16le",
      "-ac",
      "1",
      "-ar",
      String(sampleRate),
      "pipe:1",
    ]);
    const chunks: Buffer[] = [];
    let stderr = "";
    ff.stdout.on("data", (d: Buffer) => chunks.push(d));
    ff.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
    ff.on("error", reject);
    ff.on("close", (code) => {
      if (code === 0) resolve(Buffer.concat(chunks));
      else reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(0, 300)}`));
    });
    ff.stdin.write(mp3Buffer);
    ff.stdin.end();
  });
}

export function registerVapiCustomTtsRoutes(app: Express) {
  app.post("/api/vapi/custom-tts/yarngpt", async (req: Request, res: Response) => {
    const startTime = Date.now();
    try {
      // Secret check is opt-in: only enforced if VAPI_CUSTOM_TTS_SECRET is
      // set on Render. Without it, this endpoint is reachable by anyone who
      // knows the URL and sends a well-formed request — low real-world risk
      // (worst case is a bit of wasted YarnGPT quota), but for real
      // protection, set VAPI_CUSTOM_TTS_SECRET here AND
      // VITE_VAPI_CUSTOM_TTS_SECRET on the client build, or better, switch
      // to Vapi's "Custom Credentials" dashboard feature so no secret ever
      // ships in client JS at all.
      const secret = process.env.VAPI_CUSTOM_TTS_SECRET;
      if (secret && req.headers["x-vapi-secret"] !== secret) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const message = req.body?.message;
      if (!message || message.type !== "voice-request") {
        return res.status(400).json({ error: "Invalid message type" });
      }
      const text: string = message.text;
      const sampleRate: number = message.sampleRate;
      if (!text || typeof text !== "string" || !text.trim()) {
        return res.status(400).json({ error: "Invalid or missing text" });
      }
      if (!VALID_SAMPLE_RATES.has(sampleRate)) {
        return res.status(400).json({ error: "Unsupported sample rate", supportedRates: [...VALID_SAMPLE_RATES] });
      }

      const speaker = typeof req.query.speaker === "string" ? req.query.speaker : "Idera";
      const apiKey = process.env.YARNGPT_API_KEY;
      if (!apiKey) {
        console.error("Vapi custom TTS: missing YARNGPT_API_KEY");
        return res.status(500).json({ error: "YarnGPT not configured" });
      }

      const ytResponse = await fetch("https://yarngpt.ai/api/v1/tts", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ text: text.slice(0, 2000), voice: speaker, response_format: "mp3" }),
        signal: AbortSignal.timeout(20000),
      });
      if (!ytResponse.ok) {
        const errText = await ytResponse.text().catch(() => "");
        console.error(`Vapi custom TTS: YarnGPT failed (${ytResponse.status}): ${errText.slice(0, 200)}`);
        return res.status(502).json({ error: "TTS synthesis failed" });
      }

      const mp3Buffer = Buffer.from(await ytResponse.arrayBuffer());
      const pcmBuffer = await mp3ToPcm(mp3Buffer, sampleRate);

      res.setHeader("Content-Type", "application/octet-stream");
      res.setHeader("Content-Length", pcmBuffer.length);
      res.end(pcmBuffer);
      console.log(`Vapi custom TTS (${speaker}, ${sampleRate}Hz): ${Date.now() - startTime}ms, ${pcmBuffer.length} bytes`);
    } catch (error: any) {
      console.error("Vapi custom TTS error:", error?.message);
      if (!res.headersSent) res.status(500).json({ error: "TTS synthesis failed" });
    }
  });
}
