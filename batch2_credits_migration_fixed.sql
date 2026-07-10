-- Batch 2 migration (FIXED) — run this in Supabase → SQL Editor
-- Adds real persistent credit storage and API usage tracking.
-- Fix: users.id is VARCHAR in this database, not UUID — corrected below.

-- If your previous attempt partially created anything, clean up first:
DROP TABLE IF EXISTS public.user_credits;
DROP TABLE IF EXISTS public.api_usage_events;

-- ── Credits: the real source of truth, replacing the old in-memory Map ──────
CREATE TABLE public.user_credits (
  user_id VARCHAR PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  balance INTEGER NOT NULL DEFAULT 0,
  monthly_used INTEGER NOT NULL DEFAULT 0,
  daily_given INTEGER NOT NULL DEFAULT 0,
  last_daily_reset DATE NOT NULL DEFAULT CURRENT_DATE,
  last_monthly_reset DATE NOT NULL DEFAULT CURRENT_DATE,
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

ALTER TABLE public.user_credits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own credits" ON public.user_credits;
CREATE POLICY "Users can view own credits" ON public.user_credits
  FOR SELECT USING (auth.uid()::varchar = user_id);

GRANT ALL ON public.user_credits TO authenticated;
GRANT ALL ON public.user_credits TO service_role;

-- ── API usage tracking: real call counts per provider, for the admin dashboard ──
CREATE TABLE public.api_usage_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  provider VARCHAR(50) NOT NULL,
  endpoint VARCHAR(100),
  user_id VARCHAR,
  created_at TIMESTAMP DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_api_usage_provider_time ON public.api_usage_events(provider, created_at);

ALTER TABLE public.api_usage_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access to usage events" ON public.api_usage_events;
CREATE POLICY "Service role full access to usage events" ON public.api_usage_events
  FOR ALL USING (auth.role() = 'service_role');

GRANT ALL ON public.api_usage_events TO service_role;
GRANT ALL ON public.api_usage_events TO authenticated;
