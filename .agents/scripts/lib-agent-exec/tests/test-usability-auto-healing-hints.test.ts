import { expect, test } from "bun:test";
import { ExecutionContext } from "../interceptors/types.js";
import { systemInterceptor } from "../interceptors/system-interceptor.js";

test("Auto-Healing Hint: rg without arguments triggers missing stdin hang block", () => {
  const ctx: ExecutionContext = {
    payload: { type: "command", command: "rg" },
    cmdBasename: "rg",
    args: [],
    envOverrides: {}
  };

  let exited = false;
  let stderrOutput = "";
  
  const originalExit = process.exit;
  const originalConsoleError = console.error;

  try {
    process.exit = ((code?: number) => { exited = true; throw new Error(`Exit ${code}`); }) as unknown as (code?: number) => never;
    console.error = (msg: string) => { stderrOutput += msg + "\n"; };

    systemInterceptor(ctx);
  } catch (err: unknown) {
    if (err instanceof Error && !err.message.startsWith("Exit")) throw err;
  } finally {
    process.exit = originalExit;
    console.error = originalConsoleError;
  }

  expect(exited).toBe(true);
  expect(stderrOutput).toContain("called without file arguments, no recursive flag, and no stdin. It will hang indefinitely.");
});

test("Auto-Healing Hint: grep without arguments triggers missing stdin hang block", () => {
  const ctx: ExecutionContext = {
    payload: { type: "command", command: "grep" },
    cmdBasename: "grep",
    args: [],
    envOverrides: {}
  };

  let exited = false;
  let stderrOutput = "";
  
  const originalExit = process.exit;
  const originalConsoleError = console.error;

  try {
    process.exit = ((code?: number) => { exited = true; throw new Error(`Exit ${code}`); }) as unknown as (code?: number) => never;
    console.error = (msg: string) => { stderrOutput += msg + "\n"; };

    systemInterceptor(ctx);
  } catch (err: unknown) {
    if (err instanceof Error && !err.message.startsWith("Exit")) throw err;
  } finally {
    process.exit = originalExit;
    console.error = originalConsoleError;
  }

  expect(exited).toBe(true);
  expect(stderrOutput).toContain("called without file arguments, no recursive flag, and no stdin. It will hang indefinitely.");
});
