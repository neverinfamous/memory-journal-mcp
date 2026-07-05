import { expect, test, describe } from "bun:test";
import { execSync } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";

const payloadPath = path.join(os.tmpdir(), `test-inline-shell-hallucination-${Date.now()}.json`);
const agentExecPath = path.resolve(__dirname, "../agent-exec.ts");

describe("Usability Test: Agent-Exec Hallucinations (Inline Shell)", () => {
  const testCases = [
    { cmd: "pwsh", args: ["-c", "git log"], name: "pwsh -c 'git log'" },
    { cmd: "pwsh", args: ["-Command", "echo test"], name: "pwsh -Command 'echo test'" },
    { cmd: "bash", args: ["-c", "echo test"], name: "bash -c 'echo test'" },
    { cmd: "wsl", args: ["bash", "-c", "echo test"], name: "wsl bash -c 'echo test'" },
    { cmd: "powershell", args: ["echo test"], name: "powershell 'echo test' (implicit -Command)" },
    { cmd: "pwsh", args: ["echo test"], name: "pwsh 'echo test' (implicit -Command)" }
  ];

  for (const tc of testCases) {
    test(`Intercepts '${tc.name}' command natively and throws anti-hallucination error`, () => {
      const payload = {
        type: "command",
        command: tc.cmd,
        args: tc.args,
        timeoutMs: 5000,
        expectJsonEnvelope: false
      };
      fs.writeFileSync(payloadPath, JSON.stringify(payload));

      try {
        execSync(`bun ${agentExecPath} ${payloadPath}`, { encoding: "utf8", stdio: 'pipe' });
        throw new Error(`agent-exec should have failed and thrown an interceptor error for ${tc.name}, but it succeeded.`);
      } catch (err: unknown) {
        const errorObj = err as { status?: number, stderr?: string, stdout?: string, message?: string };
        const stderr = errorObj.stderr || "";
        const stdout = errorObj.stdout || "";
        const message = errorObj.message || "";
        const output = stderr + "\n" + stdout + "\n" + message;
        
        expect(errorObj.status).not.toBe(0);
        expect(output.toLowerCase()).toContain("payload");
        expect(output.toLowerCase()).toContain("inline");
        expect(output).toContain("AUTONOMOUS HEALING");
      } finally {
        if (fs.existsSync(payloadPath)) {
          if (fs.existsSync(payloadPath)) fs.unlinkSync(payloadPath);
        }
      }
    });
  }

  const evalTestCases = [
    { interpreter: "pwsh", code: 'pwsh -c "git log"', name: "eval pwsh: pwsh -c 'git log'" },
    { interpreter: "pwsh", code: 'pwsh -Command "echo test"', name: "eval pwsh: pwsh -Command 'echo test'" },
    { interpreter: "bash", code: 'bash -c "echo test"', name: "eval bash: bash -c 'echo test'" },
    { interpreter: "pwsh", code: "powershell 'echo test'", name: "eval pwsh: powershell 'echo test' (implicit -Command)" },
    { interpreter: "pwsh", code: "pwsh 'echo test'", name: "eval pwsh: pwsh 'echo test' (implicit -Command)" }
  ];

  for (const tc of evalTestCases) {
    test(`Intercepts '${tc.name}' eval payload and throws anti-hallucination error`, () => {
      const payload = {
        type: "eval",
        interpreter: tc.interpreter,
        code: tc.code,
        timeoutMs: 5000,
        expectJsonEnvelope: false
      };
      fs.writeFileSync(payloadPath, JSON.stringify(payload));

      try {
        execSync(`bun ${agentExecPath} ${payloadPath}`, { encoding: "utf8", stdio: 'pipe' });
        throw new Error(`agent-exec should have failed and thrown an interceptor error for ${tc.name}, but it succeeded.`);
      } catch (err: unknown) {
        const errorObj = err as { status?: number, stderr?: string, stdout?: string, message?: string };
        const stderr = errorObj.stderr || "";
        const stdout = errorObj.stdout || "";
        const message = errorObj.message || "";
        const output = stderr + "\n" + stdout + "\n" + message;
        
        expect(errorObj.status).not.toBe(0);
        expect(output.toLowerCase()).toContain("payload");
        expect(output.toLowerCase()).toContain("inline");
        expect(output).toContain("AUTONOMOUS HEALING");
      } finally {
        if (fs.existsSync(payloadPath)) fs.unlinkSync(payloadPath);
      }
    });
  }
});
