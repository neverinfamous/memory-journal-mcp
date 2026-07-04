import { test, expect } from 'bun:test';
import { buildCommand } from '../command-builder.js';
import { ExecPayload } from '../schema.js';

test("Payload args mutation leak across cycles", () => {
  const payload: ExecPayload = {
    type: 'command',
    command: 'git',
    args: ['merge', 'main'],
  };

  const originalArgs = [...payload.args!];
  buildCommand(payload, process.cwd());
  expect(payload.args).toEqual(originalArgs);
});

test("Eval code mutation leak across cycles", () => {
  const payload: ExecPayload = {
    type: 'eval',
    code: 'Write-Output "Hello"',
    interpreter: 'pwsh'
  };

  const originalCode = payload.code;
  buildCommand(payload, process.cwd());
  expect(payload.code).toBe(originalCode);
});


