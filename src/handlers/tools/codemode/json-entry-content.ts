/**
 * Content, title, entry type, and tag synthesis helpers extracted from
 * `json-entry-structured.ts` to keep every Code Mode helper file well under 500 lines.
 */

import { firstDefinedAlias } from './json-entry-scope.js'

export interface PayloadSignals {
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

function appendLabeledSection(sections: string[], value: unknown, present: boolean, label: string): void {
    if (!present) return
    if (Array.isArray(value)) {
        sections.push(`**${label}:**\n${value.map((item) => `- ${String(item)}`).join('\n')}`)
        return
    }
    sections.push(`**${label}:**\n${String(value).trim()}`)
}

export function collectEntryContent(
    target: Record<string, unknown>,
    signals: PayloadSignals,
    isUpdate = false
): string {
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

export function resolveEntryTitle(target: Record<string, unknown>, signals: PayloadSignals): string {
    if (signals.hasTitle) return String(target['title']).trim()
    if (signals.hasTask) return String(target['task']).trim()
    return signals.hasSummary ? String(target['summary']).trim().slice(0, 80) : 'Journal Entry'
}

export function resolveEntryType(
    target: Record<string, unknown>,
    fallback?: Record<string, unknown>
): string {
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

export function collectEntryTags(
    target: Record<string, unknown>,
    fallback?: Record<string, unknown>
): string[] {
    const tags: string[] = []
    appendTagItems(tags, target['tags'])
    if (fallback !== undefined) appendTagItems(tags, fallback['tags'])
    const projRaw = target['project'] ?? fallback?.['project']
    if (typeof projRaw === 'string' && projRaw.trim().length > 0 && !tags.includes(projRaw.trim())) {
        tags.push(projRaw.trim())
    }
    return tags
}
