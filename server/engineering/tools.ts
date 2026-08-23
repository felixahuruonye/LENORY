// server/engineering/tools.ts
// Controlled tool layer for the engineering agent

import { execSync } from "child_process";
import type { Sandbox } from "./sandbox";
import { readSandboxFile, writeSandboxFile, deleteSandboxFile, listSandboxFiles } from "./sandbox";

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

const ALLOWED_COMMANDS = new Set([
  "npm test",
  "npm run test",
  "npm run build",
  "npm run lint",
  "npm run typecheck",
  "npm run check",
  "git status",
  "git diff",
  "git log",
  "git branch",
  "git show",
  "npx tsc --noEmit",
]);

function isCommandAllowed(command: string): boolean {
  const normalized = command.trim().toLowerCase();
  for (const allowed of ALLOWED_COMMANDS) {
    if (normalized.startsWith(allowed.toLowerCase())) return true;
  }
  return false;
}

function sanitizeCommand(command: string): string {
  // Prevent shell injection
  const dangerous = /[;&|<>$`\]/;
  if (dangerous.test(command)) {
    throw new Error("Command contains dangerous characters");
  }
  return command;
}

export async function executeTool(
  sandbox: Sandbox,
  toolCall: ToolCall
): Promise<ToolResult> {
  const start = Date.now();
  const { tool, params } = toolCall;

  try {
    let output = "";

    switch (tool) {
      case "read_file": {
        const content = readSandboxFile(sandbox, params.path);
        output = content ?? "[FILE NOT FOUND]";
        break;
      }

      case "write_file": {
        writeSandboxFile(sandbox, params.path, params.content);
        output = `Wrote ${params.path} (${params.content.length} chars)`;
        break;
      }

      case "delete_file": {
        deleteSandboxFile(sandbox, params.path);
        output = `Deleted ${params.path}`;
        break;
      }

      case "list_files": {
        const files = listSandboxFiles(sandbox, params.path || ".");
        output = files.join("\n");
        break;
      }

      case "search_code": {
        const command = `cd ${sandbox.path} && grep -r "${sanitizeCommand(params.query)}" --include="*.ts" --include="*.tsx" --include="*.js" --include="*.jsx" -l`;
        output = execSync(command, { timeout: 30000, encoding: "utf-8", stdio: "pipe" });
        break;
      }

      case "run_test":
      case "run_build":
      case "run_lint":
      case "run_typecheck": {
        const cmd = params.command;
        if (!isCommandAllowed(cmd)) {
          throw new Error(`Command not in allowlist: ${cmd}`);
        }
        const sanitized = sanitizeCommand(cmd);
        output = execSync(`cd ${sandbox.path} && ${sanitized}`, {
          timeout: params.timeoutMs || 120000,
          encoding: "utf-8",
          stdio: "pipe",
        });
        break;
      }

      case "inspect_git_status": {
        output = execSync(`cd ${sandbox.path} && git status`, {
          timeout: 30000,
          encoding: "utf-8",
          stdio: "pipe",
        });
        break;
      }

      case "inspect_git_diff": {
        output = execSync(`cd ${sandbox.path} && git diff`, {
          timeout: 30000,
          encoding: "utf-8",
          stdio: "pipe",
        });
        break;
      }

      case "inspect_git_log": {
        const limit = params.limit || 10;
        output = execSync(`cd ${sandbox.path} && git log --oneline -${limit}`, {
          timeout: 30000,
          encoding: "utf-8",
          stdio: "pipe",
        });
        break;
      }

      case "inspect_package": {
        const pkg = readSandboxFile(sandbox, "package.json");
        output = pkg ?? "[package.json NOT FOUND]";
        break;
      }

      default:
        throw new Error(`Unknown tool: ${tool}`);
    }

    return {
      tool,
      success: true,
      output,
      error: null,
      durationMs: Date.now() - start,
      timestamp: new Date().toISOString(),
    };
  } catch (err: any) {
    return {
      tool,
      success: false,
      output: err.stdout || "",
      error: err.message || String(err),
      durationMs: Date.now() - start,
      timestamp: new Date().toISOString(),
    };
  }
}

export function getAvailableTools(): string[] {
  return [
    "read_file",
    "write_file",
    "delete_file",
    "list_files",
    "search_code",
    "run_test",
    "run_build",
    "run_lint",
    "run_typecheck",
    "inspect_git_status",
    "inspect_git_diff",
    "inspect_git_log",
    "inspect_package",
  ];
}
