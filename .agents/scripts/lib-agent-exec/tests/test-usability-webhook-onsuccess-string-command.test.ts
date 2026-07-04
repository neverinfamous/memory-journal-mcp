import { expect, test } from 'bun:test';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

test('Webhook Validation with command payload and string onSuccess URL', async () => {
  let webhook1Called = false;

  const server1 = Bun.serve({
    port: 0,
    fetch() {
      webhook1Called = true;
      return new Response('OK');
    },
  });

  const payloadPath = path.join(os.tmpdir(), 'test-webhook-onsuccess-string-command.json');
  const payload = {
    type: 'command',
    command: 'echo',
    args: ['hello'],
    onSuccess: `http://localhost:${server1.port}/webhook1`
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

  server1.stop();

  console.log('Result:', result);
  expect(result).not.toContain('Payload schema validation failed.');
  expect(webhook1Called).toBe(true);
});
