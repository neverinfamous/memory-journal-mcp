import { expect, test } from 'bun:test';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

test('missing script payload returns JSON envelope error when --json is passed', () => {
  const payloadPath = path.join(__dirname, 'missing-script-payload.json');
  fs.writeFileSync(payloadPath, JSON.stringify({
    type: 'script',
    scriptPath: 'does-not-exist.ts'
  }));

  try {
    const rootDir = path.join(__dirname, '../..');
    execSync(`bun agent-exec.ts --json ${payloadPath}`, { cwd: rootDir });
    expect().fail('Should have exited with error');
  } catch (err: unknown) {
    const errorObj = err as Error & { stdout?: Buffer };
    const stdout = errorObj.stdout?.toString() || '';
    const lastLine = stdout.trim().split('\n').pop() || '';
    
    // Parse the output as JSON envelope
    let jsonOutput: Record<string, unknown> = {};
    try {
      jsonOutput = JSON.parse(lastLine) as Record<string, unknown>;
    } catch {
      console.error("Failed to parse JSON output: ", lastLine);
      expect().fail("Output should be a valid JSON envelope");
    }

    expect(jsonOutput.status).toBe('error');
    expect(jsonOutput.message).toContain('does not exist or is not a file');
  } finally {
    if (fs.existsSync(payloadPath)) {
      fs.unlinkSync(payloadPath);
    }
  }
});
