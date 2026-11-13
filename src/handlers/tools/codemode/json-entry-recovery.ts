/**
 * JSON and Entry payload recovery helpers for Code Mode execution payloads.
 */

import { recoverStructuredJsonCode } from './json-entry-structured.js'

/**
 * Auto-heals raw JSON objects or stringified JSON passed as Code Mode execution payloads,
 * translating them into type-safe mj.* Code Mode API calls.
 */
export function extractAndRecoverJsonCode(code: string): string | null {
    return recoverStructuredJsonCode(code)
}

/**
 * Attempt fuzzy recovery of an entry creation or update call from broken/mangled code
 */
export function extractAndRecoverEntryCode(code: string): string | null {
    if (!code || typeof code !== 'string') return null

    const jsonRecovered = extractAndRecoverJsonCode(code)
    if (jsonRecovered !== null) return jsonRecovered

    const isCreate =
        /\b(?:createEntry|teamCreateEntry|appendEntry|create_entry|team_create_entry|addMemory|createMemory|saveMemory)\b/i.test(
            code
        )
    const isUpdate = /\b(?:updateEntry|teamUpdateEntry|update_entry|team_update_entry|updateMemory)\b/i.test(code)

    if (!isCreate && !isUpdate) return null

    const backtickMatch =
        /\bcontent\s*:\s*`([\s\S]*?)`(?=\s*(?:,\s*[a-zA-Z_$][\w$]*\s*:|\s*,\s*\}|\s*\}|\s*\)))/i.exec(code)
    const singleMatch =
        /\bcontent\s*:\s*'([\s\S]*?)'(?=\s*(?:,\s*[a-zA-Z_$][\w$]*\s*:|\s*,\s*\}|\s*\}|\s*\)))/i.exec(code)
    const doubleMatch =
        /\bcontent\s*:\s*"([\s\S]*?)"(?=\s*(?:,\s*[a-zA-Z_$][\w$]*\s*:|\s*,\s*\}|\s*\}|\s*\)))/i.exec(code)
    const fallbackMatch =
        /\bcontent\s*:\s*[`'"]([\s\S]*?)(?:[`'"]\s*)?(?=,\s*[a-zA-Z_$][\w$]*\s*:|\s*,\s*\}|\s*\}|\s*\))/i.exec(
            code
        )

    let content: string | undefined =
        backtickMatch?.[1] ?? singleMatch?.[1] ?? doubleMatch?.[1] ?? fallbackMatch?.[1]

    if (content === undefined) {
        const altMatch = /\bcontent\s*:\s*`([\s\S]*?)`(?=,\s*[\w$]+\s*:|\s*\})/i.exec(code)
        if (altMatch?.[1] !== undefined) content = altMatch[1]
    }

    if (content === undefined) {
        const descMatch =
            /\b(?:description|summary)\s*:\s*[`'"]([\s\S]*?)[`'"](?=\s*(?:,\s*[a-zA-Z_$][\w$]*\s*:|\s*,\s*\}|\s*\}|\s*\)))/i.exec(
                code
            )
        if (descMatch?.[1] !== undefined) content = descMatch[1]
    }

    if (content === undefined || content === '') return null

    // [C4] Field regexes scan the code with the content body removed, so `project: 5` or
    // `workspace_id: 'x'` text quoted inside the entry content can never re-scope the write.
    const scanCode = code.split(content).join('')
    content = content.replace(/\\+'/g, "'").replace(/\\+"/g, '"').replace(/\\`/g, '`')

    const typeMatch = /\b(?:entry_type|type)\s*:\s*['"]([^'"]+)['"]/i.exec(scanCode)
    const titleMatch =
        /\btitle\s*:\s*[`'"]([\s\S]*?)`['"](?=\s*(?:,\s*[a-zA-Z_$][\w$]*\s*:|\s*,\s*\}|\s*\}|\s*\)))/i.exec(scanCode) ??
        /\btitle\s*:\s*['"]([^'"]+)['"]/i.exec(scanCode)
    const projectMatch = /\b(?:project_number|projectNumber|project)\s*:\s*['"]?(\d+)['"]?/i.exec(scanCode)
    const workspaceMatch = /\b(?:workspace_id|workspaceId)\s*:\s*['"]([^'"]+)['"]/i.exec(scanCode)
    const sessionMatch = /\b(?:session_id|sessionId)\s*:\s*['"]([^'"]+)['"]/i.exec(scanCode)
    const impactMatch = /\bimpact\s*:\s*([0-9.]+)/i.exec(scanCode)
    const trustMatch = /\btrust\s*:\s*([0-9.]+)/i.exec(scanCode)
    const validationMatch = /\bvalidation_status\s*:\s*['"]([^'"]+)['"]/i.exec(scanCode)
    const tagsMatch = /\btags\s*:\s*\[([\s\S]*?)\]/i.exec(scanCode)
    const autoContextMatch = /\bauto_context\s*:\s*(\{[\s\S]*?\})(?=\s*,\s*\n|\s*\n\s*\})/i.exec(scanCode)

    const payload: Record<string, unknown> = {
        content,
        entry_type: typeMatch?.[1] ?? 'technical_decision',
    }

    const title = titleMatch?.[1]?.replace(/\\+'/g, "'").replace(/\\+"/g, '"').replace(/\\`/g, '`')
    if (title !== undefined && title !== '') payload['title'] = title

    const entryIdMatch = /\b(?:entry_id|id)\s*:\s*(\d+)/i.exec(scanCode)
    if (entryIdMatch?.[1] !== undefined) payload['entry_id'] = parseInt(entryIdMatch[1], 10)
    if (projectMatch?.[1] !== undefined) payload['project_number'] = parseInt(projectMatch[1], 10)
    if (workspaceMatch?.[1] !== undefined) payload['workspace_id'] = workspaceMatch[1]
    if (sessionMatch?.[1] !== undefined) payload['session_id'] = sessionMatch[1]
    if (impactMatch?.[1] !== undefined) payload['impact'] = parseFloat(impactMatch[1])
    if (trustMatch?.[1] !== undefined) payload['trust'] = parseFloat(trustMatch[1])
    if (validationMatch?.[1] !== undefined) payload['validation_status'] = validationMatch[1]

    const rawTags = tagsMatch?.[1]
    if (rawTags !== undefined) {
        try {
            payload['tags'] = rawTags
                .split(',')
                .map((s: string): string => s.trim().replace(/^['"]|['"]$/g, ''))
                .filter(Boolean)
        } catch {
            // Ignore tag parse error
        }
    }

    const rawAutoContext = autoContextMatch?.[1]
    if (rawAutoContext !== undefined) {
        try {
            payload['auto_context'] = JSON.parse(rawAutoContext)
        } catch {
            try {
                const normalizedJson = rawAutoContext.replace(/([{,]\s*)([a-zA-Z0-9_$]+)\s*:/g, '$1"$2":')
                payload['auto_context'] = JSON.parse(normalizedJson)
            } catch {
                // Ignore auto_context parse error
            }
        }
    }

    const fnName = isUpdate && payload['entry_id'] !== undefined ? 'mj.updateEntry' : 'mj.createEntry'
    return `return await ${fnName}(${JSON.stringify(payload)});`
}
