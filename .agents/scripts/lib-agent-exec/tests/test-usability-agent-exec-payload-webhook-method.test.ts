import { expect, test } from 'bun:test';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

test('Webhook Method validation with agent-exec', async () => {
  let webhookCalled = false;
  let receivedMethod = '';

  const server = Bun.serve({
    port: 0,
    fetch(req) {
      webhookCalled = true;
      receivedMethod = req.method;
      return new Response('OK');
    },
  });

  const payloadPath = path.join(os.tmpdir(), 'test-webhook-method.json');
  const payload = {
    type: 'command',
    command: 'echo',
    args: ['hello'],
    webhookMethod: 'POST',
    onSuccess: `http://localhost:${server.port}/webhook`
  };
  fs.writeFileSync(payloadPath, JSON.stringify(payload, null, 2));

  const cliPath = path.resolve(__dirname, '../agent-exec.ts');
  
  const proc = Bun.spawn(['bun', 'run', cliPath, payloadPath, '--json'], { stdout: 'pipe', stderr: 'pipe' });
  let result = '';
  try {
    const out = await new Response(proc.stdout).text();
    const err = await new Response(proc.stderr).text();
    result = out + '\n' + err;
  } catch (err: unknown) {
    console.error('Spawn error', err);
  }
  await proc.exited;

  server.stop();
  try { fs.unlinkSync(payloadPath); } catch { /* ignore */ }

  expect(result).not.toContain('Payload schema validation failed.');
  expect(webhookCalled).toBe(true);
  expect(receivedMethod).toBe('POST');
});

test('Webhook Method GET without body throws no errors in io-controller', async () => {
  let webhookCalled = false;
  let receivedMethod = '';

  const server = Bun.serve({
    port: 0,
    fetch(req) {
      webhookCalled = true;
      receivedMethod = req.method;
      return new Response('OK');
    },
  });

  const payloadPath = path.join(os.tmpdir(), 'test-webhook-method-get.json');
  const payload = {
    type: 'command',
    command: 'echo',
    args: ['hello'],
    stdoutFile: `http://localhost:${server.port}/webhook`,
    webhookMethod: 'GET'
  };
  fs.writeFileSync(payloadPath, JSON.stringify(payload, null, 2));

  const cliPath = path.resolve(__dirname, '../agent-exec.ts');
  
  const proc = Bun.spawn(['bun', 'run', cliPath, payloadPath, '--json'], { stdout: 'pipe', stderr: 'pipe' });
  let result = '';
  try {
    const out = await new Response(proc.stdout).text();
    const err = await new Response(proc.stderr).text();
    result = out + '\n' + err;
  } catch (err: unknown) {
    console.error('Spawn error', err);
  }
  await proc.exited;

  server.stop();
  try { fs.unlinkSync(payloadPath); } catch { /* ignore */ }

  // If fetch throws TypeError, it will log to console.error
  expect(result).not.toContain('TypeError');
  expect(webhookCalled).toBe(true);
  expect(receivedMethod).toBe('GET');
});
