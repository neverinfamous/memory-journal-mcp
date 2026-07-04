import { test, expect, describe, beforeAll, afterAll } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { spawn } from 'child_process';

describe('maxBuffer default resolution', () => {
  let scratchDir: string;

  beforeAll(() => {
    scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-exec-maxbuf-def-'));
  });

  afterAll(() => {
    try { fs.rmSync(scratchDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  test('default maxBuffer should evaluate correctly when only one stream is redirected to a file', async () => {
    const payloadPath = path.join(scratchDir, 'payload-default-maxbuf.json');
    const stdoutFile = path.join(scratchDir, 'dummy-stdout.log');

    // We write just over DEFAULT_MAX_BUFFER (100MB) bytes to stdout, and a tiny string to stderr.
    // If the bug exists, the stderr chunk will trigger maxBuffer = DEFAULT_MAX_BUFFER, and combined length will exceed it.
    // Note: Generating 100MB+ in bun eval might take a moment, let's use 10MB chunk * 11 to get 110MB.
    const code = `
      const chunk = Buffer.alloc(10 * 1024 * 1024, 'A');
      for(let i=0; i<11; i++) {
        process.stdout.write(chunk);
      }
      setTimeout(() => {
        process.stderr.write('hello stderr');
      }, 500);
    `;

    const payload = {
      type: "eval",
      code: code,
      stdoutFile: stdoutFile,
      // no maxBuffer specified
      // no stderrFile specified
    };
    fs.writeFileSync(payloadPath, JSON.stringify(payload));

    const agentExecPath = path.resolve(__dirname, '../agent-exec.ts');
    
    const child = spawn("bun", [agentExecPath, payloadPath]);
    
    let childErr = "";
    child.stderr.on('data', (d) => childErr += d.toString());

    const exitCode = await new Promise<number | null>((resolve) => {
      child.on('exit', (code) => {
        resolve(code);
      });
    });

    // The bug will cause a non-zero exit code and "Output exceeded maxBuffer" in stderr.
    // So the test should assert that it exits with 0 and stderr doesn't contain maxBuffer string.
    expect(childErr).not.toContain("Output exceeded maxBuffer");
    expect(exitCode).toBe(0);
  }, 30000); // give it some time to write 110MB
});
