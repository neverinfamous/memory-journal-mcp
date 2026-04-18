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
    private currentExecution: {
        resolve: (result: SandboxResult) => void
        timeoutHandle: NodeJS.Timeout
        hostPort: MessagePort
        startTime: number
        startRss: number
    } | null = null
    private executionId = 0

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
                    memoryUsedMb: Math.round((endRss - this.currentExecution.startRss) / 1024 / 1024),
                }

                const resolve = this.currentExecution.resolve
                this.currentExecution = null
                this.isBusy = false
                resolve(result)
            }
        })

        this.worker.on('error', (err: Error) => {
            this.handleWorkerDeath(err.message, err.stack)
        })

        this.worker.on('exit', (exitCode) => {
            if (exitCode !== 0) {
                this.handleWorkerDeath(`Worker exited with code ${String(exitCode)} (likely timeout or OOM)`)
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
        timeoutMs?: number
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
                }, effectiveTimeout + 1000)
            }

            hostPort.on('message', (msg: RpcRequest) => {
                void handleRpcRequest(msg, apiBindings, hostPort)
            })

            let maxResultSize = process.env['CODE_MODE_MAX_RESULT_SIZE'] 
                ? parseInt(process.env['CODE_MODE_MAX_RESULT_SIZE'], 10) 
                : 100 * 1024
                
            if (Number.isNaN(maxResultSize) || maxResultSize <= 0) {
                maxResultSize = 100 * 1024
            } else if (maxResultSize > 50 * 1024 * 1024) {
                maxResultSize = 50 * 1024 * 1024 // Cap at 50MB
            }

            this.worker?.postMessage({
                type: 'EXECUTE',
                id: this.executionId,
                code,
                methodList,
                timeoutMs: effectiveTimeout,
                maxResultSize,
                rpcPort: workerPort
            }, [workerPort])
        })
    }
}

// =============================================================================
// RPC Handler (Main Thread)
// =============================================================================

async function handleRpcRequest(
    req: RpcRequest,
    apiBindings: Record<string, unknown>,
    hostPort: MessagePort
): Promise<void> {
    const response: RpcResponse = { id: req.id }

    try {
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
            response.result = await (target as (...args: unknown[]) => Promise<unknown>)(...req.args)
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

/**
 * Pool of persistent worker-thread sandboxes.
 */
export class WorkerSandboxPool {
    private readonly options: Required<PoolOptions>
    private readonly sandboxOptions: SandboxOptions
    private pool: WorkerSandbox[] = []

    constructor(sandboxOptions?: SandboxOptions, poolOptions?: PoolOptions) {
        this.sandboxOptions = sandboxOptions ?? {}
        this.options = { ...DEFAULT_POOL_OPTIONS, ...poolOptions }
    }

    async execute(
        code: string,
        apiBindings: Record<string, unknown>,
        timeoutMs?: number
    ): Promise<SandboxResult> {
        let availableSandbox = this.pool.find(s => !s.isBusy)

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

        return await availableSandbox.execute(code, apiBindings, timeoutMs)
    }

    getActiveCount(): number {
        return this.pool.filter(s => s.isBusy).length
    }

    dispose(): void {
        for (const worker of this.pool) {
            worker.dispose()
        }
        this.pool = []
    }

    readonly poolId = crypto.randomUUID()
}
