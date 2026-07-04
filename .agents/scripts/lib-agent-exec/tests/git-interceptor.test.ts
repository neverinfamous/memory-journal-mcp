import { expect, test, afterEach, beforeEach } from "bun:test";
import { gitInterceptor } from "../interceptors/git-interceptor.ts";
import { ExecutionContext } from "../interceptors/types.ts";

const originalExit = process.exit;
const originalConsoleError = console.error;

beforeEach(() => {
  process.exit = ((code: number) => {
    throw new Error(`process.exit called with code ${code}`);
  }) as unknown as typeof process.exit;
});

afterEach(() => {
  process.exit = originalExit;
  console.error = originalConsoleError;
});

test("gitInterceptor unconditionally blocks git commit", () => {
  const ctx: ExecutionContext = {
    cmdBasename: "git",
    args: ["commit", "-m", "chore: bypass commit wrapper"],
    payload: { type: "command", command: "git commit -m \"chore: bypass commit wrapper\"" },
    envOverrides: {},
  };
  
  let errorOutput = "";
  console.error = (msg: string) => {
    errorOutput += msg + "\n";
  };

  expect(() => gitInterceptor(ctx)).toThrow("process.exit called with code 1");
  expect(errorOutput).toContain("bun .\\.agents\\scripts\\commit.ts");
});

test("gitInterceptor blocks history commands and suggests get-git-history-json.ts", () => {
  const historyCmds = ["log", "shortlog", "show"];
  for (const cmd of historyCmds) {
    const ctx: ExecutionContext = {
      cmdBasename: "git",
      args: [cmd],
      payload: { type: "command", command: `git ${cmd}` },
      envOverrides: {},
    };

    let errorOutput = "";
    console.error = (msg: string) => {
      errorOutput += msg + "\n";
    };

    expect(() => gitInterceptor(ctx)).toThrow("process.exit called with code 1");
    expect(errorOutput).toContain("bun .\\.agents\\scripts\\get-git-history-json.ts");
  }
});

test("gitInterceptor blocks compound history commands like git stash show", () => {
  const ctx: ExecutionContext = {
    cmdBasename: "git",
    args: ["stash", "show"],
    payload: { type: "command", command: "git stash show" },
    envOverrides: {},
  };

  let errorOutput = "";
  console.error = (msg: string) => {
    errorOutput += msg + "\n";
  };

  expect(() => gitInterceptor(ctx)).toThrow("process.exit called with code 1");
  expect(errorOutput).toContain("bun .\\.agents\\scripts\\get-git-history-json.ts");
});
