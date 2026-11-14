import { POSITIONAL_PARAM_MAP } from '../constants/examples-and-params.js'
import { normalizeEntrySortByValue, healAnchorsField } from '../../handlers/tools/schemas/hallucination-healer-fields.js'
import { isRecord } from './shared-utils.js'
import {
    cleanSdkMetadataKeys,
    coerceNumericStringIds,
    extractMetadataContextAliases,
    normalizeExecuteCodeAliases,
    normalizeGenericFieldAliases,
    normalizeSearchGrepAliases,
    resolveCreateEntryProjectContext,
    synthesizeEntryMutationFields,
} from './generic-field-aliases.js'
import { DUMMY_SQL_EXECUTION_TOOL_NAMES } from '../../handlers/tools/core/dummy-healing/alias-catalog.js'

const EXECUTE_METHODS = new Set([
    'execute', 'execute_code', 'executeCode', 'mj_execute_code', 'mjExecuteCode', 'mysql_execute_code', 'mysqlExecuteCode',
    ...DUMMY_SQL_EXECUTION_TOOL_NAMES,
])
const AUDIT_LOG_METHODS = new Set(['search_audit_log', 'searchAuditLog'])
const GIT_METHODS = new Set([
    'get_commit_history', 'getCommitHistory', 'search_commits', 'searchCommits',
    'get_release_info', 'getReleaseInfo', 'get_unreleased_commits', 'getUnreleasedCommits',
    'analyze_commit_patterns', 'analyzeCommitPatterns', 'check_entry_staleness', 'checkEntryStaleness',
])

const CREATE_ENTRY_METHODS = new Set([
    'create_entry', 'createEntry', 'create_entry_minimal', 'createEntryMinimal', 'team_create_entry', 'teamCreateEntry',
])
const BATCH_CREATE_ENTRY_METHODS = new Set([
    'batch_create_entries', 'batchCreateEntries', 'team_batch_create_entries', 'teamBatchCreateEntries',
])

const WORKSPACE_POSITIONAL_KEYS = new Set(['workspace_id', 'workspaceId'])

function toCamelMethod(methodName: string): string {
    return methodName.replace(/_([a-z])/g, (_match, letter: string) => letter.toUpperCase())
}

function firstPositionalKey(methodName: string): string | undefined {
    const mapped = POSITIONAL_PARAM_MAP[methodName] ?? POSITIONAL_PARAM_MAP[toCamelMethod(methodName)]
    if (typeof mapped === 'string') return mapped
    if (Array.isArray(mapped)) return mapped[0]
    return undefined
}

/**
 * Merge `(positional, options)`.
 * A leading string becomes workspace_id only when the method does not document
 * a different first argument (searchEntries keeps `query`, getRecentEntries keeps `limit`).
 */
function mergePositionalStringAndOptions(methodName: string, args: unknown[]): unknown[] {
    if (args.length !== 2 || typeof args[0] !== 'string' || !isRecord(args[1])) return args
    const firstKey = firstPositionalKey(methodName)
    const firstStr = args[0].trim()
    const mergedObj: Record<string, unknown> = { ...args[1] }
    if (firstKey !== undefined && !WORKSPACE_POSITIONAL_KEYS.has(firstKey)) {
        if (mergedObj[firstKey] === undefined) mergedObj[firstKey] = firstStr
        return [mergedObj]
    }
    if (mergedObj['workspace_id'] === undefined && mergedObj['workspaceId'] === undefined) {
        mergedObj['workspace_id'] = firstStr
    } else if (mergedObj['title'] === undefined && mergedObj['content'] === undefined) {
        mergedObj['title'] = firstStr
    }
    return [mergedObj]
}

export function applyGenericInterceptions(
    methodName: string,
    args: unknown[]
): { args: unknown[] } | { error: Record<string, unknown> } {
    if (EXECUTE_METHODS.has(methodName) && args.length === 1 && typeof args[0] === 'string') {
        args = [{ code: args[0] }]
    }
    if (CREATE_ENTRY_METHODS.has(methodName) && args.length === 1 && typeof args[0] === 'string') {
        args = [{ content: args[0] }]
    }

    args = mergePositionalStringAndOptions(methodName, args)

    if (args.length !== 1 || !isRecord(args[0])) return { args }
    const obj = { ...args[0] }
    args[0] = obj

    cleanSdkMetadataKeys(obj)
    normalizeSearchGrepAliases(methodName, obj)
    extractMetadataContextAliases(obj)
    const idError = coerceNumericStringIds(obj)
    if (idError !== undefined) return idError
    const aliasError = normalizeGenericFieldAliases(obj, methodName)
    if (aliasError !== undefined) return aliasError

    if (CREATE_ENTRY_METHODS.has(methodName)) {
        resolveCreateEntryProjectContext(obj)
        healAnchorsField(obj)
    } else if (BATCH_CREATE_ENTRY_METHODS.has(methodName)) {
        resolveCreateEntryProjectContext(obj)
        if (Array.isArray(obj['entries'])) {
            const topWs = obj['workspace_id'] ?? obj['workspaceId']
            const topProj = obj['project_number'] ?? obj['projectNumber']
            let batchError: { error: Record<string, unknown> } | undefined
            obj['entries'] = obj['entries'].map((rawItem: unknown) => {
                if (batchError !== undefined || !isRecord(rawItem)) return rawItem
                const item: Record<string, unknown> = { ...rawItem }
                extractMetadataContextAliases(item)
                const itemError = coerceNumericStringIds(item)
                if (itemError !== undefined) {
                    batchError = itemError
                    return rawItem
                }
                const itemAliasError = normalizeGenericFieldAliases(item, 'create_entry')
                if (itemAliasError !== undefined) {
                    batchError = itemAliasError
                    return rawItem
                }
                const rawItemWs = item['workspace_id'] ?? item['workspaceId']
                const itemWs = typeof rawItemWs === 'string' ? rawItemWs.trim() : undefined
                const itemHasExplicitProj =
                    item['project_number'] !== undefined ||
                    item['projectNumber'] !== undefined ||
                    item['project_id'] !== undefined ||
                    item['projectId'] !== undefined
                const itemIsDefaultWs = itemWs?.toLowerCase() === 'default'
                const topIsDefaultWs = typeof topWs === 'string' && topWs.trim().toLowerCase() === 'default'
                const itemNamesSameOrNoWs =
                    itemWs === undefined ||
                    itemWs === '' ||
                    (typeof topWs === 'string' &&
                        itemWs.toLowerCase() === topWs.trim().toLowerCase())
                if ((itemWs === undefined || itemWs === '') && !itemHasExplicitProj && topWs !== undefined) {
                    item['workspace_id'] = topWs
                }
                if (
                    !itemHasExplicitProj &&
                    topProj !== undefined &&
                    !itemIsDefaultWs &&
                    !(topIsDefaultWs && (itemWs === undefined || itemWs === '')) &&
                    itemNamesSameOrNoWs
                ) {
                    item['project_number'] = topProj
                }
                resolveCreateEntryProjectContext(item)
                synthesizeEntryMutationFields(item)
                healAnchorsField(item)
                return item
            })
            if (batchError !== undefined) return batchError
        }
    }

    if (typeof obj['sort_by'] === 'string') {
        const lowerSort = obj['sort_by'].toLowerCase()
        if (lowerSort.endsWith('_asc')) {
            obj['sort_by'] = obj['sort_by'].replace(/_asc$/i, '')
            obj['sort_order'] ??= 'asc'
        } else if (lowerSort.endsWith('_desc')) {
            obj['sort_by'] = obj['sort_by'].replace(/_desc$/i, '')
            obj['sort_order'] ??= 'desc'
        }
        if (!GIT_METHODS.has(methodName)) {
            const mappedSort = normalizeEntrySortByValue(obj['sort_by'])
            if (mappedSort !== undefined) obj['sort_by'] = mappedSort
        }
    }

    if (EXECUTE_METHODS.has(methodName)) {
        normalizeExecuteCodeAliases(obj)
    } else if (GIT_METHODS.has(methodName)) {
        if (obj['repo_name'] !== undefined && obj['repo'] === undefined) {
            obj['repo'] = obj['repo_name']
            delete obj['repo_name']
        }
    } else if (obj['repo'] !== undefined && obj['repo_name'] === undefined) {
        obj['repo_name'] = obj['repo']
        delete obj['repo']
    }

    for (const [src, dst] of [['item_type', 'type'], ['category', 'type'], ['metadata', 'context']] as const) {
        if (src === 'category' && AUDIT_LOG_METHODS.has(methodName)) continue
        if (obj[src] !== undefined && obj[dst] === undefined) {
            obj[dst] = obj[src]
            Reflect.deleteProperty(obj, src)
        }
    }

    if (CREATE_ENTRY_METHODS.has(methodName) || methodName === 'update_entry' || methodName === 'updateEntry') {
        synthesizeEntryMutationFields(obj)
    }

    if (obj['search'] !== undefined && obj['query'] === undefined) {
        obj['query'] = obj['search']
        delete obj['search']
    }
    if (
        ['import_external', 'importExternal', 'team_import_external', 'teamImportExternal'].includes(methodName) &&
        obj['source_dir'] === undefined &&
        obj['filename'] !== undefined
    ) {
        obj['source_dir'] = obj['filename']
        delete obj['filename']
    }

    return { args }
}
