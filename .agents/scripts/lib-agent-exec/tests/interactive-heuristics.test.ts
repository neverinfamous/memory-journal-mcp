import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { checkPrompt } from 'C:/Users/chris/Desktop/adamic/.agents/scripts/lib-agent-exec/prompt-detector.ts';
import { gitInterceptor } from 'C:/Users/chris/Desktop/adamic/.agents/scripts/lib-agent-exec/interceptors/git-interceptor.ts';
import { dockerInterceptor } from 'C:/Users/chris/Desktop/adamic/.agents/scripts/lib-agent-exec/interceptors/docker-interceptor.ts';
import { packageManagerInterceptor } from 'C:/Users/chris/Desktop/adamic/.agents/scripts/lib-agent-exec/interceptors/package-manager-interceptor.ts';
import { replTuiInterceptor } from 'C:/Users/chris/Desktop/adamic/.agents/scripts/lib-agent-exec/interceptors/repl-tui-interceptor.ts';

let exitCode: number | null | undefined = null;
const originalExit = process.exit;
const originalError = console.error;

beforeEach(() => {
  exitCode = undefined;
  process.exit = ((code?: number) => {
    exitCode = code;
  }) as unknown as typeof process.exit;
  console.error = () => {}; // Silence output during test
});

afterEach(() => {
  process.exit = originalExit;
  console.error = originalError;
});

describe('Prompt Detector', () => {
  it('detects inquirer prompts', () => {
    expect(checkPrompt('? What is your name: ')).toBe(true);
    expect(checkPrompt('? Choose an option: › ')).toBe(true);
    expect(checkPrompt('✔ Download complete...')).toBe(true);
  });
  
  it('detects y/n prompts', () => {
    expect(checkPrompt('Overwrite file? (y/n)')).toBe(true);
    expect(checkPrompt('Do you want to continue? [Y/n]')).toBe(true);
    expect(checkPrompt('Are you sure? (yes/no): ')).toBe(true);
  });
  
  it('detects package manager complex queries', () => {
    expect(checkPrompt('Any package manager prompt? (yes/no)')).toBe(true);
    expect(checkPrompt('Is this ok? (yes)')).toBe(true); 
  });
});

describe('Git Interceptor', () => {
  it('blocks git rebase -i', () => {
    const ctx = { cmdBasename: 'git', args: ['rebase', '-i', 'main'], envOverrides: {}, payload: { type: 'command' } } as unknown as import("../interceptors/types.ts").ExecutionContext;
    gitInterceptor(ctx);
    expect(exitCode).toBe(1);
  });
  
  it('blocks git rebase --interactive', () => {
    const ctx = { cmdBasename: 'git', args: ['rebase', '--interactive', 'main'], envOverrides: {}, payload: { type: 'command' } } as unknown as import("../interceptors/types.ts").ExecutionContext;
    gitInterceptor(ctx);
    expect(exitCode).toBe(1);
  });

  it('allows normal git rebase', () => {
    const ctx = { cmdBasename: 'git', args: ['rebase', 'main'], envOverrides: {}, payload: { type: 'command' } } as unknown as import("../interceptors/types.ts").ExecutionContext;
    gitInterceptor(ctx);
    expect(exitCode).toBeUndefined();
  });
});

describe('Forced TTY flags stripping / blocking', () => {
  it('strips -t and -i from docker commands', () => {
    const ctx = { cmdBasename: 'docker', args: ['run', '-it', 'ubuntu', 'ls'], envOverrides: {}, payload: { type: 'command' } } as unknown as import("../interceptors/types.ts").ExecutionContext;
    dockerInterceptor(ctx);
    expect(ctx.args.join(' ')).not.toContain('-it');
    expect(ctx.args).not.toContain('-t');
    expect(ctx.args).not.toContain('-i');
  });
  
  it('strips -t and -i when preceded by docker flags that require values', () => {
    const ctx = { cmdBasename: 'docker', args: ['run', '--label', 'mylabel', '-it', 'ubuntu', 'ls'], envOverrides: {}, payload: { type: 'command' } } as unknown as import("../interceptors/types.ts").ExecutionContext;
    dockerInterceptor(ctx);
    expect(ctx.args.join(' ')).not.toContain('-it');
    expect(ctx.args).not.toContain('-t');
    expect(ctx.args).not.toContain('-i');
  });
  
  it('blocks headless hanging shell for docker exec without execution flags', () => {
    const ctx = { cmdBasename: 'docker', args: ['exec', '-it', 'my-container', 'bash'], envOverrides: {}, payload: { type: 'command' } } as unknown as import("../interceptors/types.ts").ExecutionContext;
    dockerInterceptor(ctx);
    expect(exitCode).toBe(1);
  });
  
  it('strips interactive flags from yarn', () => {
     const ctx = { cmdBasename: 'yarn', args: ['add', 'react', '-i'], envOverrides: {}, payload: { type: 'command' } } as unknown as import("../interceptors/types.ts").ExecutionContext;
     packageManagerInterceptor(ctx);
     expect(ctx.args).not.toContain('-i');
  });
  
  it('strips interactive flags from npm', () => {
     const ctx = { cmdBasename: 'npm', args: ['install', '--interactive'], envOverrides: {}, payload: { type: 'command' } } as unknown as import("../interceptors/types.ts").ExecutionContext;
     packageManagerInterceptor(ctx);
     expect(ctx.args).not.toContain('--interactive');
  });
  
  it('blocks naked shells like pwsh', () => {
     const ctx = { cmdBasename: 'pwsh', args: [], envOverrides: {}, payload: { type: 'command' } } as unknown as import("../interceptors/types.ts").ExecutionContext;
     replTuiInterceptor(ctx);
     expect(exitCode).toBe(1);
  });
  
  it('strips -it and -ic from bash and python', () => {
     let ctx = { cmdBasename: 'bash', args: ['-ic', 'echo hello'], envOverrides: {}, payload: { type: 'command' } } as unknown as import("../interceptors/types.ts").ExecutionContext;
     replTuiInterceptor(ctx);
     expect(ctx.args).toEqual(['-c', 'echo hello']);
     
     ctx = { cmdBasename: 'python', args: ['-itc', 'print("hi")'], envOverrides: {}, payload: { type: 'command' } } as unknown as import("../interceptors/types.ts").ExecutionContext;
     replTuiInterceptor(ctx);
     expect(ctx.args).toEqual(['-c', 'print("hi")']);
     
     ctx = { cmdBasename: 'bash', args: ['-it'], envOverrides: {}, payload: { type: 'command' } } as unknown as import("../interceptors/types.ts").ExecutionContext;
     replTuiInterceptor(ctx);
     expect(ctx.args).toEqual([]);
     expect(exitCode).toBe(1); // Should be blocked after stripping because it becomes naked
  });
});


