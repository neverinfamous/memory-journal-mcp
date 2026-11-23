/**
 * memory-journal-mcp — Audit Query & Scope Helpers
 *
 * Shared helpers for parsing JSONL audit entries, extracting
 * workspace/project scope from tool arguments and resource URIs,
 * and applying scope filters during audit searches.
 */

import type { RequestContext } from '../utils/request-context.js'
import { getActiveSessionProject } from '../utils/workspace-resolver.js'
import { estimateTokens, safeJsonStringify } from '../observability/token-estimator.js'
import { logger } from '../utils/logger.js'
import { parseCanonicalPositiveInt, parsePositiveProjectNumber } from '../utils/safe-positive-int.js'
import { sanitizeErrorForLogging } from '../utils/security-utils.js'
import {
    ADMIN_PROMPT_NAMES,
    canonicalizeMemoryResourceUri,
    normalizePromptAliasForScope,
    TEAM_PROMPT_NAMES,
} from '../auth/scope-map.js'
import type { AuditCategory, AuditEntry, AuditSearchFilters } from './types.js'

export interface AuditScopeMetadata {
    workspaceId?: string | undefined
    projectNumber?: number | undefined
}

const SENSITIVE_AUDIT_URI_RE =
    /^memory:\/\/(?:team|audit|metrics\/users|insights\/team-collaboration)(?:\/|$|\?|#)/i
const SCHEMELESS_SENSITIVE_PATH_RE =
    /^(?:team|audit)(?:[/?#]|$)|^(?:metrics|insights)[/?#]/i

export const AUDIT_URI_KEYS = [
    'uri', 'Uri', '_uri', 'resourceUri', 'resource_uri', 'url', 'Url', 'resource',
    'Resource', 'path', 'Path', 'target', 'Target', 'name', 'Name', 'ServerName', 'server_name',
] as const
const PROMPT_TARGET_KEYS = ['name', 'prompt', 'prompt_name', 'Name', 'promptName'] as const

function isNormalizedSensitiveUri(normalized: string): boolean {
    return SENSITIVE_AUDIT_URI_RE.test(normalized)
}

function isSensitivePromptName(trimmed: string): boolean {
    if (TEAM_PROMPT_NAMES.has(trimmed) || ADMIN_PROMPT_NAMES.has(trimmed)) return true
    const aliased = normalizePromptAliasForScope(trimmed)
    return TEAM_PROMPT_NAMES.has(aliased) || ADMIN_PROMPT_NAMES.has(aliased)
}

function resolveSensitiveCategoryFromNormalized(normalized: string, rawOrName: string): AuditCategory {
    if (/^memory:\/\/(?:audit|metrics\/users)(?:\/|$|\?|#)/i.test(normalized)) return 'audit'
    const trimmed = rawOrName.trim()
    const aliased =
        ADMIN_PROMPT_NAMES.has(trimmed) || TEAM_PROMPT_NAMES.has(trimmed)
            ? trimmed
            : normalizePromptAliasForScope(trimmed)
    if (ADMIN_PROMPT_NAMES.has(trimmed) || ADMIN_PROMPT_NAMES.has(aliased)) return 'admin'
    if (
        /^memory:\/\/(?:team|insights\/team-collaboration)(?:\/|$|\?|#)/i.test(normalized) ||
        TEAM_PROMPT_NAMES.has(trimmed) ||
        TEAM_PROMPT_NAMES.has(aliased)
    ) {
        return 'team'
    }
    return 'read'
}

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

/** Normalize resource URI targets (stripping fragments, canonicalizing dot segments/percent encoding, and adding `memory://` for scheme-less paths). */
export function normalizeAuditResourceUri(raw: string): string {
    const trimmed = raw.trim()
    if (!trimmed.includes('://')) {
        const decodedSep = trimmed.replace(/%(?:2f|5c)/gi, '/')
        if (SCHEMELESS_SENSITIVE_PATH_RE.test(decodedSep)) {
            return canonicalizeMemoryResourceUri(`memory://${decodedSep}`)
        }
        if (!trimmed.includes('%')) return trimmed
    }
    return canonicalizeMemoryResourceUri(trimmed)
}

function checkUriKeyTarget(trimmed: string): string | undefined {
    const normalized = normalizeAuditResourceUri(trimmed)
    return isNormalizedSensitiveUri(normalized) ? normalized : undefined
}

/** Extract a sensitive resource URI or team/admin prompt target from tool arguments, if present. */
export function extractSensitiveTargetFromArgs(toolName: string, args: unknown): string | undefined {
    if (/^memory:\/\//i.test(toolName)) {
        const hit = checkUriKeyTarget(toolName)
        if (hit !== undefined) return hit
    }
    if (typeof args !== 'object' || args === null) return undefined
    const record = args as Record<string, unknown>

    let trimmedName: string | undefined
    let trimmedCapName: string | undefined

    for (const key of AUDIT_URI_KEYS) {
        const val = record[key]
        if (typeof val !== 'string') continue
        const trimmed = val.trim()
        if (trimmed === '') continue
        if (key === 'name' || key === 'Name') {
            if (key === 'name') trimmedName = trimmed
            else trimmedCapName = trimmed
            const decodedCandidate = trimmed.replace(/%(?:2f|5c)/gi, '/')
            if (!trimmed.includes('://') && !SCHEMELESS_SENSITIVE_PATH_RE.test(decodedCandidate)) continue
        } else if (
            (key === 'ServerName' || key === 'server_name') &&
            (trimmed === 'memory-journal-mcp' || trimmed === 'memory-journal')
        ) {
            continue
        }
        const hit = checkUriKeyTarget(trimmed)
        if (hit !== undefined) return hit
    }

    for (const key of PROMPT_TARGET_KEYS) {
        const trimmed =
            key === 'name'
                ? trimmedName
                : key === 'Name'
                  ? trimmedCapName
                  : typeof record[key] === 'string'
                    ? record[key].trim()
                    : ''
        if (trimmed === undefined || trimmed === '') continue
        if (isSensitivePromptName(trimmed)) {
            return trimmed
        }
    }

    return undefined
}

/** Whether a resource URI, team/admin prompt, or capability flags require unconditional audit logging. */
export function isSensitiveAuditTarget(
    uriOrName: string,
    capabilities?: { requiresTeamScope?: boolean; requiresAuditScope?: boolean; requiresAdminScope?: boolean }
): boolean {
    if (
        capabilities?.requiresTeamScope === true ||
        capabilities?.requiresAuditScope === true ||
        capabilities?.requiresAdminScope === true
    ) {
        return true
    }
    const normalized = normalizeAuditResourceUri(uriOrName)
    return isNormalizedSensitiveUri(normalized) || isSensitivePromptName(uriOrName)
}

/** Derive the audit category for an audited resource or prompt operation. */
export function resolveResourceAuditCategory(uriOrName: string): AuditCategory {
    return resolveSensitiveCategoryFromNormalized(normalizeAuditResourceUri(uriOrName), uriOrName)
}

export function applyActiveSessionScopeFallback(
    scope: AuditScopeMetadata,
    reqCtx?: RequestContext,
    explicitWildcardWorkspace = false,
    runtime?: object | null,
    suppressSessionFallback = false
): AuditScopeMetadata {
    if (explicitWildcardWorkspace) {
        return {
            ...(scope.projectNumber !== undefined ? { projectNumber: scope.projectNumber } : {}),
        }
    }
    const sessionProj = reqCtx?.ephemeralSessionProject ?? getActiveSessionProject(runtime)
    const canFallbackWorkspace =
        !suppressSessionFallback &&
        (scope.projectNumber === undefined || scope.projectNumber === sessionProj.projectNumber)
    const workspaceId =
        scope.workspaceId ??
        (canFallbackWorkspace &&
        sessionProj.workspaceId !== undefined &&
        sessionProj.workspaceId.length > 0
            ? sessionProj.workspaceId
            : undefined)
    const canFallbackProject =
        !suppressSessionFallback &&
        (scope.workspaceId === undefined ||
            scope.workspaceId.toLowerCase() === sessionProj.workspaceId?.toLowerCase())
    const projectNumber =
        scope.projectNumber ?? (canFallbackProject ? sessionProj.projectNumber : undefined)
    return {
        ...(workspaceId !== undefined ? { workspaceId } : {}),
        ...(projectNumber !== undefined ? { projectNumber } : {}),
    }
}

/** Extract optional workspaceId / projectNumber from tool arguments and optional active session context. */
export function extractAuditScopeFromArgs(
    args: unknown,
    reqCtx?: RequestContext,
    runtime?: object | null,
    skipSessionFallback = false
): AuditScopeMetadata {
    let workspaceId: string | undefined
    let projectNumber: number | undefined
    let explicitWildcardWorkspace = false
    let explicitZeroProject = false

    if (typeof args === 'object' && args !== null) {
        const record = args as Record<string, unknown>
        const rawWs = [record['workspace_id'], record['workspaceId'], record['workspace']].find(
            (v): v is string => typeof v === 'string' && v.trim() !== ''
        )
        if (rawWs !== undefined) {
            const trimmedWs = rawWs.trim()
            if (trimmedWs === '*') explicitWildcardWorkspace = true
            else workspaceId = sanitizeErrorForLogging(trimmedWs).slice(0, 255)
        }
        const rawProj = [record['project_number'], record['projectNumber']].find(
            (v) => v !== undefined && !(typeof v === 'string' && v.trim() === '')
        )
        const parsedProject = parsePositiveProjectNumber(rawProj)
        if (parsedProject !== undefined) projectNumber = parsedProject
        else if (rawProj !== undefined) explicitZeroProject = true
    }

    const baseScope: AuditScopeMetadata = {
        ...(workspaceId !== undefined ? { workspaceId } : {}),
        ...(projectNumber !== undefined ? { projectNumber } : {}),
    }
    if (skipSessionFallback) return baseScope
    return applyActiveSessionScopeFallback(baseScope, reqCtx, explicitWildcardWorkspace, runtime, explicitZeroProject)
}

/** Extract optional workspace_id / project_number query params or URI path repo from a memory:// URI. */
function extractRepoPathFromResourceUrl(parsed: URL): string | undefined {
    const host = parsed.hostname.toLowerCase()
    const stripped = parsed.pathname.replace(/^\/+/, '').trim()
    if (stripped.length === 0) return undefined
    if (host === 'briefing' || host === 'agent-context' || host === 'agent-id' || host === 'graph') {
        return stripped
    }
    if (host === 'actions' && stripped.startsWith('recent/')) {
        const repo = stripped.slice('recent/'.length).trim()
        return repo.length > 0 ? repo : undefined
    }
    if (host === 'github') {
        for (const prefix of ['status/', 'milestones/']) {
            if (stripped.startsWith(prefix)) {
                const repo = stripped.slice(prefix.length).trim()
                return repo.length > 0 ? repo : undefined
            }
        }
    }
    if (host === 'milestones' || host === 'kanban') {
        const lastSlash = stripped.lastIndexOf('/')
        if (lastSlash > 0 && /^\d+$/.test(stripped.slice(lastSlash + 1))) {
            const repo = stripped.slice(0, lastSlash).trim()
            return repo.length > 0 ? repo : undefined
        }
    }
    return undefined
}

function extractProjectNumberFromResourceUrl(parsed: URL): number | undefined {
    const host = parsed.hostname.toLowerCase()
    const segments = parsed.pathname.replace(/^\/+/, '').trim().split('/').filter(Boolean)
    const first = segments[0]
    if (first === undefined) return undefined
    if (host === 'projects' && segments.length === 2 && segments[1] === 'timeline') {
        return parseCanonicalPositiveInt(first)
    }
    if (
        host === 'commits' &&
        (segments.length === 1 ||
            (segments.length === 2 && (segments[1] === 'by-issue' || segments[1] === 'by-pr')))
    ) {
        return parseCanonicalPositiveInt(first)
    }
    if (host === 'staleness' && segments.length === 1) {
        return parseCanonicalPositiveInt(first)
    }
    if (host === 'kanban') {
        const lastSegment = segments[segments.length - 1]
        if (lastSegment !== undefined) return parseCanonicalPositiveInt(lastSegment)
    }
    return undefined
}

export interface UriAuditScopeDetails {
    scope: AuditScopeMetadata
    explicitWildcardWorkspace: boolean
    explicitInvalidProject: boolean
}

export function extractAuditScopeFromUriDetails(uri: string): UriAuditScopeDetails {
    let workspaceId: string | undefined
    let projectNumber: number | undefined
    let explicitWildcardWorkspace = false
    let explicitInvalidProject = false

    try {
        const parsed = new URL(uri)
        const wsParam = parsed.searchParams.get('workspace_id')
        if (wsParam !== null) {
            const trimmedWs = wsParam.trim()
            if (trimmedWs === '*') explicitWildcardWorkspace = true
            else if (trimmedWs.length > 0) workspaceId = sanitizeErrorForLogging(trimmedWs).slice(0, 255)
        }
        const projParam = parsed.searchParams.get('project_number')
        if (projParam !== null && projParam.trim() !== '') {
            const n = parseCanonicalPositiveInt(projParam)
            if (n !== undefined) projectNumber = n
            else explicitInvalidProject = true
        }
        if (workspaceId === undefined && !explicitWildcardWorkspace) {
            const rawRepo = extractRepoPathFromResourceUrl(parsed)
            if (rawRepo !== undefined) {
                let decodedRepo = rawRepo
                try {
                    decodedRepo = decodeURIComponent(rawRepo)
                } catch {
                    decodedRepo = rawRepo
                }
                if (decodedRepo.trim() === '*') explicitWildcardWorkspace = true
                else workspaceId = sanitizeErrorForLogging(decodedRepo).slice(0, 255)
            }
        }
        if (projectNumber === undefined && !explicitInvalidProject) {
            projectNumber = extractProjectNumberFromResourceUrl(parsed)
        }
    } catch {
        // Ignore malformed URI strings during audit extraction
    }

    return {
        scope: {
            ...(workspaceId !== undefined ? { workspaceId } : {}),
            ...(projectNumber !== undefined ? { projectNumber } : {}),
        },
        explicitWildcardWorkspace,
        explicitInvalidProject,
    }
}

export function extractAuditScopeFromUri(
    uri: string,
    reqCtx?: RequestContext,
    runtime?: object | null,
    skipSessionFallback = false
): AuditScopeMetadata {
    const details = extractAuditScopeFromUriDetails(uri)
    if (skipSessionFallback) return details.scope
    return applyActiveSessionScopeFallback(
        details.scope,
        reqCtx,
        details.explicitWildcardWorkspace,
        runtime,
        details.explicitInvalidProject
    )
}

function extractRecordText(val: unknown): string | undefined {
    return typeof val === 'object' && val !== null && typeof (val as { text?: unknown }).text === 'string'
        ? (val as { text: string }).text
        : undefined
}

function estimateEnvelopeTextTokens(result: unknown): number | undefined {
    if (typeof result !== 'object' || result === null) return undefined
    const rec = result as Record<string, unknown>
    if (Array.isArray(rec['contents'])) {
        let total = 0
        for (const item of rec['contents']) {
            const text = extractRecordText(item)
            if (text === undefined) return undefined
            total += estimateTokens(text, 'json')
        }
        return total
    }
    if (Array.isArray(rec['messages'])) {
        let total = 0
        for (const msg of rec['messages']) {
            const content =
                typeof msg === 'object' && msg !== null ? (msg as { content?: unknown }).content : undefined
            const text = extractRecordText(content)
            if (text === undefined) return undefined
            total += estimateTokens(text, 'prose')
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
            return estimateTokens(safeJsonStringify(result), 'json')
        } catch (serializeError) {
            logger.debug('Token estimate skipped: result is not serializable', {
                module: 'Audit',
                tool: name,
                error: serializeError instanceof Error ? serializeError.message : String(serializeError),
            })
            return undefined
        }
    }
    return typeof result === 'string' ? estimateTokens(result, 'prose') : undefined
}
