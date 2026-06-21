import { expect, test, describe, afterEach, beforeAll } from "bun:test";
import { buildCommand } from "C:/Users/chris/Desktop/adamic/.agents/scripts/lib-agent-exec/command-builder.ts";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

const originalExit = process.exit;
let dummyScript: string;

describe("WSL2 Integration Tests", () => {
  beforeAll(() => {
    dummyScript = path.join(os.tmpdir(), 'dummy.sh');
    fs.writeFileSync(dummyScript, "echo 'test'");
  });

  afterEach(() => {
    process.exit = originalExit;
  });

  test("eval payload with target wsl2 converts cwd and args to /mnt/c/", () => {
    const payload = {
      type: "eval" as const,
      code: "print('hello')",
      interpreter: "python",
      args: ["C:\\test\\data.txt", "C:\\Program Files\\data.txt"],
      target: "wsl2" as const,
      env: {
        TEST_PATH: "C:\\my\\env\\path",
        TEST_SPACE: "C:\\Program Files\\test"
      }
    };

    const cwd = "C:\\Users\\chris\\Desktop\\adamic";
    const result = buildCommand(payload, cwd);

    expect(result.cmd).toBe("wsl.exe");
    expect(result.args[0]).toBe("--cd");
    expect(result.args[1]).toBe("/mnt/c/Users/chris/Desktop/adamic");
    expect(result.args[2]).toBe("-e");
    expect(result.args[3]).toBe("env");
    
    // Convert logic checks
    // We expect "TEST_PATH=/mnt/c/my/env/path"
    
    // Check python -> python3 conversion
    expect(result.args).toContain("python3");
    
    // Check paths without spaces
    expect(result.args).toContain("/mnt/c/test/data.txt");
    
    // Let's see how paths with spaces are handled in env
    expect(result.args).toContain("TEST_SPACE=/mnt/c/Program Files/test");
    
    // Let's see how paths with spaces are handled in args
    expect(result.args).toContain("/mnt/c/Program Files/data.txt");
  });

  test("script payload with target wsl2 converts paths", () => {
    const payload = {
      type: "script" as const,
      scriptPath: dummyScript,
      target: "wsl2" as const,
      args: ["C:\\arg\\file.txt"]
    };

    const cwd = "C:\\projects\\test";
    const result = buildCommand(payload, cwd);

    expect(result.cmd).toBe("wsl.exe");
    expect(result.args[0]).toBe("--cd");
    expect(result.args[1]).toBe("/mnt/c/projects/test");
    expect(result.args).toContain("/mnt/c/arg/file.txt");
  });

  test("command payload blocks built-in shells on target wsl2", () => {
    let exitCode: number | undefined;
    process.exit = ((code?: number) => {
      exitCode = code;
      throw new Error("process.exit mocked");
    }) as unknown as typeof process.exit;

    const payload = {
      type: "command" as const,
      command: "echo",
      args: ["hello"],
      target: "wsl2" as const
    };

    try {
      buildCommand(payload, "C:\\");
    } catch (e: unknown) {
      if (e instanceof Error && e.message !== "process.exit mocked") throw e;
    }
    expect(exitCode).toBe(1);
  });
});
