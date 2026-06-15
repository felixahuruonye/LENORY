---
name: Chat UI redesign
description: Chat.tsx completely rewritten to match Claude.ai style — key patterns and components
---

## What was built
Chat.tsx was completely rewritten with a Claude-like UI. Key patterns to keep consistent:

**Structure:**
- Sidebar (collapsible) + Main area (header + messages + input)
- `max-w-3xl mx-auto` for message container
- No separate Live AI page — VAPI panel is embedded inside chat

**New components (all in Chat.tsx):**
- `LenoryStarIcon` — SVG star like Claude's asterisk, used as LENORY logo
- `TypingIndicator` — Bouncing dots + PenLine icon with "LENORY is writing..." text
- `CodeBlock` — Code with language label + copy button (gray toolbar + pre block)
- `LenoryMarkdown` — ReactMarkdown wrapper with custom code/link renderers
- `CreditAlert` — Amber gradient card shown when credits ≤ 5
- `VapiPanel` — Embedded VAPI voice call UI with animated orb

**Input toolbar (bottom of input card):**
- Left: Plus button → model selector dropdown (ChevronDown)
- Right: Wave icon (Live AI toggle) → Mic → Send

**Models:**
- LENORY Ultra (GPT-4 class), LENORY Fast (GPT-3.5), LENORY Vision (Gemini), LENORY Search (internet)
- Sent as `model` param to `/api/chat/send` (server currently ignores it but receives it)

**Credit alert:**
- Triggered when `/api/user/credits` returns `credits ≤ 5`
- Only shown once per session (creditAlertShown flag)
- Also triggered on 402 response from `/api/chat/send`

**Why:** User requested Claude.ai-style redesign with specific features.
