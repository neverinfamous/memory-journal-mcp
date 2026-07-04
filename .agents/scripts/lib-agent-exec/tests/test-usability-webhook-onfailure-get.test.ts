import { expect, test } from 'bun:test';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

test('Webhook Validation with GET method', async () => {
  let webhookCalled = false;

  const server = Bun.serve({
    port: 0,
    fetch() {
      webhookCalled = true;
      return new Response('OK');
    },
  });

  const payloadPath = path.join(os.tmpdir(), 'test-webhook-get.json');
  const payload = {
    type: 'eval',
    code: 'process.exit(1);',
    interpreter: 'node',
    webhookMethod: 'GET',
    onFailure: `http://localhost:${server.port}/webhook`
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

  console.log('Result:', result);
  expect(result).not.toContain('Payload schema validation failed.');
  expect(webhookCalled).toBe(true);
});
