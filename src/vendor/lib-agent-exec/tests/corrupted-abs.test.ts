 
import { test, expect, describe } from "bun:test";
import { $ } from "bun";
import path from "node:path";
import fs from "node:fs";

const AGENT_EXEC_PATH = "C:/Users/chris/Desktop/adamic/.agents/scripts/agent-exec.ts";
const SCRATCH_DIR = "C:/Users/chris/.gemini/antigravity/brain/e306dc24-6f13-4e62-99ef-e892031c68cf/scratch";

describe("agent-exec.ts - corrupted binary absolute path", () => {
    test("Execution behavior with absolute path to corrupted exe", async () => {
        const badBinDir = path.join(SCRATCH_DIR, "bad-bin-abs");
        if (!fs.existsSync(badBinDir)) fs.mkdirSync(badBinDir, { recursive: true });
        
        const badGitPath = path.join(badBinDir, process.platform === "win32" ? "git.exe" : "git");
        // Create an invalid exe file
        fs.writeFileSync(badGitPath, "NOT A REAL EXE FILE CONTENT 123456789");
        if (process.platform !== "win32") fs.chmodSync(badGitPath, 0o755);

        const payload = {
            type: "command",
            command: badGitPath.replace(/\\/g, '/'),
            args: ["status"],
            target: "windows"
        };
        const payloadPath = path.join(SCRATCH_DIR, "corrupted-abs-payload.json");
        fs.writeFileSync(payloadPath, JSON.stringify(payload));

        try {
            const exitCodes = new Set<number>();
            for (let i = 0; i < 5; i++) {
                const { exitCode, stderr } = await $`bun ${AGENT_EXEC_PATH} ${payloadPath}`.nothrow().quiet();
                exitCodes.add(exitCode);
                console.log(`Run ${i}: Exit code ${exitCode}, Stderr: ${stderr.toString()}`);
            }
            console.log("Observed exit codes:", Array.from(exitCodes));
            expect(exitCodes.has(1)).toBe(true);
        } finally {
            if (fs.existsSync(payloadPath)) fs.unlinkSync(payloadPath);
            fs.rmSync(badBinDir, { recursive: true, force: true });
        }
    });
});
