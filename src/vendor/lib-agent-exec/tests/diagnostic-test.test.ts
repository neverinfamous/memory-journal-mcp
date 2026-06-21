import { test, expect, spyOn, afterEach, beforeAll, afterAll } from "bun:test";
import { ProcessController } from "../process-controller.ts";

let exitSpy: import("bun:test").Mock<typeof process.exit>;
let errorSpy: import("bun:test").Mock<typeof console.error>;
let consoleOutput = "";

beforeAll(() => {
    // Mock process.exit safely to prevent test runner from crashing
    exitSpy = spyOn(process, "exit").mockImplementation((_code) => {
        return undefined as never;
    });
    // Intercept console.error to check for hints
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

test("Heuristic: MAX_PATH error hint", async () => {
    const longPath = "C:\\" + "a".repeat(260);
    const controller = new ProcessController(
        { type: "command", command: "test-cmd", args: [] },
        longPath, // cwd > 260 chars
        "test-cmd",
        [],
        {},
        null
    );

    // Mock IOController to prevent errors when closeFileStreams is called
    (controller as unknown as { ioController: unknown }).ioController = {
        closeFileStreams: async () => {},
        flushAll: () => {},
        destroyStreams: () => {}
    };

    const err = new Error("ENOENT") as NodeJS.ErrnoException;
    err.code = "ENOENT";

    // Trigger error handler manually
    (controller as unknown as { onChildError: (err: unknown) => void }).onChildError(err);
    
    // Wait for the async closeFileStreams promise to resolve
    await new Promise(resolve => setTimeout(resolve, 10));

    expect(consoleOutput).toContain("AGENT HINT: Your working directory path exceeds the Windows MAX_PATH limit");
    expect(consoleOutput).toContain("AUTONOMOUS HEALING: If you encounter this hint during an autonomous task, do NOT interrupt your current workflow. Add the issue to your task list");
    expect(exitSpy).toHaveBeenCalledWith(1);
});

test("Heuristic: Shell built-in hint (dir)", async () => {
    const controller = new ProcessController(
        { type: "command", command: "dir", args: [] },
        "C:\\",
        "dir",
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

    (controller as unknown as { onChildError: (err: unknown) => void }).onChildError(err);
    
    await new Promise(resolve => setTimeout(resolve, 10));

    expect(consoleOutput).toContain("AGENT HINT: 'dir' is a shell built-in");
    expect(consoleOutput).toContain("AUTONOMOUS HEALING: If you encounter this hint during an autonomous task");
    expect(exitSpy).toHaveBeenCalledWith(1);
});

test("Heuristic: Missing extension hint (npm)", async () => {
    const controller = new ProcessController(
        { type: "command", command: "npm", args: [] },
        "C:\\",
        "npm",
        [],
        {},
        null
    );

    (controller as unknown as { ioController: unknown }).ioController = {
        closeFileStreams: async () => {}
    };

    const err = new Error("ENOENT") as NodeJS.ErrnoException;
    err.code = "ENOENT";

    (controller as unknown as { onChildError: (err: unknown) => void }).onChildError(err);
    
    await new Promise(resolve => setTimeout(resolve, 10));

    expect(consoleOutput).toContain("On Windows, 'npm' is usually a .cmd or .ps1 script, not an .exe.");
    expect(exitSpy).toHaveBeenCalledWith(1);
});

test("Heuristic: PowerShell cmdlet hint", async () => {
    const controller = new ProcessController(
        { type: "command", command: "Get-Item", args: [] },
        "C:\\",
        "Get-Item",
        [],
        {},
        null
    );

    (controller as unknown as { ioController: unknown }).ioController = {
        closeFileStreams: async () => {}
    };

    const err = new Error("ENOENT") as NodeJS.ErrnoException;
    err.code = "ENOENT";

    (controller as unknown as { onChildError: (err: unknown) => void }).onChildError(err);
    
    await new Promise(resolve => setTimeout(resolve, 10));

    expect(consoleOutput).toContain("AGENT HINT: 'Get-Item' appears to be a PowerShell cmdlet");
    expect(exitSpy).toHaveBeenCalledWith(1);
});

test("Heuristic: Spaces in command hint", async () => {
    const controller = new ProcessController(
        { type: "command", command: "git log", args: [] },
        "C:\\",
        "git log",
        [],
        {},
        null
    );

    (controller as unknown as { ioController: unknown }).ioController = {
        closeFileStreams: async () => {}
    };

    const err = new Error("ENOENT") as NodeJS.ErrnoException;
    err.code = "ENOENT";

    (controller as unknown as { onChildError: (err: unknown) => void }).onChildError(err);
    
    await new Promise(resolve => setTimeout(resolve, 10));

    expect(consoleOutput).toContain("AGENT HINT: Your command contains spaces");
    expect(exitSpy).toHaveBeenCalledWith(1);
});
