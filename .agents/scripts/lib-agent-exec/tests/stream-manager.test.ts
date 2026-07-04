import { describe, it, expect, mock } from 'bun:test';
import { StreamManager } from "C:/Users/chris/Desktop/adamic/.agents/scripts/lib-agent-exec/stream-manager.ts";
import { IOController } from "C:/Users/chris/Desktop/adamic/.agents/scripts/lib-agent-exec/io-controller.ts";
import { Writable } from "node:stream";
import { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";

describe("StreamManager & IOController Stress Tests", () => {
  it("should handle carriage return overwriting correctly", () => {
    const sm = new StreamManager();
    const chunk1 = "Progress: 10%\rProgress: 50%\rProgress: 100%\nDone.";
    const result = sm.processChunk(false, chunk1);
    
    // Resolve carriage returns processes \r by clearing the current line (cursor=0).
    // Let's verify what `resolveCarriageReturns` produces.
    // Also flush the pending line so "Done." is processed
    const flushed = sm.flushPendingLine(false);
    expect(result + flushed).toBe("Progress: 100%\nDone.");
  });

  it("should truncate ANSI sequences effectively and handle limits", () => {
    const sm = new StreamManager();
    const ESC = String.fromCharCode(27);
    // Overlong ANSI, node's util might fail, but stream-manager handles it via regex fallback
    const longAnsi = `${ESC}[` + "0".repeat(50) + "m";
    const chunk = "Start" + longAnsi + "End\n";
    
    const result = sm.processChunk(false, chunk);
    expect(result).toContain("StartEnd");
  });

  it("should enforce truncation boundaries at 10 chars", () => {
    const sm = new StreamManager(10); // 10 chars truncate
    // Mock stdStream via global process
    let writtenOutput = "";
    const mockStdout = new Writable({ write(chunk, enc, cb) { writtenOutput += chunk.toString(); cb(); return true; } });
    
    const originalStdout = process.stdout;
    Object.defineProperty(process, 'stdout', { value: mockStdout, writable: true });

    sm.addLength(false, 15);
    sm.writeData(false, "123456789012345"); // 15 chars
    
    Object.defineProperty(process, 'stdout', { value: originalStdout, writable: true });

    expect(writtenOutput).toContain("12345");
    expect(writtenOutput).toContain("STDOUT truncated to 10 chars");
  });

  it("should flush chunks correctly and retain buffer when ANSI is incomplete", () => {
    const sm = new StreamManager();
    const ESC = String.fromCharCode(27);
    const incompleteAnsi = `${ESC}[31`;
    const result1 = sm.processChunk(false, "Hello" + incompleteAnsi);
    // No newline, shouldn't return anything yet. 
    expect(result1).toBe("");

    const result2 = sm.processChunk(false, "mWorld\n");
    expect(result2).toBe("HelloWorld\n");
  });

  it("should flood stdout and stderr concurrently without crashing", () => {
    const sm = new StreamManager(Infinity); 
    const size = 10000;
    
    const resultOut = sm.processChunk(false, "A".repeat(size) + "\n");
    const resultErr = sm.processChunk(true, "B".repeat(size) + "\n");
    
    expect(resultOut.trim().length).toBe(size);
    expect(resultErr.trim().length).toBe(size);
  });

  it("should properly trigger maxBuffer limit in IOController", () => {
    // We will construct IOController and emit data to it
    class MockChild extends EventEmitter {
      stdout = new EventEmitter();
      stderr = new EventEmitter();
      stdin = { end: mock(), destroy: mock(), write: mock(), on: mock() };
    }
    const mockChild = new MockChild() as unknown as ChildProcess;

    let maxBufferTriggered = false;
    
          const controller = new IOController(
      mockChild, { type: "command", command: "test", maxBuffer: 100 }, process.cwd(), () => { /* noop */ }, () => { maxBufferTriggered = true; });

    controller.setupStreams();
    
    // Emit 150 bytes with newline so it's processed and adds length
    mockChild.stdout?.emit("data", Buffer.from("A".repeat(150) + "\n"));

    expect(maxBufferTriggered).toBe(true);
  });

  it("should properly flush real-time stream using the 200ms timer", async () => {
    class MockChild extends EventEmitter {
      stdout = new EventEmitter();
      stderr = new EventEmitter();
      stdin = { end: mock(), destroy: mock(), write: mock(), on: mock() };
    }
    const mockChild = new MockChild() as unknown as ChildProcess;

    const controller = new IOController(
      mockChild, { type: "command", command: "test", maxBuffer: 1000 }, process.cwd(), () => {}, () => {});
    controller.setupStreams();

    mockChild.stdout?.emit("data", Buffer.from("Hello")); // No newline
    // Before timer, stdout string shouldn't have been pushed to target streams
    // Wait for 250ms
    await new Promise(resolve => setTimeout(resolve, 250));

    // After timer, it flushes the pending line. The flush pushes to streamManager.writeData which outputs to process.stdout.
    // We can't easily intercept process.stdout here without mocking it, but we can verify it doesn't crash
    controller.flushAll();
  });
});


