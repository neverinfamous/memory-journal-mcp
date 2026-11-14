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

import { performance } from 'node:perf_hooks'
import type { AuditLogger } from './audit-logger.js'
import type { AuditCategory } from './types.js'
import { getRequiredScope } from '../auth/scope-map.js'
import { getAuthContext } from '../auth/auth-context.js'
import { getRequestContext } from '../utils/request-context.js'
import { sanitizeErrorForLogging } from '../utils/security-utils.js'
import { estimateTokens, estimatePayloadTokens } from '../observability/token-estimator.js'
import { logger } from '../utils/logger.js'
import {
    extractAuditScopeFromArgs,
    extractAuditScopeFromUri,
    isSensitiveAuditTarget,
    resolveResourceAuditCategory,
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
 * Format: "aud-<timestamp-hex>-<random>"
 */
function generateRequestId(): string {
    const ts = Date.now().toString(36)
    const rand = Math.random().toString(36).slice(2, 8)
    return `aud-${ts}-${rand}`
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
        async around<T>(toolName: string, args: unknown, fn: () => Promise<T>): Promise<T> {
            const scope = getRequiredScope(toolName)

            // Read-scoped tools are only audited when --audit-reads is enabled
            if (!ALWAYS_AUDITED_SCOPES.has(scope) && !auditReads) {
                return fn()
            }

            const isReadScope = scope === 'read'

            const authCtx = getAuthContext()
            const reqCtx = getRequestContext()
            const user = authCtx?.claims?.sub ?? null
            const scopes = authCtx?.claims?.scopes ?? []
            const sessionId = reqCtx?.sessionId

            const scopeMeta = extractAuditScopeFromArgs(args, reqCtx)

            const requestId = generateRequestId()
            const start = performance.now()
            let success = true
            let error: string | undefined
            let tokenEstimate: number | undefined

            try {
                const result = await fn()

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

                return result
            } catch (err) {
                success = false
                error = sanitizeErrorForLogging(err instanceof Error ? err.message : String(err))

                // Compute token estimate for the error response
                const errorResult = {
                    success: false,
                    error,
                    code: 'INTERNAL_ERROR',
                    category: 'internal',
                    recoverable: false,
                }
                const enriched = JSON.stringify({
                    ...errorResult,
                    _meta: { tokenEstimate: 0 },
                })
                tokenEstimate = estimateTokens(enriched, 'json')

                throw err // Re-throw — don't swallow
            } finally {
                const durationMs = Math.round(performance.now() - start)
                const scopeFields = {
                    ...(scopeMeta.workspaceId !== undefined
                        ? { workspaceId: scopeMeta.workspaceId }
                        : {}),
                    ...(scopeMeta.projectNumber !== undefined
                        ? { projectNumber: scopeMeta.projectNumber }
                        : {}),
                }

                if (isReadScope) {
                    // Compact read entries — omit args, user, scopes for ~100 byte entries
                    auditLogger.log({
                        timestamp: new Date().toISOString(),
                        requestId,
                        tool: toolName,
                        category: 'read',
                        scope,
                        user,
                        scopes,
                        sessionId,
                        durationMs,
                        success,
                        error,
                        tokenEstimate,
                        ...scopeFields,
                    })
                } else {
                    auditLogger.log({
                        timestamp: new Date().toISOString(),
                        requestId,
                        tool: toolName,
                        category: scopeToCategory(scope),
                        scope,
                        user,
                        scopes,
                        sessionId,
                        durationMs,
                        success,
                        error,
                        args: auditLogger.config.redact
                            ? undefined
                            : (args as Record<string, unknown>),
                        tokenEstimate,
                        ...scopeFields,
                    })
                }
            }
        },
    }
}

export interface AuditOperationOptions {
    forceAudit?: boolean | undefined
    resourceUri?: string | undefined
    workspaceId?: string | undefined
    projectNumber?: number | undefined
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
        options?.forceAudit === true || isSensitiveAuditTarget(target)
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
    const category = resolveResourceAuditCategory(target)

    const requestId = generateRequestId()
    const start = performance.now()
    let success = true
    let error: string | undefined
    let tokenEstimate: number | undefined

    try {
        const result = await fn()
        if (typeof result === 'object' && result !== null) {
            try {
                const json = JSON.stringify(result)
                tokenEstimate = estimateTokens(json, 'json')
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
            }
        } else if (typeof result === 'string') {
            tokenEstimate = estimateTokens(result, 'prose')
        }
        return result
    } catch (err) {
        success = false
        error = sanitizeErrorForLogging(err instanceof Error ? err.message : String(err))
        throw err
    } finally {
        const durationMs = Math.round(performance.now() - start)
        auditLogger.log({
            timestamp: new Date().toISOString(),
            requestId,
            sessionId,
            tool: `${operationType}:${name}`,
            category,
            scope: category === 'audit' || category === 'team' ? category : 'read',
            user,
            scopes,
            durationMs,
            success,
            error,
            tokenEstimate,
            ...(workspaceId !== undefined ? { workspaceId } : {}),
            ...(projectNumber !== undefined ? { projectNumber } : {}),
        })
    }
}
