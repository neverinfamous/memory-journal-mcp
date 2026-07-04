import { expect, test, spyOn, afterEach } from 'bun:test';
import { dockerInterceptor } from '../interceptors/docker-interceptor.ts';
import { ExecutionContext } from '../interceptors/types.ts';

// Mock process.exit
// Mock process.exit
spyOn(process, 'exit').mockImplementation((code?: number | string | null | undefined): never => {
  throw new Error(`process.exit called with ${code}`);
});

afterEach(() => {
});

test('forced TTY flags with valid trailing arguments (should heal, not exit)', () => {
  const ctx: ExecutionContext = {
    cmdBasename: 'docker',
    args: ['run', '-it', 'ubuntu', 'bash', '-c', 'echo hello'],
    envOverrides: {},
    payload: { type: 'command', command: 'docker' } as unknown as never
  };

  try {
    dockerInterceptor(ctx);
  } catch (e: unknown) {
    if (e instanceof Error && e.message.includes('process.exit')) {
      throw new Error('Should not have exited. It should auto-heal and strip flags.', { cause: e });
    }
    throw e;
  }

  expect(ctx.args).toEqual(['run', 'ubuntu', 'bash', '-c', 'echo hello']);
});


