import { test, expect } from "bun:test";
import { $ } from "bun";
import path from "node:path";

test("agent-exec.ts recognizes --help flag and outputs usage info", async () => {
  const agentExecPath = path.resolve(__dirname, "../agent-exec.ts");
  const { stderr, exitCode } = await $`bun ${agentExecPath} --help`.nothrow().quiet();
  
  expect(exitCode).toBe(0);
  expect(stderr.toString()).toContain("Agent Execution Bridge");
  expect(stderr.toString()).toContain("Usage:");
  expect(stderr.toString()).toContain("--help");
});

test("agent-exec.ts recognizes -h flag and outputs usage info", async () => {
  const agentExecPath = path.resolve(__dirname, "../agent-exec.ts");
  const { stderr, exitCode } = await $`bun ${agentExecPath} -h`.nothrow().quiet();
  
  expect(exitCode).toBe(0);
  expect(stderr.toString()).toContain("Agent Execution Bridge");
  expect(stderr.toString()).toContain("Usage:");
  expect(stderr.toString()).toContain("--help");
});
