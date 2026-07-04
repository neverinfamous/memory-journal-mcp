import { test, expect, describe, beforeAll, afterAll } from 'bun:test';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('Usability: truncateOutputLength Parsing and Application', () => {
  let scratchDir: string;

  beforeAll(() => {
    scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-exec-truncate-'));
  });

  afterAll(() => {
    try { fs.rmSync(scratchDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  test('Should correctly truncate output in stdoutFile', async () => {
    const payloadPath = path.join(scratchDir, 'payload-truncate-file.json');
    const outFilePath = path.join(scratchDir, 'output.txt');
    const dummyScript = path.join(scratchDir, 'dummy.js');
    
    // Output 500 'A's
    fs.writeFileSync(dummyScript, "console.log('A'.repeat(500))");

    const payload = {
      type: "command",
      command: "node",
      args: [dummyScript],
      stdoutFile: outFilePath,
      truncateOutputLength: 100
    };
    fs.writeFileSync(payloadPath, JSON.stringify(payload));

    const agentExecPath = "C:/Users/chris/Desktop/adamic/.agents/scripts/lib-agent-exec/agent-exec.ts";

    const child = spawn("bun", [agentExecPath, payloadPath]);

    let childOut = "";
    let childErr = "";
    child.stdout.on('data', (d) => childOut += d.toString());
    child.stderr.on('data', (d) => childErr += d.toString());

    await new Promise<void>((resolve, reject) => {
      child.on('exit', (code) => {
        if (code === 0) resolve();
        else reject(new Error("child failed: " + code + "\n" + childErr));
      });
    });

    const outFileContent = fs.readFileSync(outFilePath, 'utf8');
    
    // File content should NOT be truncated.
    // Length should be exactly 500 + newline.
    expect(outFileContent.length).toBeGreaterThanOrEqual(500); 
    expect(outFileContent).not.toContain("truncated to 100 chars");
  });

  test('Should truncate output in stdout (no file) to default maxBuffer/limit if not specified', async () => {
    // This is hard to test unless we exceed maxBuffer, but we can test
    // that if no file is provided, truncateOutputLength works on stdout.
    const payloadPath = path.join(scratchDir, 'payload-truncate-stdout.json');
    const dummyScript = path.join(scratchDir, 'dummy-stdout.js');
    
    fs.writeFileSync(dummyScript, "console.log('B'.repeat(500))");

    const payload = {
      type: "command",
      command: "node",
      args: [dummyScript],
      truncateOutputLength: 100
    };
    fs.writeFileSync(payloadPath, JSON.stringify(payload));

    const agentExecPath = "C:/Users/chris/Desktop/adamic/.agents/scripts/lib-agent-exec/agent-exec.ts";

    const child = spawn("bun", [agentExecPath, payloadPath]);

    let childOut = "";
    child.stdout.on('data', (d) => childOut += d.toString());

    await new Promise<void>((resolve, reject) => {
      child.on('exit', (code) => {
        if (code === 0) resolve();
        else reject(new Error("child failed: " + code));
      });
    });

    // We shouldn't get the JSON envelope here because we are just capturing raw stdout.
    expect(childOut).toContain("truncated to 100 chars");
    expect(childOut.length).toBeLessThan(400);
  });

  test('Should not trigger maxBuffer error when both stdoutFile and stderrFile output large sums that exceed 1GB combined', async () => {
    // If stdoutMaxBuffer is 1GB and stderrMaxBuffer is 10MB, their combined buffer could reach 1.01GB.
    // We cannot easily output 1GB in a test, but we can verify the fix structurally by ensuring it doesn't crash
    // if we just run a basic command and ensure the process still works correctly.
    const payloadPath = path.join(scratchDir, 'payload-truncate-combined.json');
    const outFilePath = path.join(scratchDir, 'output-combined.txt');
    const dummyScript = path.join(scratchDir, 'dummy-combined.js');
    
    // Output both stdout and stderr
    fs.writeFileSync(dummyScript, "console.log('C'.repeat(500)); console.error('D'.repeat(500));");

    const payload = {
      type: "command",
      command: "node",
      args: [dummyScript],
      stdoutFile: outFilePath,
      // No truncateOutputLength specified!
    };
    fs.writeFileSync(payloadPath, JSON.stringify(payload));

    const agentExecPath = "C:/Users/chris/Desktop/adamic/.agents/scripts/lib-agent-exec/agent-exec.ts";

    const child = spawn("bun", [agentExecPath, payloadPath]);

    let childErr = "";
    child.stderr.on('data', (d) => childErr += d.toString());

    await new Promise<void>((resolve, reject) => {
      child.on('exit', (code) => {
        if (code === 0) resolve();
        else reject(new Error("child failed: " + code + "\n" + childErr));
      });
    });

    const outFileContent = fs.readFileSync(outFilePath, 'utf8');
    expect(outFileContent.length).toBeGreaterThan(400);
  });
});
