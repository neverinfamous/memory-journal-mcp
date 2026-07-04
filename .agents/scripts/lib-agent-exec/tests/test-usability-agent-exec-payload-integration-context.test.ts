import { test, expect } from 'bun:test';
import { buildCommand } from '../command-builder.ts';
import { ExecPayload } from '../schema.ts';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('Integration context usability test: substitution in command, args, env, scriptPath, code, and templateOverride', () => {
  const payloadCommand: ExecPayload = {
    type: 'command',
    command: 'node_{{integrationContext.var}}',
    args: ['-e', 'console.log("{{integrationContext.var}}")'],
    env: {
      MY_VAR: '{{integrationContext.var}}'
    },
    templateOverride: '{{code}} PREFIX_{{integrationContext.var}}',
    integrationContext: {
      var: 'my-value'
    }
  };

  buildCommand(payloadCommand, process.cwd());
  expect(payloadCommand.command).toBe('node_my-value');
  expect(payloadCommand.args).toContain('-e');
  expect(payloadCommand.args).toContain('console.log("my-value")');
  expect(payloadCommand.env?.MY_VAR).toBe('my-value');
  expect(payloadCommand.templateOverride).toBe('{{code}} PREFIX_my-value');

  const tmpScriptDir = os.tmpdir();
  const rawScriptPath = path.join(tmpScriptDir, 'script_{{integrationContext.var}}.sh');
  const expectedScriptPath = path.join(tmpScriptDir, 'script_my-value.sh');
  fs.writeFileSync(expectedScriptPath, 'echo "test"');

  const payloadScript: ExecPayload = {
    type: 'script',
    scriptPath: rawScriptPath,
    integrationContext: { var: 'my-value' }
  };
  
  buildCommand(payloadScript, process.cwd());
  expect(payloadScript.scriptPath).toBe(expectedScriptPath);
  fs.unlinkSync(expectedScriptPath);

  const payloadEval: ExecPayload = {
    type: 'eval',
    code: 'console.log("{{integrationContext.var}}")',
    integrationContext: { var: 'my-value' }
  };
  buildCommand(payloadEval, process.cwd());
  expect(payloadEval.code).toBe('console.log("my-value")');
});
