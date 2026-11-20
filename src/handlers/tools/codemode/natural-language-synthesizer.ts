/**
 * Natural-language / flat entry payload synthesis for Code Mode.
 * Split out of `payload-synthesizer.ts` to keep each module cohesive and < 400 lines.
 */

import type { z } from 'zod'
import { isRecord } from '../../../codemode/normalizers/shared-utils.js'
import { parseCanonicalPositiveInt } from '../../../utils/safe-positive-int.js'
import type { ExecuteCodeSchema } from './schemas.js'
import { resolveRepoWorkspace } from './json-entry-structured.js'
import { isValidJsScript } from './code-healer.js'

export type ExecuteCodeInput = z.infer<typeof ExecuteCodeSchema>

const JS_CODE_ALIAS_KEYS = [
    'code',
    'script',
    'js',
    'javascript',
    'eval',
    'source',
    'expression',
    'fn',
    'exec',
    'command',
    'executionCode',
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

const NATURAL_VERB_PATTERN =
    /^(write|document|create|include|record|summary|log|add|added|please|here\s+is|this\s+is|note|task|fix|fixed|implement|implemented|refactor|refactored|update|updated|change|changed|feat|feature|bug|bugfix|chore|perf|test|tests|tested|docs|cleanup|resolved|resolve|remove|removed|hotfix|patch|replace|replaced|migrate|migrated|upgrade|upgraded|enhance|enhanced|improve|improved|delete|deleted|extract|extracted|prevent|prevented|handle|handled|verify|verified|configure|configured|switch|switched|align|aligned|adjust|adjusted|simplify|simplified|rewrite|rewrote|optimize|optimized|investigate|investigated|evaluate|evaluated|eliminate|eliminated|diagnose|diagnosed)\b/i

function isParsableJsCode(trimmed: string): boolean {
    if (/^[A-Za-z_$][\w$]*$/.test(trimmed)) return false
    if (/^\s*(?:[*#-]\s|\d+\.\s)/.test(trimmed)) return false
    if (/^[A-Za-z0-9_-]+:\s+/.test(trimmed) && !/[(.=[\];]/.test(trimmed)) return false
    return isValidJsScript(trimmed)
}

export function isNaturalLanguagePrompt(text: string): boolean {
    const trimmed = text.trim()
    if (trimmed === '') return false
    if (
        /\b(const|let|var|function|return|await|async|for|if|try|while|switch|throw|class|import|export)\b|\bmj\.|\(\s*\)\s*=>/.test(
            trimmed
        )
    ) {
        return false
    }
    if (
        /^(?:SELECT|INSERT|UPDATE|DELETE|PRAGMA|SHOW|DESCRIBE|EXPLAIN|WITH|SCHEMA|TABLES)\b/i.test(trimmed) ||
        /^(?:\.schema|\.tables|\\d|\\dt)/i.test(trimmed)
    ) {
        return false
    }
    if (isParsableJsCode(trimmed)) {
        return false
    }
    if (NATURAL_VERB_PATTERN.test(trimmed)) return true
    if (/^[ \t]*([*#-]\s*\*?|\d+\.\s|[A-Z][a-z0-9_-]+:)/m.test(trimmed)) return true
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

/** Explicit workspace_id, else a registry-resolved `repo`/`repo_name` (never a verbatim `owner/repo`). */
export function readWorkspaceField(primary: Record<string, unknown>, secondary: Record<string, unknown>): string | undefined {
    return (
        getNonEmptyString(primary, secondary, ['workspace_id', 'workspaceId', 'workspace']) ??
        resolveRepoWorkspace(
            primary['repo'] ??
                primary['repo_name'] ??
                primary['repoName'] ??
                primary['repository'] ??
                secondary['repo'] ??
                secondary['repo_name'] ??
                secondary['repoName'] ??
                secondary['repository']
        )
    )
}

export function parseProjectNumberField(
    primary: Record<string, unknown>,
    secondary: Record<string, unknown>
): number | string | undefined {
    const raw =
        primary['project_number'] ??
        primary['projectNumber'] ??
        primary['project_id'] ??
        primary['projectId'] ??
        primary['project_name'] ??
        primary['projectName'] ??
        secondary['project_number'] ??
        secondary['projectNumber'] ??
        secondary['project_id'] ??
        secondary['projectId'] ??
        secondary['project_name'] ??
        secondary['projectName'] ??
        primary['project'] ??
        secondary['project']
    if (typeof raw === 'number') {
        return Number.isSafeInteger(raw) && raw > 0 ? raw : undefined
    }
    if (typeof raw === 'string' && raw.trim() !== '') {
        const trimmed = raw.trim()
        const parsed = /^p-?\d+$/i.test(trimmed)
            ? parseCanonicalPositiveInt(trimmed.replace(/^p-?/i, ''))
            : parseCanonicalPositiveInt(trimmed)
        if (parsed !== undefined) return parsed
        return trimmed
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
        .slice(0, 200)
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

function parsePositiveEntryId(entryObj: Record<string, unknown>, rawObj: Record<string, unknown>): number | undefined {
    const rawEntryId = entryObj['entry_id'] ?? rawObj['entry_id'] ?? entryObj['id'] ?? rawObj['id']
    if (typeof rawEntryId === 'number') {
        return Number.isSafeInteger(rawEntryId) && rawEntryId > 0 ? rawEntryId : undefined
    }
    if (typeof rawEntryId === 'string') {
        const trimmed = rawEntryId.trim()
        if (/^[1-9]\d*$/.test(trimmed)) {
            const parsed = Number(trimmed)
            return Number.isSafeInteger(parsed) && String(parsed) === trimmed ? parsed : undefined
        }
    }
    return undefined
}

function buildSynthesizedEntryPayload(
    executionCode: string,
    entryObj: Record<string, unknown>,
    rawObj: Record<string, unknown>,
    isFlatCall: boolean,
    learnedVal: string | undefined
): string {
    const groupNameVal = getNonEmptyString(entryObj, rawObj, ['group_name', 'groupName'])
    const rawContent = getNonEmptyString(entryObj, rawObj, ['content', 'body']) ?? learnedVal ?? executionCode
    const titleVal = resolveTitle(entryObj, rawObj, executionCode, groupNameVal, learnedVal)
    const typeVal =
        getNonEmptyString(entryObj, rawObj, ['type', 'entry_type', 'category']) ??
        (learnedVal !== undefined ? 'personal_reflection' : 'technical_note')
    const tagsVal = collectTags(entryObj, rawObj, groupNameVal, learnedVal)

    const entryWs = !isFlatCall ? readWorkspaceField(entryObj, {}) : undefined
    const outerWs = readWorkspaceField(rawObj, {})
    const entryProj = !isFlatCall ? parseProjectNumberField(entryObj, {}) : undefined
    const outerProj = parseProjectNumberField(rawObj, {})
    const wsDiffersFromOuter =
        entryWs !== undefined &&
        (outerWs !== undefined
            ? entryWs.trim().toLowerCase() !== outerWs.trim().toLowerCase()
            : entryWs.trim().toLowerCase() === 'default')
    const projVal = entryProj ?? (!wsDiffersFromOuter ? outerProj : undefined)
    const wsVal = entryWs ?? (entryProj === undefined ? outerWs : undefined)
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
    const numericEntryId = parsePositiveEntryId(entryObj, rawObj)

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
    if (trustVal !== undefined) payload['trust_score'] = trustVal
    if (impactVal !== undefined) payload['impact_score'] = impactVal
    if (validVal !== undefined) payload['validation_status'] = validVal
    if (Object.keys(extraContext).length > 0) payload['auto_context'] = extraContext

    const fnName = numericEntryId !== undefined ? 'mj.updateEntry' : 'mj.createEntry'
    appendSharedEntryFlags(payload, entryObj, rawObj)
    return `return await ${fnName}(${JSON.stringify(payload)});`
}

const NESTED_ENTRY_KEYS: readonly string[] = [...ENTRY_KEYS, 'project_number', 'session_id']

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
    const hasExplicitCode = JS_CODE_ALIAS_KEYS.some((key) => {
        const val = input[key]
        return typeof val === 'string' && val.trim().length > 0
    })
    const isExplicitJsCode = hasExplicitCode && !isNaturalLanguagePrompt(executionCode)
    const looksLikeSqlQuery =
        /^(?:SELECT|INSERT|UPDATE|DELETE|PRAGMA|SHOW|DESCRIBE|EXPLAIN|WITH|SCHEMA|TABLES)\b/i.test(
            executionCode.trim()
        )
    const hasExplicitContent =
        typeof rawObj['content'] === 'string' || typeof rawObj['body'] === 'string'

    const entryKeys = isFlatCall ? ENTRY_KEYS : NESTED_ENTRY_KEYS
    const hasEntryFields = entryKeys.some((k) => entryObj[k] !== undefined || (!isFlatCall && rawObj[k] !== undefined))
    const learnedVal = getNonEmptyString(entryObj, rawObj, ['learned_context', 'learnedContext', 'lesson', 'insight', 'knowledge', 'rule'])
    if (
        isExplicitJsCode ||
        (looksLikeSqlQuery && !hasExplicitContent) ||
        (!hasEntryFields && learnedVal === undefined && !isNaturalLanguagePrompt(executionCode))
    ) {
        return executionCode
    }

    return buildSynthesizedEntryPayload(executionCode, entryObj, rawObj, isFlatCall, learnedVal)
}

/** Forward optional entry classification, scope flags, relationships, and anchors uniformly. */
export function appendSharedEntryFlags(
    payload: Record<string, unknown>,
    entryObj: Record<string, unknown>,
    secondaryObj: Record<string, unknown>
): void {
    const sigType = getNonEmptyString(entryObj, secondaryObj, ['significance_type', 'significanceType'])
    if (sigType !== undefined) payload['significance_type'] = sigType
    const isPersonal =
        entryObj['is_personal'] ?? entryObj['isPersonal'] ?? secondaryObj['is_personal'] ?? secondaryObj['isPersonal']
    if (typeof isPersonal === 'boolean') payload['is_personal'] = isPersonal
    const shareTeam =
        entryObj['share_with_team'] ??
        entryObj['shareWithTeam'] ??
        secondaryObj['share_with_team'] ??
        secondaryObj['shareWithTeam']
    if (typeof shareTeam === 'boolean') payload['share_with_team'] = shareTeam
    const rels = Array.isArray(entryObj['relationships'])
        ? entryObj['relationships']
        : Array.isArray(secondaryObj['relationships'])
          ? secondaryObj['relationships']
          : undefined
    if (rels !== undefined) payload['relationships'] = rels
    const anchors = Array.isArray(entryObj['anchors'])
        ? entryObj['anchors']
        : Array.isArray(secondaryObj['anchors'])
          ? secondaryObj['anchors']
          : undefined
    if (anchors !== undefined) payload['anchors'] = anchors
}
