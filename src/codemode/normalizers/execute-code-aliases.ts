import { isDbSourceSelector, isRecord } from './shared-utils.js'

const EXPLICIT_CODE_ALIAS_KEYS = [
    'script',
    'js',
    'javascript',
    'command',
    'executionCode',
    'eval',
    'source',
    'code_snippet',
    'raw_code',
    'statement',
    'statements',
    'codeBlock',
    'code_block',
    'script_content',
    'js_code',
    'code_string',
] as const

const NON_CODE_METADATA_KEYS = new Set([
    'repo',
    'repo_name',
    'repoName',
    'repository',
    'workspace_id',
    'workspaceId',
    'workspace',
    'target_workspace_id',
    'targetWorkspaceId',
    'entry_id',
    'entryId',
    'id',
    'project_number',
    'projectNumber',
    'project_id',
    'projectId',
    'project_name',
    'projectName',
    'project',
    'expected_version',
    'auto_version',
    'autoVersion',
    'query',
    'search',
    'q',
    'term',
    'keyword',
    'category',
    'topic',
    'mode',
    'limit',
    'offset',
    'context',
    'session_id',
    'sessionId',
    'timeout',
    'timeout_ms',
    'timeoutMs',
    'max_bytes',
    'maxBytes',
    'max_result_size',
    'maxResultSize',
    'max_result_size_bytes',
    'maxResultSizeBytes',
    'max_result_size_kb',
    'maxResultSizeKb',
    'readonly',
    'readOnly',
    'read_only',
    'dry_run',
    'dryRun',
    'use_test_db',
    'useTestDb',
    'owner',
    'cwd',
    'branch',
    'group_name',
    'groupName',
    'entry_type',
    'entryType',
    'type',
    'significance_type',
    'significanceType',
    'validation_status',
    'validationStatus',
    'title',
    'tags',
    'author',
    'is_personal',
    'isPersonal',
    'share_with_team',
    'shareWithTeam',
    'learned_context',
    'learnedContext',
    'lesson',
    'learning',
    'insight',
    'knowledge',
    'rule',
    'takeaway',
    'finding',
    'discovery',
    'operation',
    'op',
    'action',
    'task',
    'tool',
    'method',
    'function',
])

const ENTRY_CONTENT_ALIAS_KEYS = [
    'learned_context',
    'learnedContext',
    'lesson',
    'insight',
    'knowledge',
] as const

const DISCRIMINATOR_KEYS = ['action', 'operation', 'op', 'tool', 'method', 'function'] as const
const NON_ACTION_DISCRIMINATORS = ['operation', 'op', 'tool', 'method', 'function'] as const

function findFallbackCodeString(obj: Record<string, unknown>): string | undefined {
    for (const [k, v] of Object.entries(obj)) {
        if (typeof v !== 'string' || NON_CODE_METADATA_KEYS.has(k)) continue
        const trimmed = v.trim()
        if (trimmed.length > 0 && (trimmed.split(/\s+/).length >= 2 || /[(.=[\];{}`'"]/.test(trimmed))) {
            return v
        }
    }
    return undefined
}

function deleteRepoAlias(
    obj: Record<string, unknown>,
    key: 'repo_name' | 'repoName' | 'repository'
): void {
    if (key === 'repo_name') delete obj['repo_name']
    else if (key === 'repoName') delete obj['repoName']
    else delete obj['repository']
}

function deleteReadonlyAlias(obj: Record<string, unknown>, key: 'readOnly' | 'read_only'): void {
    if (key === 'readOnly') delete obj['readOnly']
    else delete obj['read_only']
}

/**
 * Normalizes alternative Code Mode execution payload aliases into `code` while
 * preserving read-only `query` calls and non-code metadata parameters.
 */
export function normalizeExecuteCodeAliases(obj: Record<string, unknown>): void {
    for (const k of ['repo_name', 'repoName', 'repository'] as const) {
        const val = obj[k]
        if (val === undefined) continue
        const cur = obj['repo']
        if (cur === undefined || (typeof cur === 'string' && cur.trim() === '' && typeof val === 'string' && val.trim() !== '')) {
            obj['repo'] = val
            deleteRepoAlias(obj, k)
        } else if (Object.is(cur, val) || (typeof cur === 'string' && typeof val === 'string' && cur.trim() === val.trim())) {
            deleteRepoAlias(obj, k)
        }
    }
    for (const k of ['readOnly', 'read_only'] as const) {
        const val = obj[k]
        if (val === undefined) continue
        if (obj['readonly'] === undefined) {
            obj['readonly'] = val
            deleteReadonlyAlias(obj, k)
        } else if (Object.is(obj['readonly'], val)) {
            deleteReadonlyAlias(obj, k)
        }
    }
    if (obj['code'] !== undefined) return

    const hasDiscriminator = DISCRIMINATOR_KEYS.some((k) => obj[k] !== undefined)
    const sourceIsSelector = isDbSourceSelector(obj, hasDiscriminator)
    if (!hasDiscriminator && typeof obj['query'] === 'string' && obj['query'].trim().length > 0) {
        const hasExplicitCodeAlias = EXPLICIT_CODE_ALIAS_KEYS.some(
            (key) => (key !== 'source' || !sourceIsSelector) && typeof obj[key] === 'string'
        )
        if (!hasExplicitCodeAlias) {
            return
        }
    }

    if (hasDiscriminator) {
        const explicitCodeAlias = EXPLICIT_CODE_ALIAS_KEYS.filter(
            (key) => key !== 'source' || !sourceIsSelector
        )
            .map((key) => obj[key])
            .find((val): val is string => typeof val === 'string' && val.length > 0)
        if (explicitCodeAlias !== undefined) {
            obj['code'] = explicitCodeAlias
            return
        }
        const hasNonActionDiscriminator = NON_ACTION_DISCRIMINATORS.some((k) => obj[k] !== undefined)
        if (obj['action'] !== undefined && !hasNonActionDiscriminator) {
            obj['code'] = JSON.stringify(obj)
        }
        return
    }

    const rawSourceCodeAlias = sourceIsSelector ? undefined : obj['source']
    const codeAlias =
        obj['script'] ?? obj['js'] ?? obj['javascript'] ?? obj['command'] ?? obj['executionCode'] ?? obj['content'] ??
        obj['eval'] ?? rawSourceCodeAlias ?? obj['body'] ?? obj['expression'] ?? obj['fn'] ?? obj['exec'] ??
        obj['code_snippet'] ?? obj['raw_code'] ?? obj['statement'] ?? obj['statements'] ?? obj['codeBlock'] ??
        obj['code_block'] ?? obj['script_content'] ?? obj['js_code'] ?? obj['code_string'] ??
        obj['instruction'] ?? obj['instructions'] ?? obj['input'] ?? obj['payload'] ?? obj['text']

    if (typeof codeAlias === 'string') obj['code'] = codeAlias
    else {
        const entryContentAlias = ENTRY_CONTENT_ALIAS_KEYS.map((key) => obj[key]).find(
            (val): val is string => typeof val === 'string' && val.trim().length > 0
        )
        if (entryContentAlias !== undefined) {
            if (obj['content'] === undefined) obj['content'] = entryContentAlias
            return
        }
        if (isRecord(obj['payload']) || isRecord(obj['entry']) || isRecord(obj['input'])) {
            obj['code'] = JSON.stringify(obj)
        } else if (obj['task'] !== undefined || obj['notes'] !== undefined || obj['changes'] !== undefined) {
            obj['code'] = JSON.stringify(obj)
        } else {
            const fallbackCode = findFallbackCodeString(obj)
            if (fallbackCode !== undefined) obj['code'] = fallbackCode
        }
    }
}
