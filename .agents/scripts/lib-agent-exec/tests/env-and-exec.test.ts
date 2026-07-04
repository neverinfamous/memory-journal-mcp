/* eslint-disable @typescript-eslint/no-unused-vars */
import { test, expect, describe, spyOn } from 'bun:test';
import { buildEnvironment } from "../environment.js";
import { $ } from "bun";
import path from "node:path";
import fs from "node:fs";

const AGENT_EXEC_PATH = "C:/Users/chris/Desktop/adamic/.agents/scripts/agent-exec.ts";
import os from 'os';
import { join } from 'path';
import { mkdtempSync } from 'fs';
const SCRATCH_DIR = mkdtempSync(join(os.tmpdir(), 'agent-exec-tests-'));

describe("environment.ts", () => {
    test("Enforces immutable env vars", () => {
        const consoleSpy = spyOn(console, "error").mockImplementation(() => {});
        const payloadEnv = {
            CI: "0",
            GIT_EDITOR: "vim",
            GIT_ASKPASS: "my-askpass",
            NO_COLOR: "0",
            PAGER: "less",
            ci: "0"
        };
        const env = buildEnvironment(payloadEnv);
        
        expect(env.CI).toBe("1");
        expect(env.GIT_EDITOR).toBe("true");
        expect(env.GIT_ASKPASS).toBe("agent-exec-blocked");
        expect(env.NO_COLOR).toBe("1");
        expect(env.PAGER).toBe("");
        consoleSpy.mockRestore();
    });
});

describe("agent-exec.ts - binary testing", () => {
    test("Execution behavior when global binary is missing", async () => {
        const payload = {
            command: "non_existent_binary_xyz123",
            target: "local"
        };
        const payloadPath = path.join(SCRATCH_DIR, "missing-bin-payload.json");
        fs.writeFileSync(payloadPath, JSON.stringify(payload));

        try {
            const { exitCode, stderr } = await $`bun ${AGENT_EXEC_PATH} ${payloadPath}`.nothrow().quiet();
            expect(exitCode).not.toBe(0);
        } finally {
            if (fs.existsSync(payloadPath)) if (fs.existsSync(payloadPath)) fs.unlinkSync(payloadPath);
        }
    });

    test("Execution behavior when payload is invalid JSON", async () => {
        const payloadPath = path.join(SCRATCH_DIR, "malformed-payload.json");
        fs.writeFileSync(payloadPath, "{ invalid_json: ");

        try {
            const { exitCode, stderr } = await $`bun ${AGENT_EXEC_PATH} ${payloadPath}`.nothrow().quiet();
            expect(exitCode).toBe(1);
            expect(stderr.toString()).toContain("Invalid JSON");
        } finally {
            if (fs.existsSync(payloadPath)) if (fs.existsSync(payloadPath)) fs.unlinkSync(payloadPath);
        }
    });

    test("Execution behavior with corrupted binary in PATH", async () => {
        const badBinDir = path.join(SCRATCH_DIR, "bad-bin");
        if (!fs.existsSync(badBinDir)) fs.mkdirSync(badBinDir, { recursive: true });
        
        const badGitPath = path.join(badBinDir, process.platform === "win32" ? "git.bat" : "git");
        // Create a script that just hangs or exits badly
        fs.writeFileSync(badGitPath, process.platform === "win32" ? "@echo off\nexit /b 999" : "#!/bin/bash\nexit 999");
        if (process.platform !== "win32") fs.chmodSync(badGitPath, 0o755);

        const payload = {
            type: "command",
            command: "git",
            args: ["status"],
            target: "local",
            env: {
                PATH: badBinDir
            }
        };
        const payloadPath = path.join(SCRATCH_DIR, "corrupted-bin-payload.json");
        fs.writeFileSync(payloadPath, JSON.stringify(payload));

        try {
            const { exitCode, stderr } = await $`bun ${AGENT_EXEC_PATH} ${payloadPath}`.nothrow().quiet();
            // Ensure we handle it gracefully, exit code 999
            expect(exitCode).not.toBe(0);
        } finally {
            if (fs.existsSync(payloadPath)) if (fs.existsSync(payloadPath)) fs.unlinkSync(payloadPath);
            fs.rmSync(badBinDir, { recursive: true, force: true });
        }
    });
});


