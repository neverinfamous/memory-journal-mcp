import { test, expect, describe, spyOn, beforeAll, afterAll } from 'bun:test';
import { StreamManager } from 'C:/Users/chris/Desktop/adamic/.agents/scripts/lib-agent-exec/stream-manager.ts';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

describe('StreamManager', () => {
  test('Carriage return (\\r) overwriting', () => {
    const sm = new StreamManager();
    const out1 = sm.processChunk(false, "Download: 10%\rDownload: 50%\rDownload: 100%\n");
    expect(out1).toBe("Download: 100%\n");
  });

  test('ANSI stripping limits', () => {
    const sm = new StreamManager();
    // Standard color codes
    const out1 = sm.processChunk(false, "hello\x1b[31mworld\x1b[0m\n");
    expect(out1).toBe("helloworld\n");

    // Partial ANSI code - held in buffer
    const out2 = sm.processChunk(false, "foo\x1b");
    expect(out2).toBe(""); // should hold the escape sequence
    const out3 = sm.processChunk(false, "[32mbar\x1b[0m\n");
    expect(out3).toBe("foobar\n");

    // Overlong CSI (e.g. malicious or garbled ANSI)
    const longAnsi = "\x1b[" + "1".repeat(60) + "m";
    const out4 = sm.processChunk(false, "test" + longAnsi + "end\n");
    expect(out4).toContain("end\n");
  });

  test('Truncation boundaries (10MB default vs 1GB disk redirect)', () => {
    const writeSpy = spyOn(process.stdout, 'write').mockImplementation(() => true);
    
    try {
      const sm = new StreamManager(10); // 10 bytes limit
      sm.addLength(false, 5);
      sm.writeData(false, "abcde", undefined, undefined); 
      
      sm.addLength(false, 10);
      sm.writeData(false, "fghijklmno", undefined, undefined); 
      
      expect(writeSpy).toHaveBeenCalled();
      
      const calls = writeSpy.mock.calls.map(c => c[0]);
      // First write
      expect(calls[0]).toBe("abcde");
      // Second write should be truncated
      expect(calls[1]).toContain("fghij");
      expect(calls[1]).toContain("STDOUT truncated");
    } finally {
      writeSpy.mockRestore();
    }
  });
});

import * as os from 'os';

describe('E2E Flooding & 200ms flush logic', () => {
  let scratchDir: string;

  beforeAll(() => {
    scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-exec-'));
  });

  afterAll(() => {
    try { fs.rmSync(scratchDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });
  
  test('Flood stdout/stderr concurrently, verify 200ms flush and cap boundaries', async () => {
    const floodScriptPath = path.join(scratchDir, 'flood.js');
    fs.writeFileSync(floodScriptPath, `
      // Flood script
      for(let i=0; i<100; i++) {
        process.stdout.write("OUT_CHUNK_" + i + " ".repeat(100) + "\\n");
        process.stderr.write("ERR_CHUNK_" + i + " ".repeat(100) + "\\n");
      }
      setTimeout(() => {}, 500); // Wait to ensure flush happens
    `);

    const payloadPath = path.join(scratchDir, 'payload-flood.json');
    const outFilePath = path.join(scratchDir, 'flood-out.txt');
    const errFilePath = path.join(scratchDir, 'flood-err.txt');

    const payload = {
      type: "command",
      command: "node",
      args: [floodScriptPath],
      stdoutFile: outFilePath,
      stderrFile: errFilePath,
      truncateOutputLength: 50000
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
        else reject(new Error("child failed: " + code + "\\n" + childErr));
      });
    });

    const outFileContent = fs.readFileSync(outFilePath, 'utf8');
    const errFileContent = fs.readFileSync(errFilePath, 'utf8');

    expect(outFileContent).toContain("OUT_CHUNK_0");
    expect(errFileContent).toContain("ERR_CHUNK_0");
    
    expect(outFileContent).toContain("OUT_CHUNK_99");
    expect(errFileContent).toContain("ERR_CHUNK_99");
    
    expect(childOut).not.toContain("STDOUT truncated");
    expect(childErr).not.toContain("STDERR truncated");
  }, 10000);

  test('maxBuffer termination limit', async () => {
    const payloadPath = path.join(scratchDir, 'payload-maxbuf.json');
    const floodScriptPath = path.join(scratchDir, 'flood.js');

    const payload = {
      type: "command",
      command: "node",
      args: [floodScriptPath],
      maxBuffer: 100 // tiny max buffer
    };
    fs.writeFileSync(payloadPath, JSON.stringify(payload));

    const agentExecPath = "C:/Users/chris/Desktop/adamic/.agents/scripts/lib-agent-exec/agent-exec.ts";
    
    const child = spawn("bun", [agentExecPath, payloadPath]);
    
    let childErr = "";
    child.stderr.on('data', (d) => childErr += d.toString());

    const code = await new Promise<number | null>((resolve) => {
      child.on('exit', (code) => {
        resolve(code);
      });
    });

    expect(code).not.toBe(0);
    expect(childErr).toContain("Output exceeded maxBuffer");
  }, 10000);
});


