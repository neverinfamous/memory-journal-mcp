import { describe, expect, test } from 'bun:test';
import { PayloadSchema } from '../schema.js';
import { buildCommand } from '../command-builder.js';
import { systemInterceptor } from '../interceptors/system-interceptor.js';
import { ExecutionContext } from '../interceptors/types.js';

describe('Usability Test: Agent-Exec Payloads (Target Verification)', () => {
  test('Target Validation: rejects invalid target enum', () => {
    const rawPayload = {
      type: 'command',
      command: 'echo',
      target: 'linux'
    };
    const parsed = PayloadSchema.safeParse(rawPayload);
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues[0].message).toContain('Invalid input');
    }
  });

  test('Target Windows: executes natively on PowerShell', () => {
    const payload = {
      type: 'command',
      command: 'echo',
      args: ['hello windows'],
      target: 'windows'
    } as unknown as {
      type: 'command',
      command: string,
      args?: string[],
      target?: 'windows' | 'wsl2',
      bypassInterceptors?: boolean
    };
    
    // Command builder should wrap built-ins in pwsh on windows
    const built = buildCommand(payload, process.cwd());
    if (process.platform === 'win32') {
      expect(built.cmd).toContain('pwsh.exe');
      expect(built.args).toContain('-EncodedCommand');
    }
    
    // System interceptor should NOT block this because originalCmd was 'echo'
    const ctx: ExecutionContext = {
      cmdBasename: built.cmd,
      args: built.args,
      envOverrides: {},
      payload: payload
    };
    
    // If it threw `process.exit(1)`, this test would crash or fail.
    // Bun tests can mock `process.exit`, but `systemInterceptor` just calls it directly.
    // Instead of mocking, we just run it and ensure it doesn't crash.
    // Actually let's mock console.error and process.exit to be safe.
    let exited = false;
    const originalExit = process.exit;
    const originalError = console.error;
    try {
      process.exit = ((_code: number) => { exited = true; }) as unknown as typeof process.exit;
      console.error = () => {};
      
      systemInterceptor(ctx);
      
      expect(exited).toBe(false);
    } finally {
      process.exit = originalExit;
      console.error = originalError;
    }
  });

  test('Target WSL2: executes inside wsl.exe', () => {
    const payload = {
      type: 'command',
      command: 'uname',
      args: ['-a'],
      target: 'wsl2'
    } as unknown as {
      type: 'command',
      command: string,
      args?: string[],
      target?: 'windows' | 'wsl2',
      bypassInterceptors?: boolean
    };
    
    const built = buildCommand(payload, process.cwd());
    expect(built.cmd).toBe('wsl.exe');
    expect(built.args.join(' ')).toContain('uname');
  });
});
