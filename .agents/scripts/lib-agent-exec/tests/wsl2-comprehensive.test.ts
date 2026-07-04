import { describe, it, expect, spyOn, afterEach, beforeEach } from 'bun:test';
import { buildCommand } from "C:/Users/chris/Desktop/adamic/.agents/scripts/lib-agent-exec/command-builder.ts";
import type { ExecPayload } from "C:/Users/chris/Desktop/adamic/.agents/scripts/lib-agent-exec/schema.ts";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

describe("WSL2 Comprehensive Integration Tests", () => {
  let exitSpy: import("bun:test").Mock<typeof process.exit>;

  beforeEach(() => {
    exitSpy = spyOn(process, "exit").mockImplementation((() => {}) as unknown as typeof process.exit);
  });

  afterEach(() => {
    if (exitSpy) {
      exitSpy.mockRestore();
    }
  });

  it("should spawn shell scripts passing wsl2 target and map CWD/Args", () => {
    const scriptPath = path.join(os.tmpdir(), "wsl2-test-script2.sh");
    fs.writeFileSync(scriptPath, "echo \"Arg 1: $1\"; echo \"Env: $TEST_ENV_VAR\"", "utf8");

    const payload: ExecPayload = {
      type: "script",
      scriptPath: scriptPath,
      args: ["C:\\Users\\chris\\test"],
      target: "wsl2",
      env: {
        "TEST_ENV_VAR": "HELLO_WSL2"
      }
    };

    const { cmd, args } = buildCommand(payload, "C:\\Users");

    expect(cmd).toBe("wsl.exe");
    expect(args).toContain("--cd");
    expect(args).toContain("/mnt/c/Users");
    expect(args).toContain("-e");
    expect(args).toContain("env");
    expect(args).toContain("TEST_ENV_VAR=HELLO_WSL2");
    expect(args).toContain("bash");
    expect(args).toContain("/mnt/c/Users/chris/test");

    const proc = spawnSync(cmd, args, { encoding: "utf8" });
    if (proc.status !== 0) {
      console.log(proc.stderr);
    }
    expect(proc.status).toBe(0);
    expect(proc.stdout.toLowerCase()).toContain("arg 1: /mnt/c/users/chris/test");
    expect(proc.stdout).toContain("Env: HELLO_WSL2");

    if (fs.existsSync(scriptPath)) {
      if (fs.existsSync(scriptPath)) fs.unlinkSync(scriptPath);
    }
  });

  it("should evaluate code specifically passing wsl2 target mapping paths", () => {
    const payload: ExecPayload = {
      type: "eval",
      code: "echo \"Eval Arg: $1\"; echo \"Eval Env: $TEST_ENV_VAR\"; pwd",
      interpreter: "bash",
      args: ["C:\\Windows\\System32"],
      target: "wsl2",
      env: {
        "TEST_ENV_VAR": "EVAL_WSL2"
      }
    };

    const { cmd, args, tempScriptPath } = buildCommand(payload, "C:\\Windows");
    
    expect(cmd).toBe("wsl.exe");
    expect(args).toContain("--cd");
    expect(args).toContain("/mnt/c/Windows");
    expect(args).toContain("-e");
    expect(args).toContain("env");
    expect(args).toContain("TEST_ENV_VAR=EVAL_WSL2");
    expect(args).toContain("bash");
    expect(args).toContain("/mnt/c/Windows/System32");

    const proc = spawnSync(cmd, args, { encoding: "utf8" });
    if (proc.status !== 0) {
      console.log(proc.stderr);
    }
    expect(proc.status).toBe(0);
    expect(proc.stdout.toLowerCase()).toContain("eval arg: /mnt/c/windows/system32");
    expect(proc.stdout).toContain("Eval Env: EVAL_WSL2");
    expect(proc.stdout.toLowerCase()).toContain("/mnt/c/windows");

    if (tempScriptPath && fs.existsSync(tempScriptPath)) {
      if (fs.existsSync(tempScriptPath)) fs.unlinkSync(tempScriptPath);
    }
  });
  
  it("should evaluate python code in wsl2 mapping paths correctly", () => {
    const payload: ExecPayload = {
      type: "eval",
      code: "import sys, os; print(f'Arg: {sys.argv[1]}'); print(f'Env: {os.environ.get(\"TEST_ENV_VAR\")}')",
      interpreter: "python",
      args: ["C:\\Windows\\System32"],
      target: "wsl2",
      env: {
        "TEST_ENV_VAR": "PYTHON_WSL2"
      }
    };

    const { cmd, args, tempScriptPath } = buildCommand(payload, "C:\\Windows");
    
    expect(cmd).toBe("wsl.exe");
    expect(args).toContain("--cd");
    expect(args).toContain("/mnt/c/Windows");
    expect(args).toContain("-e");
    expect(args).toContain("env");
    expect(args).toContain("python3");

    const proc = spawnSync(cmd, args, { encoding: "utf8" });
    if (proc.status !== 0) {
      console.log(proc.stderr);
    }
    expect(proc.status).toBe(0);
    expect(proc.stdout.toLowerCase()).toContain("arg: /mnt/c/windows/system32");
    expect(proc.stdout).toContain("Env: PYTHON_WSL2");

    if (tempScriptPath && fs.existsSync(tempScriptPath)) {
      if (fs.existsSync(tempScriptPath)) fs.unlinkSync(tempScriptPath);
    }
  });
});


