import { describe, it, expect, spyOn, afterEach, beforeEach } from 'bun:test';
import { systemInterceptor } from '../interceptors/system-interceptor.ts';
import { ExecPayload } from '../schema.ts';

describe('System Interceptor: WSL2 Pipe Handling', () => {
    let consoleErrorSpy: import("bun:test").Mock<(...args: unknown[]) => unknown>;
    let processExitSpy: import("bun:test").Mock<(code?: string | number | null | undefined) => never>;

    beforeEach(() => {
        consoleErrorSpy = spyOn(console, 'error').mockImplementation(() => {});
        processExitSpy = spyOn(process, 'exit').mockImplementation((code?: number) => {
            throw new Error(`ProcessExitMock:${code}`);
        });
    });

    afterEach(() => {
        consoleErrorSpy.mockRestore();
        processExitSpy.mockRestore();
    });

    it('should NOT block pipeline operators when target is wsl2', () => {
        const payload: ExecPayload = { 
            type: 'command', 
            command: 'echo', 
            args: ['$(echo', 'start', '&&', 'echo', 'end)'],
            target: 'wsl2'
        };
        let didExit = false;
        try {
            systemInterceptor({ cmdBasename: 'echo', args: payload.args as string[], envOverrides: {}, payload });
        } catch (e: unknown) {
            if (e instanceof Error && e.message.startsWith('ProcessExitMock')) didExit = true;
        }
        expect(didExit).toBe(false);
    });
});
