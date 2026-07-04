import { test, expect } from 'bun:test';
import { buildCommand } from '../command-builder.ts';

test('does not arbitrarily corrupt Windows paths embedded inside regexes', () => {
  const payload = {
    type: 'command' as const,
    target: 'wsl2' as const,
    command: 'dummy-command',
    args: ['-P', '^C:\\path\\with spaces\\file\\.txt\\d+']
  };

  const { args } = buildCommand(payload, 'C:\\cwd');
  
  expect(args).toContain('^C:\\path\\with spaces\\file\\.txt\\d+');
});
