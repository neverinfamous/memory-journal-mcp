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
const ALWAYS_AUDITED_SCOPES = new Set(['write', 'admin'])

// ============================================================================
// Helpers
// ============================================================================

/**
 * Map a scope string to an AuditCategory.
 */
function scopeToCategory(scope: string): AuditCategory {
    if (scope === 'admin') return 'admin'
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

            const requestId = generateRequestId()
            const start = performance.now()
            let success = true
            let error: string | undefined
            let tokenEstimate: number | undefined

            try {
                const result = await fn()

                // Compute token estimate from result (~4 bytes per token)
                if (typeof result === 'object' && result !== null) {
                    try {
                        const json = JSON.stringify({
                            ...result,
                            _meta: { tokenEstimate: 0 },
                        })
                        tokenEstimate = Math.ceil(Buffer.byteLength(json, 'utf8') / 4)
                    } catch {
                        // Serialization failure must not block tool execution
                    }
                } else if (typeof result === 'string') {
                    tokenEstimate = Math.ceil(Buffer.byteLength(result, 'utf8') / 4)
                }

                return result
            } catch (err) {
                success = false
                error = err instanceof Error ? err.message : String(err)

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
                tokenEstimate = Math.ceil(Buffer.byteLength(enriched, 'utf8') / 4)

                throw err // Re-throw — don't swallow
            } finally {
                const durationMs = Math.round(performance.now() - start)

                if (isReadScope) {
                    // Compact read entries — omit args, user, scopes for ~100 byte entries
                    auditLogger.log({
                        timestamp: new Date().toISOString(),
                        requestId,
                        tool: toolName,
                        category: 'read' as AuditCategory,
                        scope,
                        user,
                        scopes,
                        sessionId,
                        durationMs,
                        success,
                        error,
                        tokenEstimate,
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
                    })
                }
            }
        },
    }
}

/**
 * Execute an operation with audit logging.
 * Intended for resources and prompts which operate outside the standard tool interceptor.
 */
export async function auditOperation<T>(
    auditLogger: AuditLogger | null,
    operationType: 'resource' | 'prompt',
    name: string,
    fn: () => Promise<T> | T
): Promise<T> {
    if (!auditLogger?.config.auditReads) {
        return Promise.resolve(fn())
    }

    const authCtx = getAuthContext()
    const reqCtx = getRequestContext()
    const user = authCtx?.claims?.sub ?? null
    const scopes = authCtx?.claims?.scopes ?? []
    const sessionId = reqCtx?.sessionId

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
                tokenEstimate = Math.ceil(Buffer.byteLength(json, 'utf8') / 4)
            } catch {
                // Serialization failure must not block execution
            }
        } else if (typeof result === 'string') {
            tokenEstimate = Math.ceil(Buffer.byteLength(result, 'utf8') / 4)
        }
        return result
    } catch (err) {
        success = false
        error = err instanceof Error ? err.message : String(err)
        throw err
    } finally {
        const durationMs = Math.round(performance.now() - start)
        auditLogger.log({
            timestamp: new Date().toISOString(),
            requestId,
            sessionId,
            tool: `${operationType}:${name}`,
            category: 'read',
            scope: 'read',
            user,
            scopes,
            durationMs,
            success,
            error,
            tokenEstimate,
        })
    }
}
