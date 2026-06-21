import { test, expect } from "bun:test";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const AGENT_EXEC = "C:\\Users\\chris\\Desktop\\adamic\\.agents\\scripts\\agent-exec.ts";
const SCRATCH_DIR = "C:\\Users\\chris\\.gemini\\antigravity\\brain\\c0378d33-759e-4cf2-9fb1-988c902f85e9\\scratch";

async function runExec(payload: Record<string, unknown>): Promise<{ stdout: string, stderr: string, code: number }> {
    const payloadPath = path.join(SCRATCH_DIR, `payload-${Date.now()}-${Math.random()}.json`);
    fs.writeFileSync(payloadPath, JSON.stringify(payload));
    
    return new Promise((resolve) => {
        const proc = spawn("bun", [AGENT_EXEC, payloadPath]);
        let stdout = "";
        let stderr = "";
        
        proc.stdout.on("data", d => stdout += d.toString());
        proc.stderr.on("data", d => stderr += d.toString());
        
        proc.on("close", code => {
            try { if (fs.existsSync(payloadPath)) fs.unlinkSync(payloadPath); } catch { /* ignore */ }
            resolve({ stdout, stderr, code: code ?? 1 });
        });
    });
}

test("MAX_PATH error hint", async () => {
    const longPath = "C:\\" + "a".repeat(260);
    const { stderr } = await runExec({
        type: "command",
        command: "does-not-exist-exe",
        cwd: longPath
    });
    expect(stderr).toContain("AGENT HINT: Your working directory path exceeds the Windows MAX_PATH limit");
});

test("Shell built-in hint (cd)", async () => {
    const { stderr } = await runExec({
        type: "command",
        command: "cd"
    });
    expect(stderr).toContain("AGENT HINT: 'cd' is a shell built-in");
});

test("Missing extension hint (npm)", async () => {
    await runExec({
        type: "command",
        command: "npm-not-exist-for-test"
    });
    // the code checks for exact matches of npm, pnpm, npx, yarn, bun. So we must use "npm".
    // but if npm actually exists in PATH, ENOENT won't trigger. We can try it anyway.
    // However, npm might just work on windows if the path has `.cmd` and node spawn resolves it? Node's spawn without shell:true does NOT automatically append .cmd. It will fail with ENOENT.
});

test("Missing extension hint (npm) exact", async () => {
    const { stderr } = await runExec({
        type: "command",
        command: "npm"
    });
    expect(stderr).toContain("AGENT HINT: Intercepted Windows batch file execution");
});

test("PowerShell cmdlet hint", async () => {
    const { stderr } = await runExec({
        type: "command",
        command: "Get-Item"
    });
    expect(stderr).toContain("AGENT HINT: 'Get-Item' appears to be a PowerShell cmdlet");
});

test("Script file as command hint", async () => {
    const { stderr } = await runExec({
        type: "command",
        command: "test.sh"
    });
    expect(stderr).toContain("AGENT HINT: You attempted to run a script file");
});

test("Spaces in command hint", async () => {
    const { stderr } = await runExec({
        type: "command",
        command: "git log"
    });
    expect(stderr).toContain("AGENT HINT: Your command contains spaces");
});
