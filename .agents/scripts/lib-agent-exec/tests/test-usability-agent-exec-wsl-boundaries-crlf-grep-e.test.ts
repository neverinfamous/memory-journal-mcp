import { describe, it, expect } from 'bun:test';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

describe('WSL2 CRLF Boundary Fidelity - grep -E', () => {
  it('should ensure grep -E functions predictably with CRLF in WSL by converting to -P', () => {
    const uniqueId = crypto.randomUUID();
    const fileA = path.join(os.tmpdir(), `crlf-test-grep-e-${uniqueId}.txt`);
    const payloadPath = path.join(os.tmpdir(), `payload-grep-e-crlf-${uniqueId}.json`);
    try {
      fs.writeFileSync(fileA, "line1\r\nline2\r\n", "utf8");
      
      const wslPath = fileA.replace(/\\/g, '/').replace(/^([a-zA-Z]):\//, (m, drive) => `/mnt/${drive.toLowerCase()}/`);

      fs.writeFileSync(payloadPath, JSON.stringify({
        type: 'command',
        target: 'wsl2',
        command: 'grep',
        args: ['-E', 'line1$', wslPath],
        bypassInterceptors: true
      }), 'utf8');
      
      const agentExecPath = path.resolve(__dirname, '../agent-exec.ts');
      const result = spawnSync('bun', [agentExecPath, payloadPath], { encoding: 'utf8' });
      
      expect(result.status).toBe(0);
      expect(result.stdout).toContain('line1');
    } finally {
      if (fs.existsSync(fileA)) fs.unlinkSync(fileA);
      if (fs.existsSync(payloadPath)) fs.unlinkSync(payloadPath);
    }
  });
});
