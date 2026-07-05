import { expect, test, describe } from "bun:test";
import { execSync } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";

const payloadPath = path.join(os.tmpdir(), `test-diff-graceful-${Date.now()}.json`);
const agentExecPath = path.resolve(__dirname, "../agent-exec.ts");

describe("Graceful Exits for Diff", () => {
  test("git diff with exit code 1 is treated as success (0)", () => {
    const file1Path = path.join(os.tmpdir(), `file1-${Date.now()}.txt`);
    const file2Path = path.join(os.tmpdir(), `file2-${Date.now()}.txt`);
    fs.writeFileSync(file1Path, "hello");
    fs.writeFileSync(file2Path, "world");

    const payload = {
      type: "command",
      command: "git",
      args: ["diff", "--no-index", file1Path, file2Path],
      timeoutMs: 15000,
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
      if (fs.existsSync(payloadPath)) if (fs.existsSync(payloadPath)) fs.unlinkSync(payloadPath);
      if (fs.existsSync(file1Path)) if (fs.existsSync(file1Path)) fs.unlinkSync(file1Path);
      if (fs.existsSync(file2Path)) if (fs.existsSync(file2Path)) fs.unlinkSync(file2Path);
    }
  });

  test("wsl diff exit 1 is treated as success (0)", () => {
    const file1Name = `file1-${Date.now()}.txt`;
    const file2Name = `file2-${Date.now()}.txt`;
    const file1Path = path.join(process.cwd(), file1Name);
    const file2Path = path.join(process.cwd(), file2Name);
    fs.writeFileSync(file1Path, "hello");
    fs.writeFileSync(file2Path, "world");

    const payload = {
      type: "command",
      command: "wsl",
      args: ["diff", file1Name, file2Name],
      cwd: process.cwd(),
      timeoutMs: 15000,
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
      if (fs.existsSync(payloadPath)) if (fs.existsSync(payloadPath)) fs.unlinkSync(payloadPath);
      if (fs.existsSync(file1Path)) if (fs.existsSync(file1Path)) fs.unlinkSync(file1Path);
      if (fs.existsSync(file2Path)) if (fs.existsSync(file2Path)) fs.unlinkSync(file2Path);
    }
  });

  test("true error returns exit code 1", () => {
    const payload = {
      type: "command",
      command: "wsl",
      args: ["ls", "NON_EXISTENT_DIR_12345"],
      timeoutMs: 15000,
      expectJsonEnvelope: false
    };
    fs.writeFileSync(payloadPath, JSON.stringify(payload));

    try {
      execSync(`bun ${agentExecPath} ${payloadPath}`, { encoding: "utf8", stdio: 'pipe' });
      throw new Error("agent-exec should have failed with exit code 1, but it succeeded.");
    } catch (err: unknown) {
      const errorObj = err as { status?: number };
      expect(errorObj.status).not.toBe(0);
    } finally {
      if (fs.existsSync(payloadPath)) if (fs.existsSync(payloadPath)) fs.unlinkSync(payloadPath);
    }
  });

  test("diff with --json flag and exit code 1 is treated as success", () => {
    const file1Name = `file1-json-${Date.now()}.txt`;
    const file2Name = `file2-json-${Date.now()}.txt`;
    const file1Path = path.join(process.cwd(), file1Name);
    const file2Path = path.join(process.cwd(), file2Name);
    fs.writeFileSync(file1Path, "hello");
    fs.writeFileSync(file2Path, "world");

    const payload = {
      type: "command",
      command: "wsl",
      args: ["diff", file1Name, file2Name],
      cwd: process.cwd(),
      timeoutMs: 15000,
      expectJsonEnvelope: false
    };
    fs.writeFileSync(payloadPath, JSON.stringify(payload));

    try {
      const stdout = execSync(`bun ${agentExecPath} --json ${payloadPath}`, { encoding: "utf8", stdio: 'pipe' });
      const output = JSON.parse(stdout);
      expect(output.status).toBe("success");
      expect(output.code).toBe(0);
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'status' in err && err.status === 1) {
        throw new Error(`agent-exec failed with exit code 1 in json mode. Stderr: ${'stderr' in err ? err.stderr : 'unknown'}\nStdout: ${'stdout' in err ? err.stdout : 'unknown'}`, { cause: err });
      }
      throw err;
    } finally {
      if (fs.existsSync(payloadPath)) if (fs.existsSync(payloadPath)) fs.unlinkSync(payloadPath);
      if (fs.existsSync(file1Path)) if (fs.existsSync(file1Path)) fs.unlinkSync(file1Path);
      if (fs.existsSync(file2Path)) if (fs.existsSync(file2Path)) fs.unlinkSync(file2Path);
    }
  });
});

