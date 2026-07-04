import { test, expect, describe, beforeAll, afterAll } from 'bun:test';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('Usability: stderrFile Parsing and Application', () => {
  let scratchDir: string;

  beforeAll(() => {
    scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-exec-usability-stderr-'));
  });

  afterAll(() => {
    try { fs.rmSync(scratchDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  test('Should correctly redirect stderr to stderrFile', async () => {
    const payloadPath = path.join(scratchDir, 'payload-stderr.json');
    const errFilePath = path.join(scratchDir, 'error.txt');
    const dummyScript = path.join(scratchDir, 'dummy.js');
    fs.writeFileSync(dummyScript, "console.error('HELLO_STDERR_FILE')");

    const payload = {
      type: "command",
      command: "node",
      args: [dummyScript],
      stderrFile: errFilePath
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

    expect(fs.existsSync(errFilePath)).toBe(true);
    const errFileContent = fs.readFileSync(errFilePath, 'utf8');
    expect(errFileContent).toContain('HELLO_STDERR_FILE');
  });

  test('Should resolve relative stderrFile against payload cwd', async () => {
    const payloadPath = path.join(scratchDir, 'payload-cwd-stderr.json');
    const childCwd = path.join(scratchDir, 'child-dir');
    fs.mkdirSync(childCwd, { recursive: true });
    
    const dummyScript = path.join(scratchDir, 'dummy2.js');
    fs.writeFileSync(dummyScript, "console.error('HELLO_CWD_FILE')");

    const payload = {
      type: "command",
      command: "node",
      args: [dummyScript],
      cwd: childCwd,
      stderrFile: "relative-output-err.txt"
    };
    fs.writeFileSync(payloadPath, JSON.stringify(payload));

    const agentExecPath = "C:/Users/chris/Desktop/adamic/.agents/scripts/lib-agent-exec/agent-exec.ts";

    const child = spawn("bun", [agentExecPath, payloadPath]);

    await new Promise<void>((resolve, reject) => {
      child.on('exit', (code) => {
        if (code === 0) resolve();
        else reject(new Error("child failed: " + code));
      });
    });

    const expectedOutFilePath = path.join(childCwd, 'relative-output-err.txt');
    expect(fs.existsSync(expectedOutFilePath)).toBe(true);
    
    const outFileContent = fs.readFileSync(expectedOutFilePath, 'utf8');
    expect(outFileContent).toContain('HELLO_CWD_FILE');
  });
});
