import { describe, expect, it } from 'bun:test';
import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import { PayloadSchema } from '../schema.js';
import path from 'node:path';

describe('Execution Timeout Usability', () => {
  it('should timeout execution when timeoutMs is 100ms and process takes longer', async () => {
    const payload = {
      type: 'eval',
      code: 'await new Promise(r => setTimeout(r, 5000))',
      interpreter: 'bun',
      timeoutMs: 100
    };

    // Validate payload against schema
    const parsed = PayloadSchema.safeParse(payload);
    expect(parsed.success).toBe(true);

    const payloadStr = JSON.stringify(payload);
    const payloadPath = path.join(__dirname, 'test-timeoutms-payload.json');
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
    expect(duration).toBeLessThan(3000);
    expect(childStderr).toContain('Execution timed out after 100ms');
  }, 10000); // 10s test timeout

  it('should restrict timeoutMs to maximum safe integer', () => {
    const payload = {
      type: 'command',
      command: 'echo',
      timeoutMs: 3000000000
    };
    const result = PayloadSchema.safeParse(payload);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.timeoutMs).toBe(2147483647);
    }
  });
});
