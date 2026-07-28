/**
 * memory-journal-mcp - Worker Sandbox (worker_threads)
 *
 * Production-grade sandboxed execution using `node:worker_threads`.
 * Provides true V8 isolate boundary with resource limits,
 * hard timeouts, and MessagePort RPC bridge.
 */

import { Worker, MessageChannel, type ResourceLimits } from 'node:worker_threads'
import * as crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import * as path from 'node:path'
import {
    DEFAULT_SANDBOX_OPTIONS,
    DEFAULT_POOL_OPTIONS,
    type SandboxOptions,
    type PoolOptions,
    type SandboxResult,
    type RpcRequest,
    type RpcResponse,
} from './types.js'

// =============================================================================
// Worker Script Path Resolution
// =============================================================================

/**
 * Resolve the worker script path relative to this module.
 * The worker-script.ts compiles to worker-script.js in the dist/ directory.
 */
function getWorkerScriptPath(): string {
    const currentDir = path.dirname(fileURLToPath(import.meta.url))
    // If we're executing directly from src/ (e.g. during vitest runs), point to the built dist/ version
    if (currentDir.endsWith('src\\codemode') || currentDir.endsWith('src/codemode')) {
        return path.resolve(process.cwd(), 'dist/worker-script.js')
    }
    return path.join(currentDir, 'worker-script.js')
}

// =============================================================================
// Worker Sandbox
// =============================================================================

/**
 * Worker-thread sandbox for secure code execution.
 * Maintains a persistent worker thread internally.
 */
export class WorkerSandbox {
    private readonly options: Required<SandboxOptions>
    private worker: Worker | null = null
    public isBusy = false
    public readonly createdAt: number = Date.now()
    public lastUsedAt: number = Date.now()
    private currentExecution: {
        resolve: (result: SandboxResult) => void
        timeoutHandle: NodeJS.Timeout
        hostPort: MessagePort
        startTime: number
        startRss: number
    } | null = null
    private executionId = 0

    public get isDisposed(): boolean {
        return this.worker === null && !this.isBusy
    }

    constructor(options?: SandboxOptions) {
        this.options = { ...DEFAULT_SANDBOX_OPTIONS, ...options }
        this.initWorker()
    }

    private initWorker(): void {
        const resourceLimits: ResourceLimits = {
            maxOldGenerationSizeMb: this.options.memoryLimitMb,
            maxYoungGenerationSizeMb: Math.max(8, Math.floor(this.options.memoryLimitMb / 8)),
        }

        this.worker = new Worker(getWorkerScriptPath(), {
            workerData: {}, // Initialized without specific execution data
            resourceLimits,
        })

        this.worker.on('message', (msg: { type: string; id: number; result: SandboxResult }) => {
            if (msg.type === 'RESULT' && this.currentExecution) {
                clearTimeout(this.currentExecution.timeoutHandle)
                this.currentExecution.hostPort.close()

                const endTime = performance.now()
                const endRss = process.memoryUsage.rss()
                const result = msg.result

                result.metrics = {
                    wallTimeMs: Math.round(endTime - this.currentExecution.startTime),
                    cpuTimeMs: result.metrics.cpuTimeMs,
                    memoryUsedMb: Math.round(
                        (endRss - this.currentExecution.startRss) / 1024 / 1024
                    ),
                }

                const resolve = this.currentExecution.resolve
                this.currentExecution = null
                this.isBusy = false
                this.lastUsedAt = Date.now()
                resolve(result)
            }
        })

        this.worker.on('error', (err: Error) => {
            this.handleWorkerDeath(err.message, err.stack)
        })

        this.worker.on('exit', (exitCode) => {
            if (exitCode !== 0) {
                this.handleWorkerDeath(
                    `🛠️ AUTONOMOUS HEALING: Worker execution timed out or ran out of memory. Avoid executing hundreds of sequential RPC calls (e.g. inside a loop calling getEntryById). Reduce batch/sample size or filter results server-side. (Worker exit code ${String(exitCode)})`
                )
            }
        })
    }

    private handleWorkerDeath(errorMsg: string, stack?: string): void {
        if (this.currentExecution) {
            clearTimeout(this.currentExecution.timeoutHandle)
            this.currentExecution.hostPort.close()

            const endTime = performance.now()
            const endRss = process.memoryUsage.rss()

            const resolve = this.currentExecution.resolve
            const startTime = this.currentExecution.startTime
            const startRss = this.currentExecution.startRss
            this.currentExecution = null
            this.isBusy = false

            resolve({
                success: false,
                error: errorMsg,
                stack: stack,
                metrics: {
                    wallTimeMs: Math.round(endTime - startTime),
                    cpuTimeMs: 0,
                    memoryUsedMb: Math.round((endRss - startRss) / 1024 / 1024),
                },
            })
        }
        this.worker = null
    }

    dispose(): void {
        this.isBusy = false
        if (this.currentExecution) {
            clearTimeout(this.currentExecution.timeoutHandle)
            this.currentExecution.hostPort.close()
            this.currentExecution = null
        }
        if (this.worker) {
            this.worker.terminate().catch(() => undefined)
            this.worker = null
        }
    }

    /**
     * Execute code in the worker thread with RPC bridge.
     */
    async execute(
        code: string,
        apiBindings: Record<string, unknown>,
        schemas?: Record<string, Record<string, string>>,
        timeoutMs?: number,
        contextObj?: Record<string, unknown>,
        readonlyMode?: boolean
    ): Promise<SandboxResult> {
        let effectiveTimeout = timeoutMs ?? this.options.timeoutMs
        if (effectiveTimeout > 30000) effectiveTimeout = 30000

        if (!this.worker) this.initWorker()

        this.isBusy = true
        this.executionId++

        const startTime = performance.now()
        const startRss = process.memoryUsage.rss()

        return new Promise<SandboxResult>((resolve) => {
            const methodList: Record<string, string[]> = {}
            const topLevel: string[] = []

            for (const [key, value] of Object.entries(apiBindings)) {
                if (typeof value === 'function') {
                    topLevel.push(key)
                } else if (typeof value === 'object' && value !== null) {
                    const methods: string[] = []
                    for (const [methodName, methodValue] of Object.entries(
                        value as Record<string, unknown>
                    )) {
                        if (typeof methodValue === 'function') {
                            methods.push(methodName)
                        }
                    }
                    if (methods.length > 0) methodList[key] = methods
                }
            }

            if (topLevel.length > 0) methodList['_topLevel'] = topLevel

            const { port1: hostPort, port2: workerPort } = new MessageChannel()

            this.currentExecution = {
                resolve,
                hostPort,
                startTime,
                startRss,
                timeoutHandle: setTimeout(() => {
                    this.worker?.terminate().catch(() => undefined)
                }, effectiveTimeout + 1000),
            }

            hostPort.on('message', (msg: RpcRequest) => {
                void handleRpcRequest(msg, apiBindings, hostPort, methodList)
            })

            let maxResultSize = process.env['CODE_MODE_MAX_RESULT_SIZE']
                ? parseInt(process.env['CODE_MODE_MAX_RESULT_SIZE'], 10)
                : 100 * 1024

            if (Number.isNaN(maxResultSize) || maxResultSize <= 0) {
                maxResultSize = 100 * 1024
            } else if (maxResultSize > 50 * 1024 * 1024) {
                maxResultSize = 50 * 1024 * 1024 // Cap at 50MB
            }

            this.worker?.postMessage(
                {
                    type: 'EXECUTE',
                    id: this.executionId,
                    code,
                    methodList,
                    schemaList: schemas,
                    timeoutMs: effectiveTimeout,
                    maxResultSize,
                    rpcPort: workerPort,
                    contextObj,
                    readonlyMode,
                },
                [workerPort]
            )
        })
    }
}

// =============================================================================
// RPC Handler (Main Thread)
// =============================================================================

async function handleRpcRequest(
    req: RpcRequest,
    apiBindings: Record<string, unknown>,
    hostPort: MessagePort,
    methodList: Record<string, string[]>
): Promise<void> {
    const response: RpcResponse = { id: req.id }

    try {
        const allowedMethods = methodList[req.group]
        if (!allowedMethods?.includes(req.method)) {
            response.error = `Unauthorized method invocation: ${req.group}.${req.method}`
            hostPort.postMessage(response)
            return
        }

        let target: unknown
        if (req.group === '_topLevel') {
            target = apiBindings[req.method]
        } else {
            const groupApi = apiBindings[req.group]
            if (groupApi !== undefined && groupApi !== null && typeof groupApi === 'object') {
                target = (groupApi as Record<string, unknown>)[req.method]
            }
        }

        if (typeof target === 'function') {
            response.result = await (target as (...args: unknown[]) => Promise<unknown>)(
                ...req.args
            )
        } else {
            response.error = `Unknown method: ${req.group}.${req.method}`
        }
    } catch (err) {
        response.error = err instanceof Error ? err.message : String(err)
    }

    hostPort.postMessage(response)
}

// =============================================================================
// Worker Sandbox Pool
// =============================================================================

/** Lifecycle sweep interval in milliseconds */
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

        // 1. Remove disposed workers
        this.pool = this.pool.filter((w) => !w.isDisposed)

        // 2. Recycle aged workers (non-busy, exceeded max age)
        for (let i = this.pool.length - 1; i >= 0; i--) {
            const worker = this.pool[i]
            if (worker && !worker.isBusy && now - worker.createdAt > this.options.maxWorkerAgeMs) {
                worker.dispose()
                this.pool.splice(i, 1)
            }
        }

        // 3. Evict idle workers above minInstances (oldest idle first)
        const idleCandidates = this.pool
            .map((w, idx) => ({ worker: w, idx }))
            .filter(
                ({ worker }) =>
                    !worker.isBusy && now - worker.lastUsedAt > this.options.idleTimeoutMs
            )
            .sort((a, b) => a.worker.lastUsedAt - b.worker.lastUsedAt)

        for (const { worker } of idleCandidates) {
            if (this.pool.length <= this.options.minInstances) break
            worker.dispose()
            const poolIdx = this.pool.indexOf(worker)
            if (poolIdx !== -1) this.pool.splice(poolIdx, 1)
        }

        // 4. Re-warm to minInstances
        this.warmPool()
    }

    async execute(
        code: string,
        apiBindings: Record<string, unknown>,
        schemas?: Record<string, Record<string, string>>,
        timeoutMs?: number,
        contextObj?: Record<string, unknown>,
        readonlyMode?: boolean
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
            readonlyMode
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
