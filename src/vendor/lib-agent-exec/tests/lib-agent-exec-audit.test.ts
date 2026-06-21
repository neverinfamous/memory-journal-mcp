import { describe, test, expect, spyOn, beforeEach, afterEach } from "bun:test";
import { killProcessTree } from "../process-manager.js";
import { dockerInterceptor } from "../interceptors/docker-interceptor.js";
import { replTuiInterceptor } from "../interceptors/repl-tui-interceptor.js";
import * as child_process from "node:child_process";
import fs from "node:fs";
import path from "node:path";

describe("lib-agent-exec robustness audit", () => {
  let processExitSpy: ReturnType<typeof spyOn>;
  let spawnSyncSpy: ReturnType<typeof spyOn>;
  let processKillSpy: ReturnType<typeof spyOn>;
  let consoleErrorSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    // Safely spy on process.exit so it doesn't kill the bun runner
    processExitSpy = spyOn(process, "exit").mockImplementation((code) => {
      throw new Error(`MOCKED_PROCESS_EXIT:${code}`);
    });
    // Silence console.error for clean test output
    consoleErrorSpy = spyOn(console, "error").mockImplementation(() => true);
  });

  afterEach(() => {
    processExitSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    if (spawnSyncSpy) spawnSyncSpy.mockRestore();
    if (processKillSpy) processKillSpy.mockRestore();
  });

  describe("Deep Process Tree Termination (process-manager.ts)", () => {
    beforeEach(() => {
      spawnSyncSpy = spyOn(child_process, "spawnSync");
      processKillSpy = spyOn(process, "kill").mockImplementation(() => true);
    });

    test("kills process using taskkill when platform is win32", () => {
      const mockChild = { pid: 1234, exitCode: null, signalCode: null, killed: false, kill: () => true } as unknown as child_process.ChildProcess;
      spyOn(mockChild, "kill").mockImplementation(() => true);
      
      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: 'win32' });
      
      try {
        spawnSyncSpy.mockReturnValue({ error: null, status: 0 });
        killProcessTree(mockChild);
        
        expect(spawnSyncSpy).toHaveBeenCalled();
        const args = spawnSyncSpy.mock.calls[0];
        expect(args[0]).toBe("taskkill.exe");
        expect(args[1]).toContain("1234");
      } finally {
        Object.defineProperty(process, 'platform', { value: originalPlatform });
      }
    });

    test("uses SIGTERM graceful degradation followed by SIGKILL on Unix", async () => {
      const mockChild = { pid: 1234, exitCode: null, signalCode: null, killed: false, kill: () => true } as unknown as child_process.ChildProcess;
      spyOn(mockChild, "kill").mockImplementation(() => true);
      
      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: 'linux' });
      
      try {
        killProcessTree(mockChild);
        expect(processKillSpy).toHaveBeenCalledWith(-1234, "SIGTERM");
        
        // Let the 50ms fallback timeout resolve
        await new Promise(resolve => setTimeout(resolve, 100));
        expect(processKillSpy).toHaveBeenCalledWith(-1234, "SIGKILL");
      } finally {
        Object.defineProperty(process, 'platform', { value: originalPlatform });
      }
    });
  });

  describe("Interceptors - Interactive REPL & Blocking Commands", () => {
    test("replTuiInterceptor hangs Python without args", () => {
      const ctx = { cmdBasename: "python", args: [], envOverrides: {}, payload: { type: "command" } as unknown as import("../schema.js").ExecPayload };
      expect(() => replTuiInterceptor(ctx)).toThrow("MOCKED_PROCESS_EXIT:1");
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    test("replTuiInterceptor hangs Bash without args", () => {
      const ctx = { cmdBasename: "bash", args: [], envOverrides: {}, payload: { type: "command" } as unknown as import("../schema.js").ExecPayload };
      expect(() => replTuiInterceptor(ctx)).toThrow("MOCKED_PROCESS_EXIT:1");
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    test("replTuiInterceptor allows Bash with valid trailing args", () => {
      const ctx = { cmdBasename: "bash", args: ["-c", "echo hello"], envOverrides: {}, payload: { type: "command" } as unknown as import("../schema.js").ExecPayload };
      expect(() => replTuiInterceptor(ctx)).not.toThrow();
      expect(processExitSpy).not.toHaveBeenCalled();
    });

    test("dockerInterceptor strips -f from docker logs instead of crashing", () => {
      const ctx = { cmdBasename: "docker", args: ["logs", "-f", "container"], envOverrides: {}, payload: { type: "command" } as unknown as import("../schema.js").ExecPayload };
      expect(() => dockerInterceptor(ctx)).not.toThrow();
      expect(ctx.args).toEqual(["logs", "container"]); // auto-healed
    });
  });

  describe("agent-exec.ts End-to-End Sim", () => {
    test("CLI terminates indefinite command via timeout", () => {
      const payloadPath = path.join(process.cwd(), "test-payload-tail.json");
      fs.writeFileSync(payloadPath, JSON.stringify({
        type: "command", command: "node", args: ["-e", "setTimeout(function(){}, 10000)"], timeoutMs: 100
      }));

      const start = Date.now();
      const res = child_process.spawnSync("bun", [
        "C:/Users/chris/Desktop/adamic/.agents/scripts/agent-exec.js", payloadPath
      ], { encoding: "utf8" });
      const duration = Date.now() - start;

      if (fs.existsSync(payloadPath)) fs.unlinkSync(payloadPath);

      expect(res.status).not.toBe(0);
      expect(res.stderr).toContain("Execution timed out");
      expect(duration).toBeLessThan(4000);
    });
  });
});
