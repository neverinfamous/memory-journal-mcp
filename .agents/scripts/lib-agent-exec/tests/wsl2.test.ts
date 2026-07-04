import { test, expect, afterEach } from 'bun:test';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { buildCommand } from 'C:/Users/chris/Desktop/adamic/.agents/scripts/lib-agent-exec/command-builder.ts';
import { ExecPayload } from 'C:/Users/chris/Desktop/adamic/.agents/scripts/lib-agent-exec/schema.ts';

const scratchDir = __dirname;
const agentExecPath = path.join(__dirname, '../agent-exec.ts');

afterEach(() => {
    // Hooks to clean up if needed
});

// ---------------------------------------------------------
// HEURISTIC TESTS (Testing buildCommand safely)
// ---------------------------------------------------------

test('wsl2 heuristic: embedded paths and quoted paths are mapped', () => {
    const originalExit = process.exit;
    process.exit = ((code?: number) => {
        throw new Error(`process.exit called with code ${code}`);
    }) as unknown as typeof process.exit;

    try {
        const payload: ExecPayload = {
            type: 'command',
            command: 'stat',
            args: ['--out=C:\\temp\\file.txt', '"C:\\quoted\\path.txt"'],
            target: 'wsl2'
        };
        const { args } = buildCommand(payload, 'C:\\project');
        
        // These will FAIL currently because of the `/^[a-zA-Z]:[/\\]/` bug
        expect(args).toContain('--out=/mnt/c/temp/file.txt');
        expect(args).toContain('/mnt/c/quoted/path.txt');
    } catch (e: unknown) {
        if (e instanceof Error && e.message.startsWith('process.exit called')) throw e;
        throw e;
    } finally {
        process.exit = originalExit;
    }
});

// ---------------------------------------------------------
// E2E NATIVE PAYLOAD TESTS (Testing via agent-exec.ts spawn)
// ---------------------------------------------------------

test('wsl2 e2e: eval python code mapping env vars', () => {
    const payload = {
        type: "eval",
        // Script writes the mapped MY_TEST_VAR to the path in sys.argv[1]
        code: "import os\nimport sys\nwith open(sys.argv[1], 'w') as f:\n  f.write(os.environ.get('MY_TEST_VAR', ''))",
        interpreter: "python",
        target: "wsl2",
        args: [path.join(scratchDir, "wsl_out.txt")],
        env: {
            "MY_TEST_VAR": "C:\\Users\\chris\\Desktop\\config.json"
        }
    };
    
    const payloadPath = path.join(scratchDir, 'payload-eval.json');
    fs.writeFileSync(payloadPath, JSON.stringify(payload, null, 2));
    
    const outPath = path.join(scratchDir, 'wsl_out.txt');
    if (fs.existsSync(outPath)) if (fs.existsSync(outPath)) fs.unlinkSync(outPath);
    
    const result = spawnSync('bun', [agentExecPath, payloadPath], { encoding: 'utf8' });
    
    // Should succeed because `envOverrides` maps env vars correctly (it calls convertToWslPath directly)
    expect(result.status).toBe(0);
    const outContent = fs.readFileSync(outPath, 'utf8');
    expect(outContent).toBe('/mnt/c/Users/chris/Desktop/config.json');
}, 30000);

test('wsl2 e2e: spawn shell script with embedded path arg', () => {
    const scriptPath = path.join(scratchDir, 'test-script.sh');
    fs.writeFileSync(scriptPath, '#!/bin/bash\necho "Arg 1 is $1" > $2\n');
    
    const payload = {
        type: "script",
        scriptPath: scriptPath,
        interpreter: "bash",
        target: "wsl2",
        args: [
            "--in=C:\\Users\\chris\\in.txt",
            path.join(scratchDir, 'wsl_script_out.txt')
        ]
    };
    
    const payloadPath = path.join(scratchDir, 'payload-script.json');
    fs.writeFileSync(payloadPath, JSON.stringify(payload, null, 2));
    
    const outPath = path.join(scratchDir, 'wsl_script_out.txt');
    if (fs.existsSync(outPath)) if (fs.existsSync(outPath)) fs.unlinkSync(outPath);
    
    const result = spawnSync('bun', [agentExecPath, payloadPath], { encoding: 'utf8' });
    
    expect(result.status).toBe(0);
    const outContent = fs.readFileSync(outPath, 'utf8');
    
    // This will FAIL currently. It will output '--in=C:\Users\chris\in.txt' instead of the mapped path.
    expect(outContent.trim()).toBe('Arg 1 is --in=/mnt/c/Users/chris/in.txt');
}, 30000);


