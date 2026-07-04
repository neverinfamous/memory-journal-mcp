import { describe, expect, test } from 'bun:test';
import { IOController } from '../io-controller.js';
import { ProcessController } from '../process-controller.js';
import { ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';

// Mock stdout to emit JSON strings
class MockReadable extends Readable {
  constructor(private content: string) {
    super();
  }
  _read() {
    this.push(this.content);
    this.push(null);
  }
}

describe('JSON Envelope Support', () => {
  test('io-controller correctly parses valid JSON envelope from stdout tail', () => {
    // Create a mock child process
    const mockChild = new EventEmitter() as ChildProcess;
    mockChild.stdout = new MockReadable('some random logging\n{"status":"success","exitcode":0,"data":{"foo":"bar"}}\n') as Readable;
    
    const ioController = new IOController(
      mockChild, { type: 'command', command: 'echo', expectJsonEnvelope: true }, process.cwd(), () => {}, () => {});
    
    ioController.setupStreams();
    
    // Simulate end of stream to ensure buffer is flushed
    return new Promise<void>((resolve) => {
      mockChild.stdout!.on('end', () => {
        ioController.flushAll();
        const env = ioController.getParsedEnvelope();
        expect(env).not.toBeNull();
        expect(env!.status).toBe('success');
        expect((env!.data as Record<string, unknown>).foo).toBe('bar');
        resolve();
      });
    });
  });

  test('process-controller enforces failure if JSON envelope says error but exit code is 0', async () => {
    // In a real execution, we might do "node -e 'console.log(...)'"
    const payload = {
      type: 'eval' as const,
      code: 'console.log(JSON.stringify({status: "error", exitcode: 1, data: {reason: "test failure"}}));',
      expectJsonEnvelope: true,
    };
    
    const pc = new ProcessController(payload, process.cwd(), 'node', ['-e', payload.code], process.env as Record<string, string | undefined>, null);
    
    // We cannot easily test the exact exit call because process.exit is called inside handleFinish.
    // However, if we replace process.exit temporarily:
    const originalExit = process.exit;
    let exitCode: number | undefined;
      (process as unknown as { exit: typeof process.exit }).exit = (code?: string | number | null | undefined): never => {
        if (exitCode === undefined) exitCode = code as number | undefined;
        return undefined as unknown as never;
      };
    
    pc.start();
    
    // Wait for it to finish
    await new Promise<void>((resolve) => {
      const check = setInterval(() => {
        if (exitCode !== undefined) {
          clearInterval(check);
          resolve();
        }
      }, 50);
    });
    
    process.exit = originalExit;
    // Expected exit code is 1 because the envelope overrides the node process exit code (which was 0)
    expect(exitCode).toBe(1);
  });

  test('io-controller degrades gracefully for valid JSON that is not a valid envelope', () => {
    const mockChild = new EventEmitter() as ChildProcess;
    const fakeEnvelope = '{"status":"in-progress","data":{"foo":"bar"}}';
    const output = `some random logging\n${fakeEnvelope}\n`;
    mockChild.stdout = new MockReadable(output) as Readable;
    
    const ioController = new IOController(
      mockChild, { type: 'command', command: 'echo', expectJsonEnvelope: true }, process.cwd(), () => {}, () => {});
    
    ioController.setupStreams();
    
    return new Promise<void>((resolve) => {
      mockChild.stdout!.on('end', () => {
        ioController.flushAll();
        const env = ioController.getParsedEnvelope();
        expect(env).toBeNull();
        expect(ioController.stdoutTail).toContain(fakeEnvelope);
        resolve();
      });
    });
  });
});
