import { test, expect, spyOn, afterEach, beforeAll, afterAll } from 'bun:test';
import { ProcessController } from "C:/Users/chris/Desktop/adamic/.agents/scripts/lib-agent-exec/process-controller.ts";
import { buildCommand } from "C:/Users/chris/Desktop/adamic/.agents/scripts/lib-agent-exec/command-builder.ts";

let exitSpy: import("bun:test").Mock<typeof process.exit>;
let errorSpy: import("bun:test").Mock<typeof console.error>;
let consoleOutput = "";

beforeAll(() => {
    exitSpy = spyOn(process, "exit").mockImplementation((_code) => {
        return undefined as never;
    });
    errorSpy = spyOn(console, "error").mockImplementation((msg) => {
        consoleOutput += msg + "\n";
    });
});

afterEach(() => {
    consoleOutput = "";
    exitSpy.mockClear();
    errorSpy.mockClear();
});

afterAll(() => {
    exitSpy.mockRestore();
    errorSpy.mockRestore();
});

const EXPECTED_AUTONOMOUS_HEALING_TEXT = `\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: DO NOT ask the user for help. You MUST autonomously invoke the correct native tool or fix the command parameters yourself.\x1b[0m`;

test("Auto-Healing Diagnostic Specialist - ProcessController MAX_PATH", async () => {
    const longPath = "C:\\" + "a".repeat(260);
    const controller = new ProcessController(
        { type: "command", command: "test-cmd", args: [] },
        longPath,
        "test-cmd",
        [],
        {},
        null
    );

    // Mock IOController
    (controller as unknown as { ioController: unknown }).ioController = {
        closeFileStreams: async () => {},
        flushAll: () => {},
        destroyStreams: () => {}
    };

    const err = new Error("ENOENT") as NodeJS.ErrnoException;
    err.code = "ENOENT";

    // Trigger error handler
    (controller as unknown as { onChildError: (err: Error) => void }).onChildError(err);
    await new Promise(resolve => setTimeout(resolve, 10));

    expect(consoleOutput).toContain("💡 AGENT HINT: Your working directory path exceeds the Windows MAX_PATH limit");
    expect(consoleOutput).toContain(EXPECTED_AUTONOMOUS_HEALING_TEXT);
});

test("Auto-Healing Diagnostic Specialist - ProcessController shell built-in (echo)", async () => {
    const controller = new ProcessController(
        { type: "command", command: "echo", args: [] },
        "C:\\",
        "echo",
        [],
        {},
        null
    );

    (controller as unknown as { ioController: unknown }).ioController = {
        closeFileStreams: async () => {},
        flushAll: () => {},
        destroyStreams: () => {}
    };

    const err = new Error("ENOENT") as NodeJS.ErrnoException;
    err.code = "ENOENT";

    (controller as unknown as { onChildError: (err: Error) => void }).onChildError(err);
    await new Promise(resolve => setTimeout(resolve, 10));

    expect(consoleOutput).toContain("💡 AGENT HINT: 'echo' is a shell built-in, not an executable file");
    expect(consoleOutput).toContain(EXPECTED_AUTONOMOUS_HEALING_TEXT);
});

test("Auto-Healing Diagnostic Specialist - CommandBuilder shell built-in interception", async () => {
    const payload = { type: "command" as const, command: "echo", args: [] };
    const result = buildCommand(payload, "C:\\");

    // Check if the builder correctly issued the healing hint and auto-routed
    expect(consoleOutput).toContain("💡 AGENT HINT: 'echo' is a shell built-in");
    
    // Check if the payload was modified
    expect(result.cmd.endsWith("pwsh.exe")).toBe(true);
    expect(result.args).toContain("-EncodedCommand");
});


