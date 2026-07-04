import { test, expect } from "bun:test";
import { $ } from "bun";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

test("agent-exec.ts supports --payloadPath option explicitly", async () => {
  const agentExecPath = path.resolve(__dirname, "../agent-exec.ts");
  const payloadPath = path.resolve(os.tmpdir(), "dummy-payload-path-test.json");
  
  // Provide a minimal valid payload
  fs.writeFileSync(payloadPath, JSON.stringify({
    type: "command",
    command: "echo",
    args: ["hello"],
    cwd: process.cwd()
  }));

  const { stdout, exitCode } = await $`bun ${agentExecPath} --payloadPath ${payloadPath}`.nothrow().quiet();
  
  expect(exitCode).toBe(0);
  
  const outStr = stdout.toString().trim();
  expect(outStr).toContain("hello");
  
  try { fs.unlinkSync(payloadPath); } catch { /* ignore */ }
});
