---
name: Vision upload bugs (Chat.tsx file analysis hang)
description: Why uploading multiple files with a prompt causes "Analyzing…" then message vanishes with no AI response
---

## The four compounding root causes

**1. Syntax crash (duplicate import)**
Chat.tsx had `DropdownMenu` imported twice (lines 10–16 AND 63–68). This caused a Babel parse error that killed the entire frontend build — nothing in Chat.tsx worked at all. Fix: remove the second import block.

**2. Express body size limit too small (5 MB)**
`server/index.ts` had `express.json({ limit: "5mb" })`. Two base64-encoded images easily exceed this. Express returns 413 silently. `apiRequest` (from queryClient.ts) calls `throwIfResNotOk` which throws on non-2xx, so the catch inside `Promise.all` catches it as a generic failure — no 413 is surfaced to the user. Fix: raise limit to `"50mb"`.

**3. resetInput() called before analysis**
In `handleSendMessage`, `resetInput()` was called BEFORE `sendPendingFilesWithPrompt()`. The user's typed message was erased immediately. If all file analyses then failed, `handleSendMessageWithContent` was never called — message vanished from chat with no trace. Fix: call `resetInput()` AFTER `sendPendingFilesWithPrompt` returns.

**4. All-failure path never saved to chat**
When all files failed analysis, `analyses.length === 0` → the `if (analyses.length > 0)` block was skipped entirely → nothing written to chat. Fix: add an `else` branch that always saves the user's message to chat (with a helpful error reply from the assistant).

**5. Double Gemini call per file (rate limit risk)**
Old vision endpoint: `analyzeFileWithGeminiVision` (call 1) → if prompt + extracted text, `chatWithAI` (call 2). Two files = 4 Gemini calls in parallel. Fix: single combined `generateContent` call with the image inlineData + prompt text together — more efficient, better quality, no rate limit risk.

**Why:** All five issues existed simultaneously, making the bug feel mysterious. The syntax crash was the most severe (nothing worked), but the body limit was the trigger for the "hang" on larger images.

**How to apply:** When debugging "silent failure" in file upload flows: check (a) import conflicts, (b) body size limits, (c) when the input is cleared relative to async work, (d) what happens when the entire batch fails.
