import { test, expect, spyOn } from 'bun:test';
import type { ExecPayload } from "../schema.js";
import { cloudCliInterceptor } from "../interceptors/cloud-cli-interceptor.js";

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

test("cloudCliInterceptor - gh pr status throws if no --json", () => {
  const exitSpy = setupExitSpy();
  const envOverrides: Record<string, string> = {};
  const args = ["pr", "status"];
  const context = {
    cmdBasename: "gh",
    args,
    envOverrides,
    payload: { type: "command", command: "gh", args } as unknown as ExecPayload,
  };

  try {
    expect(() => cloudCliInterceptor(context)).toThrow("process.exit");
    expect(exitSpy.getExitCode()).toBe(1);
  } finally {
    exitSpy.restore();
  }
});

test("cloudCliInterceptor - gh issue list throws if no --json", () => {
  const exitSpy = setupExitSpy();
  const envOverrides: Record<string, string> = {};
  const args = ["issue", "list"];
  const context = {
    cmdBasename: "gh",
    args,
    envOverrides,
    payload: { type: "command", command: "gh", args } as unknown as ExecPayload,
  };

  try {
    expect(() => cloudCliInterceptor(context)).toThrow("process.exit");
    expect(exitSpy.getExitCode()).toBe(1);
  } finally {
    exitSpy.restore();
  }
});

test("cloudCliInterceptor - gh search issues throws if no --json", () => {
  const exitSpy = setupExitSpy();
  const envOverrides: Record<string, string> = {};
  const args = ["search", "issues", "bug"];
  const context = {
    cmdBasename: "gh",
    args,
    envOverrides,
    payload: { type: "command", command: "gh", args } as unknown as ExecPayload,
  };

  try {
    expect(() => cloudCliInterceptor(context)).toThrow("process.exit");
    expect(exitSpy.getExitCode()).toBe(1);
  } finally {
    exitSpy.restore();
  }
});

test("cloudCliInterceptor - gh pr create throws if only --title provided", () => {
  const exitSpy = setupExitSpy();
  const envOverrides: Record<string, string> = {};
  const args = ["pr", "create", "--title", "test"];
  const context = {
    cmdBasename: "gh",
    args,
    envOverrides,
    payload: { type: "command", command: "gh", args } as unknown as ExecPayload,
  };

  try {
    expect(() => cloudCliInterceptor(context)).toThrow("process.exit");
    expect(exitSpy.getExitCode()).toBe(1);
  } finally {
    exitSpy.restore();
  }
});

test("cloudCliInterceptor - gh issue create throws if only --title provided", () => {
  const exitSpy = setupExitSpy();
  const envOverrides: Record<string, string> = {};
  const args = ["issue", "create", "--title", "test"];
  const context = {
    cmdBasename: "gh",
    args,
    envOverrides,
    payload: { type: "command", command: "gh", args } as unknown as ExecPayload,
  };

  try {
    expect(() => cloudCliInterceptor(context)).toThrow("process.exit");
    expect(exitSpy.getExitCode()).toBe(1);
  } finally {
    exitSpy.restore();
  }
});

test("cloudCliInterceptor - gh run view --log throws and recommends schedule", () => {
  const exitSpy = setupExitSpy();
  const envOverrides: Record<string, string> = {};
  const args = ["run", "view", "--log"];
  const context = {
    cmdBasename: "gh",
    args,
    envOverrides,
    payload: { type: "command", command: "gh", args } as unknown as ExecPayload,
  };

  try {
    expect(() => cloudCliInterceptor(context)).toThrow("process.exit");
    expect(exitSpy.getExitCode()).toBe(1);
  } finally {
    exitSpy.restore();
  }
});
