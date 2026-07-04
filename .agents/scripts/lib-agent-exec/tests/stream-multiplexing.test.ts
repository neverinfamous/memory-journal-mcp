import { expect, test, describe, spyOn, afterEach, beforeEach } from 'bun:test';
import { StreamManager } from "../stream-manager.ts";
import { IOController } from "../io-controller.ts";
import { PassThrough } from "node:stream";

describe("StreamManager logic", () => {
  let processStdoutWriteSpy: import("bun:test").Mock<typeof process.stdout.write>;
  let processStderrWriteSpy: import("bun:test").Mock<typeof process.stderr.write>;

  beforeEach(() => {
    processStdoutWriteSpy = spyOn(process.stdout, "write").mockImplementation(() => true);
    processStderrWriteSpy = spyOn(process.stderr, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    processStdoutWriteSpy.mockRestore();
    processStderrWriteSpy.mockRestore();
  });

  test("carriage return (\r) overwriting", () => {
    const sm = new StreamManager();
    const chunk = sm.processChunk(false, "Loading...\rDone!\n");
    expect(chunk).toBe("Done!ng...\n");
  });

  test("ANSI clearing (\\x1B[2K) overwriting", () => {
    const sm = new StreamManager();
    const chunk = sm.processChunk(false, "Loading...\x1b[2KDone!\n");
    expect(chunk).toBe("Done!\n");
  });

  test("ANSI stripping edge cases", () => {
    const sm = new StreamManager();
    // Incomplete ANSI across chunks
    const chunk1 = sm.processChunk(false, "Hello\x1b");
    expect(chunk1).toBe(""); // Pending
    const chunk2 = sm.processChunk(false, "[31mWorld\n");
    expect(chunk2).toBe("HelloWorld\n");

    // Overlong ANSI limit
    let longAnsi = "\x1b[";
    for(let i=0; i<60; i++) longAnsi += "0;";
    longAnsi += "m";
    const chunk3 = sm.processChunk(false, `Test${longAnsi}!\n`);
    // Node stripVTControlCharacters only handles 4 numbers max. StreamManager tries to handle longer.
    expect(chunk3).toBe("Test!\n");
  });

  test("truncation cap to process.stdout", () => {
    let written = "";
    processStdoutWriteSpy.mockImplementation((str: string) => {
      written += str;
      return true;
    });

    const sm = new StreamManager(10);
    // Write 5 bytes
    sm.addLength(false, 5);
    sm.writeData(false, "12345");
    expect(written).toBe("12345");

    // Write 10 bytes more
    sm.addLength(false, 10);
    sm.writeData(false, "67890abcde");
    
    // total length is now 15. The limit is 10.
    // overage = 15 - 10 = 5. allowedLength = 10 - 5 = 5.
    // toWrite = "67890abcde".substring(0, 5) = "67890"
    expect(written).toContain("67890");
    expect(written).toContain("truncated to 10 chars");
    
    // After truncation, further writes should be ignored
    written = "";
    sm.addLength(false, 5);
    sm.writeData(false, "fffff");
    expect(written).toBe("");
  });
});

describe("IOController real-time flush and limits", () => {
  let processStdoutWriteSpy: import("bun:test").Mock<typeof process.stdout.write>;
  let processStderrWriteSpy: import("bun:test").Mock<typeof process.stderr.write>;

  beforeEach(() => {
    processStdoutWriteSpy = spyOn(process.stdout, "write").mockImplementation(() => true);
    processStderrWriteSpy = spyOn(process.stderr, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    processStdoutWriteSpy.mockRestore();
    processStderrWriteSpy.mockRestore();
  });

  test("200ms real-time flush logic", async () => {
    // We mock child process streams
    const mockChild = {
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      stdin: new PassThrough(),
    } as unknown as import("child_process").ChildProcess;

            
    const controller = new IOController(mockChild, { type: "command", target: "windows", command: "test", truncateOutputLength: 100 }, process.cwd(), () => {  }, () => {  });
    controller.setupStreams();

    let written = "";
    processStdoutWriteSpy.mockImplementation((str: string) => {
      written += str;
      return true;
    });

    // Send a chunk without newline
    (mockChild.stdout as import("stream").PassThrough).write("Hello");
    
    // Wait for the 200ms flush
    await new Promise(r => setTimeout(r, 250));
    
    // Check if it got flushed to stdout
    expect(written).toBe("Hello");
    
    controller.destroyStreams();
  });

  test("Output cap truncation boundaries (10MB default vs 1GB disk redirect)", async () => {
     // This tests the maxBuffer evaluation.
     const mockChild = {
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      stdin: new PassThrough(),
    } as unknown as import("child_process").ChildProcess;

    let maxBufferReason = "";
    
    const controller = new IOController(mockChild, { type: "command", target: "windows", command: "test", stdoutFile: "C:/Users/chris/.gemini/antigravity/brain/456777d2-7df7-48c4-a849-4625d3c7aae2/scratch/dummy.log" }, process.cwd(), () => {}, (r) => { maxBufferReason = r; });
    controller.setupStreams();

    const controller2 = new IOController(mockChild, { type: "command", target: "windows", command: "test", maxBuffer: 100 }, process.cwd(), () => {}, (r) => { maxBufferReason = r; });
    controller2.setupStreams();

    (mockChild.stdout as import("stream").PassThrough).write("A".repeat(101) + "\n");
    await new Promise(r => setTimeout(r, 10)); // wait for stream 'data' event
    
    expect(maxBufferReason).toContain("exceeded maxBuffer");

    await controller.closeFileStreams();
    await controller2.closeFileStreams();
    controller.destroyStreams();
    controller2.destroyStreams();
  });
  test("maxBuffer is evaluated against bounded length when truncateOutputLength is set", async () => {
     const mockChild = {
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      stdin: new PassThrough(),
    } as unknown as import("child_process").ChildProcess;

    let maxBufferReason = "";
    
    const controller = new IOController(mockChild, { type: "command", target: "windows", command: "test", maxBuffer: 100, truncateOutputLength: 50 }, process.cwd(), () => {}, (r) => { maxBufferReason = r; });
    controller.setupStreams();

    (mockChild.stdout as import("stream").PassThrough).write("A".repeat(150) + "\n");
    await new Promise(r => setTimeout(r, 10)); // wait for stream 'data' event
    
    expect(maxBufferReason).toBe(""); // should not trigger maxBuffer

    await controller.closeFileStreams();
    controller.destroyStreams();
  });
});


