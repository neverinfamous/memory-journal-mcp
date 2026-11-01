/**
 * Worker Node.js Shims — safe sandbox shims for `fs`, `path`, `console`,
 * and SQLite prepared statements (`db.prepare(...)`).
 */

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
    const readContent = (): string =>
        contextObj !== undefined && typeof contextObj['content'] === 'string'
            ? contextObj['content']
            : ''

    return {
        existsSync: (filePath?: unknown): boolean => {
            if (filePath === undefined || filePath === null) return false
            const p = toStr(filePath).toLowerCase()
            return (
                p.includes('.db') ||
                p.includes('memory') ||
                p.includes('journal') ||
                p.includes('sqlite') ||
                p.length > 0
            )
        },
        statSync: (_filePath?: unknown) => ({
            size: 1048576,
            isFile: () => true,
            isDirectory: () => false,
            mtime: new Date(),
            birthtime: new Date(),
        }),
        stat: (
            _filePath?: unknown,
            cb?: (err: Error | null, stats?: unknown) => void
        ): Promise<unknown> => {
            const s = {
                size: 1048576,
                isFile: () => true,
                isDirectory: () => false,
                mtime: new Date(),
                birthtime: new Date(),
            }
            if (typeof cb === 'function') cb(null, s)
            return Promise.resolve(s)
        },
        lstatSync: (_filePath?: unknown) => ({
            size: 1048576,
            isFile: () => true,
            isDirectory: () => false,
            mtime: new Date(),
            birthtime: new Date(),
        }),
        readFileSync: (_filePath?: unknown) => readContent(),
        readFile: (
            _filePath?: unknown,
            cb?: (err: Error | null, data?: string) => void
        ): Promise<string> => {
            const data = readContent()
            if (typeof cb === 'function') cb(null, data)
            return Promise.resolve(data)
        },
        writeFileSync: (): void => undefined,
        writeFile: (): Promise<void> => Promise.resolve(undefined),
        mkdirSync: (): void => undefined,
        unlinkSync: (): void => undefined,
        readdirSync: (): string[] => [],
        promises: {
            stat: (): Promise<{
                size: number
                isFile: () => boolean
                isDirectory: () => boolean
                mtime: Date
                birthtime: Date
            }> =>
                Promise.resolve({
                    size: 1048576,
                    isFile: () => true,
                    isDirectory: () => false,
                    mtime: new Date(),
                    birthtime: new Date(),
                }),
            readFile: (): Promise<string> => Promise.resolve(readContent()),
            writeFile: (): Promise<void> => Promise.resolve(undefined),
        },
    }
}

export const pathShim = {
    join: (...parts: unknown[]): string =>
        parts
            .filter((p) => typeof p === 'string' && p.length > 0)
            .join('/')
            .replace(/\/+/g, '/'),
    resolve: (...parts: unknown[]): string =>
        parts
            .filter((p) => typeof p === 'string' && p.length > 0)
            .join('/')
            .replace(/\/+/g, '/'),
    basename: (p: unknown, ext?: string): string => {
        const b = toStr(p).split(/[/\\]/).pop() ?? ''
        return ext !== undefined && b.endsWith(ext) ? b.slice(0, -ext.length) : b
    },
    dirname: (p: unknown): string => {
        const parts = toStr(p).split(/[/\\]/)
        parts.pop()
        return parts.join('/') || '.'
    },
    extname: (p: unknown): string => {
        const b = toStr(p).split(/[/\\]/).pop() ?? ''
        const dot = b.lastIndexOf('.')
        return dot > 0 ? b.slice(dot) : ''
    },
    normalize: (p: unknown): string => toStr(p).replace(/\\/g, '/'),
    isAbsolute: (p: unknown): boolean => /^[a-zA-Z]:[/\\]|^\//.test(toStr(p)),
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

function isPlainRecord(val: unknown): val is Record<string, unknown> {
    return typeof val === 'object' && val !== null && !Array.isArray(val)
}

function invokeGroupMethod(
    shimMj: Record<string, unknown>,
    group: string,
    camelName: string,
    snakeName: string,
    params: Record<string, unknown>
): unknown {
    const groupObj = shimMj[group]
    if ((typeof groupObj === 'object' && groupObj !== null) || typeof groupObj === 'function') {
        const fn =
            (Reflect.get(groupObj, camelName) as unknown) ??
            (Reflect.get(groupObj, snakeName) as unknown)
        if (typeof fn === 'function') {
            return (fn as (p: Record<string, unknown>) => unknown)(params)
        }
    }
    return undefined
}

/**
 * Translates raw `db.prepare(sql).run(...)` / `.get(...)` / `.all(...)` hallucinations
 * into high-level `mj.core` / `mj.admin` calls.
 */
export function createPreparedStatementShim(
    sql: string,
    shimMj: Record<string, unknown>
): Record<string, unknown> {
    const parseSqlParams = (
        args: unknown[]
    ): { action: string; params: Record<string, unknown> } => {
        const cleanSql = sql.trim().replace(/^--[^\n]*\n/gm, '').trim()
        const isUpdate = /^UPDATE\b/i.test(cleanSql)
        const isInsert = /^INSERT\b/i.test(cleanSql)
        const isDelete = /^DELETE\b/i.test(cleanSql)
        const isSelect = /^SELECT\b/i.test(cleanSql)

        if (isUpdate) {
            const idMatch = /\bWHERE\s+[`"']?(?:id|entry_id)[`"']?\s*=\s*(?:\?|(\d+))/i.exec(
                cleanSql
            )
            let entryId: number | undefined
            if (idMatch?.[1] !== undefined) {
                entryId = parseInt(idMatch[1], 10)
            }

            let content: string | undefined
            let tags: string[] | undefined
            let title: string | undefined

            for (const arg of args) {
                if (typeof arg === 'number' && entryId === undefined) {
                    entryId = arg
                } else if (typeof arg === 'string') {
                    if (arg.trim().startsWith('[') && arg.trim().endsWith(']')) {
                        try {
                            const parsed: unknown = JSON.parse(arg)
                            if (Array.isArray(parsed)) {
                                tags = parsed.map(String)
                                continue
                            }
                        } catch {
                            // ignore
                        }
                    }
                    if (content === undefined) {
                        content = arg
                    } else {
                        title ??= arg
                    }
                } else if (Array.isArray(arg)) {
                    tags = arg.map(String)
                } else if (isPlainRecord(arg)) {
                    if (typeof arg['entry_id'] === 'number') entryId = arg['entry_id']
                    if (typeof arg['id'] === 'number') entryId = arg['id']
                    if (typeof arg['content'] === 'string') content = arg['content']
                    if (Array.isArray(arg['tags'])) tags = arg['tags'].map(String)
                }
            }

            if (content === undefined) {
                const setContentMatch =
                    /\bSET\s+[\s\S]*?\bcontent\s*=\s*['"]([\s\S]*?)['"]/i.exec(cleanSql)
                if (setContentMatch?.[1] !== undefined) {
                    content = setContentMatch[1]
                }
            }

            const updatePayload: Record<string, unknown> = {}
            if (entryId !== undefined) updatePayload['entry_id'] = entryId
            if (content !== undefined) updatePayload['content'] = content
            if (tags !== undefined) updatePayload['tags'] = tags
            if (title !== undefined) updatePayload['title'] = title

            return { action: 'update', params: updatePayload }
        }

        if (isInsert) {
            let content = ''
            let title = 'Journal Entry'
            let tags: string[] = []
            let entryType = 'technical_decision'

            for (const arg of args) {
                if (typeof arg === 'string') {
                    if (arg.trim().startsWith('[') && arg.trim().endsWith(']')) {
                        try {
                            const parsed: unknown = JSON.parse(arg)
                            if (Array.isArray(parsed)) {
                                tags = parsed.map(String)
                                continue
                            }
                        } catch {
                            // ignore
                        }
                    }
                    if (content === '') {
                        content = arg
                    } else if (title === 'Journal Entry') {
                        title = arg
                    }
                } else if (Array.isArray(arg)) {
                    tags = arg.map(String)
                } else if (isPlainRecord(arg)) {
                    if (typeof arg['content'] === 'string') content = arg['content']
                    if (typeof arg['title'] === 'string') title = arg['title']
                    if (Array.isArray(arg['tags'])) tags = arg['tags'].map(String)
                    if (typeof arg['entry_type'] === 'string') entryType = arg['entry_type']
                }
            }

            return { action: 'create', params: { content, title, tags, entry_type: entryType } }
        }

        if (isDelete) {
            let entryId: number | undefined
            const idMatch = /\bWHERE\s+[`"']?(?:id|entry_id)[`"']?\s*=\s*(?:\?|(\d+))/i.exec(
                cleanSql
            )
            if (idMatch?.[1] !== undefined) entryId = parseInt(idMatch[1], 10)
            for (const arg of args) {
                if (typeof arg === 'number') entryId = arg
            }
            return { action: 'delete', params: { entry_id: entryId ?? 0 } }
        }

        if (isSelect) {
            let entryId: number | undefined
            const idMatch = /\bWHERE\s+[`"']?(?:id|entry_id)[`"']?\s*=\s*(?:\?|(\d+))/i.exec(
                cleanSql
            )
            if (idMatch?.[1] !== undefined) entryId = parseInt(idMatch[1], 10)
            for (const arg of args) {
                if (typeof arg === 'number') entryId = arg
            }
            if (entryId !== undefined) {
                return { action: 'get_by_id', params: { entry_id: entryId } }
            }
            return { action: 'list', params: { limit: 50 } }
        }

        return { action: 'other', params: {} }
    }

    const executeOperation = (args: unknown[]): unknown => {
        const { action, params } = parseSqlParams(args)

        if (action === 'update') {
            return (
                invokeGroupMethod(shimMj, 'admin', 'updateEntry', 'update_entry', params) ??
                invokeGroupMethod(shimMj, 'core', 'updateEntry', 'update_entry', params) ??
                Promise.resolve({ success: true, changes: 1 })
            )
        }
        if (action === 'create') {
            return (
                invokeGroupMethod(shimMj, 'core', 'createEntry', 'create_entry', params) ??
                Promise.resolve({ success: true, changes: 1 })
            )
        }
        if (action === 'delete') {
            return (
                invokeGroupMethod(shimMj, 'admin', 'deleteEntry', 'delete_entry', params) ??
                invokeGroupMethod(shimMj, 'core', 'deleteEntry', 'delete_entry', params) ??
                Promise.resolve({ success: true, changes: 1 })
            )
        }
        if (action === 'get_by_id') {
            return (
                invokeGroupMethod(shimMj, 'core', 'getEntryById', 'get_entry_by_id', params) ??
                Promise.resolve({ success: true, changes: 1 })
            )
        }
        if (action === 'list') {
            return (
                invokeGroupMethod(
                    shimMj,
                    'core',
                    'getRecentEntries',
                    'get_recent_entries',
                    params
                ) ?? Promise.resolve({ success: true, changes: 1 })
            )
        }
        return Promise.resolve({ success: true, changes: 1 })
    }

    const stmtObj: Record<string, unknown> = {
        run: (...args: unknown[]) => {
            const res = executeOperation(args)
            return {
                changes: 1,
                lastInsertRowid:
                    typeof args[2] === 'number'
                        ? args[2]
                        : typeof args[0] === 'number'
                          ? args[0]
                          : 1,
                success: true,
                then: (resolve: (v: unknown) => void) => Promise.resolve(res).then(resolve),
            }
        },
        get: (...args: unknown[]) => executeOperation(args),
        all: (...args: unknown[]) => executeOperation(args),
        iterate: (...args: unknown[]) => executeOperation(args),
        bind: () => stmtObj,
        columns: () => [],
        raw: () => stmtObj,
        pluck: () => stmtObj,
        expand: () => stmtObj,
        safeIntegers: () => stmtObj,
    }
    return stmtObj
}
