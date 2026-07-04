import { expect, test, describe, mock, beforeAll, afterAll } from 'bun:test';
import { buildEnvironment } from "C:/Users/chris/Desktop/adamic/.agents/scripts/lib-agent-exec/environment.ts";
import { buildCommand } from "C:/Users/chris/Desktop/adamic/.agents/scripts/lib-agent-exec/command-builder.ts";
import { executeCommand } from "C:/Users/chris/Desktop/adamic/.agents/scripts/lib-agent-exec/execution-engine.ts";

describe("Environment Immutability", () => {
  test("Immutable variables cannot be overridden", () => {
    const payloadEnv = {
      "CI": "0",
      "GIT_EDITOR": "vim",
      "NO_COLOR": "0",
      "GIT_ASKPASS": "some-script",
      "PAGER": "more",
      "TERM": "xterm"
    };

    const originalConsoleError = console.error;
    const errorOutputs: string[] = [];
    console.error = (msg: string) => errorOutputs.push(msg);

    const env = buildEnvironment(payloadEnv);

    console.error = originalConsoleError;

    // Check defaults are preserved
    expect(env["CI"]).toBe("1");
    expect(env["GIT_EDITOR"]).toBe("true");
    expect(env["NO_COLOR"]).toBe("1");
    expect(env["GIT_ASKPASS"]).toBe("agent-exec-blocked");

    // Check warnings were emitted
    const allErrors = errorOutputs.join("\n");
    expect(allErrors).toContain("AGENT HINT: The environment variable 'CI' is immutable");
    expect(allErrors).toContain("AGENT HINT: The environment variable 'GIT_EDITOR' is immutable");
    expect(allErrors).toContain("AGENT HINT: The environment variable 'NO_COLOR' is immutable");
    expect(allErrors).toContain("AGENT HINT: The environment variable 'GIT_ASKPASS' is immutable");
  });

  test("buildCommand applies command-level environment overrides securely", () => {
    const payload = {
      type: "command",
      command: "node",
      args: ["-v"]
    } as unknown as import("../schema.ts").ExecPayload;
    
    const { envOverrides } = buildCommand(payload, process.cwd());
    
    expect(envOverrides["GIT_TERMINAL_PROMPT"]).toBe("0");
    expect(envOverrides["CI"]).toBe("1");
    expect(envOverrides["PAGER"]).toBe("");
  });
});

describe("Execution Heuristics", () => {
  let originalExit: typeof process.exit;
  let originalConsoleError: typeof console.error;
  let exitMock: ReturnType<typeof mock>;
  const errorOutputs: string[] = [];

  beforeAll(() => {
    originalExit = process.exit;
    originalConsoleError = console.error;
    exitMock = mock((_code?: number | string | null | undefined) => {
      // safely do nothing to prevent test runner from exiting
      return undefined as never;
    });
    process.exit = exitMock as unknown as typeof process.exit;
    console.error = (...args: unknown[]) => {
      errorOutputs.push(args.map(String).join(" "));
    };
  });

  afterAll(() => {
    process.exit = originalExit;
    console.error = originalConsoleError;
  });

  test("Missing global binary triggers ENOENT heuristic", async () => {
    errorOutputs.length = 0;
    exitMock.mockClear();

    const payload = {
      type: "command",
      command: "nonexistent-command-12345",
      args: []
    } as unknown as import("../schema.ts").ExecPayload;

    executeCommand(payload, process.cwd(), (payload as { command: string, args: string[] }).command, (payload as { command: string, args: string[] }).args, process.env as Record<string, string | undefined>);

    // Give some time for child process spawn to fail
    await new Promise(resolve => setTimeout(resolve, 300));

    expect(exitMock).toHaveBeenCalledWith(1);
    const allErrors = errorOutputs.join("\n");
    expect(allErrors).toContain("was not found in PATH or working directory.");
  });
  
  test("Missing PowerShell cmdlet executed directly triggers hint", async () => {
    errorOutputs.length = 0;
    exitMock.mockClear();

    const payload = {
      type: "command",
      command: "Get-Item",
      args: []
    } as unknown as import("../schema.ts").ExecPayload;

    executeCommand(payload, process.cwd(), (payload as { command: string, args: string[] }).command, (payload as { command: string, args: string[] }).args, process.env as Record<string, string | undefined>);

    await new Promise(resolve => setTimeout(resolve, 300));

    expect(exitMock).toHaveBeenCalledWith(1);
    const allErrors = errorOutputs.join("\n");
    expect(allErrors).toContain("appears to be a PowerShell cmdlet");
  });
  
  test("Command with spaces executed directly triggers hint", async () => {
    errorOutputs.length = 0;
    exitMock.mockClear();

    const payload = {
      type: "command",
      command: "npm install",
      args: []
    } as unknown as import("../schema.ts").ExecPayload;

    executeCommand(payload, process.cwd(), (payload as { command: string, args: string[] }).command, (payload as { command: string, args: string[] }).args, process.env as Record<string, string | undefined>);

    await new Promise(resolve => setTimeout(resolve, 300));

    expect(exitMock).toHaveBeenCalledWith(1);
    const allErrors = errorOutputs.join("\n");
    expect(allErrors).toContain("Your command contains spaces.");
  });

  test("Built-in cmd executed directly triggers hint", async () => {
    errorOutputs.length = 0;
    exitMock.mockClear();

    const payload = {
      type: "command",
      command: "copy", // copy doesn't exist as an executable
      args: []
    } as unknown as import("../schema.ts").ExecPayload;

    // Direct to execution-engine to test ENOENT heuristic
    executeCommand(payload, process.cwd(), (payload as { command: string, args: string[] }).command, (payload as { command: string, args: string[] }).args, process.env as Record<string, string | undefined>);

    await new Promise(resolve => setTimeout(resolve, 300));

    expect(exitMock).toHaveBeenCalledWith(1);
    const allErrors = errorOutputs.join("\n");
    expect(allErrors).toContain("is a shell built-in, not an executable file.");
  });
});


