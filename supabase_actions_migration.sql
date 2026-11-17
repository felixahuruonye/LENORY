-- LENORY ACTIONS durable task tables
-- Run in Supabase SQL editor (production). Safe to re-run with IF NOT EXISTS.

create table if not exists public.action_tasks (
  id uuid primary key,
  user_id text not null,
  session_id text,
  description text not null default '',
  status text not null default 'queued',
  tool text not null default 'browser',
  payload jsonb default '{}'::jsonb,
  result jsonb,
  error text,
  lease_owner text,
  lease_until timestamptz,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists action_tasks_user_created on public.action_tasks (user_id, created_at desc);
create index if not exists action_tasks_status_created on public.action_tasks (status, created_at);

create table if not exists public.action_events (
  id uuid primary key,
  task_id uuid not null references public.action_tasks(id) on delete cascade,
  user_id text not null,
  status text not null,
  detail text,
  created_at timestamptz not null default now()
);

create index if not exists action_events_task on public.action_events (task_id, created_at);

create table if not exists public.action_artifacts (
  id uuid primary key,
  task_id uuid not null references public.action_tasks(id) on delete cascade,
  user_id text not null,
  kind text not null,
  path text not null,
  public_url text,
  mime_type text,
  created_at timestamptz not null default now()
);

create index if not exists action_artifacts_task on public.action_artifacts (task_id);

-- RLS: users only see their own rows (service role bypasses for worker)
alter table public.action_tasks enable row level security;
alter table public.action_events enable row level security;
alter table public.action_artifacts enable row level security;

drop policy if exists action_tasks_own on public.action_tasks;
create policy action_tasks_own on public.action_tasks
  for all using (auth.uid()::text = user_id) with check (auth.uid()::text = user_id);

drop policy if exists action_events_own on public.action_events;
create policy action_events_own on public.action_events
  for all using (auth.uid()::text = user_id) with check (auth.uid()::text = user_id);

drop policy if exists action_artifacts_own on public.action_artifacts;
create policy action_artifacts_own on public.action_artifacts
  for all using (auth.uid()::text = user_id) with check (auth.uid()::text = user_id);

-- Optional private evidence bucket (create in Dashboard if preferred)
-- insert into storage.buckets (id, name, public) values ('lenory-actions-evidence', 'lenory-actions-evidence', false)
-- on conflict do nothing;
