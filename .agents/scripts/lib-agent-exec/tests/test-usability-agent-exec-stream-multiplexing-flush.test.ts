import { expect, test } from 'bun:test';
import { IOController } from '../io-controller.js';
import { PassThrough } from 'node:stream';
import { ChildProcess } from 'node:child_process';

test('Real-time flush test', async () => {
    const mockChild = {
        stdout: new PassThrough(),
        stderr: new PassThrough(),
        stdin: new PassThrough(),
    } as unknown as ChildProcess;

    const controller = new IOController(
        mockChild,
        { type: "command", target: "windows", command: "test", expectJsonEnvelope: true },
        process.cwd(),
        () => {},
        () => {}
    );
    controller.setupStreams();

    const originalWrite = process.stdout.write;
    let written = '';
    process.stdout.write = ((str: string | Uint8Array, ..._args: unknown[]) => {
        written += str.toString();
        return true;
    }) as unknown as typeof process.stdout.write;

    try {
        const stdout = mockChild.stdout as PassThrough;
        stdout.write('A');

        // wait 300ms
        await new Promise(r => setTimeout(r, 300));
        
        expect(written).toBe('A');

        stdout.write('B');
        await new Promise(r => setTimeout(r, 300));
        expect(written).toBe('AB');
    } finally {
        process.stdout.write = originalWrite;
        controller.destroyStreams();
    }
});
