import { test, expect } from "bun:test";
import { $ } from "bun";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

test("agent-exec.ts implicitly outputs JSON when expectJsonEnvelope is true", async () => {
  const agentExecPath = path.resolve(__dirname, "../../agent-exec.ts");
  const payloadPath = path.resolve(os.tmpdir(), "dummy-payload-expectjson-test.json");
  
  // Provide a valid payload with expectJsonEnvelope: true
  fs.writeFileSync(payloadPath, JSON.stringify({
    type: "command",
    command: "echo",
    args: ["hello"],
    cwd: process.cwd(),
    expectJsonEnvelope: true
  }));

  // Notice: We do NOT pass --json here
  const { stdout } = await $`bun ${agentExecPath} ${payloadPath}`.nothrow().quiet();
  
  const outStr = stdout.toString().trim();
  expect(outStr).not.toBe("");
  
  // It should parse as JSON successfully because expectJsonEnvelope forces isJson = true
  expect(() => JSON.parse(outStr)).not.toThrow();
  
  const parsed = JSON.parse(outStr);
  expect(parsed.status).toBe("success");
  expect(parsed.stdout).toContain("hello");
  
  try { fs.unlinkSync(payloadPath); } catch { /* ignore */ }
});
