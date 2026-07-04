import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { checkPrompt } from 'C:/Users/chris/Desktop/adamic/.agents/scripts/lib-agent-exec/prompt-detector.ts';
import { gitInterceptor } from 'C:/Users/chris/Desktop/adamic/.agents/scripts/lib-agent-exec/interceptors/git-interceptor.ts';
import { dockerInterceptor } from 'C:/Users/chris/Desktop/adamic/.agents/scripts/lib-agent-exec/interceptors/docker-interceptor.ts';

let exitCode: number | null | undefined = null;
const originalExit = process.exit;
const originalError = console.error;

beforeEach(() => {
  exitCode = undefined;
  process.exit = ((code?: number) => {
    exitCode = code;
  }) as unknown as typeof process.exit;
  console.error = () => {}; 
});

afterEach(() => {
  process.exit = originalExit;
  console.error = originalError;
});

describe('Prompt Detector Edge Cases', () => {
  it('detects password prompt at end of buffer', () => {
    expect(checkPrompt('Password:')).toBe(true);
    expect(checkPrompt('Enter passphrase for key: ')).toBe(true);
  });
  
  it('detects multiline inquirer prompt', () => {
    expect(checkPrompt('? Choose an option:\n  › Yes\n    No')).toBe(true);
  });
  
  it('detects github device login', () => {
    expect(checkPrompt('Please press Enter to continue...')).toBe(true);
  });
  
  it('detects npm init prompts', () => {
    expect(checkPrompt('package name: (my-pkg) ')).toBe(true);
    expect(checkPrompt('version: (1.0.0) ')).toBe(true);
  });
  
  it('detects y/n with colors if VT stripped', () => {
    expect(checkPrompt('\x1B[32m? Do you want to continue? [Y/n]\x1B[0m')).toBe(true);
  });
});

describe('Git Interceptor Edge Cases', () => {
  it('blocks git commit unconditionally', () => {
    let ctx = { cmdBasename: 'git', args: ['commit', '-a'], envOverrides: {}, payload: { type: 'command' } } as unknown as import("../interceptors/types.ts").ExecutionContext;
    gitInterceptor(ctx);
    expect(exitCode === 1).toBe(true);
    
    // Should also block with -m
    exitCode = undefined;
    ctx = { cmdBasename: 'git', args: ['commit', '-a', '-m', 'fix'], envOverrides: {}, payload: { type: 'command' } } as unknown as import("../interceptors/types.ts").ExecutionContext;
    gitInterceptor(ctx);
    expect(exitCode === 1).toBe(true);
  });
  
  it('blocks git add -i', () => {
    const ctx = { cmdBasename: 'git', args: ['add', '-i'], envOverrides: {}, payload: { type: 'command' } } as unknown as import("../interceptors/types.ts").ExecutionContext;
    gitInterceptor(ctx);
    expect(exitCode).toBe(1);
  });
});

describe('Docker Interceptor Edge Cases', () => {
  it('strips -t but allows execution if there is a command', () => {
    const ctx = { cmdBasename: 'docker', args: ['exec', '-it', 'my-container', 'bash', '-c', 'ls'], envOverrides: {}, payload: { type: 'command' } } as unknown as import("../interceptors/types.ts").ExecutionContext;
    dockerInterceptor(ctx);
    expect(ctx.args).not.toContain('-it');
    expect(exitCode).toBeUndefined(); // Should not block because it has -c 'ls'
  });
  
  it('strips --tty=true', () => {
    const ctx = { cmdBasename: 'docker', args: ['run', '--tty=true', 'ubuntu'], envOverrides: {}, payload: { type: 'command' } } as unknown as import("../interceptors/types.ts").ExecutionContext;
    dockerInterceptor(ctx);
    expect(ctx.args.some((a: string) => a.startsWith('--tty'))).toBe(false);
  });
});


