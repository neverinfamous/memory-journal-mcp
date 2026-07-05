import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

let scratchDir: string;

beforeAll(() => {
    scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-exec-"));
});

afterAll(() => {
    try { fs.rmSync(scratchDir, { recursive: true, force: true }); } catch { /* ignore */ }
});

const agentExecPath = 'C:\\Users\\chris\\Desktop\\adamic\\.agents\\scripts\\agent-exec.ts';

function runAgentExec(payload: Record<string, unknown>, id: string) {
  const payloadPath = path.join(scratchDir, `payload-${id}.json`);
  const stdoutFile = path.join(scratchDir, `stdout-${id}.txt`);
  const stderrFile = path.join(scratchDir, `stderr-${id}.txt`);
  
  Object.assign(payload, { stdoutFile, stderrFile, keepPayload: false });

  fs.writeFileSync(payloadPath, JSON.stringify(payload, null, 2), 'utf-8');

  const result = spawnSync('bun', [agentExecPath, payloadPath], {
    cwd: scratchDir,
    encoding: 'utf-8'
  });

  const stdout = fs.existsSync(stdoutFile) ? fs.readFileSync(stdoutFile, 'utf-8') : '';
  const stderr = fs.existsSync(stderrFile) ? fs.readFileSync(stderrFile, 'utf-8') : '';

  return { status: result.status, stdout, stderr, processStdout: result.stdout, processStderr: result.stderr };
}

describe('agent-exec WSL2 target', () => {
  it('should run a command in wsl2 with path conversion and env vars', () => {
    const payload = {
      type: 'command',
      command: '/bin/pwd',
      cwd: 'C:\\Users\\chris\\Desktop\\adamic',
      env: { MY_CUSTOM_VAR: 'wsl2_test_value' },
      target: 'wsl2'
    };
    const res = runAgentExec(payload, 'cmd1');
    expect(res.status).toBe(0);
    expect(res.stdout.trim()).toBe('/mnt/c/Users/chris/Desktop/adamic');
    
    const payloadEnv = {
      type: 'command',
      command: 'printenv',
      args: ['MY_CUSTOM_VAR'],
      target: 'wsl2',
      env: { MY_CUSTOM_VAR: 'wsl2_test_value' }
    };
    const resEnv = runAgentExec(payloadEnv, 'cmd2');
    expect(resEnv.status).toBe(0);
    expect(resEnv.stdout.trim()).toBe('wsl2_test_value');
  }, 30000);

  it('should map windows paths in args to /mnt/c/', () => {
    const payload = {
      type: 'command',
      command: '/bin/echo',
      args: ['C:\\Users\\chris\\Desktop\\adamic'],
      target: 'wsl2'
    };
    const res = runAgentExec(payload, 'args-map');
    expect(res.status).toBe(0);
    expect(res.stdout.trim()).toBe('/mnt/c/Users/chris/Desktop/adamic');
  }, 30000);

  it('should run eval code in wsl2', () => {
    const payload = {
      type: 'eval',
      interpreter: 'bash',
      code: 'echo $EVAL_VAR; pwd',
      cwd: 'C:\\Users\\chris',
      target: 'wsl2',
      env: { EVAL_VAR: 'eval_works' }
    };
    const res = runAgentExec(payload, 'eval');
    expect(res.status).toBe(0);
    expect(res.stdout.trim()).toContain('eval_works');
    expect(res.stdout.trim()).toContain('/mnt/c/Users/chris');
  }, 30000);

  it('should run a shell script in wsl2', () => {
    const scriptPath = path.join(scratchDir, 'test_script.sh');
    fs.writeFileSync(scriptPath, '#!/bin/bash\necho $SCRIPT_VAR\npwd\necho $1', 'utf-8');
    
    const payload = {
      type: 'script',
      scriptPath: scriptPath,
      cwd: 'C:\\',
      target: 'wsl2',
      env: { SCRIPT_VAR: 'script_works' },
      args: ['C:\\some\\windows\\path']
    };
    const res = runAgentExec(payload, 'script');
    expect(res.status).toBe(0);
    expect(res.stdout.trim()).toContain('script_works');
    expect(res.stdout.trim()).toContain('/mnt/c');
    expect(res.stdout.trim()).toContain('/mnt/c/some/windows/path');
  }, 30000);
});


