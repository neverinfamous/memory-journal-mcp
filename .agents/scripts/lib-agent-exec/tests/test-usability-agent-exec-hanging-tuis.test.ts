import { test, expect, describe, afterEach, beforeEach } from 'bun:test';
import { buildCommand } from "C:/Users/chris/Desktop/adamic/.agents/scripts/lib-agent-exec/command-builder.ts";
import { ExecPayload } from "C:/Users/chris/Desktop/adamic/.agents/scripts/lib-agent-exec/schema.ts";
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
describe("TUI Programs Blocking", () => {
    let originalExit: typeof process.exit;
    let exitCodeCaught: number | null | undefined = null;
    let originalConsoleError: typeof console.error;

    beforeEach(() => {
        originalExit = process.exit;
        exitCodeCaught = undefined;
        process.exit = ((code?: number) => {
            exitCodeCaught = code;
            throw new Error(`PROCESS_EXIT:${code}`);
        }) as unknown as typeof process.exit;

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

    test("TUI programs (vim) should be intercepted and aborted", () => {
        const payload: ExecPayload = { type: "command", command: "vim", args: ["file.txt"] };
        const { exited, exitCode } = callBuild(payload);
        expect(exited).toBe(true);
        expect(exitCode).toBe(1);
    });

    test("TUI programs (nano) should be intercepted and aborted", () => {
        const payload: ExecPayload = { type: "command", command: "nano", args: ["file.txt"] };
        const { exited, exitCode } = callBuild(payload);
        expect(exited).toBe(true);
        expect(exitCode).toBe(1);
    });

    test("TUI programs (less) should be intercepted and aborted", () => {
        const payload: ExecPayload = { type: "command", command: "less", args: ["file.txt"] };
        const { exited, exitCode } = callBuild(payload);
        expect(exited).toBe(true);
        expect(exitCode).toBe(1);
    });

    test("TUI programs (vim) wrapped in pwsh should be intercepted", () => {
        const payload: ExecPayload = { type: "command", command: "pwsh", args: ["-c", "vim file.txt"] };
        const { exited, exitCode } = callBuild(payload);
        expect(exited).toBe(true);
        expect(exitCode).toBe(1);
    });

    test("TUI programs (vim) in eval should be intercepted", () => {
        const payload: ExecPayload = { type: "eval", code: "vim" };
        const { exited, exitCode } = callBuild(payload);
        expect(exited).toBe(true);
        expect(exitCode).toBe(1);
    });

    test("wsl vim should be intercepted", () => {
        const payload: ExecPayload = { type: "command", command: "wsl", args: ["vim", "file.txt"] };
        const { exited, exitCode } = callBuild(payload);
        expect(exited).toBe(true);
        expect(exitCode).toBe(1);
    });

    test("cmd /c vim should be intercepted", () => {
        const payload: ExecPayload = { type: "command", command: "cmd", args: ["/c", "vim file.txt"] };
        const { exited, exitCode } = callBuild(payload);
        expect(exited).toBe(true);
        expect(exitCode).toBe(1);
    });

    test("docker exec vim should be intercepted", () => {
        const payload: ExecPayload = { type: "command", command: "docker", args: ["exec", "-it", "mycontainer", "vim"] };
        const { exited, exitCode } = callBuild(payload);
        expect(exited).toBe(true);
        expect(exitCode).toBe(1);
    });

    test("env vim should be intercepted", () => {
        const payload: ExecPayload = { type: "command", command: "env", args: ["vim", "file.txt"] };
        const { exited, exitCode } = callBuild(payload);
        expect(exited).toBe(true);
        expect(exitCode).toBe(1);
    });

    test("sudo vim should be intercepted", () => {
        const payload: ExecPayload = { type: "command", command: "sudo", args: ["vim", "file.txt"] };
        const { exited, exitCode } = callBuild(payload);
        expect(exited).toBe(true);
        expect(exitCode).toBe(1);
    });

    test("script payload with vim interpreter should be intercepted", () => {
        const payload: ExecPayload = { type: "script", scriptPath: __filename, interpreter: "vim" };
        const { exited, exitCode } = callBuild(payload);
        expect(exited).toBe(true);
        expect(exitCode).toBe(1);
    });

    test("script payload executing a file with vim inside should be intercepted", () => {
        const scriptPath = path.join(os.tmpdir(), "hanging-tui-dummy.sh");
        fs.writeFileSync(scriptPath, "vim file.txt");
        const payload: ExecPayload = { type: "script", scriptPath, interpreter: "bash" };
        const { exited, exitCode } = callBuild(payload);
        try { fs.unlinkSync(scriptPath); } catch { /* ignore error */ }
        expect(exited).toBe(true);
        expect(exitCode).toBe(1);
    });
});

