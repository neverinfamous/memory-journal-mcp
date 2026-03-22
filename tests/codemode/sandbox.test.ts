/**
 * Code Mode Sandbox Tests (VM-based)
 *
 * Tests for CodeModeSandbox and SandboxPool non-execution paths.
 * Note: Actual code execution is tested via Playwright E2E tests because
 * vm.createContext async IIFEs don't resolve Promises correctly in vitest's
 * module environment (the Promise microtask queue in the VM context doesn't
 * interop with the host event loop).
 *
 * Covers:
 * - Sandbox construction and options
 * - Compilation cache (LRU)
 * - Pool construction and configuration
 * - Pool concurrency tracking
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import * as vm from 'node:vm'
import { CodeModeSandbox, SandboxPool } from '../../src/codemode/index.js'

describe('CodeModeSandbox', () => {
    let sandbox: CodeModeSandbox

    beforeEach(() => {
        sandbox = new CodeModeSandbox()
    })

    // =========================================================================
    // Construction
    // =========================================================================

    describe('construction', () => {
        it('should create with default options', () => {
            expect(sandbox).toBeDefined()
        })

        it('should accept custom options', () => {
            const custom = new CodeModeSandbox({
                timeoutMs: 5000,
                memoryLimitMb: 64,
                cpuLimitMs: 5000,
            })
            expect(custom).toBeDefined()
        })
    })

    // =========================================================================
    // Compilation Cache
    // =========================================================================

    describe('cache', () => {
        it('should start with empty cache', () => {
            expect(sandbox.getCacheSize()).toBe(0)
        })

        it('should clear cache without errors', () => {
            sandbox.clearCache()
            expect(sandbox.getCacheSize()).toBe(0)
        })

        it('should report cache size as a number', () => {
            expect(typeof sandbox.getCacheSize()).toBe('number')
        })

    })

    // =========================================================================
    // Execution
    // =========================================================================

    describe('execute', () => {
        let runInContextSpy: any
        
        beforeEach(() => {
            runInContextSpy = vi.spyOn(vm.Script.prototype, 'runInContext').mockReturnValue(Promise.resolve(42) as any)
        })
        
        afterEach(() => {
            if (runInContextSpy) runInContextSpy.mockRestore()
        })
        
        it('should execute code returning a valid result', async () => {
            const result = await sandbox.execute('return 42', {})
            expect(result.success).toBe(true)
            if (result.success) {
                expect(result.result).toBe(42)
                expect(result.metrics).toBeDefined()
            }
        })

        it('should catch errors thrown during execution', async () => {
            runInContextSpy.mockImplementation(() => { throw new Error('VM crash') })
            const result = await sandbox.execute('throw new Error("Crash")', {})
            expect(result.success).toBe(false)
            if (!result.success) {
                expect(result.error).toBe('VM crash')
            }
        })

        it('should provide wrapped console methods', async () => {
            // This will execute against the mock, but the console wrappers are created
            // within the 'execute' setup before runInContext is called.
            const result = await sandbox.execute(`
                console.log("log entry");
                console.warn("warn entry");
                console.error("error entry");
                return true;
            `, {})
            expect(result.success).toBe(true)
        })

        it('should evict oldest entries when cache exceeds capacity', async () => {
            // Max capacity of ScriptCache is 50. Generate 55 unique scripts.
            for (let i = 0; i < 55; i++) {
                await sandbox.execute(`return ${i}`, {})
            }
            expect(sandbox.getCacheSize()).toBe(50)
        })
    })
})

// =============================================================================
// SandboxPool
// =============================================================================

describe('SandboxPool', () => {
    it('should create with default options', () => {
        const pool = new SandboxPool()
        expect(pool).toBeDefined()
    })

    it('should create with custom options', () => {
        const pool = new SandboxPool(
            { timeoutMs: 5000 },
            { maxInstances: 5, minInstances: 1, idleTimeoutMs: 30000 }
        )
        expect(pool).toBeDefined()
    })

    it('should track active count starting at zero', () => {
        const pool = new SandboxPool()
        expect(pool.getActiveCount()).toBe(0)
    })

    it('should have a unique pool ID', () => {
        const pool1 = new SandboxPool()
        const pool2 = new SandboxPool()
        expect(pool1.poolId).toBeDefined()
        expect(pool2.poolId).toBeDefined()
        expect(pool1.poolId).not.toBe(pool2.poolId)
    })

    it('should generate valid UUID pool IDs', () => {
        const pool = new SandboxPool()
        // UUID v4 format: 8-4-4-4-12 hex characters
        expect(pool.poolId).toMatch(
            /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i
        )
    })

    it('should refuse execution if max instances exceeded', async () => {
        const pool = new SandboxPool({}, { maxInstances: 0 })
        const result = await pool.execute('return 1', {})
        expect(result.success).toBe(false)
        expect(result.error).toContain('exhausted')
    })
    
    it('should decrement active count on execution completion', async () => {
        const pool = new SandboxPool({}, { maxInstances: 5 })
        expect(pool.getActiveCount()).toBe(0)
        
        // Mock the actual execution to avoid vm hanging in vitest
        const executeSpy = vi.spyOn(CodeModeSandbox.prototype, 'execute').mockResolvedValue({
            success: true,
            result: 1,
            metrics: { durationMs: 1, memoryBytes: 0, peakMemoryBytes: 0 }
        })
        
        await pool.execute('return 1', {})
        expect(pool.getActiveCount()).toBe(0)
        
        executeSpy.mockRestore()
    })
})
