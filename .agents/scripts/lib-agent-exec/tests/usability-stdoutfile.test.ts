import { test, expect, describe, beforeAll, afterAll } from 'bun:test';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('Usability: stdoutFile Parsing and Application', () => {
  let scratchDir: string;

  beforeAll(() => {
    scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-exec-usability-'));
  });

  afterAll(() => {
    try { fs.rmSync(scratchDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  test('Should correctly redirect stdout to stdoutFile', async () => {
    const payloadPath = path.join(scratchDir, 'payload-stdout.json');
    const outFilePath = path.join(scratchDir, 'output.txt');
    const dummyScript = path.join(scratchDir, 'dummy.js');
    fs.writeFileSync(dummyScript, "console.log('HELLO_STDOUT_FILE')");

    const payload = {
      type: "command",
      command: "node",
      args: [dummyScript],
      stdoutFile: outFilePath
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
    expect(outFileContent).toContain('HELLO_STDOUT_FILE');
    // And standard output from agent-exec should not have the dummy text directly piped to its own standard output if redirected? Or maybe it just multiplexes?
    // According to agent-exec logic, when stdoutFile is provided, the data is appended there. The actual STDOUT may just report STDOUT truncated or similar if it overflows, or it might just stream normally.
    // Let's just check that it creates the file.
  });

  test('Should resolve relative stdoutFile against payload cwd', async () => {
    const payloadPath = path.join(scratchDir, 'payload-cwd-stdout.json');
    const childCwd = path.join(scratchDir, 'child-dir');
    fs.mkdirSync(childCwd, { recursive: true });
    
    const dummyScript = path.join(scratchDir, 'dummy.js');
    fs.writeFileSync(dummyScript, "console.log('HELLO_CWD_FILE')");

    const payload = {
      type: "command",
      command: "node",
      args: [dummyScript],
      cwd: childCwd,
      stdoutFile: "relative-output.txt"
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

    const expectedOutFilePath = path.join(childCwd, 'relative-output.txt');
    expect(fs.existsSync(expectedOutFilePath)).toBe(true);
    
    const outFileContent = fs.readFileSync(expectedOutFilePath, 'utf8');
    expect(outFileContent).toContain('HELLO_CWD_FILE');
  });
});
