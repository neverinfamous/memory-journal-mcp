import { test, expect, spyOn, afterEach, beforeEach } from 'bun:test';
import { replTuiInterceptor } from "C:/Users/chris/Desktop/adamic/.agents/scripts/lib-agent-exec/interceptors/repl-tui-interceptor.ts";
import { systemInterceptor } from "C:/Users/chris/Desktop/adamic/.agents/scripts/lib-agent-exec/interceptors/system-interceptor.ts";
import { dockerInterceptor } from "C:/Users/chris/Desktop/adamic/.agents/scripts/lib-agent-exec/interceptors/docker-interceptor.ts";
import { killProcessTree } from "C:/Users/chris/Desktop/adamic/.agents/scripts/lib-agent-exec/process-manager.ts";
import { ExecutionContext } from "C:/Users/chris/Desktop/adamic/.agents/scripts/lib-agent-exec/interceptors/types.ts";
import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

let scratchDir: string;

let exitSpy: ReturnType<typeof spyOn>;

beforeEach(() => {
  exitSpy = spyOn(process, 'exit').mockImplementation((code?: number) => {
    throw new Error(`process.exit called with ${code}`);
  });
  scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-exec-"));
});

afterEach(() => {
  exitSpy.mockRestore();
  try { fs.rmSync(scratchDir, { recursive: true, force: true }); } catch { /* ignore */ }
});

test("tail -f is blocked", () => {
  const ctx: ExecutionContext = {
    cmdBasename: "tail",
    args: ["-f", "somefile.txt"],
    envOverrides: {},
    payload: { type: "command", command: "tail", args: ["-f", "somefile.txt"] }
  };
  
  expect(() => systemInterceptor(ctx)).toThrow("process.exit called with 1");
  expect(exitSpy).toHaveBeenCalledWith(1);
});

test("python REPL without args is blocked", () => {
  const ctx: ExecutionContext = {
    cmdBasename: "python",
    args: [],
    envOverrides: {},
    payload: { type: "command", command: "python", args: [] }
  };
  
  expect(() => replTuiInterceptor(ctx)).toThrow("process.exit called with 1");
  expect(exitSpy).toHaveBeenCalledWith(1);
});

test("bash without args is blocked", () => {
  const ctx: ExecutionContext = {
    cmdBasename: "bash",
    args: [],
    envOverrides: {},
    payload: { type: "command", command: "bash", args: [] }
  };
  
  expect(() => replTuiInterceptor(ctx)).toThrow("process.exit called with 1");
  expect(exitSpy).toHaveBeenCalledWith(1);
});

test("docker logs -f follow flag is stripped instead of blocking", () => {
  const ctx: ExecutionContext = {
    cmdBasename: "docker",
    args: ["logs", "-f", "mycontainer"],
    envOverrides: {},
    payload: { type: "command", command: "docker", args: ["logs", "-f", "mycontainer"] }
  };
  
  dockerInterceptor(ctx);
  // It shouldn't throw, and '-f' should be removed
  expect(ctx.args).not.toContain("-f");
  expect(ctx.args).toContain("logs");
  expect(ctx.args).toContain("mycontainer");
});

test("kubectl logs -f follow flag is stripped", () => {
  const ctx: ExecutionContext = {
    cmdBasename: "kubectl",
    args: ["logs", "-f", "mypod"],
    envOverrides: {},
    payload: { type: "command", command: "kubectl", args: ["logs", "-f", "mypod"] }
  };
  
  dockerInterceptor(ctx);
  expect(ctx.args).not.toContain("-f");
});

test("shell operators embedded in strings (e.g. jq) are allowed", () => {
  const ctx: ExecutionContext = {
    cmdBasename: "jq",
    args: ["-n", "'[.commits[] | select(.metadata != null)]'"],
    envOverrides: {},
    payload: { type: "command", command: "jq", args: ["-n", "'[.commits[] | select(.metadata != null)]'"] }
  };
  
  // Should not throw
  expect(() => systemInterceptor(ctx)).not.toThrow();
});

test("standalone shell operators in args are blocked", () => {
  const ctx: ExecutionContext = {
    cmdBasename: "echo",
    args: ["hello", "&&", "echo", "world"],
    envOverrides: {},
    payload: { type: "command", command: "echo", args: ["hello", "&&", "echo", "world"] }
  };
  
  expect(() => systemInterceptor(ctx)).toThrow("process.exit called with 1");
  expect(exitSpy).toHaveBeenCalledWith(1);
});

test("deep process tree termination", async () => {
  // Spawn a child process that spawns another child process
  const scriptContent = `
    const { spawn } = require('node:child_process');
    const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 100000);'], { detached: true });
    console.log(child.pid);
    setTimeout(() => {}, 100000);
  `;
  const scriptPath = path.join(scratchDir, 'deep_tree_test.js');
  fs.writeFileSync(scriptPath, scriptContent);

  const parentProcess = spawn(process.execPath, [scriptPath]);
  
  let childPidStr = '';
  await new Promise<void>(resolve => {
    parentProcess.stdout.on('data', data => {
      childPidStr += data.toString();
      if (childPidStr.trim().length > 0) resolve();
    });
  });

  const grandchildPid = parseInt(childPidStr.trim(), 10);
  const parentPid = parentProcess.pid;

  expect(parentPid).toBeDefined();
  expect(grandchildPid).toBeDefined();
  expect(grandchildPid).not.toBeNaN();

  // Call killProcessTree on parent
  killProcessTree(parentProcess);

  // Wait a bit for termination
  await new Promise(resolve => setTimeout(resolve, 500));

  // Check if processes are dead
  let parentAlive = true;
  let grandchildAlive = true;

  try {
    process.kill(parentPid!, 0);
  } catch {
    parentAlive = false;
  }

  try {
    process.kill(grandchildPid, 0);
  } catch {
    grandchildAlive = false;
  }

  expect(parentAlive).toBe(false);
  expect(grandchildAlive).toBe(false);

  if (fs.existsSync(scriptPath)) fs.unlinkSync(scriptPath);
});


