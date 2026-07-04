import { test, expect, spyOn } from 'bun:test';
import { buildEnvironment } from 'C:/Users/chris/Desktop/adamic/.agents/scripts/lib-agent-exec/environment.ts';
import { buildCommand } from 'C:/Users/chris/Desktop/adamic/.agents/scripts/lib-agent-exec/command-builder.ts';
import { ProcessController } from 'C:/Users/chris/Desktop/adamic/.agents/scripts/lib-agent-exec/process-controller.ts';

test('Immutable env vars are securely enforced', () => {
  const payloadEnv = {
    CI: '0', 
    GIT_EDITOR: 'nano',
    GIT_ASKPASS: 'my-hacked-script'
  };

  const env = buildEnvironment(payloadEnv);

  expect(env.CI).toBe('1');
  expect(env.GIT_EDITOR).toBe('true');
  expect(env.GIT_ASKPASS).toBe('agent-exec-blocked');
});

test('Execution behavior with missing global binary in buildCommand', () => {
  const payload = {
    type: 'command' as const,
    command: 'missing-non-existent-binary',
    args: ['-c', 'hello']
  };

  const { cmd } = buildCommand(payload as unknown as never, process.cwd());
  expect(cmd).toBe('missing-non-existent-binary');
});

test('Execution behavior with dummy command and trailing args', () => {
  const payload = {
    type: 'command' as const,
    command: 'missing-global-binary',
    args: ['-c', 'hello']
  };

  const { cmd, args } = buildCommand(payload as unknown as never, process.cwd());
  expect(cmd).toBe('missing-global-binary');
  expect(args).toEqual(['-c', 'hello']);
});

test('Execution behavior with missing global binary when executed', async () => {
  const payload = {
    type: 'command',
    command: 'missing-non-existent-binary-123456789',
    args: ['-c', 'hello'],
    cwd: process.cwd(),
    timeoutMs: 0
  };

  const env = buildEnvironment({});
  const { cmd, args, envOverrides } = buildCommand(payload as unknown as never, process.cwd());

  const controller = new ProcessController(
    payload as unknown as never,
    process.cwd(),
    cmd,
    args,
    { ...env, ...envOverrides },
    null
  );
  
  await new Promise<void>((resolve, reject) => {
    spyOn(process, 'exit').mockImplementation((code?: string | number | null | undefined) => {
      try {
        expect(code).toBe(1);
        resolve();
      } catch (err) {
        reject(err);
      }
      return undefined as never;
    });

    controller.start();
  });
});


