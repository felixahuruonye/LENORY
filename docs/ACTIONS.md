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

## Phase 3 — Browser Workspace (Browserbase)

### New env vars

| Variable | Purpose | Example default |
|----------|---------|-----------------|
| `BROWSERBASE_API_KEY` | Browserbase API key (server only) | — |
| `BROWSERBASE_PROJECT_ID` | Optional project id | — |
| `BROWSER_RUNTIME` | `browserbase` (default) or `local` | `browserbase` |
| `ACTIONS_MAX_SESSION_SEC` | Max session length | `900` |
| `ACTIONS_IDLE_TIMEOUT_SEC` | Idle timeout | `180` |
| `ACTIONS_MAX_CONCURRENT_PER_USER` | Per-user concurrency | `1` |
| `ACTIONS_MAX_CONCURRENT_GLOBAL` | Global concurrency | `10` |
| `ACTIONS_DAILY_USER_MINUTES` | Paid daily minutes | `30` |
| `ACTIONS_MONTHLY_USER_MINUTES` | Paid monthly minutes | `120` |
| `ACTIONS_FREE_DAILY_MINUTES` | Free daily minutes | `10` |
| `ACTIONS_FREE_MONTHLY_MINUTES` | Free monthly minutes | `30` |
| `ACTIONS_EST_USD_PER_HOUR` | Accounting estimate only | `0.12` |
| `ACTIONS_GLOBAL_MONTHLY_SPEND_USD` | Circuit breaker | `50` |

### Migrations

1. `supabase_actions_migration.sql`
2. `supabase_actions_phase3_migration.sql`

### Feature branch

`feature/actions-phase3-browser-workspace` — do not merge until reviewed.
