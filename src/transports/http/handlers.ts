/**
 * memory-journal-mcp — HTTP Transport Handlers
 *
 * Standalone handler functions for utility endpoints and auth middleware.
 */

import { timingSafeEqual, createHash } from 'node:crypto'
import type { Request, Response } from 'express'
import { logger } from '../../utils/logger.js'
import { VERSION } from '../../version.js'
import { isValidScope, hasScope, SCOPES } from '../../auth/scopes.js'
import { getAuthContext } from '../../auth/auth-context.js'
import { getClientIp } from './security.js'
import type { ServerRuntime } from '../../utils/maintenance-lock.js'
import { formatPrometheusMetrics } from '../../observability/index.js'

// =============================================================================
// Health Check
// =============================================================================

/**
 * Handle the /health endpoint
 */
export function handleHealthCheck(_req: Request, res: Response): void {
    res.status(200).json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
    })
}

// =============================================================================
// Prometheus Metrics
// =============================================================================

/**
 * Handle the /metrics endpoint (Prometheus format)
 */
export function handlePrometheusMetrics(runtime: ServerRuntime): (req: Request, res: Response) => void {
    return (_req: Request, res: Response): void => {
        if (runtime?.metrics === undefined) {
            res.status(503).send('Metrics not available')
            return
        }

        try {
            const authCtx = getAuthContext()
            const grantedScopes =
                authCtx?.authenticated === true
                    ? (authCtx.claims?.scopes ?? authCtx.scopes)
                    : []
            const includeUserBreakdown = hasScope(grantedScopes, SCOPES.AUDIT)
            const metricsText = formatPrometheusMetrics(runtime.metrics, { includeUserBreakdown })
            res.set('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
            res.set('Cache-Control', 'no-store')
            res.set('X-Content-Type-Options', 'nosniff')
            res.status(200).send(metricsText)
        } catch (error) {
            logger.error('Failed to format Prometheus metrics', { module: 'HTTP', error })
            res.status(500).send('Internal Server Error')
        }
    }
}

// =============================================================================
// Root Info
// =============================================================================

/**
 * Handle the / endpoint — helpful for browser visitors and debugging
 */
export function handleRootInfo(_req: Request, res: Response): void {
    res.status(200).json({
        name: 'memory-journal-mcp',
        version: VERSION,
        description: 'Project context management for AI-assisted development',
        endpoints: {
            'POST /mcp': 'JSON-RPC requests (Streamable HTTP, MCP 2025-03-26)',
            'GET /mcp': 'SSE stream for server-to-client notifications',
            'DELETE /mcp': 'Session termination',
            'GET /sse': 'Legacy SSE connection (MCP 2024-11-05)',
            'POST /messages': 'Legacy SSE message endpoint',
            'GET /health': 'Health check',
            'GET /metrics': 'Prometheus metrics export (if enabled)',
        },
        documentation: 'https://github.com/neverinfamous/memory-journal-mcp',
    })
}

// =============================================================================
// Bearer Token Auth Middleware
// =============================================================================

let cachedScopeEnv: string | undefined
let cachedParsedScopes: string[] | undefined

function resolveBearerDefaultScopes(): string[] {
    const envScopes = process.env['MCP_AUTH_SCOPES']
    if (cachedParsedScopes !== undefined && cachedScopeEnv === envScopes) {
        return cachedParsedScopes
    }
    const parsedScopes = envScopes
        ? envScopes
              .split(/[\s,]+/)
              .map((s) => s.trim())
              .filter(Boolean)
        : []
    let defaultScopes = parsedScopes.length > 0 ? parsedScopes : ['read']
    const invalidScopes = defaultScopes.filter((s) => !isValidScope(s))
    if (invalidScopes.length > 0) {
        logger.warning(
            `Invalid MCP_AUTH_SCOPES detected: ${invalidScopes.join(', ')}. Falling back to safe defaults.`,
            { module: 'HTTP' }
        )
        defaultScopes = ['read']
    }
    cachedScopeEnv = envScopes
    cachedParsedScopes = defaultScopes
    return defaultScopes
}

function isValidBearerTokenDigest(
    authHeader: string | undefined,
    expectedDigest: Buffer | null
): boolean {
    if (typeof authHeader !== 'string' || expectedDigest === null) return false
    const spaceIdx = authHeader.indexOf(' ')
    if (spaceIdx === -1) return false
    if (authHeader.slice(0, spaceIdx).toLowerCase() !== 'bearer') return false
    const providedDigest = createHash('sha256').update(authHeader.slice(spaceIdx + 1), 'utf8').digest()
    return timingSafeEqual(expectedDigest, providedDigest)
}

/**
 * Create a bearer token authentication middleware.
 * Bypasses only GET/HEAD /health. [INVARIANT] /metrics exposes per-tool/per-user telemetry and requires
 * the bearer token like every other route (M6).
 */
export function createAuthMiddleware(
    authToken: string
): (req: Request, res: Response, next: () => void) => void {
    logger.info('Bearer token authentication enabled', { module: 'HTTP' })
    const expectedDigest =
        authToken.trim() !== '' ? createHash('sha256').update(authToken, 'utf8').digest() : null

    return (req: Request, res: Response, next: () => void): void => {
        if ((req.method === 'GET' || req.method === 'HEAD') && req.path === '/health') {
            next()
            return
        }

        if (!isValidBearerTokenDigest(req.headers.authorization, expectedDigest)) {
            res.status(401).json({ error: 'Unauthorized' })
            return
        }

        const defaultScopes = resolveBearerDefaultScopes()

        // Bind an explicit identity for shared bearer mode so that stateful sessions
        // can enforce tenant isolation even without OAuth.

        // Derive identity from token securely.
        // We cannot use a random nonce or mcp-session-id here because standard MCP SDK clients
        // do not send mcp-session-id during initialization, which would cause the identity hash
        // to change between initialization and subsequent requests, breaking stateful sessions.
        // We bind the client IP to the hash to provide strict session isolation for shared tokens.
        const clientIp = getClientIp(req)
        const hashInput = `${authToken}:${clientIp}`

        const identityHash = createHash('sha256').update(hashInput).digest('hex').substring(0, 12)
        const identity = `bearer-${identityHash}`

        Object.assign(req, {
            auth: {
                sub: identity,
                subject: identity,
                scopes: defaultScopes,
            },
        })
        next()
    }
}
