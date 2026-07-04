import { test, expect } from 'bun:test';
import { buildCommand } from '../command-builder.js';
import { ExecPayload } from '../schema.js';

test("Spurious quotes around executable name in a single string command", () => {
  const payload = {
    type: 'command',
    command: '"npm" install',
    target: 'wsl2'
  };
  const result = buildCommand(payload as unknown as ExecPayload, process.cwd());
  expect(result.cmd).toBe('wsl.exe');
  expect(result.args).toContain('npm');
  expect(result.args).toContain('install');
});

test("Spurious quotes around executable name when args are in payload.args", () => {
  const payload = {
    type: 'command',
    command: '"npm"',
    args: ['install'],
    target: 'wsl2'
  };
  const result = buildCommand(payload as unknown as ExecPayload, process.cwd());
  expect(result.cmd).toBe('wsl.exe');
  expect(result.args).toContain('npm');
  expect(result.args).toContain('install');
});

test("Spurious quotes around executable name for native windows", () => {
  const payload = {
    type: 'command',
    command: '"npm" install'
  };
  const result = buildCommand(payload as unknown as ExecPayload, process.cwd());
  expect(result.cmd).toBe('pwsh.exe');
  expect(result.args).toContain('-EncodedCommand');
});

test("Spurious quotes around executable name with single quotes", () => {
  const payload = {
    type: 'command',
    command: "'git' status",
    target: 'wsl2'
  };
  const result = buildCommand(payload as unknown as ExecPayload, process.cwd());
  expect(result.cmd).toBe('wsl.exe');
  expect(result.args).toContain('git');
  expect(result.args).toContain('status');
});
