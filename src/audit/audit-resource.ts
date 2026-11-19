/**
 * Audit Resource Handler
 *
 * Serves the memory://audit resource — the last 50 telemetry entries
 * as a structured, YAML-style text payload with a session summary
 * including token totals and error counts.
 *
 * Per mcp-builder §2.3: annotated as ASSISTANT_FOCUSED (agent-only).
 *
 * When telemetry logging is not configured, returns a brief informational
 * message with a setup hint.
 *
 * Uses the AuditLogger.recent() streaming tail-read (64KB window)
 * instead of loading the entire file — O(1) memory regardless of
 * telemetry log size.
 */

import type {
    InternalResourceDef,
    ResourceContext,
    ResourceResult,
} from '../handlers/resources/shared.js'
import { ASSISTANT_FOCUSED } from '../utils/resource-annotations.js'
import { SENSITIVE_KEY_RE, sanitizeErrorForLogging } from '../utils/security-utils.js'
import { sliceUntrustedInline } from '../handlers/resources/uri-and-fencing.js'
import { ValidationError } from '../types/errors.js'
import { parseCanonicalPositiveInt } from '../utils/safe-positive-int.js'
import type { AuditLogger } from './audit-logger.js'
import type { AuditEntry } from './types.js'
import { extractAuditScopeFromUri, matchesAuditFilters } from './audit-query-helpers.js'

function parseAuditResourceQueryScope(uri: string): {
    workspaceId?: string
    projectNumber?: number
} {
    const scopeFilter = extractAuditScopeFromUri(uri)
    let explicitZeroProject = false
    try {
        const parsed = new URL(uri)
        const rawWs = parsed.searchParams.get('workspace_id')
        if (rawWs !== null && rawWs.trim().length === 0) {
            throw new ValidationError('Invalid workspace_id query parameter: must be non-empty.')
        }
        const rawProj = parsed.searchParams.get('project_number')
        if (rawProj !== null) {
            const trimmed = rawProj.trim()
            if (trimmed === '0') {
                explicitZeroProject = true
            } else if (parseCanonicalPositiveInt(trimmed) === undefined) {
                throw new ValidationError(
                    `Invalid project_number query parameter '${rawProj}': expected canonical non-negative integer.`
                )
            }
        }
    } catch (err) {
        if (err instanceof ValidationError) throw err
    }
    return {
        ...(scopeFilter.workspaceId !== undefined ? { workspaceId: scopeFilter.workspaceId } : {}),
        ...(explicitZeroProject
            ? { projectNumber: 0 }
            : scopeFilter.projectNumber !== undefined
              ? { projectNumber: scopeFilter.projectNumber }
              : {}),
    }
}

async function fetchAuditEntries(auditLogger: AuditLogger, uri: string): Promise<AuditEntry[]> {
    const scopeFilter = parseAuditResourceQueryScope(uri)
    const hasScopeFilter =
        scopeFilter.workspaceId !== undefined || scopeFilter.projectNumber !== undefined
    if (!hasScopeFilter) {
        return auditLogger.recent(50)
    }
    const searchFilter = {
        ...(scopeFilter.workspaceId !== undefined
            ? { workspace_id: scopeFilter.workspaceId }
            : {}),
        ...(scopeFilter.projectNumber !== undefined
            ? { project_number: scopeFilter.projectNumber }
            : {}),
        limit: 50,
    }
    if (typeof auditLogger.search === 'function') {
        // `search()` reads backwards (newest-first); reverse to match `recent()` chronological order.
        const matched = await auditLogger.search(searchFilter)
        return [...matched].reverse()
    }
    return (await auditLogger.recent(50)).filter((entry) =>
        matchesAuditFilters(entry, searchFilter)
    )
}

function computeSessionSummary(entries: AuditEntry[]): {
    totalTokens: number
    errorCount: number
    totalDuration: number
} {
    let totalTokens = 0
    let errorCount = 0
    let totalDuration = 0
    for (const e of entries) {
        totalTokens += e.tokenEstimate ?? 0
        totalDuration += e.durationMs
        if (!e.success) errorCount++
    }
    return { totalTokens, errorCount, totalDuration }
}

const CANONICAL_AUDIT_ID_RE =
    /^(?:resource:|prompt:)?(?:memory:\/\/[A-Za-z0-9_./-]+|[A-Za-z0-9_.:@-]{1,128})$/
const ISO_AUDIT_TS_RE = /^\d{4}-\d{2}-\d{2}T[0-9:.+-Z]{6,32}$/

function sanitizeAuditCategory(raw: unknown): AuditEntry['category'] {
    switch (raw) {
        case 'read':
        case 'write':
        case 'admin':
        case 'team':
        case 'audit':
            return raw
        default:
            return 'read'
    }
}

function fenceNonCanonicalAuditId(value: unknown): string {
    if (typeof value !== 'string') return ''
    const clean = sanitizeErrorForLogging(value)
    return CANONICAL_AUDIT_ID_RE.test(clean) && clean.length <= 256
        ? clean
        : sliceUntrustedInline(clean, 256, '...')
}

function sanitizeAuditArgNode(value: unknown, depth: number, seen: WeakSet<object>): unknown {
    if (typeof value === 'string') {
        return sliceUntrustedInline(sanitizeErrorForLogging(value), 2048, '...')
    }
    if (typeof value === 'bigint') return value.toString()
    if (value === null || typeof value !== 'object') return value
    if (seen.has(value)) return '[Circular]'
    if (depth >= 6) return '[Truncated]'
    seen.add(value)

    try {
        if (Array.isArray(value)) {
            return value.map((item) => sanitizeAuditArgNode(item, depth + 1, seen))
        }
        const out: Record<string, unknown> = {}
        Object.setPrototypeOf(out, null)
        for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
            out[k] = SENSITIVE_KEY_RE.test(k)
                ? '[REDACTED]'
                : sanitizeAuditArgNode(v, depth + 1, seen)
        }
        return out
    } finally {
        seen.delete(value)
    }
}

/** Fence untrusted non-canonical audit fields and scrub secret tokens before MCP egress. */
export function sanitizeAuditEntryForEgress(e: AuditEntry): AuditEntry {
    const isPlainArgs = typeof e.args === 'object' && e.args !== null && !Array.isArray(e.args)
    const cleanArgs = isPlainArgs
        ? (sanitizeAuditArgNode(e.args, 0, new WeakSet()) as Record<string, unknown>)
        : undefined
    const rawSuccess: unknown = e.success
    const safeTimestamp =
        typeof e.timestamp === 'string'
            ? ISO_AUDIT_TS_RE.test(e.timestamp)
                ? e.timestamp
                : fenceNonCanonicalAuditId(e.timestamp)
            : ''
    const base: AuditEntry = {
        timestamp: safeTimestamp,
        requestId: typeof e.requestId === 'string' ? fenceNonCanonicalAuditId(e.requestId) : '',
        tool: typeof e.tool === 'string' ? fenceNonCanonicalAuditId(e.tool) : '',
        category: sanitizeAuditCategory(e.category),
        scope: typeof e.scope === 'string' ? fenceNonCanonicalAuditId(e.scope) : '',
        user: typeof e.user === 'string' ? fenceNonCanonicalAuditId(e.user) : null,
        scopes: Array.isArray(e.scopes)
            ? e.scopes.filter((s): s is string => typeof s === 'string').map(fenceNonCanonicalAuditId)
            : [],
        durationMs: typeof e.durationMs === 'number' ? e.durationMs : 0,
        tokenEstimate: typeof e.tokenEstimate === 'number' ? e.tokenEstimate : 0,
        success: rawSuccess === true,
    }
    if (typeof e.sessionId === 'string') base.sessionId = fenceNonCanonicalAuditId(e.sessionId)
    if (typeof e.workspaceId === 'string') {
        base.workspaceId = fenceNonCanonicalAuditId(e.workspaceId)
    }
    if (typeof e.projectNumber === 'number') base.projectNumber = e.projectNumber
    if (typeof e.error === 'string') {
        base.error = sliceUntrustedInline(sanitizeErrorForLogging(e.error), 2048, '...')
    }
    if (cleanArgs !== undefined) base.args = cleanArgs
    return base
}

function formatAuditEntryYaml(e: AuditEntry): string {
    const safe = sanitizeAuditEntryForEgress(e)
    const tsOut = ISO_AUDIT_TS_RE.test(safe.timestamp)
        ? safe.timestamp
        : JSON.stringify(safe.timestamp)
    const scopeOut = /^[a-z]*$/.test(safe.scope) ? safe.scope : JSON.stringify(safe.scope)
    const parts: string[] = [
        `- timestamp: ${tsOut}`,
        `  tool: ${JSON.stringify(safe.tool)}`,
        `  scope: ${scopeOut}`,
        `  category: ${safe.category}`,
        `  duration_ms: ${String(safe.durationMs)}`,
        `  success: ${String(safe.success)}`,
    ]
    if (safe.error) {
        parts.push(`  error: ${JSON.stringify(safe.error)}`)
    }
    if (safe.workspaceId !== undefined) {
        parts.push(`  workspace_id: ${JSON.stringify(safe.workspaceId)}`)
    }
    if (safe.projectNumber !== undefined) {
        parts.push(`  project_number: ${String(safe.projectNumber)}`)
    }
    if (safe.tokenEstimate !== undefined) {
        parts.push(`  token_estimate: ${String(safe.tokenEstimate)}`)
    }
    if (safe.args !== undefined) {
        parts.push(`  args: ${JSON.stringify(safe.args)}`)
    }
    return parts.join('\n')
}

async function handleAuditResourceRead(
    uri: string,
    getLogger: () => AuditLogger | null
): Promise<ResourceResult> {
    const lastModified = new Date().toISOString()
    const auditLogger = getLogger()

    if (!auditLogger) {
        return {
            data:
                'audit: not configured\n' +
                'hint: Set AUDIT_LOG_PATH env var or --audit-log CLI flag to enable audit logging.',
            annotations: { lastModified },
        }
    }

    const entries = await fetchAuditEntries(auditLogger, uri)
    if (entries.length === 0) {
        const note =
            typeof auditLogger.isStderrOnly === 'function' && auditLogger.isStderrOnly()
                ? 'note: AUDIT_LOG_PATH=stderr is write-only; historical telemetry events are emitted to stderr rather than buffered on disk.'
                : 'note: No write/admin operations have been audited yet.'
        return {
            data: `audit_log: ${auditLogger.config.logPath}\nentries: 0\n${note}`,
            annotations: { lastModified },
        }
    }

    const { totalTokens, errorCount, totalDuration } = computeSessionSummary(entries)
    const formattedEntries = entries.map(formatAuditEntryYaml).join('\n')
    const text =
        `audit_log: ${auditLogger.config.logPath}\n` +
        `entries_shown: ${String(entries.length)}\n` +
        `as_of: ${lastModified}\n` +
        `session_summary:\n` +
        `  total_tokens: ${String(totalTokens)}\n` +
        `  total_duration_ms: ${String(totalDuration)}\n` +
        `  error_count: ${String(errorCount)}\n` +
        `  dropped_count: ${String(auditLogger.droppedCount)}\n` +
        `  redact_mode: ${String(auditLogger.config.redact)}\n\n` +
        formattedEntries

    return {
        data: text,
        annotations: { lastModified },
    }
}

// ============================================================================
// Resource Factory
// ============================================================================

/**
 * Returns the InternalResourceDef for memory://audit.
 * The AuditLogger instance is bound at creation time.
 *
 * @param getLogger - A function that returns the current AuditLogger instance (or null).
 *                    Using a getter function avoids capturing a null reference at registration
 *                    time — the logger may not exist yet when resources are registered.
 */
export function getAuditResourceDef(getLogger: () => AuditLogger | null): InternalResourceDef {
    return {
        uri: 'memory://audit',
        name: 'Audit Log',
        title: 'Operational Telemetry Log (last 50 entries)',
        description:
            'Last 50 write/admin tool call telemetry entries from the JSONL log. ' +
            'Each entry includes tool name, scope, duration, token estimates, and error status. ' +
            'Includes a session summary with total token consumption and error count.',
        mimeType: 'text/plain',
        annotations: {
            ...ASSISTANT_FOCUSED,
        },
        capabilities: {
            requiresAuditScope: true,
        },
        handler: (uri: string, _context: ResourceContext): Promise<ResourceResult> =>
            handleAuditResourceRead(uri, getLogger),
    }
}
