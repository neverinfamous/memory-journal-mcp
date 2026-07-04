import { describe, expect, test } from 'bun:test';
import { IOController } from '../io-controller.js';
import { ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';

class MockReadable extends Readable {
  constructor(private content: string) {
    super();
  }
  _read() {
    this.push(this.content);
    this.push(null);
  }
}

describe('JSON Envelope Leaking', () => {
  test('io-controller should not leak the JSON envelope to stdoutTail', () => {
    const mockChild = new EventEmitter() as ChildProcess;
    const envelope = '{"status":"success","exit_code":0,"data":{"foo":"bar"}}';
    const output = `some random logging\n${envelope}\n`;
    mockChild.stdout = new MockReadable(output) as Readable;
    
    const ioController = new IOController(
      mockChild, { type: 'command', command: 'echo', expectJsonEnvelope: true }, process.cwd(), () => {}, () => {});
    
    ioController.setupStreams();
    
    return new Promise<void>((resolve) => {
      mockChild.stdout!.on('end', () => {
        ioController.flushAll();
        const env = ioController.getParsedEnvelope();
        expect(env).not.toBeNull();
        expect(env!.status).toBe('success');
        expect(ioController.stdoutTail).not.toContain(envelope);
        resolve();
      });
    });
  });

  test('io-controller handles malformed JSON gracefully', () => {
    const mockChild = new EventEmitter() as ChildProcess;
    const output = `some random logging\n{"status":"success","exit_code":0,"data":{broken}\n`;
    mockChild.stdout = new MockReadable(output) as Readable;
    
    const ioController = new IOController(
      mockChild, { type: 'command', command: 'echo', expectJsonEnvelope: true }, process.cwd(), () => {}, () => {});
    
    ioController.setupStreams();
    
    return new Promise<void>((resolve) => {
      mockChild.stdout!.on('end', () => {
        ioController.flushAll();
        const env = ioController.getParsedEnvelope();
        expect(env).toBeNull();
        expect(ioController.stdoutTail).toContain('broken');
        resolve();
      });
    });
  });
});
