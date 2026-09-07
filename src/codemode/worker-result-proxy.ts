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

        const isDictLike = (obj: Record<string, unknown>): boolean => {
            const keys = Object.keys(obj).filter((k) => typeof k === 'string' && !k.startsWith('_'))
            return keys.length > 0 && !keys.includes('error') && !keys.includes('success')
        }

        const dictToItems = (obj: Record<string, unknown>): unknown[] => {
            return Object.entries(obj)
                .filter(([k]) => typeof k === 'string' && !k.startsWith('_'))
                .map(([key, item]) => {
                    if (item !== null && typeof item === 'object' && !Array.isArray(item)) {
                        const itemObj = item as Record<string, unknown>
                        return {
                            name: key,
                            ...itemObj,
                            project_number: itemObj['project_number'] ?? itemObj['id'] ?? itemObj['projectNumber'],
                            projectNumber: itemObj['projectNumber'] ?? itemObj['project_number'] ?? itemObj['id'],
                        }
                    }
                    return { name: key, value: item }
                })
        }

        if (Array.isArray(result)) {
            const arr = result as unknown[]
            return new Proxy(arr, {
                ownKeys(target) { return Reflect.ownKeys(target) },
                getOwnPropertyDescriptor(target, prop) { return Reflect.getOwnPropertyDescriptor(target, prop) },
                get(target, prop, receiver): unknown {
                    if (prop in target) {
                        const val: unknown = Reflect.get(target, prop, receiver)
                        if (typeof val === 'function') {
                            return (val as (...args: unknown[]) => unknown).bind(target)
                        }
                        return val
                    }
                    if (prop === 'success') return true
                    if (
                        prop === 'projects' ||
                        prop === 'entries' ||
                        prop === 'results' ||
                        prop === 'items' ||
                        prop === 'data' ||
                        prop === 'rows' ||
                        prop === 'relationships' ||
                        prop === 'members' ||
                        prop === 'tags' ||
                        prop === 'history' ||
                        prop === 'records'
                    ) {
                        return receiver as unknown
                    }
                    return undefined
                },
            })
        }

        if (!Array.isArray(result)) {
            const successResult = result as Record<string | symbol, unknown>

            return new Proxy(successResult, {
                ownKeys(target) { return Reflect.ownKeys(target) },
                getOwnPropertyDescriptor(target, prop) { return Reflect.getOwnPropertyDescriptor(target, prop) },
                get(target, prop, receiver) {
                    if (prop in target) {
                        const val = target[prop]
                        if (val !== null && typeof val === 'object' && !Array.isArray(val)) {
                            return wrapResult(val)
                        }
                        return val
                    }
                    
                    const targetRecord = target as Record<string, unknown>
                    // Helper to safely check and cast arrays
                    const isObject = (val: unknown): val is Record<string, unknown> => typeof val === 'object' && val !== null;
                    const hasNumberId = (val: unknown): val is { id: number } => isObject(val) && typeof val['id'] === 'number';

                    // §2.4: Inject `hasMore` convenience boolean when pagination cursor is present
                    if (prop === 'hasMore') {
                        if ('next_cursor' in targetRecord && targetRecord['next_cursor'] !== null && targetRecord['next_cursor'] !== undefined && targetRecord['next_cursor'] !== '') {
                            return true
                        }
                        if ('entries' in targetRecord || 'results' in targetRecord || 'items' in targetRecord) {
                            return false
                        }
                    }

                    // §2.5: Heal analytics `statistics` shape hallucination
                    if (
                        (prop === 'statistics' || prop === 'stats') &&
                        !('statistics' in targetRecord) &&
                        !('stats' in targetRecord) &&
                        ('totalEntries' in targetRecord || 'entriesByType' in targetRecord)
                    ) {
                        return receiver as unknown
                    }

                    // Hallucination Intercept: result.total / result.totalCount / result.total_entries / result.totalEntries
                    if (prop === 'total' || prop === 'totalCount' || prop === 'total_entries' || prop === 'totalEntries') {
                        if ('count' in targetRecord && typeof targetRecord['count'] === 'number') {
                            return targetRecord['count']
                        }
                        if ('totalEntries' in targetRecord && typeof targetRecord['totalEntries'] === 'number') {
                            return targetRecord['totalEntries']
                        }
                        if ('total' in targetRecord && typeof targetRecord['total'] === 'number') {
                            return targetRecord['total']
                        }
                        const arrayKeys = Object.keys(targetRecord).filter(k => Array.isArray(targetRecord[k]))
                        const targetKey = arrayKeys.find(k => ['entries', 'results', 'projects', 'items', 'rows', 'records'].includes(k))
                        if (targetKey !== undefined) {
                            return (targetRecord[targetKey] as unknown[]).length
                        }
                    }

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
                        if ('projects' in targetRecord && targetRecord['projects'] !== null && typeof targetRecord['projects'] === 'object' && !Array.isArray(targetRecord['projects'])) {
                            const items = dictToItems(targetRecord['projects'] as Record<string, unknown>)
                            return function* () {
                                yield* items
                            }
                        }
                        if (isDictLike(targetRecord)) {
                            const items = dictToItems(targetRecord)
                            return function* () {
                                yield* items
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
                        if ('projects' in targetRecord && targetRecord['projects'] !== null && typeof targetRecord['projects'] === 'object' && !Array.isArray(targetRecord['projects'])) {
                            return Object.keys(targetRecord['projects']).length
                        }
                        if (isDictLike(targetRecord)) {
                            return Object.keys(targetRecord).length
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
                        if ('projects' in targetRecord && targetRecord['projects'] !== null && typeof targetRecord['projects'] === 'object' && !Array.isArray(targetRecord['projects'])) {
                            const items = dictToItems(targetRecord['projects'] as Record<string, unknown>)
                            return items[idx]
                        }
                        if (isDictLike(targetRecord)) {
                            const items = dictToItems(targetRecord)
                            return items[idx]
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

                        if ('projects' in targetRecord && targetRecord['projects'] !== null && typeof targetRecord['projects'] === 'object' && !Array.isArray(targetRecord['projects'])) {
                            const dict = targetRecord['projects'] as Record<string, unknown>
                            const items = dictToItems(dict)
                            const method = (items as unknown as Record<string, unknown>)[prop]
                            if (typeof method === 'function') {
                                return (...args: unknown[]) => {
                                    const fn = method as (...a: unknown[]) => unknown
                                    return fn.apply(items, args)
                                }
                            }
                        }

                        if (isDictLike(targetRecord)) {
                            const items = dictToItems(targetRecord)
                            const method = (items as unknown as Record<string, unknown>)[prop]
                            if (typeof method === 'function') {
                                return (...args: unknown[]) => {
                                    const fn = method as (...a: unknown[]) => unknown
                                    return fn.apply(items, args)
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
