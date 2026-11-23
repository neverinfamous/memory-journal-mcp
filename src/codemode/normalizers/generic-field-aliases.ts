import { hasMethodToken } from '../method-tokens.js'
import { parseCanonicalPositiveInt } from '../../utils/safe-positive-int.js'
import { isRecord } from './shared-utils.js'
import {
    PROJECT_REGISTRY_METHOD_NAMES,
    aliasValidationError,
    applyProjectNameAlias,
    normalizeProjectAliases,
} from './project-alias-helpers.js'

export {
    getActiveProjectRegistry,
    readProjectRegistryPayload,
    resolveCreateEntryProjectContext,
    resolveEffectiveProjectRegistry,
    setActiveProjectRegistry,
    setFallbackProjectRegistryLoader,
    setScopedProjectRegistryReader,
} from './project-alias-helpers.js'

const NUMERIC_ID_KEYS = [
    'entry_id', 'entryId', 'id', 'from_entry_id', 'fromEntryId', 'to_entry_id', 'toEntryId',
    'project_number', 'projectNumber', 'issue_number', 'issueNumber', 'pr_number', 'prNumber',
    'milestone_number', 'milestoneNumber', 'offset', 'limit',
]

export function cleanSdkMetadataKeys(obj: Record<string, unknown>): void {
    for (const k of ['_u_r_i', '_uri']) {
        if (obj[k] !== undefined) {
            if (obj['uri'] === undefined && obj['Uri'] === undefined) obj['uri'] = obj[k]
            Reflect.deleteProperty(obj, k)
        }
    }
    if (obj['_url'] !== undefined) {
        if (obj['url'] === undefined && obj['Url'] === undefined) obj['url'] = obj['_url']
        delete obj['_url']
    }
    delete obj['_server_name']
    delete obj['_tool_name']
    delete obj['_meta']
    Reflect.deleteProperty(obj, '_alias_derived_workspace')
    for (const key of Object.keys(obj)) {
        if (key.startsWith('_') && key !== '_journal') {
            const strippedKey = key.replace(/^_+/, '')
            if (strippedKey.length > 0 && obj[strippedKey] === undefined) obj[strippedKey] = obj[key]
            Reflect.deleteProperty(obj, key)
        }
    }
}

const FILE_GREP_SEARCH_METHODS = new Set([
    'grep_search', 'grepSearch', 'grep', 'file_search', 'fileSearch', 'find_in_files', 'findInFiles', 'search_files', 'searchFiles',
])
const NON_QUERY_SEARCH_METHODS = new Set([
    'search_by_date_range', 'searchByDateRange', 'team_search_by_date_range', 'teamSearchByDateRange', 'search_audit_log', 'searchAuditLog',
])

export function normalizeSearchGrepAliases(methodName: string, obj: Record<string, unknown>): void {
    const isSearchOrGrepOrFind =
        hasMethodToken(methodName, 'search') ||
        hasMethodToken(methodName, 'grep') ||
        hasMethodToken(methodName, 'find')
    if (!isSearchOrGrepOrFind) return

    if (obj['query'] === undefined && !NON_QUERY_SEARCH_METHODS.has(methodName)) {
        const q = obj['Query'] ?? obj['pattern'] ?? obj['text'] ?? obj['search'] ?? obj['q']
        if (typeof q === 'string') obj['query'] = q
    }

    if (!FILE_GREP_SEARCH_METHODS.has(methodName)) return

    if (obj['search_path'] === undefined) {
        const p = obj['searchPath'] ?? obj['SearchPath'] ?? obj['path'] ?? obj['Path'] ?? obj['dir'] ?? obj['directory'] ?? obj['cwd']
        if (typeof p === 'string') obj['search_path'] = p
    }
    if (obj['file_pattern'] === undefined) {
        const fp = obj['filePattern'] ?? obj['FilePattern'] ?? obj['include']
        if (typeof fp === 'string') obj['file_pattern'] = fp
    }
    if (obj['case_insensitive'] === undefined) {
        const ci = obj['caseInsensitive'] ?? obj['CaseInsensitive'] ?? obj['ignore_case'] ?? obj['ignoreCase']
        if (typeof ci === 'boolean') obj['case_insensitive'] = ci
    }
    if (obj['is_regex'] === undefined) {
        const ir = obj['isRegex'] ?? obj['IsRegex'] ?? obj['regex']
        if (typeof ir === 'boolean') obj['is_regex'] = ir
    }
    if (obj['match_per_line'] === undefined) {
        const mpl = obj['matchPerLine'] ?? obj['MatchPerLine']
        if (typeof mpl === 'boolean') obj['match_per_line'] = mpl
    }
}

function firstDefined(record: Record<string, unknown> | undefined, keys: readonly string[]): unknown {
    if (record === undefined) return undefined
    for (const key of keys) {
        if (record[key] !== undefined) return record[key]
    }
    return undefined
}

export function extractMetadataContextAliases(
    obj: Record<string, unknown>,
    allowWorkspaceHoist = true
): void {
    const metadata = isRecord(obj['metadata']) ? obj['metadata'] : undefined
    const context = isRecord(obj['context']) ? obj['context'] : undefined
    if (metadata === undefined && context === undefined) return
    const hasTopProjectAlias =
        obj['project'] !== undefined || obj['project_name'] !== undefined || obj['projectName'] !== undefined
    if (
        obj['project_number'] === undefined &&
        obj['projectNumber'] === undefined &&
        obj['project_id'] === undefined &&
        obj['projectId'] === undefined &&
        !hasTopProjectAlias
    ) {
        const hoistedProj =
            firstDefined(metadata, ['project_number', 'projectNumber']) ??
            firstDefined(context, ['project_number', 'projectNumber'])
        if (hoistedProj !== undefined) obj['project_number'] = hoistedProj
    }
    if (obj['session_id'] === undefined && obj['sessionId'] === undefined) {
        const hoistedSess =
            firstDefined(metadata, ['session_id', 'sessionId']) ??
            firstDefined(context, ['session_id', 'sessionId'])
        if (hoistedSess !== undefined) obj['session_id'] = hoistedSess
    }
    if (
        obj['type'] === undefined &&
        obj['entry_type'] === undefined &&
        obj['entryType'] === undefined &&
        obj['category'] === undefined
    ) {
        const hoistedType =
            firstDefined(metadata, ['type', 'entry_type', 'category']) ??
            firstDefined(context, ['type', 'entry_type', 'category'])
        if (hoistedType !== undefined) obj['type'] = hoistedType
    }
    if (obj['tags'] === undefined) {
        const hoistedTags = firstDefined(metadata, ['tags']) ?? firstDefined(context, ['tags'])
        if (hoistedTags !== undefined) obj['tags'] = hoistedTags
    }
    const hasTopWorkspaceAlias =
        obj['workspace_id'] !== undefined ||
        obj['workspaceId'] !== undefined ||
        obj['workspace'] !== undefined ||
        hasTopProjectAlias
    if (allowWorkspaceHoist && !hasTopWorkspaceAlias) {
        const hoistedWs =
            firstDefined(metadata, ['workspace_id', 'workspaceId']) ??
            firstDefined(context, ['workspace_id', 'workspaceId'])
        if (hoistedWs !== undefined) {
            obj['workspace_id'] = hoistedWs
            obj['_alias_derived_workspace'] = true
        }
    }
}

function coerceNonProjectNumericField(
    obj: Record<string, unknown>,
    key: string,
    strVal: string
): void {
    if (!/^(?:0|[1-9]\d*)$/.test(strVal)) return
    const parsed = Number(strVal)
    if (
        Number.isSafeInteger(parsed) &&
        String(parsed) === strVal &&
        (key === 'offset' || parsed > 0)
    ) {
        obj[key] = parsed
    }
}

export const READ_ONLY_PROJECT_FILTER_METHODS = new Set([
    'get_recent_entries',
    'getRecentEntries',
    'search_entries',
    'searchEntries',
    'search_by_date_range',
    'searchByDateRange',
    'semantic_search',
    'semanticSearch',
    'hybrid_search',
    'hybridSearch',
    'get_statistics',
    'getStatistics',
    'list_deleted_entries',
    'listDeletedEntries',
    'get_audit_log',
    'getAuditLog',
    'search_audit_log',
    'searchAuditLog',
    'get_cross_project_insights',
    'getCrossProjectInsights',
    'team_get_recent',
    'teamGetRecent',
    'team_search',
    'teamSearch',
    'team_search_by_date_range',
    'teamSearchByDateRange',
    'team_semantic_search',
    'teamSemanticSearch',
    'team_list_deleted_entries',
    'teamListDeletedEntries',
    'cross_team_search',
    'crossTeamSearch',
    'team_get_statistics',
    'teamGetStatistics',
    'team_get_cross_project_insights',
    'teamGetCrossProjectInsights',
    'team_get_collaboration_matrix',
    'teamGetCollaborationMatrix',
])

export function coerceNumericStringIds(
    obj: Record<string, unknown>,
    methodName?: string
): { error: Record<string, unknown> } | undefined {
    for (const key of NUMERIC_ID_KEYS) {
        const val = obj[key]
        if (typeof val !== 'string') continue
        const strVal = val.trim()
        if (strVal === '') continue
        if (key === 'project_number' || key === 'projectNumber') {
            if (
                strVal === '0' &&
                methodName !== undefined &&
                READ_ONLY_PROJECT_FILTER_METHODS.has(methodName)
            ) {
                obj[key] = 0
                continue
            }
            const canonical = parseCanonicalPositiveInt(strVal)
            if (canonical !== undefined) {
                obj[key] = canonical
                continue
            }
        }
        if (/^-?\d+$/.test(strVal)) {
            if (key === 'project_number' || key === 'projectNumber') {
                return aliasValidationError(
                    `project_number '${strVal}' is not a canonical positive integer`,
                )
            }
            coerceNonProjectNumericField(obj, key, strVal)
        } else if ((key === 'project_number' || key === 'projectNumber') && /^p-?\d+$/i.test(strVal)) {
            const parsed = parseCanonicalPositiveInt(strVal.replace(/^p-?/i, ''))
            if (parsed === undefined) {
                return aliasValidationError(
                    `project_number '${strVal}' is not a canonical positive integer`,
                )
            }
            obj[key] = parsed
        } else if (key === 'project_number' || key === 'projectNumber') {
            if (methodName !== undefined && PROJECT_REGISTRY_METHOD_NAMES.has(methodName)) {
                return aliasValidationError(
                    `project_number '${strVal}' is not a canonical positive integer`,
                )
            }
            const preserved = obj[key]
            Reflect.deleteProperty(obj, key)
            if (applyProjectNameAlias(strVal, obj) !== 'applied') {
                obj[key] = preserved
                return aliasValidationError(
                    `project_number '${strVal}' is not a number and does not match a registered project`,
                )
            }
        }
    }
    return undefined
}

const AUDIT_LOG_USER_METHODS = new Set(['search_audit_log', 'searchAuditLog'])
const GIT_SORT_BY_METHODS = new Set([
    'get_commit_history', 'getCommitHistory', 'search_commits', 'searchCommits',
])

export function normalizeGenericFieldAliases(
    obj: Record<string, unknown>,
    methodName?: string
): { error: Record<string, unknown> } | undefined {
    renameSimpleFieldAliases(obj, methodName)
    renameScoreAliases(obj)
    normalizeValidationStatusAlias(obj)
    return normalizeProjectAliases(
        obj,
        methodName === undefined || !PROJECT_REGISTRY_METHOD_NAMES.has(methodName)
    )
}

function renameSimpleFieldAliases(obj: Record<string, unknown>, methodName?: string): void {
    const isAuditLog = methodName !== undefined && AUDIT_LOG_USER_METHODS.has(methodName)
    const isGitSort = methodName !== undefined && GIT_SORT_BY_METHODS.has(methodName)
    // High H-2 fixed: delete obj['msg'] (not obj['message'])
    for (const [src, dst] of [
        ['user', 'target_user'],
        ['severity', 'flag_type'],
        ['msg', 'message'],
        ['sort', 'sort_by'],
        ['sortBy', 'sort_by'],
        ['orderBy', 'sort_by'],
        ['order_by', 'sort_by'],
        ['validation', 'validation_status'],
        ['validationStatus', 'validation_status'],
    ] as const) {
        if (src === 'user' && isAuditLog) continue
        if (dst === 'sort_by' && isGitSort) continue
        if (obj[src] !== undefined) {
            if (obj[dst] === undefined) obj[dst] = obj[src]
            Reflect.deleteProperty(obj, src)
        }
    }
}

function renameScoreAliases(obj: Record<string, unknown>): void {
    for (const [aliasKey, targetKey] of [
        ['confidence', 'trust_score'],
        ['trust', 'trust_score'],
        ['trustScore', 'trust_score'],
        ['impact', 'impact_score'],
        ['impactScore', 'impact_score'],
    ] as const) {
        if (obj[aliasKey] !== undefined) {
            if (obj[targetKey] === undefined) {
                const rawScore = obj[aliasKey]
                obj[targetKey] =
                    typeof rawScore === 'string' && /^\d+(?:\.\d+)?$/.test(rawScore.trim())
                        ? Number(rawScore.trim())
                        : rawScore
            }
            Reflect.deleteProperty(obj, aliasKey)
        }
    }
}

function normalizeValidationStatusAlias(obj: Record<string, unknown>): void {
    if (obj['validation_status'] !== undefined && obj['validation_status'] !== null) {
        const vs = typeof obj['validation_status'] === 'string' ? obj['validation_status'].trim().toLowerCase() : obj['validation_status']
        if (vs === true || (typeof vs === 'string' && ['pass', 'success', 'ok', 'passed', 'validated', 'valid', 'verified', 'true', '1'].includes(vs))) {
            obj['validation_status'] = 'passed'
        } else if (vs === false || (typeof vs === 'string' && ['fail', 'failed', 'error', 'failing', 'false', '0'].includes(vs))) {
            obj['validation_status'] = 'failed'
        } else if (typeof vs === 'string' && !['passed', 'none', 'failed'].includes(vs)) {
            obj['validation_status'] = 'none'
        }
    }
}

export { normalizeExecuteCodeAliases } from './execute-code-aliases.js'
