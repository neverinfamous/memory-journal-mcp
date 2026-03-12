/**
 * memory-journal-mcp - Sandbox Factory
 *
 * Mode selection factory for choosing between VM and Worker sandboxes.
 * Allows runtime configuration of the sandbox mode.
 */

import { CodeModeSandbox, SandboxPool } from './sandbox.js'
import { WorkerSandbox, WorkerSandboxPool } from './worker-sandbox.js'
import type { SandboxOptions, PoolOptions, SandboxResult } from './types.js'

// =============================================================================
// Types
// =============================================================================

/** Available sandbox modes */
export type SandboxMode = 'vm' | 'worker'

/** Common sandbox interface */
export interface ISandbox {
    execute(code: string, bindings: Record<string, unknown>, timeoutMs?: number): Promise<SandboxResult>
}

/** Common pool interface */
export interface ISandboxPool {
    execute(code: string, bindings: Record<string, unknown>, timeoutMs?: number): Promise<SandboxResult>
    getActiveCount(): number
    readonly poolId: string
}

/** Information about a sandbox mode */
export interface SandboxModeInfo {
    mode: SandboxMode
    description: string
    securityLevel: 'basic' | 'production'
    isolation: string
}

// =============================================================================
// Default Mode
// =============================================================================

let defaultMode: SandboxMode = 'worker'

/**
 * Set the default sandbox mode for new sandbox instances.
 */
export function setDefaultSandboxMode(mode: SandboxMode): void {
    defaultMode = mode
}

/**
 * Get the current default sandbox mode.
 */
export function getDefaultSandboxMode(): SandboxMode {
    return defaultMode
}

/**
 * Get all available sandbox modes.
 */
export function getAvailableSandboxModes(): SandboxMode[] {
    return ['vm', 'worker']
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Create a sandbox instance for the specified mode.
 */
export function createSandbox(
    mode?: SandboxMode,
    options?: SandboxOptions,
): ISandbox {
    const resolvedMode = mode ?? defaultMode

    switch (resolvedMode) {
        case 'vm':
            return new CodeModeSandbox(options)
        case 'worker':
            return new WorkerSandbox(options)
        default:
            throw new Error(`Unknown sandbox mode: ${String(resolvedMode)}`)
    }
}

/**
 * Create a sandbox pool for the specified mode.
 */
export function createSandboxPool(
    mode?: SandboxMode,
    sandboxOptions?: SandboxOptions,
    poolOptions?: PoolOptions,
): ISandboxPool {
    const resolvedMode = mode ?? defaultMode

    switch (resolvedMode) {
        case 'vm':
            return new SandboxPool(sandboxOptions, poolOptions)
        case 'worker':
            return new WorkerSandboxPool(sandboxOptions, poolOptions)
        default:
            throw new Error(`Unknown sandbox mode: ${String(resolvedMode)}`)
    }
}

// =============================================================================
// Mode Info
// =============================================================================

/**
 * Get information about a sandbox mode.
 */
export function getSandboxModeInfo(mode?: SandboxMode): SandboxModeInfo {
    const resolvedMode = mode ?? defaultMode

    switch (resolvedMode) {
        case 'vm':
            return {
                mode: 'vm',
                description: 'VM-based sandbox using node:vm (lightweight, not a true security boundary)',
                securityLevel: 'basic',
                isolation: 'Script-level context isolation via vm.createContext',
            }
        case 'worker':
            return {
                mode: 'worker',
                description: 'Worker-thread sandbox using node:worker_threads (true V8 isolate)',
                securityLevel: 'production',
                isolation: 'Process-level V8 isolate with resource limits and MessagePort RPC',
            }
        default:
            throw new Error(`Unknown sandbox mode: ${String(resolvedMode)}`)
    }
}
