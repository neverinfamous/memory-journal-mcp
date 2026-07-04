import { test, expect } from 'bun:test';
import type { ExecPayload } from "../schema.js";
import { systemInterceptor } from "../interceptors/system-interceptor.js";

test("systemInterceptor - allows node -e execution natively", () => {
  const args = ["-e", "console.log('test')"];
  const context = {
    cmdBasename: "node",
    args,
    envOverrides: {},
    payload: { type: "command", command: "node", args } as unknown as ExecPayload,
  };

  expect(() => systemInterceptor(context)).not.toThrow();
});

test("systemInterceptor - allows node -p execution natively", () => {
  const args = ["-p", "console.log('test')"];
  const context = {
    cmdBasename: "node",
    args,
    envOverrides: {},
    payload: { type: "command", command: "node", args } as unknown as ExecPayload,
  };

  expect(() => systemInterceptor(context)).not.toThrow();
});

test("systemInterceptor - allows python -c execution natively", () => {
  const args = ["-c", "print('test')"];
  const context = {
    cmdBasename: "python",
    args,
    envOverrides: {},
    payload: { type: "command", command: "python", args } as unknown as ExecPayload,
  };

  expect(() => systemInterceptor(context)).not.toThrow();
});
