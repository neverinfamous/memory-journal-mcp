import { describe, it, expect } from 'bun:test';
import { IOController } from '../io-controller.js';
import { ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { ExecPayload } from '../schema.js';
import { Readable } from 'node:stream';

describe('IOController Output Delay', () => {
  it('should not indefinitely delay output when expectJsonEnvelope is true', () => {
    const fakeProcess = new EventEmitter() as ChildProcess;
    fakeProcess.stdout = new EventEmitter() as Readable;
    fakeProcess.stderr = new EventEmitter() as Readable;
    
    let stalled = false;
    const ioController = new IOController(
      fakeProcess,
      { expectJsonEnvelope: true } as unknown as ExecPayload,
      '/fake/cwd',
      () => { stalled = true; },
      () => {}
    );
    
    ioController.setupStreams();
    
    // Simulate data arriving on stdout
    fakeProcess.stdout!.emit('data', Buffer.from('Line 1\n'));
    
    // The code no longer swallows the last line, so tail should contain "Line 1"
    
    const tail = ioController.stdoutTail;
    expect(tail).toContain('Line 1'); // Verify the bug is fixed
    expect(stalled).toBe(false);
  });
});
