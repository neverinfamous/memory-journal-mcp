import { test, expect, spyOn, afterAll } from 'bun:test';
import type { ExecPayload } from "../schema.js";
import { systemInterceptor } from "../interceptors/system-interceptor.js";
import { spawnSync } from "node:child_process";
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import * as os from 'node:os';

const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-exec-wsl-"));
const agentExecPath = 'C:/Users/chris/Desktop/adamic/.agents/scripts/agent-exec.ts';

function runAgentExec(payload: unknown) {
  const payloadPath = path.join(scratchDir, `payload-${randomUUID()}.json`);
  fs.writeFileSync(payloadPath, JSON.stringify(payload));
  const result = spawnSync('bun', [agentExecPath, '--json', payloadPath], { encoding: 'utf8' });
  return { result, payloadPath };
}

function setupExitSpy() {
  let exitCode: number | undefined;
  const spy = spyOn(process, "exit").mockImplementation((code?: number | string | null) => {
    exitCode = typeof code === "number" ? code : undefined;
    throw new Error(`process.exit called with code ${code}`);
  });
  return {
    spy,
    getExitCode: () => exitCode,
    restore: () => spy.mockRestore()
  };
}

test("systemInterceptor - wsl2 target permits cat command with stdin", () => {
  const exitSpy = setupExitSpy();
  const consoleSpy = spyOn(console, "error").mockImplementation(() => {});
  const envOverrides: Record<string, string> = {};
  const args: string[] = [];
  const context = {
    cmdBasename: "cat",
    args,
    envOverrides,
    payload: { type: "command", target: "wsl2", command: "cat", stdin: "hello world" } as unknown as ExecPayload,
  };

  try {
    systemInterceptor(context);
    expect(exitSpy.getExitCode()).toBeUndefined();
    const calls = consoleSpy.mock.calls.map(call => call.join(' ')).join('\n');
    expect(calls).not.toContain("Do NOT use 'cat', 'cat.exe', or 'get-content' natively.");
  } finally {
    exitSpy.restore();
    consoleSpy.mockRestore();
  }
});

test("systemInterceptor - wsl2 target does not rewrite cat to get-content in inline bash", () => {
  const exitSpy = setupExitSpy();
  const consoleSpy = spyOn(console, "error").mockImplementation(() => {});
  const envOverrides: Record<string, string> = {};
  const args: string[] = ["-c", "cat"];
  const context = {
    cmdBasename: "bash",
    args,
    envOverrides,
    payload: { type: "command", target: "wsl2", command: "bash", args: ["-c", "cat"], stdin: "hello world" } as unknown as ExecPayload,
  };

  try {
    systemInterceptor(context);
    expect(exitSpy.getExitCode()).toBeUndefined();
    expect(context.args[1]).toBe("cat"); // Should NOT be rewritten to Get-Content
  } finally {
    exitSpy.restore();
    consoleSpy.mockRestore();
  }
});

test("E2E: wsl2 target passes stdin correctly to wsl process", () => {
  const { result } = runAgentExec({
    type: "command",
    target: "wsl2",
    command: "cat",
    stdin: "hello world",
    keepPayload: true
  });
  
  if (result.status !== 0) {
    console.error(result.stderr);
  }
  expect(result.status).toBe(0);
  
  const jsonStr = result.stdout.split('\n').find(line => line.startsWith('{'));
  expect(jsonStr).toBeDefined();
  
  const parsed = JSON.parse(jsonStr!);
  expect(parsed.stdout).toBe("hello world");
});

afterAll(() => {
  try { fs.rmSync(scratchDir, { recursive: true, force: true }); } catch { /* ignore */ }
});
