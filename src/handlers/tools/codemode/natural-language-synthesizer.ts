/**
 * Natural-language / flat entry payload synthesis for Code Mode.
 * Split out of `payload-synthesizer.ts` to keep each module cohesive and < 400 lines.
 */

import type { z } from 'zod'
import { isRecord } from '../../../codemode/normalizers/shared-utils.js'
import type { ExecuteCodeSchema } from './schemas.js'
import { resolveRepoWorkspace } from './json-entry-structured.js'

export type ExecuteCodeInput = z.infer<typeof ExecuteCodeSchema>

const NATURAL_VERB_PATTERN =
    /^(write|document|create|include|record|summary|log|add|added|please|here\s+is|this\s+is|note|task|fix|fixed|implement|implemented|refactor|refactored|update|updated|change|changed|feat|feature|bug|bugfix|chore|perf|test|tests|tested|docs|cleanup|resolved|resolve|remove|removed|hotfix|patch|replace|replaced|migrate|migrated|upgrade|upgraded|enhance|enhanced|improve|improved|delete|deleted|extract|extracted|prevent|prevented|handle|handled|verify|verified|configure|configured|switch|switched|align|aligned|adjust|adjusted|simplify|simplified|rewrite|rewrote|optimize|optimized|investigate|investigated|evaluate|evaluated|eliminate|eliminated|diagnose|diagnosed)\b/i

export function isNaturalLanguagePrompt(text: string): boolean {
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

export function getNonEmptyString(primary: Record<string, unknown>, secondary: Record<string, unknown>, keys: string[]): string | undefined {
    for (const k of keys) {
        const pv = primary[k]
        if (typeof pv === 'string' && pv.trim().length > 0) return pv
        const sv = secondary[k]
        if (typeof sv === 'string' && sv.trim().length > 0) return sv
    }
    return undefined
}

/** Explicit workspace_id, else a registry-resolved `repo` (never a verbatim `owner/repo`). */
export function readWorkspaceField(primary: Record<string, unknown>, secondary: Record<string, unknown>): string | undefined {
    return (
        getNonEmptyString(primary, secondary, ['workspace_id', 'workspaceId']) ??
        resolveRepoWorkspace(primary['repo'] ?? secondary['repo'])
    )
}

export function parseProjectNumberField(
    primary: Record<string, unknown>,
    secondary: Record<string, unknown>
): number | undefined {
    const raw =
        primary['project_number'] ??
        primary['projectNumber'] ??
        secondary['project_number'] ??
        secondary['projectNumber'] ??
        primary['project'] ??
        secondary['project']
    if (typeof raw === 'number' && !Number.isNaN(raw)) return raw
    if (typeof raw === 'string' && raw.trim() !== '') {
        const num = Number(raw.trim().replace(/^p-?/i, ''))
        if (!Number.isNaN(num)) return num
    }
    return undefined
}

function normalizeUnitScore(raw: unknown): number | undefined {
    if (raw === undefined || raw === null) return undefined
    const num = Number(raw)
    if (Number.isNaN(num)) return undefined
    return num > 1 && num <= 10 ? num / 10 : Math.min(1, Math.max(0, num))
}

function normalizeValidation(raw: string | undefined): 'passed' | 'failed' | 'none' | undefined {
    if (raw === undefined) return undefined
    const lower = raw.trim().toLowerCase()
    if (['passed', 'pass', 'success', 'ok', 'validated', 'valid', 'verified', 'true', '1'].includes(lower)) return 'passed'
    if (['failed', 'fail', 'error', 'failing', 'false', '0'].includes(lower)) return 'failed'
    return 'none'
}

const ENTRY_KEYS = [
    'type', 'entry_type', 'title', 'category', 'changes', 'component', 'confidence', 'impact', 'trust',
    'validation', 'validation_status', 'validationStatus', 'trustScore', 'trust_score', 'impactScore', 'impact_score',
    'pr_link', 'pr_url', 'issue_link', 'issue_url', 'summary', 'description', 'details', 'keywords', 'topic',
    'action', 'status', 'notes', 'tags', 'auto_context', 'content', 'body', 'text', 'message', 'entry_id', 'id',
    'entry', 'learned_context', 'learnedContext', 'group_name', 'groupName', 'lesson', 'learning', 'insight',
    'rule', 'takeaway', 'knowledge', 'finding', 'discovery',
]

function resolveTitle(
    entryObj: Record<string, unknown>,
    rawObj: Record<string, unknown>,
    executionCode: string,
    groupNameVal: string | undefined,
    learnedVal: string | undefined
): string {
    const explicitTitle = getNonEmptyString(entryObj, rawObj, ['title', 'summary'])
    if (explicitTitle !== undefined) return explicitTitle
    if (groupNameVal !== undefined) return groupNameVal.charAt(0).toUpperCase() + groupNameVal.slice(1)
    if (typeof entryObj['entry_id'] === 'string' && Number.isNaN(Number(entryObj['entry_id']))) return entryObj['entry_id']
    if (typeof rawObj['entry_id'] === 'string' && Number.isNaN(Number(rawObj['entry_id']))) return rawObj['entry_id']
    if (learnedVal !== undefined) return 'Learned Context'
    const firstLine = (executionCode.trim().split('\n')[0] ?? '')
        .replace(/^(?:create|add|new|record|log|insert)?\s*entry\s*(?:for|:)?\s*/i, '')
        .replace(/[:.]+$/, '')
        .trim()
    return firstLine.length > 0 && firstLine.length < 80 ? firstLine : 'Journal Entry'
}

function collectTags(
    entryObj: Record<string, unknown>,
    rawObj: Record<string, unknown>,
    groupNameVal: string | undefined,
    learnedVal: string | undefined
): string[] {
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
    return tagsVal
}

export function synthesizeNaturalLanguageOrEntryPayload(executionCode: string, input: ExecuteCodeInput, params: unknown): string {
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

    const entryKeys = isFlatCall ? ENTRY_KEYS : [...ENTRY_KEYS, 'project_number', 'session_id']
    const hasEntryFields = entryKeys.some((k) => entryObj[k] !== undefined || (!isFlatCall && rawObj[k] !== undefined))
    const learnedVal = getNonEmptyString(entryObj, rawObj, ['learned_context', 'learnedContext', 'lesson', 'insight', 'knowledge', 'rule'])
    if (!((!isExplicitJsCode || learnedVal !== undefined || !isFlatCall) && (hasEntryFields || isNaturalLanguagePrompt(executionCode)))) {
        return executionCode
    }

    const groupNameVal = getNonEmptyString(entryObj, rawObj, ['group_name', 'groupName'])
    const rawContent = getNonEmptyString(entryObj, rawObj, ['content', 'body']) ?? learnedVal ?? executionCode
    const titleVal = resolveTitle(entryObj, rawObj, executionCode, groupNameVal, learnedVal)
    const typeVal =
        getNonEmptyString(entryObj, rawObj, ['type', 'entry_type', 'category']) ??
        (learnedVal !== undefined ? 'personal_reflection' : 'technical_decision')
    const tagsVal = collectTags(entryObj, rawObj, groupNameVal, learnedVal)

    const projVal = parseProjectNumberField(entryObj, rawObj)
    const wsVal = readWorkspaceField(entryObj, rawObj)
    const sessVal = getNonEmptyString(entryObj, rawObj, ['session_id', 'sessionId'])
    const trustVal = normalizeUnitScore(
        entryObj['trust'] ?? rawObj['trust'] ?? entryObj['trust_score'] ?? rawObj['trust_score'] ??
        entryObj['trustScore'] ?? rawObj['trustScore'] ?? entryObj['confidence'] ?? rawObj['confidence']
    )
    const impactVal = normalizeUnitScore(
        entryObj['impact'] ?? rawObj['impact'] ?? entryObj['impact_score'] ?? rawObj['impact_score'] ??
        entryObj['impactScore'] ?? rawObj['impactScore']
    )
    const validVal = normalizeValidation(getNonEmptyString(entryObj, rawObj, ['validation_status', 'validation', 'validationStatus']))

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
    if (wsVal !== undefined) payload['workspace_id'] = wsVal
    if (sessVal !== undefined) payload['session_id'] = sessVal
    if (trustVal !== undefined) payload['trust'] = trustVal
    if (impactVal !== undefined) payload['impact'] = impactVal
    if (validVal !== undefined) payload['validation_status'] = validVal
    if (Object.keys(extraContext).length > 0) payload['auto_context'] = extraContext

    const fnName = numericEntryId !== undefined ? 'mj.updateEntry' : 'mj.createEntry'
    return `return await ${fnName}(${JSON.stringify(payload)});`
}
