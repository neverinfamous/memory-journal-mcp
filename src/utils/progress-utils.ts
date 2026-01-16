/**
 * Memory Journal MCP Server - Progress Notification Utilities
 *
 * Utilities for sending MCP progress notifications during long-running operations.
 * Follows MCP 2025-11-25 specification for notifications/progress.
 */

// We intentionally use the lower-level Server class to access the notification method

import type { Server } from '@modelcontextprotocol/sdk/server/index.js'

/** Progress token from client request _meta */
export type ProgressToken = string | number

/** Context required to send progress notifications */
export interface ProgressContext {
    /** MCP Server instance for sending notifications */
    // eslint-disable-next-line @typescript-eslint/no-deprecated
    server: Server
    /** Progress token from request _meta (if client requested progress) */
    progressToken?: ProgressToken
}

/**
 * Send a progress notification to the client.
 *
 * Only sends if a progressToken was provided in the original request.
 * Silently no-ops if no token was provided.
 *
 * @param ctx - Progress context with server and optional token
 * @param progress - Current progress value (e.g., items processed)
 * @param total - Optional total value for percentage calculation
 * @param message - Optional human-readable status message
 */
export async function sendProgress(
    ctx: ProgressContext | undefined,
    progress: number,
    total?: number,
    message?: string
): Promise<void> {
    // Early return if no context, no progressToken, or no server
    if (ctx === undefined) return
    if (ctx.progressToken === undefined) return

    try {
        // Use the underlying Protocol's notification method
        // The server extends Protocol which has notification() method
        const notification = {
            method: 'notifications/progress' as const,
            params: {
                progressToken: ctx.progressToken,
                progress,
                ...(total !== undefined && { total }),
                ...(message !== undefined && message !== '' && { message }),
            },
        }

        // Access the notification sender through the server's protocol
        // The Server class exposes notification() which we need to call directly
        await ctx.server.notification(notification)
    } catch {
        // Non-critical: progress notifications are best-effort
        // Don't let notification failures break the operation
    }
}

/**
 * Create a progress reporter function for batch operations.
 *
 * @param ctx - Progress context
 * @param total - Total number of items to process
 * @param throttle - Report every N items (default: 10)
 * @returns Async function to call on each item processed
 */
export function createBatchProgressReporter(
    ctx: ProgressContext | undefined,
    total: number,
    throttle = 10
): (current: number, message?: string) => Promise<void> {
    let lastReported = 0

    return async (current: number, message?: string) => {
        // Report progress at throttle intervals or at completion
        if (current - lastReported >= throttle || current === total) {
            await sendProgress(ctx, current, total, message)
            lastReported = current
        }
    }
}
