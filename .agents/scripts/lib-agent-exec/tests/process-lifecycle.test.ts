import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { replTuiInterceptor } from '../interceptors/repl-tui-interceptor.ts';
import { dockerInterceptor } from '../interceptors/docker-interceptor.ts';
import { killProcessTree } from '../process-manager.ts';

describe('Lib-Agent-Exec: REPL/TUI Hang Prevention', () => {
  let originalExit: typeof process.exit;
  let exitCode: number | undefined = -1;
  
  beforeEach(() => {
    originalExit = process.exit;
        process.exit = ((code?: number) => {
            exitCode = code;
            throw new Error(`mockExit:${code}`);
    }) as unknown as typeof process.exit;
  });

  afterEach(() => {
    process.exit = originalExit;
  });

  it('blocks naked python', () => {
    const ctx = {
      cmdBasename: 'python',
      args: [],
      envOverrides: {},
      payload: { type: 'command' }
    };
    expect(() => replTuiInterceptor(ctx as unknown as import("../interceptors/types.ts").ExecutionContext)).toThrow("mockExit:1");
    expect(exitCode).toBe(1);
  });

  it('blocks naked bash', () => {
    const ctx = {
      cmdBasename: 'bash',
      args: [],
      envOverrides: {},
      payload: { type: 'command' }
    };
    expect(() => replTuiInterceptor(ctx as unknown as import("../interceptors/types.ts").ExecutionContext)).toThrow("mockExit:1");
    expect(exitCode).toBe(1);
  });

  it('blocks python with -i flag (interactive)', () => {
    const ctx = {
      cmdBasename: 'python',
      args: ['-i'],
      envOverrides: {},
      payload: { type: 'command' }
    };
    expect(() => replTuiInterceptor(ctx as unknown as import("../interceptors/types.ts").ExecutionContext)).toThrow("mockExit:1");
    expect(exitCode).toBe(1);
  });

  it('allows python with a script argument', () => {
    const ctx = {
      cmdBasename: 'python',
      args: ['script.py'],
      envOverrides: {},
      payload: { type: 'command' }
    };
    expect(() => replTuiInterceptor(ctx as unknown as import("../interceptors/types.ts").ExecutionContext)).not.toThrow();
  });

  it('blocks indefinitely hanging TUIs like vim or less', () => {
    const ctxVim = {
      cmdBasename: 'vim',
      args: ['file.txt'],
      envOverrides: {},
      payload: { type: 'command' }
    };
    expect(() => replTuiInterceptor(ctxVim as unknown as import("../interceptors/types.ts").ExecutionContext)).toThrow('mockExit:1');
    
        const ctxLess = {
      cmdBasename: 'less',
      args: ['file.txt'],
      envOverrides: {},
      payload: { type: 'command' }
    };
    expect(() => replTuiInterceptor(ctxLess as unknown as import("../interceptors/types.ts").ExecutionContext)).toThrow('mockExit:1');
  });

  it('blocks watch tools like nodemon and tsx watch', () => {
    const ctxTsx = {
      cmdBasename: 'tsx',
      args: ['watch', 'script.ts'],
      envOverrides: {},
      payload: { type: 'command' }
    };
    expect(() => replTuiInterceptor(ctxTsx as unknown as import("../interceptors/types.ts").ExecutionContext)).toThrow('mockExit:1');
  });
});

describe('Lib-Agent-Exec: Docker Indefinite Blocking Prevention', () => {
  let originalExit: typeof process.exit;
  
  beforeEach(() => {
    originalExit = process.exit;
        process.exit = ((code?: number) => {
            throw new Error(`mockExit:${code}`);
    }) as unknown as typeof process.exit;
  });

  afterEach(() => {
    process.exit = originalExit;
  });

  it('strips -f and --follow from docker logs', () => {
    const ctx1 = {
      cmdBasename: 'docker',
      args: ['logs', '-f', 'my-container'],
      envOverrides: {},
      payload: { type: 'command' }
    };
    expect(() => dockerInterceptor(ctx1 as unknown as import("../interceptors/types.ts").ExecutionContext)).not.toThrow();
    expect(ctx1.args).not.toContain('-f');

    const ctx2 = {
      cmdBasename: 'docker',
      args: ['logs', '--follow', 'my-container'],
      envOverrides: {},
      payload: { type: 'command' }
    };
    expect(() => dockerInterceptor(ctx2 as unknown as import("../interceptors/types.ts").ExecutionContext)).not.toThrow();
    expect(ctx2.args).not.toContain('--follow');
  });

  it('blocks docker wait completely', () => {
    const ctx = {
      cmdBasename: 'docker',
      args: ['wait', 'my-container'],
      envOverrides: {},
      payload: { type: 'command' }
    };
    expect(() => dockerInterceptor(ctx as unknown as import("../interceptors/types.ts").ExecutionContext)).toThrow('mockExit:1');
  });

  it('blocks docker exec into naked bash', () => {
    const ctx = {
      cmdBasename: 'docker',
      args: ['exec', '-it', 'my-container', 'bash'],
      envOverrides: {},
      payload: { type: 'command' }
    };
    // Expected behavior: detects shell without execution flags and terminates
    expect(() => dockerInterceptor(ctx as unknown as import("../interceptors/types.ts").ExecutionContext)).toThrow('mockExit:1');
  });

  it('strips TTY flags but allows valid docker exec bash -c', () => {
    const ctx = {
      cmdBasename: 'docker',
      args: ['exec', '-it', 'my-container', 'bash', '-c', 'echo hello'],
      envOverrides: {},
      payload: { type: 'command' }
    };
    expect(() => dockerInterceptor(ctx as unknown as import("../interceptors/types.ts").ExecutionContext)).not.toThrow();
    // TTY flags should be stripped
    expect(ctx.args).not.toContain('-it');
    expect(ctx.args).not.toContain('-t');
    expect(ctx.args).not.toContain('--tty');
    expect(ctx.args).toContain('bash');
    expect(ctx.args).toContain('-c');
    expect(ctx.args).toContain('echo hello');
  });

  it('strips --watch from docker compose up', () => {
    const ctx = {
      cmdBasename: 'docker',
      args: ['compose', 'up', '--watch', '-d'],
      envOverrides: {},
      payload: { type: 'command' }
    };
    expect(() => dockerInterceptor(ctx as unknown as import("../interceptors/types.ts").ExecutionContext)).not.toThrow();
    expect(ctx.args).not.toContain('--watch');
    expect(ctx.args).toContain('-d');
  });
});

describe('Lib-Agent-Exec: Process Lifecycle & Zombie Management', () => {
  it('killProcessTree does not throw on valid mock child', () => {
    const mockChild = {
      pid: 99999999, // Arbitrary non-existent PID
      exitCode: null,
      signalCode: null,
      killed: false,
      kill: () => {},
      spawnfile: 'node',
      spawnargs: ['script.js']
    };
    
    // Test that the killProcessTree executes smoothly without throwing errors
    // Even if taskkill/wmic or Unix fallbacks fail, they should be caught internally
    expect(() => killProcessTree(mockChild as unknown as import("child_process").ChildProcess)).not.toThrow();
  });
});


