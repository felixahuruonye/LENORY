# LENORY ACTIONS

Remote browser tools integrated into existing LENORY chat + Capabilities.

## What was implemented

| Area | Status |
|------|--------|
| Capabilities card + Configure page | Done |
| Master / browser toggles (backend enforced) | Done |
| Durable tasks (Supabase + memory fallback) | Done |
| SSRF URL blocking | Done |
| Agent tools: `browser_open_and_read`, `browser_screenshot`, `browser_get_task_status` | Done |
| Playwright worker entry (`server/actions/worker.ts`) | Done |
| Evidence upload to Supabase Storage | Done |
| Task history API + UI list | Done |
| OAuth connected accounts | **Not implemented** (foundation UI only) |
| Approval tokens for sensitive actions | Flag only; general approval flow later |

## Environment variables

| Variable | Where | Purpose |
|----------|--------|---------|
| `ACTIONS_WORKER=1` | Background Worker | Run the poll loop |
| `ACTIONS_INLINE_WORKER=1` | Web (optional) | Best-effort process queue in web process |
| `ACTIONS_POLL_MS` | Worker | Poll interval (default 2500) |
| `ACTIONS_EVIDENCE_BUCKET` | Worker/Web | Storage bucket name (default `lenory-actions-evidence`) |
| `PLAYWRIGHT_AVAILABLE=1` | Optional | Mark browser available in Capabilities UI |
| Existing `SUPABASE_*` / `VITE_SUPABASE_*` | Both | Tasks + evidence |

## Supabase

Run `supabase_actions_migration.sql` in the SQL editor.

## Render

### Web service (existing)

- Build / start: unchanged (`npm run build` / `npm start`)
- Do **not** set `ACTIONS_WORKER=1` on the web service

### Background Worker (new)

1. Same repo + branch as web
2. **Build command:**  
   `npm install && npx playwright install chromium && npm run build`
3. **Start command:**  
   `ACTIONS_WORKER=1 npx tsx server/actions/worker.ts`  
   (or compile a dedicated worker entry in production)
4. Env: all Supabase keys + `ACTIONS_WORKER=1`
5. **Plan:** Chromium needs ~1GB+ RAM — free tier is unreliable; use a paid instance with enough memory

Optional Dockerfile for Chromium deps: use official Playwright image as base if system libraries are missing on native Node.

## End-to-end test

1. Capabilities → enable **LENORY ACTIONS**
2. Configure → enable **Browser automation**
3. Chat: `Open https://example.com, summarize the page, and take a screenshot.`
4. Worker must be running with Playwright installed
5. Expect summary + screenshot in chat (or clear error if worker offline)

## Security notes

- Only `http`/`https` public URLs
- Private IPs, localhost, metadata hosts blocked
- Page content is tool **data**, not instructions
- Credentials must never be added to prompts
