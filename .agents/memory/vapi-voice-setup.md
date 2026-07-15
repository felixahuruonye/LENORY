---
name: VAPI voice setup
description: Configuration details for the VAPI voice integration, known working settings, and credit deduction pattern
---

## Working voice configuration

- **Provider**: `openai`, **voiceId**: `alloy`
- DO NOT use `playht/jennifer` — PlayHT requires a separate paid account in addition to VAPI
- Other working OpenAI voices: `echo`, `nova`

## Mic permission check

Always call `navigator.mediaDevices.getUserMedia({ audio: true })` before `vapi.start()` and stop the stream immediately. If denied, throw a user-friendly error before VAPI is even initialized.

## Call duration and credit tracking

- `callStartTimeRef.current = Date.now()` is set on `call-start` event
- A 1-second interval updates `callDurationSeconds` state
- On `call-end` or `stopCall()`, duration is calculated and `POST /api/voice/end-call` is called with `{ durationSeconds }`
- Server deducts `Math.ceil(durationSeconds / 60) * 20` credits
- Admin (felixahuruonye@gmail.com) is exempt from credit deduction

## Chat context injection

`startCall(chatMessages?)` accepts `{ role, content }[]`
- Last 6 messages are injected into the VAPI model's `messages` array
- System prompt mentions the context is from an existing chat
- VapiPanel passes current chat messages when user opens it

**Why**: Without context, the voice AI doesn't know about the ongoing text conversation and gives generic responses.
