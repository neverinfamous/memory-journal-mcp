import { isRecord } from './shared-utils.js'

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
    'workspace_id',
    'workspaceId',
    'workspace',
    'expected_version',
    'auto_version',
    'project_number',
    'projectNumber',
    'query',
    'search',
    'q',
    'term',
    'keyword',
    'context',
    'session_id',
    'sessionId',
    'timeout',
    'timeout_ms',
    'timeoutMs',
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
])

const ENTRY_CONTENT_ALIAS_KEYS = [
    'learned_context',
    'learnedContext',
    'lesson',
    'insight',
    'knowledge',
] as const

/**
 * Normalizes alternative Code Mode execution payload aliases into `code` while
 * preserving read-only `query` calls and non-code metadata parameters.
 */
export function normalizeExecuteCodeAliases(obj: Record<string, unknown>): void {
    if (obj['repo_name'] !== undefined && obj['repo'] === undefined) {
        obj['repo'] = obj['repo_name']
        delete obj['repo_name']
    }
    if (obj['readonly'] === undefined) {
        const readonlyAlias = obj['readOnly'] ?? obj['read_only']
        if (readonlyAlias !== undefined) {
            obj['readonly'] = readonlyAlias
        }
    }
    delete obj['readOnly']
    delete obj['read_only']
    if (obj['code'] !== undefined) return

    if (typeof obj['query'] === 'string' && obj['query'].trim().length > 0) {
        const hasExplicitCodeAlias = EXPLICIT_CODE_ALIAS_KEYS.some(
            (key) => typeof obj[key] === 'string'
        )
        if (!hasExplicitCodeAlias) {
            return
        }
    }

    const codeAlias =
        obj['script'] ?? obj['js'] ?? obj['javascript'] ?? obj['command'] ?? obj['executionCode'] ?? obj['content'] ??
        obj['eval'] ?? obj['source'] ?? obj['body'] ?? obj['expression'] ?? obj['fn'] ?? obj['exec'] ??
        obj['code_snippet'] ?? obj['raw_code'] ?? obj['statement'] ?? obj['statements'] ?? obj['codeBlock'] ??
        obj['code_block'] ?? obj['script_content'] ?? obj['js_code'] ?? obj['code_string'] ?? obj['action'] ??
        obj['task'] ?? obj['instruction'] ?? obj['instructions'] ?? obj['input'] ?? obj['payload'] ?? obj['text']

    if (typeof codeAlias === 'string') obj['code'] = codeAlias
    else {
        const entryContentAlias = ENTRY_CONTENT_ALIAS_KEYS.map((key) => obj[key]).find(
            (val): val is string => typeof val === 'string' && val.trim().length > 0
        )
        if (entryContentAlias !== undefined) {
            if (obj['content'] === undefined) obj['content'] = entryContentAlias
            return
        }
        if (isRecord(obj['payload'])) obj['code'] = JSON.stringify(obj['payload'])
        else if (isRecord(obj['entry'])) obj['code'] = JSON.stringify(obj['entry'])
        else if (isRecord(obj['input'])) obj['code'] = JSON.stringify(obj['input'])
        else if (obj['action'] !== undefined || obj['task'] !== undefined || obj['notes'] !== undefined || obj['changes'] !== undefined) {
            obj['code'] = JSON.stringify(obj)
        } else {
            for (const [k, v] of Object.entries(obj)) {
                if (typeof v === 'string' && v.trim().length > 0 && !NON_CODE_METADATA_KEYS.has(k)) {
                    obj['code'] = v
                    break
                }
            }
        }
    }
}
