import { test, expect, spyOn } from 'bun:test';
import type { ExecPayload } from "C:/Users/chris/Desktop/adamic/.agents/scripts/lib-agent-exec/schema.ts";
import { replTuiInterceptor } from "C:/Users/chris/Desktop/adamic/.agents/scripts/lib-agent-exec/interceptors/repl-tui-interceptor.ts";

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

test("replTuiInterceptor - eval payload with node --watch fails properly", () => {
  const exitSpy = setupExitSpy();
  const context = {
    cmdBasename: "pwsh.exe",
    args: [],
    envOverrides: {},
    payload: { type: "eval", interpreter: "pwsh", code: "node --watch app.js" } as unknown as ExecPayload,
  };

  try {
    expect(() => replTuiInterceptor(context)).toThrow("process.exit");
    expect(exitSpy.getExitCode()).toBe(1);
  } finally {
    exitSpy.restore();
  }
});
