import { expect, test } from 'bun:test';
import { parseArgs } from 'node:util';
import { agentExecCliArgsSchema } from '../schema.js';

test('parses multiple interceptors correctly', () => {
  const argv = ['--interceptors', 'file1.ts', '--interceptors', 'file2.ts', 'payload.json'];
  
  const options = {
    interceptors: { type: 'string', multiple: true },
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

  expect(parsedArgs.interceptors).toEqual(['file1.ts', 'file2.ts']);
});
