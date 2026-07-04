import { describe, expect, it } from 'bun:test';
import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import { PayloadSchema } from '../schema.js';
import path from 'node:path';

describe('Webhook Timeout Usability', () => {
  it('should timeout when webhook endpoint takes too long', async () => {
    // Start a dummy HTTP server that hangs for 2000ms
    const server = Bun.serve({
      port: 0,
      async fetch(_req) {
        await Bun.sleep(2000);
        return new Response("OK");
      },
    });

    const port = server.port;

    const payload = {
      type: 'command',
      command: 'bun',
      args: ['--version'],
      onSuccess: `http://localhost:${port}/`,
      webhookTimeoutMs: 100
    };

    // Validate payload against schema
    const parsed = PayloadSchema.safeParse(payload);
    expect(parsed.success).toBe(true);

    const payloadStr = JSON.stringify(payload);
    const payloadPath = path.join(__dirname, 'test-webhook-timeoutms-payload.json');
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
    
    console.log("Stdout:", childStdout);
    console.log("Stderr:", childStderr);

    const duration = Date.now() - start;
    server.stop();
    if (fs.existsSync(payloadPath)) fs.unlinkSync(payloadPath);

    expect(exitCode).toBe(0);
    expect(duration).toBeLessThan(1500);
  });
});
