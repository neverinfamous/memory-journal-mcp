import { test, expect } from 'bun:test';
import { buildCommand } from '../command-builder.js';
import { ExecPayload } from '../schema.js';

test("Quote stripping edge case", () => {
  let args = ["'my \\' title'"];
  args = args.map(arg => {
    if (arg.startsWith('"') && arg.endsWith('"') && arg.length >= 2 && !arg.slice(1, -1).includes('"')) {
      return arg.slice(1, -1);
    }
    if (arg.startsWith("'") && arg.endsWith("'") && arg.length >= 2 && !arg.slice(1, -1).includes("'")) {
      return arg.slice(1, -1);
    }
    return arg;
  });

  console.log("Result:", args);
  // It will print ["'my \' title'"]

});

test("Command quotes are stripped", () => {
  const payload = {
    type: 'command',
    command: '"npm"',
    args: ['install']
  };
  const result = buildCommand(payload as unknown as ExecPayload, process.cwd());
  expect(result.cmd.includes('"')).toBe(false);
});
