import { test, expect } from 'bun:test';
import { buildCommand } from '../command-builder.ts';
import { ExecPayload } from '../schema.ts';

test('Integration context correctly substitutes in args, env, and templateOverride', () => {
  const payload: ExecPayload = {
    type: 'command',
    command: 'echo',
    args: ['-e', 'console.log("{{integrationContext.name}}")'],
    env: {
      GREETING: 'Hello {{integrationContext.name}}'
    },
    templateOverride: 'Prefix {{code}} Suffix {{integrationContext.name}}',
    integrationContext: {
      name: 'World'
    }
  };

  buildCommand(payload, process.cwd());
  
  expect(payload.args).toContain('-e');
  expect(payload.args).toContain('console.log("World")');
  expect(payload.env?.GREETING).toBe('Hello World');
  expect(payload.templateOverride).toBe('Prefix {{code}} Suffix World');
});
