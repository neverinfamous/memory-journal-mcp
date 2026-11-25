/**
 * Pre-execution payload and empty payload synthesis for Code Mode.
 * Natural-language synthesis lives in `natural-language-synthesizer.ts`;
 * sandbox context construction lives in `sandbox-user-context.ts`.
 */

import { isDbSourceSelector, isRecord } from '../../../codemode/normalizers/shared-utils.js'
import { appendOptionalQuerySearchFields } from '../../../codemode/shared-context-parsers.js'
import { healCodeModeScript } from './code-healer.js'
import { extractAndRecoverJsonCode, extractAndRecoverRecordCode } from './json-entry-recovery.js'
import { hasStructuredDiscriminator } from './json-entry-structured.js'
import { appendEntryTelemetryFields, recoverFromContextField } from './context-payload-recovery.js'
import {
    isSynthesizedMutatingCode,
    readonlySynthesisBlockedResult,
} from './session-alias-conflicts.js'
import {
    getNonEmptyString,
    parsePositiveEntryId,
    parseProjectNumberField,
    readWorkspaceField,
    resolveCompatibleInheritedScope,
    synthesizeNaturalLanguageOrEntryPayload,
    type ExecuteCodeInput,
} from './natural-language-synthesizer.js'

export type { ExecuteCodeInput } from './natural-language-synthesizer.js'
export { buildSandboxUserContext } from './sandbox-user-context.js'

export const CODE_ALIAS_KEYS = [
    'code', 'script', 'source', 'query', 'content', 'text', 'body', 'js', 'javascript',
    'payload', 'executionCode', 'input', 'command', 'expression', 'fn', 'exec', 'eval',
    'code_snippet', 'raw_code', 'statement', 'statements', 'codeBlock', 'code_block',
    'script_content', 'js_code', 'code_string', 'instruction', 'instructions',
] as const

/** [M10] Scope/metadata keys never mistaken for executable code. */
const NON_CODE_PARAM_KEYS = new Set([
    'repo', 'repo_name', 'repoName', 'repository', 'workspace_id', 'workspaceId', 'workspace',
    'target_workspace_id', 'targetWorkspaceId', 'entry_id', 'entryId', 'id', 'expected_version',
    'auto_version', 'autoVersion', 'project_number', 'projectNumber', 'project_id', 'projectId',
    'project_name', 'projectName', 'project', 'readonly', 'readOnly', 'read_only', 'session_id',
    'sessionId', 'context', 'timeout', 'timeout_ms', 'timeoutMs', 'max_bytes', 'maxBytes',
    'max_result_size',
    'maxResultSize', 'max_result_size_bytes', 'maxResultSizeBytes', 'max_result_size_kb',
    'maxResultSizeKb', 'dry_run', 'dryRun', 'use_test_db', 'useTestDb', 'owner', 'cwd', 'branch',
    'group_name', 'groupName', 'entry_type', 'entryType', 'type', 'significance_type',
    'significanceType', 'validation_status', 'validationStatus', 'validation', 'title', 'tags', 'author',
    'is_personal', 'isPersonal', 'share_with_team', 'shareWithTeam', 'expectedVersion', 'auto_context',
    'autoContext', 'impact_score', 'impactScore', 'impact', 'trust_score', 'trustScore', 'trust',
    'relationships', 'anchors', 'learned_context',
    'learnedContext', 'lesson', 'learning', 'insight', 'knowledge', 'rule', 'takeaway',
    'finding', 'discovery', 'search', 'q', 'term', 'keyword', 'category', 'topic', 'mode',
    'limit', 'offset', 'operation', 'op', 'action', 'task', 'tool', 'method', 'function',
])

function extractInitialExecutionCode(
    input: ExecuteCodeInput,
    healingEnabled: boolean,
    params: unknown
): { code: string | undefined; sourceKey: string | undefined } {
    if (!healingEnabled) return { code: input.code, sourceKey: 'code' }
    const paramsRec = isRecord(params) ? params : undefined
    const sourceIsSelector =
        isDbSourceSelector(input) || (paramsRec !== undefined && isDbSourceSelector(paramsRec))
    for (const k of CODE_ALIAS_KEYS) {
        if (k === 'source' && sourceIsSelector) continue
        const val = input[k]
        if (typeof val === 'string' && val.length > 0) return { code: val, sourceKey: k }
    }
    for (const qk of ['search', 'q', 'term', 'keyword'] as const) {
        const val = input[qk]
        if (typeof val === 'string' && val.length > 0) return { code: val, sourceKey: 'query' }
    }
    return { code: undefined, sourceKey: undefined }
}

function readCandidateRecord(input: ExecuteCodeInput, params: unknown): Record<string, unknown> | undefined {
    const pObj = isRecord(params) ? params : undefined
    const targetObj = pObj ?? { ...input }
    const hasNestedContainer =
        isRecord(input.payload) ||
        isRecord(input.entry) ||
        isRecord(input.input) ||
        isRecord(pObj?.['payload']) ||
        isRecord(pObj?.['entry']) ||
        isRecord(pObj?.['input'])
    if (hasNestedContainer) return targetObj
    if (
        pObj !== undefined &&
        (hasStructuredDiscriminator(pObj) ||
            pObj['entry_id'] !== undefined ||
            pObj['entryId'] !== undefined ||
            pObj['id'] !== undefined ||
            pObj['notes'] !== undefined ||
            pObj['changes'] !== undefined)
    ) {
        return pObj
    }
    return undefined
}

function recoverCodeFromParamsRecord(
    params: Record<string, unknown>
): { code: string; synthesized: boolean } | undefined {
    const entryObj = isRecord(params['entry']) ? params['entry'] : params
    const learnedVal = getNonEmptyString(entryObj, params, [
        'learned_context', 'learnedContext', 'lesson', 'learning', 'insight',
        'rule', 'takeaway', 'knowledge', 'finding', 'discovery',
    ])
    const contentVal =
        getNonEmptyString(entryObj, params, ['content', 'instructions', 'description', 'summary']) ?? learnedVal
    const hasEntryMeta = ['title', 'type', 'entry_type', 'group_name', 'groupName'].some(
        (k) => typeof entryObj[k] === 'string'
    )
    if (contentVal !== undefined || hasEntryMeta) {
        const numericEntryId = parsePositiveEntryId(entryObj, params)
        const isUpdate = numericEntryId !== undefined
        const groupNameVal = getNonEmptyString(entryObj, params, ['group_name', 'groupName'])
        const baseTags = Array.isArray(entryObj['tags'])
            ? entryObj['tags'].filter((t): t is string => typeof t === 'string')
            : Array.isArray(params['tags'])
              ? params['tags'].filter((t): t is string => typeof t === 'string')
              : []
        const tags =
            groupNameVal !== undefined && !baseTags.includes(groupNameVal)
                ? [...baseTags, groupNameVal]
                : baseTags
        const finalTags =
            learnedVal !== undefined && !tags.includes('learned-context') && !tags.includes('learning')
                ? [...tags, 'learned-context']
                : tags
        const defaultTitle =
            groupNameVal !== undefined
                ? groupNameVal.charAt(0).toUpperCase() + groupNameVal.slice(1)
                : learnedVal !== undefined
                  ? 'Learned Context'
                  : 'Journal Entry'
        const explicitTitle = getNonEmptyString(entryObj, params, ['title'])
        const explicitType = getNonEmptyString(entryObj, params, ['type', 'entry_type', 'category'])
        const hasExplicitTags = entryObj['tags'] !== undefined || params['tags'] !== undefined
        const payload: Record<string, unknown> = {}
        if (!isUpdate || explicitTitle !== undefined) payload['title'] = explicitTitle ?? defaultTitle
        if (!isUpdate || contentVal !== undefined) payload['content'] = contentVal ?? ''
        if (explicitType !== undefined) {
            payload['entry_type'] = explicitType
        } else if (!isUpdate) {
            payload['entry_type'] = learnedVal !== undefined ? 'personal_reflection' : 'technical_note'
        }
        if (!isUpdate || hasExplicitTags || finalTags.length > 0) payload['tags'] = finalTags
        if (numericEntryId !== undefined) payload['entry_id'] = numericEntryId
        const { projVal, wsVal } = resolveCompatibleInheritedScope(entryObj, params)
        if (projVal !== undefined) payload['project_number'] = projVal
        if (wsVal !== undefined) payload['workspace_id'] = wsVal
        appendEntryTelemetryFields(payload, entryObj, params)
        const fnName = isUpdate ? 'mj.updateEntry' : 'mj.createEntry'
        return { code: `return await ${fnName}(${JSON.stringify(payload)});`, synthesized: true }
    }

    for (const [k, v] of Object.entries(params)) {
        if (typeof v === 'string' && !NON_CODE_PARAM_KEYS.has(k)) {
            const trimmed = v.trim()
            if (trimmed.length > 0 && (trimmed.split(/\s+/).length >= 2 || /[(.=[\];{}`'"]/.test(trimmed))) {
                return { code: v, synthesized: false }
            }
        }
    }
    return undefined
}

function buildActiveSandboxStatusResponse(start: number): { earlyReturn: Record<string, unknown> } {
    return {
        earlyReturn: {
            success: true,
            result: {
                status: 'active',
                message: 'Code Mode sandbox is active. Provide JavaScript code in the `code` parameter to execute.',
                availableNamespaces: [
                    'mj.core', 'mj.search', 'mj.admin', 'mj.analytics', 'mj.relationships',
                    'mj.io', 'mj.git', 'mj.team', 'mj.backup', 'mj.github',
                ],
                example: 'return await mj.searchEntries({ query: "example" })',
                discovery: 'Use mj.help() or return await mj.core.searchEntries.schema() to inspect parameters.',
            },
            _healing_note:
                '🛠️ AUTONOMOUS HEALING: `mj_execute_code` was called without a `code` parameter or with an empty payload. Returned active sandbox status, available namespaces, and execution examples.',
            project_id: undefined,
            executionTimeMs: Math.round(performance.now() - start),
        },
    }
}

function validationFailure(error: string): { earlyReturn: Record<string, unknown> } {
    return {
        earlyReturn: {
            success: false, error, code: 'VALIDATION_ERROR', category: 'validation',
            recoverable: true, project_id: undefined, executionTimeMs: 0,
        },
    }
}

/** Natural-language `query` inputs are searches, never entry mutations. */
function buildQuerySearch(query: string, input: ExecuteCodeInput, params: unknown): string {
    const rawObj = isRecord(params) ? params : {}
    const searchPayload: Record<string, unknown> = { query }
    const wsVal = readWorkspaceField(rawObj, {})
    if (wsVal !== undefined) searchPayload['workspace_id'] = wsVal
    const projVal = parseProjectNumberField(rawObj, {})
    if (projVal !== undefined) searchPayload['project_number'] = projVal
    appendOptionalQuerySearchFields(searchPayload, rawObj, input['limit'])
    return `return await mj.search.searchEntries(${JSON.stringify(searchPayload)});`
}

const DANGEROUS_QUERY_TOKEN_RE =
    /\b(?:process|require|eval|Function|Reflect|Proxy|global|globalThis|__proto__|constructor|prototype)\b/
const RAW_SQL_QUERY_RE =
    /^(?:SELECT|INSERT|UPDATE|DELETE|PRAGMA|SHOW|DESCRIBE|EXPLAIN|WITH|SCHEMA|TABLES)\b/i

const UNRECOVERABLE_PAYLOAD_MSG =
    'Could not recover executable code from the supplied payload/entry. Pass JavaScript in `code` (e.g. `return await mj.core.createEntry({...})`).'

const NON_JS_DISCRIMINATOR_FALLBACK_KEYS = new Set([
    'content', 'text', 'body', 'instruction', 'instructions', 'input', 'payload', 'source',
])

function isUnrecoverableStructuredJsonObject(trimmedCode: string): boolean {
    try {
        const parsed: unknown = JSON.parse(trimmedCode)
        return isRecord(parsed) && hasStructuredDiscriminator(parsed)
    } catch { return false }
}

function transformInitialExecutionCode(
    executionCode: string,
    sourceKey: string | undefined,
    input: ExecuteCodeInput,
    params: unknown
): { executionCode: string; synthesized: boolean } | { earlyReturn: Record<string, unknown> } {
    const trimmedInitial = executionCode.trim()
    const hasExplicitContent =
        isRecord(params) &&
        typeof params['content'] === 'string' &&
        params['content'].trim().length > 0
    const looksLikeSqlQuery = RAW_SQL_QUERY_RE.test(trimmedInitial)

    if (sourceKey === 'query' && !hasExplicitContent) {
        if (isRecord(params) && hasStructuredDiscriminator(params)) {
            const recRecovered = extractAndRecoverRecordCode(params)
            return recRecovered !== null
                ? { executionCode: recRecovered, synthesized: true }
                : validationFailure(UNRECOVERABLE_PAYLOAD_MSG)
        }
        if (looksLikeSqlQuery) {
            return validationFailure(
                'Could not translate raw SQL in `query`. Use `mj.search.searchEntries({ query: "..." })` or a supported `mj.*` method.'
            )
        }
        if (trimmedInitial === '' || DANGEROUS_QUERY_TOKEN_RE.test(trimmedInitial)) {
            return { executionCode, synthesized: false }
        }
        return { executionCode: buildQuerySearch(executionCode, input, params), synthesized: true }
    }

    let healed = healCodeModeScript(executionCode)
    const trimmedCode = healed.trim()
    let jsonRecovered = false
    if (trimmedCode.startsWith('{') && trimmedCode.endsWith('}')) {
        const recoveredJson = extractAndRecoverJsonCode(trimmedCode)
        if (recoveredJson !== null) {
            healed = recoveredJson
            jsonRecovered = true
        } else if (isUnrecoverableStructuredJsonObject(trimmedCode)) {
            return validationFailure(UNRECOVERABLE_PAYLOAD_MSG)
        }
    }
    if (!jsonRecovered && sourceKey !== undefined && NON_JS_DISCRIMINATOR_FALLBACK_KEYS.has(sourceKey) && isRecord(params) && hasStructuredDiscriminator(params)) {
        const recRecovered = extractAndRecoverRecordCode(params)
        return recRecovered !== null
            ? { executionCode: recRecovered, synthesized: true }
            : validationFailure(UNRECOVERABLE_PAYLOAD_MSG)
    }
    // [C4] Recovered JS is final; never re-synthesize it into an entry mutation.
    const beforeNl = healed
    if (!jsonRecovered) healed = synthesizeNaturalLanguageOrEntryPayload(healed, input, params)
    return {
        executionCode: healed,
        synthesized: jsonRecovered || healed !== beforeNl || (sourceKey !== undefined && sourceKey !== 'code'),
    }
}

export function resolveExecutionPayload(
    input: ExecuteCodeInput,
    params: unknown,
    healingEnabled: boolean,
    start: number,
    isReadonly = false
): { executionCode: string } | { earlyReturn: Record<string, unknown> } {
    const readonlyMode =
        isReadonly || input.readonly === true || input.read_only === true || input.readOnly === true
    const initial = extractInitialExecutionCode(input, healingEnabled, params)
    let executionCode = initial.code
    let recoveredJs = false
    let synthesizedOrRecovered = initial.sourceKey !== undefined && initial.sourceKey !== 'code'

    const candidate = healingEnabled ? readCandidateRecord(input, params) : undefined
    if (healingEnabled && (executionCode === undefined || executionCode === '') && candidate !== undefined) {
        const recovered = extractAndRecoverRecordCode(candidate)
        if (recovered !== null) {
            executionCode = recovered
            recoveredJs = true
            synthesizedOrRecovered = true
        } else if (Object.keys(candidate).length > 0 && hasStructuredDiscriminator(candidate)) {
            return validationFailure(UNRECOVERABLE_PAYLOAD_MSG)
        }
    }

    if (healingEnabled && (executionCode === undefined || executionCode === '') && isRecord(params)) {
        const recovered = recoverCodeFromParamsRecord(params)
        if (recovered !== undefined) {
            executionCode = recovered.code
            if (recovered.synthesized) recoveredJs = true
            synthesizedOrRecovered = true
        }
    }

    if (
        healingEnabled &&
        (executionCode === undefined || executionCode === '') &&
        isRecord(params) &&
        (params['entry_id'] !== undefined || params['entryId'] !== undefined || params['id'] !== undefined)
    ) {
        const recovered = extractAndRecoverRecordCode(params)
        if (recovered !== null) {
            executionCode = recovered
            recoveredJs = true
            synthesizedOrRecovered = true
        } else {
            return validationFailure(UNRECOVERABLE_PAYLOAD_MSG)
        }
    }

    // [H7] A non-empty payload/entry that cannot be recovered must fail, not report sandbox status.
    if (healingEnabled && (executionCode === undefined || executionCode === '') && candidate !== undefined && Object.keys(candidate).length > 0) {
        return validationFailure(UNRECOVERABLE_PAYLOAD_MSG)
    }

    if (healingEnabled && executionCode !== undefined && executionCode !== '' && !recoveredJs) {
        const transformed = transformInitialExecutionCode(executionCode, initial.sourceKey, input, params)
        if ('earlyReturn' in transformed) return transformed
        executionCode = transformed.executionCode
        if (transformed.synthesized) synthesizedOrRecovered = true
    }

    if (executionCode === undefined || executionCode.trim() === '') {
        if (!healingEnabled) return validationFailure('Missing required parameter: code')
        const recovered = recoverFromContextField(
            input.context ?? (isRecord(params) ? params['context'] : undefined),
            isRecord(params) ? params : undefined,
            UNRECOVERABLE_PAYLOAD_MSG
        )
        if (typeof recovered === 'object') return recovered
        executionCode = recovered
        if (executionCode === undefined || executionCode.trim() === '') {
            return buildActiveSandboxStatusResponse(start)
        }
        synthesizedOrRecovered = true
    }

    if (synthesizedOrRecovered && readonlyMode && isSynthesizedMutatingCode(executionCode)) {
        return readonlySynthesisBlockedResult()
    }
    return { executionCode }
}
