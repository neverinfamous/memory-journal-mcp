import { describe, it, expect, spyOn, afterEach, beforeEach, beforeAll, afterAll } from 'bun:test';
import { PayloadSchema } from '../schema.js';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

import * as os from 'os';

let scratchDir: string;

beforeAll(() => {
    scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-exec-"));
});

afterAll(() => {
    try { fs.rmSync(scratchDir, { recursive: true, force: true }); } catch { /* ignore */ }
});

const agentExecPath = "C:/Users/chris/Desktop/adamic/.agents/scripts/agent-exec.ts";

describe("Payload Schema Validation - schema.ts", () => {
    it("should reject string args when array is required", () => {
        const payload = {
            type: "command",
            command: "echo",
            args: "hello" // string instead of array
        };
        const result = PayloadSchema.safeParse(payload);
        expect(result.success).toBe(false);
        if (!result.success) {
            console.log("String args error:", result.error.issues);
        }
    });

    it("should reject missing required fields (command)", () => {
        const payload = {
            type: "command"
            // command missing
        };
        const result = PayloadSchema.safeParse(payload);
        expect(result.success).toBe(false);
    });

    it("should handle missing cwd gracefully", () => {
        const payload = {
            type: "command",
            command: "ls"
        };
        const result = PayloadSchema.safeParse(payload);
        expect(result.success).toBe(true);
    });
});

describe("agent-exec.ts - Runtime Validation", () => {
    let mockExit: ReturnType<typeof spyOn>;

    beforeEach(() => {
        mockExit = spyOn(process, 'exit').mockImplementation((code?: number | string | null | undefined): never => {
            throw new Error(`Process exited with code ${code}`);
        });
    });

    afterEach(() => {
        mockExit.mockRestore();
    });

    it("should gracefully reject malformed inputs without crashing ungracefully", () => {
        const payloadPath = path.join(scratchDir, "malformed-args.json");
        fs.writeFileSync(payloadPath, JSON.stringify({
            type: "command",
            command: "echo",
            args: "not-an-array"
        }));

        const res = spawnSync('bun', [agentExecPath, payloadPath], { encoding: 'utf-8' });
        expect(res.status).not.toBe(0);
        expect(res.stderr).toContain("❌ Error: Payload schema validation failed");
    });

    it("should gracefully reject missing required fields", () => {
        const payloadPath = path.join(scratchDir, "missing-command.json");
        fs.writeFileSync(payloadPath, JSON.stringify({
            type: "command"
        }));

        const res = spawnSync('bun', [agentExecPath, payloadPath], { encoding: 'utf-8' });
        expect(res.status).not.toBe(0);
        expect(res.stderr).toContain("❌ Error: Payload schema validation failed");
    });

    it("should gracefully reject unparseable JSON", () => {
        const payloadPath = path.join(scratchDir, "bad-json.json");
        fs.writeFileSync(payloadPath, "{ type: 'command', command: 'echo', } // invalid json");

        const res = spawnSync('bun', [agentExecPath, payloadPath], { encoding: 'utf-8' });
        expect(res.status).not.toBe(0);
        expect(res.stderr).toContain("❌ Error: Invalid JSON in payload file");
    });

    it("should gracefully reject missing cwd if provided but invalid", () => {
        const payloadPath = path.join(scratchDir, "invalid-cwd.json");
        fs.writeFileSync(payloadPath, JSON.stringify({
            type: "command",
            command: "echo",
            cwd: "/path/that/does/not/exist/12345"
        }));

        const res = spawnSync('bun', [agentExecPath, payloadPath], { encoding: 'utf-8' });
        expect(res.status).not.toBe(0);
        expect(res.stderr).toContain("does not exist or is not a directory");
    });

    it("should gracefully handle excessively large payload files", () => {
        const payloadPath = path.join(scratchDir, `large-payload-${crypto.randomUUID()}.json`);
        // Create a 600MB file to trigger V8 string length limit or memory limits
        // Wait, creating a 600MB file might take too long or crash the VM.
        // Let's create a 50MB file.
        const largeString = "a".repeat(1024 * 1024 * 50); 
        fs.writeFileSync(payloadPath, `{"type":"command","command":"echo","stdin":"${largeString}"}`);

        const res = spawnSync('bun', [agentExecPath, payloadPath], { encoding: 'utf-8', maxBuffer: 1024 * 1024 * 100 });
        // It might pass schema validation since it's valid JSON, or it might OOM.
        // We want to see how it fails.
        // if (fs.existsSync(payloadPath)) fs.unlinkSync(payloadPath);
        
        console.log("Large payload status:", res.status);
        console.log("Large payload stderr:", res.stderr.substring(0, 500));
    });
});


