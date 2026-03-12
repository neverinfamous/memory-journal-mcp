/**
 * Sandbox Factory Tests
 *
 * Tests for the sandbox mode selection factory:
 * - Default mode management
 * - VM and Worker sandbox creation
 * - Pool creation
 * - Mode info
 * - Available modes listing
 */

import { describe, it, expect, afterEach } from 'vitest'
import {
    setDefaultSandboxMode,
    getDefaultSandboxMode,
    getAvailableSandboxModes,
    createSandbox,
    createSandboxPool,
    getSandboxModeInfo,
} from '../../src/codemode/index.js'

describe('Sandbox Factory', () => {
    // Reset to default after each test
    afterEach(() => {
        setDefaultSandboxMode('worker')
    })

    // =========================================================================
    // Default Mode
    // =========================================================================

    describe('default mode', () => {
        it('should default to worker mode', () => {
            expect(getDefaultSandboxMode()).toBe('worker')
        })

        it('should allow setting to vm mode', () => {
            setDefaultSandboxMode('vm')
            expect(getDefaultSandboxMode()).toBe('vm')
        })

        it('should allow setting back to worker mode', () => {
            setDefaultSandboxMode('vm')
            setDefaultSandboxMode('worker')
            expect(getDefaultSandboxMode()).toBe('worker')
        })
    })

    // =========================================================================
    // Available Modes
    // =========================================================================

    describe('getAvailableSandboxModes', () => {
        it('should return both vm and worker modes', () => {
            const modes = getAvailableSandboxModes()
            expect(modes).toContain('vm')
            expect(modes).toContain('worker')
            expect(modes).toHaveLength(2)
        })
    })

    // =========================================================================
    // Sandbox Creation
    // =========================================================================

    describe('createSandbox', () => {
        it('should create a VM sandbox when mode is vm', () => {
            const sandbox = createSandbox('vm')
            expect(sandbox).toBeDefined()
            expect(typeof sandbox.execute).toBe('function')
        })

        it('should create a Worker sandbox when mode is worker', () => {
            const sandbox = createSandbox('worker')
            expect(sandbox).toBeDefined()
            expect(typeof sandbox.execute).toBe('function')
        })

        it('should use default mode when not specified', () => {
            setDefaultSandboxMode('vm')
            const sandbox = createSandbox()
            expect(sandbox).toBeDefined()
        })

        it('should throw for unknown mode', () => {
            expect(() => createSandbox('unknown' as 'vm')).toThrow('Unknown sandbox mode')
        })
    })

    // =========================================================================
    // Pool Creation
    // =========================================================================

    describe('createSandboxPool', () => {
        it('should create a VM pool when mode is vm', () => {
            const pool = createSandboxPool('vm')
            expect(pool).toBeDefined()
            expect(typeof pool.execute).toBe('function')
            expect(typeof pool.getActiveCount).toBe('function')
            expect(pool.poolId).toBeDefined()
        })

        it('should create a Worker pool when mode is worker', () => {
            const pool = createSandboxPool('worker')
            expect(pool).toBeDefined()
            expect(typeof pool.execute).toBe('function')
            expect(pool.poolId).toBeDefined()
        })

        it('should use default mode when not specified', () => {
            setDefaultSandboxMode('vm')
            const pool = createSandboxPool()
            expect(pool).toBeDefined()
        })

        it('should throw for unknown mode', () => {
            expect(() => createSandboxPool('invalid' as 'vm')).toThrow('Unknown sandbox mode')
        })
    })

    // =========================================================================
    // Mode Info
    // =========================================================================

    describe('getSandboxModeInfo', () => {
        it('should return VM info', () => {
            const info = getSandboxModeInfo('vm')
            expect(info.mode).toBe('vm')
            expect(info.securityLevel).toBe('basic')
            expect(info.description).toContain('VM-based')
            expect(info.isolation).toContain('vm.createContext')
        })

        it('should return Worker info', () => {
            const info = getSandboxModeInfo('worker')
            expect(info.mode).toBe('worker')
            expect(info.securityLevel).toBe('production')
            expect(info.description).toContain('Worker-thread')
            expect(info.isolation).toContain('V8 isolate')
        })

        it('should use default mode when not specified', () => {
            setDefaultSandboxMode('vm')
            const info = getSandboxModeInfo()
            expect(info.mode).toBe('vm')
        })

        it('should throw for unknown mode', () => {
            expect(() => getSandboxModeInfo('bad' as 'vm')).toThrow('Unknown sandbox mode')
        })
    })
})
