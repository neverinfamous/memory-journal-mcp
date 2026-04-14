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
 * Each execution spawns a fresh worker for clean state.
 */
export class WorkerSandbox {
    private readonly options: Required<SandboxOptions>

    constructor(options?: SandboxOptions) {
        this.options = { ...DEFAULT_SANDBOX_OPTIONS, ...options }
    }

    /**
     * Execute code in a worker thread with RPC bridge.
     *
     * @param code - JavaScript code to execute
     * @param apiBindings - Map of group → method record for RPC dispatch
     */
    async execute(
        code: string,
        apiBindings: Record<string, unknown>,
        timeoutMs?: number
    ): Promise<SandboxResult> {
        let effectiveTimeout = timeoutMs ?? this.options.timeoutMs
        // Strict cap ensuring timeout never exceeds 30,000ms
        if (effectiveTimeout > 30000) {
            effectiveTimeout = 30000
        }
        
        const startTime = performance.now()
        const startRss = process.memoryUsage.rss()

        return new Promise<SandboxResult>((resolve) => {
            // Serialize bindings: group objects → method name arrays,
            // top-level functions → collected under '_topLevel'
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
                    if (methods.length > 0) {
                        methodList[key] = methods
                    }
                }
            }

            if (topLevel.length > 0) {
                methodList['_topLevel'] = topLevel
            }

            // Create MessageChannel for RPC
            const { port1: hostPort, port2: workerPort } = new MessageChannel()

            // Resource limits
            const resourceLimits: ResourceLimits = {
                maxOldGenerationSizeMb: this.options.memoryLimitMb,
                maxYoungGenerationSizeMb: Math.max(8, Math.floor(this.options.memoryLimitMb / 8)),
            }

            const worker = new Worker(getWorkerScriptPath(), {
                workerData: {
                    code,
                    methodList,
                    timeoutMs: effectiveTimeout,
                    rpcPort: workerPort,
                },
                transferList: [workerPort],
                resourceLimits,
            })

            // Hard timeout — terminate worker if it runs too long
            const timeoutHandle = setTimeout(() => {
                worker.terminate().catch(() => {
                    // Worker already dead
                })
            }, effectiveTimeout + 1000) // +1s grace for cleanup

            // Handle RPC requests from the worker (via MessageChannel)
            hostPort.on('message', (msg: RpcRequest) => {
                void handleRpcRequest(msg, apiBindings, hostPort)
            })

            // Handle worker completion (results sent via parentPort)
            worker.on('message', (msg: SandboxResult) => {
                clearTimeout(timeoutHandle)
                hostPort.close()

                const endTime = performance.now()
                const endRss = process.memoryUsage.rss()
                const result = msg
                result.metrics = {
                    wallTimeMs: Math.round(endTime - startTime),
                    cpuTimeMs: result.metrics.cpuTimeMs,
                    memoryUsedMb: Math.round((endRss - startRss) / 1024 / 1024),
                }

                resolve(result)
            })

            // Handle worker errors and exit
            worker.on('error', (err: Error) => {
                clearTimeout(timeoutHandle)
                hostPort.close()

                const endTime = performance.now()
                const endRss = process.memoryUsage.rss()
                const errorMessage: string = err.message
                const errorStack: string | undefined = err.stack
                resolve({
                    success: false,
                    error: errorMessage,
                    stack: errorStack,
                    metrics: {
                        wallTimeMs: Math.round(endTime - startTime),
                        cpuTimeMs: 0,
                        memoryUsedMb: Math.round((endRss - startRss) / 1024 / 1024),
                    },
                })
            })

            worker.on('exit', (exitCode) => {
                clearTimeout(timeoutHandle)
                hostPort.close()

                if (exitCode !== 0) {
                    const endTime = performance.now()
                    const endRss = process.memoryUsage.rss()
                    resolve({
                        success: false,
                        error: `Worker exited with code ${String(exitCode)} (likely timeout or OOM)`,
                        metrics: {
                            wallTimeMs: Math.round(endTime - startTime),
                            cpuTimeMs: 0,
                            memoryUsedMb: Math.round((endRss - startRss) / 1024 / 1024),
                        },
                    })
                }
            })
        })
    }
}

// =============================================================================
// RPC Handler (Main Thread)
// =============================================================================

/**
 * Handle an RPC request from the worker thread.
 * Looks up the method in apiBindings and sends the response back.
 */
async function handleRpcRequest(
    req: RpcRequest,
    apiBindings: Record<string, unknown>,
    hostPort: MessagePort
): Promise<void> {
    const response: RpcResponse = { id: req.id }

    try {
        // _topLevel methods are direct keys on apiBindings
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

/**
 * Pool of worker-thread sandboxes for concurrent execution.
 * Creates a fresh worker for every execution to guarantee clean state.
 */
export class WorkerSandboxPool {
    private readonly options: Required<PoolOptions>
    private readonly sandboxOptions: SandboxOptions
    private activeCount = 0

    constructor(sandboxOptions?: SandboxOptions, poolOptions?: PoolOptions) {
        this.sandboxOptions = sandboxOptions ?? {}
        this.options = { ...DEFAULT_POOL_OPTIONS, ...poolOptions }
    }

    /**
     * Execute code in a pooled worker sandbox.
     */
    async execute(
        code: string,
        apiBindings: Record<string, unknown>,
        timeoutMs?: number
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
            const sandbox = new WorkerSandbox(this.sandboxOptions)
            return await sandbox.execute(code, apiBindings, timeoutMs)
        } finally {
            this.activeCount--
        }
    }

    /** Get the current active execution count */
    getActiveCount(): number {
        return this.activeCount
    }

    /** Unique pool identifier */
    readonly poolId = crypto.randomUUID()
}
