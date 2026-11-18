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
])

const isObject = (val: unknown): val is Record<string, unknown> =>
    typeof val === 'object' && val !== null && !Array.isArray(val)

const hasNumberId = (val: unknown): val is { id: number } =>
    isObject(val) && typeof val['id'] === 'number'

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

export function resolveWrappedAliasProp(
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
                value: val !== null && typeof val === 'object' && !Array.isArray(val) ? wrapResultFn(val) : val,
            }
        }
    }

    const projMatch = resolveProjectAliasProp(targetRecord, prop)
    if (projMatch.matched) return projMatch

    if (prop === 'entryIds' && 'entries' in targetRecord && Array.isArray(targetRecord['entries'])) {
        return { matched: true, value: targetRecord['entries'].filter(hasNumberId).map((e) => e.id) }
    }
    if (prop === 'entryIds' && 'updated' in targetRecord && Array.isArray(targetRecord['updated'])) {
        return { matched: true, value: targetRecord['updated'].filter(hasNumberId).map((e) => e.id) }
    }
    if (prop === 'deletedIds' && 'deleted' in targetRecord && Array.isArray(targetRecord['deleted'])) {
        return { matched: true, value: targetRecord['deleted'] }
    }
    if (prop === 'deletedCount' && 'count' in targetRecord && typeof targetRecord['count'] === 'number') {
        return { matched: true, value: targetRecord['count'] }
    }
    if (prop === 'revisions' && 'history' in targetRecord && Array.isArray(targetRecord['history'])) {
        const revisions = targetRecord['history'].filter(isObject).map(
            (h) =>
                new Proxy(h, {
                    get(t: Record<string, unknown>, p: string | symbol): unknown {
                        if (p === 'revisionNumber') return t['revisionId']
                        if (p === 'contentSnapshot') return t['content']
                        return typeof p === 'string' ? t[p] : undefined
                    },
                })
        )
        return { matched: true, value: revisions }
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
        return { matched: true, value: relationships }
    }
    return { matched: false }
}
