/**
 * JSON and Entry payload recovery helpers for Code Mode execution payloads.
 */

import { recoverStructuredJsonCode, recoverStructuredRecord } from './json-entry-structured.js'
import { stripCommentsAndStrings } from '../../../codemode/security.js'
import { skipLineOrBlockComment } from '../../../codemode/security-stripper.js'
import {
    parseCanonicalPositiveInt,
    parsePositiveProjectNumber,
} from '../../../utils/safe-positive-int.js'

const ARRAY_FIELD_RES: readonly (readonly ['relationships' | 'anchors', RegExp])[] = [
    ['relationships', /\brelationships\s*:\s*(\[[\s\S]*?\])/i],
    ['anchors', /\banchors\s*:\s*(\[[\s\S]*?\])/i],
]

/**
 * Auto-heals raw JSON objects or stringified JSON passed as Code Mode execution payloads,
 * translating them into type-safe mj.* Code Mode API calls.
 */
export function extractAndRecoverJsonCode(code: string): string | null {
    return recoverStructuredJsonCode(code)
}

/** Auto-heals an already-parsed candidate record without JSON stringify/parse round-trip. */
export function extractAndRecoverRecordCode(record: Record<string, unknown>): string | null {
    return recoverStructuredRecord(record)
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
        isStrictUpdate || (isLegacyUpdateAlias && /\b(?:entry_id|id)\s*:\s*-?\d+/i.test(strippedCode))
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

const MAX_FUZZY_ENTRY_RECOVERY_LENGTH = 32_768
const MAX_ENTRY_FIELD_CANDIDATES = 16

function extractContentField(
    code: string
): { content: string; match: RegExpExecArray } | null {
    const backtickMatch =
        /\bcontent\s*:\s*`([\s\S]*?)`(?=\s*(?:,\s*[a-zA-Z_$][\w$]*\s*:|,\s*\}|\}|\)))/i.exec(
            code
        )
    if (backtickMatch?.[1] !== undefined) return { content: backtickMatch[1], match: backtickMatch }
    const singleMatch =
        /\bcontent\s*:\s*'([\s\S]*?)'(?=\s*(?:,\s*[a-zA-Z_$][\w$]*\s*:|,\s*\}|\}|\)))/i.exec(
            code
        )
    if (singleMatch?.[1] !== undefined) return { content: singleMatch[1], match: singleMatch }
    const doubleMatch =
        /\bcontent\s*:\s*"([\s\S]*?)"(?=\s*(?:,\s*[a-zA-Z_$][\w$]*\s*:|,\s*\}|\}|\)))/i.exec(
            code
        )
    if (doubleMatch?.[1] !== undefined) return { content: doubleMatch[1], match: doubleMatch }
    // Require matching closing quote before `,`/`}`/`)`, or an explicit next-property / `}` boundary so unclosed parenthetical prose like `(see note)` is not truncated at `)`.
    const fallbackMatch =
        /\bcontent\s*:\s*([`'"])([\s\S]*?)(?:\1(?=\s*(?:,|\}|\)))|(?=\s*,\s*[a-zA-Z_$][\w$]*\s*:|,\s*\}|\}))/i.exec(
            code
        )
    if (fallbackMatch?.[2] !== undefined) return { content: fallbackMatch[2], match: fallbackMatch }
    const altBacktick = /\bcontent\s*:\s*`([\s\S]*?)`(?=,\s*[\w$]+\s*:|\s*\})/i.exec(code)
    if (altBacktick?.[1] !== undefined) return { content: altBacktick[1], match: altBacktick }
    const descMatch =
        /\b(?:description|summary)\s*:\s*(['"`])([\s\S]*?)\1(?=\s*(?:,\s*[a-zA-Z_$][\w$]*\s*:|,\s*\}|\}|\)))/i.exec(
            code
        )
    if (descMatch?.[2] !== undefined) return { content: descMatch[2], match: descMatch }
    return null
}

function removeMatchSpan(text: string, match: RegExpExecArray): string {
    return `${text.slice(0, match.index)}${text.slice(match.index + match[0].length)}`
}

function extractRecoveredEntryContentAndTitle(
    code: string
): { content: string; title: string | undefined; scanCode: string } | null {
    const fieldCandidates = code.match(/\b(?:content|description|summary)\s*:/gi)
    if (fieldCandidates !== null && fieldCandidates.length > MAX_ENTRY_FIELD_CANDIDATES) {
        return null
    }
    const extractedContent = extractContentField(code)
    if (extractedContent === null || extractedContent.content === '') return null

    // [C4] Field regexes scan the code with content and title match spans removed by exact index,
    // so `content: 'default', workspace_id: 'default'` never erases `workspace_id`.
    const scanWithTitle = removeMatchSpan(code, extractedContent.match)
    const titleCandidates = scanWithTitle.match(/\btitle\s*:/gi)
    const titleMatch =
        titleCandidates !== null && titleCandidates.length > MAX_ENTRY_FIELD_CANDIDATES
            ? null
            : /\btitle\s*:\s*(['"`])([\s\S]*?)\1(?=\s*(?:,\s*[a-zA-Z_$][\w$]*\s*:|,\s*\}|\}|\)))/i.exec(
                  scanWithTitle
              ) ?? /\btitle\s*:\s*(['"])([^'"]+)\1/i.exec(scanWithTitle)
    const scanCode =
        titleMatch !== null ? removeMatchSpan(scanWithTitle, titleMatch) : scanWithTitle

    return {
        content: unescapeQuotes(extractedContent.content),
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

function stripJsCommentsPreservingStrings(code: string): string {
    const out: string[] = []
    let quote: string | null = null
    let escaped = false
    for (let i = 0; i < code.length; i++) {
        const ch = code[i] ?? ''
        if (quote !== null) {
            out.push(ch)
            if (escaped) escaped = false
            else if (ch === '\\') escaped = true
            else if (ch === quote) quote = null
            continue
        }
        if (ch === "'" || ch === '"' || ch === '`') {
            quote = ch
            out.push(ch)
            continue
        }
        const comment = skipLineOrBlockComment(code, i, false)
        if (comment !== null) {
            out.push(comment.hasNewline === true ? '\n' : ' ')
            i = comment.next - 1
            continue
        }
        out.push(ch)
    }
    return out.join('')
}

function findBalancedDelimitedBlockEnd(
    code: string,
    openIdx: number,
    openChar: string,
    closeChar: string
): number {
    let depth = 1
    let j = openIdx + 1
    let quote: string | null = null
    let escaped = false
    while (j < code.length && depth > 0) {
        const ch = code[j] ?? ''
        if (quote !== null) {
            if (escaped) escaped = false
            else if (ch === '\\') escaped = true
            else if (ch === quote) quote = null
        } else if (ch === "'" || ch === '"' || ch === '`') {
            quote = ch
        } else if (ch === openChar) {
            depth++
        } else if (ch === closeChar) {
            depth--
        }
        j++
    }
    return j
}

function stripNestedPropBlocks(code: string): string {
    const out: string[] = []
    let i = 0
    const propRe = /\b(?:auto_context|relationships|anchors)\s*:\s*([{[])/iy
    while (i < code.length) {
        propRe.lastIndex = i
        const m = propRe.exec(code)
        if (m?.[1] !== undefined) {
            const openChar = m[1]
            const closeChar = openChar === '{' ? '}' : ']'
            const endIdx = findBalancedDelimitedBlockEnd(code, i + m[0].length - 1, openChar, closeChar)
            out.push(`${openChar}${closeChar}`)
            i = endIdx
            continue
        }
        out.push(code[i] ?? '')
        i++
    }
    return out.join('')
}

function populateRecoveredArrayAndContextFields(
    payload: Record<string, unknown>,
    scanCode: string
): void {
    for (const [key, pattern] of ARRAY_FIELD_RES) {
        const rawArr = pattern.exec(scanCode)?.[1]
        if (rawArr === undefined) continue
        const parsed = parseRelaxedJsonArray(rawArr)
        if (parsed !== undefined) payload[key] = parsed
    }

    const rawTags = /\btags\s*:\s*\[([\s\S]*?)\]/i.exec(scanCode)?.[1]
    if (rawTags !== undefined) {
        payload['tags'] = rawTags.split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean)
    }

    const autoContextCandidates = scanCode.match(/\bauto_context\s*:/gi)
    const rawAutoContext =
        autoContextCandidates !== null && autoContextCandidates.length > MAX_ENTRY_FIELD_CANDIDATES
            ? undefined
            : /\bauto_context\s*:\s*(\{[\s\S]*?\})(?=[ \t\r]*,\s*\n|[ \t\r]*\n\s*\})/i.exec(
                  scanCode
              )?.[1]
    if (rawAutoContext !== undefined) {
        const parsedAutoContext = parseRelaxedAutoContext(rawAutoContext)
        if (parsedAutoContext !== undefined) payload['auto_context'] = parsedAutoContext
    }
}

function populateRecoveredEntryMetadata(payload: Record<string, unknown>, scanCode: string): void {
    const topLevelScanCode = stripNestedPropBlocks(scanCode)
    const projectMatch =
        /\b(?:project_number|projectNumber|project_id|projectId|project_name|projectName|project)\s*:\s*(?:(-?\d+(?:\.\d+)?)|(['"`])([^'"`]+)\2)/i.exec(
            topLevelScanCode
        )
    const workspaceMatch =
        /\b(?:workspace_id|workspaceId|workspace)\s*:\s*(['"`])([^'"`]+)\1/i.exec(topLevelScanCode)
    const targetWorkspaceMatch =
        /\b(?:target_workspace_id|targetWorkspaceId)\s*:\s*(['"`])([^'"`]+)\1/i.exec(topLevelScanCode)
    const sessionMatch = /\b(?:session_id|sessionId)\s*:\s*(['"`])([^'"`]+)\1/i.exec(topLevelScanCode)
    const impactMatch = /\b(?:impact_score|impactScore|impact)\s*:\s*([0-9.]+)/i.exec(topLevelScanCode)
    const trustMatch = /\b(?:trust_score|trustScore|trust)\s*:\s*([0-9.]+)/i.exec(topLevelScanCode)
    const validationMatch =
        /\b(?:validation_status|validationStatus)\s*:\s*(['"`])([^'"`]+)\1/i.exec(topLevelScanCode)
    const sigMatch =
        /\b(?:significance_type|significanceType)\s*:\s*(['"`])([^'"`]+)\1/i.exec(topLevelScanCode)
    const isPersonalMatch = /\b(?:is_personal|isPersonal)\s*:\s*(true|false)\b/i.exec(topLevelScanCode)
    const shareTeamMatch = /\b(?:share_with_team|shareWithTeam)\s*:\s*(true|false)\b/i.exec(topLevelScanCode)
    const entryIdMatch = /\b(?:entry_id|id)\s*:\s*(-?\d+(?:\.\d+)?)/i.exec(topLevelScanCode)

    if (entryIdMatch?.[1] !== undefined) {
        const eid = parseCanonicalPositiveInt(entryIdMatch[1])
        if (eid !== undefined) {
            payload['entry_id'] = eid
        } else {
            const numEid = Number(entryIdMatch[1])
            payload['entry_id'] = Number.isFinite(numEid) ? numEid : entryIdMatch[1]
        }
    }
    if (projectMatch?.[1] !== undefined) {
        const parsedProj = parsePositiveProjectNumber(projectMatch[1])
        if (parsedProj !== undefined) {
            payload['project_number'] = parsedProj
        } else {
            const numProj = Number(projectMatch[1])
            payload['project_number'] = Number.isFinite(numProj) ? numProj : projectMatch[1]
        }
    } else if (projectMatch?.[3] !== undefined && projectMatch[3].trim() !== '') {
        payload['project_number'] = projectMatch[3].trim()
    }
    if (workspaceMatch?.[2] !== undefined) payload['workspace_id'] = workspaceMatch[2]
    if (targetWorkspaceMatch?.[2] !== undefined && targetWorkspaceMatch[2].trim() !== '') {
        payload['target_workspace_id'] = targetWorkspaceMatch[2].trim()
    }
    if (sessionMatch?.[2] !== undefined) payload['session_id'] = sessionMatch[2]
    if (impactMatch?.[1] !== undefined) {
        const parsedImpact = Number(impactMatch[1])
        if (Number.isFinite(parsedImpact)) payload['impact_score'] = parsedImpact
    }
    if (trustMatch?.[1] !== undefined) {
        const parsedTrust = Number(trustMatch[1])
        if (Number.isFinite(parsedTrust)) payload['trust_score'] = parsedTrust
    }
    if (validationMatch?.[2] !== undefined) payload['validation_status'] = validationMatch[2]
    if (sigMatch?.[2] !== undefined) payload['significance_type'] = sigMatch[2]
    if (isPersonalMatch?.[1] !== undefined) payload['is_personal'] = isPersonalMatch[1].toLowerCase() === 'true'
    if (shareTeamMatch?.[1] !== undefined) payload['share_with_team'] = shareTeamMatch[1].toLowerCase() === 'true'

    populateRecoveredArrayAndContextFields(payload, scanCode)
}

/**
 * Attempt fuzzy recovery of an entry creation or update call from broken/mangled code
 */
export function extractAndRecoverEntryCode(code: string): string | null {
    if (!code || typeof code !== 'string' || code.length > 50_000) return null

    const jsonRecovered = extractAndRecoverJsonCode(code)
    if (jsonRecovered !== null) return jsonRecovered
    if (code.length > MAX_FUZZY_ENTRY_RECOVERY_LENGTH) return null

    const detected = detectRecoverableEntryCall(code)
    if (detected === null) return null

    const commentFreeCode = stripJsCommentsPreservingStrings(code)
    const extracted = extractRecoveredEntryContentAndTitle(commentFreeCode)
    if (extracted === null) return null

    const cleanScanCode = extracted.scanCode
    const typeMatch = /\b(?:entry_type|type)\s*:\s*(['"])([^'"]+)\1/i.exec(cleanScanCode)
    const payload: Record<string, unknown> = {
        content: extracted.content,
        entry_type: typeMatch?.[2] ?? 'technical_note',
    }
    if (extracted.title !== undefined && extracted.title !== '') payload['title'] = extracted.title

    populateRecoveredEntryMetadata(payload, cleanScanCode)

    const fnName = detected.isUpdate
        ? detected.isTeamCall ? 'mj.team.teamUpdateEntry' : 'mj.updateEntry'
        : detected.isTeamCall ? 'mj.team.teamCreateEntry' : 'mj.createEntry'
    return `return await ${fnName}(${JSON.stringify(payload)});`
}
