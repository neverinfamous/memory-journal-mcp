/**
 * Structured JSON payload recovery for Code Mode.
 * Split out of extractAndRecoverJsonCode so each step stays under 80 lines.
 */

import { appendOptionalQuerySearchFields } from '../../../codemode/shared-context-parsers.js'
import { isRecord } from '../../../codemode/normalizers/shared-utils.js'
import {
    assignMissingScope,
    firstDefinedAlias,
    hasStructuredDiscriminator,
    hasUseTestDbFlag,
    readEntryIdField,
    readProjectNumber,
    readWorkspaceId,
    resolveCompatibleInheritedScope,
    resolveRepoWorkspace,
    STRUCTURED_DISCRIMINATOR_KEYS,
} from './json-entry-scope.js'

export { hasStructuredDiscriminator, resolveRepoWorkspace, STRUCTURED_DISCRIMINATOR_KEYS }

interface PayloadSignals {
    hasContent: boolean
    hasNotes: boolean
    hasChanges: boolean
    hasTask: boolean
    hasTitle: boolean
    hasSummary: boolean
    hasDescription: boolean
    hasFindings: boolean
    hasDetails: boolean
    hasStatus: boolean
    hasType: boolean
    hasOp: boolean
}

/** Recover executable JS directly from an already-parsed structured record. */
export function recoverStructuredRecord(parsed: Record<string, unknown>): string | null {
    const target = unwrapPayloadTarget(parsed)
    if (
        target['tool'] !== undefined ||
        target['method'] !== undefined ||
        target['function'] !== undefined ||
        parsed['tool'] !== undefined ||
        parsed['method'] !== undefined ||
        parsed['function'] !== undefined
    ) {
        return recoverNamedToolCall(target, parsed)
    }
    const searchCall = recoverSearchCall(target, parsed)
    if (searchCall !== null) return searchCall
    return recoverEntryMutation(parsed, target)
}

export function recoverStructuredJsonCode(code: string): string | null {
    if (!code || typeof code !== 'string') return null
    const trimmed = code.trim()
    if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return null

    let parsed: unknown
    try {
        parsed = JSON.parse(trimmed)
    } catch {
        return null
    }
    if (!isRecord(parsed)) return null

    return recoverStructuredRecord(parsed)
}

function unwrapPayloadTarget(parsed: Record<string, unknown>): Record<string, unknown> {
    if (isRecord(parsed['payload'])) return parsed['payload']
    if (isRecord(parsed['entry'])) return parsed['entry']
    if (isRecord(parsed['input'])) return parsed['input']
    return parsed
}

/** [BOUNDARY] Only plain `[mj.]group.method` identifiers may be spliced into recovered code. */
const SAFE_TOOL_IDENTIFIER = /^(?:mj[._])?[A-Za-z_][\w]*(?:\.[A-Za-z_][\w]*)?$/

function resolveNamedToolIdentifier(
    target: Record<string, unknown>,
    original: Record<string, unknown>
): string | undefined {
    const sources = original !== target ? [target, original] : [target]
    for (const rec of sources) {
        for (const key of ['tool', 'method', 'function'] as const) {
            const val = rec[key]
            if (typeof val === 'string') {
                if (val.trim() !== '') return val.trim()
                continue
            }
            if (val !== undefined) return undefined
        }
    }
    return undefined
}

function recoverNamedToolCall(target: Record<string, unknown>, original: Record<string, unknown>): string | null {
    const toolName = resolveNamedToolIdentifier(target, original)
    if (toolName === undefined || !SAFE_TOOL_IDENTIFIER.test(toolName)) return null
    const explicitParams = isRecord(target['params'])
        ? target['params']
        : isRecord(target['args'])
          ? target['args']
          : undefined
    const toolParams: Record<string, unknown> = explicitParams !== undefined ? { ...explicitParams } : {}
    if (explicitParams === undefined && original !== target) {
        for (const [k, v] of Object.entries(target)) {
            if (k !== 'tool' && k !== 'method' && k !== 'function' && k !== 'params' && k !== 'args' && v !== undefined) {
                toolParams[k] = v
            }
        }
    }
    assignMissingScope(toolParams, target, original)
    if (hasUseTestDbFlag(target, original)) toolParams['use_test_db'] = true
    const cleanTool = toolName.replace(/^mj[._]/, '')
    return `return await (mj.${cleanTool} || mj.core.${cleanTool})(${JSON.stringify(toolParams)});`
}

function recoverSearchCall(target: Record<string, unknown>, original: Record<string, unknown>): string | null {
    const rawOp = readOperation(target) || (original !== target ? readOperation(original) : '')
    const op = rawOp.trim().toLowerCase()
    const isSearchAction = op === 'search'
    const hasExplicitNonSearchDiscriminator =
        op !== '' || hasStructuredDiscriminator(target) || (original !== target && hasStructuredDiscriminator(original))
    const looksLikeQuery =
        !hasExplicitNonSearchDiscriminator &&
        typeof target['query'] === 'string' &&
        target['content'] === undefined &&
        target['notes'] === undefined &&
        target['changes'] === undefined &&
        target['task'] === undefined
    if (!isSearchAction && !looksLikeQuery) return null
    const queryStr =
        typeof target['query'] === 'string'
            ? target['query']
            : typeof target['search'] === 'string'
              ? target['search']
              : ''
    const searchParams: Record<string, unknown> = { query: queryStr }
    const mergedQuerySource: Record<string, unknown> = { ...original, ...target }
    appendOptionalQuerySearchFields(searchParams, mergedQuerySource, mergedQuerySource['limit'])
    const scope = resolveCompatibleInheritedScope(target, original)
    if (scope.projectNumber !== undefined) searchParams['project_number'] = scope.projectNumber
    if (scope.workspaceId !== undefined) searchParams['workspace_id'] = scope.workspaceId
    if (hasUseTestDbFlag(target, original)) searchParams['use_test_db'] = true
    return `return await mj.search.searchEntries(${JSON.stringify(searchParams)});`
}

function readOperation(target: Record<string, unknown>): string {
    if (typeof target['operation'] === 'string') return target['operation']
    if (typeof target['op'] === 'string') return target['op']
    if (typeof target['action'] === 'string') return target['action']
    return ''
}

const SUPPORTED_READ_BY_ID_OPS = new Set(['', 'get', 'read', 'get_entry', 'get_entry_by_id', 'team_get_entry_by_id'])
const SUPPORTED_ENTRY_MUTATION_OPS = new Set([
    'create_entry', 'add_entry', 'create', 'update_entry', 'update', 'team_create_entry', 'team_update_entry',
])
const UPDATE_META_KEYS = [
    'tags', 'significance_type', 'significanceType', 'validation_status', 'validationStatus',
    'impact_score', 'impactScore', 'impact', 'trust_score', 'trustScore', 'trust',
    'target_workspace_id', 'targetWorkspaceId', 'is_personal', 'isPersonal',
    'share_with_team', 'shareWithTeam', 'relationships', 'anchors',
] as const

function hasEntryUpdateMetadata(
    signals: PayloadSignals,
    target: Record<string, unknown>,
    original: Record<string, unknown>
): boolean {
    if (signals.hasType) return true
    return UPDATE_META_KEYS.some(
        (k) => target[k] !== undefined || (original !== target && original[k] !== undefined)
    )
}

function formatScopedMutationOp(
    fnPath: string,
    entryId: number | string,
    target: Record<string, unknown>,
    original: Record<string, unknown>
): string {
    const params: Record<string, unknown> = { entry_id: entryId }
    const scope = resolveCompatibleInheritedScope(target, original)
    if (scope.workspaceId !== undefined) params['workspace_id'] = scope.workspaceId
    if (scope.projectNumber !== undefined) params['project_number'] = scope.projectNumber
    if (hasUseTestDbFlag(target, original)) params['use_test_db'] = true
    if (
        fnPath === 'mj.core.getEntryById' &&
        scope.workspaceId === undefined &&
        scope.projectNumber === undefined &&
        params['use_test_db'] !== true
    ) {
        return `return await mj.core.getEntryById({ entry_id: ${JSON.stringify(entryId)} });`
    }
    return `return await ${fnPath}(${JSON.stringify(params)});`
}

function recoverEntryMutation(
    original: Record<string, unknown>,
    target: Record<string, unknown>,
): string | null {
    let idInfo = readEntryIdField(target)
    if (idInfo.entryId === undefined && idInfo.invalidExplicitEntryId === undefined && original !== target) {
        idInfo = readEntryIdField(original)
    }
    const { entryId, invalidExplicitEntryId } = idInfo
    const explicitIdForMutation = entryId ?? invalidExplicitEntryId
    const rawOp = readOperation(target) || (original !== target ? readOperation(original) : '')
    const op = rawOp.trim().toLowerCase()
    if (explicitIdForMutation !== undefined) {
        if (op === 'delete' || op === 'delete_entry') {
            return formatScopedMutationOp('mj.admin.deleteEntry', explicitIdForMutation, target, original)
        }
        if (op === 'team_delete_entry') {
            return formatScopedMutationOp('mj.team.teamDeleteEntry', explicitIdForMutation, target, original)
        }
        if (op === 'restore' || op === 'restore_entry') {
            return formatScopedMutationOp('mj.admin.restoreEntry', explicitIdForMutation, target, original)
        }
        if (op === 'team_restore_entry') {
            return formatScopedMutationOp('mj.team.teamRestoreEntry', explicitIdForMutation, target, original)
        }
    }
    const signals = readPayloadSignals(target, op, original)
    const canUpdateMeta =
        explicitIdForMutation !== undefined &&
        (op === '' || SUPPORTED_ENTRY_MUTATION_OPS.has(op)) &&
        hasEntryUpdateMetadata(signals, target, original)
    if (!hasJournalFields(signals) && !canUpdateMeta) {
        if (explicitIdForMutation === undefined || !SUPPORTED_READ_BY_ID_OPS.has(op)) return null
        const readFn = op === 'team_get_entry_by_id' ? 'mj.team.teamGetEntryById' : 'mj.core.getEntryById'
        return formatScopedMutationOp(readFn, explicitIdForMutation, target, original)
    }
    if (op !== '' && !SUPPORTED_ENTRY_MUTATION_OPS.has(op)) return null

    const isTeamOp = op === 'team_create_entry' || op === 'team_update_entry'
    const isUpdate =
        op === 'update_entry' ||
        op === 'update' ||
        op === 'team_update_entry' ||
        (explicitIdForMutation !== undefined && !signals.hasOp)
    const entryParams = buildEntryParams(target, signals, isUpdate, original)
    const scope = resolveCompatibleInheritedScope(target, original, true)
    if (entryParams['workspace_id'] === undefined && scope.workspaceId !== undefined) {
        entryParams['workspace_id'] = scope.workspaceId
    }
    if (entryParams['project_number'] === undefined && scope.projectNumber !== undefined) {
        entryParams['project_number'] = scope.projectNumber
    }
    const content = entryParams['content']
    if (!isUpdate && (typeof content !== 'string' || content.trim() === '')) return null
    if (isUpdate) {
        if (explicitIdForMutation !== undefined) entryParams['entry_id'] = explicitIdForMutation
        const updateFn = isTeamOp ? 'mj.team.teamUpdateEntry' : 'mj.admin.updateEntry'
        return `return await ${updateFn}(${JSON.stringify(entryParams)});`
    }
    const createFn = isTeamOp ? 'mj.team.teamCreateEntry' : 'mj.core.createEntry'
    return `return await ${createFn}(${JSON.stringify(entryParams)});`
}

function readPayloadSignals(
    target: Record<string, unknown>,
    op: string,
    original?: Record<string, unknown>
): PayloadSignals {
    const fb = original !== target ? original : undefined
    return {
        hasContent: typeof target['content'] === 'string' && target['content'].trim().length > 0,
        hasNotes: typeof target['notes'] === 'string' && target['notes'].trim().length > 0,
        hasChanges:
            (Array.isArray(target['changes']) && target['changes'].length > 0) ||
            (typeof target['changes'] === 'string' && target['changes'].trim().length > 0),
        hasTask: typeof target['task'] === 'string' && target['task'].trim().length > 0,
        hasTitle: typeof target['title'] === 'string' && target['title'].trim().length > 0,
        hasSummary: typeof target['summary'] === 'string' && target['summary'].trim().length > 0,
        hasDescription: typeof target['description'] === 'string' && target['description'].trim().length > 0,
        hasFindings:
            (Array.isArray(target['findings']) && target['findings'].length > 0) ||
            (typeof target['findings'] === 'string' && target['findings'].trim().length > 0),
        hasDetails: typeof target['details'] === 'string' && target['details'].trim().length > 0,
        hasStatus: typeof target['status'] === 'string' && target['status'].trim().length > 0,
        hasType:
            typeof firstDefinedAlias(target, fb, ['entry_type', 'type', 'category']) === 'string',
        hasOp: SUPPORTED_ENTRY_MUTATION_OPS.has(op),
    }
}

function hasJournalFields(signals: PayloadSignals): boolean {
    return (
        signals.hasContent || signals.hasNotes || signals.hasChanges ||
        signals.hasTask || signals.hasTitle || signals.hasSummary ||
        signals.hasDescription || signals.hasFindings || signals.hasDetails
    )
}

function buildEntryParams(
    target: Record<string, unknown>,
    signals: PayloadSignals,
    isUpdate = false,
    original?: Record<string, unknown>
): Record<string, unknown> {
    const fb = original !== target ? original : undefined
    const entryParams: Record<string, unknown> = {}
    if (!isUpdate || signals.hasTitle || signals.hasTask || signals.hasSummary) {
        entryParams['title'] = resolveTitle(target, signals)
    }
    const collectedContent = collectContent(target, signals, isUpdate)
    if (!isUpdate || collectedContent !== '') entryParams['content'] = collectedContent
    if (!isUpdate || signals.hasType) entryParams['entry_type'] = resolveEntryType(target, fb)
    if (!isUpdate || target['tags'] !== undefined || fb?.['tags'] !== undefined) {
        entryParams['tags'] = collectTags(target, fb)
    }
    const autoContext = collectAutoContext(target)
    if (Object.keys(autoContext).length > 0) entryParams['auto_context'] = autoContext
    copyOptionalEntryFields(target, entryParams, fb)
    return entryParams
}

function collectContent(target: Record<string, unknown>, signals: PayloadSignals, isUpdate = false): string {
    const contentSections: string[] = []
    if (signals.hasContent) contentSections.push(String(target['content']).trim())
    if (signals.hasNotes) contentSections.push(String(target['notes']).trim())
    if (
        signals.hasSummary &&
        target['summary'] !== target['title'] &&
        target['summary'] !== target['task']
    ) {
        contentSections.push(String(target['summary']).trim())
    }
    if (signals.hasDescription) contentSections.push(String(target['description']).trim())
    if (signals.hasDetails) contentSections.push(String(target['details']).trim())
    appendLabeledSection(contentSections, target['changes'], signals.hasChanges, 'Changes')
    appendLabeledSection(contentSections, target['findings'], signals.hasFindings, 'Findings')
    if (signals.hasStatus) contentSections.push(`**Status:** ${String(target['status']).trim()}`)

    let finalContent = contentSections.filter(Boolean).join('\n\n')
    if (!isUpdate && finalContent === '' && (signals.hasTask || signals.hasTitle)) {
        finalContent = String(target['task'] ?? target['title'])
    }
    return finalContent
}

function appendLabeledSection(sections: string[], value: unknown, present: boolean, label: string): void {
    if (!present) return
    if (Array.isArray(value)) {
        sections.push(`**${label}:**\n${value.map((item) => `- ${String(item)}`).join('\n')}`)
        return
    }
    sections.push(`**${label}:**\n${String(value).trim()}`)
}

function resolveTitle(target: Record<string, unknown>, signals: PayloadSignals): string {
    if (signals.hasTitle) return String(target['title']).trim()
    if (signals.hasTask) return String(target['task']).trim()
    return signals.hasSummary ? String(target['summary']).trim().slice(0, 80) : 'Journal Entry'
}

function resolveEntryType(target: Record<string, unknown>, fallback?: Record<string, unknown>): string {
    const rawType = firstDefinedAlias(target, fallback, ['entry_type', 'type', 'category'])
    if (typeof rawType !== 'string') return 'technical_note'
    const low = rawType.toLowerCase()
    return low === 'code' || low === 'coding' || low === 'technical' || low === 'task' ? 'technical_note' : low
}

function appendTagItems(tags: string[], rawTags: unknown): void {
    const items = Array.isArray(rawTags)
        ? rawTags.filter((t): t is string => typeof t === 'string')
        : typeof rawTags === 'string'
          ? rawTags.split(',')
          : []
    for (const rawItem of items) {
        const trimmedTag = rawItem.trim()
        if (trimmedTag.length > 0 && !tags.includes(trimmedTag)) tags.push(trimmedTag)
    }
}

function collectTags(target: Record<string, unknown>, fallback?: Record<string, unknown>): string[] {
    const tags: string[] = []
    appendTagItems(tags, target['tags'])
    if (fallback !== undefined) appendTagItems(tags, fallback['tags'])
    const projRaw = target['project'] ?? fallback?.['project']
    if (typeof projRaw === 'string' && projRaw.trim().length > 0 && !tags.includes(projRaw.trim())) {
        tags.push(projRaw.trim())
    }
    return tags
}

const AUTO_CONTEXT_FIELDS = [
    'task', 'status', 'changes', 'notes', 'details',
    'action', 'component', 'pr_link', 'issue_link', 'validation_status',
] as const

function collectAutoContext(target: Record<string, unknown>): Record<string, unknown> {
    const autoContext: Record<string, unknown> = {}
    for (const key of AUTO_CONTEXT_FIELDS) if (target[key] !== undefined) autoContext[key] = target[key]
    return autoContext
}

function copyOptionalEntryFields(
    target: Record<string, unknown>,
    entryParams: Record<string, unknown>,
    fallback?: Record<string, unknown>
): void {
    const wsId = readWorkspaceId(target)
    if (wsId !== undefined) entryParams['workspace_id'] = wsId
    const projNum = readProjectNumber(target)
    if (projNum !== undefined) entryParams['project_number'] = projNum
    for (const [outKey, aliases, nonBlank] of [
        ['target_workspace_id', ['target_workspace_id', 'targetWorkspaceId'], true],
        ['session_id', ['session_id', 'sessionId'], false],
        ['validation_status', ['validation_status', 'validationStatus'], false],
        ['significance_type', ['significance_type', 'significanceType'], false],
    ] as const) {
        const raw = firstDefinedAlias(target, fallback, aliases)
        if (typeof raw === 'string' && (!nonBlank || raw.trim() !== '')) {
            entryParams[outKey] = nonBlank ? raw.trim() : raw
        }
    }
    for (const [outKey, aliases] of [
        ['impact_score', ['impact_score', 'impactScore', 'impact']],
        ['trust_score', ['trust_score', 'trustScore', 'trust']],
    ] as const) {
        const raw = firstDefinedAlias(target, fallback, aliases)
        if (typeof raw === 'number') entryParams[outKey] = raw
    }
    for (const [outKey, aliases] of [
        ['is_personal', ['is_personal', 'isPersonal']],
        ['share_with_team', ['share_with_team', 'shareWithTeam']],
    ] as const) {
        const raw = firstDefinedAlias(target, fallback, aliases)
        if (typeof raw === 'boolean') entryParams[outKey] = raw
    }
    if (hasUseTestDbFlag(target, fallback)) entryParams['use_test_db'] = true
    for (const arrKey of ['relationships', 'anchors'] as const) {
        const raw = firstDefinedAlias(target, fallback, [arrKey])
        if (Array.isArray(raw)) entryParams[arrKey] = raw
    }
}
