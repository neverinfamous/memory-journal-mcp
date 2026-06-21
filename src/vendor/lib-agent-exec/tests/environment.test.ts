import { test, expect, describe } from 'bun:test';
import { execSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';


describe('lib-agent-exec Robustness Audit (Role 5)', () => {

  test('Immutability: Attempting to override CI, GIT_EDITOR triggers warning but preserves immutable defaults', () => {
    const payloadPath = path.join(import.meta.dir, 'test-immutability.json');
    const payload = {
      type: 'eval',
      code: 'console.log(JSON.stringify({ CI: process.env.CI, GIT_EDITOR: process.env.GIT_EDITOR, GIT_ASKPASS: process.env.GIT_ASKPASS }))',
      env: {
        CI: '0',
        GIT_EDITOR: 'nano',
        GIT_ASKPASS: 'custom-askpass'
      },
      keepPayload: true
    };
    
    fs.writeFileSync(payloadPath, JSON.stringify(payload, null, 2));

    try {
      // Assuming execution-engine.ts can be run directly with a payload path. If not, this might fail.
      const output = execSync(`bun run C:\\Users\\chris\\Desktop\\adamic\\.agents\\scripts\\agent-exec.ts ${payloadPath}`, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
      const match = output.match(/{"CI":.*}/);
      expect(match).not.toBeNull();
      if (match) {
        const envVars = JSON.parse(match[0]);
        expect(envVars.CI).toBe('1');
        expect(envVars.GIT_EDITOR).toBe('true');
        expect(envVars.GIT_ASKPASS).toBe('agent-exec-blocked');
      }
    } catch (e: unknown) {
        // Let's print the error for debugging in case agent-exec.ts is missing
        console.error("Execution failed:", (e as Error).message);
        if ((e as { stderr?: Buffer }).stderr) console.error("stderr:", (e as { stderr?: Buffer }).stderr);
        if ((e as { stdout?: Buffer }).stdout) console.error("stdout:", (e as { stdout?: Buffer }).stdout);
        throw e;
    } finally {
      if (fs.existsSync(payloadPath)) fs.unlinkSync(payloadPath);
    }
  });

  test('Missing global binary: throws a specific ENOENT hint when binary is absent', () => {
    const payloadPath = path.join(import.meta.dir, 'test-missing-binary.json');
    const payload = {
      type: 'command',
      command: 'this-binary-does-not-exist',
      args: ['--help'],
      keepPayload: true
    };
    
    fs.writeFileSync(payloadPath, JSON.stringify(payload, null, 2));

    try {
      execSync(`bun run C:\\Users\\chris\\Desktop\\adamic\\.agents\\scripts\\agent-exec.ts ${payloadPath}`, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
      throw new Error('Should have failed');
    } catch (err: unknown) {
      const e = err as { stderr?: Buffer; stdout?: Buffer; status?: number; message?: string };
      const stderr = e.stderr ? e.stderr.toString() : (e.stdout ? e.stdout.toString() : (e.message || ""));
      expect(stderr).toContain("was not found in PATH or working directory");
      expect((e as { status?: number }).status).toBe(1);
    } finally {
      if (fs.existsSync(payloadPath)) fs.unlinkSync(payloadPath);
    }
  });

});
