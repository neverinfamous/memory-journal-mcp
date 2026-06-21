 
import { test, expect, describe } from "bun:test";
import { $ } from "bun";
import path from "node:path";
import fs from "node:fs";

const AGENT_EXEC_PATH = "C:/Users/chris/Desktop/adamic/.agents/scripts/agent-exec.ts";
const SCRATCH_DIR = "C:/Users/chris/.gemini/antigravity/brain/e306dc24-6f13-4e62-99ef-e892031c68cf/scratch";

describe("agent-exec.ts - corrupted binary", () => {
    test("Execution behavior with corrupted exe in PATH", async () => {
        const badBinDir = path.join(SCRATCH_DIR, "bad-bin4");
        if (!fs.existsSync(badBinDir)) fs.mkdirSync(badBinDir, { recursive: true });
        
        const badGitPath = path.join(badBinDir, process.platform === "win32" ? "git.exe" : "git");
        // Create an invalid exe file
        fs.writeFileSync(badGitPath, "NOT A REAL EXE FILE CONTENT 123456789");
        if (process.platform !== "win32") fs.chmodSync(badGitPath, 0o755);

        const payload = {
            type: "command",
            command: "git",
            args: ["status"],
            target: "windows",
            env: {
                PATH: badBinDir
            }
        };
        const payloadPath = path.join(SCRATCH_DIR, "corrupted-exe-payload4.json");
        fs.writeFileSync(payloadPath, JSON.stringify(payload));

        try {
            const { exitCode, stderr } = await $`bun ${AGENT_EXEC_PATH} ${payloadPath}`.nothrow().quiet();
            console.log("Exit Code:", exitCode);
            console.log("Stderr:", stderr.toString());
            // It should gracefully fail with code 1 instead of crashing node entirely
            expect(exitCode).toBe(1);
        } finally {
            if (fs.existsSync(payloadPath)) fs.unlinkSync(payloadPath);
            fs.rmSync(badBinDir, { recursive: true, force: true });
        }
    });
});
