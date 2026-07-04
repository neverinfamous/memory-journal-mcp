import { describe, test, expect, beforeAll, afterAll, spyOn } from 'bun:test';
import { buildCommand } from "C:/Users/chris/Desktop/adamic/.agents/scripts/lib-agent-exec/command-builder.ts";
import { ProcessController } from "C:/Users/chris/Desktop/adamic/.agents/scripts/lib-agent-exec/process-controller.ts";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

describe("Zombie & Process Lifecycle Tests", () => {
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

  describe("Blocking Commands Interception", () => {
    test("tail -f is intercepted", () => {
      expect(() => {
        buildCommand({
          type: "command",
          command: "tail",
          args: ["-f", "some-file.log"]
        }, process.cwd());
      }).toThrow("process.exit called with code: 1");
    });
    
    test("python without args (REPL) is intercepted", () => {
      expect(() => {
        buildCommand({
          type: "command",
          command: "python",
          args: []
        }, process.cwd());
      }).toThrow("process.exit called with code: 1");
    });

    test("bash without args (REPL) is intercepted", () => {
      expect(() => {
        buildCommand({
          type: "command",
          command: "bash",
          args: []
        }, process.cwd());
      }).toThrow("process.exit called with code: 1");
    });

    test("docker logs -f is intercepted by stripping -f", () => {
      const { args } = buildCommand({
        type: "command",
        command: "docker",
        args: ["logs", "-f", "container_name"]
      }, process.cwd());
      expect(args).not.toContain("-f");
      expect(args).toContain("container_name");
      expect(args).toContain("logs");
    });
  });
  
  describe("Deep Process Tree & Process Controller Lifecycle", () => {
    test("ProcessController handles deep process tree timeout gracefully", async () => {
      const uniqueId = crypto.randomUUID();
      const scratchDir = "C:/Users/chris/.gemini/antigravity/brain/83fa8979-0fa6-46bf-b746-bfbb06235a5b/scratch";
      const scriptPath = path.join(scratchDir, `deep-tree-${uniqueId}.ts`);
      
      const scriptCode = `
import { spawn } from 'node:child_process';
const child = spawn('node', ['-e', 'setTimeout(() => {}, 1000000);'], { detached: false, stdio: 'ignore' });
child.unref();
setTimeout(() => console.log("parent still alive"), 1000000);
      `;
      if (!fs.existsSync(scratchDir)) fs.mkdirSync(scratchDir, { recursive: true });
      fs.writeFileSync(scriptPath, scriptCode);

      const payload = {
        type: "script",
        scriptPath,
        timeoutMs: 100 // Short timeout
      };

      const controller = new ProcessController(
        payload as unknown as never,
        scratchDir,
        "bun",
        [scriptPath],
        process.env as Record<string, string>,
        null
      );
      
      const p = new Promise<void>((resolve, reject) => {
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
      
      await p;
      expect(true).toBe(true);
      
      if (fs.existsSync(scriptPath)) {
        if (fs.existsSync(scriptPath)) fs.unlinkSync(scriptPath);
      }
    });
  });
});


