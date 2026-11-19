-- LENORY ACTIONS Phase 3 — browser session + usage accounting
-- Run in Supabase SQL editor after supabase_actions_migration.sql

alter table public.action_tasks
  add column if not exists browser_provider text,
  add column if not exists browser_session_id text,
  add column if not exists workflow_state jsonb;

create index if not exists action_tasks_browser_session
  on public.action_tasks (browser_session_id)
  where browser_session_id is not null;

create table if not exists public.action_usage (
  id text primary key,
  user_id text not null,
  task_id text,
  session_id text,
  provider text,
  duration_sec integer not null default 0,
  estimated_cost_usd numeric(12, 6) not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists action_usage_user_created
  on public.action_usage (user_id, created_at desc);

alter table public.action_usage enable row level security;

drop policy if exists action_usage_own on public.action_usage;
create policy action_usage_own on public.action_usage
  for all using (auth.uid()::text = user_id) with check (auth.uid()::text = user_id);
