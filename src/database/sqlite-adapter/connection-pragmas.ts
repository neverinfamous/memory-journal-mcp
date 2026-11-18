import type { Database } from 'better-sqlite3'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { logger } from '../../utils/logger.js'
import { hasSqlCipherKey } from './sqlcipher-key.js'

const DDL_RE = /\b(?:DROP|ALTER|CREATE)\b/i

/** Apply standard SQLite safety and performance PRAGMAs to a native connection. */
export function applyNativePragmas(db: Database): void {
    db.pragma('journal_mode = WAL')
    db.pragma('synchronous = NORMAL')
    db.pragma('foreign_keys = ON')
    db.pragma('temp_store = MEMORY')
    db.pragma('busy_timeout = 5000')
    db.pragma('cache_size = -64000')
    if (!hasSqlCipherKey()) {
        db.pragma('mmap_size = 268435456')
    }
}

/** Populate SQLite planner statistics after schema migrations on connection open. */
export function runOptimizeAfterMigrations(db: Database): void {
    try {
        db.pragma('optimize = 0x10002')
    } catch (err: unknown) {
        logger.debug('Post-migration PRAGMA optimize skipped', {
            module: 'NativeConnectionManager',
            error: err instanceof Error ? err.message : String(err),
        })
    }
}

/**
 * Installs a bounded LRU prepared-statement cache on `db.prepare()` so all
 * callers benefit from statement reuse without schema-invalidation leaks.
 */
export function installStatementCache(db: Database): void {
    if (typeof db.prepare !== 'function') return
    const rawPrepare = db.prepare.bind(db)
    const stmtCache = new Map<string, ReturnType<Database['prepare']>>()
    const MAX_CACHE_SIZE = 256

    db.prepare = ((source: string) => {
        const cached = stmtCache.get(source)
        if (cached !== undefined) {
            stmtCache.delete(source)
            stmtCache.set(source, cached)
            return cached
        }
        if (DDL_RE.test(source)) {
            stmtCache.clear()
            return rawPrepare(source)
        }
        const stmt = rawPrepare(source)
        if (stmtCache.size >= MAX_CACHE_SIZE) {
            const oldestKey = stmtCache.keys().next().value
            if (oldestKey !== undefined) {
                stmtCache.delete(oldestKey)
            }
        }
        stmtCache.set(source, stmt)
        return stmt
    }) as Database['prepare']

    if (typeof db.exec === 'function') {
        const rawExec = db.exec.bind(db)
        db.exec = (source: string) => {
            if (DDL_RE.test(source)) {
                stmtCache.clear()
            }
            return rawExec(source)
        }
    }
}

function resolvePackageVecFallbackPath(): string {
    let dir = import.meta.dirname
    for (let depth = 0; depth < 5; depth++) {
        if (fs.existsSync(path.join(dir, 'package.json'))) {
            return path.resolve(dir, 'vec0')
        }
        const parent = path.dirname(dir)
        if (parent === dir) break
        dir = parent
    }
    return path.resolve(import.meta.dirname, '..', '..', '..', 'vec0')
}

/**
 * Load the sqlite-vec extension (npm package first, compiled fallback second).
 * Returns false when close() was called during the async load, so initialization must abort.
 */
export async function loadVecExtensionOnDb(
    db: Database,
    isStillOpen: () => boolean
): Promise<boolean> {
    try {
        const sqliteVec = await import('sqlite-vec')
        if (!isStillOpen()) {
            logger.info('Database closed during initialization, aborting', {
                module: 'NativeConnectionManager',
            })
            return false
        }
        sqliteVec.load(db)
        logger.info('sqlite-vec extension loaded via npm package', {
            module: 'NativeConnectionManager',
        })
    } catch (npmLoadError) {
        logger.warning('sqlite-vec npm package failed to load; trying compiled fallback', {
            module: 'NativeConnectionManager',
            error: String(npmLoadError),
        })
        // [BOUNDARY] Resolve compiled fallback relative to the package root, never process.cwd().
        if (!isStillOpen()) {
            return false
        }
        const fallbackPath = resolvePackageVecFallbackPath()
        try {
            db.loadExtension(fallbackPath)
        } catch (fallbackError) {
            throw new Error(
                `sqlite-vec failed to load via npm (${String(npmLoadError)}) and via fallback ${fallbackPath} (${String(fallbackError)})`,
                { cause: fallbackError }
            )
        }
        logger.info('sqlite-vec extension loaded via compiled fallback', {
            module: 'NativeConnectionManager',
            path: fallbackPath,
        })
    }
    return true
}

/** Best-effort passive WAL checkpoint for explicit flushes while readers may be active. */
export function runPassiveCheckpoint(db: Database): void {
    try {
        db.pragma('wal_checkpoint(PASSIVE)')
    } catch (err: unknown) {
        logger.debug('Passive WAL checkpoint deferred while readers hold WAL', {
            module: 'NativeConnectionManager',
            error: err instanceof Error ? err.message : String(err),
        })
    }
}

/** Run `PRAGMA optimize` and `wal_checkpoint(TRUNCATE)` safely before closing `db`. */
export function runOptimizeAndCheckpointBeforeClose(db: Database): void {
    try {
        db.pragma('optimize')
    } catch (err: unknown) {
        logger.debug('PRAGMA optimize skipped on close', {
            module: 'NativeConnectionManager',
            error: err instanceof Error ? err.message : String(err),
        })
    }
    try {
        db.pragma('wal_checkpoint(TRUNCATE)')
    } catch (err: unknown) {
        logger.debug('WAL truncate checkpoint skipped on close', {
            module: 'NativeConnectionManager',
            error: err instanceof Error ? err.message : String(err),
        })
    }
}
