/**
 * memory-journal-mcp - Code Mode Module
 *
 * Exports for the sandboxed code execution environment.
 */

// Types
export type {
    SandboxOptions,
    PoolOptions,
    SandboxResult,
    ExecutionMetrics,
    SecurityConfig,
    ValidationResult,
    ExecutionRecord,
    ExecuteCodeOptions,
    ExecuteCodeResult,
    GroupApi,
} from './types.js'

export {
    DEFAULT_SANDBOX_OPTIONS,
    DEFAULT_POOL_OPTIONS,
    DEFAULT_SECURITY_CONFIG,
} from './types.js'

// Sandbox (VM-based)
export { CodeModeSandbox, SandboxPool } from './sandbox.js'

// Worker Sandbox (worker_threads-based)
export { WorkerSandbox, WorkerSandboxPool } from './worker-sandbox.js'

// Sandbox Factory (mode selection)
export {
    setDefaultSandboxMode,
    getDefaultSandboxMode,
    getAvailableSandboxModes,
    createSandbox,
    createSandboxPool,
    getSandboxModeInfo,
    type SandboxMode,
    type ISandbox,
    type ISandboxPool,
    type SandboxModeInfo,
} from './sandbox-factory.js'

// Security
export { CodeModeSecurityManager } from './security.js'

// API
export { JournalApi, createJournalApi } from './api.js'
