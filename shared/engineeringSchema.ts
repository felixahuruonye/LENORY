// shared/engineeringSchema.ts
// Types shared between client and server for the Engineering Agent system

export type EngineeringTaskStatus =
  | "idle"
  | "received"
  | "planning"
  | "investigating"
  | "sandbox_creating"
  | "implementing"
  | "testing"
  | "test_failed"
  | "debugging"
  | "reviewing"
  | "ready_for_approval"
  | "approved"
  | "rejected"
  | "merging"
  | "deploying"
  | "verifying_deployment"
  | "completed"
  | "rolled_back"
  | "failed";

export type EngineeringTaskEventType =
  | "task_created"
  | "investigation_started"
  | "file_read"
  | "root_cause_identified"
  | "sandbox_created"
  | "code_changed"
  | "test_started"
  | "test_failed"
  | "test_passed"
  | "build_failed"
  | "build_passed"
  | "review_started"
  | "review_failed"
  | "review_passed"
  | "pr_created"
  | "approval_requested"
  | "approved"
  | "rejected"
  | "merged"
  | "deployment_started"
  | "deployment_succeeded"
  | "deployment_failed"
  | "rollback_started"
  | "rollback_completed"
  | "error"
  | "state_transition";

export type ModelRole = "investigator" | "coder" | "reviewer_1" | "reviewer_2";

export interface EngineeringTask {
  id: string;
  request: string;
  status: EngineeringTaskStatus;
  createdAt: string;
  updatedAt: string;
  adminId: string;
  adminEmail: string;
  baseCommit: string;
  branchName: string | null;
  prUrl: string | null;
  investigation: string | null;
  rootCause: string | null;
  implementation: string | null;
  testResults: string | null;
  buildResult: string | null;
  reviewResult: string | null;
  riskAssessment: string | null;
  diff: string | null;
  errorLog: string | null;
  sandboxPath: string | null;
  maxAttempts: number;
  currentAttempt: number;
  metadata: Record<string, any>;
}

export interface EngineeringTaskEvent {
  id: string;
  taskId: string;
  eventType: EngineeringTaskEventType;
  actor: string;
  message: string;
  metadata: Record<string, any>;
  createdAt: string;
}

export interface EngineeringPlan {
  id: string;
  taskId: string;
  plan: string;
  affectedFiles: string[];
  affectedRoutes: string[];
  affectedComponents: string[];
  affectedTables: string[];
  databaseChanges: string[];
  apiChanges: string[];
  uiChanges: string[];
  testingStrategy: string;
  riskLevel: "low" | "medium" | "high" | "critical";
  createdAt: string;
}

export interface EngineeringReview {
  id: string;
  taskId: string;
  reviewerModel: string;
  reviewerRole: string;
  verdict: "pass" | "request_changes" | "conflict";
  feedback: string;
  securityConcerns: string[];
  regressionRisks: string[];
  createdAt: string;
}

export interface EngineeringApproval {
  id: string;
  taskId: string;
  approved: boolean;
  adminId: string;
  adminEmail: string;
  notes: string | null;
  createdAt: string;
}

export interface EngineeringDeployment {
  id: string;
  taskId: string;
  status: "pending" | "in_progress" | "succeeded" | "failed" | "rolled_back";
  previousCommit: string;
  newCommit: string;
  healthChecks: string | null;
  errorLog: string | null;
  createdAt: string;
  completedAt: string | null;
}

export interface CreateTaskRequest {
  request: string;
}

export interface ApproveTaskRequest {
  taskId: string;
  approved: boolean;
  notes?: string;
}

export interface ModelRouterConfig {
  investigatorModel: string;
  coderModel: string;
  reviewer1Model: string;
  reviewer2Model: string;
  openRouterApiKey: string;
}

export interface SandboxConfig {
  basePath: string;
  repoUrl: string;
  maxExecutionTimeMs: number;
  maxOutputSizeBytes: number;
}

export interface ToolCall {
  tool: string;
  params: Record<string, any>;
  timestamp: string;
}

export interface ToolResult {
  tool: string;
  success: boolean;
  output: string;
  error: string | null;
  durationMs: number;
  timestamp: string;
}
