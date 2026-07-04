import { expect, test, describe } from "bun:test";
import { execSync } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";

const payloadPath = path.join(os.tmpdir(), `test-curl-exe-vague-error-${Date.now()}.json`);
const agentExecPath = path.resolve(__dirname, "../../agent-exec.ts");

describe("Usability Test: Agent-Exec Hallucinations (Network aliases vague error)", () => {
  test("Allows 'curl.exe' command with arguments in the command string to bypass the interceptor without contradictory vague errors", () => {
    const payload = {
      type: "command",
      command: "curl.exe https://example.com",
      timeoutMs: 5000,
      expectJsonEnvelope: false
    };
    fs.writeFileSync(payloadPath, JSON.stringify(payload));

    try {
      const result = execSync(`bun ${agentExecPath} ${payloadPath}`, { encoding: "utf8", stdio: 'pipe' });
      // Ensure it doesn't throw the hallucination error
      expect(result).not.toContain("read_url_content");
    } catch (err: unknown) {
      const errorObj = err as { status?: number, stderr?: string, stdout?: string, message?: string };
      const stderr = errorObj.stderr || "";
      const stdout = errorObj.stdout || "";
      const output = stderr + "\n" + stdout;
      // It might fail for other reasons, but it shouldn't hit the interceptor error
      expect(output).not.toContain("read_url_content");
    } finally {
      if (fs.existsSync(payloadPath)) {
        if (fs.existsSync(payloadPath)) fs.unlinkSync(payloadPath);
      }
    }
  });
});
