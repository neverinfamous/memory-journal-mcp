/**
 * Structured JSON payload recovery for Code Mode.
 * Split out of extractAndRecoverJsonCode so each step stays under 80 lines.
 */

import { isRecord } from '../../../codemode/normalizers/shared-utils.js'
import { loadProjectRegistryFromConfig } from '../../../utils/workspace-resolver.js'

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

    const target = unwrapPayloadTarget(parsed)
    const toolCall = recoverNamedToolCall(target, parsed)
    if (toolCall !== null) return toolCall
    const searchCall = recoverSearchCall(target, parsed)
    if (searchCall !== null) return searchCall
    return recoverEntryMutation(parsed, target)
}

function unwrapPayloadTarget(parsed: Record<string, unknown>): Record<string, unknown> {
    if (isRecord(parsed['payload'])) return parsed['payload']
    if (isRecord(parsed['entry'])) return parsed['entry']
    if (isRecord(parsed['input'])) return parsed['input']
    return parsed
}

/** [BOUNDARY] Only plain `[mj.]group.method` identifiers may be spliced into recovered code. */
const SAFE_TOOL_IDENTIFIER = /^(?:mj[._])?[A-Za-z_][\w]*(?:\.[A-Za-z_][\w]*)?$/

function recoverNamedToolCall(target: Record<string, unknown>, original: Record<string, unknown>): string | null {
    const toolName =
        typeof target['tool'] === 'string'
            ? target['tool']
            : typeof target['method'] === 'string'
              ? target['method']
              : typeof target['function'] === 'string'
                ? target['function']
                : undefined
    if (toolName === undefined || toolName === '') return null
    if (!SAFE_TOOL_IDENTIFIER.test(toolName)) return null
    const toolParams: Record<string, unknown> = isRecord(target['params'])
        ? { ...target['params'] }
        : isRecord(target['args'])
          ? { ...target['args'] }
          : {}
    assignMissingScope(toolParams, target)
    if (original !== target) assignMissingScope(toolParams, original)
    const cleanTool = toolName.replace(/^mj[._]/, '')
    return `return await (mj.${cleanTool} || mj.core.${cleanTool})(${JSON.stringify(toolParams)});`
}

function assignMissingScope(params: Record<string, unknown>, source: Record<string, unknown>): void {
    if (params['workspace_id'] === undefined && params['workspaceId'] === undefined) {
        const wsId = readWorkspaceId(source)
        if (wsId !== undefined) params['workspace_id'] = wsId
    }
    if (params['project_number'] === undefined && params['projectNumber'] === undefined) {
        const projNum = readProjectNumber(source)
        if (projNum !== undefined) params['project_number'] = projNum
    }
}

function readProjectNumber(target: Record<string, unknown>): number | undefined {
    const raw = target['project_number'] ?? target['projectNumber']
    if (typeof raw === 'number' && !Number.isNaN(raw)) return raw
    if (typeof raw === 'string' && raw.trim() !== '') {
        const num = Number(raw.trim().replace(/^p-?/i, ''))
        if (!Number.isNaN(num)) return num
    }
    return undefined
}

function readWorkspaceId(target: Record<string, unknown>): string | undefined {
    const raw = target['workspace_id'] ?? target['workspaceId']
    if (typeof raw === 'string' && raw.trim() !== '') return raw.trim()
    return resolveRepoWorkspace(target['repo'])
}

/** Maps a `repo` / `owner/repo` value onto a registered workspace key; never copies it verbatim. */
export function resolveRepoWorkspace(repo: unknown): string | undefined {
    if (typeof repo !== 'string' || repo.trim() === '') return undefined
    const name = repo.trim().split('/').pop()?.toLowerCase() ?? ''
    if (name === '') return undefined
    const registry = loadProjectRegistryFromConfig()
    if (registry === undefined) return undefined
    return Object.keys(registry).find((key) => key.toLowerCase() === name)
}

function recoverSearchCall(target: Record<string, unknown>, original: Record<string, unknown>): string | null {
    const isSearchAction =
        target['action'] === 'search' || target['operation'] === 'search' || target['op'] === 'search'
    const looksLikeQuery =
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
    if (typeof target['limit'] === 'number') searchParams['limit'] = target['limit']
    const projNum = readProjectNumber(target) ?? readProjectNumber(original)
    if (projNum !== undefined) searchParams['project_number'] = projNum
    const wsId = readWorkspaceId(target) ?? readWorkspaceId(original)
    if (wsId !== undefined) searchParams['workspace_id'] = wsId
    return `return await mj.search.searchEntries(${JSON.stringify(searchParams)});`
}

function readEntryId(target: Record<string, unknown>): number | undefined {
    if (typeof target['entry_id'] === 'number') return target['entry_id']
    if (typeof target['id'] === 'number') return target['id']
    if (typeof target['entry_id'] === 'string' && !Number.isNaN(Number(target['entry_id']))) {
        return Number(target['entry_id'])
    }
    return undefined
}

function readOperation(target: Record<string, unknown>): string {
    if (typeof target['operation'] === 'string') return target['operation']
    if (typeof target['op'] === 'string') return target['op']
    if (typeof target['action'] === 'string') return target['action']
    return ''
}

function recoverEntryMutation(
    original: Record<string, unknown>,
    target: Record<string, unknown>,
): string | null {
    const entryId = readEntryId(target)
    const op = readOperation(target)
    if ((op === 'delete' || op === 'delete_entry') && entryId !== undefined) {
        const deleteParams: Record<string, unknown> = { entry_id: entryId }
        const wsId = readWorkspaceId(target) ?? readWorkspaceId(original)
        if (wsId !== undefined) deleteParams['workspace_id'] = wsId
        const projNum = readProjectNumber(target) ?? readProjectNumber(original)
        if (projNum !== undefined) deleteParams['project_number'] = projNum
        return `return await mj.admin.deleteEntry(${JSON.stringify(deleteParams)});`
    }
    const signals = readPayloadSignals(target, op)
    if (!hasJournalFields(signals) && entryId !== undefined) {
        return formatGetEntryById(entryId, target, original)
    }
    if (!hasJournalFields(signals)) return null

    const entryParams = buildEntryParams(target, signals)
    if (readWorkspaceId(target) === undefined) {
        const wsId = readWorkspaceId(original)
        if (wsId !== undefined) entryParams['workspace_id'] = wsId
    }
    if (readProjectNumber(target) === undefined) {
        const projNum = readProjectNumber(original)
        if (projNum !== undefined) entryParams['project_number'] = projNum
    }
    const isUpdate = op === 'update_entry' || op === 'update' || (entryId !== undefined && !signals.hasOp)
    const content = entryParams['content']
    if (!isUpdate && (typeof content !== 'string' || content.trim() === '')) return null
    if (isUpdate && entryId !== undefined) {
        entryParams['entry_id'] = entryId
        return `return await mj.admin.updateEntry(${JSON.stringify(entryParams)});`
    }
    return `return await mj.core.createEntry(${JSON.stringify(entryParams)});`
}

function formatGetEntryById(
    entryId: number,
    target: Record<string, unknown>,
    original: Record<string, unknown>,
): string {
    const params: Record<string, unknown> = { entry_id: entryId }
    const wsId = readWorkspaceId(target) ?? readWorkspaceId(original)
    if (wsId !== undefined) params['workspace_id'] = wsId
    const projNum = readProjectNumber(target) ?? readProjectNumber(original)
    if (projNum !== undefined) params['project_number'] = projNum
    if (wsId === undefined && projNum === undefined) {
        return `return await mj.core.getEntryById({ entry_id: ${entryId} });`
    }
    return `return await mj.core.getEntryById(${JSON.stringify(params)});`
}

function readPayloadSignals(target: Record<string, unknown>, op: string): PayloadSignals {
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
            typeof target['type'] === 'string' ||
            typeof target['entry_type'] === 'string' ||
            typeof target['category'] === 'string',
        hasOp:
            op === 'create_entry' ||
            op === 'add_entry' ||
            op === 'create' ||
            op === 'update_entry' ||
            op === 'update',
    }
}

function hasJournalFields(signals: PayloadSignals): boolean {
    return (
        signals.hasContent ||
        signals.hasNotes ||
        signals.hasChanges ||
        signals.hasTask ||
        signals.hasTitle ||
        signals.hasSummary ||
        signals.hasDescription ||
        signals.hasFindings ||
        signals.hasDetails
    )
}

function buildEntryParams(
    target: Record<string, unknown>,
    signals: PayloadSignals,
): Record<string, unknown> {
    const entryParams: Record<string, unknown> = {
        title: resolveTitle(target, signals),
        content: collectContent(target, signals),
        entry_type: resolveEntryType(target),
        tags: collectTags(target),
    }
    const autoContext = collectAutoContext(target)
    if (Object.keys(autoContext).length > 0) entryParams['auto_context'] = autoContext
    copyOptionalEntryFields(target, entryParams)
    return entryParams
}

function collectContent(target: Record<string, unknown>, signals: PayloadSignals): string {
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
    if (finalContent === '' && (signals.hasTask || signals.hasTitle)) {
        finalContent = String(target['task'] ?? target['title'])
    }
    return finalContent
}

function appendLabeledSection(
    sections: string[],
    value: unknown,
    present: boolean,
    label: string,
): void {
    if (!present) return
    if (Array.isArray(value)) {
        const list = value.map((item) => `- ${String(item)}`).join('\n')
        sections.push(`**${label}:**\n${list}`)
        return
    }
    sections.push(`**${label}:**\n${String(value).trim()}`)
}

function resolveTitle(target: Record<string, unknown>, signals: PayloadSignals): string {
    if (signals.hasTitle) return String(target['title']).trim()
    if (signals.hasTask) return String(target['task']).trim()
    if (signals.hasSummary) return String(target['summary']).trim().slice(0, 80)
    return 'Journal Entry'
}

function resolveEntryType(target: Record<string, unknown>): string {
    const rawType = target['entry_type'] ?? target['type'] ?? target['category']
    if (typeof rawType !== 'string') return 'technical_decision'
    const low = rawType.toLowerCase()
    if (low === 'code' || low === 'coding' || low === 'technical' || low === 'task') {
        return 'technical_decision'
    }
    return low
}

function collectTags(target: Record<string, unknown>): string[] {
    const tags: string[] = []
    if (Array.isArray(target['tags'])) {
        for (const t of target['tags']) {
            if (typeof t === 'string' && t.trim().length > 0 && !tags.includes(t.trim())) tags.push(t.trim())
        }
    } else if (typeof target['tags'] === 'string') {
        for (const t of target['tags'].split(',')) {
            const trimmedTag = t.trim()
            if (trimmedTag.length > 0 && !tags.includes(trimmedTag)) tags.push(trimmedTag)
        }
    }
    if (
        typeof target['project'] === 'string' &&
        target['project'].trim().length > 0 &&
        !tags.includes(target['project'].trim())
    ) {
        tags.push(target['project'].trim())
    }
    return tags
}

function collectAutoContext(target: Record<string, unknown>): Record<string, unknown> {
    const autoContext: Record<string, unknown> = {}
    for (const key of [
        'task',
        'status',
        'changes',
        'notes',
        'details',
        'action',
        'component',
        'pr_link',
        'issue_link',
        'validation_status',
    ]) {
        if (target[key] !== undefined) autoContext[key] = target[key]
    }
    return autoContext
}

function copyOptionalEntryFields(
    target: Record<string, unknown>,
    entryParams: Record<string, unknown>,
): void {
    const wsId = readWorkspaceId(target)
    if (wsId !== undefined) entryParams['workspace_id'] = wsId
    const sessId = target['session_id'] ?? target['sessionId']
    if (typeof sessId === 'string') entryParams['session_id'] = sessId
    const projNum = readProjectNumber(target)
    if (projNum !== undefined) entryParams['project_number'] = projNum
    if (typeof target['impact'] === 'number') entryParams['impact'] = target['impact']
    if (typeof target['trust'] === 'number') entryParams['trust'] = target['trust']
    if (typeof target['validation_status'] === 'string') {
        entryParams['validation_status'] = target['validation_status']
    }
}
