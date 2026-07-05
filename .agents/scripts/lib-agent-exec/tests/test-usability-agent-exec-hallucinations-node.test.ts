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

test("systemInterceptor - blocks node -e execution natively", () => {
  const exitSpy = setupExitSpy();
  const consoleSpy = spyOn(console, "error").mockImplementation(() => {});
  const args = ["-e", "console.log('test')"];
  const context = {
    cmdBasename: "node",
    args,
    envOverrides: {},
    payload: { type: "command", command: "node", args } as unknown as ExecPayload,
  };

  try {
    expect(() => systemInterceptor(context)).toThrow("process.exit");
    expect(exitSpy.getExitCode()).toBe(1);
    
    const calls = consoleSpy.mock.calls.map(call => call.join(' ')).join('\n');
    expect(calls).toContain("You attempted to run node with an inline script");
  } finally {
    exitSpy.restore();
    consoleSpy.mockRestore();
  }
});

test("systemInterceptor - blocks node -p execution natively", () => {
  const exitSpy = setupExitSpy();
  const consoleSpy = spyOn(console, "error").mockImplementation(() => {});
  const args = ["-p", "console.log('test')"];
  const context = {
    cmdBasename: "node",
    args,
    envOverrides: {},
    payload: { type: "command", command: "node", args } as unknown as ExecPayload,
  };

  try {
    expect(() => systemInterceptor(context)).toThrow("process.exit");
    expect(exitSpy.getExitCode()).toBe(1);
    
    const calls = consoleSpy.mock.calls.map(call => call.join(' ')).join('\n');
    expect(calls).toContain("You attempted to run node with an inline script");
  } finally {
    exitSpy.restore();
    consoleSpy.mockRestore();
  }
});

test("systemInterceptor - blocks python -c execution natively", () => {
  const exitSpy = setupExitSpy();
  const consoleSpy = spyOn(console, "error").mockImplementation(() => {});
  const args = ["-c", "print('test')"];
  const context = {
    cmdBasename: "python",
    args,
    envOverrides: {},
    payload: { type: "command", command: "python", args } as unknown as ExecPayload,
  };

  try {
    expect(() => systemInterceptor(context)).toThrow("process.exit");
    expect(exitSpy.getExitCode()).toBe(1);
    
    const calls = consoleSpy.mock.calls.map(call => call.join(' ')).join('\n');
    expect(calls).toContain("You attempted to run python with an inline script");
  } finally {
    exitSpy.restore();
    consoleSpy.mockRestore();
  }
});
