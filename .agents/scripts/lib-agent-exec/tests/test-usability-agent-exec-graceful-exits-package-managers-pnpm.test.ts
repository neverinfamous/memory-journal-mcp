import { expect, test } from "bun:test";
import { execSync } from "node:child_process";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import crypto from "node:crypto";

test("Usability Test: Agent-Exec Graceful Exits (Package Managers - NPM/PNPM) > should NOT swallow true errors if pnpm outdated is just present in the script payload", () => {
    const payloadPath = path.join(os.tmpdir(), `test-payload-${crypto.randomUUID()}.json`);
    const scriptPath = path.join(os.tmpdir(), `test-script-${crypto.randomUUID()}.bat`);

    // Script containing BOTH 'pnpm outdated' and a failing command
    fs.writeFileSync(scriptPath, "call pnpm outdated\r\ncall pnpm add NON_EXISTENT_PACKAGE_XYZ12345\r\n", "utf8");

    const payload = {
        type: "script",
        scriptPath: scriptPath,
        cwd: process.cwd()
    };
    fs.writeFileSync(payloadPath, JSON.stringify(payload), "utf8");

    const agentExecPath = path.resolve(__dirname, '../../agent-exec.ts');
    try {
        execSync(`bun ${agentExecPath} ${payloadPath}`, {
            stdio: "pipe",
            env: { ...process.env, AGENT_EXEC_MAX_PAYLOAD_SIZE: "1000000" }
        });
        // If it reaches here, the bug is present: agent-exec exited with 0 (swallowed the exit code 1)
        expect(false).toBe(true); // Should not reach this
    } catch (error: unknown) {
        const err = error as { status?: number; stdout?: Buffer | string; stderr?: Buffer | string };
        expect(err.status).toBe(1);
        const stderr = err.stderr?.toString() || "";
        
        // It should NOT print the graceful exit message if it's a true error
        expect(stderr).not.toContain("ℹ️  Outdated packages found (exit code 1).");
        expect(stderr).toContain("❌ Command exited with code 1");
    } finally {
        if (fs.existsSync(payloadPath)) fs.unlinkSync(payloadPath);
        if (fs.existsSync(scriptPath)) fs.unlinkSync(scriptPath);
    }
}, { timeout: 30000 });
