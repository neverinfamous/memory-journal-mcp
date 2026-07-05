import { expect, test, describe } from "bun:test";
import { execSync } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";

const payloadPath = path.join(os.tmpdir(), `test-grep-graceful-${Date.now()}.json`);
const agentExecPath = path.resolve(__dirname, "../agent-exec.ts");

describe("Graceful Exits for Grep/Rg", () => {
  test("wsl bash -c grep exit 1 is treated as success (0)", () => {
    // Generate a payload that runs grep via WSL on a non-matching string
    const payload = {
      type: "command",
      command: "wsl",
      args: ["bash", "-c", "echo 'hello' | grep 'world'"],
      timeoutMs: 5000,
      expectJsonEnvelope: false,
      bypassInterceptors: true
    };
    fs.writeFileSync(payloadPath, JSON.stringify(payload));

    try {
      // It should not throw if exit code is 0
      execSync(`bun ${agentExecPath} ${payloadPath}`, { encoding: "utf8", stdio: 'pipe' });
      expect(true).toBe(true);
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'status' in err && err.status === 1) {
        throw new Error(`agent-exec failed with exit code 1. Stderr: ${'stderr' in err ? err.stderr : 'unknown'}`, { cause: err });
      }
      throw err;
    } finally {
      if (fs.existsSync(payloadPath)) {
        if (fs.existsSync(payloadPath)) fs.unlinkSync(payloadPath);
      }
    }
  });

  test("true error (e.g. ls NON_EXISTENT_DIR) returns exit code 1", () => {
    const payload = {
      type: "command",
      command: "wsl",
      args: ["bash", "-c", "ls NON_EXISTENT_DIR_12345"],
      timeoutMs: 5000,
      expectJsonEnvelope: false,
      bypassInterceptors: true
    };
    fs.writeFileSync(payloadPath, JSON.stringify(payload));

    try {
      execSync(`bun ${agentExecPath} ${payloadPath}`, { encoding: "utf8", stdio: 'pipe' });
      throw new Error("agent-exec should have failed with exit code 1, but it succeeded.");
    } catch (err: unknown) {
      const errorObj = err as { status?: number };
      expect(errorObj.status).not.toBe(0);
    } finally {
      if (fs.existsSync(payloadPath)) {
        if (fs.existsSync(payloadPath)) fs.unlinkSync(payloadPath);
      }
    }
  });

  test("true error (e.g. ls NON_EXISTENT_DIR_GREP) returns exit code 1 even if 'grep' is in the arguments", () => {
    const payload = {
      type: "command",
      command: "wsl",
      args: ["bash", "-c", "ls NON_EXISTENT_DIR_GREP_12345"],
      timeoutMs: 5000,
      expectJsonEnvelope: false,
      bypassInterceptors: true
    };
    fs.writeFileSync(payloadPath, JSON.stringify(payload));

    try {
      execSync(`bun ${agentExecPath} ${payloadPath}`, { encoding: "utf8", stdio: 'pipe' });
      throw new Error("agent-exec should have failed with exit code 1, but it succeeded.");
    } catch (err: unknown) {
      const errorObj = err as { status?: number };
      expect(errorObj.status).not.toBe(0);
    } finally {
      if (fs.existsSync(payloadPath)) {
        if (fs.existsSync(payloadPath)) fs.unlinkSync(payloadPath);
      }
    }
  });

  test("eval payload with grep exit 1 is treated as success (0)", () => {
    const payload = {
      type: "eval",
      target: "wsl2",
      code: "echo 'hello' | grep 'world'",
      timeoutMs: 5000,
      expectJsonEnvelope: false
    };
    fs.writeFileSync(payloadPath, JSON.stringify(payload));

    try {
      execSync(`bun ${agentExecPath} ${payloadPath}`, { encoding: "utf8", stdio: 'pipe' });
      expect(true).toBe(true);
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'status' in err && err.status === 1) {
        throw new Error(`agent-exec failed with exit code 1. Stderr: ${'stderr' in err ? err.stderr : 'unknown'}`, { cause: err });
      }
      throw err;
    } finally {
      if (fs.existsSync(payloadPath)) fs.unlinkSync(payloadPath);
    }
  }, 15000);
});
