/**
 * JSON and Entry payload recovery helpers for Code Mode execution payloads.
 */

import { recoverStructuredJsonCode } from './json-entry-structured.js'
import { stripCommentsAndStrings } from '../../../codemode/security.js'

/**
 * Auto-heals raw JSON objects or stringified JSON passed as Code Mode execution payloads,
 * translating them into type-safe mj.* Code Mode API calls.
 */
export function extractAndRecoverJsonCode(code: string): string | null {
    return recoverStructuredJsonCode(code)
}

function detectRecoverableEntryCall(
    code: string
): { isUpdate: boolean; isTeamCall: boolean } | null {
    // Reject multi-call scripts so scope/id fields from an earlier statement are never stolen.
    const strippedCode = stripCommentsAndStrings(code)
    const callMatches = strippedCode.match(
        /\b(?:createEntry|teamCreateEntry|appendEntry|create_entry|team_create_entry|addMemory|createMemory|saveMemory|updateEntry|teamUpdateEntry|update_entry|team_update_entry|updateMemory|searchEntries|deleteEntry|getEntryById|listTags|getRecentEntries)\s*\(/gi
    )
    if (callMatches !== null && callMatches.length > 1) return null

    const isCreate =
        /\b(?:createEntry|teamCreateEntry|appendEntry|create_entry|team_create_entry|addMemory|createMemory|saveMemory)\b/i.test(
            strippedCode
        )
    const isStrictUpdate =
        /\b(?:updateEntry|teamUpdateEntry|update_entry|team_update_entry)\b/i.test(strippedCode)
    const isLegacyUpdateAlias = !isStrictUpdate && /\bupdateMemory\b/i.test(strippedCode)
    const isUpdate =
        isStrictUpdate || (isLegacyUpdateAlias && /\b(?:entry_id|id)\s*:\s*\d+/i.test(strippedCode))
    const isTeamCall =
        /\b(?:teamCreateEntry|teamUpdateEntry|team_create_entry|team_update_entry)\b/i.test(
            strippedCode
        )

    if (!isCreate && !isStrictUpdate && !isLegacyUpdateAlias) return null
    return { isUpdate, isTeamCall }
}

function unescapeQuotes(value: string): string {
    return value.replace(/\\+'/g, "'").replace(/\\+"/g, '"').replace(/\\`/g, '`')
}

function extractRecoveredEntryContentAndTitle(
    code: string
): { content: string; title: string | undefined; scanCode: string } | null {
    const backtickMatch =
        /\bcontent\s*:\s*`([\s\S]*?)`(?=\s*(?:,\s*[a-zA-Z_$][\w$]*\s*:|\s*,\s*\}|\s*\}|\s*\)))/i.exec(
            code
        )
    const singleMatch =
        /\bcontent\s*:\s*'([\s\S]*?)'(?=\s*(?:,\s*[a-zA-Z_$][\w$]*\s*:|\s*,\s*\}|\s*\}|\s*\)))/i.exec(
            code
        )
    const doubleMatch =
        /\bcontent\s*:\s*"([\s\S]*?)"(?=\s*(?:,\s*[a-zA-Z_$][\w$]*\s*:|\s*,\s*\}|\s*\}|\s*\)))/i.exec(
            code
        )
    // Require matching closing quote before `,`/`}`/`)`, or an explicit next-property / `}` boundary so unclosed parenthetical prose like `(see note)` is not truncated at `)`.
    const fallbackMatch =
        /\bcontent\s*:\s*([`'"])([\s\S]*?)(?:\1(?=\s*(?:,|\}|\)))|(?=\s*,\s*[a-zA-Z_$][\w$]*\s*:|\s*,\s*\}|\s*\}))/i.exec(
            code
        )

    let content: string | undefined =
        backtickMatch?.[1] ?? singleMatch?.[1] ?? doubleMatch?.[1] ?? fallbackMatch?.[2]
    content ??= /\bcontent\s*:\s*`([\s\S]*?)`(?=,\s*[\w$]+\s*:|\s*\})/i.exec(code)?.[1]
    content ??=
        /\b(?:description|summary)\s*:\s*(['"`])([\s\S]*?)\1(?=\s*(?:,\s*[a-zA-Z_$][\w$]*\s*:|\s*,\s*\}|\s*\}|\s*\)))/i.exec(
            code
        )?.[2]
    if (content === undefined || content === '') return null

    // [C4] Field regexes scan the code with content and title literals removed, so `project: 5` or
    // `workspace_id: 'x'` text quoted inside content or title can never re-scope the write.
    const scanWithTitle = code.split(content).join('')
    const titleMatch =
        /\btitle\s*:\s*(['"`])([\s\S]*?)\1(?=\s*(?:,\s*[a-zA-Z_$][\w$]*\s*:|\s*,\s*\}|\s*\}|\s*\)))/i.exec(
            scanWithTitle
        ) ?? /\btitle\s*:\s*(['"])([^'"]+)\1/i.exec(scanWithTitle)
    const scanCode =
        titleMatch?.[0] !== undefined ? scanWithTitle.split(titleMatch[0]).join('') : scanWithTitle

    return {
        content: unescapeQuotes(content),
        title: titleMatch?.[2] !== undefined ? unescapeQuotes(titleMatch[2]) : undefined,
        scanCode,
    }
}

function toUnknownArray(arr: readonly unknown[]): unknown[] {
    const out: unknown[] = []
    for (const item of arr) out.push(item)
    return out
}

function parseRelaxedJsonArray(rawArr: string): unknown[] | undefined {
    try {
        const parsed: unknown = JSON.parse(rawArr)
        if (Array.isArray(parsed)) return toUnknownArray(parsed)
    } catch {
        try {
            const normalized = rawArr
                .replace(/'([^']*)'/g, '"$1"')
                .replace(/([{,]\s*)([a-zA-Z0-9_$]+)\s*:/g, '$1"$2":')
            const parsed: unknown = JSON.parse(normalized)
            if (Array.isArray(parsed)) return toUnknownArray(parsed)
        } catch {
            return undefined
        }
    }
    return undefined
}

function parseRelaxedAutoContext(rawAutoContext: string): unknown {
    try {
        return JSON.parse(rawAutoContext)
    } catch {
        try {
            const normalized = rawAutoContext.replace(/([{,]\s*)([a-zA-Z0-9_$]+)\s*:/g, '$1"$2":')
            return JSON.parse(normalized)
        } catch {
            return undefined
        }
    }
}

function populateRecoveredEntryMetadata(payload: Record<string, unknown>, scanCode: string): void {
    const projectMatch =
        /\b(?:project_number|projectNumber|project_id|projectId|project_name|projectName|project)\s*:\s*(?:(\d+)|(['"`])([^'"`]+)\2)/i.exec(
            scanCode
        )
    const workspaceMatch = /\b(?:workspace_id|workspaceId|workspace)\s*:\s*(['"`])([^'"`]+)\1/i.exec(scanCode)
    const sessionMatch = /\b(?:session_id|sessionId)\s*:\s*(['"`])([^'"`]+)\1/i.exec(scanCode)
    const impactMatch = /\b(?:impact_score|impactScore|impact)\s*:\s*([0-9.]+)/i.exec(scanCode)
    const trustMatch = /\b(?:trust_score|trustScore|trust)\s*:\s*([0-9.]+)/i.exec(scanCode)
    const validationMatch = /\b(?:validation_status|validationStatus)\s*:\s*(['"`])([^'"`]+)\1/i.exec(scanCode)
    const sigMatch = /\b(?:significance_type|significanceType)\s*:\s*(['"`])([^'"`]+)\1/i.exec(scanCode)
    const isPersonalMatch = /\b(?:is_personal|isPersonal)\s*:\s*(true|false)\b/i.exec(scanCode)
    const shareTeamMatch = /\b(?:share_with_team|shareWithTeam)\s*:\s*(true|false)\b/i.exec(scanCode)
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

    for (const key of ['relationships', 'anchors'] as const) {
        const rawArr = new RegExp(`\\b${key}\\s*:\\s*(\\[[\\s\\S]*?\\])`, 'i').exec(scanCode)?.[1]
        if (rawArr === undefined) continue
        const parsed = parseRelaxedJsonArray(rawArr)
        if (parsed !== undefined) payload[key] = parsed
    }

    const rawTags = /\btags\s*:\s*\[([\s\S]*?)\]/i.exec(scanCode)?.[1]
    if (rawTags !== undefined) {
        payload['tags'] = rawTags.split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean)
    }

    const rawAutoContext = /\bauto_context\s*:\s*(\{[\s\S]*?\})(?=\s*,\s*\n|\s*\n\s*\})/i.exec(scanCode)?.[1]
    if (rawAutoContext !== undefined) {
        const parsedAutoContext = parseRelaxedAutoContext(rawAutoContext)
        if (parsedAutoContext !== undefined) payload['auto_context'] = parsedAutoContext
    }
}

/**
 * Attempt fuzzy recovery of an entry creation or update call from broken/mangled code
 */
export function extractAndRecoverEntryCode(code: string): string | null {
    if (!code || typeof code !== 'string' || code.length > 50_000) return null

    const jsonRecovered = extractAndRecoverJsonCode(code)
    if (jsonRecovered !== null) return jsonRecovered

    const detected = detectRecoverableEntryCall(code)
    if (detected === null) return null

    const extracted = extractRecoveredEntryContentAndTitle(code)
    if (extracted === null) return null

    const typeMatch = /\b(?:entry_type|type)\s*:\s*(['"])([^'"]+)\1/i.exec(extracted.scanCode)
    const payload: Record<string, unknown> = {
        content: extracted.content,
        entry_type: typeMatch?.[2] ?? 'technical_note',
    }
    if (extracted.title !== undefined && extracted.title !== '') payload['title'] = extracted.title

    populateRecoveredEntryMetadata(payload, extracted.scanCode)

    const fnName = detected.isUpdate
        ? detected.isTeamCall ? 'mj.team.teamUpdateEntry' : 'mj.updateEntry'
        : detected.isTeamCall ? 'mj.team.teamCreateEntry' : 'mj.createEntry'
    return `return await ${fnName}(${JSON.stringify(payload)});`
}
