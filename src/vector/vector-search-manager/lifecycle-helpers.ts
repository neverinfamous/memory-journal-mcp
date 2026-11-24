/**
 * Model load serialization and native ONNX pipeline disposal helpers for `VectorSearchManager`.
 */

import type { IDatabaseAdapter } from '../../database/core/interfaces.js'
import { logger } from '../../utils/logger.js'
import { isRecord } from '../../utils/type-guards.js'
import {
    isModelCachedOnDisk,
    isTransientFileLockError,
    MODEL_LOAD_RETRY_DELAY_MS,
    type TransformersPipelineModule,
} from './model-cache.js'

let modelLoadMutex: Promise<void> = Promise.resolve()

/** Serialize ONNX model loading across `VectorSearchManager` instances. */
export function withModelLoadLock<T>(fn: () => Promise<T>): Promise<T> {
    const next = modelLoadMutex.then(fn, fn)
    modelLoadMutex = next.then(
        () => undefined,
        () => undefined
    )
    return next
}

/** Retry pipeline construction across transient Windows ONNX cache-lock errors. */
export async function loadPipelineWithRetry(
    transformersModule: TransformersPipelineModule,
    modelName: string,
    cacheDir: string,
    cachedLocally: boolean,
    attempt = 1,
    maxAttempts = 5
): Promise<unknown> {
    try {
        if (attempt > 1 && (cachedLocally || isModelCachedOnDisk(cacheDir, modelName))) {
            transformersModule.env['allowRemoteModels'] = false
        }
        return await transformersModule.pipeline('feature-extraction', modelName, {
            dtype: 'fp32',
        })
    } catch (pipelineErr) {
        if (attempt < maxAttempts && isTransientFileLockError(pipelineErr)) {
            transformersModule.env['allowRemoteModels'] = true
            await new Promise((r) => setTimeout(r, MODEL_LOAD_RETRY_DELAY_MS * attempt))
            return loadPipelineWithRetry(
                transformersModule,
                modelName,
                cacheDir,
                cachedLocally,
                attempt + 1,
                maxAttempts
            )
        }
        throw pipelineErr
    }
}

/** Flush queued entry deletions that occurred while a vector rebuild was running. */
export function flushPendingVectorRemovals(
    dbAdapter: IDatabaseAdapter,
    pendingRemovedIds: Set<number>
): void {
    if (pendingRemovedIds.size === 0) return
    const ids = [...pendingRemovedIds]
    pendingRemovedIds.clear()
    for (const id of ids) {
        try {
            dbAdapter.deleteVector(id)
        } catch (error) {
            logger.warning(`Failed to remove entry ${id} from vector index post-rebuild`, { error })
        }
    }
}

/** Dispose a loaded transformers pipeline session if it exposes a `dispose()` method. */
export async function disposePipelineHandle(pipeline: unknown): Promise<void> {
    if (!isRecord(pipeline) && typeof pipeline !== 'function') return
    const maybeDispose: unknown = Reflect.get(pipeline, 'dispose')
    if (typeof maybeDispose !== 'function') return
    try {
        const result: unknown = Reflect.apply(maybeDispose, pipeline, [])
        await result
    } catch (error: unknown) {
        logger.debug('Failed to dispose vector pipeline session', {
            error: error instanceof Error ? error.message : String(error),
        })
    }
}
