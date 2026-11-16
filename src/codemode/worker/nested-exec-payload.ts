/**
 * Nested Code Mode payload extraction and natural-language synthesis helpers.
 * Worker-thread safe (no host DB, config-file, or external npm imports).
 */

import * as vm from 'node:vm'

/**
 * Extracts executable JS code from nested `executeCode` arguments, returning `null`
 * only when explicit entry fields (`content`, `text`, `description`, `title`) indicate an entry payload.
 */
export function readExecutableCode(arg: unknown): string | null {
    if (typeof arg === 'string') return arg
    if (typeof arg !== 'object' || arg === null || Array.isArray(arg)) return ''
    const codeProp = Reflect.get(arg, 'code') as unknown
    const scriptProp = Reflect.get(arg, 'script') as unknown
    const codeToExec =
        typeof codeProp === 'string'
            ? codeProp
            : typeof scriptProp === 'string'
              ? scriptProp
              : ''
    if (codeToExec !== '') return codeToExec
    const queryProp = Reflect.get(arg, 'query') as unknown
    if (typeof queryProp === 'string' && queryProp.trim() !== '') {
        return queryProp
    }
    const hasEntryText =
        typeof Reflect.get(arg, 'content') === 'string' ||
        typeof Reflect.get(arg, 'text') === 'string' ||
        typeof Reflect.get(arg, 'description') === 'string' ||
        typeof Reflect.get(arg, 'title') === 'string'
    return hasEntryText ? null : ''
}

export function isSyntacticallyValidJs(trimmed: string): boolean {
    if (trimmed === '' || /^[A-Za-z_$][\w$]*$/.test(trimmed)) return false
    if (/^[A-Za-z0-9_-]+:\s+/.test(trimmed) && !/[(.=[\];]/.test(trimmed)) return false
    try {
        new vm.Script(trimmed)
        return true
    } catch {
        if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
            try {
                new vm.Script(`(${trimmed})`)
                return true
            } catch {
                return false
            }
        }
        return false
    }
}

/**
 * Extracts a nested `{ query: "..." }` search request when no explicit `code`/`script`
 * is present and the `query` text is not valid JS code.
 */
export function readNestedQuerySearch(
    arg: unknown
): { query: string; workspace_id?: string; project_number?: number; limit?: number } | undefined {
    if (typeof arg !== 'object' || arg === null || Array.isArray(arg)) return undefined
    const codeProp = Reflect.get(arg, 'code') as unknown
    const scriptProp = Reflect.get(arg, 'script') as unknown
    if (typeof codeProp === 'string' && codeProp.trim() !== '') return undefined
    if (typeof scriptProp === 'string' && scriptProp.trim() !== '') return undefined
    const queryProp = Reflect.get(arg, 'query') as unknown
    if (typeof queryProp !== 'string' || queryProp.trim() === '') return undefined
    if (isSyntacticallyValidJs(queryProp.trim())) return undefined

    const searchPayload: { query: string; workspace_id?: string; project_number?: number; limit?: number } = {
        query: queryProp,
    }
    const wsProp = Reflect.get(arg, 'workspace_id') as unknown
    if (typeof wsProp === 'string' && wsProp.trim() !== '') {
        searchPayload.workspace_id = wsProp.trim()
    }
    const projProp = Reflect.get(arg, 'project_number') as unknown
    if (typeof projProp === 'number' && Number.isInteger(projProp) && projProp > 0) {
        searchPayload.project_number = projProp
    }
    const limitProp = Reflect.get(arg, 'limit') as unknown
    if (typeof limitProp === 'number' && Number.isInteger(limitProp) && limitProp > 0) {
        searchPayload.limit = limitProp
    }
    return searchPayload
}

/**
 * Converts a plain natural-language prompt passed into nested `executeCode` into a technical note payload.
 */
export function naturalLanguageEntry(
    codeToExec: string
): { title: string; content: string; entry_type: string } | undefined {
    const trimmed = codeToExec.trim()
    if (isSyntacticallyValidJs(trimmed)) return undefined
    const isNaturalPrompt =
        /^(?:write|document|create|include|record|summary|log|add|added|note|task|fix|implement)\b/i.test(
            trimmed
        ) &&
        !/\b(const|let|var|function|return|await|async|for|if|try|while|switch|throw|class|import|export)\b|\bmj\./.test(
            trimmed
        )
    const looksLikeCode = /[{}()=]/.test(trimmed)
    if (
        looksLikeCode ||
        !(isNaturalPrompt || /^(?:create|add|new|record|log)?\s*entry\b/i.test(trimmed))
    ) {
        return undefined
    }
    const firstLine = (trimmed.split('\n')[0] ?? '')
        .replace(/^(?:create|add|new|record|log|insert)?\s*entry\s*(?:for|:)?\s*/i, '')
        .replace(/[:.]+$/, '')
        .trim()
    const title = firstLine.length > 0 && firstLine.length < 80 ? firstLine : 'Journal Entry'
    return { title, content: trimmed, entry_type: 'technical_note' }
}
