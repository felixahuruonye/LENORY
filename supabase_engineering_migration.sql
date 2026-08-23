-- Supabase migration: Engineering Agent tables
-- Run this in Supabase SQL Editor

-- Engineering Tasks table
CREATE TABLE IF NOT EXISTS engineering_tasks (
  id TEXT PRIMARY KEY,
  request TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'received',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  admin_id TEXT NOT NULL,
  admin_email TEXT NOT NULL,
  base_commit TEXT NOT NULL,
  branch_name TEXT,
  pr_url TEXT,
  investigation TEXT,
  root_cause TEXT,
  implementation TEXT,
  test_results TEXT,
  build_result TEXT,
  review_result TEXT,
  risk_assessment TEXT,
  diff TEXT,
  error_log TEXT,
  sandbox_path TEXT,
  max_attempts INTEGER DEFAULT 5,
  current_attempt INTEGER DEFAULT 0,
  metadata JSONB DEFAULT '{}'
);

-- Index for status queries
CREATE INDEX IF NOT EXISTS idx_engineering_tasks_status ON engineering_tasks(status);
CREATE INDEX IF NOT EXISTS idx_engineering_tasks_admin ON engineering_tasks(admin_email);
CREATE INDEX IF NOT EXISTS idx_engineering_tasks_created ON engineering_tasks(created_at DESC);

-- Engineering Task Events table
CREATE TABLE IF NOT EXISTS engineering_task_events (
  id SERIAL PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES engineering_tasks(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  actor TEXT NOT NULL,
  message TEXT NOT NULL,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_engineering_events_task ON engineering_task_events(task_id);
CREATE INDEX IF NOT EXISTS idx_engineering_events_created ON engineering_task_events(created_at DESC);

-- Engineering Plans table
CREATE TABLE IF NOT EXISTS engineering_plans (
  id SERIAL PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES engineering_tasks(id) ON DELETE CASCADE,
  plan TEXT NOT NULL,
  affected_files TEXT[] DEFAULT '{}',
  affected_routes TEXT[] DEFAULT '{}',
  affected_components TEXT[] DEFAULT '{}',
  affected_tables TEXT[] DEFAULT '{}',
  database_changes TEXT[] DEFAULT '{}',
  api_changes TEXT[] DEFAULT '{}',
  ui_changes TEXT[] DEFAULT '{}',
  testing_strategy TEXT,
  risk_level TEXT DEFAULT 'medium',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Engineering Reviews table
CREATE TABLE IF NOT EXISTS engineering_reviews (
  id SERIAL PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES engineering_tasks(id) ON DELETE CASCADE,
  reviewer_model TEXT NOT NULL,
  reviewer_role TEXT NOT NULL,
  verdict TEXT NOT NULL,
  feedback TEXT NOT NULL,
  security_concerns TEXT[] DEFAULT '{}',
  regression_risks TEXT[] DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Engineering Approvals table
CREATE TABLE IF NOT EXISTS engineering_approvals (
  id SERIAL PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES engineering_tasks(id) ON DELETE CASCADE,
  approved BOOLEAN NOT NULL,
  admin_id TEXT NOT NULL,
  admin_email TEXT NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Engineering Deployments table
CREATE TABLE IF NOT EXISTS engineering_deployments (
  id SERIAL PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES engineering_tasks(id) ON DELETE CASCADE,
  status TEXT DEFAULT 'pending',
  previous_commit TEXT,
  new_commit TEXT,
  health_checks TEXT,
  error_log TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

-- Row Level Security: Only admin can access engineering data
ALTER TABLE engineering_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE engineering_task_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE engineering_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE engineering_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE engineering_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE engineering_deployments ENABLE ROW LEVEL SECURITY;

-- Note: Actual RLS policies should be added based on your auth setup
-- Example: CREATE POLICY admin_only ON engineering_tasks FOR ALL TO authenticated USING (auth.email() = 'felixahuruonye@gmail.com');
