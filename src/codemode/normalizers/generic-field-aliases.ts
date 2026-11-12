import type { ProjectRegistryEntry } from '../../types/index.js'
import { loadProjectRegistryFromConfig, resolveProjectContext } from '../../utils/workspace-resolver.js'
import { activeProjectRegistry as registryForScope, pairStoredScope } from '../../utils/write-scope.js'
import { hasMethodToken } from '../method-tokens.js'
import { isRecord, safeString } from './shared-utils.js'

const NUMERIC_ID_KEYS = [
    'entry_id', 'entryId', 'id', 'from_entry_id', 'fromEntryId', 'to_entry_id', 'toEntryId',
    'project_number', 'projectNumber', 'issue_number', 'issueNumber', 'pr_number', 'prNumber',
    'milestone_number', 'milestoneNumber', 'offset', 'limit',
]

let activeProjectRegistry: Record<string, ProjectRegistryEntry> | undefined

export function setActiveProjectRegistry(registry: Record<string, ProjectRegistryEntry> | undefined): void {
    activeProjectRegistry = registry
}

export function readProjectRegistryPayload(value: unknown): Record<string, ProjectRegistryEntry> | undefined {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
    const registry: Record<string, ProjectRegistryEntry> = {}
    for (const [key, entry] of Object.entries(value)) {
        if (!isRecord(entry)) continue
        const pathValue = entry['path']
        if (typeof pathValue !== 'string' || pathValue.trim() === '') continue
        const projectNumber = entry['project_number']
        const record: ProjectRegistryEntry = { path: pathValue }
        if (typeof projectNumber === 'number' && !Number.isNaN(projectNumber)) {
            record.project_number = projectNumber
        }
        registry[key] = record
    }
    return Object.keys(registry).length > 0 ? registry : undefined
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

export function extractMetadataContextAliases(obj: Record<string, unknown>): void {
    const metaObj = isRecord(obj['metadata']) ? obj['metadata'] : isRecord(obj['context']) ? obj['context'] : undefined
    if (!metaObj) return
    obj['project_number'] ??= metaObj['project_number'] ?? metaObj['projectNumber']
    obj['session_id'] ??= metaObj['session_id'] ?? metaObj['sessionId']
    obj['type'] ??= metaObj['type'] ?? metaObj['entry_type'] ?? metaObj['category']
    obj['tags'] ??= metaObj['tags']
    obj['workspace_id'] ??= metaObj['workspace_id'] ?? metaObj['workspaceId']
}

export function coerceNumericStringIds(
    obj: Record<string, unknown>,
): { error: Record<string, unknown> } | undefined {
    for (const key of NUMERIC_ID_KEYS) {
        const val = obj[key]
        if (typeof val === 'string') {
            const strVal = val.trim()
            if (/^-?\d+$/.test(strVal)) {
                const parsed = parseInt(strVal, 10)
                if (!isNaN(parsed)) obj[key] = parsed
            } else if ((key === 'project_number' || key === 'projectNumber') && /^p-?\d+$/i.test(strVal)) {
                const parsed = parseInt(strVal.replace(/^p-?/i, ''), 10)
                if (!isNaN(parsed)) obj[key] = parsed
            } else if (key === 'project_number' || key === 'projectNumber') {
                const preserved = obj[key]
                Reflect.deleteProperty(obj, key)
                if (!applyProjectNameAlias(strVal, obj)) {
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

export function normalizeGenericFieldAliases(obj: Record<string, unknown>, methodName?: string): void {
    renameSimpleFieldAliases(obj, methodName)
    renameScoreAliases(obj)
    normalizeValidationStatusAlias(obj)
    normalizeProjectAliases(obj)
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

function applyProjectNameAlias(rawVal: unknown, obj: Record<string, unknown>): boolean {
    if (obj['project_number'] !== undefined) return true
    const num = Number(rawVal)
    const strVal = typeof rawVal === 'string' || typeof rawVal === 'number' ? String(rawVal) : ''
    if (!Number.isNaN(num) && strVal.trim() !== '') {
        obj['project_number'] = num
        return true
    }
    if (typeof rawVal !== 'string' || rawVal.trim() === '') return true
    const name = rawVal.trim()
    const registry = activeProjectRegistry ?? loadProjectRegistryFromConfig()
    const matchedKey =
        registry === undefined
            ? undefined
            : Object.keys(registry).find((key) => key.toLowerCase() === name.toLowerCase())
    if (matchedKey === undefined || registry === undefined) return false
    const projectNumber = registry[matchedKey]?.project_number
    if (projectNumber !== undefined) obj['project_number'] = projectNumber
    if (obj['workspace_id'] === undefined) obj['workspace_id'] = matchedKey
    return true
}

function normalizeProjectAliases(obj: Record<string, unknown>): void {
    for (const projAlias of ['project_name', 'projectName'] as const) {
        if (obj[projAlias] === undefined) continue
        if (applyProjectNameAlias(obj[projAlias], obj)) {
            Reflect.deleteProperty(obj, projAlias)
        }
    }
    if (obj['project'] !== undefined) {
        if (obj['project_number'] === undefined) {
            const num = Number(obj['project'])
            const strVal = typeof obj['project'] === 'string' || typeof obj['project'] === 'number' ? String(obj['project']) : ''
            if (!Number.isNaN(num) && strVal.trim() !== '') {
                obj['project_number'] = num
            } else if (typeof obj['project'] === 'string' && obj['project'].trim() !== '') {
                if (!applyProjectNameAlias(obj['project'], obj)) {
                    const existingTags = Array.isArray(obj['tags']) ? obj['tags'].filter((t): t is string => typeof t === 'string') : []
                    obj['tags'] = [...existingTags, obj['project'].trim()]
                }
            }
        }
        delete obj['project']
    }
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
        } else {
            if (obj['workspace_id'] === undefined || obj['workspace_id'] === null || obj['workspace_id'] === '' || obj['workspace_id'] === 'default') {
                obj['workspace_id'] = cleaned
            }
            delete obj['project_number']
        }
    }
    const content = typeof obj['content'] === 'string' ? obj['content'] : undefined
    const tags = Array.isArray(obj['tags']) ? obj['tags'].filter((t): t is string => typeof t === 'string') : undefined
    const wsRaw = typeof obj['workspace_id'] === 'string' ? obj['workspace_id'] : undefined
    const workspaceIsConcrete =
        wsRaw !== undefined && wsRaw !== '' && wsRaw !== 'default' && wsRaw !== '*'
    const resolved = resolveProjectContext({
        ...(wsRaw !== undefined ? { workspace_id: wsRaw } : {}),
        ...(projNum !== undefined ? { project_number: projNum } : {}),
        ...(workspaceIsConcrete || projNum !== undefined
            ? {}
            : {
                  ...(content !== undefined ? { content } : {}),
                  ...(tags !== undefined ? { tags } : {}),
              }),
    })
    if (
        resolved.workspaceId !== undefined &&
        resolved.workspaceId !== '' &&
        (obj['workspace_id'] === undefined ||
            obj['workspace_id'] === '' ||
            obj['workspace_id'] === 'default')
    ) {
        if (resolved.workspaceId !== 'default') {
            obj['workspace_id'] = resolved.workspaceId
        } else if (process.env['MCP_WORKSPACE_ID'] !== undefined && process.env['MCP_WORKSPACE_ID'] !== '') {
            obj['workspace_id'] = process.env['MCP_WORKSPACE_ID']
        } else {
            delete obj['workspace_id']
        }
    }
    const wsAfter = obj['workspace_id']
    const concreteAfter =
        typeof wsAfter === 'string' && wsAfter !== '' && wsAfter !== 'default' && wsAfter !== '*'
    if (projNum !== undefined && concreteAfter) {
        pairStoredScope(wsAfter, projNum, registryForScope(activeProjectRegistry))
    } else if (obj['project_number'] === undefined && resolved.projectNumber !== undefined) {
        obj['project_number'] = resolved.projectNumber
    }
}

export function normalizeExecuteCodeAliases(obj: Record<string, unknown>): void {
    if (obj['repo_name'] !== undefined && obj['repo'] === undefined) {
        obj['repo'] = obj['repo_name']
        delete obj['repo_name']
    }
    if (obj['code'] !== undefined) return

    const codeAlias =
        obj['script'] ?? obj['js'] ?? obj['javascript'] ?? obj['query'] ?? obj['command'] ?? obj['content'] ??
        obj['eval'] ?? obj['source'] ?? obj['body'] ?? obj['expression'] ?? obj['fn'] ?? obj['exec'] ??
        obj['code_snippet'] ?? obj['raw_code'] ?? obj['statement'] ?? obj['statements'] ?? obj['codeBlock'] ??
        obj['code_block'] ?? obj['script_content'] ?? obj['js_code'] ?? obj['code_string'] ?? obj['action'] ??
        obj['task'] ?? obj['instruction'] ?? obj['instructions'] ?? obj['input'] ?? obj['payload'] ?? obj['text']

    if (typeof codeAlias === 'string') obj['code'] = codeAlias
    else if (isRecord(obj['payload'])) obj['code'] = JSON.stringify(obj['payload'])
    else if (isRecord(obj['entry'])) obj['code'] = JSON.stringify(obj['entry'])
    else if (isRecord(obj['input'])) obj['code'] = JSON.stringify(obj['input'])
    else if (obj['action'] !== undefined || obj['task'] !== undefined || obj['notes'] !== undefined || obj['changes'] !== undefined) {
        obj['code'] = JSON.stringify(obj)
    } else {
        for (const [k, v] of Object.entries(obj)) {
            if (typeof v === 'string' && v.trim().length > 0 && !['repo', 'workspace_id', 'expected_version', 'auto_version', 'project_number'].includes(k)) {
                obj['code'] = v
                break
            }
        }
    }
}

const ENTRY_TYPE_ALIASES: Record<string, string> = {
    bug: 'bug_fix', bugfix: 'bug_fix', bug_fix: 'bug_fix', 'bug-fix': 'bug_fix', hotfix: 'bug_fix', defect: 'bug_fix',
    progress: 'development_note', status: 'development_note', development: 'development_note',
    feature: 'feature_implementation', meeting: 'meeting_notes',
    task: 'technical_note', chore: 'technical_note', refactor: 'technical_note', fix: 'technical_note',
    update: 'technical_note', technical: 'technical_note', note: 'technical_note',
    documentation: 'technical_note', code: 'technical_note', coding: 'technical_note',
    'session-summary': 'retrospective', session_summary: 'retrospective',
    'team-session-summary': 'retrospective', team_session_summary: 'retrospective',
    'team session summary': 'retrospective',
}

function canonicalizeEntryType(obj: Record<string, unknown>): void {
    if (obj['type'] !== undefined && obj['entry_type'] === undefined) {
        obj['entry_type'] = obj['type']
        delete obj['type']
    }
    if (typeof obj['entry_type'] !== 'string') return
    const alias = ENTRY_TYPE_ALIASES[obj['entry_type'].toLowerCase().trim()]
    if (alias !== undefined) obj['entry_type'] = alias
}

export function synthesizeEntryMutationFields(obj: Record<string, unknown>): void {
    canonicalizeEntryType(obj)
    const contentParts: string[] = []

    const consumeGroup = (keys: string[], format: (val: unknown) => string): void => {
        let found: unknown
        for (const k of keys) {
            if (found === undefined && obj[k] !== undefined) found = obj[k]
            Reflect.deleteProperty(obj, k)
        }
        if (found !== undefined) {
            const s = format(found)
            if (s !== '') contentParts.push(s)
        }
    }

    consumeGroup(['title', 'heading', 'subject', 'name'], (v) => {
        const s = safeString(v)
        return s !== '' ? `# ${s}` : ''
    })
    consumeGroup(['description', 'details', 'summary', 'notes', 'text', 'message'], safeString)
    consumeGroup(['context'], (v) => {
        const s = safeString(v)
        return s !== '' ? `**Context:** ${s}` : ''
    })
    consumeGroup(['focus', 'goal', 'objective'], (v) => {
        const s = safeString(v)
        return s !== '' ? `**Focus:** ${s}` : ''
    })
    consumeGroup(['resolution', 'fix', 'solution', 'result'], (v) => {
        const s = safeString(v)
        return s !== '' ? `**Resolution:** ${s}` : ''
    })
    consumeGroup(['artifacts', 'files', 'changes', 'modified_files'], (v) => {
        const s = Array.isArray(v) ? v.map(safeString).join(', ') : safeString(v)
        return s !== '' ? `**Artifacts:** ${s}` : ''
    })
    consumeGroup(['findings', 'results', 'key_findings', 'discoveries'], (v) => {
        const s = Array.isArray(v) ? v.map((f) => `- ${safeString(f)}`).join('\n') : safeString(v)
        return s !== '' ? `**Findings:**\n${s}` : ''
    })

    if (obj['content'] !== undefined) {
        const existing = safeString(obj['content'])
        if (contentParts.length > 0) {
            obj['content'] = existing !== '' ? `${existing}\n\n${contentParts.join('\n\n')}` : contentParts.join('\n\n')
        }
    } else if (contentParts.length > 0) {
        obj['content'] = contentParts.join('\n\n')
    }

    if (typeof obj['content'] === 'string') {
        // Agents frequently double-escape quotes (\" / \') in entry content; heal them.
        obj['content'] = obj['content'].replace(/\\+'/g, "'").replace(/\\+"/g, '"')
    }
}
