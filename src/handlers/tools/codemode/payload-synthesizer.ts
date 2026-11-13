/**
 * Pre-execution payload and empty payload synthesis for Code Mode.
 * Natural-language synthesis lives in `natural-language-synthesizer.ts`;
 * sandbox context construction lives in `sandbox-user-context.ts`.
 */

import { isRecord } from '../../../codemode/normalizers/shared-utils.js'
import { healCodeModeScript } from './code-healer.js'
import { extractAndRecoverJsonCode } from './json-entry-recovery.js'
import {
    getNonEmptyString,
    isNaturalLanguagePrompt,
    parseProjectNumberField,
    readWorkspaceField,
    synthesizeNaturalLanguageOrEntryPayload,
    type ExecuteCodeInput,
} from './natural-language-synthesizer.js'

export type { ExecuteCodeInput } from './natural-language-synthesizer.js'
export { buildSandboxUserContext } from './sandbox-user-context.js'

const CODE_ALIAS_KEYS = [
    'code', 'script', 'source', 'query', 'content', 'text', 'body', 'js', 'javascript',
    'payload', 'executionCode', 'input', 'command', 'expression', 'fn', 'exec', 'eval',
    'code_snippet', 'raw_code', 'statement', 'statements', 'codeBlock', 'code_block',
    'script_content', 'js_code', 'code_string', 'action', 'task', 'instruction', 'instructions',
] as const

/** [M10] Scope/metadata keys never mistaken for executable code. */
const NON_CODE_PARAM_KEYS = new Set([
    'repo', 'workspace_id', 'workspaceId', 'expected_version', 'auto_version',
    'project_number', 'projectNumber', 'readonly', 'session_id', 'sessionId', 'context',
])

function extractInitialExecutionCode(
    input: ExecuteCodeInput,
    healingEnabled: boolean
): { code: string | undefined; sourceKey: string | undefined } {
    if (!healingEnabled) return { code: input.code, sourceKey: 'code' }
    for (const k of CODE_ALIAS_KEYS) {
        const val = input[k]
        if (typeof val === 'string' && val.length > 0) return { code: val, sourceKey: k }
    }
    return { code: undefined, sourceKey: undefined }
}

function readCandidateRecord(input: ExecuteCodeInput, params: unknown): Record<string, unknown> | undefined {
    const pObj = isRecord(params) ? params : undefined
    const pHasAction =
        pObj !== undefined &&
        (pObj['action'] !== undefined ||
            pObj['task'] !== undefined ||
            pObj['notes'] !== undefined ||
            pObj['changes'] !== undefined)
    if (isRecord(input.payload)) return input.payload
    if (isRecord(input.entry)) return input.entry
    if (isRecord(input.input)) return input.input
    if (isRecord(pObj?.['payload'])) return pObj['payload']
    if (isRecord(pObj?.['entry'])) return pObj['entry']
    if (isRecord(pObj?.['input'])) return pObj['input']
    return pHasAction ? pObj : undefined
}

function recoverCodeFromParamsRecord(params: Record<string, unknown>): string | undefined {
    const entryObj = isRecord(params['entry']) ? params['entry'] : params
    const contentVal = getNonEmptyString(entryObj, params, ['content', 'instructions'])
    const hasEntryMeta = ['title', 'type', 'entry_type'].some((k) => typeof entryObj[k] === 'string')
    if (contentVal !== undefined || hasEntryMeta) {
        const payload: Record<string, unknown> = {
            title: typeof entryObj['title'] === 'string' ? entryObj['title'] : 'Journal Entry',
            content: contentVal ?? '',
            entry_type:
                getNonEmptyString(entryObj, params, ['type', 'entry_type', 'category']) ??
                'technical_decision',
            tags: Array.isArray(entryObj['tags']) ? entryObj['tags'] : [],
        }
        const projVal = parseProjectNumberField(entryObj, params)
        if (projVal !== undefined) payload['project_number'] = projVal
        const wsVal = readWorkspaceField(entryObj, params)
        if (wsVal !== undefined) payload['workspace_id'] = wsVal
        const sessVal = getNonEmptyString(entryObj, params, ['session_id', 'sessionId'])
        if (sessVal !== undefined) payload['session_id'] = sessVal
        return `return await mj.createEntry(${JSON.stringify(payload)});`
    }

    for (const [k, v] of Object.entries(params)) {
        if (typeof v === 'string' && v.trim().length > 0 && !NON_CODE_PARAM_KEYS.has(k)) {
            return v
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
                message:
                    'Code Mode sandbox is active. Provide JavaScript code in the `code` parameter to execute.',
                availableNamespaces: [
                    'mj.core',
                    'mj.search',
                    'mj.admin',
                    'mj.analytics',
                    'mj.relationships',
                    'mj.io',
                    'mj.git',
                    'mj.team',
                    'mj.backup',
                    'mj.github',
                ],
                example: 'return await mj.searchEntries({ query: "example" })',
                discovery:
                    'Use mj.help() or return await mj.core.searchEntries.schema() to inspect parameters.',
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
            success: false,
            error,
            code: 'VALIDATION_ERROR',
            category: 'validation',
            recoverable: true,
            project_id: undefined,
            executionTimeMs: 0,
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
    if (typeof input['limit'] === 'number') searchPayload['limit'] = input['limit']
    return `return await mj.search.searchEntries(${JSON.stringify(searchPayload)});`
}

export function resolveExecutionPayload(
    input: ExecuteCodeInput,
    params: unknown,
    healingEnabled: boolean,
    start: number
): { executionCode: string } | { earlyReturn: Record<string, unknown> } {
    const initial = extractInitialExecutionCode(input, healingEnabled)
    let executionCode = initial.code
    let recoveredJs = false

    const candidate = healingEnabled ? readCandidateRecord(input, params) : undefined
    if (healingEnabled && (executionCode === undefined || executionCode === '') && candidate !== undefined) {
        const recovered = extractAndRecoverJsonCode(JSON.stringify(candidate))
        if (recovered !== null) {
            executionCode = recovered
            recoveredJs = true
        }
    }

    if (healingEnabled && (executionCode === undefined || executionCode === '') && isRecord(params)) {
        executionCode = recoverCodeFromParamsRecord(params)
    }

    // [H7] A non-empty payload/entry that cannot be recovered must fail, not report sandbox status.
    if (
        healingEnabled &&
        (executionCode === undefined || executionCode === '') &&
        candidate !== undefined &&
        Object.keys(candidate).length > 0
    ) {
        return validationFailure(
            'Could not recover executable code from the supplied payload/entry. Pass JavaScript in `code` (e.g. `return await mj.core.createEntry({...})`).'
        )
    }

    if (healingEnabled && executionCode !== undefined && executionCode !== '' && !recoveredJs) {
        if (initial.sourceKey === 'query' && isNaturalLanguagePrompt(executionCode)) {
            executionCode = buildQuerySearch(executionCode, input, params)
        } else {
            executionCode = healCodeModeScript(executionCode)
            const trimmedCode = executionCode.trim()
            let jsonRecovered = false
            if (trimmedCode.startsWith('{') && trimmedCode.endsWith('}')) {
                const recoveredJson = extractAndRecoverJsonCode(trimmedCode)
                if (recoveredJson !== null) {
                    executionCode = recoveredJson
                    jsonRecovered = true
                }
            }
            // [C4] Recovered JS is final; never re-synthesize it into an entry mutation.
            if (!jsonRecovered) executionCode = synthesizeNaturalLanguageOrEntryPayload(executionCode, input, params)
        }
    }

    if (executionCode === undefined || executionCode.trim() === '') {
        if (!healingEnabled) return validationFailure('Missing required parameter: code')
        executionCode = recoverFromContextField(
            input.context ?? (isRecord(params) ? params['context'] : undefined)
        )
        if (executionCode === undefined || executionCode.trim() === '') {
            return buildActiveSandboxStatusResponse(start)
        }
    }

    return { executionCode }
}

function recoverFromContextField(ctxVal: unknown): string | undefined {
    if (typeof ctxVal === 'string' && ctxVal.trim().length > 0) return ctxVal
    if (isRecord(ctxVal)) {
        if (typeof ctxVal['code'] === 'string' && ctxVal['code'].trim().length > 0) return ctxVal['code']
        if (typeof ctxVal['script'] === 'string' && ctxVal['script'].trim().length > 0) return ctxVal['script']
        const wsVal = readWorkspaceField(ctxVal, {})
        const projVal = parseProjectNumberField(ctxVal, {})
        if (typeof ctxVal['query'] === 'string' && ctxVal['query'].trim().length > 0) {
            const searchPayload: Record<string, unknown> = { query: ctxVal['query'] }
            if (wsVal !== undefined) searchPayload['workspace_id'] = wsVal
            if (projVal !== undefined) searchPayload['project_number'] = projVal
            return `return await mj.searchEntries(${JSON.stringify(searchPayload)});`
        }
        if (typeof ctxVal['content'] === 'string' || typeof ctxVal['instructions'] === 'string') {
            const entryPayload: Record<string, unknown> = {
                title: typeof ctxVal['title'] === 'string' ? ctxVal['title'] : 'Journal Entry',
                content: typeof ctxVal['content'] === 'string' ? ctxVal['content'] : ctxVal['instructions'],
                entry_type: typeof ctxVal['type'] === 'string' ? ctxVal['type'] : 'technical_decision',
            }
            if (wsVal !== undefined) entryPayload['workspace_id'] = wsVal
            if (projVal !== undefined) entryPayload['project_number'] = projVal
            return `return await mj.createEntry(${JSON.stringify(entryPayload)});`
        }
    }
    return undefined
}
