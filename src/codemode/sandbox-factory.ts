/**
 * memory-journal-mcp - Sandbox Factory
 *
 * Mode selection factory for choosing between VM and Worker sandboxes.
 * Allows runtime configuration of the sandbox mode.
 */

import { WorkerSandbox, WorkerSandboxPool } from './worker-sandbox.js'
import type { SandboxOptions, PoolOptions, SandboxResult } from './types.js'
import { ConfigurationError } from '../types/errors.js'

// =============================================================================
// Types
// =============================================================================

/** Available sandbox modes */
export type SandboxMode = 'worker'

/** Common sandbox interface */
export interface ISandbox {
    execute(
        code: string,
        bindings: Record<string, unknown>,
        timeoutMs?: number
    ): Promise<SandboxResult>
}

/** Common pool interface */
export interface ISandboxPool {
    execute(
        code: string,
        bindings: Record<string, unknown>,
        timeoutMs?: number
    ): Promise<SandboxResult>
    getActiveCount(): number
    dispose(): void
    readonly poolId: string
}

/** Information about a sandbox mode */
export interface SandboxModeInfo {
    mode: SandboxMode
    description: string
    securityLevel: 'basic' | 'trusted_admin'
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
    return ['worker']
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Create a sandbox instance for the specified mode.
 */
export function createSandbox(mode?: SandboxMode, options?: SandboxOptions): ISandbox {
    const resolvedMode = mode ?? defaultMode

    switch (resolvedMode) {
        case 'worker':
            return new WorkerSandbox(options)
        default:
            throw new ConfigurationError(`Unknown sandbox mode: ${String(resolvedMode)}`)
    }
}

/**
 * Create a sandbox pool for the specified mode.
 */
export function createSandboxPool(
    mode?: SandboxMode,
    sandboxOptions?: SandboxOptions,
    poolOptions?: PoolOptions
): ISandboxPool {
    const resolvedMode = mode ?? defaultMode

    switch (resolvedMode) {
        case 'worker':
            return new WorkerSandboxPool(sandboxOptions, poolOptions)
        default:
            throw new ConfigurationError(`Unknown sandbox mode: ${String(resolvedMode)}`)
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
        case 'worker':
            return {
                mode: 'worker',
                description: 'Worker-thread sandbox using node:worker_threads. Trusted admin configuration (NOT secure multi-tenant isolation).',
                securityLevel: 'trusted_admin',
                isolation: 'Process-level V8 isolate with resource limits and MessagePort RPC',
            }
        default:
            throw new ConfigurationError(`Unknown sandbox mode: ${String(resolvedMode)}`)
    }
}
