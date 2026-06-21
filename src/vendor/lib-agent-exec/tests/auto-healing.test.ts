import { test, expect, spyOn, afterEach, beforeEach } from "bun:test";
import { ProcessController } from "C:/Users/chris/Desktop/adamic/.agents/scripts/lib-agent-exec/process-controller.ts";
import { ExecPayload } from "C:/Users/chris/Desktop/adamic/.agents/scripts/lib-agent-exec/schema.ts";

let consoleErrorSpy: ReturnType<typeof spyOn>;
let processExitSpy: ReturnType<typeof spyOn>;

beforeEach(() => {
  consoleErrorSpy = spyOn(console, "error").mockImplementation(() => {});
  processExitSpy = spyOn(process, "exit").mockImplementation((_code?: string | number | null | undefined) => { return undefined as unknown as never; });
});

afterEach(() => {
  consoleErrorSpy.mockRestore();
  processExitSpy.mockRestore();
});

test("Heuristic: shell built-in rejection (ren) should exit 1 and print hint", async () => {
  const payload: ExecPayload = { type: "command", command: "ren", args: [] };
  const controller = new ProcessController(payload, process.cwd(), "ren", [], {}, null);
  
  // Start the controller. The underlying spawn will throw ENOENT for "ren" since it's a built-in without shell: true
  controller.start();
  
  // Wait for the async error handling
  await new Promise(resolve => setTimeout(resolve, 100));
  
  expect(processExitSpy).toHaveBeenCalledWith(1);
  const output = consoleErrorSpy.mock.calls.map((args: unknown[]) => args.join(" ")).join("\n");
  expect(output).toContain("AGENT HINT: 'ren' is a shell built-in");
  expect(output).toContain("AUTONOMOUS HEALING");
});

test("Heuristic: MAX_PATH limit exceeding should print hint", async () => {
  const longPath = "C:\\" + "a".repeat(300);
  const payload: ExecPayload = { type: "command", command: "testcmd", args: [] };
  
  const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', { value: 'win32' });
  
  const controller = new ProcessController(payload, longPath, "testcmd", [], {}, null);
  controller.start();
  
  await new Promise(resolve => setTimeout(resolve, 100));
  
  if (originalPlatform) {
    Object.defineProperty(process, 'platform', originalPlatform);
  }
  
  expect(processExitSpy).toHaveBeenCalledWith(1);
  const output = consoleErrorSpy.mock.calls.map((args: unknown[]) => args.join(" ")).join("\n");
  expect(output).toContain("AGENT HINT: Your working directory path exceeds the Windows MAX_PATH limit");
  expect(output).toContain("AUTONOMOUS HEALING");
});

test("Heuristic: powershell cmdlet hint", async () => {
  const payload: ExecPayload = { type: "command", command: "Get-Item", args: [] };
  const controller = new ProcessController(payload, process.cwd(), "Get-Item", [], {}, null);
  controller.start();
  
  await new Promise(resolve => setTimeout(resolve, 100));
  
  expect(processExitSpy).toHaveBeenCalledWith(1);
  const output = consoleErrorSpy.mock.calls.map((args: unknown[]) => args.join(" ")).join("\n");
  expect(output).toContain("appears to be a PowerShell cmdlet");
  expect(output).toContain("AUTONOMOUS HEALING");
});

test("Heuristic: command containing spaces", async () => {
  const payload: ExecPayload = { type: "command", command: "npm install", args: [] };
  const controller = new ProcessController(payload, process.cwd(), "npm install", [], {}, null);
  controller.start();
  
  await new Promise(resolve => setTimeout(resolve, 100));
  
  expect(processExitSpy).toHaveBeenCalledWith(1);
  const output = consoleErrorSpy.mock.calls.map((args: unknown[]) => args.join(" ")).join("\n");
  expect(output).toContain("Your command contains spaces");
  expect(output).toContain("AUTONOMOUS HEALING");
});

test("Heuristic: missing shell extension (npm on windows)", async () => {
  const payload: ExecPayload = { type: "command", command: "npm", args: [] };
  const controller = new ProcessController(payload, process.cwd(), "npm", [], {}, null);
  controller.start();
  
  await new Promise(resolve => setTimeout(resolve, 100));
  
  expect(processExitSpy).toHaveBeenCalledWith(1);
  const output = consoleErrorSpy.mock.calls.map((args: unknown[]) => args.join(" ")).join("\n");
  expect(output).toContain("may need to specify the extension");
  expect(output).toContain("AUTONOMOUS HEALING");
});
