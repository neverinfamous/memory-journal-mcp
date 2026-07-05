import { describe, expect, it } from 'bun:test';
import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import { PayloadSchema } from '../schema.js';
import path from 'node:path';

describe('Execution Stall Timeout Usability', () => {
  it('should timeout execution when stallTimeoutMs is 100ms and process takes longer without outputting anything', async () => {
    const payload = {
      type: 'eval',
      interpreter: 'node',
      code: 'await new Promise(r => setTimeout(r, 5000))',
      stallTimeoutMs: 100
    };

    // Validate payload against schema
    const parsed = PayloadSchema.safeParse(payload);
    expect(parsed.success).toBe(true);

    const payloadStr = JSON.stringify(payload);
    const payloadPath = path.join(__dirname, 'test-stalltimeoutms-payload.json');
    await Bun.write(payloadPath, payloadStr);
    const agentExecPath = path.resolve(__dirname, '../../agent-exec.ts');

    const start = Date.now();
    const child = spawn(process.execPath, ['run', agentExecPath, payloadPath, '--json'], {
      cwd: process.cwd(),
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let childStdout = '';
    let childStderr = '';
    child.stdout.on('data', d => childStdout += d);
    child.stderr.on('data', d => childStderr += d);

    const exitCode = await new Promise<number | null>((resolve) => {
      child.on('exit', (code) => {
        resolve(code);
      });
    });

    const duration = Date.now() - start;
    if (fs.existsSync(payloadPath)) fs.unlinkSync(payloadPath);

    expect(exitCode).not.toBe(0);
    expect(duration).toBeLessThan(1500);
    expect(childStderr).toContain('stalled');
  });
});
