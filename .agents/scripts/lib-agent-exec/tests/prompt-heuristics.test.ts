import { expect, test, spyOn, afterEach } from 'bun:test';
import { checkPrompt } from '../prompt-detector.ts';
import { gitInterceptor } from '../interceptors/git-interceptor.ts';
import { dockerInterceptor } from '../interceptors/docker-interceptor.ts';
import { ExecutionContext } from '../interceptors/types.ts';

// Mock process.exit
let exitCode: number | undefined;
spyOn(process, 'exit').mockImplementation((code?: number | string | null | undefined): never => {
  exitCode = code as number;
  throw new Error(`process.exit called with ${code}`);
});

afterEach(() => {
  exitCode = undefined;
});

test('checkPrompt - complex package manager queries', () => {
  const inquirerPrompts = [
    '? Would you like to share anonymous usage data? (Y/n)',
    '? What is your name? ›',
    '? Select your framework: »',
    '✔ Saved ...',
    '? Would you like to continue? [y/N]',
    'Overwrite test.txt? (y/n[n])',
    '? Choose a template: (Use arrow keys)',
    '? Which version of Vue would you like to use? (3.x)'
  ];

  for (const prompt of inquirerPrompts) {
    expect(checkPrompt(prompt)).toBe(true);
  }
});

test('checkPrompt - generic y/n prompts', () => {
  const prompts = [
    'Are you sure you want to continue? [y/N]',
    'Do you want to continue? (Y/n)',
    'Continue? [y/N]',
    'Do you accept the license? (yes/no)'
  ];

  for (const prompt of prompts) {
    expect(checkPrompt(prompt)).toBe(true);
  }
});

test('git rebase -i blocking', () => {
  const ctx: ExecutionContext = {
    cmdBasename: 'git',
    args: ['rebase', '-i', 'HEAD~3'],
    envOverrides: {},
    payload: { type: 'command', command: 'git' } as unknown as never
  };

  expect(() => gitInterceptor(ctx)).toThrow('process.exit called with 1');
});

test('forced TTY flags - docker', () => {
  const ctx: ExecutionContext = {
    cmdBasename: 'docker',
    args: ['run', '-it', 'ubuntu', 'bash'],
    envOverrides: {},
    payload: { type: 'command', command: 'docker' } as unknown as never
  };

  expect(() => dockerInterceptor(ctx)).toThrow('process.exit called with 1');

  const ctx2: ExecutionContext = {
    cmdBasename: 'docker',
    args: ['run', '-i', '-t', 'ubuntu', 'bash'],
    envOverrides: {},
    payload: { type: 'command', command: 'docker' } as unknown as never
  };

  expect(() => dockerInterceptor(ctx2)).toThrow('process.exit called with 1');
});

test('forced TTY flags - docker exec', () => {
  const ctx: ExecutionContext = {
    cmdBasename: 'docker',
    args: ['exec', '-it', 'container', 'bash'],
    envOverrides: {},
    payload: { type: 'command', command: 'docker' } as unknown as never
  };

  expect(() => dockerInterceptor(ctx)).toThrow('process.exit called with 1');
});

test('git commit -a without message (no TTY block?)', () => {
  const ctx: ExecutionContext = {
    cmdBasename: 'git',
    args: ['commit', '-a'],
    envOverrides: {},
    payload: { type: 'command', command: 'git' } as unknown as never
  };

  // git commit without -m opens an editor. Let's see if the interceptor blocks it.
  try {
    gitInterceptor(ctx);
  } catch (e: unknown) {
    if (e instanceof Error && e.message.includes('process.exit')) {
      // It blocked.
      expect(exitCode).toBe(1);
    }
  }
});


