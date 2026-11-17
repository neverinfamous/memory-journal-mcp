import * as fs from 'node:fs'
import * as path from 'node:path'
import { logger } from '../../utils/logger.js'

/** Base backoff (ms) between embedding-model load retries; multiplied by the attempt number. */
export const MODEL_LOAD_RETRY_DELAY_MS = 250

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
