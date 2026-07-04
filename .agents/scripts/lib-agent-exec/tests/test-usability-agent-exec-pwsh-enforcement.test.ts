import { expect, test, describe, beforeEach, afterEach } from 'bun:test';
import { systemInterceptor } from '../interceptors/system-interceptor.js';
import { ExecutionContext } from '../interceptors/types.js';

describe('pwsh enforcement interceptor', () => {
    let mockConsoleError: typeof console.error;
    let mockProcessExit: typeof process.exit;

    beforeEach(() => {
        mockConsoleError = console.error;
        console.error = () => {};
        mockProcessExit = process.exit;
        process.exit = (() => {}) as unknown as typeof process.exit;
    });

    afterEach(() => {
        console.error = mockConsoleError;
        process.exit = mockProcessExit;
    });

    test('should inject -NonInteractive and -NoProfile into pwsh invocation', () => {
        const ctx: ExecutionContext = {
            payload: { type: 'command', command: 'pwsh', args: ['-File', 'script.ps1'] } as unknown as import('../schema.js').ExecPayload,
            cmdBasename: 'pwsh',
            args: ['-File', 'script.ps1'],
            envOverrides: {},
        };

        systemInterceptor(ctx);

        expect(ctx.args).toContain('-NonInteractive');
        expect(ctx.args).toContain('-NoProfile');
    });
    
    test('should not inject if already present', () => {
        const ctx: ExecutionContext = {
            payload: { type: 'command', command: 'pwsh', args: ['-noprofile', '-noninteractive', '-File', 'script.ps1'] } as unknown as import('../schema.js').ExecPayload,
            cmdBasename: 'pwsh',
            args: ['-noprofile', '-noninteractive', '-File', 'script.ps1'],
            envOverrides: {},
        };

        systemInterceptor(ctx);

        // Should not duplicate
        expect(ctx.args.filter(a => a.toLowerCase() === '-noninteractive').length).toBe(1);
        expect(ctx.args.filter(a => a.toLowerCase() === '-noprofile').length).toBe(1);
    });

    test('should inject if flags are passed after -Command (bypass attempt)', () => {
        const ctx: ExecutionContext = {
            payload: { type: 'command', command: 'pwsh', args: ['-Command', 'Write-Host 1', '-noprofile', '-noninteractive'] } as unknown as import('../schema.js').ExecPayload,
            cmdBasename: 'pwsh',
            args: ['-Command', 'Write-Host 1', '-noprofile', '-noninteractive'],
            envOverrides: {},
        };

        systemInterceptor(ctx);

        // It should inject the flags before -Command
        const commandIndex = ctx.args.findIndex(a => a.toLowerCase() === '-command');
        const nonInteractiveIndex = ctx.args.findIndex(a => a.toLowerCase() === '-noninteractive');
        const noProfileIndex = ctx.args.findIndex(a => a.toLowerCase() === '-noprofile');

        expect(nonInteractiveIndex).toBeLessThan(commandIndex);
        expect(noProfileIndex).toBeLessThan(commandIndex);
    });
});
