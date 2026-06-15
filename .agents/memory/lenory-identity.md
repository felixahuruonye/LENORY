---
name: LENORY identity update
description: LENORY is now a general AI, not just a tutor. Admin mode for Felix.
---

## Key decisions

**LENORY is NOT a tutor-only AI anymore.**
The system prompt in `/api/chat/send` now presents LENORY as a fully capable general AI.

**Admin email:** `felixahuruonye@gmail.com` (stored as `ADMIN_EMAIL` constant in routes.ts)
- Gets a completely different system prompt with admin capabilities
- Can request user data, block/ban/suspend accounts, run SQL, train AI behavior
- Unlimited credits (9999) always
- Admin badge shown in chat header when logged in as this account

**Regular users:**
- LENORY presented as a powerful general AI (coding, research, writing, cybersecurity, etc.)
- Still helps with Nigerian exams (JAMB, WAEC, NECO) but not limited to education
- Understands Nigerian culture and context

**Admin detection pattern:**
```typescript
const isAdminUser = req.userEmail === ADMIN_EMAIL || user?.email === ADMIN_EMAIL;
```

**Why:** User requested Felix's account get full admin AI access. LENORY should be a general AI, not just a tutor.

**VAPI system prompt** (in useVapi.ts) also updated to reflect the general AI identity.
