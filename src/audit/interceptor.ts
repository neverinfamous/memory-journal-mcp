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
import { DUMMY_FS_TOOL_SET, getRequiredScope } from '../auth/scope-map.js'
import { getToolGroup } from '../filtering/tool-filter.js'
import { getAuthContext } from '../auth/auth-context.js'
import { getGrantedAuthScopes } from '../auth/validation.js'
import { getRequestContext } from '../utils/request-context.js'
import { sanitizeErrorForLogging } from '../utils/security-utils.js'
import { scrubAuditArgs } from './audit-arg-scrubber.js'
import { estimateTokens, estimatePayloadTokens } from '../observability/token-estimator.js'
import {
    applyActiveSessionScopeFallback,
    estimateOperationResultTokens,
    extractAuditScopeFromUriDetails,
    extractSensitiveTargetFromArgs,
    isSensitiveAuditTarget,
    resolveResourceAuditCategory,
    type AuditScopeMetadata,
} from './audit-query-helpers.js'
import { resolveToolCallAuditScope } from './audit-file-helpers.js'

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

function inspectToolResult(
    result: unknown,
    computeTokens = true
): {
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
    if (computeTokens) {
        if (typeof result === 'object' && result !== null) {
            tokenEstimate = estimatePayloadTokens(result)
        } else if (typeof result === 'string') {
            tokenEstimate = estimateTokens(result, 'prose')
        }
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
    const isMemorySensitiveTarget =
        sensitiveTarget !== undefined && /^memory:\/\//i.test(sensitiveTarget)
    const readCategory =
        sensitiveTarget !== undefined ? resolveResourceAuditCategory(sensitiveTarget) : 'read'
    const category =
        isReadScope || isMemorySensitiveTarget ? readCategory : scopeToCategory(scope)
    const effectiveScope =
        isReadScope && (readCategory === 'audit' || readCategory === 'team' || readCategory === 'admin')
            ? readCategory
            : scope
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
    fn: () => Promise<T>,
    runtime?: object | null
): Promise<T> {
    const scope = getRequiredScope(toolName)
    const isReadScope = scope === 'read'
    const canTargetSensitiveResourceOrPrompt =
        DUMMY_FS_TOOL_SET.has(toolName) ||
        (isReadScope &&
            (/^memory:\/\//i.test(toolName) ||
                toolName === 'read_resource' ||
                toolName === 'get_prompt' ||
                getToolGroup(toolName) === undefined))
    const sensitiveTarget = canTargetSensitiveResourceOrPrompt
        ? extractSensitiveTargetFromArgs(toolName, args)
        : undefined

    // Read-scoped tools are only audited when --audit-reads is enabled or targeting a sensitive URI/prompt
    if (!ALWAYS_AUDITED_SCOPES.has(scope) && !auditReads && sensitiveTarget === undefined) {
        return fn()
    }

    const authCtx = getAuthContext()
    const reqCtx = getRequestContext()
    const user = authCtx?.authenticated === true ? (authCtx.claims?.sub ?? null) : null
    const scopes = getGrantedAuthScopes(authCtx)
    const sessionId = reqCtx?.sessionId
    const scopeMeta = resolveToolCallAuditScope(
        toolName,
        args,
        canTargetSensitiveResourceOrPrompt,
        sensitiveTarget,
        reqCtx,
        runtime
    )
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
export function createAuditInterceptor(
    auditLogger: AuditLogger,
    runtime?: object | null
): AuditInterceptor {
    const auditReads = auditLogger.config.auditReads

    return {
        around<T>(toolName: string, args: unknown, fn: () => Promise<T>): Promise<T> {
            return executeAuditedTool(auditLogger, auditReads, toolName, args, fn, runtime)
        },
    }
}

export interface AuditOperationOptions {
    forceAudit?: boolean | undefined
    resourceUri?: string | undefined
    workspaceId?: string | undefined
    projectNumber?: number | undefined
    runtime?: object | null | undefined
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

function resolveAuditOperationScope(
    target: string,
    operationType: 'resource' | 'prompt',
    reqCtx: ReturnType<typeof getRequestContext>,
    options?: AuditOperationOptions
): AuditScopeMetadata {
    if (operationType === 'prompt') {
        return {
            ...(options?.workspaceId !== undefined ? { workspaceId: options.workspaceId } : {}),
            ...(options?.projectNumber !== undefined ? { projectNumber: options.projectNumber } : {}),
        }
    }
    const uriDetails = extractAuditScopeFromUriDetails(target)
    const uriScope = uriDetails.scope
    const uriWildcard = uriDetails.explicitWildcardWorkspace
    const uriInvalidProj = uriDetails.explicitInvalidProject
    const merged: AuditScopeMetadata = {
        ...(options?.workspaceId !== undefined || uriScope.workspaceId !== undefined
            ? { workspaceId: options?.workspaceId ?? uriScope.workspaceId }
            : {}),
        ...(options?.projectNumber !== undefined || uriScope.projectNumber !== undefined
            ? { projectNumber: options?.projectNumber ?? uriScope.projectNumber }
            : {}),
    }
    const wildcardWs =
        options?.workspaceId !== undefined ? options.workspaceId.trim() === '*' : uriWildcard
    const suppressFallback =
        options?.projectNumber === undefined &&
        options?.workspaceId?.trim() !== '*' &&
        uriInvalidProj
    return applyActiveSessionScopeFallback(merged, reqCtx, wildcardWs, options?.runtime, suppressFallback)
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
    const user = authCtx?.authenticated === true ? (authCtx.claims?.sub ?? null) : null
    const scopes = getGrantedAuthScopes(authCtx)
    const sessionId = reqCtx?.sessionId
    const effectiveScope = resolveAuditOperationScope(target, operationType, reqCtx, options)
    const workspaceId = effectiveScope.workspaceId
    const projectNumber = effectiveScope.projectNumber
    const category = resolveAuditOperationCategory(target, options?.capabilities)

    const requestId = generateRequestId()
    const start = performance.now()
    let success = false
    let error: string | undefined
    let tokenEstimate: number | undefined

    try {
        const result = await fn()
        const inspected = inspectToolResult(result, false)
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
