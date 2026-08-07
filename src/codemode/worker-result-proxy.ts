/**
 * Worker Result Proxy — wraps API call results with smart proxy behavior.
 *
 * - Failed results throw on property access with actionable error messages
 * - Successful results auto-forward Array methods to nested array properties
 * - Pagination cursor detection injects `hasMore` convenience boolean
 */

/**
 * Wrap an API result with smart proxy behavior for improved DX.
 */
export function wrapResult(result: unknown): unknown {
    if (
        result !== null &&
        result !== undefined &&
        typeof result === 'object'
    ) {
        const isFailed = 'success' in result && (result as Record<string, unknown>)['success'] === false

        if (isFailed) {
            const failedResult = result as Record<string | symbol, unknown>
            return new Proxy(failedResult, {
                ownKeys(target) { return Reflect.ownKeys(target) },
                getOwnPropertyDescriptor(target, prop) { return Reflect.getOwnPropertyDescriptor(target, prop) },
                get(target, prop) {
                    if (prop === 'error' && typeof target['error'] === 'string' && typeof target['code'] === 'string') {
                        return `[${target['code']}] ${target['error']}`
                    }
                    if (prop in target) return target[prop]
                    if (prop === 'length') return 0
                    if (prop === Symbol.iterator) return function* () { yield* [] }
                    if (
                        typeof prop === 'string' &&
                        [
                            'relationships', 'entries', 'results', 'projects', 'items', 'rows', 'tables', 
                            'flags', 'groups', 'users', 'capabilities', 'metrics', 'events', 'records', 
                            'logs', 'aliases', 'tags', 'issues', 'pullRequests', 'milestones', 'columns', 
                            'comments', 'files', 'errors', 'backups', 'deleted', 'updated', 'notFound', 
                            'history', 'members', 'data', 'items'
                        ].includes(prop)
                    ) {
                        return []
                    }
                    if (
                        typeof prop === 'string' &&
                        [
                            'find', 'map', 'filter', 'reduce', 'reduceRight', 'forEach', 'some', 'every', 
                            'flatMap', 'includes', 'indexOf', 'findIndex', 'findLast', 'findLastIndex', 'join', 
                            'at', 'concat', 'flat', 'with', 'slice'
                        ].includes(prop)
                    ) {
                        return (..._args: unknown[]) => []
                    }
                    return undefined
                },
            })
        }

        if (!Array.isArray(result)) {
            const successResult = result as Record<string | symbol, unknown>

            // §2.4: Inject `hasMore` convenience boolean when pagination cursor is present
            if ('next_cursor' in successResult && successResult['next_cursor'] !== null && successResult['next_cursor'] !== undefined && successResult['next_cursor'] !== '') {
                successResult['hasMore'] = true
            } else if (
                ('entries' in successResult || 'results' in successResult || 'items' in successResult) &&
                !('hasMore' in successResult)
            ) {
                successResult['hasMore'] = false
            }

            // §2.5: Heal analytics `statistics` shape hallucination
            if (
                !('statistics' in successResult) &&
                !('stats' in successResult) &&
                ('totalEntries' in successResult || 'entriesByType' in successResult)
            ) {
                successResult['statistics'] = successResult
                successResult['stats'] = successResult
            }
            return new Proxy(successResult, {
                ownKeys(target) { return Reflect.ownKeys(target) },
                getOwnPropertyDescriptor(target, prop) { return Reflect.getOwnPropertyDescriptor(target, prop) },
                get(target, prop, receiver) {
                    if (prop in target) return target[prop]
                    
                    const targetRecord = target as Record<string, unknown>
                    // Helper to safely check and cast arrays
                    const isObject = (val: unknown): val is Record<string, unknown> => typeof val === 'object' && val !== null;
                    const hasNumberId = (val: unknown): val is { id: number } => isObject(val) && typeof val['id'] === 'number';

                    // Hallucination Intercept: Single entry creation returns { success: true, entry: { id: 42 } }.
                    // Allow accessing result.id or result.entryId directly on the success result wrapper.
                    const entryObj = targetRecord['entry']
                    if ((prop === 'id' || prop === 'entryId') && isObject(entryObj) && 'id' in entryObj) {
                        return entryObj['id']
                    }

                    // Hallucination Intercept: Single project retrieval returns { success: true, project: { name: "foo", project_number: 1 } }.
                    // Allow accessing result.project_number, result.name, result.path directly on the success result wrapper.
                    const projObj = targetRecord['project']
                    if (isObject(projObj)) {
                        if (prop === 'project_number' && ('project_number' in projObj || 'id' in projObj)) {
                            return projObj['project_number'] ?? projObj['id']
                        }
                        if ((prop === 'name' || prop === 'project_name') && 'name' in projObj) {
                            return projObj['name']
                        }
                        if (typeof prop === 'string' && prop in projObj) {
                            return projObj[prop]
                        }
                    }

                    // Hallucination Intercept: Agents frequently expect batchCreateEntries to return `entryIds` array
                    // instead of the actual `entries` array. Expose it gracefully as an iterable array of numbers.
                    if (prop === 'entryIds' && 'entries' in targetRecord && Array.isArray(targetRecord['entries'])) {
                        return targetRecord['entries'].filter(hasNumberId).map((e) => e.id)
                    }
                    if (prop === 'entryIds' && 'updated' in targetRecord && Array.isArray(targetRecord['updated'])) {
                        return targetRecord['updated'].filter(hasNumberId).map((e) => e.id)
                    }
                    // Hallucination Intercept: deletedIds vs deleted
                    if (prop === 'deletedIds' && 'deleted' in targetRecord && Array.isArray(targetRecord['deleted'])) {
                        return targetRecord['deleted'] as unknown[]
                    }
                    
                    // Hallucination Intercept: deletedCount vs count
                    if (prop === 'deletedCount' && 'count' in targetRecord && typeof targetRecord['count'] === 'number') {
                        return targetRecord['count']
                    }

                    // Hallucination Intercept: revisions vs history
                    if (prop === 'revisions' && 'history' in targetRecord && Array.isArray(targetRecord['history'])) {
                        return (targetRecord['history'] as Record<string, unknown>[]).map((h) => new Proxy(h, {
                            get(t: Record<string, unknown>, p: string | symbol) {
                                if (p === 'revisionNumber') return t['revisionId'];
                                if (p === 'contentSnapshot') return t['content'];
                                return typeof p === 'string' ? t[p] : undefined;
                            }
                        }))
                    }

                    // Native Iteration fallback: If an agent tries to destructure the result object directly:
                    // `const [id1] = bCreated` or `const [e1] = bCreated`, we can iterate over the primary array
                    if (prop === Symbol.iterator) {
                        const targetRecord = target as Record<string, unknown>
                        const arrayKeys = Object.keys(targetRecord).filter(k => Array.isArray(targetRecord[k]))
                        let targetKey = arrayKeys.find(k => ['entries', 'results', 'projects', 'items', 'issues', 'pullRequests', 'milestones', 'columns', 'comments', 'files', 'errors', 'backups', 'deleted', 'updated', 'notFound', 'history', 'relationships', 'members'].includes(k))
                        if (targetKey === undefined && arrayKeys.length === 1) {
                            targetKey = arrayKeys[0]
                        }
                        if (targetKey !== undefined) {
                            return function* () {
                                yield* (targetRecord[targetKey] as unknown[])
                            }
                        }
                    }

                    // Property aliases for primary array or result object
                    if (prop === 'data' || prop === 'items' || prop === 'entries' || prop === 'results' || prop === 'rows' || prop === 'dataArray') {
                        const targetRecord = target as Record<string, unknown>
                        const arrayKeys = Object.keys(targetRecord).filter(k => Array.isArray(targetRecord[k]))
                        let targetKey = arrayKeys.find(k => ['entries', 'results', 'projects', 'items', 'rows', 'tables', 'flags', 'groups', 'users', 'capabilities', 'metrics', 'events', 'records', 'logs', 'aliases', 'tags', 'issues', 'pullRequests', 'milestones', 'columns', 'comments', 'files', 'errors', 'backups', 'deleted', 'updated', 'notFound', 'history', 'relationships', 'members'].includes(k))
                        if (targetKey === undefined && arrayKeys.length === 1) {
                            targetKey = arrayKeys[0]
                        }
                        if (targetKey !== undefined) {
                            return targetRecord[targetKey]
                        }
                    }

                    if (prop === 'result') {
                        return receiver as unknown
                    }

                    if (prop === 'length') {
                        const targetRecord = target as Record<string, unknown>
                        const arrayKeys = Object.keys(targetRecord).filter(k => Array.isArray(targetRecord[k]))
                        let targetKey = arrayKeys.find(k => ['entries', 'results', 'projects', 'items', 'rows', 'tables', 'flags', 'groups', 'users', 'capabilities', 'metrics', 'events', 'records', 'logs', 'aliases', 'tags', 'issues', 'pullRequests', 'milestones', 'columns', 'comments', 'files', 'errors', 'backups', 'deleted', 'updated', 'notFound', 'history', 'relationships', 'members'].includes(k))
                        if (targetKey === undefined && arrayKeys.length === 1) {
                            targetKey = arrayKeys[0]
                        }
                        if (targetKey !== undefined) {
                            return (targetRecord[targetKey] as unknown[]).length
                        }
                    }

                    if (typeof prop === 'string' && /^\d+$/.test(prop)) {
                        const idx = parseInt(prop, 10)
                        const targetRecord = target as Record<string, unknown>
                        const arrayKeys = Object.keys(targetRecord).filter(k => Array.isArray(targetRecord[k]))
                        let targetKey = arrayKeys.find(k => ['entries', 'results', 'projects', 'items', 'rows', 'tables', 'flags', 'groups', 'users', 'capabilities', 'metrics', 'events', 'records', 'logs', 'aliases', 'tags', 'issues', 'pullRequests', 'milestones', 'columns', 'comments', 'files', 'errors', 'backups', 'deleted', 'updated', 'notFound', 'history', 'relationships', 'members'].includes(k))
                        if (targetKey === undefined && arrayKeys.length === 1) {
                            targetKey = arrayKeys[0]
                        }
                        if (targetKey !== undefined) {
                            return (targetRecord[targetKey] as unknown[])[idx]
                        }
                    }

                    if (
                        typeof prop === 'string' &&
                        [
                            'find', 'map', 'filter', 'reduce', 'reduceRight', 'forEach', 'some', 'every', 
                            'flatMap', 'includes', 'indexOf', 'findIndex', 'findLast', 'findLastIndex', 'join', 
                            'at', 'concat', 'keys', 'values', 'entries', 'flat', 'with', 'slice'
                        ].includes(prop)
                    ) {
                        const targetRecord = target as Record<string, unknown>
                        const arrayKeys = Object.keys(targetRecord).filter(k => Array.isArray(targetRecord[k]))
                        let targetKey = arrayKeys.find(k => ['entries', 'results', 'projects', 'items', 'rows', 'tables', 'flags', 'groups', 'users', 'capabilities', 'metrics', 'events', 'records', 'logs', 'aliases', 'tags', 'issues', 'pullRequests', 'milestones', 'columns', 'comments', 'files', 'errors', 'backups', 'deleted', 'updated', 'notFound', 'history', 'relationships', 'members'].includes(k))
                        if (targetKey === undefined && arrayKeys.length === 1) {
                            targetKey = arrayKeys[0]
                        }

                        if (targetKey !== undefined) {
                            const arr = target[targetKey] as unknown[]
                            const method = (arr as unknown as Record<string, unknown>)[prop]
                            if (typeof method === 'function') {
                                return (...args: unknown[]) => {
                                    const fn = method as (...a: unknown[]) => unknown
                                    return fn.apply(arr, args)
                                }
                            }
                        }

                        const keys = Object.keys(target).join(', ') || 'none'
                        throw new TypeError(
                            `🛠️ AUTONOMOUS HEALING: CodeMode Non-Array Proxy Error: Attempted to call Array method '${prop}' on an Object. The returned result is not an Array, and no array properties could be automatically resolved. Check the available keys and access the correct array property. Keys available: ${keys}`
                        )
                    }

                    if (
                        typeof prop === 'string' &&
                        ['push', 'pop', 'shift', 'unshift', 'splice', 'sort', 'reverse', 'copyWithin', 'fill'].includes(prop)
                    ) {
                        throw new Error(
                            `🛠️ AUTONOMOUS HEALING: [VALIDATION_ERROR] CodeMode Proxy Error: Array mutator method '${prop}' is not allowed on API results. Modifying local arrays does not update the server state. You MUST use the appropriate API tool (e.g., mj.core.updateEntry, mj.admin.batchUpdateEntries) to persist changes.`
                        )
                    }
                    return undefined
                },
            })
        }
    }
    return result
}
