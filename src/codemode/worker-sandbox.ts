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

/** Type alias for group API record */
type GroupApiRecord = Record<string, (...args: unknown[]) => Promise<unknown>>

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
        apiBindings: Record<string, GroupApiRecord>,
    ): Promise<SandboxResult> {
        const startTime = performance.now()
        const startRss = process.memoryUsage.rss()

        return new Promise<SandboxResult>((resolve) => {
            // Build serializable method list (just names, not functions)
            const methodList: Record<string, string[]> = {}
            for (const [group, methods] of Object.entries(apiBindings)) {
                methodList[group] = Object.keys(methods).filter((k) => k !== 'help')
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
                    timeoutMs: this.options.timeoutMs,
                },
                transferList: [workerPort],
                resourceLimits,
            })

            // Send the RPC port to the worker
            worker.postMessage({ type: 'init', port: workerPort }, [workerPort])

            // Hard timeout — terminate worker if it runs too long
            const timeoutHandle = setTimeout(() => {
                worker.terminate().catch(() => {
                    // Worker already dead
                })
            }, this.options.timeoutMs + 1000) // +1s grace for cleanup

            // Handle RPC requests from the worker
            hostPort.on('message', (msg: RpcRequest | { type: 'result'; result: SandboxResult }) => {
                if ('type' in msg && msg.type === 'result') {
                    // Worker completed — forward result
                    clearTimeout(timeoutHandle)
                    hostPort.close()

                    const endTime = performance.now()
                    const endRss = process.memoryUsage.rss()
                    const result = msg.result
                    result.metrics = {
                        wallTimeMs: Math.round(endTime - startTime),
                        cpuTimeMs: result.metrics.cpuTimeMs,
                        memoryUsedMb: Math.round((endRss - startRss) / 1024 / 1024),
                    }

                    resolve(result)
                    return
                }

                // RPC request — execute tool on main thread
                const rpcReq = msg as RpcRequest
                void handleRpcRequest(rpcReq, apiBindings, hostPort)
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
    apiBindings: Record<string, GroupApiRecord>,
    hostPort: MessagePort,
): Promise<void> {
    const response: RpcResponse = { id: req.id }

    try {
        const groupApi = apiBindings[req.group]
        if (!groupApi) {
            response.error = `Unknown API group: ${req.group}`
            hostPort.postMessage(response)
            return
        }

        const method = groupApi[req.method]
        if (!method) {
            response.error = `Unknown method: ${req.group}.${req.method}`
            hostPort.postMessage(response)
            return
        }

        response.result = await method(...req.args)
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
        apiBindings: Record<string, GroupApiRecord>,
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
            return await sandbox.execute(code, apiBindings)
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
