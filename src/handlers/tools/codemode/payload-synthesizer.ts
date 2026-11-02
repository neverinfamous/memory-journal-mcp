/**
 * Pre-execution payload, natural language, and empty payload synthesis for Code Mode.
 */

import type { z } from 'zod'
import { isRecord } from '../../../codemode/normalizers/shared-utils.js'
import { getRequestContext } from '../../../utils/request-context.js'
import type { ToolContext } from '../../../types/index.js'
import type { ExecuteCodeSchema } from './schemas.js'
import { healCodeModeScript } from './code-healer.js'
import { extractAndRecoverJsonCode } from './json-entry-recovery.js'

export type ExecuteCodeInput = z.infer<typeof ExecuteCodeSchema>

const CODE_ALIAS_KEYS = [
    'code', 'script', 'source', 'query', 'content', 'text', 'body', 'js', 'javascript',
    'payload', 'executionCode', 'input', 'command', 'expression', 'fn', 'exec', 'eval',
    'code_snippet', 'raw_code', 'statement', 'statements', 'codeBlock', 'code_block',
    'script_content', 'js_code', 'code_string', 'action', 'task', 'instruction', 'instructions',
] as const

const NATURAL_VERB_PATTERN =
    /^(write|document|create|include|record|summary|log|add|added|please|here\s+is|this\s+is|note|task|fix|fixed|implement|implemented|refactor|refactored|update|updated|change|changed|feat|feature|bug|bugfix|chore|perf|test|tests|tested|docs|cleanup|resolved|resolve|remove|removed|hotfix|patch|replace|replaced|migrate|migrated|upgrade|upgraded|enhance|enhanced|improve|improved|delete|deleted|extract|extracted|prevent|prevented|handle|handled|verify|verified|configure|configured|switch|switched|align|aligned|adjust|adjusted|simplify|simplified|rewrite|rewrote|optimize|optimized|investigate|investigated|evaluate|evaluated|eliminate|eliminated|diagnose|diagnosed)\b/i

function isNaturalLanguagePrompt(text: string): boolean {
    const trimmed = text.trim()
    if (trimmed === '') return false
    if (/\b(const|let|var|function|return|await|mj\.|import|export|\(\s*\)\s*=>)\b/.test(trimmed)) return false
    if (
        /^(?:SELECT|INSERT|UPDATE|DELETE|PRAGMA|SHOW|DESCRIBE|EXPLAIN|WITH|SCHEMA|TABLES)\b/i.test(trimmed) ||
        /^(?:\.schema|\.tables|\\d|\\dt)/i.test(trimmed)
    ) {
        return false
    }
    if (NATURAL_VERB_PATTERN.test(trimmed)) return true
    if (/^\s*([*#-]\s*\*?|\d+\.\s|[A-Z][a-z0-9_-]+:)/m.test(trimmed)) return true
    return trimmed.split(/\s+/).length >= 3 && !/[;{}=]/.test(trimmed)
}

function getNonEmptyString(primary: Record<string, unknown>, secondary: Record<string, unknown>, keys: string[]): string | undefined {
    for (const k of keys) {
        const pv = primary[k]
        if (typeof pv === 'string' && pv.trim().length > 0) return pv
        const sv = secondary[k]
        if (typeof sv === 'string' && sv.trim().length > 0) return sv
    }
    return undefined
}

export function resolveExecutionPayload(input: ExecuteCodeInput, params: unknown, healingEnabled: boolean, start: number): { executionCode: string } | { earlyReturn: Record<string, unknown> } {
    let executionCode: string | undefined
    if (healingEnabled) {
        for (const k of CODE_ALIAS_KEYS) {
            const val = input[k]
            if (typeof val === 'string' && val.length > 0) {
                executionCode = val
                break
            }
        }
    } else {
        executionCode = input.code
    }

    if (healingEnabled && (executionCode === undefined || executionCode === '')) {
        const pObj = isRecord(params) ? params : undefined
        const candidateObj = isRecord(input.payload) ? input.payload
            : isRecord(input.entry) ? input.entry
            : isRecord(input.input) ? input.input
            : pObj !== undefined
              ? (isRecord(pObj['payload']) ? pObj['payload']
                : isRecord(pObj['entry']) ? pObj['entry']
                : isRecord(pObj['input']) ? pObj['input']
                : (pObj['action'] !== undefined || pObj['task'] !== undefined || pObj['notes'] !== undefined || pObj['changes'] !== undefined ? pObj : undefined))
              : undefined
        if (candidateObj !== undefined) {
            executionCode = extractAndRecoverJsonCode(JSON.stringify(candidateObj)) ?? undefined
        }
    }

    if (healingEnabled && (executionCode === undefined || executionCode === '') && isRecord(params)) {
        const entryObj = isRecord(params['entry']) ? params['entry'] : params
        const contentVal = getNonEmptyString(entryObj, params, ['content', 'instructions'])
        if (contentVal !== undefined || ['title', 'type', 'entry_type'].some((k) => typeof entryObj[k] === 'string')) {
            const payload: Record<string, unknown> = {
                title: typeof entryObj['title'] === 'string' ? entryObj['title'] : 'Journal Entry',
                content: contentVal ?? '',
                entry_type: getNonEmptyString(entryObj, params, ['type', 'entry_type', 'category']) ?? 'technical_decision',
                tags: Array.isArray(entryObj['tags']) ? entryObj['tags'] : [],
            }
            const projVal = typeof entryObj['project_number'] === 'number' ? entryObj['project_number'] : params['project_number']
            if (typeof projVal === 'number') payload['project_number'] = projVal
            const sessVal = getNonEmptyString(entryObj, params, ['session_id'])
            if (sessVal !== undefined) payload['session_id'] = sessVal
            executionCode = `return await mj.createEntry(${JSON.stringify(payload)});`
        } else {
            const skipKeys = new Set(['repo', 'workspace_id', 'expected_version', 'auto_version', 'project_number', 'readonly'])
            for (const [k, v] of Object.entries(params)) {
                if (typeof v === 'string' && v.trim().length > 0 && !skipKeys.has(k)) {
                    executionCode = v
                    break
                }
            }
        }
    }

    if (healingEnabled && executionCode !== undefined && executionCode !== '') {
        executionCode = healCodeModeScript(executionCode)
        const trimmedCode = executionCode.trim()
        if (trimmedCode.startsWith('{') && trimmedCode.endsWith('}')) {
            const recoveredJson = extractAndRecoverJsonCode(trimmedCode)
            if (recoveredJson !== null) executionCode = recoveredJson
        }
        executionCode = synthesizeNaturalLanguageOrEntryPayload(executionCode, input, params)
    }

    if (executionCode === undefined || executionCode.trim() === '') {
        if (!healingEnabled) {
            return {
                earlyReturn: {
                    success: false, error: 'Missing required parameter: code', code: 'VALIDATION_ERROR',
                    category: 'validation', recoverable: true, project_id: undefined, executionTimeMs: 0,
                },
            }
        }
        executionCode = recoverFromContextField(input.context ?? (isRecord(params) ? params['context'] : undefined))
        if (executionCode === undefined || executionCode.trim() === '') {
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
    }

    return { executionCode }
}

function normalizeUnitScore(raw: unknown): number | undefined {
    if (raw === undefined || raw === null) return undefined
    const num = Number(raw)
    if (Number.isNaN(num)) return undefined
    return num > 1 && num <= 10 ? num / 10 : Math.min(1, Math.max(0, num))
}

function synthesizeNaturalLanguageOrEntryPayload(executionCode: string, input: ExecuteCodeInput, params: unknown): string {
    const rawObj = isRecord(params) ? params : {}
    const entryObj = isRecord(rawObj['entry'])
        ? rawObj['entry']
        : isRecord(rawObj['payload'])
          ? rawObj['payload']
          : isRecord(rawObj['input'])
            ? rawObj['input']
            : rawObj
    const isFlatCall = entryObj === rawObj
    const hasExplicitCode = typeof input.code === 'string' && input.code.trim().length > 0
    const isExplicitJsCode = hasExplicitCode && !isNaturalLanguagePrompt(executionCode)

    const entryKeys = [
        'type', 'entry_type', 'title', 'category', 'changes', 'component', 'confidence', 'impact', 'trust',
        'validation', 'validation_status', 'validationStatus', 'trustScore', 'trust_score', 'impactScore', 'impact_score',
        'pr_link', 'pr_url', 'issue_link', 'issue_url', 'summary', 'description', 'details', 'keywords', 'topic',
        'action', 'status', 'notes', 'tags', 'auto_context', 'content', 'body', 'text', 'message', 'entry_id', 'id',
        'entry', 'learned_context', 'learnedContext', 'group_name', 'groupName', 'lesson', 'learning', 'insight',
        'rule', 'takeaway', 'knowledge', 'finding', 'discovery',
    ]
    if (!isFlatCall) entryKeys.push('project_number', 'session_id')

    const hasEntryFields = entryKeys.some((k) => entryObj[k] !== undefined || (!isFlatCall && rawObj[k] !== undefined))
    const learnedVal = getNonEmptyString(entryObj, rawObj, ['learned_context', 'learnedContext', 'lesson', 'insight', 'knowledge', 'rule'])
    if (!((!isExplicitJsCode || learnedVal !== undefined || !isFlatCall) && (hasEntryFields || isNaturalLanguagePrompt(executionCode)))) {
        return executionCode
    }

    const groupNameVal = getNonEmptyString(entryObj, rawObj, ['group_name', 'groupName'])
    const rawContent = getNonEmptyString(entryObj, rawObj, ['content', 'body']) ?? learnedVal ?? executionCode
    const explicitTitle = getNonEmptyString(entryObj, rawObj, ['title', 'summary'])

    let titleVal: string
    if (explicitTitle !== undefined) titleVal = explicitTitle
    else if (groupNameVal !== undefined) titleVal = groupNameVal.charAt(0).toUpperCase() + groupNameVal.slice(1)
    else if (typeof entryObj['entry_id'] === 'string' && Number.isNaN(Number(entryObj['entry_id']))) titleVal = entryObj['entry_id']
    else if (typeof rawObj['entry_id'] === 'string' && Number.isNaN(Number(rawObj['entry_id']))) titleVal = rawObj['entry_id']
    else if (learnedVal !== undefined) titleVal = 'Learned Context'
    else {
        const firstLine = (executionCode.trim().split('\n')[0] ?? '')
            .replace(/^(?:create|add|new|record|log|insert)?\s*entry\s*(?:for|:)?\s*/i, '')
            .replace(/[:.]+$/, '')
            .trim()
        titleVal = firstLine.length > 0 && firstLine.length < 80 ? firstLine : 'Journal Entry'
    }

    const typeVal =
        getNonEmptyString(entryObj, rawObj, ['type', 'entry_type', 'category']) ??
        (learnedVal !== undefined ? 'personal_reflection' : 'technical_decision')

    let tagsVal: string[] = Array.isArray(entryObj['tags'])
        ? entryObj['tags'].filter((t): t is string => typeof t === 'string')
        : Array.isArray(rawObj['tags'])
          ? rawObj['tags'].filter((t): t is string => typeof t === 'string')
          : []
    const topicVal = getNonEmptyString(entryObj, rawObj, ['topic'])
    if (topicVal !== undefined && !tagsVal.includes(topicVal)) tagsVal = [...tagsVal, topicVal]
    if (groupNameVal !== undefined && !tagsVal.includes(groupNameVal)) tagsVal = [...tagsVal, groupNameVal]
    if (learnedVal !== undefined && !tagsVal.includes('learned-context') && !tagsVal.includes('learning')) {
        tagsVal = [...tagsVal, 'learned-context']
    }

    const rawProj = entryObj['project_number'] ?? rawObj['project_number'] ?? entryObj['project'] ?? rawObj['project']
    const projVal = typeof rawProj === 'number' ? rawProj : undefined
    const sessVal = getNonEmptyString(entryObj, rawObj, ['session_id'])
    const trustVal = normalizeUnitScore(
        entryObj['trust'] ?? rawObj['trust'] ?? entryObj['trust_score'] ?? rawObj['trust_score'] ??
        entryObj['trustScore'] ?? rawObj['trustScore'] ?? entryObj['confidence'] ?? rawObj['confidence']
    )
    const impactVal = normalizeUnitScore(
        entryObj['impact'] ?? rawObj['impact'] ?? entryObj['impact_score'] ?? rawObj['impact_score'] ??
        entryObj['impactScore'] ?? rawObj['impactScore']
    )

    const rawValStatus = getNonEmptyString(entryObj, rawObj, ['validation_status', 'validation', 'validationStatus'])
    let validVal: 'passed' | 'failed' | 'none' | undefined
    if (rawValStatus !== undefined) {
        const lower = rawValStatus.trim().toLowerCase()
        if (['passed', 'pass', 'success', 'ok', 'validated', 'valid', 'verified', 'true', '1'].includes(lower)) validVal = 'passed'
        else if (['failed', 'fail', 'error', 'failing', 'false', '0'].includes(lower)) validVal = 'failed'
        else validVal = 'none'
    }

    const rawEntryId = entryObj['entry_id'] ?? rawObj['entry_id'] ?? entryObj['id'] ?? rawObj['id']
    const numericEntryId =
        typeof rawEntryId === 'number'
            ? rawEntryId
            : typeof rawEntryId === 'string' && !Number.isNaN(Number(rawEntryId))
              ? Number(rawEntryId)
              : undefined

    const extraContext: Record<string, unknown> = {}
    for (const k of ['component', 'changes', 'pr_link', 'pr_url', 'issue_link', 'issue_url', 'details', 'notes', 'learned_context', 'group_name']) {
        if (entryObj[k] !== undefined) extraContext[k] = entryObj[k]
        else if (rawObj[k] !== undefined) extraContext[k] = rawObj[k]
    }

    const payload: Record<string, unknown> = { title: titleVal, content: rawContent, entry_type: typeVal, tags: tagsVal }
    if (numericEntryId !== undefined) payload['entry_id'] = numericEntryId
    if (projVal !== undefined) payload['project_number'] = projVal
    if (sessVal !== undefined) payload['session_id'] = sessVal
    if (trustVal !== undefined) payload['trust'] = trustVal
    if (impactVal !== undefined) payload['impact'] = impactVal
    if (validVal !== undefined) payload['validation_status'] = validVal
    if (Object.keys(extraContext).length > 0) payload['auto_context'] = extraContext

    const fnName = numericEntryId !== undefined ? 'mj.updateEntry' : 'mj.createEntry'
    return `return await ${fnName}(${JSON.stringify(payload)});`
}

function recoverFromContextField(ctxVal: unknown): string | undefined {
    if (typeof ctxVal === 'string' && ctxVal.trim().length > 0) return ctxVal
    if (isRecord(ctxVal)) {
        if (typeof ctxVal['code'] === 'string' && ctxVal['code'].trim().length > 0) return ctxVal['code']
        if (typeof ctxVal['script'] === 'string' && ctxVal['script'].trim().length > 0) return ctxVal['script']
        if (typeof ctxVal['query'] === 'string' && ctxVal['query'].trim().length > 0) {
            return `return await mj.searchEntries(${JSON.stringify({ query: ctxVal['query'] })});`
        }
        if (typeof ctxVal['content'] === 'string' || typeof ctxVal['instructions'] === 'string') {
            return `return await mj.createEntry(${JSON.stringify({
                title: typeof ctxVal['title'] === 'string' ? ctxVal['title'] : 'Journal Entry',
                content: typeof ctxVal['content'] === 'string' ? ctxVal['content'] : ctxVal['instructions'],
                entry_type: typeof ctxVal['type'] === 'string' ? ctxVal['type'] : 'technical_decision',
            })});`
        }
    }
    return undefined
}

function parseSizeInBytes(val: unknown): number | undefined {
    if (typeof val === 'number') return !Number.isNaN(val) && val > 0 ? val : undefined
    if (typeof val === 'string') {
        const trimmed = val.trim()
        const match = /^(\d+(?:\.\d+)?)\s*(kb|mb|bytes|b)?$/i.exec(trimmed)
        if (match?.[1] !== undefined) {
            const num = parseFloat(match[1])
            const unit = (match[2] ?? 'b').toLowerCase()
            if (unit === 'mb') return Math.round(num * 1024 * 1024)
            if (unit === 'kb') return Math.round(num * 1024)
            return Math.round(num)
        }
        const parsed = parseInt(trimmed, 10)
        return !Number.isNaN(parsed) && parsed > 0 ? parsed : undefined
    }
    return undefined
}

export function buildSandboxUserContext(
    input: ExecuteCodeInput,
    sessionContext: ToolContext,
    projectId: number | string | undefined,
    numericProjectId: number | undefined,
    workspaceId: string | undefined
): { userContext: Record<string, unknown>; requestedMaxResultSize: number | undefined } {
    let userContext: Record<string, unknown> = {}
    if (input.context !== undefined && input.context !== null) {
        if (isRecord(input.context)) {
            userContext = { ...input.context }
        } else if (typeof input.context === 'string') {
            const trimmed = input.context.trim()
            if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
                try {
                    const parsed: unknown = JSON.parse(trimmed)
                    userContext = isRecord(parsed)
                        ? parsed
                        : { value: parsed, raw: input.context, text: input.context, content: input.context }
                } catch {
                    userContext = { content: input.context, text: input.context, raw: input.context }
                }
            } else {
                userContext = { content: input.context, text: input.context, raw: input.context }
            }
        } else {
            userContext = { value: input.context, raw: input.context }
        }
    }

    const resolvedProjectNumber =
        numericProjectId ?? (typeof projectId === 'number' ? projectId : (sessionContext.config?.defaultProjectNumber ?? 1))
    const sessionFromUser = getNonEmptyString(userContext, {}, ['session_id', 'sessionId'])
    const resolvedSessionId =
        typeof input['session_id'] === 'string' && input['session_id'].length > 0
            ? input['session_id']
            : (sessionFromUser ?? getRequestContext()?.sessionId ?? 'session-default')
    const resolvedWorkspaceId = workspaceId ?? sessionContext.config?.defaultWorkspaceId ?? 'default'

    userContext['project_number'] ??= resolvedProjectNumber
    userContext['projectNumber'] ??= resolvedProjectNumber
    userContext['session_id'] ??= resolvedSessionId
    userContext['sessionId'] ??= resolvedSessionId
    userContext['workspace_id'] ??= resolvedWorkspaceId
    userContext['workspaceId'] ??= resolvedWorkspaceId
    userContext['project_id'] ??= resolvedProjectNumber
    userContext['projectId'] ??= resolvedProjectNumber

    const directSize = parseSizeInBytes(
        input.max_result_size ?? input.maxResultSize ?? input.max_result_size_bytes ?? input.maxResultSizeBytes ??
        userContext['max_result_size'] ?? userContext['maxResultSize'] ?? userContext['max_result_size_bytes'] ?? userContext['maxResultSizeBytes']
    )
    const kbSize = parseSizeInBytes(
        input.max_result_size_kb ?? input.maxResultSizeKb ?? userContext['max_result_size_kb'] ?? userContext['maxResultSizeKb']
    )
    const requestedMaxResultSize = directSize ?? (kbSize !== undefined ? kbSize * 1024 : undefined)

    return { userContext, requestedMaxResultSize }
}
