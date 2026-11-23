/**
 * Worker Result Proxy Alias & Stats Resolvers — extracted from worker-result-proxy.ts
 * to keep file line counts comfortably under budget. Pure TypeScript, zero npm imports.
 */

const TOTAL_COLLECTION_KEYS: ReadonlySet<string> = new Set([
    'entries',
    'results',
    'projects',
    'items',
    'rows',
    'records',
    'commits',
])

const isObject = (val: unknown): val is Record<string, unknown> =>
    typeof val === 'object' && val !== null && !Array.isArray(val)

const hasNumberId = (val: unknown): val is { id: number } =>
    isObject(val) && typeof val['id'] === 'number'

/**
 * Mutation-blocking proxy traps without `isExtensible`/`preventExtensions`/`defineProperty` overrides,
 * safe when `target` is already `Object.freeze()`d and callers invoke `Object.freeze(proxy)`
 * (which re-checks existing descriptors via `[[DefineOwnProperty]]`).
 */
export const READONLY_MUTATION_TRAPS = {
    set: (): boolean => false,
    deleteProperty: (): boolean => false,
    setPrototypeOf: (): boolean => false,
} as const

/**
 * Shared immutable proxy traps blocking extensibility changes, property mutations, and prototype changes
 * for extensible proxy targets.
 */
export const IMMUTABLE_PROXY_TRAPS = {
    isExtensible: (): boolean => true,
    preventExtensions: (): boolean => false,
    defineProperty: (): boolean => false,
    ...READONLY_MUTATION_TRAPS,
} as const

export type AliasMatch = { matched: true; value: unknown } | { matched: false }

export function resolvePaginationAndStatsProp(
    targetRecord: Record<string, unknown>,
    prop: string | symbol,
    receiver: unknown,
    findPrimaryArrayKey: (record: Record<string, unknown>, keys?: ReadonlySet<string>) => string | undefined
): AliasMatch {
    if (prop === 'hasMore') {
        if (
            'next_cursor' in targetRecord &&
            targetRecord['next_cursor'] !== null &&
            targetRecord['next_cursor'] !== undefined &&
            targetRecord['next_cursor'] !== ''
        ) {
            return { matched: true, value: true }
        }
        if ('entries' in targetRecord || 'results' in targetRecord || 'items' in targetRecord) {
            return { matched: true, value: false }
        }
    }
    if (
        (prop === 'statistics' || prop === 'stats') &&
        !('statistics' in targetRecord) &&
        !('stats' in targetRecord) &&
        ('totalEntries' in targetRecord || 'entriesByType' in targetRecord)
    ) {
        return { matched: true, value: receiver }
    }
    if (
        prop === 'total' ||
        prop === 'totalCount' ||
        prop === 'total_entries' ||
        prop === 'totalEntries'
    ) {
        if ('count' in targetRecord && typeof targetRecord['count'] === 'number') {
            return { matched: true, value: targetRecord['count'] }
        }
        if ('totalEntries' in targetRecord && typeof targetRecord['totalEntries'] === 'number') {
            return { matched: true, value: targetRecord['totalEntries'] }
        }
        if ('total' in targetRecord && typeof targetRecord['total'] === 'number') {
            return { matched: true, value: targetRecord['total'] }
        }
        const targetKey = findPrimaryArrayKey(targetRecord, TOTAL_COLLECTION_KEYS)
        if (targetKey !== undefined && Array.isArray(targetRecord[targetKey])) {
            return { matched: true, value: targetRecord[targetKey].length }
        }
        const changelogObj = targetRecord['changelog']
        if (isObject(changelogObj) && Array.isArray(changelogObj['commits'])) {
            return { matched: true, value: changelogObj['commits'].length }
        }
    }
    return { matched: false }
}

function resolveProjectAliasProp(targetRecord: Record<string, unknown>, prop: string | symbol): AliasMatch {
    const projObj = targetRecord['project']
    if (!isObject(projObj)) return { matched: false }
    if (prop === 'project_number' && ('project_number' in projObj || 'id' in projObj)) {
        return { matched: true, value: projObj['project_number'] ?? projObj['id'] }
    }
    if ((prop === 'name' || prop === 'project_name') && 'name' in projObj) {
        return { matched: true, value: projObj['name'] }
    }
    if (typeof prop === 'string' && prop in projObj) {
        return { matched: true, value: projObj[prop] }
    }
    return { matched: false }
}

function resolveEntryAndChangelogAliasProp(
    targetRecord: Record<string, unknown>,
    prop: string | symbol,
    wrapResultFn: (val: unknown) => unknown
): AliasMatch {
    const entryObj = targetRecord['entry']
    if (isObject(entryObj)) {
        if ((prop === 'id' || prop === 'entryId') && 'id' in entryObj) {
            return { matched: true, value: entryObj['id'] }
        }
        if (prop === 'created_at' && 'timestamp' in entryObj) {
            return { matched: true, value: entryObj['timestamp'] }
        }
        if (typeof prop === 'string' && prop in entryObj) {
            const val = entryObj[prop]
            return {
                matched: true,
                value: val !== null && typeof val === 'object' ? wrapResultFn(val) : val,
            }
        }
    }

    const projMatch = resolveProjectAliasProp(targetRecord, prop)
    if (projMatch.matched) return projMatch

    const changelogObj = targetRecord['changelog']
    if (isObject(changelogObj)) {
        if (prop === 'tag' || prop === 'baseRef' || prop === 'latest_tag') {
            return { matched: true, value: changelogObj['latestTag'] }
        }
        if ((prop === 'count' || prop === 'unreleasedCount') && Array.isArray(changelogObj['commits'])) {
            return { matched: true, value: changelogObj['commits'].length }
        }
        if (typeof prop === 'string' && prop in changelogObj) {
            const val = changelogObj[prop]
            return {
                matched: true,
                value: val !== null && typeof val === 'object' ? wrapResultFn(val) : val,
            }
        }
    }
    return { matched: false }
}

function resolveCollectionAndGraphAliasProp(
    targetRecord: Record<string, unknown>,
    prop: string | symbol,
    wrapResultFn: (val: unknown) => unknown
): AliasMatch {
    if (prop === 'entryIds' && 'entries' in targetRecord && Array.isArray(targetRecord['entries'])) {
        return { matched: true, value: wrapResultFn(targetRecord['entries'].filter(hasNumberId).map((e) => e.id)) }
    }
    if (prop === 'entryIds' && 'updated' in targetRecord && Array.isArray(targetRecord['updated'])) {
        return { matched: true, value: wrapResultFn(targetRecord['updated'].filter(hasNumberId).map((e) => e.id)) }
    }
    if (prop === 'deletedIds' && 'deleted' in targetRecord && Array.isArray(targetRecord['deleted'])) {
        return { matched: true, value: wrapResultFn(targetRecord['deleted']) }
    }
    if (prop === 'deletedCount' && 'count' in targetRecord && typeof targetRecord['count'] === 'number') {
        return { matched: true, value: targetRecord['count'] }
    }
    if (prop === 'revisions' && 'history' in targetRecord && Array.isArray(targetRecord['history'])) {
        const revisions = targetRecord['history'].filter(isObject).map(
            (h) =>
                new Proxy(!Object.isExtensible(h) ? { ...h } : h, {
                    ...IMMUTABLE_PROXY_TRAPS,
                    get(t: Record<string, unknown>, p: string | symbol): unknown {
                        if (p === 'revisionNumber') return t['revisionId']
                        if (p === 'contentSnapshot') return t['content']
                        return Reflect.get(t, p) as unknown
                    },
                })
        )
        return { matched: true, value: wrapResultFn(revisions) }
    }
    if (prop === 'relationships' && 'edges' in targetRecord && Array.isArray(targetRecord['edges'])) {
        const relationships = targetRecord['edges'].filter(isObject).map((edge) => ({
            fromEntryId: edge['from'],
            toEntryId: edge['to'],
            sourceId: edge['from'],
            targetId: edge['to'],
            relationshipType: edge['type'],
            relationType: edge['type'],
            from: edge['from'],
            to: edge['to'],
            type: edge['type'],
        }))
        return { matched: true, value: wrapResultFn(relationships) }
    }
    return { matched: false }
}

export function resolveWrappedAliasProp(
    targetRecord: Record<string, unknown>,
    prop: string | symbol,
    wrapResultFn: (val: unknown) => unknown
): AliasMatch {
    const entryOrChangelog = resolveEntryAndChangelogAliasProp(targetRecord, prop, wrapResultFn)
    if (entryOrChangelog.matched) return entryOrChangelog
    return resolveCollectionAndGraphAliasProp(targetRecord, prop, wrapResultFn)
}

/** Deep-clone and freeze plain objects/arrays with cycle memoization so context bags cannot mutate across calls. */
export function deepFreezeContextClone(value: unknown, seen = new WeakMap<object, unknown>()): unknown {
    if (value === null || typeof value !== 'object') return value
    if (seen.has(value)) return seen.get(value)
    if (Array.isArray(value)) {
        const clone: unknown[] = []
        seen.set(value, clone)
        for (const item of value) clone.push(deepFreezeContextClone(item, seen))
        return Object.freeze(clone)
    }
    const clone = Object.create(null) as Record<string, unknown>
    seen.set(value, clone)
    for (const k of Object.keys(value)) {
        clone[k] = deepFreezeContextClone(Reflect.get(value, k), seen)
    }
    return Object.freeze(clone)
}
