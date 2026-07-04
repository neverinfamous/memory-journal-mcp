import { describe, it, expect } from 'bun:test';
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

describe("WSL2 CRLF Boundary Fidelity", () => {
  it("should ensure grep functions predictably with CRLF in WSL", () => {
    const fileA = path.join(os.tmpdir(), "crlf-test-grep.txt");
    const payloadPath = path.join(os.tmpdir(), "payload-grep-crlf.json");
    
    try {
      fs.writeFileSync(fileA, "line1\r\nline2\r\n", "utf8");

      fs.writeFileSync(payloadPath, JSON.stringify({
        type: "command",
        target: "wsl2",
        command: "grep",
        args: ["line1$", fileA],
        bypassInterceptors: true
      }), "utf8");

      const agentExecPath = path.resolve(__dirname, "../../agent-exec.ts");
      const result = spawnSync("bun", [agentExecPath, payloadPath], { encoding: "utf8" });
      
      if (result.status !== 0) {
         console.log("STDOUT:", result.stdout);
         console.log("STDERR:", result.stderr);
      }
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("line1");
    } finally {
      if (fs.existsSync(fileA)) if (fs.existsSync(fileA)) fs.unlinkSync(fileA);
      if (fs.existsSync(payloadPath)) if (fs.existsSync(payloadPath)) fs.unlinkSync(payloadPath);
    }
  });
});
