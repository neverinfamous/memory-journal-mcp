import { describe, it, expect, spyOn, afterEach, beforeEach } from 'bun:test';
import { systemInterceptor } from '../interceptors/system-interceptor.ts';
import { ExecPayload } from '../schema.ts';

describe('System Interceptor: False Negatives and Positives', () => {
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

    it('should block operators with spaces (false negative)', () => {
        const payload: ExecPayload = { type: 'command', command: 'npm', args: ['run build && npm run start'] };
        let didExit = false;
        try {
            systemInterceptor({ cmdBasename: 'npm', args: payload.args as string[], envOverrides: {}, payload });
        } catch (e: unknown) {
            if (e instanceof Error && e.message.startsWith('ProcessExitMock')) didExit = true;
        }
        expect(didExit).toBe(true);
    });

    it('should NOT block operators that are part of a valid string (false positive)', () => {
        const payload: ExecPayload = { type: 'command', command: 'git', args: ['commit', '-m', 'fix: stuff && other stuff'] };
        let didExit = false;
        try {
            systemInterceptor({ cmdBasename: 'git', args: payload.args as string[], envOverrides: {}, payload });
        } catch (e: unknown) {
            if (e instanceof Error && e.message.startsWith('ProcessExitMock')) didExit = true;
        }
        expect(didExit).toBe(false);
    });

    it('should NOT block example 1 (false positive)', () => {
        const payload: ExecPayload = { type: 'command', command: 'git', args: ['commit', '-m', 'This string has && and | and > inside it'] };
        let didExit = false;
        try {
            systemInterceptor({ cmdBasename: 'git', args: payload.args as string[], envOverrides: {}, payload });
        } catch (e: unknown) {
            if (e instanceof Error && e.message.startsWith('ProcessExitMock')) didExit = true;
        }
        expect(didExit).toBe(false);
    });

    it('should NOT block example 2 (JSON) (false positive)', () => {
        const payload: ExecPayload = { type: 'command', command: 'echo', args: ['{"query": "[.[] | select(.id == 1)]"}'] };
        let didExit = false;
        try {
            systemInterceptor({ cmdBasename: 'echo', args: payload.args as string[], envOverrides: {}, payload });
        } catch (e: unknown) {
            if (e instanceof Error && e.message.startsWith('ProcessExitMock')) didExit = true;
        }
        expect(didExit).toBe(false);
    });
    it('should NOT block unquoted operators in single-arg commands (echo stripped quotes false positive)', () => {
        const payload: ExecPayload = { type: 'command', command: 'echo', args: ['This string has | inside it'] };
        let didExit = false;
        try {
            systemInterceptor({ cmdBasename: 'echo', args: payload.args as string[], envOverrides: {}, payload });
        } catch (e: unknown) {
            if (e instanceof Error && e.message.startsWith('ProcessExitMock')) didExit = true;
        }
        expect(didExit).toBe(false);
    });
});
