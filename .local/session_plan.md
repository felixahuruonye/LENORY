# Session Plan

## Objective
Implement all pending feature changes across Chat.tsx, LiveSession.tsx, HeyLenoryButton, Dashboard, routes.ts, and service worker.

## Tasks

### T001: Chat.tsx cleanup
- [x] Remove LenoryStarIcon function, replace with Brain icon at all 3 use sites
- [x] Remove CBT Mode, Advanced, Live AI, Knowledge from plus menu (keep 6 items)
- [x] Add Knowledge Base Brain button to chat header
- [x] Add model plan locks (Lock icon + upgrade prompt for non-free models)
- Status: TODO

### T002: HeyLenoryButton.tsx draggable
- [x] Add position state + drag handlers (mouse + touch)
- Status: TODO

### T003: Dashboard.tsx renames
- [x] "Live Sessions" nav → "Write My Note"
- [x] "Join Live Session" card → "Write My Note"
- [x] "Start Live Session" (teacher) → "Write My Note"
- Status: TODO

### T004: LiveSession.tsx complete overhaul
- [x] Rename UI to "Write My Note"
- [x] Remove live streaming AssemblyAI approach
- [x] Add record-first + Groq Whisper transcription
- [x] File size split (>24MB)
- [x] AI note formatting
- [x] History with localStorage
- Status: TODO

### T005: routes.ts Groq endpoint
- [x] POST /api/groq/transcribe
- [x] multer audio upload → Groq API → verbose_json
- [x] Deduct 1 credit per 5 minutes
- Status: TODO

### T006: sw.js offline caching
- [x] Stale-while-revalidate for navigations
- Status: TODO
