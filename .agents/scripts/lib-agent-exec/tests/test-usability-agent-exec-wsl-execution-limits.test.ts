import { expect, test, describe, beforeAll, afterAll } from 'bun:test';
import { spawn } from 'node:child_process';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';

const execPath = path.resolve(import.meta.dir, '../agent-exec.ts');

function runAgentExec(payload: Record<string, unknown>): Promise<{ stdout: string, stderr: string, code: number | null }> {
  return new Promise((resolve) => {
    const payloadPath = path.join(os.tmpdir(), `payload-${Date.now()}-${Math.random()}.json`);
    fs.writeFileSync(payloadPath, JSON.stringify(payload));
    const isJsonArgs = payload.useJson ? ['--json', payloadPath] : [payloadPath];
    const child = spawn('bun', [execPath, ...isJsonArgs], {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => stdout += d.toString());
    child.stderr.on('data', (d) => stderr += d.toString());
    
    child.on('close', (code) => {
      resolve({ stdout, stderr, code });
    });
  });
}

describe('WSL Execution Limits', () => {
  const scratchDir = path.join(os.tmpdir(), 'agent-exec-wsl-limits');
  
  beforeAll(() => {
    if (!fs.existsSync(scratchDir)) fs.mkdirSync(scratchDir, { recursive: true });
  });

  afterAll(() => {
    try { fs.rmSync(scratchDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  test('respects truncateOutputLength under WSL', async () => {
    const payload = {
      type: 'command',
      target: 'wsl2',
      command: 'python3',
      args: ['-c', 'print("A" * 2000)'],
      truncateOutputLength: 512,
      maxBuffer: 4096
    };

    const res = await runAgentExec(payload);
    
    expect(res.code).toBe(0);
    expect(res.stdout).toContain('... [STDOUT truncated to 512 chars.');
    expect(res.stdout.length).toBeLessThan(1000); 
  });

  test('respects file redirect under WSL', async () => {
    const outPath = path.join(scratchDir, 'out.txt');
    const errPath = path.join(scratchDir, 'err.txt');
    const payload = {
      type: 'command',
      target: 'wsl2',
      command: 'python3',
      args: ['-c', 'import sys; print("A" * 1024 * 1024); print("B" * 1024 * 1024, file=sys.stderr)'],
      stdoutFile: outPath,
      stderrFile: errPath
    };

    const res = await runAgentExec(payload);
    
    expect(res.code).toBe(0);
    
    expect(fs.existsSync(outPath)).toBe(true);
    expect(fs.existsSync(errPath)).toBe(true);
    const outStat = fs.statSync(outPath);
    const errStat = fs.statSync(errPath);
    expect(outStat.size).toBeGreaterThan(1024 * 1024);
    expect(errStat.size).toBeGreaterThan(1024 * 1024);
  });
});
