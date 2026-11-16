/**
 * memory-journal-mcp - Worker Sandbox (worker_threads)
 *
 * Production-grade sandboxed execution using `node:worker_threads`.
 * Provides true V8 isolate boundary with resource limits,
 * hard timeouts, and MessagePort RPC bridge.
 */

import { Worker, MessageChannel, type ResourceLimits } from 'node:worker_threads'
import { fileURLToPath } from 'node:url'
import * as path from 'node:path'
import {
    DEFAULT_SANDBOX_OPTIONS,
    type SandboxOptions,
    type SandboxResult,
    type RpcRequest,
} from './types.js'
import { handleRpcRequest } from './worker-rpc-handler.js'

// =============================================================================
// Worker Script Path Resolution
// =============================================================================

/**
 * Resolve the worker script path relative to this module.
 * The worker-script.ts compiles to worker-script.js in the dist/ directory.
 */
export function isSourceCodemodeDir(currentDir: string): boolean {
    const parts = currentDir.split(/[/\\]/).filter((part) => part.length > 0)
    const parent = parts[parts.length - 2]
    const base = parts[parts.length - 1]
    return parent === 'src' && base === 'codemode'
}

function getWorkerScriptPath(): string {
    const currentDir = path.dirname(fileURLToPath(import.meta.url))
    // If we're executing directly from src/ (e.g. during vitest runs), point to the built dist/ version
    if (isSourceCodemodeDir(currentDir)) {
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

        const spawnedWorker = new Worker(getWorkerScriptPath(), {
            workerData: {}, // Initialized without specific execution data
            resourceLimits,
        })
        this.worker = spawnedWorker
        spawnedWorker.unref()

        spawnedWorker.on('message', (msg: { type: string; id: number; result: SandboxResult }) => {
            if (this.worker !== spawnedWorker) return
            // [INVARIANT] Ignore stale RESULT messages from a previous (timed-out) execution.
            if (msg.type === 'RESULT' && this.currentExecution && msg.id === this.executionId) {
                clearTimeout(this.currentExecution.timeoutHandle)
                this.currentExecution.hostPort.close()
                this.worker.unref()

                const endTime = performance.now()
                const endRss = process.memoryUsage.rss()
                const result = msg.result

                result.metrics = {
                    wallTimeMs: Math.round(endTime - this.currentExecution.startTime),
                    cpuTimeMs: result.metrics.cpuTimeMs,
                    memoryUsedMb: Math.max(0, Math.round((endRss - this.currentExecution.startRss) / 1024 / 1024)),
                }

                const resolve = this.currentExecution.resolve
                this.currentExecution = null
                this.isBusy = false
                this.lastUsedAt = Date.now()
                resolve(result)
            }
        })

        spawnedWorker.on('error', (err: Error) => {
            if (this.worker !== spawnedWorker) return
            this.handleWorkerDeath(err.message, err.stack)
        })

        spawnedWorker.on('exit', (exitCode) => {
            if (this.worker !== spawnedWorker) return
            if (exitCode !== 0 || this.currentExecution !== null) {
                this.handleWorkerDeath(
                    `🛠️ AUTONOMOUS HEALING: Worker execution timed out or ran out of memory. Avoid executing hundreds of sequential RPC calls (e.g. inside a loop calling getEntryById) or unbounded loops without keyset/offset pagination. For project counts and aggregates, use 'mj.analytics.getStatistics({ projectBreakdown: true })' or 'mj.admin.listProjects()' instead of iterating entries. Reduce batch/sample size or filter results server-side. (Worker exit code ${String(exitCode)})`
                )
            } else {
                this.worker = null
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
                ...(stack !== undefined ? { stack } : {}),
                metrics: {
                    wallTimeMs: Math.round(endTime - startTime),
                    cpuTimeMs: 0,
                    memoryUsedMb: Math.max(0, Math.round((endRss - startRss) / 1024 / 1024)),
                },
            })
        }
        this.worker = null
    }

    dispose(): void {
        this.isBusy = false
        if (this.currentExecution) {
            const exec = this.currentExecution
            this.currentExecution = null
            clearTimeout(exec.timeoutHandle)
            exec.hostPort.close()
            exec.resolve({
                success: false,
                error: 'Worker sandbox disposed',
                metrics: { wallTimeMs: 0, cpuTimeMs: 0, memoryUsedMb: 0 },
            })
        }
        if (this.worker) {
            const worker = this.worker
            this.worker = null
            worker.terminate().catch((err: unknown) => {
                const detail = err instanceof Error ? err.message : String(err)
                process.stderr.write(`Code mode worker terminate failed: ${detail}\n`)
            })
        }
    }

    private terminateTimedOutExecution(timedOutId: number): void {
        const worker = this.worker
        if (worker === null) {
            this.handleWorkerDeath('Code execution timed out')
            return
        }
        worker.terminate().then(
            () => {
                if (this.currentExecution !== null && this.executionId === timedOutId) {
                    this.handleWorkerDeath('Code execution timed out')
                }
            },
            (err: unknown) => {
                const detail = err instanceof Error ? err.message : String(err)
                if (this.executionId === timedOutId) {
                    this.handleWorkerDeath(
                        `Code execution timed out and the worker could not be terminated: ${detail}`
                    )
                }
            }
        )
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
        readonlyMode?: boolean,
        maxResultSizeOverride?: number
    ): Promise<SandboxResult> {
        if (this.isBusy || this.currentExecution !== null) {
            return {
                success: false,
                error: 'WorkerSandbox is already executing a task',
                metrics: { wallTimeMs: 0, cpuTimeMs: 0, memoryUsedMb: 0 },
            }
        }

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
                    for (const [methodName, methodValue] of Object.entries(value)) {
                        if (typeof methodValue === 'function') {
                            methods.push(methodName)
                        }
                    }
                    if (methods.length > 0) methodList[key] = methods
                }
            }

            if (topLevel.length > 0) methodList['_topLevel'] = topLevel

            const { port1: hostPort, port2: workerPort } = new MessageChannel()
            const timedOutId = this.executionId
            const timeoutHandle = setTimeout(() => {
                this.terminateTimedOutExecution(timedOutId)
            }, effectiveTimeout)
            timeoutHandle.unref()

            this.currentExecution = {
                resolve,
                hostPort,
                startTime,
                startRss,
                timeoutHandle,
            }

            hostPort.on('message', (msg: RpcRequest) => {
                void handleRpcRequest(msg, apiBindings, hostPort, methodList).catch((err: unknown) => {
                    try {
                        hostPort.postMessage({
                            id: typeof msg?.id === 'number' ? msg.id : 0,
                            error: err instanceof Error ? err.message : String(err),
                        })
                    } catch {
                        // Port already closed
                    }
                })
            })
            this.worker?.ref()

            let maxResultSize = maxResultSizeOverride
            if (maxResultSize === undefined || Number.isNaN(maxResultSize) || maxResultSize <= 0) {
                const envVal = process.env['CODE_MODE_MAX_RESULT_SIZE']
                maxResultSize = envVal ? parseInt(envVal, 10) : 100 * 1024
            }

            if (Number.isNaN(maxResultSize) || maxResultSize <= 0) {
                maxResultSize = 100 * 1024
            } else if (maxResultSize > 50 * 1024 * 1024) {
                maxResultSize = 50 * 1024 * 1024 // Cap at 50MB
            }

            // [H7] A DataCloneError (non-cloneable context/bindings) must release ports, timer and isBusy.
            try {
                if (this.worker === null) throw new Error('Code mode worker is not available')
                this.worker.postMessage(
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
            } catch (err: unknown) {
                clearTimeout(timeoutHandle)
                hostPort.close()
                workerPort.close()
                this.worker?.unref()
                this.currentExecution = null
                this.isBusy = false
                const detail = err instanceof Error ? err.message : String(err)
                resolve({
                    success: false,
                    error: `Code Mode could not dispatch the execution (${detail}). Ensure \`context\` contains only JSON-serializable values.`,
                    metrics: { wallTimeMs: Math.round(performance.now() - startTime), cpuTimeMs: 0, memoryUsedMb: 0 },
                })
            }
        })
    }
}

export { WorkerSandboxPool } from './worker-sandbox-pool.js'
