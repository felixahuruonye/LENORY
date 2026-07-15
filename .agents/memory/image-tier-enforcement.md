---
name: Image generation tier enforcement
description: Monthly image generation limits per subscription tier at /api/generate-image
---

## Limits (matches Pricing.tsx feature list)
- free: 5 images/month
- pro: 50 images/month
- premium: unlimited (Infinity)
- admin (felixahuruonye@gmail.com): always bypassed

## Implementation
In `server/routes.ts` at `/api/generate-image`: fetch user's tier, count `storage.getGeneratedImagesByUser(userId)` records where `createdAt` starts with current `YYYY-MM`, compare to limit. Returns 403 with descriptive message if over limit.

**Why:** The Pricing page listed these limits but nothing enforced them server-side. Image generation also used credits (2 per generation) but the monthly cap was never checked.

**How to apply:** The monthly count relies on `createdAt` being a string starting with `YYYY-MM`. In-memory storage uses `new Date().toISOString()` which does this. Supabase timestamps may need `.slice(0,7)` comparison. Always test the `typeof created === "string"` guard.
