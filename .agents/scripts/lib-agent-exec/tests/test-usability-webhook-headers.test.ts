import { test, expect } from 'bun:test';
import { $ } from 'bun';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { PayloadSchema } from '../schema.js';

test('webhookHeaders respects schema bounds for non-string values', () => {
  const payload = {
    type: 'command',
    command: 'echo',
    args: ['test'],
    webhookHeaders: {
      'Authorization': 'Bearer token',
      'X-Timeout': 5000,
      'X-Retry': true
    }
  };

  const parsed = PayloadSchema.safeParse(payload);
  
  // It should parse successfully and coerce or allow numbers and booleans
  expect(parsed.success).toBe(true);
  
  if (parsed.success) {
    const headers = parsed.data.webhookHeaders;
    expect(headers).toBeDefined();
    if (headers) {
      expect(String(headers['X-Timeout'])).toBe('5000');
      expect(String(headers['X-Retry'])).toBe('true');
    }
  }
});

test('agent-exec.ts successfully executes payload with webhookHeaders', async () => {
  const agentExecPath = path.resolve(__dirname, '../agent-exec.ts');
  const payloadPath = path.resolve(os.tmpdir(), 'dummy-payload-webhook-headers.json');
  
  fs.writeFileSync(payloadPath, JSON.stringify({
    type: 'command',
    command: 'echo',
    args: ['test'],
    webhookHeaders: {
      'Authorization': 'Bearer token',
      'X-Timeout': 5000,
      'X-Retry': true
    },
    onSuccess: 'http://localhost:9999/webhook',
    keepPayload: true
  }));

  const { stdout, stderr, exitCode } = await $`bun ${agentExecPath} ${payloadPath}`.nothrow().quiet();
  if (exitCode !== 0) {
    console.error("STDOUT:", stdout.toString());
    console.error("STDERR:", stderr.toString());
  }
  expect(exitCode).toBe(0);
  const errStr = stderr.toString().trim();
  expect(errStr).toContain('✅ Command succeeded');
  
  // Clean up
  try { fs.unlinkSync(payloadPath); } catch { /* ignore */ }
});
