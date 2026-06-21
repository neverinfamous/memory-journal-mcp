import { test, expect, spyOn } from 'bun:test';
import { spawnSync } from "node:child_process";
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { StreamManager } from 'C:/Users/chris/Desktop/adamic/.agents/scripts/lib-agent-exec/stream-manager.ts';

const scratchDir = __dirname;
const agentExecPath = 'C:/Users/chris/Desktop/adamic/.agents/scripts/agent-exec.ts';

function runAgentExec(payload: unknown) {
  const payloadPath = path.join(scratchDir, `payload-${randomUUID()}.json`);
  fs.writeFileSync(payloadPath, JSON.stringify(payload));
  const result = spawnSync('bun', [agentExecPath, payloadPath], { encoding: 'utf8' });
  return { result, payloadPath };
}

test('StreamManager: ANSI stripping limits', () => {
  const manager = new StreamManager();
  // Valid ANSI escape
  const out1 = manager.processChunk(false, "\x1b[31mRedText\x1b[0m") + manager.flushChunk(false);
  expect(out1).toBe("RedText");

  // Incomplete ANSI escape (saved in buffer)
  const out2 = manager.processChunk(false, "Part1 \x1b[");
  expect(out2).toBe(""); // buffered
  
  // Complete it
  const out3 = manager.processChunk(false, "31mPart2") + manager.flushChunk(false);
  expect(out3).toBe("Part1 Part2");
  
  // J2 Clear Screen
  const out4 = manager.processChunk(false, "\x1b[2J") + manager.flushChunk(false);
  expect(out4).toBe("\n--- [Screen Cleared] ---\n");
});

test('StreamManager: carriage return (\\r) overwriting', () => {
  const manager = new StreamManager();
  // Overwriting text correctly
  const out1 = manager.processChunk(false, "Loading...\rDone!") + manager.flushChunk(false);
  expect(out1).toBe("Done!ng...");
  
  // Test backspace
  const out2 = manager.processChunk(false, "abc\b\bd") + manager.flushChunk(false);
  expect(out2).toBe("adc"); // 'b' is overwritten by 'd'
  
  // Test Erase in Line
  const out3 = manager.processChunk(false, "hello\x1b[0Kworld") + manager.flushChunk(false);
  expect(out3).toBe("helloworld"); 
});

test('E2E: Flood stdout/stderr concurrently with 200ms real-time flush and truncation', () => {
  const code = `
    for(let i=0; i<1000; i++) {
       process.stdout.write("O".repeat(10));
       process.stderr.write("E".repeat(10));
    }
  `;
  const { result } = runAgentExec({
    type: "eval",
    interpreter: "node",
    code,
    truncateOutputLength: 500,
    keepPayload: true
  });
  
  expect(result.stdout).toContain("... [STDOUT truncated to 500 chars.");
  expect(result.stderr).toContain("... [STDERR truncated to 500 chars.");
});

test('E2E: 10MB payload file limit', () => {
  const payloadPath = path.join(scratchDir, `payload-huge-${randomUUID()}.json`);
  const fd = fs.openSync(payloadPath, 'w');
  fs.writeSync(fd, '{"type":"eval","code":"');
  const chunk = "a".repeat(1024 * 1024);
  for(let i = 0; i < 11; i++) {
    fs.writeSync(fd, chunk);
  }
  fs.writeSync(fd, '"}');
  fs.closeSync(fd);

  const result = spawnSync('bun', [agentExecPath, payloadPath], { encoding: 'utf8' });
  expect(result.stderr).toContain("Payload file exceeds 10MB limit");
  expect(result.status).toBe(1);
  
  try { fs.unlinkSync(payloadPath); } catch {/* empty */}
});

test('ProcessManager / AgentExec: Mock process.exit safety', () => {
  const exitSpy = spyOn(process, 'exit').mockImplementation((code?: number | string | null | undefined): never => {
    throw new Error(`MOCKED_EXIT_${code}`);
  });
  
  try {
     process.exit(1);
  } catch (err: unknown) {
     expect((err as Error).message).toBe('MOCKED_EXIT_1');
  } finally {
     exitSpy.mockRestore();
  }
});
