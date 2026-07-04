import { expect, test, describe, spyOn, afterEach } from 'bun:test';
import { ProcessController } from "C:/Users/chris/Desktop/adamic/.agents/scripts/lib-agent-exec/process-controller.ts";

describe("Auto-healing hints heuristics", () => {
    let mockExit: ReturnType<typeof spyOn>;
    let mockConsoleError: ReturnType<typeof spyOn>;

    afterEach(() => {
        if (mockExit) mockExit.mockRestore();
        if (mockConsoleError) mockConsoleError.mockRestore();
    });

    test("Shell built-in hint (ren)", async () => {
        let stderrOutput: string = "";
        
        let resolveExit: (v: unknown) => void;
        const exitPromise = new Promise(r => { resolveExit = r; });

        mockExit = spyOn(process, "exit").mockImplementation((code?: number | string | null | undefined) => {
            resolveExit(code);
            return undefined as never;
        });
        mockConsoleError = spyOn(console, "error").mockImplementation((...args: unknown[]) => {
            stderrOutput += args.join(" ") + "\n";
        });

        const payload = { type: "command" as const, command: "ren", args: ["some", "args"] };
        const controller = new ProcessController(payload, process.cwd(), "ren", ["some", "args"], {}, null);
        controller.start();

        const code = await exitPromise;
        expect(code).toBe(1);
        expect(stderrOutput).toContain("AGENT HINT: 'ren' is a shell built-in");
    });

    test("MAX_PATH error hint", async () => {
        let stderrOutput: string = "";
        
        let resolveExit: (v: unknown) => void;
        const exitPromise = new Promise(r => { resolveExit = r; });

        mockExit = spyOn(process, "exit").mockImplementation((code?: number | string | null | undefined) => {
            resolveExit(code);
            return undefined as never;
        });
        mockConsoleError = spyOn(console, "error").mockImplementation((...args: unknown[]) => {
            stderrOutput += args.join(" ") + "\n";
        });

        const longCwd = "C:\\" + "a".repeat(260);
        const payload = { type: "command" as const, command: "dummy-non-existent-123", args: ["arg1"] };
        
        const controller = new ProcessController(payload, longCwd, "dummy-non-existent-123", ["arg1"], {}, null);
        controller.start();

        const code = await exitPromise;
        expect(code).toBe(1);
        expect(stderrOutput).toContain("AGENT HINT: Your working directory path exceeds the Windows MAX_PATH limit");
    });
});


