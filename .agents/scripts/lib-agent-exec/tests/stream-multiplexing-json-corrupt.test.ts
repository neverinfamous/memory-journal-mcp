import { test, expect } from 'bun:test';
import { IOController } from '../io-controller.js';
import { ChildProcess } from 'node:child_process';
import { ExecPayload } from '../schema.js';

test('JSON envelope should not leave trailing newlines due to regex bug', () => {
    const mockPayload = { expectJsonEnvelope: true, truncateOutputLength: 1000 } as unknown as ExecPayload;
    const mockChild = {
        stdout: { on: () => {}, destroy: () => {} },
        stderr: { on: () => {}, destroy: () => {} }
    } as unknown as ChildProcess;
    
    const io = new IOController(mockChild, mockPayload, process.cwd(), () => {}, () => {});
    
    // Simulate processData adding to pendingStdout
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    io._stdoutTail = '';
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    io.pendingStdout = 'Some output   \n{"status": "success"}   \n'; // Intentional spaces before envelope
    
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    const finalizeStdout = io.finalizeStdout.bind(io);
    const result = finalizeStdout('');
    
    // With bug, it leaves trailing spaces and adds an extra newline
    // With fix, it should strip only the spaces AFTER the envelope, and output exactly 'Some output   \n'
    expect(result).toBe('Some output   \n');
});
