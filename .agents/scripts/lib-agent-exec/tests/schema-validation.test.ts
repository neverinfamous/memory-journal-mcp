import { expect, test, describe, beforeAll, afterAll } from 'bun:test';
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { spawnSync } from "child_process";

describe("agent-exec payload schema validation", () => {
    let tempDir: string;
    const agentExecPath = "C:\\Users\\chris\\Desktop\\adamic\\.agents\\scripts\\lib-agent-exec\\agent-exec.ts";

    beforeAll(() => {
        tempDir = mkdtempSync(join(tmpdir(), "agent-exec-test-"));
    });

    afterAll(() => {
        rmSync(tempDir, { recursive: true, force: true });
    });

    function runAgentExec(payloadPath: string) {
        return spawnSync("bun", ["run", agentExecPath, payloadPath], { encoding: "utf8" });
    }

    test("should reject missing type field", () => {
        const payloadPath = join(tempDir, "missing-type.json");
        writeFileSync(payloadPath, JSON.stringify({ command: "echo" }));
        const result = runAgentExec(payloadPath);
        expect(result.status).toBe(1);
        expect(result.stderr).toContain("Invalid discriminator value"); 
    });

    test("should reject passing string args when array required", () => {
        const payloadPath = join(tempDir, "string-args.json");
        writeFileSync(payloadPath, JSON.stringify({ type: "command", command: "echo", args: "hello" }));
        const result = runAgentExec(payloadPath);
        expect(result.status).toBe(1);
        expect(result.stderr).toContain("expected array, received string");
    });

    test("should reject missing cwd path if cwd is provided but does not exist", () => {
        const payloadPath = join(tempDir, "invalid-cwd.json");
        writeFileSync(payloadPath, JSON.stringify({ type: "command", command: "echo", cwd: "C:\\does_not_exist_at_all_123" }));
        const result = runAgentExec(payloadPath);
        expect(result.status).toBe(1);
        expect(result.stderr).toContain("does not exist or is not a directory");
    });

    test("should reject malformed JSON", () => {
        const payloadPath = join(tempDir, "malformed.json");
        writeFileSync(payloadPath, "{ type: 'command', }");
        const result = runAgentExec(payloadPath);
        expect(result.status).toBe(1);
        expect(result.stderr).toContain("Invalid JSON in payload file");
    });

    test("should reject excessively large payload files", () => {
        const payloadPath = join(tempDir, "large.json");
        const largeContent = "a".repeat(11 * 1024 * 1024);
        writeFileSync(payloadPath, largeContent);
        const result = runAgentExec(payloadPath);
        expect(result.status).toBe(1);
        expect(result.stderr).toContain("Payload file exceeds 10485760 bytes limit");
    });
    
    test("should reject null bytes in string", () => {
        const payloadPath = join(tempDir, "null-byte.json");
        writeFileSync(payloadPath, JSON.stringify({ type: "command", command: "echo\0" }));
        const result = runAgentExec(payloadPath);
        expect(result.status).toBe(1);
        expect(result.stderr).toContain("Must not contain null bytes");
    });
});


