import { test, expect } from "bun:test";
import { $ } from "bun";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

test("agent-exec.ts outputs only JSON when --json is provided", async () => {
  const agentExecPath = path.resolve(__dirname, "../agent-exec.ts");
  const payloadPath = path.resolve(os.tmpdir(), "dummy-payload-json-test.json");
  
  // Provide a minimal valid payload
  fs.writeFileSync(payloadPath, JSON.stringify({
    type: "command",
    command: "echo",
    args: ["hello"],
    cwd: process.cwd()
  }));

  const { stdout } = await $`bun ${agentExecPath} --json ${payloadPath}`.nothrow().quiet();
  
  // If the program exits successfully, it should output valid JSON to stdout
  const outStr = stdout.toString().trim();
  expect(outStr).not.toBe("");
  
  // It should parse as JSON successfully
  expect(() => JSON.parse(outStr)).not.toThrow();
  
  // It shouldn't contain the human readable prefix or text if it's supposed to be raw JSON
  // Let's verify standard agent-exec stdout behavior is suppressed in favor of JSON envelope
  expect(outStr).not.toContain("Agent Execution Bridge"); // just in case
  
  try { fs.unlinkSync(payloadPath); } catch { /* ignore */ }
});

test("agent-exec.ts with --json and missing payload returns json error", async () => {
  const agentExecPath = path.resolve(__dirname, "../agent-exec.ts");
  
  const { stdout, exitCode } = await $`bun ${agentExecPath} --json`.nothrow().quiet();
  
  expect(exitCode).toBe(1);
  const outStr = stdout.toString().trim();
  
  // Should return a JSON formatted error
  expect(() => JSON.parse(outStr)).not.toThrow();
  expect(JSON.parse(outStr).status).toBe("error");
});
