import { describe, it, expect } from 'bun:test';
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

describe("WSL2 Quoting & Escaping Boundary Fidelity", () => {
  it("should ensure complex quoted shell pipelines execute predictably in WSL2", () => {
    const payloadPath = path.join(os.tmpdir(), "payload-wsl-quoting.json");
    
    try {
      fs.writeFileSync(payloadPath, JSON.stringify({
        type: "command",
        target: "wsl2",
        command: "awk 'BEGIN { print \"{\\\"foo\\\": \\\"bar\\\"}\" }'",
        bypassInterceptors: true
      }), "utf8");

      const agentExecPath = path.resolve(__dirname, "../../agent-exec.ts");
      const result = spawnSync("bun", [agentExecPath, payloadPath], { encoding: "utf8" });
      
      if (result.status !== 0) {
         console.log("STDOUT:", result.stdout);
         console.log("STDERR:", result.stderr);
      }
      expect(result.status).toBe(0);
      expect(result.stdout.trim()).toBe('{"foo": "bar"}');
    } finally {
      if (fs.existsSync(payloadPath)) if (fs.existsSync(payloadPath)) fs.unlinkSync(payloadPath);
    }
  }, 15000);
});
