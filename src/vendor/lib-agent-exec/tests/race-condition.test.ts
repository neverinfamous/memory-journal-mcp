import { test, expect, describe } from "bun:test";
import { $ } from "bun";
import path from "node:path";
import fs from "node:fs";

const AGENT_EXEC_PATH = "C:/Users/chris/Desktop/adamic/.agents/scripts/agent-exec.ts";
const SCRATCH_DIR = "C:/Users/chris/.gemini/antigravity/brain/e306dc24-6f13-4e62-99ef-e892031c68cf/scratch";

describe("agent-exec.ts - race condition", () => {
    test("Execution behavior when binary is missing (Race Condition Check)", async () => {
        const payload = {
            type: "command",
            command: "non_existent_binary_12345_race",
            target: "windows"
        };
        const payloadPath = path.join(SCRATCH_DIR, "race-payload.json");
        fs.writeFileSync(payloadPath, JSON.stringify(payload));

        try {
            const exitCodes = new Set<number>();
            for (let i = 0; i < 5; i++) {
                const { exitCode } = await $`bun ${AGENT_EXEC_PATH} ${payloadPath}`.nothrow().quiet();
                exitCodes.add(exitCode);
                console.log(`Run ${i}: Exit code ${exitCode}`);
            }
            console.log("Observed exit codes:", Array.from(exitCodes));
            expect(exitCodes.size).toBe(1);
            expect(exitCodes.has(1)).toBe(true);
        } finally {
            if (fs.existsSync(payloadPath)) fs.unlinkSync(payloadPath);
        }
    });
});
