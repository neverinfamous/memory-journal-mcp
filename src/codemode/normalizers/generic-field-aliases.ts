import type { ProjectRegistryEntry } from '../../types/index.js'
import { resolveProjectContextWithRegistry } from '../../utils/workspace-resolver-pure.js'
import { pairStoredScope } from '../../utils/workspace-registry-match.js'
import { hasMethodToken } from '../method-tokens.js'
import { parseCanonicalPositiveInt } from '../../utils/safe-positive-int.js'
import { isRecord } from './shared-utils.js'

const NUMERIC_ID_KEYS = [
    'entry_id', 'entryId', 'id', 'from_entry_id', 'fromEntryId', 'to_entry_id', 'toEntryId',
    'project_number', 'projectNumber', 'issue_number', 'issueNumber', 'pr_number', 'prNumber',
    'milestone_number', 'milestoneNumber', 'offset', 'limit',
]

let activeProjectRegistry: Record<string, ProjectRegistryEntry> | undefined
let fallbackRegistryLoader: (() => Record<string, ProjectRegistryEntry> | undefined) | undefined

export function setActiveProjectRegistry(registry: Record<string, ProjectRegistryEntry> | undefined): void {
    activeProjectRegistry = registry
}

export function setFallbackProjectRegistryLoader(loader: (() => Record<string, ProjectRegistryEntry> | undefined) | undefined): void {
    fallbackRegistryLoader = loader
}

export function resolveEffectiveProjectRegistry(): Record<string, ProjectRegistryEntry> | undefined {
    return activeProjectRegistry ?? fallbackRegistryLoader?.()
}

export function getActiveProjectRegistry(): Record<string, ProjectRegistryEntry> | undefined {
    return activeProjectRegistry
}

export function readProjectRegistryPayload(value: unknown): Record<string, ProjectRegistryEntry> | undefined {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
    const registry: Record<string, ProjectRegistryEntry> = {}
    for (const [key, entry] of Object.entries(value)) {
        if (!isRecord(entry)) continue
        const pathValue = entry['path']
        const projectNumber = entry['project_number']
        const hasPath = typeof pathValue === 'string' && pathValue.trim() !== ''
        const hasProject = typeof projectNumber === 'number' && !Number.isNaN(projectNumber)
        // [H6] Pathless / `owner/repo`-keyed registry entries are preserved (path: '') so
        // name -> project_number resolution keeps working inside the worker.
        if (!hasPath && !hasProject) continue
        const record: ProjectRegistryEntry = { path: hasPath ? pathValue : '' }
        if (hasProject) record.project_number = projectNumber
        registry[key] = record
    }
    return registry
}

function validationError(error: string): { error: Record<string, unknown> } {
    return {
        error: {
            success: false,
            error,
            code: 'VALIDATION_ERROR',
            category: 'validation',
            recoverable: true,
        },
    }
}

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
    for (const key of Object.keys(obj)) {
        if (key.startsWith('_') && key !== '_journal' && key !== '_alias_derived_workspace') {
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
    obj['project_number'] ??=
        firstDefined(metadata, ['project_number', 'projectNumber']) ??
        firstDefined(context, ['project_number', 'projectNumber'])
    obj['session_id'] ??=
        firstDefined(metadata, ['session_id', 'sessionId']) ??
        firstDefined(context, ['session_id', 'sessionId'])
    obj['type'] ??=
        firstDefined(metadata, ['type', 'entry_type', 'category']) ??
        firstDefined(context, ['type', 'entry_type', 'category'])
    obj['tags'] ??= firstDefined(metadata, ['tags']) ?? firstDefined(context, ['tags'])
    if (allowWorkspaceHoist && obj['workspace_id'] === undefined) {
        const hoistedWs =
            firstDefined(metadata, ['workspace_id', 'workspaceId']) ??
            firstDefined(context, ['workspace_id', 'workspaceId'])
        if (hoistedWs !== undefined) {
            obj['workspace_id'] = hoistedWs
            obj['_alias_derived_workspace'] = true
        }
    }
}

export function coerceNumericStringIds(
    obj: Record<string, unknown>,
): { error: Record<string, unknown> } | undefined {
    for (const key of NUMERIC_ID_KEYS) {
        const val = obj[key]
        if (typeof val === 'string') {
            const strVal = val.trim()
            if (strVal === '') continue
            if (key === 'project_number' || key === 'projectNumber') {
                const canonical = parseCanonicalPositiveInt(strVal)
                if (canonical !== undefined) {
                    obj[key] = canonical
                    continue
                }
            }
            if (/^-?\d+$/.test(strVal)) {
                if (key === 'project_number' || key === 'projectNumber') continue
                const parsed = parseInt(strVal, 10)
                if (!isNaN(parsed)) obj[key] = parsed
            } else if ((key === 'project_number' || key === 'projectNumber') && /^p-?\d+$/i.test(strVal)) {
                const parsed = parseCanonicalPositiveInt(strVal.replace(/^p-?/i, ''))
                if (parsed !== undefined) obj[key] = parsed
            } else if (key === 'project_number' || key === 'projectNumber') {
                const preserved = obj[key]
                Reflect.deleteProperty(obj, key)
                if (applyProjectNameAlias(strVal, obj) !== 'applied') {
                    obj[key] = preserved
                    return validationError(
                        `project_number '${strVal}' is not a number and does not match a registered project`,
                    )
                }
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
    return normalizeProjectAliases(obj)
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
                obj[targetKey] = typeof obj[aliasKey] === 'string' ? Number(obj[aliasKey]) : obj[aliasKey]
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

type ProjectNameAliasResult = 'applied' | 'unregistered' | { conflict: string }

function formatScalarOrJson(val: unknown): string {
    return typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean'
        ? String(val)
        : (JSON.stringify(val) ?? typeof val)
}

function applyProjectNameAlias(rawVal: unknown, obj: Record<string, unknown>): ProjectNameAliasResult {
    const existingProj = obj['project_number'] ?? obj['projectNumber']
    const num = Number(rawVal)
    const strVal = typeof rawVal === 'string' || typeof rawVal === 'number' ? String(rawVal) : ''
    if (!Number.isNaN(num) && strVal.trim() !== '') {
        if (existingProj !== undefined) {
            if (Number(existingProj) !== num) {
                return {
                    conflict: `Project alias '${strVal.trim()}' conflicts with project_number '${formatScalarOrJson(existingProj)}'`,
                }
            }
            return 'applied'
        }
        obj['project_number'] = num
        return 'applied'
    }
    if (typeof rawVal !== 'string' || rawVal.trim() === '') return 'applied'
    const name = rawVal.trim()
    const registry = resolveEffectiveProjectRegistry()
    const matchedKey =
        registry === undefined
            ? undefined
            : Object.keys(registry).find((key) => key.toLowerCase() === name.toLowerCase())
    const existingWs = obj['workspace_id'] ?? obj['workspaceId'] ?? obj['workspace']
    if (typeof existingWs === 'string' && existingWs.trim() !== '') {
        const expectedWs = matchedKey ?? name
        if (existingWs.trim().toLowerCase() !== expectedWs.toLowerCase()) {
            return {
                conflict: `Project alias '${name}' conflicts with workspace_id '${existingWs.trim()}'`,
            }
        }
    }
    if (matchedKey === undefined || registry === undefined) return 'unregistered'
    const projectNumber = registry[matchedKey]?.project_number
    if (existingProj !== undefined && projectNumber !== undefined && Number(existingProj) !== projectNumber) {
        return {
            conflict: `Project alias '${name}' (project #${String(projectNumber)}) conflicts with project_number '${formatScalarOrJson(existingProj)}'`,
        }
    }
    if (projectNumber !== undefined && obj['project_number'] === undefined) {
        obj['project_number'] = projectNumber
    }
    if (obj['workspace_id'] === undefined) {
        obj['workspace_id'] = matchedKey
        obj['_alias_derived_workspace'] = true
    }
    return 'applied'
}

function normalizeProjectAliases(obj: Record<string, unknown>): { error: Record<string, unknown> } | undefined {
    if (obj['workspace_id'] === undefined) {
        if (typeof obj['workspaceId'] === 'string') {
            obj['workspace_id'] = obj['workspaceId']
        } else if (typeof obj['workspace'] === 'string') {
            obj['workspace_id'] = obj['workspace']
        }
    }
    Reflect.deleteProperty(obj, 'workspaceId')
    if (obj['workspace_id'] !== undefined) {
        Reflect.deleteProperty(obj, 'workspace')
    }
    if (obj['project_number'] === undefined && obj['projectNumber'] !== undefined) {
        obj['project_number'] = obj['projectNumber']
    }
    Reflect.deleteProperty(obj, 'projectNumber')
    for (const projAlias of ['project_name', 'projectName', 'project'] as const) {
        if (obj[projAlias] === undefined) continue
        const res = applyProjectNameAlias(obj[projAlias], obj)
        if (typeof res === 'object') {
            return validationError(res.conflict)
        }
        if (res === 'applied') {
            Reflect.deleteProperty(obj, projAlias)
        }
    }
    return undefined
}

export function resolveCreateEntryProjectContext(obj: Record<string, unknown>): void {
    if (obj['workspace_id'] === undefined && typeof obj['workspaceId'] === 'string') {
        obj['workspace_id'] = obj['workspaceId']
    }
    if (obj['project_number'] === undefined && obj['projectNumber'] !== undefined) {
        obj['project_number'] = obj['projectNumber']
    }
    let projNum = typeof obj['project_number'] === 'number' ? obj['project_number'] : undefined
    if (typeof obj['project_number'] === 'string') {
        const cleaned = obj['project_number'].trim()
        let parsedNum = Number(cleaned)
        if (Number.isNaN(parsedNum) && /^p-?\d+$/i.test(cleaned)) {
            parsedNum = Number(cleaned.replace(/^p-?/i, ''))
        }
        if (!Number.isNaN(parsedNum) && cleaned !== '') {
            projNum = parsedNum
            obj['project_number'] = parsedNum
        } else if (cleaned !== '') {
            const preserved = obj['project_number']
            Reflect.deleteProperty(obj, 'project_number')
            if (applyProjectNameAlias(cleaned, obj) === 'applied') {
                projNum = typeof obj['project_number'] === 'number' ? obj['project_number'] : undefined
            } else {
                obj['project_number'] = preserved
            }
        } else {
            obj['project_number'] = cleaned
        }
    }
    // [INVARIANT] No content/tag/CWD guessing here: the host `secure-dispatcher` binds the
    // session scope first. Only validate/pair when workspace_id was explicitly provided.
    const wsRaw = typeof obj['workspace_id'] === 'string' ? obj['workspace_id'] : undefined
    const wsTrimmed = wsRaw?.trim()
    const workspaceIsConcrete = wsTrimmed !== undefined && wsTrimmed !== '' && wsTrimmed !== '*'
    if (!workspaceIsConcrete) return
    const effectiveRegistry = resolveEffectiveProjectRegistry()
    const resolved = resolveProjectContextWithRegistry(
        {
            workspace_id: wsTrimmed,
            ...(projNum !== undefined ? { project_number: projNum } : {}),
        },
        effectiveRegistry !== undefined ? { projectRegistry: effectiveRegistry } : undefined,
        effectiveRegistry
    )
    if (projNum !== undefined) {
        pairStoredScope(wsTrimmed, projNum, effectiveRegistry)
    } else if (
        wsTrimmed.toLowerCase() !== 'default' &&
        obj['project_number'] === undefined &&
        resolved.projectNumber !== undefined
    ) {
        obj['project_number'] = resolved.projectNumber
    }
}

export { normalizeExecuteCodeAliases } from './execute-code-aliases.js'
