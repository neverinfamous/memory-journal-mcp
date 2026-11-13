/**
 * Worker Node.js Shims - safe sandbox shims for `fs`, `path`, `console`,
 * and SQLite prepared statements (`db.prepare(...)`).
 */

import * as nodePath from 'node:path'

export { createPreparedStatementShim } from './sql-statement-shim.js'

/**
 * [INTENT] Disabled mutation shims throw a structured VALIDATION_ERROR instead of
 * silently no-op'ing, so sandboxed code never reports a fake successful write.
 */
function disabledFsOperation(name: string): never {
    const err = new Error(
        `VALIDATION_ERROR: fs.${name} is disabled inside Code Mode. Persist data with mj.core.createEntry / mj.admin.updateEntry instead.`
    )
    err.name = 'VALIDATION_ERROR'
    throw err
}

function rejectFsOperation(name: string): Promise<never> {
    try {
        return disabledFsOperation(name)
    } catch (err) {
        return Promise.reject(err instanceof Error ? err : new Error(String(err)))
    }
}

const toStr = (val: unknown): string => {
    if (typeof val === 'string') return val
    if (typeof val === 'number' || typeof val === 'boolean') return `${val}`
    return ''
}

export interface SafeFsShim {
    existsSync: (filePath?: unknown) => boolean
    statSync: (_filePath?: unknown) => {
        size: number
        isFile: () => boolean
        isDirectory: () => boolean
        mtime: Date
        birthtime: Date
    }
    stat: (_filePath?: unknown, cb?: (err: Error | null, stats?: unknown) => void) => Promise<unknown>
    lstatSync: (_filePath?: unknown) => {
        size: number
        isFile: () => boolean
        isDirectory: () => boolean
        mtime: Date
        birthtime: Date
    }
    readFileSync: (_filePath?: unknown) => string
    readFile: (_filePath?: unknown, cb?: (err: Error | null, data?: string) => void) => Promise<string>
    writeFileSync: () => void
    writeFile: () => Promise<void>
    mkdirSync: () => void
    unlinkSync: () => void
    readdirSync: () => string[]
    promises: {
        stat: () => Promise<{
            size: number
            isFile: () => boolean
            isDirectory: () => boolean
            mtime: Date
            birthtime: Date
        }>
        readFile: () => Promise<string>
        writeFile: () => Promise<void>
    }
}

export function createSafeFsShim(contextObj?: Record<string, unknown>): SafeFsShim {
    const hasContextContent =
        contextObj !== undefined && typeof contextObj['content'] === 'string'
    const readContent = (): string =>
        hasContextContent ? (contextObj['content'] as string) : ''
    const buildStats = (): {
        size: number
        isFile: () => boolean
        isDirectory: () => boolean
        mtime: Date
        birthtime: Date
    } => ({
        size: Buffer.byteLength(readContent(), 'utf-8'),
        isFile: () => false,
        isDirectory: () => false,
        mtime: new Date(),
        birthtime: new Date(),
    })

    return {
        existsSync: (_filePath?: unknown): boolean => false,
        statSync: (_filePath?: unknown) => buildStats(),
        stat: (
            _filePath?: unknown,
            cb?: (err: Error | null, stats?: unknown) => void
        ): Promise<unknown> => {
            const s = buildStats()
            if (typeof cb === 'function') cb(null, s)
            return Promise.resolve(s)
        },
        lstatSync: (_filePath?: unknown) => buildStats(),
        readFileSync: (_filePath?: unknown) => readContent(),
        readFile: (
            _filePath?: unknown,
            cb?: (err: Error | null, data?: string) => void
        ): Promise<string> => {
            const data = readContent()
            if (typeof cb === 'function') cb(null, data)
            return Promise.resolve(data)
        },
        writeFileSync: (): void => disabledFsOperation('writeFileSync'),
        writeFile: (): Promise<void> => rejectFsOperation('writeFile'),
        mkdirSync: (): void => disabledFsOperation('mkdirSync'),
        unlinkSync: (): void => disabledFsOperation('unlinkSync'),
        readdirSync: (): string[] => [],
        promises: {
            stat: () => Promise.resolve(buildStats()),
            readFile: (): Promise<string> => Promise.resolve(readContent()),
            writeFile: (): Promise<void> => rejectFsOperation('promises.writeFile'),
        },
    }
}

const toPosix = (p: unknown): string => toStr(p).replace(/\\/g, '/')
const stringParts = (parts: unknown[]): string[] =>
    parts.filter((p): p is string => typeof p === 'string' && p.length > 0).map(toPosix)

/**
 * [BOUNDARY] Backed by `node:path` posix semantics over `/`-normalized input so Windows
 * separators are handled; `resolve` never consults the host `process.cwd()`.
 */
export const pathShim = {
    join: (...parts: unknown[]): string => {
        const valid = stringParts(parts)
        return valid.length === 0 ? '.' : nodePath.posix.join(...valid)
    },
    resolve: (...parts: unknown[]): string => {
        const valid = stringParts(parts)
        let start = 0
        for (let i = valid.length - 1; i >= 0; i--) {
            if (nodePath.win32.isAbsolute(valid[i] ?? '') || (valid[i] ?? '').startsWith('/')) {
                start = i
                break
            }
        }
        const joined = valid.slice(start)
        return joined.length === 0 ? '.' : nodePath.posix.normalize(joined.join('/')).replace(/(.)\/$/, '$1')
    },
    basename: (p: unknown, ext?: string): string => nodePath.posix.basename(toPosix(p), ext),
    dirname: (p: unknown): string => nodePath.posix.dirname(toPosix(p)),
    extname: (p: unknown): string => nodePath.posix.extname(toPosix(p)),
    normalize: (p: unknown): string => nodePath.posix.normalize(toPosix(p)),
    isAbsolute: (p: unknown): boolean =>
        nodePath.win32.isAbsolute(toStr(p)) || nodePath.posix.isAbsolute(toPosix(p)),
    sep: '/',
    delimiter: ':',
}

export const consoleShim = Object.freeze({
    log: (...args: unknown[]) => args,
    warn: (...args: unknown[]) => args,
    error: (...args: unknown[]) => args,
    info: (...args: unknown[]) => args,
    debug: (...args: unknown[]) => args,
})
