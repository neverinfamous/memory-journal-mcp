/**
 * JSON and Entry payload recovery helpers for Code Mode execution payloads.
 */

import {
    recoverStructuredJsonCode,
    recoverStructuredRecord,
    resolveRepoWorkspace,
} from './json-entry-structured.js'
import {
    findBalancedDelimitedBlockEnd,
    scanFallbackContentField,
    scanQuotedFieldLinear,
    stripJsCommentsPreservingStrings,
    stripNestedPropBlocks,
    type FieldMatchSpan,
} from './json-entry-field-scanner.js'
import { stripCommentsAndStrings } from '../../../codemode/security.js'
import {
    parseCanonicalPositiveInt,
    parsePositiveProjectNumber,
} from '../../../utils/safe-positive-int.js'

/**
 * Auto-heals raw JSON objects or stringified JSON passed as Code Mode execution payloads,
 * translating them into type-safe mj.* Code Mode API calls.
 */
export function extractAndRecoverJsonCode(code: string): string | null {
    return recoverStructuredJsonCode(code)
}

/** Auto-heals an already-parsed candidate record without JSON stringify/parse round-trip. */
export function extractAndRecoverRecordCode(
    record: Record<string, unknown>,
    outerFallback?: Record<string, unknown>
): string | null {
    return recoverStructuredRecord(record, outerFallback)
}

function detectRecoverableEntryCall(
    code: string
): { isUpdate: boolean; isLegacyUpdateAlias: boolean; isTeamCall: boolean } | null {
    // Reject multi-call scripts so scope/id fields from an earlier statement are never stolen.
    const strippedCode = stripCommentsAndStrings(code)
    const callMatches = strippedCode.match(
        /\b(?:createEntry|teamCreateEntry|appendEntry|create_entry|team_create_entry|addMemory|createMemory|saveMemory|save_memory|updateEntry|teamUpdateEntry|update_entry|team_update_entry|updateMemory|searchEntries|deleteEntry|getEntryById|listTags|getRecentEntries)\s*\(/gi
    )
    if (callMatches !== null && callMatches.length > 1) return null

    const isCreate =
        /\b(?:createEntry|teamCreateEntry|appendEntry|create_entry|team_create_entry|addMemory|createMemory)\b/i.test(
            strippedCode
        )
    const isStrictUpdate =
        /\b(?:updateEntry|teamUpdateEntry|update_entry|team_update_entry)\b/i.test(strippedCode)
    const isLegacyUpdateAlias = !isStrictUpdate && /\b(?:updateMemory|saveMemory|save_memory)\b/i.test(strippedCode)
    const isUpdate =
        isStrictUpdate || (isLegacyUpdateAlias && /\b(?:entry_id|entryId|id)\s*:\s*-?\d+/i.test(strippedCode))
    const isTeamCall =
        /\b(?:teamCreateEntry|teamUpdateEntry|team_create_entry|team_update_entry)\b/i.test(
            strippedCode
        )

    if (!isCreate && !isStrictUpdate && !isLegacyUpdateAlias) return null
    return { isUpdate, isLegacyUpdateAlias, isTeamCall }
}

function unescapeQuotes(value: string): string {
    return value.replace(/\\+'/g, "'").replace(/\\+"/g, '"').replace(/\\`/g, '`')
}

const MAX_FUZZY_ENTRY_RECOVERY_LENGTH = 32_768
const MAX_ENTRY_FIELD_CANDIDATES = 16

function regexToSpan(content: string, match: RegExpExecArray): { content: string; span: FieldMatchSpan } {
    return {
        content,
        span: { content, start: match.index, end: match.index + match[0].length },
    }
}

function extractContentField(
    code: string
): { content: string; span: FieldMatchSpan } | null {
    const backtickMatch =
        /\bcontent\s*:\s*`((?:[^`\\]|\\[\s\S])*)`(?=\s*(?:(?:,\s*|\s+)[a-zA-Z_$][\w$]*\s*:|,\s*\}|\}|\)))/i.exec(
            code
        )
    if (backtickMatch?.[1] !== undefined) return regexToSpan(backtickMatch[1], backtickMatch)
    const singleMatch =
        /\bcontent\s*:\s*'((?:[^'\\]|\\[\s\S])*)'(?=\s*(?:(?:,\s*|\s+)[a-zA-Z_$][\w$]*\s*:|,\s*\}|\}|\)))/i.exec(
            code
        )
    if (singleMatch?.[1] !== undefined) return regexToSpan(singleMatch[1], singleMatch)
    const doubleMatch =
        /\bcontent\s*:\s*"((?:[^"\\]|\\[\s\S])*)"(?=\s*(?:(?:,\s*|\s+)[a-zA-Z_$][\w$]*\s*:|,\s*\}|\}|\)))/i.exec(
            code
        )
    if (doubleMatch?.[1] !== undefined) return regexToSpan(doubleMatch[1], doubleMatch)

    const fallbackSpan = scanFallbackContentField(code)
    if (fallbackSpan !== null) return { content: fallbackSpan.content, span: fallbackSpan }

    const altBacktickSpan = scanQuotedFieldLinear(code, /\bcontent\s*:\s*(`)/i, 'prop-or-brace')
    if (altBacktickSpan !== null) return { content: altBacktickSpan.content, span: altBacktickSpan }

    const descSpan = scanQuotedFieldLinear(
        code,
        /\b(?:description|summary)\s*:\s*(['"`])/i,
        'prop-brace-or-paren'
    )
    if (descSpan !== null) return { content: descSpan.content, span: descSpan }
    return null
}

function removeSpan(text: string, span: { start: number; end: number }): string {
    return `${text.slice(0, span.start)}${text.slice(span.end)}`
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
    const scanWithTitle = removeSpan(code, extractedContent.span)
    const titleCandidates = scanWithTitle.match(/\btitle\s*:/gi)
    let titleSpan: { content: string; start: number; end: number } | null = null
    if (titleCandidates === null || titleCandidates.length <= MAX_ENTRY_FIELD_CANDIDATES) {
        titleSpan = scanQuotedFieldLinear(
            scanWithTitle,
            /\btitle\s*:\s*(['"`])/i,
            'prop-brace-or-paren'
        )
        if (titleSpan === null) {
            const shortTitleMatch = /\btitle\s*:\s*(['"])([^'"]+)\1/i.exec(scanWithTitle)
            if (shortTitleMatch?.[2] !== undefined) {
                titleSpan = {
                    content: shortTitleMatch[2],
                    start: shortTitleMatch.index,
                    end: shortTitleMatch.index + shortTitleMatch[0].length,
                }
            }
        }
    }
    const scanCode = titleSpan !== null ? removeSpan(scanWithTitle, titleSpan) : scanWithTitle

    return {
        content: unescapeQuotes(extractedContent.content),
        title: titleSpan !== null ? unescapeQuotes(titleSpan.content) : undefined,
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

function extractBalancedArrayBlock(
    source: string,
    candidateRe: RegExp,
    startRe: RegExp
): string | undefined {
    const candidates = source.match(candidateRe)
    if (candidates !== null && candidates.length > MAX_ENTRY_FIELD_CANDIDATES) return undefined
    const m = startRe.exec(source)
    if (m === null) return undefined
    const openIdx = m.index + m[0].length - 1
    const endIdx = findBalancedDelimitedBlockEnd(source, openIdx, '[', ']')
    const candidateSlice = source.slice(openIdx, endIdx)
    return candidateSlice.endsWith(']') ? candidateSlice : undefined
}

function populateRecoveredTags(payload: Record<string, unknown>, topLevelScanCode: string): void {
    const rawTagsBlock = extractBalancedArrayBlock(topLevelScanCode, /\btags\s*:/gi, /\btags\s*:\s*\[/i)
    if (rawTagsBlock === undefined) return
    const parsedTags = parseRelaxedJsonArray(rawTagsBlock)
    if (parsedTags?.every((t): t is string => typeof t === 'string') === true) {
        payload['tags'] = parsedTags.map((t) => t.trim()).filter(Boolean)
        return
    }
    payload['tags'] = rawTagsBlock
        .slice(1, -1)
        .split(',')
        .map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
        .filter(Boolean)
}

function populateRecoveredAutoContext(payload: Record<string, unknown>, scanCode: string): void {
    const autoContextCandidates = scanCode.match(/\b(?:auto_context|autoContext)\s*:/gi)
    const autoContextStartMatch =
        autoContextCandidates !== null && autoContextCandidates.length > MAX_ENTRY_FIELD_CANDIDATES
            ? null
            : /\b(?:auto_context|autoContext)\s*:\s*(\{)/i.exec(scanCode)
    if (autoContextStartMatch === null) return
    const openBraceIdx = autoContextStartMatch.index + autoContextStartMatch[0].length - 1
    const endBraceIdx = findBalancedDelimitedBlockEnd(scanCode, openBraceIdx, '{', '}')
    const candidateSlice = scanCode.slice(openBraceIdx, endBraceIdx)
    if (!candidateSlice.endsWith('}')) return
    const parsedAutoContext = parseRelaxedAutoContext(candidateSlice)
    if (parsedAutoContext !== undefined) payload['auto_context'] = parsedAutoContext
}

function populateRecoveredArrayAndContextFields(
    payload: Record<string, unknown>,
    scanCode: string,
    topLevelScanCode: string
): void {
    const arraySpecs = [
        ['relationships', /\brelationships\s*:/gi, /\brelationships\s*:\s*\[/i],
        ['anchors', /\banchors\s*:/gi, /\banchors\s*:\s*\[/i],
    ] as const
    for (const [key, candRe, startRe] of arraySpecs) {
        const rawArr = extractBalancedArrayBlock(scanCode, candRe, startRe)
        if (rawArr === undefined) continue
        const parsed = parseRelaxedJsonArray(rawArr)
        if (parsed !== undefined) payload[key] = parsed
    }
    populateRecoveredTags(payload, topLevelScanCode)
    populateRecoveredAutoContext(payload, scanCode)
}

function populateRecoveredEntryFlags(payload: Record<string, unknown>, topLevelScanCode: string): void {
    const isArchivedMatch = /\b(?:is_archived|isArchived)\s*:\s*(true|false)\b/i.exec(topLevelScanCode)
    if (isArchivedMatch?.[1] !== undefined) {
        payload['is_archived'] = isArchivedMatch[1].toLowerCase() === 'true'
    }
    const autoLinkMatch = /\b(?:auto_link|autoLink)\s*:\s*(true|false)\b/i.exec(topLevelScanCode)
    if (autoLinkMatch?.[1] !== undefined) {
        payload['auto_link'] = autoLinkMatch[1].toLowerCase() === 'true'
    }
    const verMatch =
        /\b(?:expected_version|expectedVersion)\s*:\s*(?:(-?\d+(?:\.\d+)?)|(['"`])([^'"`]+)\2)/i.exec(
            topLevelScanCode
        )
    const rawVer = verMatch?.[1] ?? verMatch?.[3]?.trim()
    if (rawVer !== undefined && rawVer !== '') {
        const parsedVer = parseCanonicalPositiveInt(rawVer)
        if (parsedVer !== undefined) {
            payload['expected_version'] = parsedVer
        } else if (verMatch?.[1] !== undefined) {
            const numVer = Number(rawVer)
            payload['expected_version'] = Number.isFinite(numVer) ? numVer : rawVer
        } else {
            payload['expected_version'] = rawVer
        }
    }
}

function populateRecoveredEntryIdField(
    payload: Record<string, unknown>,
    topLevelScanCode: string
): void {
    const entryIdMatch =
        /\b(?:entry_id|entryId|id)\s*:\s*(?:(-?\d+(?:\.\d+)?)|(['"`])([^'"`]+)\2)/i.exec(
            topLevelScanCode
        )
    const rawEntryId = entryIdMatch?.[1] ?? entryIdMatch?.[3]?.trim()
    if (rawEntryId === undefined || rawEntryId === '') return
    const eid = parseCanonicalPositiveInt(rawEntryId)
    if (eid !== undefined) {
        payload['entry_id'] = eid
    } else if (entryIdMatch?.[1] !== undefined) {
        const numEid = Number(rawEntryId)
        payload['entry_id'] = Number.isFinite(numEid) ? numEid : rawEntryId
    } else {
        payload['entry_id'] = rawEntryId
    }
}

function populateRecoveredIdsAndScope(payload: Record<string, unknown>, topLevelScanCode: string): void {
    populateRecoveredEntryIdField(payload, topLevelScanCode)
    const projectMatch =
        /\b(?:project_number|projectNumber|project_id|projectId|project_name|projectName|project)\s*:\s*(?:(-?\d+(?:\.\d+)?)|(['"`])([^'"`]+)\2)/i.exec(
            topLevelScanCode
        )
    const workspaceMatch =
        /\b(?:workspace_id|workspaceId|workspace)\s*:\s*(['"`])([^'"`]+)\1/i.exec(topLevelScanCode)
    const repoMatch =
        /\b(?:repo|repo_name|repoName|repository)\s*:\s*(['"`])([^'"`]+)\1/i.exec(topLevelScanCode)
    const targetWorkspaceMatch =
        /\b(?:target_workspace_id|targetWorkspaceId)\s*:\s*(['"`])([^'"`]+)\1/i.exec(topLevelScanCode)
    const sessionMatch = /\b(?:session_id|sessionId)\s*:\s*(['"`])([^'"`]+)\1/i.exec(topLevelScanCode)
    if (projectMatch?.[1] !== undefined) {
        const parsedProj = parsePositiveProjectNumber(projectMatch[1])
        if (parsedProj !== undefined) payload['project_number'] = parsedProj
        else {
            const numProj = Number(projectMatch[1])
            payload['project_number'] = Number.isFinite(numProj) ? numProj : projectMatch[1]
        }
    } else if (projectMatch?.[3] !== undefined && projectMatch[3].trim() !== '') {
        payload['project_number'] = projectMatch[3].trim()
    }
    if (workspaceMatch?.[2] !== undefined) payload['workspace_id'] = workspaceMatch[2]
    else if (repoMatch?.[2] !== undefined) {
        const resolvedRepoWs = resolveRepoWorkspace(repoMatch[2])
        if (resolvedRepoWs !== undefined) payload['workspace_id'] = resolvedRepoWs
    }
    if (targetWorkspaceMatch?.[2] !== undefined && targetWorkspaceMatch[2].trim() !== '') {
        payload['target_workspace_id'] = targetWorkspaceMatch[2].trim()
    }
    if (sessionMatch?.[2] !== undefined) payload['session_id'] = sessionMatch[2]
}

function populateRecoveredScoresAndStatuses(
    payload: Record<string, unknown>,
    topLevelScanCode: string
): void {
    const impactMatch = /\b(?:impact_score|impactScore|impact)\s*:\s*([0-9.]+)/i.exec(topLevelScanCode)
    const trustMatch = /\b(?:trust_score|trustScore|trust)\s*:\s*([0-9.]+)/i.exec(topLevelScanCode)
    const validationMatch =
        /\b(?:validation_status|validationStatus)\s*:\s*(['"`])([^'"`]+)\1/i.exec(topLevelScanCode)
    const sigMatch =
        /\b(?:significance_type|significanceType)\s*:\s*(['"`])([^'"`]+)\1/i.exec(topLevelScanCode)
    const isPersonalMatch = /\b(?:is_personal|isPersonal)\s*:\s*(true|false)\b/i.exec(topLevelScanCode)
    const shareTeamMatch = /\b(?:share_with_team|shareWithTeam)\s*:\s*(true|false)\b/i.exec(topLevelScanCode)
    const useTestDbMatch = /\b(?:use_test_db|useTestDb)\s*:\s*(true|false)\b/i.exec(topLevelScanCode)

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
    if (useTestDbMatch?.[1]?.toLowerCase() === 'true') payload['use_test_db'] = true
}

function populateRecoveredEntryMetadata(
    payload: Record<string, unknown>,
    scanCode: string,
    preStrippedTopLevel?: string
): void {
    const topLevelScanCode = preStrippedTopLevel ?? stripNestedPropBlocks(scanCode)
    populateRecoveredIdsAndScope(payload, topLevelScanCode)
    populateRecoveredScoresAndStatuses(payload, topLevelScanCode)
    populateRecoveredEntryFlags(payload, topLevelScanCode)
    populateRecoveredArrayAndContextFields(payload, scanCode, topLevelScanCode)
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
    const topLevelScanCode = stripNestedPropBlocks(cleanScanCode)
    const typeMatch = /\b(?:entry_type|type)\s*:\s*(['"])([^'"]+)\1/i.exec(topLevelScanCode)
    const payload: Record<string, unknown> = {
        content: extracted.content,
    }
    if (extracted.title !== undefined && extracted.title !== '') payload['title'] = extracted.title

    populateRecoveredEntryMetadata(payload, cleanScanCode, topLevelScanCode)
    const isUpdate =
        detected.isUpdate || (detected.isLegacyUpdateAlias && payload['entry_id'] !== undefined)
    if (typeMatch?.[2] !== undefined) {
        payload['entry_type'] = typeMatch[2]
    } else if (!isUpdate) {
        payload['entry_type'] = 'technical_note'
    }

    const fnName = isUpdate
        ? detected.isTeamCall ? 'mj.team.teamUpdateEntry' : 'mj.updateEntry'
        : detected.isTeamCall ? 'mj.team.teamCreateEntry' : 'mj.createEntry'
    return `return await ${fnName}(${JSON.stringify(payload)});`
}
