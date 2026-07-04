import { test, expect } from 'bun:test';

import { buildCommand } from '../command-builder.js';
import { ExecPayload } from '../schema.js';

test('WSL2 Command Builder: Translates Windows paths to /mnt/c/', () => {
  const payload: ExecPayload = {
    type: 'command',
    target: 'wsl2',
    command: 'stat',
    args: ['-r', 'search', 'C:\\Users\\chris\\Desktop\\adamic'],
    env: { 'CUSTOM_VAR': '123' }
  };
  
  const { cmd, args } = buildCommand(payload, 'C:\\Users\\chris\\Documents');
  
  expect(cmd).toBe('wsl.exe');
  
  // Ensure cwd is translated
  expect(args[1]).toBe('/mnt/c/Users/chris/Documents');
  
  // Ensure env args are present
  expect(args.includes('CUSTOM_VAR=123')).toBe(true);
  
  // Ensure args are translated
  expect(args.includes('/mnt/c/Users/chris/Desktop/adamic')).toBe(true);
});

test('WSL2 Script Payload: Properly maps temp eval files', () => {
  const payload: ExecPayload = {
    type: 'eval',
    target: 'wsl2',
    code: 'print("hello world")',
    interpreter: 'python3'
  };
  
  const { cmd, args, tempScriptPath } = buildCommand(payload, 'C:\\scratch');
  
  expect(cmd).toBe('wsl.exe');
  expect(tempScriptPath).toBeTruthy();
  
  // Ensure the tempScriptPath on Windows host was translated in the wsl execution arguments
  const expectedWslPath = tempScriptPath!.replace(/^([a-zA-Z]):[/\\]/, (_, drive) => `/mnt/${drive.toLowerCase()}/`).replace(/\\/g, '/');
  
  expect(args.includes(expectedWslPath)).toBe(true);
});


