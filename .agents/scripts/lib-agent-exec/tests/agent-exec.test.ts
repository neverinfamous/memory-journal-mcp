import { test, expect, describe, afterEach, beforeEach } from 'bun:test';
import { buildCommand } from "C:/Users/chris/Desktop/adamic/.agents/scripts/lib-agent-exec/command-builder.ts";
import { ExecPayload } from "C:/Users/chris/Desktop/adamic/.agents/scripts/lib-agent-exec/schema.ts";

describe("lib-agent-exec Heuristic Interceptor Tests", () => {
    let originalExit: typeof process.exit;
    let exitCodeCaught: number | null | undefined = null;
    let originalConsoleError: typeof console.error;

    beforeEach(() => {
        // Safely spy and mock process.exit without crashing the bun test runner
        originalExit = process.exit;
        exitCodeCaught = undefined;
        process.exit = ((code?: number) => {
            exitCodeCaught = code;
            throw new Error(`PROCESS_EXIT:${code}`);
        }) as unknown as typeof process.exit;

        // Suppress expected AGENT HINT logs to keep test output clean
        originalConsoleError = console.error;
        console.error = () => {};
    });

    afterEach(() => {
        process.exit = originalExit;
        console.error = originalConsoleError;
    });

    function callBuild(payload: ExecPayload) {
        try {
            const result = buildCommand(payload, "C:\\");
            return { exited: false, exitCode: null, payload, result };
        } catch (e: unknown) {
            if (e instanceof Error && e.message.startsWith('PROCESS_EXIT:')) {
                return { exited: true, exitCode: exitCodeCaught, payload, result: null };
            }
            throw e;
        }
    }

    test("Indefinite blocking: 'docker logs -f' dynamically strips follow flag", () => {
        const payload: ExecPayload = { type: "command", command: "docker", args: ["logs", "-f", "mycontainer"] };
        const { exited, result } = callBuild(payload);
        
        expect(exited).toBe(false);
        expect(result?.args).not.toContain("-f");
    });

    test("Indefinite blocking: 'tail -f' is intercepted and blocked via process.exit(1)", () => {
        const payload: ExecPayload = { type: "command", command: "tail", args: ["-f", "file.txt"] };
        const { exited, exitCode } = callBuild(payload);
        
        expect(exited).toBe(true);
        expect(exitCode).toBe(1);
    });

    test("Interactive REPL hang: 'python' without args is intercepted via process.exit(1)", () => {
        const payload: ExecPayload = { type: "command", command: "python" };
        const { exited, exitCode } = callBuild(payload);
        
        expect(exited).toBe(true);
        expect(exitCode).toBe(1);
    });

    test("Interactive REPL hang: 'bash' without args is intercepted via process.exit(1)", () => {
        const payload: ExecPayload = { type: "command", command: "bash" };
        const { exited, exitCode } = callBuild(payload);
        
        expect(exited).toBe(true);
        expect(exitCode).toBe(1);
    });
});


