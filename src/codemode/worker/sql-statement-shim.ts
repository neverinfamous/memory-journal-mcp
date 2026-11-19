/**
 * Worker prepared-statement shim — translates `db.prepare(sql).run/get/all(...)`
 * hallucinations into high-level `mj.core` / `mj.admin` calls via the positional binder.
 */

import { parseSqlStatement } from '../sql-positional-binder.js'

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

const unmappedResult = (note?: string): Promise<Record<string, unknown>> =>
    Promise.resolve({
        success: false,
        code: 'VALIDATION_ERROR',
        error: 'Statement could not be mapped to a journal method',
        ...(note !== undefined ? { _healing_note: note } : {}),
    })

const ACTION_TARGETS: Record<string, [group: string, camel: string, snake: string][]> = {
    update: [
        ['admin', 'updateEntry', 'update_entry'],
        ['core', 'updateEntry', 'update_entry'],
    ],
    create: [['core', 'createEntry', 'create_entry']],
    delete: [
        ['admin', 'deleteEntry', 'delete_entry'],
        ['core', 'deleteEntry', 'delete_entry'],
    ],
    get_by_id: [['core', 'getEntryById', 'get_entry_by_id']],
}

export function createPreparedStatementShim(
    sql: string,
    shimMj: Record<string, unknown>
): Record<string, unknown> {
    let boundArgs: unknown[] = []
    const executeOperation = (args: unknown[]): unknown => {
        const effectiveArgs = args.length > 0 ? args : boundArgs
        const { action, params } = parseSqlStatement(sql, effectiveArgs)
        const targets = ACTION_TARGETS[action]
        if (targets === undefined) {
            return unmappedResult('The SQL statement was not executed.')
        }
        for (const [group, camel, snake] of targets) {
            const res = invokeGroupMethod(shimMj, group, camel, snake, params)
            if (res !== undefined) return res
        }
        return unmappedResult()
    }

    const stmtObj: Record<string, unknown> = {
        run: (...args: unknown[]) => executeOperation(args),
        get: (...args: unknown[]) => executeOperation(args),
        all: (...args: unknown[]) => executeOperation(args),
        iterate: (...args: unknown[]) => executeOperation(args),
        bind: (...args: unknown[]) => {
            boundArgs = args
            return stmtObj
        },
        columns: () => [],
        raw: () => stmtObj,
        pluck: () => stmtObj,
        expand: () => stmtObj,
        safeIntegers: () => stmtObj,
    }
    return Object.freeze(stmtObj)
}
