import * as fs from 'node:fs'
import * as path from 'node:path'
import { logger } from '../../utils/logger.js'
import { isRecord } from '../../utils/type-guards.js'

/** Base backoff (ms) between embedding-model load retries; multiplied by the attempt number. */
export const MODEL_LOAD_RETRY_DELAY_MS = 250

export interface TransformersPipelineModule {
    pipeline: (task: string, model: string, options: unknown) => Promise<unknown>
    env: Record<string, unknown>
}

export function isCallable(val: unknown): val is (...args: unknown[]) => unknown {
    return typeof val === 'function'
}

export function asNumberArrayLike(val: unknown): ArrayLike<number> | undefined {
    if (val instanceof Float32Array || val instanceof Float64Array || val instanceof Int32Array) {
        return val
    }
    if (Array.isArray(val) && val.every((v): v is number => typeof v === 'number')) {
        return val
    }
    if (
        isRecord(val) &&
        typeof val['length'] === 'number' &&
        Number.isInteger(val['length']) &&
        val['length'] >= 0
    ) {
        const len = val['length']
        const arr = new Float32Array(len)
        for (let i = 0; i < len; i++) {
            const item = val[String(i)]
            if (typeof item !== 'number') return undefined
            arr[i] = item
        }
        return arr
    }
    return undefined
}

export async function loadTransformersModule(): Promise<TransformersPipelineModule> {
    // [PERF]: Keep dynamic specifier non-literal so tsc/eslint skip 429 @huggingface/transformers .d.ts files
    const transformersModuleName = '@huggingface/transformers'
    const mod: unknown = await import(transformersModuleName)
    if (!isRecord(mod) || !isCallable(mod['pipeline']) || !isRecord(mod['env'])) {
        throw new Error('Invalid @huggingface/transformers module shape')
    }
    const rawPipeline = mod['pipeline']
    return {
        pipeline: (task: string, model: string, options: unknown): Promise<unknown> =>
            Promise.resolve().then(() => Reflect.apply(rawPipeline, mod, [task, model, options])),
        env: mod['env'],
    }
}

export async function invokeSingleEmbeddingPipeline(
    pipeline: unknown,
    text: string
): Promise<Float32Array> {
    if (!isCallable(pipeline)) {
        throw new Error('Embedding pipeline is not initialized')
    }
    const result: unknown = await Promise.resolve().then(() =>
        pipeline(text, { pooling: 'mean', normalize: true })
    )
    const data = isRecord(result) ? asNumberArrayLike(result['data']) : undefined
    if (data === undefined) {
        throw new Error('Embedding pipeline returned invalid tensor data')
    }
    return new Float32Array(data)
}

export function dbPathFromAdapter(adapter: { getDbPath?: () => string }): string | undefined {
    if (typeof adapter.getDbPath !== 'function') {
        return undefined
    }
    return adapter.getDbPath()
}

export function resolveEmbeddingCacheDir(dbPath: string | undefined): string {
    const override = process.env['EMBEDDING_CACHE_DIR']
    if (override !== undefined && override !== '') {
        return override
    }
    if (dbPath !== undefined && dbPath !== '') {
        return path.join(path.dirname(dbPath), '.cache', 'huggingface')
    }
    return path.join('.cache', 'huggingface')
}

export function isModelCachedOnDisk(cacheDir: string, modelName: string): boolean {
    try {
        const modelParts = modelName.split('/')
        const onnxPath = path.join(cacheDir, ...modelParts, 'onnx', 'model.onnx')
        const configPath = path.join(cacheDir, ...modelParts, 'config.json')
        return fs.existsSync(onnxPath) && fs.existsSync(configPath)
    } catch (err) {
        logger.debug('Failed to check whether embedding model is cached on disk', {
            module: 'VectorSearch',
            cacheDir,
            modelName,
            error: err instanceof Error ? err.message : String(err),
        })
        return false
    }
}

export function isTransientFileLockError(err: unknown): boolean {
    const msg = err instanceof Error ? err.message : String(err)
    return msg.includes('EPERM') || msg.includes('EBUSY') || msg.includes('EACCES')
}
