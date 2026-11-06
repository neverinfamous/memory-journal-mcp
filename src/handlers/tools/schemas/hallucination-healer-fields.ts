/**
 * Title and auto_context healers used by the shared hallucination healer.
 */

import { logger } from '../../../utils/logger.js'
import { safeString } from './constants-and-primitives.js'

/** Fold title/heading/subject/name aliases into the content as a markdown heading. */
function healTitleField(obj: Record<string, unknown>): boolean {
    let modified = false

    if ('title' in obj || 'heading' in obj || 'subject' in obj || 'name' in obj) {
        const rawTitle = obj['title'] ?? obj['heading'] ?? obj['subject'] ?? obj['name']
        if (rawTitle !== undefined && rawTitle !== null) {
            const titleStr = safeString(rawTitle).trim()
            if (titleStr !== '') {
                const cleanTitle = titleStr.replace(/^#+\s*/, '')
                const currentContent = safeString(obj['content']).trim()
                if (
                    !('content' in obj) ||
                    obj['content'] === undefined ||
                    obj['content'] === null ||
                    currentContent === ''
                ) {
                    if (!('query' in obj)) obj['content'] = `# ${cleanTitle}`
                } else if (!currentContent.startsWith(`# ${cleanTitle}`)) {
                    obj['content'] = `# ${cleanTitle}\n\n${currentContent}`
                }
            }
        }
        delete obj['title']
        delete obj['heading']
        delete obj['subject']
        delete obj['name']
        modified = true
    }

    return modified
}

/** Normalise object-valued or single-quoted `auto_context` into a JSON string (or drop empties). */
function healAutoContextField(obj: Record<string, unknown>): boolean {
    let modified = false

    if ('auto_context' in obj) {
        if (typeof obj['auto_context'] === 'object' && obj['auto_context'] !== null) {
            try {
                obj['auto_context'] = JSON.stringify(obj['auto_context'])
                modified = true
            } catch (err) {
                logger.debug('Could not stringify auto_context object', {
                    module: 'HallucinationHealer',
                    error: err instanceof Error ? err.message : String(err),
                })
            }
        }
        if (typeof obj['auto_context'] === 'string') {
            const ac = obj['auto_context'].trim().toLowerCase()
            if (ac === 'none' || ac === '{}' || ac === '{"commits":[]}') {
                delete obj['auto_context']
                modified = true
            } else if (ac.startsWith('{') && ac.includes("'")) {
                try {
                    JSON.parse(obj['auto_context'])
                } catch {
                    try {
                        const fixed = obj['auto_context'].replace(/'/g, '"')
                        const parsed = JSON.parse(fixed) as Record<string, unknown>
                        obj['auto_context'] = JSON.stringify(parsed)
                        modified = true
                    } catch (err) {
                        logger.debug('Could not repair single-quoted auto_context JSON', {
                            module: 'HallucinationHealer',
                            error: err instanceof Error ? err.message : String(err),
                        })
                    }
                }
            }
        }
    }

    return modified
}

export function healTitleAndAutoContext(obj: Record<string, unknown>): boolean {
    const titleModified = healTitleField(obj)
    const autoContextModified = healAutoContextField(obj)
    return titleModified || autoContextModified
}
