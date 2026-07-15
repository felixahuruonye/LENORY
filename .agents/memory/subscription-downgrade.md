---
name: Subscription downgrade flow
description: How tier downgrade works and how Pricing.tsx shows real tier status
---

## Backend
`POST /api/subscription/downgrade` in `server/routes.ts`:
- Accepts `{ targetTier }` in body
- Validates targetTier is a valid tier and is actually lower than current tier (uses `tierRank: { free:0, pro:1, premium:2 }`)
- Calls `storage.updateUser(userId, { subscriptionTier: targetTier, ... })`
- Returns `{ success: true, tier, message }`
- Upgrade (higher tier) still goes through Paystack at `/api/payments/initialize`

## Frontend (Pricing.tsx)
- `currentTier = (user as any)?.subscriptionTier || "free"` from `useAuth()`
- `TIER_RANK` map used to compare tier positions
- Each plan card renders one of three buttons:
  - **Current Plan**: disabled outline button (tier === currentTier)
  - **Downgrade to X**: ghost button → calls `handleDowngrade()` → `/api/subscription/downgrade` → page reload after 1.2s
  - **Get Pro / Get Premium**: default button → calls `handleUpgrade()` → Paystack flow

**Why:** The old Pricing.tsx had hardcoded `tier.cta` ("Current Plan" always on Free, etc.) regardless of the user's actual subscription.

**How to apply:** `user.subscriptionTier` is returned by `/api/auth/user` from storage. It defaults to `'free'` for new users. The Paystack upgrade flow (at `/api/payments/initialize`) writes the new tier on payment confirmation.
