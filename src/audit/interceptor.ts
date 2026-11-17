/**
 * memory-journal-mcp — Audit Interceptor
 *
 * Wraps tool execution to produce audit entries for all tool
 * invocations. Write/admin tools are always logged; read-scoped
 * tools are logged only when `--audit-reads` is enabled.
 *
 * Each entry includes a `tokenEstimate` (~4 bytes per token)
 * computed from the serialized result size.
 *
 * The interceptor is injected into the tool handler cache
 * (ensureToolCache in handlers/tools/index.ts) so that all
 * tool handlers are audited without per-handler changes.
 */

import { randomBytes } from 'node:crypto'
import { performance } from 'node:perf_hooks'
import type { AuditLogger } from './audit-logger.js'
import type { AuditCategory, AuditEntry } from './types.js'
import { getRequiredScope } from '../auth/scope-map.js'
import { getAuthContext } from '../auth/auth-context.js'
import { getRequestContext } from '../utils/request-context.js'
import { sanitizeErrorForLogging } from '../utils/security-utils.js'
import { estimateTokens, estimatePayloadTokens } from '../observability/token-estimator.js'
import { logger } from '../utils/logger.js'
import {
    extractAuditScopeFromArgs,
    extractAuditScopeFromUri,
    extractSensitiveTargetFromArgs,
    isSensitiveAuditTarget,
    resolveResourceAuditCategory,
    type AuditScopeMetadata,
} from './audit-query-helpers.js'

// ============================================================================
// Types
// ============================================================================

/** Tool handler function signature that the interceptor wraps */
export type AuditToolHandlerFn = (args: Record<string, unknown>) => Promise<unknown>

/**
 * Audit interceptor interface — provides an `around` method
 * to wrap tool execution with audit logging.
 */
export interface AuditInterceptor {
    /**
     * Wrap a tool invocation with audit logging.
     * Returns the tool result unchanged; re-throws any errors.
     *
     * @param toolName  MCP tool name
     * @param args      Tool input arguments
     * @param fn        The actual tool handler to execute
     */
    around<T>(toolName: string, args: unknown, fn: () => Promise<T>): Promise<T>
}

// ============================================================================
// Constants
// ============================================================================

/**
 * Write/admin scopes are always audited.
 * Read scope is audited only when `auditReads` is enabled.
 */
const ALWAYS_AUDITED_SCOPES = new Set(['write', 'admin', 'team', 'audit'])

// ============================================================================
// Helpers
// ============================================================================

/**
 * Map a scope string to an AuditCategory.
 */
function scopeToCategory(scope: string): AuditCategory {
    if (scope === 'admin') return 'admin'
    if (scope === 'team') return 'team'
    if (scope === 'audit') return 'audit'
    if (scope === 'read') return 'read'
    return 'write'
}

/**
 * Generate a short request ID for audit correlation.
 * Format: "aud-<timestamp-hex>-<random>". The suffix is cryptographic so
 * audit ids are not predictable from Math.random().
 */
function generateRequestId(): string {
    const ts = Date.now().toString(36)
    const rand = randomBytes(4).toString('hex')
    return `aud-${ts}-${rand}`
}

function inspectToolResult(result: unknown): {
    success: boolean
    error?: string
    tokenEstimate?: number
} {
    let success = true
    let error: string | undefined
    let tokenEstimate: number | undefined

    if (
        typeof result === 'object' &&
        result !== null &&
        'success' in result &&
        (result as Record<string, unknown>)['success'] === false
    ) {
        success = false
        const errField = (result as Record<string, unknown>)['error']
        if (typeof errField === 'string') {
            error = sanitizeErrorForLogging(errField)
        }
    }

    // Compute token estimate from result (uses WeakMap cache when metrics interceptor already computed it)
    if (typeof result === 'object' && result !== null) {
        tokenEstimate = estimatePayloadTokens(result)
    } else if (typeof result === 'string') {
        tokenEstimate = estimateTokens(result, 'prose')
    }

    return {
        success,
        ...(error !== undefined ? { error } : {}),
        ...(tokenEstimate !== undefined ? { tokenEstimate } : {}),
    }
}

function estimateErrorTokens(sanitizedError: string): number {
    const errorResult = {
        success: false,
        error: sanitizedError,
        code: 'INTERNAL_ERROR',
        category: 'internal',
        recoverable: false,
    }
    const enriched = JSON.stringify({
        ...errorResult,
        _meta: { tokenEstimate: 0 },
    })
    return estimateTokens(enriched, 'json')
}

const AUDIT_SENSITIVE_KEY_RE =
    /(?:token|secret|password|passwd|authorization|auth_header|api_key|apikey|encryption_key|webhook|private_key|client_secret)/i
const MAX_SCRUB_DEPTH = 6

function scrubAuditArgValue(val: unknown, depth: number, seen: WeakSet<object>): unknown {
    if (typeof val === 'string') return sanitizeErrorForLogging(val)
    if (val === null || typeof val !== 'object') return val
    if (depth >= MAX_SCRUB_DEPTH || seen.has(val)) return val
    seen.add(val)

    if (Array.isArray(val)) {
        return val.map((item) => scrubAuditArgValue(item, depth + 1, seen))
    }
    const out: Record<string, unknown> = {}
    Object.setPrototypeOf(out, null)
    for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
        out[k] = AUDIT_SENSITIVE_KEY_RE.test(k)
            ? '[REDACTED]'
            : scrubAuditArgValue(v, depth + 1, seen)
    }
    return out
}

function scrubAuditArgs(args: unknown): Record<string, unknown> | undefined {
    if (typeof args !== 'object' || args === null || Array.isArray(args)) return undefined
    return scrubAuditArgValue(args, 0, new WeakSet()) as Record<string, unknown>
}

function buildToolAuditEntry(params: {
    requestId: string
    toolName: string
    scope: string
    sensitiveTarget: string | undefined
    user: string | null
    scopes: string[]
    sessionId: string | undefined
    durationMs: number
    success: boolean
    error: string | undefined
    tokenEstimate: number | undefined
    redact: boolean
    args: unknown
    scopeMeta: AuditScopeMetadata
}): AuditEntry {
    const {
        requestId,
        toolName,
        scope,
        sensitiveTarget,
        user,
        scopes,
        sessionId,
        durationMs,
        success,
        error,
        tokenEstimate,
        redact,
        args,
        scopeMeta,
    } = params
    const isReadScope = scope === 'read'
    const readCategory =
        sensitiveTarget !== undefined ? resolveResourceAuditCategory(sensitiveTarget) : 'read'
    const category = isReadScope ? readCategory : scopeToCategory(scope)
    const effectiveScope =
        isReadScope && (readCategory === 'audit' || readCategory === 'team') ? readCategory : scope
    const sanitizedError = error !== undefined ? sanitizeErrorForLogging(error) : undefined
    const scrubbedArgs = !isReadScope && !redact ? scrubAuditArgs(args) : undefined

    return {
        timestamp: new Date().toISOString(),
        requestId,
        tool: toolName,
        category,
        scope: effectiveScope,
        user,
        scopes,
        ...(sessionId !== undefined ? { sessionId } : {}),
        durationMs,
        success,
        ...(sanitizedError !== undefined ? { error: sanitizedError } : {}),
        ...(scrubbedArgs !== undefined ? { args: scrubbedArgs } : {}),
        ...(tokenEstimate !== undefined ? { tokenEstimate } : {}),
        ...(scopeMeta.workspaceId !== undefined ? { workspaceId: scopeMeta.workspaceId } : {}),
        ...(scopeMeta.projectNumber !== undefined
            ? { projectNumber: scopeMeta.projectNumber }
            : {}),
    }
}

async function executeAuditedTool<T>(
    auditLogger: AuditLogger,
    auditReads: boolean,
    toolName: string,
    args: unknown,
    fn: () => Promise<T>
): Promise<T> {
    const scope = getRequiredScope(toolName)
    const sensitiveTarget = extractSensitiveTargetFromArgs(toolName, args)

    // Read-scoped tools are only audited when --audit-reads is enabled or targeting a sensitive URI/prompt
    if (!ALWAYS_AUDITED_SCOPES.has(scope) && !auditReads && sensitiveTarget === undefined) {
        return fn()
    }

    const authCtx = getAuthContext()
    const reqCtx = getRequestContext()
    const user = authCtx?.claims?.sub ?? null
    const scopes = authCtx?.claims?.scopes ?? []
    const sessionId = reqCtx?.sessionId
    const scopeMeta = extractAuditScopeFromArgs(args, reqCtx)
    const requestId = generateRequestId()
    const start = performance.now()
    let success = false
    let error: string | undefined
    let tokenEstimate: number | undefined

    try {
        const result = await fn()
        const inspected = inspectToolResult(result)
        success = inspected.success
        error = inspected.error
        tokenEstimate = inspected.tokenEstimate
        return result
    } catch (err) {
        error = sanitizeErrorForLogging(err instanceof Error ? err.message : String(err))
        tokenEstimate = estimateErrorTokens(error)
        throw err
    } finally {
        auditLogger.log(
            buildToolAuditEntry({
                requestId,
                toolName,
                scope,
                sensitiveTarget,
                user,
                scopes,
                sessionId,
                durationMs: Math.round(performance.now() - start),
                success,
                error,
                tokenEstimate,
                redact: auditLogger.config.redact,
                args,
                scopeMeta,
            })
        )
    }
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Create an audit interceptor bound to the given logger.
 *
 * @param auditLogger  The JSONL audit logger
 */
export function createAuditInterceptor(auditLogger: AuditLogger): AuditInterceptor {
    const auditReads = auditLogger.config.auditReads

    return {
        around<T>(toolName: string, args: unknown, fn: () => Promise<T>): Promise<T> {
            return executeAuditedTool(auditLogger, auditReads, toolName, args, fn)
        },
    }
}

export interface AuditOperationOptions {
    forceAudit?: boolean | undefined
    resourceUri?: string | undefined
    workspaceId?: string | undefined
    projectNumber?: number | undefined
    capabilities?:
        | {
              requiresTeamScope?: boolean
              requiresAuditScope?: boolean
              requiresAdminScope?: boolean
          }
        | undefined
}

function resolveAuditOperationCategory(
    target: string,
    capabilities?: AuditOperationOptions['capabilities']
): AuditCategory {
    if (capabilities?.requiresAdminScope === true) return 'admin'
    if (capabilities?.requiresAuditScope === true) return 'audit'
    if (capabilities?.requiresTeamScope === true) return 'team'
    return resolveResourceAuditCategory(target)
}

function estimateOperationResultTokens(result: unknown, name: string): number | undefined {
    if (typeof result === 'object' && result !== null) {
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

/**
 * Execute an operation with audit logging.
 * Intended for resources and prompts which operate outside the standard tool interceptor.
 */
export async function auditOperation<T>(
    auditLogger: AuditLogger | null,
    operationType: 'resource' | 'prompt',
    name: string,
    fn: () => Promise<T> | T,
    options?: AuditOperationOptions
): Promise<T> {
    const target = options?.resourceUri ?? name
    const isSensitiveResource =
        options?.forceAudit === true ||
        options?.capabilities?.requiresAdminScope === true ||
        isSensitiveAuditTarget(target, options?.capabilities)
    if (
        !auditLogger ||
        !auditLogger.config.enabled ||
        (!auditLogger.config.auditReads && !isSensitiveResource)
    ) {
        return Promise.resolve(fn())
    }

    const authCtx = getAuthContext()
    const reqCtx = getRequestContext()
    const user = authCtx?.claims?.sub ?? null
    const scopes = authCtx?.claims?.scopes ?? []
    const sessionId = reqCtx?.sessionId
    const uriScope = extractAuditScopeFromUri(target, reqCtx)
    const workspaceId = options?.workspaceId ?? uriScope.workspaceId
    const projectNumber = options?.projectNumber ?? uriScope.projectNumber
    const category = resolveAuditOperationCategory(target, options?.capabilities)

    const requestId = generateRequestId()
    const start = performance.now()
    let success = false
    let error: string | undefined
    let tokenEstimate: number | undefined

    try {
        const result = await fn()
        const inspected = inspectToolResult(result)
        success = inspected.success
        if (inspected.error !== undefined) error = inspected.error
        tokenEstimate = estimateOperationResultTokens(result, name)
        return result
    } catch (err) {
        error = sanitizeErrorForLogging(err instanceof Error ? err.message : String(err))
        throw err
    } finally {
        const durationMs = Math.round(performance.now() - start)
        auditLogger.log({
            timestamp: new Date().toISOString(),
            requestId,
            ...(sessionId !== undefined ? { sessionId } : {}),
            tool: `${operationType}:${name}`,
            category,
            scope:
                category === 'admin' || category === 'audit' || category === 'team'
                    ? category
                    : 'read',
            user,
            scopes,
            durationMs,
            success,
            ...(error !== undefined ? { error } : {}),
            ...(tokenEstimate !== undefined ? { tokenEstimate } : {}),
            ...(workspaceId !== undefined ? { workspaceId } : {}),
            ...(projectNumber !== undefined ? { projectNumber } : {}),
        })
    }
}
