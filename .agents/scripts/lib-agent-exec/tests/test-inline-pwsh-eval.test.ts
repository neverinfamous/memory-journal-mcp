import { expect, test, describe } from "bun:test";
import { execSync } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";

const agentExecPath = path.resolve(__dirname, "../agent-exec.ts");

describe("Eval payload inline shell hallucination", () => {
  const testCases = [
    { code: 'pwsh -c "git log"', name: 'pwsh -c' },
    { code: 'pwsh -Command "echo test"', name: 'pwsh -Command' },
    { code: 'bash -c "ls"', name: 'bash -c' },
  ];

  for (const tc of testCases) {
    test(`Intercepts '${tc.name}' command natively and throws anti-hallucination error in eval payload`, () => {
      const payloadPath = path.join(os.tmpdir(), `test-eval-hallucination-${Date.now()}-${Math.random()}.json`);
      const payload = {
        type: "eval",
        interpreter: "pwsh",
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
        expect(output.toLowerCase()).toContain("inline shell command");
        expect(output).toContain("AUTONOMOUS HEALING");
      } finally {
        if (fs.existsSync(payloadPath)) {
          fs.unlinkSync(payloadPath);
        }
      }
    });
  }
});
