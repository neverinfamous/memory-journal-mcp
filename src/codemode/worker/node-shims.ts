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
        writeFileSync: (): void => undefined,
        writeFile: (): Promise<void> => Promise.resolve(undefined),
        mkdirSync: (): void => undefined,
        unlinkSync: (): void => undefined,
        readdirSync: (): string[] => [],
        promises: {
            stat: () => Promise.resolve(buildStats()),
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

interface ParsedSql {
    action: string
    params: Record<string, unknown>
}

const WHERE_ID_PATTERN = /\bWHERE\s+[`"']?(?:id|entry_id)[`"']?\s*=\s*(?:\?|(\d+))/i

/** Parses a JSON-array-looking string into tags; returns undefined when it is not a JSON array. */
function tryParseTagsString(arg: string): string[] | undefined {
    if (!(arg.trim().startsWith('[') && arg.trim().endsWith(']'))) return undefined
    try {
        const parsed: unknown = JSON.parse(arg)
        if (Array.isArray(parsed)) return parsed.map(String)
    } catch {
        // Not valid JSON: intentionally treated as plain text by callers
        // (the worker has no logger and this is an expected heuristic miss).
    }
    return undefined
}

/** Entry id from `WHERE id = N`, or the first numeric bind when the placeholder is `?`. */
function resolveEntryIdFromSql(cleanSql: string, args: unknown[]): number | undefined {
    const idMatch = WHERE_ID_PATTERN.exec(cleanSql)
    if (idMatch?.[1] !== undefined) return parseInt(idMatch[1], 10)
    const whereUsesPlaceholder = idMatch !== null && idMatch[1] === undefined
    if (!whereUsesPlaceholder) return undefined
    for (const arg of args) {
        if (typeof arg === 'number') return arg
    }
    return undefined
}

function scopeFromRecordArgs(args: unknown[]): Record<string, unknown> {
    const scope: Record<string, unknown> = {}
    for (const arg of args) {
        if (!isPlainRecord(arg)) continue
        const wsId = arg['workspace_id'] ?? arg['workspaceId']
        if (typeof wsId === 'string' && wsId.trim() !== '') scope['workspace_id'] = wsId
        const projNum = arg['project_number'] ?? arg['projectNumber']
        if (typeof projNum === 'number') scope['project_number'] = projNum
    }
    return scope
}

function scopeFromSqlLiterals(cleanSql: string): Record<string, unknown> {
    const projectMatch = /\b(?:WHERE|AND)\s+[`"']?(?:project_number|project_id)[`"']?\s*=\s*(\d+)/i.exec(cleanSql)
    const projectVal = projectMatch?.[1] !== undefined ? parseInt(projectMatch[1], 10) : undefined
    const wsMatch = /\b(?:WHERE|AND)\s+[`"']?workspace_id[`"']?\s*=\s*['"]([^'"]+)['"]/i.exec(cleanSql)
    const wsVal = wsMatch?.[1]
    return {
        ...(projectVal !== undefined ? { project_number: projectVal } : {}),
        ...(wsVal !== undefined && wsVal !== '' ? { workspace_id: wsVal } : {}),
    }
}

function parseUpdateStatement(cleanSql: string, args: unknown[]): ParsedSql {
    const idMatch = WHERE_ID_PATTERN.exec(cleanSql)
    let entryId: number | undefined
    if (idMatch?.[1] !== undefined) {
        entryId = parseInt(idMatch[1], 10)
    }

    let content: string | undefined
    let tags: string[] | undefined
    let title: string | undefined
    let workspaceId: string | undefined
    let projectNumber: number | undefined

    for (const arg of args) {
        if (typeof arg === 'number' && entryId === undefined) {
            entryId = arg
        } else if (typeof arg === 'string') {
            const parsedTags = tryParseTagsString(arg)
            if (parsedTags !== undefined) {
                tags = parsedTags
                continue
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
            if (typeof arg['workspace_id'] === 'string') workspaceId = arg['workspace_id']
            if (typeof arg['workspaceId'] === 'string') workspaceId ??= arg['workspaceId']
            if (typeof arg['project_number'] === 'number') projectNumber = arg['project_number']
            if (typeof arg['projectNumber'] === 'number') projectNumber ??= arg['projectNumber']
        }
    }

    if (content === undefined) {
        const setContentMatch = /\bSET\s+[\s\S]*?\bcontent\s*=\s*['"]([\s\S]*?)['"]/i.exec(cleanSql)
        if (setContentMatch?.[1] !== undefined) {
            content = setContentMatch[1]
        }
    }

    const sqlScope = scopeFromSqlLiterals(cleanSql)
    if (workspaceId === undefined && typeof sqlScope['workspace_id'] === 'string') {
        workspaceId = sqlScope['workspace_id']
    }
    if (projectNumber === undefined && typeof sqlScope['project_number'] === 'number') {
        projectNumber = sqlScope['project_number']
    }

    const updatePayload: Record<string, unknown> = {}
    if (entryId !== undefined) updatePayload['entry_id'] = entryId
    if (content !== undefined) updatePayload['content'] = content
    if (tags !== undefined) updatePayload['tags'] = tags
    if (title !== undefined) updatePayload['title'] = title
    if (workspaceId !== undefined) updatePayload['workspace_id'] = workspaceId
    if (projectNumber !== undefined) updatePayload['project_number'] = projectNumber

    if (entryId === undefined) return { action: 'unmapped', params: {} }
    return { action: 'update', params: updatePayload }
}

function parseInsertStatement(args: unknown[]): ParsedSql {
    let content = ''
    let title: string | undefined
    let tags: string[] = []
    let entryType = 'technical_decision'
    let workspaceId: string | undefined
    let projectNumber: number | undefined

    for (const arg of args) {
        if (typeof arg === 'string') {
            const parsedTags = tryParseTagsString(arg)
            if (parsedTags !== undefined) {
                tags = parsedTags
                continue
            }
            if (content === '') {
                content = arg
            } else {
                title ??= arg
            }
        } else if (Array.isArray(arg)) {
            tags = arg.map(String)
        } else if (isPlainRecord(arg)) {
            if (typeof arg['content'] === 'string') content = arg['content']
            if (typeof arg['title'] === 'string') title = arg['title']
            if (Array.isArray(arg['tags'])) tags = arg['tags'].map(String)
            if (typeof arg['entry_type'] === 'string') entryType = arg['entry_type']
            if (typeof arg['workspace_id'] === 'string') workspaceId = arg['workspace_id']
            if (typeof arg['workspaceId'] === 'string') workspaceId ??= arg['workspaceId']
            if (typeof arg['project_number'] === 'number') projectNumber = arg['project_number']
            if (typeof arg['projectNumber'] === 'number') projectNumber ??= arg['projectNumber']
        }
    }

    if (content === '') return { action: 'unmapped', params: {} }
    return {
        action: 'create',
        params: {
            content,
            ...(title !== undefined ? { title } : {}),
            tags,
            entry_type: entryType,
            ...(workspaceId !== undefined ? { workspace_id: workspaceId } : {}),
            ...(projectNumber !== undefined ? { project_number: projectNumber } : {}),
        },
    }
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
            return parseUpdateStatement(cleanSql, args)
        }

        if (isInsert) {
            return parseInsertStatement(args)
        }

        if (isDelete) {
            const entryId = resolveEntryIdFromSql(cleanSql, args)
            if (entryId === undefined) return { action: 'unmapped', params: {} }
            return {
                action: 'delete',
                params: {
                    entry_id: entryId,
                    ...scopeFromSqlLiterals(cleanSql),
                    ...scopeFromRecordArgs(args),
                },
            }
        }

        if (isSelect) {
            const entryId = resolveEntryIdFromSql(cleanSql, args)
            if (entryId !== undefined) {
                return {
                    action: 'get_by_id',
                    params: {
                        entry_id: entryId,
                        ...scopeFromSqlLiterals(cleanSql),
                        ...scopeFromRecordArgs(args),
                    },
                }
            }
            return { action: 'unmapped', params: {} }
        }

        return { action: 'other', params: {} }
    }

    const executeOperation = (args: unknown[]): unknown => {
        const { action, params } = parseSqlParams(args)

        if (action === 'update') {
            return (
                invokeGroupMethod(shimMj, 'admin', 'updateEntry', 'update_entry', params) ??
                invokeGroupMethod(shimMj, 'core', 'updateEntry', 'update_entry', params) ??
                Promise.resolve({
                    success: false,
                    code: 'VALIDATION_ERROR',
                    error: 'Statement could not be mapped to a journal method',
                })
            )
        }
        if (action === 'create') {
            return (
                invokeGroupMethod(shimMj, 'core', 'createEntry', 'create_entry', params) ??
                Promise.resolve({
                    success: false,
                    code: 'VALIDATION_ERROR',
                    error: 'Statement could not be mapped to a journal method',
                })
            )
        }
        if (action === 'delete') {
            return (
                invokeGroupMethod(shimMj, 'admin', 'deleteEntry', 'delete_entry', params) ??
                invokeGroupMethod(shimMj, 'core', 'deleteEntry', 'delete_entry', params) ??
                Promise.resolve({
                    success: false,
                    code: 'VALIDATION_ERROR',
                    error: 'Statement could not be mapped to a journal method',
                })
            )
        }
        if (action === 'get_by_id') {
            return (
                invokeGroupMethod(shimMj, 'core', 'getEntryById', 'get_entry_by_id', params) ??
                Promise.resolve({
                    success: false,
                    code: 'VALIDATION_ERROR',
                    error: 'Statement could not be mapped to a journal method',
                })
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
                ) ?? Promise.resolve({
                    success: false,
                    code: 'VALIDATION_ERROR',
                    error: 'Statement could not be mapped to a journal method',
                })
            )
        }
        return Promise.resolve({
            success: false,
            code: 'VALIDATION_ERROR',
            error: 'Statement could not be mapped to a journal method',
            _healing_note: 'The SQL statement was not executed.',
        })
    }

    const stmtObj: Record<string, unknown> = {
        run: (...args: unknown[]) => executeOperation(args),
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
