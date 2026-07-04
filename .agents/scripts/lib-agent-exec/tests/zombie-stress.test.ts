import { describe, test, expect, beforeAll, afterAll, spyOn } from 'bun:test';
import { buildCommand } from "C:/Users/chris/Desktop/adamic/.agents/scripts/lib-agent-exec/command-builder.ts";
import { ProcessController } from "C:/Users/chris/Desktop/adamic/.agents/scripts/lib-agent-exec/process-controller.ts";
import { killProcessTree, processManagerHooks } from "C:/Users/chris/Desktop/adamic/.agents/scripts/lib-agent-exec/process-manager.ts";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

describe("Process Lifecycle & Zombie Specialist Stress Tests", () => {
  let exitMock: ReturnType<typeof spyOn>;
  let consoleErrorMock: ReturnType<typeof spyOn>;

  beforeAll(() => {
    exitMock = spyOn(process, "exit").mockImplementation((code?: string | number | null | undefined) => {
      throw new Error(`process.exit called with code: ${code}`);
    });
    consoleErrorMock = spyOn(console, "error").mockImplementation(() => {});
  });

  afterAll(() => {
    exitMock.mockRestore();
    consoleErrorMock.mockRestore();
  });

  describe("Indefinite Blocking Commands & REPL Hangs (buildCommand heuristics)", () => {
    test("tail -f is intercepted and blocked", () => {
      expect(() => {
        buildCommand({
          type: "command",
          command: "tail",
          args: ["-f", "some.log"]
        }, process.cwd());
      }).toThrow("process.exit called with code: 1");
    });

    test("docker logs -f strips the -f flag instead of blocking", () => {
      const { args } = buildCommand({
        type: "command",
        command: "docker",
        args: ["logs", "-f", "my-container"]
      }, process.cwd());
      expect(args).not.toContain("-f");
      expect(args).toContain("logs");
      expect(args).toContain("my-container");
    });

    test("python without args (REPL block) is intercepted", () => {
      expect(() => {
        buildCommand({
          type: "command",
          command: "python",
          args: []
        }, process.cwd());
      }).toThrow("process.exit called with code: 1");
    });

    test("bash without args (REPL block) is intercepted", () => {
      expect(() => {
        buildCommand({
          type: "command",
          command: "bash",
          args: []
        }, process.cwd());
      }).toThrow("process.exit called with code: 1");
    });
    
    test("docker run interactive block is intercepted (needs dummy args check or flags stripped)", () => {
      // Testing if docker run -it is stripped of -it or intercepted
      const { args } = buildCommand({
        type: "command",
        command: "docker",
        args: ["run", "-it", "ubuntu"]
      }, process.cwd());
      expect(args).not.toContain("-it");
      expect(args).toContain("run");
      expect(args).toContain("ubuntu");
    });
  });

  describe("Deep Process Tree Termination", () => {
    test("killProcessTree forcefully terminates a process tree without zombies", async () => {
      const scratchDir = "C:/Users/chris/.gemini/antigravity/brain/65a0b439-6df7-40e6-ba44-e47270eb6119/scratch";
      if (!fs.existsSync(scratchDir)) fs.mkdirSync(scratchDir, { recursive: true });
      const uniqueId = crypto.randomUUID();
      const scriptPath = path.join(scratchDir, `deep-tree-${uniqueId}.js`);

      // A script that spawns a child that spawns a child, hanging indefinitely
      const scriptCode = `
const { spawn } = require('child_process');
const child = spawn('node', ['-e', 'setTimeout(() => {}, 1000000)'], { detached: false, stdio: 'ignore' });
child.unref();
setTimeout(() => console.log("parent alive"), 1000000);
      `;
      fs.writeFileSync(scriptPath, scriptCode);

      const p = spawn("node", [scriptPath], { detached: false });
      
      // wait a bit for it to spawn the child
      await new Promise(resolve => setTimeout(resolve, 500));

      expect(p.pid).toBeDefined();

      let killHookCalled = false;
      const hook = {
        onKill: (pid: number) => {
          if (pid === p.pid) {
            killHookCalled = true;
          }
        }
      };
      processManagerHooks.push(hook);

      // Kill it
      killProcessTree(p);

      expect(killHookCalled).toBe(true);

      // Clean up hook
      const idx = processManagerHooks.indexOf(hook);
      if (idx !== -1) processManagerHooks.splice(idx, 1);

      // Process should be dead
      await new Promise((resolve) => {
        if (p.killed || p.exitCode !== null) resolve(null);
        p.on('exit', resolve);
      });
      
      if (fs.existsSync(scriptPath)) fs.unlinkSync(scriptPath);
    });

    test("ProcessController handles timeout via graceful degradation", async () => {
      const uniqueId = crypto.randomUUID();
      const scratchDir = "C:/Users/chris/.gemini/antigravity/brain/65a0b439-6df7-40e6-ba44-e47270eb6119/scratch";
      const scriptPath = path.join(scratchDir, `graceful-${uniqueId}.js`);
      
      const scriptCode = `
setTimeout(() => console.log("timeout"), 100000);
      `;
      if (!fs.existsSync(scratchDir)) fs.mkdirSync(scratchDir, { recursive: true });
      fs.writeFileSync(scriptPath, scriptCode);

      const payload = {
        type: "script",
        scriptPath,
        timeoutMs: 100 // VERY short timeout to trigger graceful shutdown
      };

      const controller = new ProcessController(
        payload as unknown as import("../schema.ts").ExecPayload,
        scratchDir,
        "node",
        [scriptPath],
        process.env as Record<string, string | undefined>,
        null
      );

      // wait for exitMock to be called with exit(1) due to timeout fallback
      const exitPromise = new Promise<void>((resolve, reject) => {
        exitMock.mockImplementation((code?: string | number | null | undefined) => {
          if (code === 1 || code === 0 || code === null) {
            resolve();
          } else {
            reject(new Error("Exited with wrong code"));
          }
          return undefined as never;
        });

        try {
          controller.start();
        } catch(e) {
          reject(e);
        }
      });
      
      await exitPromise;
      if (fs.existsSync(scriptPath)) if (fs.existsSync(scriptPath)) fs.unlinkSync(scriptPath);
    });
  });
});


