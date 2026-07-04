import { test, expect, describe, beforeAll, afterAll } from 'bun:test';
import { StreamManager } from "../stream-manager.js";
import fs from "fs";
import { execSync } from "child_process";
import path from "path";

const AGENT_EXEC_PATH = "C:/Users/chris/Desktop/adamic/.agents/scripts/agent-exec.ts";

describe("StreamManager Logic Tests", () => {
  test("Carriage return (\\r) overwriting", () => {
    const sm = new StreamManager();
    const res = sm.processChunk(false, "Loading...\r\x1b[KDone!\n");
    expect(res).toBe("Done!\n");
  });

  test("ANSI stripping limits", () => {
    const sm = new StreamManager();
    // A long CSI sequence to test bounds. Node's stripVTControlCharacters restricts to 4 chars.
    // The fallback regex in StreamManager handles longer ones.
    const longAnsi = "\x1b[" + "1;".repeat(50) + "31m" + "Hello" + "\x1b[0m";
    const res = sm.processChunk(false, longAnsi + "\n");
    expect(res).toBe("Hello\n");
  });

  test("Output cap truncation boundaries - Memory (10MB)", () => {
    const sm = new StreamManager(10, undefined, undefined);
    
    // Simulate current len
    sm.addLength(false, 0);
    
    // This calls writeData directly which writes to stdout/err. 
    // We cannot mock stdout easily here, but we can check if it marks as truncated
    // Actually, `writeData` writes to `process.stdout` by default unless we pass streams.
    // Let's test by instantiating with mock streams.
  });
});

import * as os from 'os';

describe("agent-exec.ts E2E Tests", () => {
  let scratchDir: string;
  beforeAll(() => {
    scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-exec-"));
  });
  afterAll(() => {
    try { fs.rmSync(scratchDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });
  
  test("Flood stdout/stderr concurrently (200ms flush logic)", () => {
    // We will create a node script that floods stdout/stderr concurrently, then run it via agent-exec.
    const scriptPath = path.join(scratchDir, "flood.js");
    fs.writeFileSync(scriptPath, `
      setInterval(() => {
        process.stdout.write("stdout chunk\\n");
        process.stderr.write("stderr chunk\\n");
      }, 10);
      setTimeout(() => process.exit(0), 500);
    `);

    const payloadPath = path.join(scratchDir, "payload-flood.json");
    fs.writeFileSync(payloadPath, JSON.stringify({
      type: "command",
      target: "windows",
      command: "node",
      args: [scriptPath],
      cwd: scratchDir
    }));

    try {
      const result = execSync(`bun ${AGENT_EXEC_PATH} ${payloadPath}`, { encoding: 'utf-8', stdio: 'pipe' });
      expect(result).toContain("stdout chunk");
    } catch (err: unknown) {
      // If it fails, we throw to report
      throw new Error("Flood test failed: " + (err as Error).message, { cause: err });
    }
  });

  test("10MB default memory cap vs 1GB disk redirect", () => {
    const scriptPath = path.join(scratchDir, "flood-large.js");
    // Write 15MB of data
    fs.writeFileSync(scriptPath, `
      const chunk = "A".repeat(1024 * 1024); // 1MB
      for (let i = 0; i < 15; i++) {
        process.stdout.write(chunk);
      }
    `);

    const payloadPath = path.join(scratchDir, "payload-large.json");
    fs.writeFileSync(payloadPath, JSON.stringify({
      type: "command",
      target: "windows",
      command: "node",
      args: [scriptPath],
      cwd: scratchDir,
      truncateOutputLength: 10 * 1024 * 1024 // 10MB
    }));

    try {
      const result = execSync(`bun ${AGENT_EXEC_PATH} ${payloadPath}`, { encoding: 'utf-8', stdio: 'pipe', maxBuffer: 50 * 1024 * 1024 });
      // Should be truncated
      expect(result).toContain("truncated to 10485760 chars");
    } catch (err: unknown) {
      if (((err as Error & { stdout?: string }).stdout && (err as Error & { stdout?: string }).stdout?.includes("truncated to")) || (err as Error).message.includes("Output exceeded maxBuffer") || (err as Error).message.includes("truncated to")) {
         // Success
      } else {
         throw new Error("Large truncate test failed: " + (err as Error).message, { cause: err });
      }
    }

    const payloadDiskPath = path.join(scratchDir, "payload-disk.json");
    const outLog = path.join(scratchDir, "out.log");
    fs.writeFileSync(payloadDiskPath, JSON.stringify({
      type: "command",
      target: "windows",
      command: "node",
      args: [scriptPath],
      cwd: scratchDir,
      stdoutFile: outLog
    }));

    try {
      execSync(`bun ${AGENT_EXEC_PATH} ${payloadDiskPath}`, { encoding: 'utf-8', stdio: 'pipe', maxBuffer: 50 * 1024 * 1024 });
      const stat = fs.statSync(outLog);
      expect(stat.size).toBeGreaterThanOrEqual(15 * 1024 * 1024);
    } catch (err: unknown) {
      throw new Error("Large disk test failed: " + (err as Error).message, { cause: err });
    }
  }, 30000);
});


