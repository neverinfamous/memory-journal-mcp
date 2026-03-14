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

import { describe, it, expect, beforeEach } from 'vitest'
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
})
