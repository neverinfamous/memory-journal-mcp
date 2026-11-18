/**
 * memory-journal-mcp — Audit Query & Scope Helpers
 *
 * Shared helpers for parsing JSONL audit entries, extracting
 * workspace/project scope from tool arguments and resource URIs,
 * and applying scope filters during audit searches.
 */

import { open } from 'node:fs/promises'
import type { RequestContext } from '../utils/request-context.js'
import { estimateTokens } from '../observability/token-estimator.js'
import { logger } from '../utils/logger.js'
import { parseCanonicalPositiveInt, parsePositiveProjectNumber } from '../utils/safe-positive-int.js'
import { TEAM_PROMPT_NAMES } from '../auth/scope-map.js'
import type { AuditCategory, AuditEntry, AuditSearchFilters } from './types.js'

export interface AuditScopeMetadata {
    workspaceId?: string | undefined
    projectNumber?: number | undefined
}

const SENSITIVE_AUDIT_URI_RE =
    /^memory:\/\/(?:team|audit|insights\/team-collaboration)(?:\/|$|\?|#)/i
const SCHEMELESS_SENSITIVE_PATH_RE =
    /^(?:team|audit|insights\/team-collaboration)(?:\/|$|\?|#)/i

const AUDIT_URI_KEYS = [
    'uri',
    'Uri',
    '_uri',
    'resourceUri',
    'resource_uri',
    'url',
    'Url',
    'resource',
    'Resource',
    'path',
    'Path',
    'target',
    'Target',
    'name',
    'Name',
    'ServerName',
    'server_name',
] as const

/** Parse one JSONL audit line; returns null for empty, unparseable, or malformed lines. */
export function parseAuditLine(line: string | undefined): AuditEntry | null {
    if (!line || line.trim().length === 0) return null
    try {
        const parsed: unknown = JSON.parse(line)
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
            return null
        }
        const record = parsed as Record<string, unknown>
        if (typeof record['tool'] !== 'string') {
            return null
        }
        return parsed as AuditEntry
    } catch {
        return null
    }
}

/** Whether an audit entry satisfies every provided search filter. */
export function matchesAuditFilters(entry: AuditEntry, filters: AuditSearchFilters): boolean {
    if (filters.tool_name && entry.tool !== filters.tool_name) return false
    if (filters.user && entry.user !== filters.user) return false
    if (filters.status !== undefined && entry.success !== filters.status) return false
    if (filters.category && entry.category !== filters.category) return false
    if (filters.date_range?.start && entry.timestamp < filters.date_range.start) return false
    if (filters.date_range?.end && entry.timestamp > filters.date_range.end) return false
    if (filters.workspace_id !== undefined && filters.workspace_id !== '*') {
        if (entry.workspaceId?.toLowerCase() !== filters.workspace_id.toLowerCase()) {
            return false
        }
    }
    if (filters.project_number !== undefined && entry.projectNumber !== filters.project_number) {
        return false
    }
    return true
}

/** Normalize resource URI targets (stripping fragments and adding `memory://` for scheme-less paths). */
export function normalizeAuditResourceUri(raw: string): string {
    const trimmed = raw.trim()
    const withScheme =
        !trimmed.includes('://') && SCHEMELESS_SENSITIVE_PATH_RE.test(trimmed)
            ? `memory://${trimmed}`
            : trimmed
    return withScheme.replace(/#.*$/, '')
}

function isTeamPromptTarget(name: string): boolean {
    const trimmed = name.trim()
    if (TEAM_PROMPT_NAMES.has(trimmed)) return true
    const normalized = trimmed.replace(/^mj_/, '').replace(/_/g, '-')
    return TEAM_PROMPT_NAMES.has(normalized)
}

/** Extract a sensitive resource URI or team prompt target from tool arguments, if present. */
export function extractSensitiveTargetFromArgs(toolName: string, args: unknown): string | undefined {
    if (toolName.startsWith('memory://')) {
        const normalizedToolUri = normalizeAuditResourceUri(toolName)
        if (isSensitiveAuditTarget(normalizedToolUri)) return normalizedToolUri
    }
    if (typeof args !== 'object' || args === null) return undefined
    const record = args as Record<string, unknown>

    for (const key of AUDIT_URI_KEYS) {
        const val = record[key]
        if (typeof val !== 'string' || val.trim() === '') continue
        const trimmed = val.trim()
        if (
            (key === 'ServerName' || key === 'server_name') &&
            (trimmed === 'memory-journal-mcp' || trimmed === 'memory-journal')
        ) {
            continue
        }
        const normalized = normalizeAuditResourceUri(trimmed)
        if (isSensitiveAuditTarget(normalized)) return normalized
    }

    const promptCandidate =
        record['name'] ??
        record['Name'] ??
        record['prompt_name'] ??
        record['promptName'] ??
        record['prompt']
    if (typeof promptCandidate === 'string' && isTeamPromptTarget(promptCandidate)) {
        return promptCandidate.trim()
    }

    return undefined
}

/** Whether a resource URI, team prompt, or capability flags require unconditional audit logging. */
export function isSensitiveAuditTarget(
    uriOrName: string,
    capabilities?: { requiresTeamScope?: boolean; requiresAuditScope?: boolean }
): boolean {
    const normalized = normalizeAuditResourceUri(uriOrName)
    return (
        capabilities?.requiresTeamScope === true ||
        capabilities?.requiresAuditScope === true ||
        SENSITIVE_AUDIT_URI_RE.test(normalized) ||
        isTeamPromptTarget(uriOrName)
    )
}

/** Derive the audit category for an audited resource or prompt operation. */
export function resolveResourceAuditCategory(uriOrName: string): AuditCategory {
    const normalized = normalizeAuditResourceUri(uriOrName)
    if (/^memory:\/\/audit(?:\/|$|\?|#)/i.test(normalized)) return 'audit'
    if (
        /^memory:\/\/(?:team|insights\/team-collaboration)(?:\/|$|\?|#)/i.test(normalized) ||
        isTeamPromptTarget(uriOrName)
    ) {
        return 'team'
    }
    return 'read'
}

/** Extract optional workspaceId / projectNumber from tool arguments and active request context. */
export function extractAuditScopeFromArgs(
    args: unknown,
    reqCtx?: RequestContext
): AuditScopeMetadata {
    let workspaceId: string | undefined
    let projectNumber: number | undefined

    if (typeof args === 'object' && args !== null) {
        const record = args as Record<string, unknown>
        const rawWs = record['workspace_id'] ?? record['workspaceId'] ?? record['workspace']
        if (typeof rawWs === 'string' && rawWs.trim().length > 0 && rawWs.trim() !== '*') {
            workspaceId = rawWs.trim()
        }
        const rawProj = record['project_number'] ?? record['projectNumber']
        const parsedProject = parsePositiveProjectNumber(rawProj)
        if (parsedProject !== undefined) projectNumber = parsedProject
    }

    if (workspaceId === undefined && reqCtx?.ephemeralSessionProject?.workspaceId) {
        workspaceId = reqCtx.ephemeralSessionProject.workspaceId
    }
    if (projectNumber === undefined && reqCtx?.ephemeralSessionProject?.projectNumber !== undefined) {
        projectNumber = reqCtx.ephemeralSessionProject.projectNumber
    }

    return {
        ...(workspaceId !== undefined ? { workspaceId } : {}),
        ...(projectNumber !== undefined ? { projectNumber } : {}),
    }
}

/** Extract optional workspace_id / project_number query params or URI path repo from a memory:// URI. */
export function extractAuditScopeFromUri(
    uri: string,
    reqCtx?: RequestContext
): AuditScopeMetadata {
    let workspaceId: string | undefined
    let projectNumber: number | undefined

    try {
        const parsed = new URL(uri)
        const wsParam = parsed.searchParams.get('workspace_id')
        if (wsParam !== null && wsParam.trim().length > 0 && wsParam.trim() !== '*') {
            workspaceId = wsParam.trim()
        }
        const projParam = parsed.searchParams.get('project_number')
        if (projParam !== null) {
            const n = parseCanonicalPositiveInt(projParam)
            if (n !== undefined) projectNumber = n
        }
        if (workspaceId === undefined && (parsed.hostname === 'briefing' || parsed.hostname === 'agent-context' || parsed.hostname === 'agent-id')) {
            const rawRepo = parsed.pathname.replace(/^\/+/, '').trim()
            if (rawRepo.length > 0) {
                workspaceId = decodeURIComponent(rawRepo)
            }
        }
    } catch {
        // Ignore malformed URI strings during audit extraction
    }

    if (workspaceId === undefined && reqCtx?.ephemeralSessionProject?.workspaceId) {
        workspaceId = reqCtx.ephemeralSessionProject.workspaceId
    }
    if (projectNumber === undefined && reqCtx?.ephemeralSessionProject?.projectNumber !== undefined) {
        projectNumber = reqCtx.ephemeralSessionProject.projectNumber
    }

    return {
        ...(workspaceId !== undefined ? { workspaceId } : {}),
        ...(projectNumber !== undefined ? { projectNumber } : {}),
    }
}

const AUDIT_SEARCH_CHUNK_BYTES = 65_536

/**
 * Scan one JSONL audit log file backwards in 64 KB chunks without loading the whole file.
 */
export async function searchAuditFileBackward(
    filePath: string,
    filters: AuditSearchFilters,
    remainingLimit: number,
    results: AuditEntry[]
): Promise<{ skippedLines: number; limitReached: boolean }> {
    let fh: Awaited<ReturnType<typeof open>>
    try {
        fh = await open(filePath, 'r')
    } catch (err: unknown) {
        const code =
            typeof err === 'object' && err !== null && 'code' in err ? err.code : undefined
        if (code === 'ENOENT') return { skippedLines: 0, limitReached: false }
        throw err
    }

    let skippedLines = 0
    try {
        const info = await fh.stat()
        if (info.size === 0 || info.isDirectory()) return { skippedLines: 0, limitReached: false }

        const buf = Buffer.alloc(Math.min(AUDIT_SEARCH_CHUNK_BYTES, info.size))
        let pos = info.size
        let trailingPartial = ''

        while (pos > 0) {
            const readLen = Math.min(AUDIT_SEARCH_CHUNK_BYTES, pos)
            const startOffset = pos - readLen
            await fh.read(buf, 0, readLen, startOffset)
            const chunkText = buf.subarray(0, readLen).toString('utf-8') + trailingPartial
            const lines = chunkText.split('\n')
            const firstCompleteIdx = startOffset > 0 ? 1 : 0
            trailingPartial = startOffset > 0 ? (lines[0] ?? '') : ''

            for (let i = lines.length - 1; i >= firstCompleteIdx; i--) {
                const rawLine = lines[i]
                if (rawLine === undefined || rawLine.length === 0) continue
                const entry = parseAuditLine(rawLine)
                if (entry === null) {
                    skippedLines++
                    continue
                }
                if (!matchesAuditFilters(entry, filters)) continue
                results.push(entry)
                if (results.length >= remainingLimit) {
                    return { skippedLines, limitReached: true }
                }
            }
            pos = startOffset
        }
        return { skippedLines, limitReached: false }
    } finally {
        await fh.close()
    }
}

function estimateEnvelopeTextTokens(result: unknown): number | undefined {
    if (typeof result !== 'object' || result === null) return undefined
    const rec = result as Record<string, unknown>
    if (Array.isArray(rec['contents'])) {
        let total = 0
        for (const item of rec['contents']) {
            if (
                typeof item === 'object' &&
                item !== null &&
                typeof (item as { text?: unknown }).text === 'string'
            ) {
                total += estimateTokens((item as { text: string }).text, 'json')
            } else {
                return undefined
            }
        }
        return total
    }
    if (Array.isArray(rec['messages'])) {
        let total = 0
        for (const msg of rec['messages']) {
            const content =
                typeof msg === 'object' && msg !== null ? (msg as { content?: unknown }).content : undefined
            if (
                typeof content === 'object' &&
                content !== null &&
                typeof (content as { text?: unknown }).text === 'string'
            ) {
                total += estimateTokens((content as { text: string }).text, 'prose')
            } else {
                return undefined
            }
        }
        return total
    }
    return undefined
}

/** Estimate token count for resource/prompt operation audit records, avoiding full JSON stringification on envelopes. */
export function estimateOperationResultTokens(result: unknown, name: string): number | undefined {
    if (typeof result === 'object' && result !== null) {
        const fastTokens = estimateEnvelopeTextTokens(result)
        if (fastTokens !== undefined) return fastTokens
        try {
            return estimateTokens(JSON.stringify(result), 'json')
        } catch (serializeError) {
            // Serialization failure must not block execution
            logger.debug('Token estimate skipped: result is not serializable', {
                module: 'Audit',
                tool: name,
                error:
                    serializeError instanceof Error
                        ? serializeError.message
                        : String(serializeError),
            })
            return undefined
        }
    }
    if (typeof result === 'string') {
        return estimateTokens(result, 'prose')
    }
    return undefined
}
