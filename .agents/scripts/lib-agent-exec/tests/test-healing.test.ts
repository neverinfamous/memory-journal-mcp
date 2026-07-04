import { describe, it, expect, spyOn, beforeEach, afterEach } from 'bun:test';
import { ProcessController } from '../process-controller.ts';

describe('Auto-Healing Heuristics', () => {
    let mockExit: ReturnType<typeof spyOn>;
    let mockError: ReturnType<typeof spyOn>;

    beforeEach(() => {
        mockExit = spyOn(process, 'exit').mockImplementation((() => {}) as unknown as never);
        mockError = spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        mockExit.mockRestore();
        mockError.mockRestore();
    });

    it('should trigger shell built-in healing hint for "ren"', async () => {
        const payload = { type: 'command', command: 'ren', args: ['-c', 'hello'] } as unknown as never;
        const controller = new ProcessController(payload, process.cwd(), 'ren', ['-c', 'hello'], process.env, null);
        
        controller.start();
        
        await new Promise(r => setTimeout(r, 500));

        const calls = mockError.mock.calls.map((c: unknown[]) => c.join(' '));
        const hintFound = calls.some((c: string) => c.includes('shell built-in, not an executable file'));
        expect(hintFound).toBe(true);
    });

    it('should trigger MAX_PATH hint if cwd is long', async () => {
        const longPath = 'C:\\' + 'a'.repeat(260);
        const payload = { type: 'command', command: 'fake-cmd-that-doesnt-exist', args: ['-c', 'hello'] } as unknown as never;
        const controller = new ProcessController(payload, longPath, 'fake-cmd-that-doesnt-exist', ['-c', 'hello'], process.env, null);
        
        controller.start();
        
        await new Promise(r => setTimeout(r, 500));

        const calls = mockError.mock.calls.map((c: unknown[]) => c.join(' '));
        const hintFound = calls.some((c: string) => c.includes('exceeds the Windows MAX_PATH limit (260 characters)'));
        expect(hintFound).toBe(true);
    });
});


