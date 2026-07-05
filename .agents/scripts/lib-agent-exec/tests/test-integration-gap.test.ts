import { describe, expect, test } from 'bun:test';
import { buildCommand } from '../command-builder.ts';
import { ExecPayload } from '../schema.ts';
import fs from 'node:fs';

describe('Feature Gap: Extensibility and 3rd-Party Integrations', () => {
  test('integrationContext is accepted by schema but ignored by command builder', () => {
    const payload: ExecPayload = {
      type: 'command',
      command: 'node',
      args: ['--version'],
      integrationContext: {
        jiraIssue: 'PROJ-123',
        slackChannel: '#builds',
        userId: 'u_123'
      }
    };

    const cwd = process.cwd();
    const result = buildCommand(payload, cwd);

    // Assert that the command builder returns correctly, but there is no mechanism
    // in the returned object to propagate or utilize the integrationContext.
    expect(result.cmd).toMatch(/node/i);
    expect(result.args).toEqual(['--version']);
    
    // Check if integrationContext leaked into environment variables (it shouldn't, but let's prove it's ignored)
    expect(result.envOverrides['jiraIssue']).toBeUndefined();
    expect(result.envOverrides['slackChannel']).toBeUndefined();
  });

  test('Template overriding gap: eval payload templates are hardcoded', () => {
    const payload: ExecPayload = {
      type: 'eval',
      code: 'Write-Output "Hello"',
      interpreter: 'pwsh'
    };

    const cwd = process.cwd();
    const result = buildCommand(payload, cwd);

    expect(result.cmd).toMatch(/pwsh/i);
    expect(result.args).toContain('-ExecutionPolicy');
    expect(result.args).toContain('Bypass');

    // Clean up temp file
    if (result.tempScriptPath && fs.existsSync(result.tempScriptPath)) {
      const content = fs.readFileSync(result.tempScriptPath, 'utf8');
      expect(content).toContain('[Console]::OutputEncoding = [System.Text.Encoding]::UTF8');
      if (fs.existsSync(result.tempScriptPath)) fs.unlinkSync(result.tempScriptPath);
    }
  });
});


