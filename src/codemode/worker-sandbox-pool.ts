/**
 * Worker Sandbox Pool — maintains pre-warmed worker-thread sandboxes
 * with lifecycle management (age recycling, idle eviction, re-warming).
 */

import * as crypto from 'node:crypto'
import {
    DEFAULT_POOL_OPTIONS,
    type SandboxOptions,
    type PoolOptions,
    type SandboxResult,
} from './types.js'
import { WorkerSandbox } from './worker-sandbox.js'

const LIFECYCLE_INTERVAL_MS = 15_000

/**
 * Pool of persistent worker-thread sandboxes with pre-warming
 * and lifecycle management (age recycling, idle eviction, re-warming).
 */
export class WorkerSandboxPool {
    private readonly options: Required<PoolOptions>
    private readonly sandboxOptions: SandboxOptions
    private pool: WorkerSandbox[] = []
    private lifecycleTimer: ReturnType<typeof setInterval> | null = null

    constructor(sandboxOptions?: SandboxOptions, poolOptions?: PoolOptions) {
        this.sandboxOptions = sandboxOptions ?? {}
        this.options = { ...DEFAULT_POOL_OPTIONS, ...poolOptions }
        if (this.options.minInstances > this.options.maxInstances) {
            this.options.minInstances = this.options.maxInstances
        }
        this.warmPool()
        this.lifecycleTimer = setInterval(() => this.lifecycleSweep(), LIFECYCLE_INTERVAL_MS)
        this.lifecycleTimer.unref()
    }

    /**
     * Eagerly create workers up to `minInstances`.
     */
    private warmPool(): void {
        while (this.pool.length < this.options.minInstances) {
            this.pool.push(new WorkerSandbox(this.sandboxOptions))
        }
    }

    /**
     * Periodic lifecycle sweep:
     * 1. Remove already-disposed workers
     * 2. Recycle workers that exceed maxWorkerAgeMs
     * 3. Evict idle workers (oldest first) above minInstances
     * 4. Re-warm pool to minInstances
     */
    private lifecycleSweep(): void {
        const now = Date.now()

        this.pool = this.pool.filter((w) => !w.isDisposed)

        for (let i = this.pool.length - 1; i >= 0; i--) {
            const worker = this.pool[i]
            if (worker && !worker.isBusy && now - worker.createdAt > this.options.maxWorkerAgeMs) {
                worker.dispose()
                this.pool.splice(i, 1)
            }
        }

        const idleCandidates = this.pool
            .map((w, idx) => ({ worker: w, idx }))
            .filter(
                ({ worker }) => !worker.isBusy && now - worker.lastUsedAt > this.options.idleTimeoutMs
            )
            .sort((a, b) => a.worker.lastUsedAt - b.worker.lastUsedAt)

        for (const { worker } of idleCandidates) {
            if (this.pool.length <= this.options.minInstances) break
            worker.dispose()
            const poolIdx = this.pool.indexOf(worker)
            if (poolIdx !== -1) this.pool.splice(poolIdx, 1)
        }

        this.warmPool()
    }

    async execute(
        code: string,
        apiBindings: Record<string, unknown>,
        schemas?: Record<string, Record<string, string>>,
        timeoutMs?: number,
        contextObj?: Record<string, unknown>,
        readonlyMode?: boolean,
        maxResultSizeOverride?: number,
        modeFlags?: { dryRunMode?: boolean | undefined; useTestDbMode?: boolean | undefined }
    ): Promise<SandboxResult> {
        let availableSandbox = this.pool.find((s) => !s.isBusy)

        if (!availableSandbox) {
            if (this.pool.length < this.options.maxInstances) {
                availableSandbox = new WorkerSandbox(this.sandboxOptions)
                this.pool.push(availableSandbox)
            } else {
                return {
                    success: false,
                    error: `Sandbox pool exhausted (max ${String(this.options.maxInstances)} concurrent executions)`,
                    metrics: { wallTimeMs: 0, cpuTimeMs: 0, memoryUsedMb: 0 },
                }
            }
        }

        return await availableSandbox.execute(
            code,
            apiBindings,
            schemas,
            timeoutMs,
            contextObj,
            readonlyMode,
            maxResultSizeOverride,
            modeFlags
        )
    }

    getActiveCount(): number {
        return this.pool.filter((s) => s.isBusy).length
    }

    dispose(): void {
        if (this.lifecycleTimer !== null) {
            clearInterval(this.lifecycleTimer)
            this.lifecycleTimer = null
        }
        for (const worker of this.pool) {
            worker.dispose()
        }
        this.pool = []
    }

    readonly poolId = crypto.randomUUID()
}
