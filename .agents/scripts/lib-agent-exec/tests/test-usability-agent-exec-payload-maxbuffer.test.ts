import { test, expect, describe, beforeAll, afterAll } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { spawn } from 'child_process';

describe('maxBuffer combined limit', () => {
  let scratchDir: string;

  beforeAll(() => {
    scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-exec-maxbuf-'));
  });

  afterAll(() => {
    try { fs.rmSync(scratchDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  test('maxBuffer should limit combined stdout and stderr', async () => {
    const payloadPath = path.join(scratchDir, 'payload-combined-maxbuf.json');

    const payload = {
      type: "eval",
      code: "process.stdout.write('A'.repeat(60)); process.stderr.write('B'.repeat(60)); setTimeout(() => {}, 1000);",
      maxBuffer: 100
    };
    fs.writeFileSync(payloadPath, JSON.stringify(payload));

    const agentExecPath = path.resolve(__dirname, '../agent-exec.ts');
    
    const child = spawn("bun", [agentExecPath, payloadPath]);
    
    let childErr = "";
    child.stderr.on('data', (d) => childErr += d.toString());

    const code = await new Promise<number | null>((resolve) => {
      child.on('exit', (code) => {
        resolve(code);
      });
    });

    expect(code).not.toBe(0);
    expect(childErr).toContain("Output exceeded maxBuffer");
  }, 10000);
});
