// server/engineering/sandbox.ts
// Isolated engineering workspace management

import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import os from "os";

const SANDBOX_BASE = process.env.ENGINEERING_SANDBOX_BASE || path.join(os.tmpdir(), "lenory-engineering");

export interface Sandbox {
  taskId: string;
  path: string;
  baseCommit: string;
  branchName: string;
  createdAt: Date;
}

export function ensureSandboxBase(): void {
  if (!fs.existsSync(SANDBOX_BASE)) {
    fs.mkdirSync(SANDBOX_BASE, { recursive: true });
  }
}

export async function createSandbox(
  taskId: string,
  baseCommit: string,
  repoUrl: string
): Promise<Sandbox> {
  ensureSandboxBase();

  const sandboxPath = path.join(SANDBOX_BASE, taskId);
  const branchName = `engineering/${taskId}`;

  // Clean up any existing sandbox for this task
  if (fs.existsSync(sandboxPath)) {
    fs.rmSync(sandboxPath, { recursive: true, force: true });
  }

  fs.mkdirSync(sandboxPath, { recursive: true });

  try {
    // Clone the repository
    execSync(`git clone --depth 1 ${repoUrl} ${sandboxPath}`, {
      timeout: 120000,
      stdio: "pipe",
    });

    // Checkout to the base commit if it's not the default branch
    try {
      execSync(`cd ${sandboxPath} && git checkout ${baseCommit}`, {
        timeout: 30000,
        stdio: "pipe",
      });
    } catch {
      // If checkout fails, stay on default branch
      console.log(`Could not checkout ${baseCommit}, using default branch`);
    }

    // Create feature branch
    execSync(`cd ${sandboxPath} && git checkout -b ${branchName}`, {
      timeout: 30000,
      stdio: "pipe",
    });

    // Install dependencies
    execSync(`cd ${sandboxPath} && npm install`, {
      timeout: 300000,
      stdio: "pipe",
    });

  } catch (err: any) {
    throw new Error(`Sandbox creation failed: ${err.message}`);
  }

  return {
    taskId,
    path: sandboxPath,
    baseCommit,
    branchName,
    createdAt: new Date(),
  };
}

export async function destroySandbox(taskId: string): Promise<void> {
  const sandboxPath = path.join(SANDBOX_BASE, taskId);
  if (fs.existsSync(sandboxPath)) {
    fs.rmSync(sandboxPath, { recursive: true, force: true });
  }
}

export function readSandboxFile(sandbox: Sandbox, filePath: string): string | null {
  const fullPath = path.join(sandbox.path, filePath);
  // Security: prevent path traversal
  if (!fullPath.startsWith(sandbox.path)) {
    throw new Error("Path traversal attempt detected");
  }
  if (!fs.existsSync(fullPath)) return null;
  return fs.readFileSync(fullPath, "utf-8");
}

export function writeSandboxFile(
  sandbox: Sandbox,
  filePath: string,
  content: string
): void {
  const fullPath = path.join(sandbox.path, filePath);
  // Security: prevent path traversal
  if (!fullPath.startsWith(sandbox.path)) {
    throw new Error("Path traversal attempt detected");
  }
  const dir = path.dirname(fullPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(fullPath, content, "utf-8");
}

export function deleteSandboxFile(sandbox: Sandbox, filePath: string): void {
  const fullPath = path.join(sandbox.path, filePath);
  if (!fullPath.startsWith(sandbox.path)) {
    throw new Error("Path traversal attempt detected");
  }
  if (fs.existsSync(fullPath)) {
    fs.unlinkSync(fullPath);
  }
}

export function listSandboxFiles(sandbox: Sandbox, dirPath: string = "."): string[] {
  const fullPath = path.join(sandbox.path, dirPath);
  if (!fullPath.startsWith(sandbox.path)) {
    throw new Error("Path traversal attempt detected");
  }
  if (!fs.existsSync(fullPath)) return [];

  const results: string[] = [];
  const entries = fs.readdirSync(fullPath, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === ".git") continue;
    const relativePath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      results.push(...listSandboxFiles(sandbox, relativePath));
    } else {
      results.push(relativePath);
    }
  }
  return results;
}

export function getSandboxGitDiff(sandbox: Sandbox): string {
  try {
    return execSync(`cd ${sandbox.path} && git diff`, {
      timeout: 30000,
      encoding: "utf-8",
      stdio: "pipe",
    });
  } catch (err: any) {
    return err.stdout || "";
  }
}

export function commitSandboxChanges(sandbox: Sandbox, message: string): void {
  execSync(`cd ${sandbox.path} && git add -A && git commit -m "${message.replace(/"/g, '\"')}"`, {
    timeout: 30000,
    stdio: "pipe",
  });
}
