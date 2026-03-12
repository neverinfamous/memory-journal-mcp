/**
 * memory-journal-mcp - Code Mode Sandbox (VM-based)
 *
 * Provides script-level isolation using `node:vm`.
 * This is the lightweight sandbox option — NOT a true security boundary.
 * For production use, prefer WorkerSandbox (worker_threads).
 */

import * as vm from 'node:vm'
import * as crypto from 'node:crypto'
import {
    DEFAULT_SANDBOX_OPTIONS,
    DEFAULT_POOL_OPTIONS,
    type SandboxOptions,
    type PoolOptions,
    type SandboxResult,
    type ExecutionMetrics,
} from './types.js'

// =============================================================================
// Compilation Cache (LRU)
// =============================================================================

const SCRIPT_CACHE_MAX = 50

class ScriptCache {
    private readonly cache = new Map<string, vm.Script>()

    get(code: string): vm.Script | undefined {
        const script = this.cache.get(code)
        if (script) {
            // Move to end (most recently used)
            this.cache.delete(code)
            this.cache.set(code, script)
        }
        return script
    }

    set(code: string, script: vm.Script): void {
        if (this.cache.size >= SCRIPT_CACHE_MAX) {
            // Evict oldest entry
            const firstKey = this.cache.keys().next().value
            if (firstKey !== undefined) {
                this.cache.delete(firstKey)
            }
        }
        this.cache.set(code, script)
    }

    clear(): void {
        this.cache.clear()
    }

    get size(): number {
        return this.cache.size
    }
}

// =============================================================================
// Sandbox (VM-based)
// =============================================================================

/**
 * VM-based sandbox for executing user code in an isolated context.
 * Uses `node:vm` with nulled dangerous globals.
 *
 * WARNING: `node:vm` is NOT a true security boundary.
 * Use WorkerSandbox for production environments.
 */
export class CodeModeSandbox {
    private readonly options: Required<SandboxOptions>
    private readonly scriptCache = new ScriptCache()

    constructor(options?: SandboxOptions) {
        this.options = { ...DEFAULT_SANDBOX_OPTIONS, ...options }
    }

    /**
     * Execute code in a sandboxed VM context.
     */
    async execute(
        code: string,
        bindings: Record<string, unknown>,
        timeoutMs?: number,
    ): Promise<SandboxResult> {
        const effectiveTimeout = timeoutMs ?? this.options.timeoutMs
        const startTime = performance.now()
        const startRss = process.memoryUsage().rss

        try {
            // Build sandbox context with nulled dangerous globals
            const sandbox: Record<string, unknown> = {
                ...bindings,
                console: {
                    log: (...args: unknown[]) => args,
                    warn: (...args: unknown[]) => args,
                    error: (...args: unknown[]) => args,
                },
                // Nulled globals — prevent escape
                process: undefined,
                require: undefined,
                global: undefined,
                globalThis: undefined,
                setTimeout: undefined,
                setInterval: undefined,
                setImmediate: undefined,
            }

            const context = vm.createContext(sandbox, {
                name: 'codemode-sandbox',
                microtaskMode: 'afterEvaluate',
            })

            // Compile or retrieve from cache
            let script = this.scriptCache.get(code)
            if (!script) {
                const wrappedCode = `(async () => { ${code} })()`
                script = new vm.Script(wrappedCode, {
                    filename: 'codemode-execution.js',
                })
                this.scriptCache.set(code, script)
            }

            // Execute with timeout
            const resultPromise = script.runInContext(context, {
                timeout: effectiveTimeout,
            }) as Promise<unknown>

            const result = await resultPromise

            const endTime = performance.now()
            const endRss = process.memoryUsage().rss
            const metrics: ExecutionMetrics = {
                wallTimeMs: Math.round(endTime - startTime),
                cpuTimeMs: Math.round(endTime - startTime),
                memoryUsedMb: Math.round((endRss - startRss) / 1024 / 1024),
            }

            return { success: true, result, metrics }
        } catch (err) {
            const endTime = performance.now()
            const endRss = process.memoryUsage().rss
            const metrics: ExecutionMetrics = {
                wallTimeMs: Math.round(endTime - startTime),
                cpuTimeMs: Math.round(endTime - startTime),
                memoryUsedMb: Math.round((endRss - startRss) / 1024 / 1024),
            }

            const error = err instanceof Error ? err : new Error(String(err))
            return {
                success: false,
                error: error.message,
                stack: error.stack,
                metrics,
            }
        }
    }

    /** Clear the compilation cache */
    clearCache(): void {
        this.scriptCache.clear()
    }

    /** Get cache statistics */
    getCacheSize(): number {
        return this.scriptCache.size
    }
}

// =============================================================================
// Sandbox Pool (VM-based)
// =============================================================================

/**
 * Pool of VM-based sandboxes for concurrent execution.
 */
export class SandboxPool {
    private readonly options: Required<PoolOptions>
    private readonly sandboxOptions: SandboxOptions
    private activeCount = 0

    constructor(sandboxOptions?: SandboxOptions, poolOptions?: PoolOptions) {
        this.sandboxOptions = sandboxOptions ?? {}
        this.options = { ...DEFAULT_POOL_OPTIONS, ...poolOptions }
    }

    /**
     * Execute code in a pooled sandbox.
     * Creates a fresh sandbox per execution for clean state.
     */
    async execute(
        code: string,
        bindings: Record<string, unknown>,
        timeoutMs?: number,
    ): Promise<SandboxResult> {
        if (this.activeCount >= this.options.maxInstances) {
            return {
                success: false,
                error: `Sandbox pool exhausted (max ${String(this.options.maxInstances)} concurrent executions)`,
                metrics: { wallTimeMs: 0, cpuTimeMs: 0, memoryUsedMb: 0 },
            }
        }

        this.activeCount++
        try {
            const sandbox = new CodeModeSandbox(this.sandboxOptions)
            return await sandbox.execute(code, bindings, timeoutMs)
        } finally {
            this.activeCount--
        }
    }

    /** Get the current pool execution ID (for diagnostics) */
    getActiveCount(): number {
        return this.activeCount
    }

    /** Unique pool identifier */
    readonly poolId = crypto.randomUUID()
}
