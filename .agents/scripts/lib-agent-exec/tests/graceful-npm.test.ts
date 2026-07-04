import { expect, test, describe } from "bun:test";
import { ProcessController } from "../process-controller.js";
import { ExecPayload } from "../schema.js";

describe("Graceful Exits for Package Managers", () => {
  test("ProcessController treats npm outdated exit code 1 as a graceful exit", async () => {
    const payload: ExecPayload = {
      type: "command",
      command: "npm",
      args: ["outdated"],
      cwd: process.cwd()
    };
    
    let exitCode: number = -1;
    const originalExit = process.exit;
    const originalError = console.error;
    let loggedError = "";
    
    try {
      process.exit = ((code: number) => {
        if (exitCode === -1) exitCode = code;
        throw new Error("Process exited");
      }) as unknown as typeof process.exit;
      
      console.error = (msg: string) => {
        loggedError += msg + "\n";
      };

      const controller = new ProcessController(payload, process.cwd(), "npm.cmd", ["outdated"], {}, null);
      
      try {
        await (controller as unknown as { handleFinish: (c: number, s: NodeJS.Signals | null, f: boolean) => Promise<void> }).handleFinish(1, null, false);
      } catch (e: unknown) {
        if (e instanceof Error && e.message !== "Process exited") throw e;
      }
      
      await new Promise(resolve => setTimeout(resolve, 50));
      
      expect(exitCode).toBe(0);
      expect(loggedError).toContain("Outdated packages found");
    } finally {
      process.exit = originalExit;
      console.error = originalError;
    }
  });

  test("ProcessController treats npm -g outdated exit code 1 as a graceful exit", async () => {
    const payload: ExecPayload = {
      type: "command",
      command: "npm",
      args: ["-g", "outdated"],
      cwd: process.cwd()
    };
    
    let exitCode: number = -1;
    const originalExit = process.exit;
    const originalError = console.error;
    let loggedError = "";
    
    try {
      process.exit = ((code: number) => {
        if (exitCode === -1) exitCode = code;
        throw new Error("Process exited");
      }) as unknown as typeof process.exit;
      
      console.error = (msg: string) => {
        loggedError += msg + "\n";
      };

      const controller = new ProcessController(payload, process.cwd(), "npm.cmd", ["-g", "outdated"], {}, null);
      
      try {
        await (controller as unknown as { handleFinish: (c: number, s: NodeJS.Signals | null, f: boolean) => Promise<void> }).handleFinish(1, null, false);
      } catch (e: unknown) {
        if (e instanceof Error && e.message !== "Process exited") throw e;
      }
      
      await new Promise(resolve => setTimeout(resolve, 50));
      
      expect(exitCode).toBe(0);
      expect(loggedError).toContain("Outdated packages found");
    } finally {
      process.exit = originalExit;
      console.error = originalError;
    }
  });

  test("ProcessController treats npm outdated via pwsh exit code 1 as a graceful exit", async () => {
    const payload: ExecPayload = {
      type: "command",
      command: "pwsh",
      args: ["-c", "npm outdated"],
      cwd: process.cwd()
    };
    
    let exitCode: number = -1;
    const originalExit = process.exit;
    const originalError = console.error;
    let loggedError = "";
    
    try {
      process.exit = ((code: number) => {
        if (exitCode === -1) exitCode = code;
        throw new Error("Process exited");
      }) as unknown as typeof process.exit;
      
      console.error = (msg: string) => {
        loggedError += msg + "\n";
      };

      const controller = new ProcessController(payload, process.cwd(), "pwsh.exe", ["-c", "npm outdated"], {}, null);
      
      try {
        await (controller as unknown as { handleFinish: (c: number, s: NodeJS.Signals | null, f: boolean) => Promise<void> }).handleFinish(1, null, false);
      } catch (e: unknown) {
        if (e instanceof Error && e.message !== "Process exited") throw e;
      }
      
      await new Promise(resolve => setTimeout(resolve, 50));
      
      expect(exitCode).toBe(0);
      expect(loggedError).toContain("Outdated packages found");
    } finally {
      process.exit = originalExit;
      console.error = originalError;
    }
  });

  test("ProcessController treats npm install exit code 1 as an error", async () => {
    const payload: ExecPayload = {
      type: "command",
      command: "npm",
      args: ["install", "NON_EXISTENT"],
      cwd: process.cwd()
    };
    
    let exitCode: number = -1;
    const originalExit = process.exit;
    const originalError = console.error;
    
    try {
      process.exit = ((code: number) => {
        if (exitCode === -1) exitCode = code;
        throw new Error("Process exited");
      }) as unknown as typeof process.exit;
      
      console.error = () => {};

      const controller = new ProcessController(payload, process.cwd(), "npm.cmd", ["install", "NON_EXISTENT"], {}, null);
      
      try {
        await (controller as unknown as { handleFinish: (c: number, s: NodeJS.Signals | null, f: boolean) => Promise<void> }).handleFinish(1, null, false);
      } catch (e: unknown) {
        if (e instanceof Error && e.message !== "Process exited") throw e;
      }
      
      await new Promise(resolve => setTimeout(resolve, 50));
      
      expect(exitCode).toBe(1);
    } finally {
      process.exit = originalExit;
      console.error = originalError;
    }
  });

  test("ProcessController treats pnpm add outdated exit code 1 as an error (not gracefully swallowed)", async () => {
    const payload: ExecPayload = {
      type: "command",
      command: "pnpm",
      args: ["add", "outdated"],
      cwd: process.cwd()
    };
    
    let exitCode: number = -1;
    const originalExit = process.exit;
    const originalError = console.error;
    
    try {
      process.exit = ((code: number) => {
        if (exitCode === -1) exitCode = code;
        throw new Error("Process exited");
      }) as unknown as typeof process.exit;
      
      console.error = () => {};

      const controller = new ProcessController(payload, process.cwd(), "pnpm.cmd", ["add", "outdated"], {}, null);
      
      try {
        await (controller as unknown as { handleFinish: (c: number, s: NodeJS.Signals | null, f: boolean) => Promise<void> }).handleFinish(1, null, false);
      } catch (e: unknown) {
        if (e instanceof Error && e.message !== "Process exited") throw e;
      }
      
      await new Promise(resolve => setTimeout(resolve, 50));
      
      expect(exitCode).toBe(1);
    } finally {
      process.exit = originalExit;
      console.error = originalError;
    }
  });
});
