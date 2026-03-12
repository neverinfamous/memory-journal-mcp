/**
 * memory-journal-mcp — HTTP Transport Handlers
 *
 * Standalone handler functions for utility endpoints and auth middleware.
 */

import { timingSafeEqual } from 'node:crypto'
import type { Request, Response } from 'express'
import { logger } from '../../utils/logger.js'
import pkg from '../../../package.json' with { type: 'json' }

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
        version: pkg.version,
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
    authToken: string,
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
        next()
    }
}
