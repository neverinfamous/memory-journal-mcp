import { expect, test, describe, spyOn, afterEach, beforeEach } from 'bun:test';
import { checkPrompt } from "C:/Users/chris/Desktop/adamic/.agents/scripts/lib-agent-exec/prompt-detector.ts";
import { gitInterceptor } from "C:/Users/chris/Desktop/adamic/.agents/scripts/lib-agent-exec/interceptors/git-interceptor.ts";
import { dockerInterceptor } from "C:/Users/chris/Desktop/adamic/.agents/scripts/lib-agent-exec/interceptors/docker-interceptor.ts";
import type { ExecutionContext } from "C:/Users/chris/Desktop/adamic/.agents/scripts/lib-agent-exec/interceptors/types.ts";

let processExitSpy: ReturnType<typeof spyOn>;
let consoleErrorSpy: ReturnType<typeof spyOn>;

beforeEach(() => {
  // Safely mock process.exit to throw an error, preventing test runner crash
  processExitSpy = spyOn(process, "exit").mockImplementation((code?: number) => {
    throw new Error(`process.exit called with code ${code}`);
  });
  consoleErrorSpy = spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  processExitSpy.mockRestore();
  consoleErrorSpy.mockRestore();
});

describe("Prompt Detector Regexes", () => {
  test("inquirer.js prompts", () => {
    expect(checkPrompt("? What is your name? › ")).toBe(true);
    expect(checkPrompt("? Select a package manager » ")).toBe(true);
    expect(checkPrompt("✔ What is your name? … ")).toBe(true);
  });

  test("y/n and package manager prompts", () => {
    expect(checkPrompt("Overwrite foo.txt? (y/n)")).toBe(true);
    expect(checkPrompt("package name: (my-pkg) ")).toBe(true);
    expect(checkPrompt("Is this OK? (yes) ")).toBe(true);
  });
});

describe("Git Rebase -i Blocking", () => {
  test("blocks git rebase -i", () => {
    const ctx = {
      cmdBasename: "git",
      args: ["rebase", "-i", "HEAD~3"],
      payload: { type: "command", command: "git", args: ["rebase", "-i", "HEAD~3"] }
    } as unknown as ExecutionContext;
    expect(() => gitInterceptor(ctx)).toThrow("process.exit called with code 1");
  });

  test("allows non-interactive rebase", () => {
    const ctx = {
      cmdBasename: "git",
      args: ["rebase", "main"],
      payload: { type: "command", command: "git", args: ["rebase", "main"] }
    } as unknown as ExecutionContext;
    expect(() => gitInterceptor(ctx)).not.toThrow();
  });
});

describe("Forced TTY flags (-t, -i) Stripping", () => {
  test("docker run strips -it and keeps dummy trailing args", () => {
    const ctx = {
      cmdBasename: "docker",
      args: ["run", "-it", "ubuntu", "bash", "-c", "echo test"],
      payload: { type: "command", command: "docker", args: ["run", "-it", "ubuntu", "bash", "-c", "echo test"] }
    } as unknown as ExecutionContext;
    dockerInterceptor(ctx);
    expect(ctx.args).toEqual(["run", "ubuntu", "bash", "-c", "echo test"]);
  });

  test("docker exec strips -i and -t individually", () => {
    const ctx = {
      cmdBasename: "docker",
      args: ["exec", "-i", "-t", "container_name", "ls", "-la"],
      payload: { type: "command", command: "docker", args: ["exec", "-i", "-t", "container_name", "ls", "-la"] }
    } as unknown as ExecutionContext;
    dockerInterceptor(ctx);
    expect(ctx.args).toEqual(["exec", "container_name", "ls", "-la"]);
  });
});


