---
name: Credits API
description: Credit system is in-memory (not Supabase). Two endpoints exist.
---

## Endpoints
- `GET /api/credits` — original endpoint, returns balance/monthlyUsed/maxMonthly/tier/isAdmin/dailyGiven
- `GET /api/user/credits` — alias added for Chat UI, returns credits/used/limit/tier/isAdmin

## Storage
Credits are stored in `userCreditsStore` Map in routes.ts — IN MEMORY, not Supabase.
This means credits reset on server restart.

## Logic (getOrCreateCredits function)
- Free tier: starts at 20, gets 10/day, max 50
- Pro tier: gets 50/day, max 500
- Premium tier: unlimited (9999)
- Admin (felixahuruonye@gmail.com): always 9999

## Chat UI credit flow
1. Chat.tsx polls `/api/user/credits` every 30 seconds
2. CreditAlert shown when credits ≤ 5
3. 402 response from `/api/chat/send` also triggers CreditAlert
4. After each successful send, `/api/user/credits` is invalidated

**Why:** In-memory was chosen because Supabase has DNS resolution issues from Node.js server. Full persistence requires fixing Supabase connection.
