---
name: YarnGPT TTS
description: Nigerian text-to-speech via YarnGPT HuggingFace Space — endpoint format, speaker IDs, VoiceGallery page
---

## API endpoint

```
POST https://olamilekan-yarngpt.hf.space/run/predict
{ "data": ["text to speak", "speaker_id"] }
```

Returns Gradio format:
```json
{ "data": [{ "data": "base64audio...", "mime_type": "audio/wav" }] }
```
Or sometimes `data[0]` is a string URL.

Backend proxy: `POST /api/tts/yarngpt` — accepts `{ text, speaker }`, returns `{ audioUrl }` or `{ audioBase64, mimeType }`.

## Speaker IDs (confirmed working)

Nigerian English: `idera`, `temi`, `jide`, `chidi`  
Yoruba: `yoruba_female`, `yoruba_male`  
Igbo: `igbo_female`, `igbo_male`  
Hausa: `hausa_male`, `hausa_female`  
Pidgin: `pidgin`

## VoiceGallery page

- Route: `/voice-gallery`
- Nigerian voices → YarnGPT backend proxy
- International voices (alloy, echo, nova) → browser SpeechSynthesis
- Default voice saved to `localStorage` key `lenory_default_voice` (default: `idera`)
- "Use Voice" sets localStorage; "Preview" plays sample audio

**Why**: Provides authentic Nigerian accents vs. generic American-accented VAPI voices, important for Nigerian student users.
