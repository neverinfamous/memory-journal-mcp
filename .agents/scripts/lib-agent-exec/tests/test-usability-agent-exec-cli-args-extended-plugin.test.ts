import { expect, test } from 'bun:test';
import { parseArgs } from 'node:util';
import { agentExecCliArgsSchema } from '../schema.js';

test('parses plugin argument correctly', () => {
  const argv = ['--plugin', 'file1.ts', 'payload.json'];
  
  const options = {
    interceptors: { type: 'string', multiple: true },
    plugin: { type: 'string' },
    help: { type: 'boolean', short: 'h' },
    json: { type: 'boolean' },
  } as const;

  const { values, positionals } = parseArgs({
    args: argv,
    options,
    strict: true,
    allowPositionals: true
  });

  const parsedArgs = agentExecCliArgsSchema.parse({
    ...values,
    payloadPath: positionals[0]
  });

  expect(parsedArgs.plugin).toEqual('file1.ts');
});
