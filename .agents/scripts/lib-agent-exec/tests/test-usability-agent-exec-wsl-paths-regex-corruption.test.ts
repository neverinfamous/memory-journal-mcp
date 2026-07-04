import { test, expect } from 'bun:test';
import { buildCommand } from '../command-builder.ts';

test('does not corrupt non-path backslashes in regex without spaces', () => {
  const payload = {
    type: 'command' as const,
    target: 'wsl2' as const,
    command: 'dummy-command',
    args: ['-P', '^C:\\path\\to\\file\\.txt\\d+']
  };

  const { args } = buildCommand(payload, 'C:\\cwd');
  // It should NOT try to aggressively map regexes to WSL paths
  expect(args).toContain('^C:\\path\\to\\file\\.txt\\d+');
});
