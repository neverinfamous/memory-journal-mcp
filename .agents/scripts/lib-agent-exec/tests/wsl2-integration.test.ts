import { describe, it, expect, spyOn, afterEach } from 'bun:test';
import { buildCommand } from "../command-builder.ts";
import type { ExecPayload } from "../schema.ts";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

describe("WSL2 Integration Tests", () => {
  let exitSpy: import("bun:test").Mock<typeof process.exit>;

  afterEach(() => {
    if (exitSpy) {
      exitSpy.mockRestore();
    }
  });

  it("should map windows paths to /mnt/c/ for WSL2 target in command payload and execute correctly", () => {
    // We will test if `pwd` outputs /mnt/c/Users
    const payload: ExecPayload = {
      type: "command",
      command: "bash",
      args: ["-c", "pwd"],
      target: "wsl2",
      env: {
        "TEST_WSL2_ENV": "SUCCESS_123"
      }
    };

    const testCwd = "C:\\Users";
    const { cmd, args } = buildCommand(payload, testCwd);

    expect(cmd).toBe("wsl.exe");
    expect(args).toContain("--cd");
    expect(args).toContain("/mnt/c/Users");
    expect(args).toContain("-e");
    expect(args).toContain("env");
    expect(args.some(a => a.startsWith("AGENT_EXEC_WSL_UUID="))).toBe(true);
    expect(args).toContain("TEST_WSL2_ENV=SUCCESS_123");
    expect(args).toContain("bash");
    expect(args).toContain("-c");
    expect(args).toContain("pwd");

    // Let's actually execute it to verify WSL2 subsystem accepts it
    const proc = spawnSync(cmd, args, { encoding: "utf8" });
    expect(proc.status).toBe(0);
    expect(proc.stdout.trim().toLowerCase()).toBe("/mnt/c/users");
  });

  it("should map windows paths to /mnt/c/ for WSL2 target in shell script payload and execute correctly", () => {
    // Write a temporary shell script in Windows format
    const scriptPath = path.join(os.tmpdir(), "wsl2-test-script.sh");
    fs.writeFileSync(scriptPath, "echo 'Hello from WSL2'; echo \"Arg 1: $1\"; echo \"Env: $TEST_WSL2_ENV\"", "utf8");

    const payload: ExecPayload = {
      type: "script",
      scriptPath: scriptPath,
      args: ["C:\\Users\\chris"],
      target: "wsl2",
      env: {
        "TEST_WSL2_ENV": "SCRIPT_SUCCESS"
      }
    };

    const { cmd, args } = buildCommand(payload, "C:\\Users");

    expect(cmd).toBe("wsl.exe");
    expect(args).toContain("bash");
    // Assert path mapping for argument
    expect(args).toContain("/mnt/c/Users/chris");

    const proc = spawnSync(cmd, args, { encoding: "utf8" });
    expect(proc.status).toBe(0);
    expect(proc.stdout).toContain("Hello from WSL2");
    // It's going to print /mnt/c/Users/chris
    expect(proc.stdout.toLowerCase()).toContain("/mnt/c/users/chris");
    expect(proc.stdout).toContain("Env: SCRIPT_SUCCESS");

    // Cleanup
    if (fs.existsSync(scriptPath)) {
      if (fs.existsSync(scriptPath)) fs.unlinkSync(scriptPath);
    }
  });

  it("should handle wsl path mapping correctly in eval payload and execute correctly", () => {
    const payload: ExecPayload = {
      type: "eval",
      code: "echo 'Eval hello'; echo \"Eval Arg: $1\"; echo \"Eval Env: $TEST_WSL2_ENV\"",
      interpreter: "bash",
      args: ["C:\\Test\\Dir"],
      target: "wsl2",
      env: {
        "TEST_WSL2_ENV": "EVAL_SUCCESS"
      }
    };

    // We must mock process.exit because if it fails to write temp file, it exits.
    // In successful case, buildCommand doesn't exit.
    exitSpy = spyOn(process, "exit").mockImplementation((() => {}) as unknown as typeof process.exit);

    const { cmd, args, tempScriptPath } = buildCommand(payload, "C:\\Users");
    
    expect(cmd).toBe("wsl.exe");
    expect(args).toContain("/mnt/c/Test/Dir");
    expect(args).toContain("bash");

    // The script path is generated inside /tmp
    expect(tempScriptPath).toBeTruthy();
    
    const proc = spawnSync(cmd, args, { encoding: "utf8" });
    expect(proc.status).toBe(0);
    expect(proc.stdout).toContain("Eval hello");
    expect(proc.stdout).toContain("Eval Arg: /mnt/c/Test/Dir");
    expect(proc.stdout).toContain("Eval Env: EVAL_SUCCESS");

    // Cleanup
    if (tempScriptPath && fs.existsSync(tempScriptPath)) {
      if (fs.existsSync(tempScriptPath)) fs.unlinkSync(tempScriptPath);
    }
  });
});


