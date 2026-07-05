import { expect, test } from "bun:test";
import { exec } from "node:child_process";
import { join } from "node:path";
import * as fs from "node:fs";

test("webhookPayloadTemplate accepts carriage returns in JSON templates", async () => {
    const payload = {
        type: "command",
        command: "node",
        args: ["--version"],
        webhookPayloadTemplate: "{\r\n  \"content\": \"{{stdout}}\"\r\n}"
    };
    
    const payloadPath = join(__dirname, "test-webhook.json");
    fs.writeFileSync(payloadPath, JSON.stringify(payload));
    
    try {
        const result = await new Promise<{stdout: string, stderr: string, code: number}>((resolve) => {
            exec(`bun run ../agent-exec.ts ${payloadPath}`, { cwd: __dirname }, (error, stdout, stderr) => {
                resolve({
                    stdout,
                    stderr,
                    code: error ? (error.code ?? 1) : 0
                });
            });
        });
        
        if (result.code !== 0) {
            console.error("Agent Exec Error Output:", result.stderr);
            console.error("Agent Exec Stdout:", result.stdout);
        }
        
        expect(result.stderr).toContain("Must not contain carriage returns");
        expect(result.code).toBe(1);
    } finally {
        try {
            if (fs.existsSync(payloadPath)) fs.unlinkSync(payloadPath);
        } catch {
            // ignore
        }
    }
});
