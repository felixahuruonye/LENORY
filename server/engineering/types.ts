// server/engineering/types.ts
import type {
  EngineeringTask,
  EngineeringTaskEvent,
  EngineeringPlan,
  EngineeringReview,
  EngineeringApproval,
  EngineeringDeployment,
  EngineeringTaskStatus,
  EngineeringTaskEventType,
  ModelRole,
  ToolCall,
  ToolResult,
} from "../../shared/engineeringSchema";

export {
  EngineeringTask,
  EngineeringTaskEvent,
  EngineeringPlan,
  EngineeringReview,
  EngineeringApproval,
  EngineeringDeployment,
  EngineeringTaskStatus,
  EngineeringTaskEventType,
  ModelRole,
  ToolCall,
  ToolResult,
};

export interface InvestigationResult {
  problem: string;
  evidence: string[];
  rootCause: string;
  affectedComponents: string[];
  potentialSideEffects: string[];
  proposedSolution: string;
  testingStrategy: string;
  riskLevel: "low" | "medium" | "high" | "critical";
}

export interface CodeChange {
  path: string;
  operation: "create" | "modify" | "delete";
  content: string | null;
  explanation: string;
}

export interface TestRun {
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  passed: boolean;
}

export interface BuildRun {
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  passed: boolean;
}

export interface ReviewResult {
  reviewerModel: string;
  verdict: "pass" | "request_changes" | "conflict";
  feedback: string;
  securityConcerns: string[];
  regressionRisks: string[];
}

export interface QualityScore {
  rootCauseConfidence: number; // 0-100
  testCoverage: number; // 0-100
  regressionRisk: number; // 0-100
  securityRisk: number; // 0-100
  databaseRisk: number; // 0-100
  apiRisk: number; // 0-100
  frontendRisk: number; // 0-100
  deploymentRisk: number; // 0-100
  reviewerAgreement: number; // 0-100
  overallRecommendation: "proceed" | "caution" | "reject";
}
