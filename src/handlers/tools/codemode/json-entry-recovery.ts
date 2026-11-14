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
    const isStrictUpdate =
        /\b(?:updateEntry|teamUpdateEntry|update_entry|team_update_entry)\b/i.test(code)
    const isLegacyUpdateAlias = !isStrictUpdate && /\bupdateMemory\b/i.test(code)
    const isUpdate =
        isStrictUpdate || (isLegacyUpdateAlias && /\b(?:entry_id|id)\s*:\s*\d+/i.test(code))
    const isTeamCall = /\b(?:teamCreateEntry|teamUpdateEntry|team_create_entry|team_update_entry)\b/i.test(code)

    if (!isCreate && !isStrictUpdate && !isLegacyUpdateAlias) return null

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
        /\btitle\s*:\s*[`'"]([\s\S]*?)[`'"](?=\s*(?:,\s*[a-zA-Z_$][\w$]*\s*:|\s*,\s*\}|\s*\}|\s*\)))/i.exec(scanCode) ??
        /\btitle\s*:\s*['"]([^'"]+)['"]/i.exec(scanCode)
    const projectMatch =
        /\b(?:project_number|projectNumber|project_id|projectId|project_name|projectName|project)\s*:\s*(?:(\d+)|(['"`])([^'"`]+)\2)/i.exec(scanCode)
    const workspaceMatch = /\b(?:workspace_id|workspaceId|workspace)\s*:\s*(['"`])([^'"`]+)\1/i.exec(scanCode)
    const sessionMatch = /\b(?:session_id|sessionId)\s*:\s*(['"`])([^'"`]+)\1/i.exec(scanCode)
    const impactMatch = /\b(?:impact_score|impactScore|impact)\s*:\s*([0-9.]+)/i.exec(scanCode)
    const trustMatch = /\b(?:trust_score|trustScore|trust)\s*:\s*([0-9.]+)/i.exec(scanCode)
    const validationMatch = /\b(?:validation_status|validationStatus)\s*:\s*(['"`])([^'"`]+)\1/i.exec(scanCode)
    const sigMatch = /\b(?:significance_type|significanceType)\s*:\s*(['"`])([^'"`]+)\1/i.exec(scanCode)
    const isPersonalMatch = /\b(?:is_personal|isPersonal)\s*:\s*(true|false)\b/i.exec(scanCode)
    const shareTeamMatch = /\b(?:share_with_team|shareWithTeam)\s*:\s*(true|false)\b/i.exec(scanCode)
    const relationshipsMatch = /\brelationships\s*:\s*(\[[\s\S]*?\])/i.exec(scanCode)
    const anchorsMatch = /\banchors\s*:\s*(\[[\s\S]*?\])/i.exec(scanCode)
    const tagsMatch = /\btags\s*:\s*\[([\s\S]*?)\]/i.exec(scanCode)
    const autoContextMatch = /\bauto_context\s*:\s*(\{[\s\S]*?\})(?=\s*,\s*\n|\s*\n\s*\})/i.exec(scanCode)

    const payload: Record<string, unknown> = {
        content,
        entry_type: typeMatch?.[1] ?? 'technical_note',
    }

    const title = titleMatch?.[1]?.replace(/\\+'/g, "'").replace(/\\+"/g, '"').replace(/\\`/g, '`')
    if (title !== undefined && title !== '') payload['title'] = title

    const entryIdMatch = /\b(?:entry_id|id)\s*:\s*(\d+)/i.exec(scanCode)
    if (entryIdMatch?.[1] !== undefined) payload['entry_id'] = parseInt(entryIdMatch[1], 10)
    if (projectMatch?.[1] !== undefined) {
        payload['project_number'] = parseInt(projectMatch[1], 10)
    } else if (projectMatch?.[3] !== undefined && projectMatch[3].trim() !== '') {
        payload['project_number'] = projectMatch[3].trim()
    }
    if (workspaceMatch?.[2] !== undefined) payload['workspace_id'] = workspaceMatch[2]
    if (sessionMatch?.[2] !== undefined) payload['session_id'] = sessionMatch[2]
    if (impactMatch?.[1] !== undefined) payload['impact_score'] = parseFloat(impactMatch[1])
    if (trustMatch?.[1] !== undefined) payload['trust_score'] = parseFloat(trustMatch[1])
    if (validationMatch?.[2] !== undefined) payload['validation_status'] = validationMatch[2]
    if (sigMatch?.[2] !== undefined) payload['significance_type'] = sigMatch[2]
    if (isPersonalMatch?.[1] !== undefined) payload['is_personal'] = isPersonalMatch[1].toLowerCase() === 'true'
    if (shareTeamMatch?.[1] !== undefined) payload['share_with_team'] = shareTeamMatch[1].toLowerCase() === 'true'
    for (const [key, rawArr] of [
        ['relationships', relationshipsMatch?.[1]],
        ['anchors', anchorsMatch?.[1]],
    ] as const) {
        if (rawArr === undefined) continue
        try {
            const parsedArr: unknown = JSON.parse(rawArr)
            if (Array.isArray(parsedArr)) payload[key] = parsedArr
        } catch {
            try {
                const normalizedArr = rawArr
                    .replace(/'([^']*)'/g, '"$1"')
                    .replace(/([{,]\s*)([a-zA-Z0-9_$]+)\s*:/g, '$1"$2":')
                const parsedArr: unknown = JSON.parse(normalizedArr)
                if (Array.isArray(parsedArr)) payload[key] = parsedArr
            } catch {
                // Ignore unparseable literal arrays
            }
        }
    }

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

    const fnName = isUpdate
        ? (isTeamCall ? 'mj.team.teamUpdateEntry' : 'mj.updateEntry')
        : (isTeamCall ? 'mj.team.teamCreateEntry' : 'mj.createEntry')
    return `return await ${fnName}(${JSON.stringify(payload)});`
}
