import { test, expect, spyOn } from 'bun:test';
import type { ExecPayload } from "../schema.js";
import { systemInterceptor } from "../interceptors/system-interceptor.js";

function setupExitSpy() {
  let exitCode: number | undefined;
  const spy = spyOn(process, "exit").mockImplementation((code?: number | string | null) => {
    exitCode = typeof code === "number" ? code : undefined;
    throw new Error(`process.exit called with code ${code}`);
  });
  return {
    spy,
    getExitCode: () => exitCode,
    restore: () => spy.mockRestore()
  };
}

test("systemInterceptor - cat file.txt as raw command payload throws anti-hallucination error", () => {
  const exitSpy = setupExitSpy();
  const consoleSpy = spyOn(console, "error").mockImplementation(() => {});
  const envOverrides: Record<string, string> = {};
  const args: string[] = [];
  const context = {
    cmdBasename: "cat file.txt",
    args,
    envOverrides,
    payload: { type: "command", command: "cat", args } as unknown as ExecPayload,
    hasStdin: false,
  };

  try {
    expect(() => systemInterceptor(context)).toThrow("process.exit");
    expect(exitSpy.getExitCode()).toBe(1);
    
    // Ensure the console.error was called with the specific hint
    const calls = consoleSpy.mock.calls.map(call => call.join(' ')).join('\n');
    expect(calls).toContain("Do NOT use 'cat', 'cat.exe', or 'get-content' natively.");
    expect(calls).toContain("You MUST use the agent-native 'view_file' tool instead.");
  } finally {
    exitSpy.restore();
    consoleSpy.mockRestore();
  }
});


