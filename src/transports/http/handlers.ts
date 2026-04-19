/**
 * memory-journal-mcp — HTTP Transport Handlers
 *
 * Standalone handler functions for utility endpoints and auth middleware.
 */

import { timingSafeEqual } from 'node:crypto'
import type { Request, Response } from 'express'
import { logger } from '../../utils/logger.js'
import { VERSION } from '../../version.js'

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
        const defaultScopes = envScopes ? envScopes.split(',').map(s => s.trim()) : ['read', 'write']

        // Bind an explicit identity for shared bearer mode so that stateful sessions
        // can enforce tenant isolation even without OAuth.
        ;(req as unknown as { auth?: { sub?: string; subject?: string; scopes?: string[] } }).auth = {
            sub: 'bearer-client',
            subject: 'bearer-client',
            scopes: defaultScopes
        }
        next()
    }
}
