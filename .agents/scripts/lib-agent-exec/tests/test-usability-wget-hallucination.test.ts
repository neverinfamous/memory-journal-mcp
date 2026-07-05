import { expect, test, describe } from "bun:test";
import { execSync } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";

const payloadPath = path.join(os.tmpdir(), `test-wget-hallucination-${Date.now()}.json`);
const agentExecPath = path.resolve(__dirname, "../agent-exec.ts");

describe("Usability Test: Agent-Exec Hallucinations (Network aliases) Wget", () => {
  test("Intercepts 'wget' command natively and throws anti-hallucination error with bypass instructions", () => {
    const payload = {
      type: "command",
      command: "wget",
      args: ["https://example.com"],
      timeoutMs: 5000,
      expectJsonEnvelope: false
    };
    fs.writeFileSync(payloadPath, JSON.stringify(payload));

    try {
      execSync(`bun ${agentExecPath} ${payloadPath}`, { encoding: "utf8", stdio: 'pipe' });
      throw new Error("agent-exec should have failed and thrown an interceptor error, but it succeeded.");
    } catch (err: unknown) {
      const errorObj = err as { status?: number, stderr?: string, stdout?: string };
      const stderr = errorObj.stderr || "";
      const stdout = errorObj.stdout || "";
      const output = stderr + "\n" + stdout;
      
      expect(errorObj.status).not.toBe(0);
      expect(output).toContain("read_url_content");
      expect(output).toContain("wget.exe");
      expect(output).toContain("AUTONOMOUS HEALING");
    } finally {
      if (fs.existsSync(payloadPath)) {
        if (fs.existsSync(payloadPath)) fs.unlinkSync(payloadPath);
      }
    }
  });

  test("Allows 'wget.exe' command to bypass the interceptor", () => {
    const payload = {
      type: "command",
      command: "wget.exe",
      args: ["--version"],
      timeoutMs: 5000,
      expectJsonEnvelope: false
    };
    fs.writeFileSync(payloadPath, JSON.stringify(payload));

    try {
      const result = execSync(`bun ${agentExecPath} ${payloadPath}`, { encoding: "utf8", stdio: 'pipe' });
      expect(result).not.toContain("read_url_content");
    } catch (err: unknown) {
      const errorObj = err as { status?: number, stderr?: string, stdout?: string, message?: string };
      const stderr = errorObj.stderr || "";
      const stdout = errorObj.stdout || "";
      const output = stderr + "\n" + stdout;
      expect(output).not.toContain("read_url_content");
    } finally {
      if (fs.existsSync(payloadPath)) {
        if (fs.existsSync(payloadPath)) fs.unlinkSync(payloadPath);
      }
    }
  });



  test("Intercepts 'wget' inside an eval payload and rewrites or rejects it", () => {
    const payload = {
      type: "eval",
      code: "wget https://example.com",
      interpreter: "pwsh"
    };
    fs.writeFileSync(payloadPath, JSON.stringify(payload));

    try {
      execSync(`bun ${agentExecPath} ${payloadPath}`, { encoding: "utf8", stdio: 'pipe' });
      throw new Error("agent-exec should have failed and thrown an interceptor error, but it succeeded.");
    } catch (err: unknown) {
      const errorObj = err as { status?: number, stderr?: string, stdout?: string, message?: string };
      const stderr = errorObj.stderr || "";
      const stdout = errorObj.stdout || "";
      const output = stderr + "\n" + stdout;
      
      expect(errorObj.status).not.toBe(0);
      expect(output).toContain("read_url_content");
      expect(output).toContain("wget.exe");
      expect(output).toContain("AUTONOMOUS HEALING");
    } finally {
      if (fs.existsSync(payloadPath)) {
        if (fs.existsSync(payloadPath)) fs.unlinkSync(payloadPath);
      }
    }
  });

  test("Allows 'wget' command in WSL2 target", () => {
    const payload = {
      type: "command",
      command: "wget",
      args: ["--version"],
      target: "wsl2",
      timeoutMs: 15000,
      expectJsonEnvelope: false
    };
    fs.writeFileSync(payloadPath, JSON.stringify(payload));

    try {
      const result = execSync(`bun ${agentExecPath} ${payloadPath}`, { encoding: "utf8", stdio: 'pipe' });
      expect(result).not.toContain("read_url_content");
    } catch (err: unknown) {
      const errorObj = err as { status?: number, stderr?: string, stdout?: string, message?: string };
      const stderr = errorObj.stderr || "";
      const stdout = errorObj.stdout || "";
      const output = stderr + "\n" + stdout;
      expect(output).not.toContain("read_url_content");
    } finally {
      if (fs.existsSync(payloadPath)) {
        if (fs.existsSync(payloadPath)) fs.unlinkSync(payloadPath);
      }
    }
  }, 15000);
});
