import { test, expect, describe } from "bun:test";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const AGENT_EXEC_TS = path.resolve(__dirname, "../../agent-exec.js");
const SCRATCH_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "agent-exec-null-"));

describe("agent-exec Execution Edge Cases", () => {
  function runAgentExec(payload: Record<string, unknown>) {
    const payloadPath = path.join(SCRATCH_DIR, `payload-exec-${Date.now()}-${Math.random()}.json`);
    fs.writeFileSync(payloadPath, JSON.stringify(payload), "utf-8");
    
    const result = spawnSync("bun", [AGENT_EXEC_TS, payloadPath], {
      cwd: SCRATCH_DIR,
      encoding: "utf-8"
    });

    if (fs.existsSync(payloadPath)) {
      try { fs.unlinkSync(payloadPath); } catch { /* ignore */ }
    }
    return result;
  }

  test("Execution with null bytes in command fails validation gracefully", () => {
    const res = runAgentExec({
      type: "command",
      command: "echo\u0000hello",
      args: ["test"]
    });
    expect(res.status).not.toBe(0);
    expect(res.stderr).toContain("Payload schema validation failed");
    expect(res.stderr).toContain("Must not contain null bytes");
  });

  test("Execution with null bytes in env fails validation gracefully", () => {
    const res = runAgentExec({
      type: "command",
      command: "echo",
      args: ["test"],
      env: {
        "TEST\u0000KEY": "value\u0000"
      }
    });
    expect(res.status).not.toBe(0);
    expect(res.stderr).toContain("Payload schema validation failed");
  });
});
