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
import { getAllowedMethodMetadata, handleRpcRequest } from './worker-rpc-handler.js'
import { parseByteSizeValue } from './shared-context-parsers.js'
import { sanitizeErrorForLogging } from '../utils/security-utils.js'

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

function resolveEffectiveMaxResultSize(override?: number): number {
    let maxResultSize = override
    if (maxResultSize === undefined || Number.isNaN(maxResultSize) || maxResultSize <= 0) {
        const envVal = process.env['CODE_MODE_MAX_RESULT_SIZE']
        maxResultSize = envVal ? (parseByteSizeValue(envVal, 'b') ?? 100 * 1024) : 100 * 1024
    }
    if (Number.isNaN(maxResultSize) || maxResultSize <= 0) return 100 * 1024
    return maxResultSize > 50 * 1024 * 1024 ? 50 * 1024 * 1024 : maxResultSize
}

interface WorkerDispatchParams {
    code: string
    methodList: Record<string, string[]>
    methodListKey: string
    schemas: Record<string, Record<string, string>> | undefined
    effectiveTimeout: number
    maxResultSize: number
    workerPort: MessagePort
    hostPort: MessagePort
    timeoutHandle: NodeJS.Timeout
    contextObj: Record<string, unknown> | undefined
    readonlyMode: boolean | undefined
    dryRunMode: boolean | undefined
    useTestDbMode: boolean | undefined
    startTime: number
    resolve: (result: SandboxResult) => void
}

function sanitizeFailedSandboxResult(result: SandboxResult): void {
    if (result.success) return
    if (typeof result.error === 'string') result.error = sanitizeErrorForLogging(result.error)
    if (typeof result.stack === 'string') result.stack = sanitizeErrorForLogging(result.stack)
}

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
    private lastSentMethodListKey: string | null = null
    private lastSentSchemas: Record<string, Record<string, string>> | undefined
    private hasSentSchemas = false

    private resetSentMetadata(): void {
        this.lastSentMethodListKey = null
        this.lastSentSchemas = undefined
        this.hasSentSchemas = false
    }

    public get isDisposed(): boolean {
        return this.worker === null && !this.isBusy
    }

    constructor(options?: SandboxOptions) {
        this.options = { ...DEFAULT_SANDBOX_OPTIONS, ...options }
        this.initWorker()
    }

    private initWorker(): void {
        this.resetSentMetadata()
        const resourceLimits: ResourceLimits = {
            maxOldGenerationSizeMb: this.options.memoryLimitMb,
            maxYoungGenerationSizeMb: Math.max(8, Math.floor(this.options.memoryLimitMb / 8)),
        }

        const spawnedWorker = new Worker(getWorkerScriptPath(), {
            workerData: {}, // Initialized without specific execution data
            env: {},
            resourceLimits,
        })
        this.worker = spawnedWorker
        spawnedWorker.unref()

        spawnedWorker.on(
            'message',
            (msg: { type: string; id: number; result: SandboxResult; fatal?: boolean }) => {
                if (this.worker !== spawnedWorker) return
                // [INVARIANT] Ignore stale RESULT messages from a previous (timed-out) execution.
                if (msg.type === 'RESULT' && this.currentExecution && msg.id === this.executionId) {
                    clearTimeout(this.currentExecution.timeoutHandle)
                    this.currentExecution.hostPort.close()

                    const endTime = performance.now()
                    const endRss = process.memoryUsage.rss()
                    const result = msg.result
                    sanitizeFailedSandboxResult(result)

                    result.metrics = {
                        wallTimeMs: Math.round(endTime - this.currentExecution.startTime),
                        cpuTimeMs: result.metrics.cpuTimeMs,
                        memoryUsedMb: Math.max(
                            0,
                            Math.round((endRss - this.currentExecution.startRss) / 1024 / 1024)
                        ),
                    }

                    const resolve = this.currentExecution.resolve
                    this.currentExecution = null
                    this.isBusy = false
                    this.lastUsedAt = Date.now()
                    if (msg.fatal === true) {
                        // [H1] Evict and terminate tainted worker when unhandled async rejection/exception fired.
                        this.worker = null
                        this.resetSentMetadata()
                        spawnedWorker.terminate().catch((err: unknown) => {
                            const detail = sanitizeErrorForLogging(
                                err instanceof Error ? err.message : String(err)
                            )
                            process.stderr.write(`Code mode worker terminate failed: ${detail}\n`)
                        })
                    } else {
                        this.worker.unref()
                    }
                    resolve(result)
                }
            }
        )

        spawnedWorker.on('error', (err: Error) => {
            if (this.worker !== spawnedWorker) return
            this.handleWorkerDeath(
                sanitizeErrorForLogging(err.message),
                err.stack !== undefined ? sanitizeErrorForLogging(err.stack) : undefined
            )
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
                error: sanitizeErrorForLogging(errorMsg),
                ...(stack !== undefined ? { stack: sanitizeErrorForLogging(stack) } : {}),
                metrics: {
                    wallTimeMs: Math.round(endTime - startTime),
                    cpuTimeMs: 0,
                    memoryUsedMb: Math.max(0, Math.round((endRss - startRss) / 1024 / 1024)),
                },
            })
        }
        this.worker = null
        this.resetSentMetadata()
    }

    dispose(): void {
        this.isBusy = false
        this.resetSentMetadata()
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
                const detail = sanitizeErrorForLogging(err instanceof Error ? err.message : String(err))
                process.stderr.write(`Code mode worker terminate failed: ${detail}\n`)
            })
        }
    }

    private terminateTimedOutExecution(timedOutId: number): void {
        const worker = this.worker
        // [INVARIANT] Detach the dying worker immediately so a queued RESULT/exit from the timed-out
        // execution cannot clear isBusy and expose a terminating worker to the next pooled execute().
        this.worker = null
        this.resetSentMetadata()
        if (this.currentExecution !== null && this.executionId === timedOutId) {
            this.handleWorkerDeath('Code execution timed out')
        }
        if (worker === null) return
        worker.terminate().catch((err: unknown) => {
            const detail = sanitizeErrorForLogging(err instanceof Error ? err.message : String(err))
            process.stderr.write(`Code mode worker terminate failed: ${detail}\n`)
        })
    }

    private dispatchWorkerMessage(params: WorkerDispatchParams): void {
        // [H7] A DataCloneError (non-cloneable context/bindings) must release ports, timer and isBusy.
        try {
            if (this.worker === null) throw new Error('Code mode worker is not available')
            const sendMethodList = params.methodListKey !== this.lastSentMethodListKey
            const sendSchemas = !this.hasSentSchemas || params.schemas !== this.lastSentSchemas
            const payload: {
                type: 'EXECUTE'
                id: number
                code: string
                timeoutMs: number
                maxResultSize: number
                rpcPort: MessagePort
                contextObj: Record<string, unknown> | undefined
                readonlyMode: boolean | undefined
                dryRunMode?: boolean
                useTestDbMode?: boolean
                methodList?: Record<string, string[]>
                schemaList?: Record<string, Record<string, string>>
            } = {
                type: 'EXECUTE',
                id: this.executionId,
                code: params.code,
                timeoutMs: params.effectiveTimeout,
                maxResultSize: params.maxResultSize,
                rpcPort: params.workerPort,
                contextObj: params.contextObj,
                readonlyMode: params.readonlyMode,
                ...(params.dryRunMode !== undefined ? { dryRunMode: params.dryRunMode } : {}),
                ...(params.useTestDbMode !== undefined ? { useTestDbMode: params.useTestDbMode } : {}),
                ...(sendMethodList ? { methodList: params.methodList } : {}),
                ...(sendSchemas && params.schemas !== undefined
                    ? { schemaList: params.schemas }
                    : {}),
            }
            if (sendSchemas && params.schemas === undefined && this.lastSentSchemas !== undefined) {
                payload.schemaList = undefined
            }
            this.worker.postMessage(payload, [params.workerPort])
            if (sendMethodList) this.lastSentMethodListKey = params.methodListKey
            if (sendSchemas) {
                this.lastSentSchemas = params.schemas
                this.hasSentSchemas = true
            }
        } catch (err: unknown) {
            clearTimeout(params.timeoutHandle)
            params.hostPort.close()
            params.workerPort.close()
            this.worker?.unref()
            this.currentExecution = null
            this.isBusy = false
            const detail = err instanceof Error ? err.message : String(err)
            params.resolve({
                success: false,
                error: `Code Mode could not dispatch the execution (${detail}). Ensure \`context\` contains only JSON-serializable values.`,
                metrics: {
                    wallTimeMs: Math.round(performance.now() - params.startTime),
                    cpuTimeMs: 0,
                    memoryUsedMb: 0,
                },
            })
        }
    }

    private attachHostRpcHandler(
        hostPort: MessageChannel['port1'],
        apiBindings: Record<string, unknown>,
        methodSets: ReturnType<typeof getAllowedMethodMetadata>['methodSets'],
        maxToolInputElements?: number
    ): void {
        hostPort.on('message', (msg: RpcRequest) => {
            void handleRpcRequest(msg, apiBindings, hostPort, methodSets, maxToolInputElements).catch(
                (err: unknown) => {
                    try {
                        hostPort.postMessage({
                            id: typeof msg?.id === 'number' ? msg.id : 0,
                            error: err instanceof Error ? err.message : String(err),
                        })
                    } catch {
                        // Port already closed
                    }
                }
            )
        })
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
        maxResultSizeOverride?: number,
        modeFlags?: {
            dryRunMode?: boolean | undefined
            useTestDbMode?: boolean | undefined
            maxToolInputElements?: number | undefined
        }
    ): Promise<SandboxResult> {
        if (this.isBusy || this.currentExecution !== null) {
            return {
                success: false,
                error: 'WorkerSandbox is already executing a task',
                metrics: { wallTimeMs: 0, cpuTimeMs: 0, memoryUsedMb: 0 },
            }
        }

        const effectiveTimeout = Math.min(timeoutMs ?? this.options.timeoutMs, 30000)
        if (!this.worker) this.initWorker()
        this.isBusy = true
        this.executionId++
        const startTime = performance.now()
        const startRss = process.memoryUsage.rss()

        return await new Promise<SandboxResult>((resolve) => {
            const { methodList, methodListKey, methodSets } = getAllowedMethodMetadata(apiBindings)
            const { port1: hostPort, port2: workerPort } = new MessageChannel()
            const timedOutId = this.executionId
            const timeoutHandle = setTimeout(() => {
                this.terminateTimedOutExecution(timedOutId)
            }, effectiveTimeout)
            timeoutHandle.unref()

            this.currentExecution = { resolve, hostPort, startTime, startRss, timeoutHandle }
            this.attachHostRpcHandler(hostPort, apiBindings, methodSets, modeFlags?.maxToolInputElements)
            this.worker?.ref()

            this.dispatchWorkerMessage({
                code,
                methodList,
                methodListKey,
                schemas,
                effectiveTimeout,
                maxResultSize: resolveEffectiveMaxResultSize(maxResultSizeOverride),
                workerPort,
                hostPort,
                timeoutHandle,
                contextObj,
                readonlyMode,
                dryRunMode: modeFlags?.dryRunMode,
                useTestDbMode: modeFlags?.useTestDbMode,
                startTime,
                resolve,
            })
        })
    }
}

export { WorkerSandboxPool } from './worker-sandbox-pool.js'
