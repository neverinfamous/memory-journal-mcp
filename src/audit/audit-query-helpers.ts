/**
 * memory-journal-mcp — Audit Query & Scope Helpers
 *
 * Shared helpers for parsing JSONL audit entries, extracting
 * workspace/project scope from tool arguments and resource URIs,
 * and applying scope filters during audit searches.
 */

import type { RequestContext } from '../utils/request-context.js'
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
] as const

/** Parse one JSONL audit line; returns null for empty or unparseable lines. */
export function parseAuditLine(line: string | undefined): AuditEntry | null {
    if (!line || line.trim().length === 0) return null
    try {
        return JSON.parse(line) as AuditEntry
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
        const normalized = normalizeAuditResourceUri(val)
        if (isSensitiveAuditTarget(normalized)) return normalized
    }

    const promptCandidate = record['name'] ?? record['Name'] ?? record['prompt']
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
        if (typeof rawProj === 'number' && Number.isInteger(rawProj) && rawProj > 0) {
            projectNumber = rawProj
        } else if (typeof rawProj === 'string' && /^\d+$/.test(rawProj.trim())) {
            const parsed = Number(rawProj.trim())
            if (Number.isInteger(parsed) && parsed > 0) projectNumber = parsed
        }
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
        if (projParam !== null && /^\d+$/.test(projParam.trim())) {
            const n = Number(projParam.trim())
            if (Number.isInteger(n) && n > 0) projectNumber = n
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
