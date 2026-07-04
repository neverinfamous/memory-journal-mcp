import { test, expect } from 'bun:test';
import { buildCommand } from '../command-builder.js';
import type { ExecPayload } from '../schema.js';
import process from 'node:process';

test("bypassInterceptors - replTuiInterceptor is bypassed when true", () => {
  const payload: ExecPayload = {
    type: "command",
    command: "vim",
    args: [],
    bypassInterceptors: true
  };

  // buildCommand should not throw process.exit or error since bypassInterceptors is true
  const result = buildCommand(payload, process.cwd());
  
  expect(result.cmd).toBeDefined();
});

test("bypassInterceptors - replTuiInterceptor is NOT bypassed when false or undefined", () => {
  const payload: ExecPayload = {
    type: "command",
    command: "vim",
    args: [],
    // bypassInterceptors is undefined
  };

  // The interceptor uses console.error and process.exit, or throws in the test environment if process.exit is mocked,
  // but wait, does buildCommand mock process.exit? 
  // We can just spy on process.exit or check if it throws/exits.
  let exited = false;
  const originalExit = process.exit;
  process.exit = ((code: number) => {
    exited = true;
    throw new Error(`process.exit called with code ${code}`);
  }) as unknown as typeof process.exit;

  try {
    expect(() => buildCommand(payload, process.cwd())).toThrow("process.exit called with code 1");
    expect(exited).toBe(true);
  } finally {
    process.exit = originalExit;
  }
});
