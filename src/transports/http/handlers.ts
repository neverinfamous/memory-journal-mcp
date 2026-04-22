/**
 * memory-journal-mcp — HTTP Transport Handlers
 *
 * Standalone handler functions for utility endpoints and auth middleware.
 */

import { timingSafeEqual, createHash } from 'node:crypto'
import type { Request, Response } from 'express'
import { logger } from '../../utils/logger.js'
import { VERSION } from '../../version.js'
import { isValidScope } from '../../auth/scopes.js'
import { getClientIp } from './security.js'

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
        },
        documentation: 'https://github.com/neverinfamous/memory-journal-mcp',
    })
}

// =============================================================================
// Bearer Token Auth Middleware
// =============================================================================

/**
 * Create a bearer token authentication middleware.
 * Bypasses /health endpoint. Uses timing-safe comparison.
 */
export function createAuthMiddleware(
    authToken: string
): (req: Request, res: Response, next: () => void) => void {
    logger.info('Bearer token authentication enabled', { module: 'HTTP' })

    return (req: Request, res: Response, next: () => void): void => {
        if (req.path === '/health') {
            next()
            return
        }

        const header = req.headers.authorization
        const expected = Buffer.from(`Bearer ${authToken}`)
        const received = Buffer.from(header ?? '')
        if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
            res.status(401).json({ error: 'Unauthorized' })
            return
        }

        const envScopes = process.env['MCP_AUTH_SCOPES']
        let defaultScopes = envScopes ? envScopes.split(',').map((s) => s.trim()) : ['read']
        const invalidScopes = defaultScopes.filter((s) => !isValidScope(s))
        if (invalidScopes.length > 0) {
            logger.warning(
                `Invalid MCP_AUTH_SCOPES detected: ${invalidScopes.join(', ')}. Falling back to safe defaults.`,
                { module: 'HTTP' }
            )
            defaultScopes = ['read']
        }

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

        ;(req as unknown as { auth?: { sub?: string; subject?: string; scopes?: string[] } }).auth =
            {
                sub: identity,
                subject: identity,
                scopes: defaultScopes,
            }
        next()
    }
}
