import { expect, test, describe } from "bun:test";
import { execSync } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";

const payloadPath = path.join(os.tmpdir(), `test-wsl2-ls-grep-${Date.now()}.json`);
const agentExecPath = path.resolve(__dirname, "../agent-exec.ts");

describe("Usability Test: WSL2 allows ls and grep", () => {
  test("Allows 'ls' command in WSL2 target", () => {
    const payload = {
      type: "command",
      command: "ls",
      args: ["."],
      target: "wsl2",
      timeoutMs: 5000,
      expectJsonEnvelope: false
    };
    fs.writeFileSync(payloadPath, JSON.stringify(payload));

    try {
      const output = execSync(`bun ${agentExecPath} ${payloadPath}`, { encoding: "utf8", stdio: 'pipe' });
      // It should succeed or fail for some other reason, but it MUST NOT print the anti-hallucination error
      expect(output).not.toContain("AUTONOMOUS HEALING");
      expect(output).not.toContain("Do NOT use 'ls'");
    } finally {
      if (fs.existsSync(payloadPath)) {
        fs.unlinkSync(payloadPath);
      }
    }
  });
});
