/**
 * Natural-language / flat entry payload synthesis for Code Mode.
 * Split out of `payload-synthesizer.ts` to keep each module cohesive and < 400 lines.
 */

import type { z } from 'zod'
import { isDbSourceSelector, isRecord } from '../../../codemode/normalizers/shared-utils.js'
import { parseCanonicalPositiveInt } from '../../../utils/safe-positive-int.js'
import type { ExecuteCodeSchema } from './schemas.js'
import { hasStructuredDiscriminator, resolveRepoWorkspace } from './json-entry-structured.js'
import { isValidJsScript } from './code-healer.js'

export type ExecuteCodeInput = z.infer<typeof ExecuteCodeSchema>

const JS_CODE_ALIAS_KEYS = [
    'code', 'script', 'js', 'javascript', 'eval', 'source', 'expression', 'fn', 'exec', 'command',
    'executionCode', 'code_snippet', 'raw_code', 'statement', 'statements', 'codeBlock', 'code_block',
    'script_content', 'js_code', 'code_string',
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
            getNonEmptyString(primary, {}, ['repo', 'repo_name', 'repoName', 'repository']) ??
                getNonEmptyString(secondary, {}, ['repo', 'repo_name', 'repoName', 'repository'])
        )
    )
}

function firstNonBlankAlias(
    primary: Record<string, unknown>,
    secondary: Record<string, unknown>,
    keys: readonly string[]
): unknown {
    for (const src of [primary, secondary]) {
        for (const k of keys) {
            const v = src[k]
            if (v !== undefined && !(typeof v === 'string' && v.trim() === '')) return v
        }
    }
    return undefined
}

export function parseProjectNumberField(
    primary: Record<string, unknown>,
    secondary: Record<string, unknown>
): number | string | undefined {
    const raw =
        firstNonBlankAlias(primary, secondary, [
            'project_number',
            'projectNumber',
            'project_id',
            'projectId',
            'project_name',
            'projectName',
        ]) ?? firstNonBlankAlias(primary, secondary, ['project'])
    if (typeof raw === 'number') {
        if (Number.isSafeInteger(raw) && raw > 0) return raw
        return Number.isFinite(raw) ? raw : String(raw)
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

/** Resolve workspace/project scope from a primary entry/context bag while preventing outer project inheritance across mismatched explicit workspaces. */
export function resolveCompatibleInheritedScope(
    primary: Record<string, unknown>,
    secondary: Record<string, unknown>
): { projVal: number | string | undefined; wsVal: string | undefined } {
    const entryWs = readWorkspaceField(primary, {})
    const outerWs = readWorkspaceField(secondary, {})
    const entryProj = parseProjectNumberField(primary, {})
    const outerProj = parseProjectNumberField(secondary, {})
    const wsDiffersFromOuter =
        entryWs !== undefined &&
        (outerWs !== undefined
            ? entryWs.trim().toLowerCase() !== outerWs.trim().toLowerCase()
            : entryWs.trim().toLowerCase() === 'default')
    const projVal = entryProj ?? (!wsDiffersFromOuter ? outerProj : undefined)
    const wsVal = entryWs ?? (entryProj === undefined ? outerWs : undefined)
    return { projVal, wsVal }
}

function normalizeUnitScore(raw: unknown): number | undefined {
    let num: number
    if (typeof raw === 'number') {
        if (!Number.isFinite(raw)) return undefined
        num = raw
    } else if (typeof raw === 'string' && /^-?\d+(?:\.\d+)?$/.test(raw.trim())) {
        num = Number(raw.trim())
        if (!Number.isFinite(num)) return undefined
    } else {
        return undefined
    }
    return num > 1 && num <= 10 ? num / 10 : Math.min(1, Math.max(0, num))
}

const VALIDATION_PASSED_ALIASES = new Set([
    'passed', 'pass', 'success', 'ok', 'validated', 'valid', 'verified', 'true', '1',
])
const VALIDATION_FAILED_ALIASES = new Set(['failed', 'fail', 'error', 'failing', 'false', '0'])
const VALIDATION_NONE_ALIASES = new Set([
    'none', 'null', 'undefined', 'skip', 'skipped', 'unknown', 'pending',
])

function normalizeValidation(raw: string | undefined): string | undefined {
    if (raw === undefined) return undefined
    const trimmed = raw.trim()
    const lower = trimmed.toLowerCase()
    if (VALIDATION_PASSED_ALIASES.has(lower)) return 'passed'
    if (VALIDATION_FAILED_ALIASES.has(lower)) return 'failed'
    if (VALIDATION_NONE_ALIASES.has(lower)) return 'none'
    return trimmed
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

export function parsePositiveEntryId(
    entryObj: Record<string, unknown>,
    rawObj: Record<string, unknown>
): number | string | undefined {
    const rawEntryId =
        firstNonBlankAlias(entryObj, rawObj, ['entry_id']) ??
        firstNonBlankAlias(entryObj, rawObj, ['entryId']) ??
        firstNonBlankAlias(entryObj, rawObj, ['id'])
    if (rawEntryId === undefined) {
        for (const src of [entryObj, rawObj]) {
            for (const k of ['entry_id', 'entryId', 'id'] as const) {
                if (typeof src[k] === 'string' && src[k].trim() === '') return ''
            }
        }
        return undefined
    }
    if (typeof rawEntryId === 'number') {
        if (Number.isSafeInteger(rawEntryId) && rawEntryId > 0) return rawEntryId
        return Number.isFinite(rawEntryId) ? rawEntryId : String(rawEntryId)
    }
    if (typeof rawEntryId === 'string') {
        const trimmed = rawEntryId.trim()
        if (/^[1-9]\d*$/.test(trimmed)) {
            const parsed = Number(trimmed)
            return Number.isSafeInteger(parsed) && String(parsed) === trimmed ? parsed : trimmed
        }
        if (trimmed !== '') return trimmed
    }
    if (typeof rawEntryId === 'boolean') return String(rawEntryId)
    if (rawEntryId !== null) {
        return typeof rawEntryId === 'object' ? (JSON.stringify(rawEntryId) ?? 'invalid') : 'invalid'
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
    const numericEntryId = parsePositiveEntryId(entryObj, rawObj)
    const isUpdate = numericEntryId !== undefined
    const groupNameVal = getNonEmptyString(entryObj, rawObj, ['group_name', 'groupName'])
    const rawContent = getNonEmptyString(entryObj, rawObj, ['content', 'body']) ?? learnedVal ?? executionCode
    const explicitTitle = getNonEmptyString(entryObj, rawObj, ['title'])
    const titleVal = resolveTitle(entryObj, rawObj, executionCode, groupNameVal, learnedVal)
    const explicitType = getNonEmptyString(entryObj, rawObj, ['type', 'entry_type', 'category'])
    const tagsVal = collectTags(entryObj, rawObj, groupNameVal, learnedVal)
    const hasExplicitTags = entryObj['tags'] !== undefined || rawObj['tags'] !== undefined

    const { projVal, wsVal } = resolveCompatibleInheritedScope(
        isFlatCall ? {} : entryObj,
        rawObj
    )
    const sessVal = getNonEmptyString(entryObj, rawObj, ['session_id', 'sessionId'])
    const trustVal = normalizeUnitScore(
        entryObj['trust'] ?? rawObj['trust'] ?? entryObj['trust_score'] ?? rawObj['trust_score'] ??
        entryObj['trustScore'] ?? rawObj['trustScore'] ?? entryObj['confidence'] ?? rawObj['confidence']
    )
    const impactVal = normalizeUnitScore(
        entryObj['impact'] ?? rawObj['impact'] ?? entryObj['impact_score'] ?? rawObj['impact_score'] ??
        entryObj['impactScore'] ?? rawObj['impactScore']
    )
    const valStatus = normalizeValidation(getNonEmptyString(entryObj, rawObj, ['validation_status', 'validation', 'validationStatus']))
    const targetWsVal = getNonEmptyString(entryObj, rawObj, ['target_workspace_id', 'targetWorkspaceId'])

    const extraContext: Record<string, unknown> = {}
    for (const k of ['component', 'changes', 'pr_link', 'pr_url', 'issue_link', 'issue_url', 'details', 'notes', 'learned_context', 'group_name']) {
        if (entryObj[k] !== undefined) extraContext[k] = entryObj[k]
        else if (rawObj[k] !== undefined) extraContext[k] = rawObj[k]
    }
    const rawAutoContext =
        entryObj['auto_context'] !== undefined
            ? entryObj['auto_context']
            : entryObj['autoContext'] !== undefined
              ? entryObj['autoContext']
              : rawObj['auto_context'] !== undefined
                ? rawObj['auto_context']
                : rawObj['autoContext']

    const payload: Record<string, unknown> = { content: rawContent }
    if (!isUpdate || explicitTitle !== undefined) payload['title'] = titleVal
    if (explicitType !== undefined) {
        payload['entry_type'] = explicitType
    } else if (!isUpdate) {
        payload['entry_type'] = learnedVal !== undefined ? 'personal_reflection' : 'technical_note'
    }
    if (!isUpdate || hasExplicitTags || tagsVal.length > 0) payload['tags'] = tagsVal
    if (numericEntryId !== undefined) payload['entry_id'] = numericEntryId
    if (projVal !== undefined) payload['project_number'] = projVal
    if (wsVal !== undefined) payload['workspace_id'] = wsVal
    if (targetWsVal !== undefined) payload['target_workspace_id'] = targetWsVal
    if (sessVal !== undefined) payload['session_id'] = sessVal
    if (trustVal !== undefined) payload['trust_score'] = trustVal
    if (impactVal !== undefined) payload['impact_score'] = impactVal
    if (valStatus !== undefined) payload['validation_status'] = valStatus
    assignMergedAutoContext(payload, rawAutoContext, extraContext, isUpdate)

    const fnName = isUpdate ? 'mj.updateEntry' : 'mj.createEntry'
    appendSharedEntryFlags(payload, entryObj, rawObj)
    return `return await ${fnName}(${JSON.stringify(payload)});`
}

function assignMergedAutoContext(
    payload: Record<string, unknown>,
    rawAutoContext: unknown,
    extraContext: Record<string, unknown>,
    isUpdate: boolean
): void {
    const hasExtra = Object.keys(extraContext).length > 0
    if (rawAutoContext === null) {
        if (isUpdate) payload['auto_context'] = null
        else if (hasExtra) payload['auto_context'] = extraContext
        return
    }
    if (isRecord(rawAutoContext)) {
        payload['auto_context'] = hasExtra ? { ...extraContext, ...rawAutoContext } : rawAutoContext
        return
    }
    if (typeof rawAutoContext === 'string' && rawAutoContext.trim() !== '') {
        payload['auto_context'] = rawAutoContext
        return
    }
    if (hasExtra) payload['auto_context'] = extraContext
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
    const sourceIsSelector = isDbSourceSelector(rawObj) || isDbSourceSelector(input)
    const hasExplicitCode = JS_CODE_ALIAS_KEYS.some((key) => {
        if (key === 'source' && sourceIsSelector) return false
        const val = input[key]
        return typeof val === 'string' && val.trim().length > 0
    })
    const looksLikeJsStatement = (): boolean =>
        (/\bmj\s*\./.test(executionCode) ||
            /^\s*(?:return|const|let|var|await|async|for|while|if|try|function)\b/.test(executionCode)) &&
        isValidJsScript(executionCode)
    const isExplicitJsCode =
        (hasExplicitCode || looksLikeJsStatement()) && !isNaturalLanguagePrompt(executionCode)
    const looksLikeSqlQuery =
        /^(?:SELECT|INSERT|UPDATE|DELETE|PRAGMA|SHOW|DESCRIBE|EXPLAIN|WITH|SCHEMA|TABLES)\b/i.test(
            executionCode.trim()
        )
    const hasExplicitContent = typeof rawObj['content'] === 'string' || typeof rawObj['body'] === 'string'

    const entryKeys = isFlatCall ? ENTRY_KEYS : NESTED_ENTRY_KEYS
    const hasEntryFields = entryKeys.some((k) => entryObj[k] !== undefined || (!isFlatCall && rawObj[k] !== undefined))
    const learnedVal = getNonEmptyString(entryObj, rawObj, ['learned_context', 'learnedContext', 'lesson', 'insight', 'knowledge', 'rule'])
    if (
        isExplicitJsCode ||
        hasStructuredDiscriminator(entryObj) ||
        hasStructuredDiscriminator(rawObj) ||
        (looksLikeSqlQuery && !hasExplicitContent) ||
        (!hasEntryFields && learnedVal === undefined && !isNaturalLanguagePrompt(executionCode))
    ) {
        return executionCode
    }

    return buildSynthesizedEntryPayload(executionCode, entryObj, rawObj, isFlatCall, learnedVal)
}

function firstDefined(
    entryObj: Record<string, unknown>,
    secondaryObj: Record<string, unknown>,
    snake: string,
    camel: string
): unknown {
    if (entryObj[snake] !== undefined) return entryObj[snake]
    if (entryObj[camel] !== undefined) return entryObj[camel]
    if (secondaryObj[snake] !== undefined) return secondaryObj[snake]
    return secondaryObj[camel]
}

/** Forward optional entry classification, scope flags, relationships, and anchors uniformly. */
export function appendSharedEntryFlags(
    payload: Record<string, unknown>,
    entryObj: Record<string, unknown>,
    secondaryObj: Record<string, unknown>
): void {
    const rawSig = firstDefined(entryObj, secondaryObj, 'significance_type', 'significanceType')
    if (rawSig === null && payload['entry_id'] !== undefined) payload['significance_type'] = null
    else if (typeof rawSig === 'string' && rawSig.trim().length > 0) payload['significance_type'] = rawSig
    const targetWs = getNonEmptyString(entryObj, secondaryObj, ['target_workspace_id', 'targetWorkspaceId'])
    if (targetWs !== undefined) payload['target_workspace_id'] = targetWs
    const isPersonal = firstDefined(entryObj, secondaryObj, 'is_personal', 'isPersonal')
    if (typeof isPersonal === 'boolean') payload['is_personal'] = isPersonal
    const shareTeam = firstDefined(entryObj, secondaryObj, 'share_with_team', 'shareWithTeam')
    if (typeof shareTeam === 'boolean') payload['share_with_team'] = shareTeam
    if (firstDefined(entryObj, secondaryObj, 'use_test_db', 'useTestDb') === true) payload['use_test_db'] = true
    const rels = Array.isArray(entryObj['relationships']) ? entryObj['relationships'] : Array.isArray(secondaryObj['relationships']) ? secondaryObj['relationships'] : undefined
    if (rels !== undefined) payload['relationships'] = rels
    const anchors = Array.isArray(entryObj['anchors']) ? entryObj['anchors'] : Array.isArray(secondaryObj['anchors']) ? secondaryObj['anchors'] : undefined
    if (anchors !== undefined) payload['anchors'] = anchors
    const rawExpectedVer = firstDefined(entryObj, secondaryObj, 'expected_version', 'expectedVersion')
    if (rawExpectedVer !== undefined) {
        payload['expected_version'] = typeof rawExpectedVer === 'string' ? (parseCanonicalPositiveInt(rawExpectedVer.trim()) ?? rawExpectedVer) : rawExpectedVer
    }
    const isArchived = firstDefined(entryObj, secondaryObj, 'is_archived', 'isArchived')
    if (typeof isArchived === 'boolean') payload['is_archived'] = isArchived
    const autoLink = firstDefined(entryObj, secondaryObj, 'auto_link', 'autoLink')
    if (typeof autoLink === 'boolean') payload['auto_link'] = autoLink
}
