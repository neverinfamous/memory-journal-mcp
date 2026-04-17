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

        it('should allow setting back to worker mode', () => {
            setDefaultSandboxMode('worker')
            expect(getDefaultSandboxMode()).toBe('worker')
        })
    })

    // =========================================================================
    // Available Modes
    // =========================================================================

    describe('getAvailableSandboxModes', () => {
        it('should return worker mode only', () => {
            const modes = getAvailableSandboxModes()
            expect(modes).toContain('worker')
            expect(modes).toHaveLength(1)
        })
    })

    // =========================================================================
    // Sandbox Creation
    // =========================================================================

    describe('createSandbox', () => {
        it('should create a Worker sandbox when mode is worker', () => {
            const sandbox = createSandbox('worker')
            expect(sandbox).toBeDefined()
            expect(typeof sandbox.execute).toBe('function')
        })

        it('should use default mode when not specified', () => {
            setDefaultSandboxMode('worker')
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
        it('should create a Worker pool when mode is worker', () => {
            const pool = createSandboxPool('worker')
            expect(pool).toBeDefined()
            expect(typeof pool.execute).toBe('function')
            expect(pool.poolId).toBeDefined()
        })

        it('should use default mode when not specified', () => {
            setDefaultSandboxMode('worker')
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
        it('should return Worker info', () => {
            const info = getSandboxModeInfo('worker')
            expect(info.mode).toBe('worker')
            expect(info.securityLevel).toBe('trusted_admin')
            expect(info.description).toContain('Worker-thread')
            expect(info.isolation).toContain('V8 isolate')
        })

        it('should use default mode when not specified', () => {
            setDefaultSandboxMode('worker')
            const info = getSandboxModeInfo()
            expect(info.mode).toBe('worker')
        })

        it('should throw for unknown mode', () => {
            expect(() => getSandboxModeInfo('bad' as 'vm')).toThrow('Unknown sandbox mode')
        })
    })
})
