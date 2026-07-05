import { describe, it, expect, spyOn, afterEach, beforeEach } from 'bun:test';
import { systemInterceptor } from '../interceptors/system-interceptor.ts';
import { ExecPayload } from '../schema.ts';

describe('System Interceptor: Pipe and Operator Handling', () => {
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

    it('should block basic chaining (true positive)', () => {
        const payload: ExecPayload = { type: 'command', command: 'echo', args: ['start', '&&', 'echo', 'end'] };
        let didExit = false;
        try {
            systemInterceptor({ cmdBasename: 'echo', args: payload.args as string[], envOverrides: {}, payload });
        } catch (e: unknown) {
            if (e instanceof Error && e.message.startsWith('ProcessExitMock')) didExit = true;
        }
        expect(didExit).toBe(true);
    });

    it('should NOT block operators inside strings (false positive)', () => {
        const payload: ExecPayload = { type: 'command', command: 'echo', args: ['This string has && and | and > inside it'] };
        let didExit = false;
        try {
            systemInterceptor({ cmdBasename: 'echo', args: payload.args as string[], envOverrides: {}, payload });
        } catch (e: unknown) {
            if (e instanceof Error && e.message.startsWith('ProcessExitMock')) didExit = true;
        }
        expect(didExit).toBe(false); 
    });


    it('should block complex edge cases where operators are not separated by space (false negative)', () => {
        const payload: ExecPayload = { type: 'command', command: 'echo', args: ['start&&echo', 'end'] };
        let didExit = false;
        try {
            systemInterceptor({ cmdBasename: 'echo', args: payload.args as string[], envOverrides: {}, payload });
        } catch (e: unknown) {
            if (e instanceof Error && e.message.startsWith('ProcessExitMock')) didExit = true;
        }
        expect(didExit).toBe(true); 
    });

    it('should block subshell wrapped operators (false negative)', () => {
        const payload: ExecPayload = { type: 'command', command: 'echo', args: ['$(echo', '&&', 'echo)'] };
        let didExit = false;
        try {
            systemInterceptor({ cmdBasename: 'echo', args: payload.args as string[], envOverrides: {}, payload });
        } catch (e: unknown) {
            if (e instanceof Error && e.message.startsWith('ProcessExitMock')) didExit = true;
        }
        expect(didExit).toBe(true); 
    });

    it('should NOT block operators inside JSON strings (false positive)', () => {
        const payload: ExecPayload = { type: 'command', command: 'echo', args: ['{"query": "[.[] | select(.id == 1)]"}'] };
        let didExit = false;
        try {
            systemInterceptor({ cmdBasename: 'echo', args: payload.args as string[], envOverrides: {}, payload });
        } catch (e: unknown) {
            if (e instanceof Error && e.message.startsWith('ProcessExitMock')) didExit = true;
        }
        expect(didExit).toBe(false); 
    });

    it('should NOT block operators inside compact JSON strings without spaces (false positive)', () => {
        const payload: ExecPayload = { type: 'command', command: 'echo', args: ['{"query":"[.[]|select(.id==1)]"}'] };
        let didExit = false;
        try {
            systemInterceptor({ cmdBasename: 'echo', args: payload.args as string[], envOverrides: {}, payload });
        } catch (e: unknown) {
            if (e instanceof Error && e.message.startsWith('ProcessExitMock')) didExit = true;
        }
        expect(didExit).toBe(false); 
    });

    it('should block escaped operators (false negative)', () => {
        const payload: ExecPayload = { type: 'command', command: 'echo', args: ['\\&\\&'] };
        let didExit = false;
        try {
            systemInterceptor({ cmdBasename: 'echo', args: payload.args as string[], envOverrides: {}, payload });
        } catch (e: unknown) {
            if (e instanceof Error && e.message.startsWith('ProcessExitMock')) didExit = true;
        }
        expect(didExit).toBe(true); 
    });

    it('should block powershell cat inline commands and throw anti-hallucination error', () => {
        const payload: ExecPayload = { type: 'command', command: 'pwsh', args: ['-c', 'cat file1.txt file2.txt'] };
        let didExit = false;
        try {
            systemInterceptor({ cmdBasename: 'pwsh', args: payload.args as string[], envOverrides: {}, payload });
        } catch (e: unknown) {
            if (e instanceof Error && e.message.startsWith('ProcessExitMock')) didExit = true;
        }
        expect(didExit).toBe(true); 
    });
    it('should block unspaced operators with quotes (false negative)', () => {
        const payload: ExecPayload = { type: 'command', command: 'echo', args: ['"start"&&echo', '"end"'] };
        let didExit = false;
        try {
            systemInterceptor({ cmdBasename: 'echo', args: payload.args as string[], envOverrides: {}, payload });
        } catch (e: unknown) {
            if (e instanceof Error && e.message.startsWith('ProcessExitMock')) didExit = true;
        }
        expect(didExit).toBe(true); 
    });

    it('should block powershell with && or ||', () => {
        const payload: ExecPayload = { type: 'command', command: 'pwsh', args: ['-c', 'echo start && echo end'] };
        let didExit = false;
        try {
            systemInterceptor({ cmdBasename: 'pwsh', args: payload.args as string[], envOverrides: {}, payload });
        } catch (e: unknown) {
            if (e instanceof Error && e.message.startsWith('ProcessExitMock')) didExit = true;
        }
        expect(didExit).toBe(true); 
    });

    it('should block powershell with |', () => {
        const payload: ExecPayload = { type: 'command', command: 'pwsh', args: ['-c', 'echo start | echo end'] };
        let didExit = false;
        try {
            systemInterceptor({ cmdBasename: 'pwsh', args: payload.args as string[], envOverrides: {}, payload });
        } catch (e: unknown) {
            if (e instanceof Error && e.message.startsWith('ProcessExitMock')) didExit = true;
        }
        expect(didExit).toBe(true); 
    });

    it('should block powershell with >', () => {
        const payload: ExecPayload = { type: 'command', command: 'pwsh', args: ['-c', 'echo start > out.txt'] };
        let didExit = false;
        try {
            systemInterceptor({ cmdBasename: 'pwsh', args: payload.args as string[], envOverrides: {}, payload });
        } catch (e: unknown) {
            if (e instanceof Error && e.message.startsWith('ProcessExitMock')) didExit = true;
        }
        expect(didExit).toBe(true); 
    });

    it('should block multiple unspaced operators (false negative)', () => {
        const payload: ExecPayload = { type: 'command', command: 'echo', args: ['a&&b&&c'] };
        let didExit = false;
        try {
            systemInterceptor({ cmdBasename: 'echo', args: payload.args as string[], envOverrides: {}, payload });
        } catch (e: unknown) {
            if (e instanceof Error && e.message.startsWith('ProcessExitMock')) didExit = true;
        }
        expect(didExit).toBe(true); 
    });
    it('should NOT block escaped quotes containing operators (false positive)', () => {
        const payload: ExecPayload = { type: 'command', command: 'echo', args: ['"This is an escaped \\" quote && malicious"'] };
        let didExit = false;
        try {
            systemInterceptor({ cmdBasename: 'echo', args: payload.args as string[], envOverrides: {}, payload });
        } catch (e: unknown) {
            if (e instanceof Error && e.message.startsWith('ProcessExitMock')) didExit = true;
        }
        expect(didExit).toBe(false); 
    });
    it('should NOT block escaped quotes that happen to resemble standalone operators without spaces (false positive)', () => {
        const payload: ExecPayload = { type: 'command', command: 'echo', args: ['"\\"&&"'] };
        let didExit = false;
        try {
            systemInterceptor({ cmdBasename: 'echo', args: payload.args as string[], envOverrides: {}, payload });
        } catch (e: unknown) {
            if (e instanceof Error && e.message.startsWith('ProcessExitMock')) didExit = true;
        }
        expect(didExit).toBe(false); 
    });

    it('should NOT block powershell operators inside strings with escaped quotes (false positive)', () => {
        const payload: ExecPayload = { type: 'command', command: 'echo', args: ['echo "hello \\" && echo bad"'] };
        let didExit = false;
        try {
            systemInterceptor({ cmdBasename: 'echo', args: payload.args as string[], envOverrides: {}, payload });
        } catch (e: unknown) {
            if (e instanceof Error && e.message.startsWith('ProcessExitMock')) didExit = true;
        }
        expect(didExit).toBe(false);
    });
});
