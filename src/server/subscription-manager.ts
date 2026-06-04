import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { logger } from '../utils/logger.js'

/**
 * Manages MCP resource subscriptions globally for the server.
 * Tracks which transport sessions are subscribed to which resource URIs,
 * and maintains references to the McpServer instances to broadcast notifications.
 */
export class SubscriptionManager {
    // Map of Session ID (or 'stdio') -> McpServer instance
    private servers = new Map<string, McpServer>()

    // Map of URI string -> Set of Session IDs
    private subscriptions = new Map<string, Set<string>>()

    /**
     * Register a server instance for a session to allow sending notifications.
     */
    public registerServer(sessionId: string, server: McpServer): void {
        this.servers.set(sessionId, server)
    }

    /**
     * Unregister a server instance and clean up its subscriptions.
     */
    public unregisterServer(sessionId: string): void {
        this.servers.delete(sessionId)
        this.unsubscribeSession(sessionId)
    }

    /**
     * Subscribe a session to a resource URI.
     */
    public subscribe(uri: string, sessionId?: string): void {
        if (!sessionId) {
            sessionId = 'stdio' // Fallback for stateless transports or stdio
        }

        let sessions = this.subscriptions.get(uri)
        if (!sessions) {
            sessions = new Set<string>()
            this.subscriptions.set(uri, sessions)
        }

        if (!sessions.has(sessionId)) {
            sessions.add(sessionId)
            logger.debug(`Session ${sessionId} subscribed to resource ${uri}`, {
                module: 'SubscriptionManager',
            })
        }
    }

    /**
     * Unsubscribe a session from a resource URI.
     */
    public unsubscribe(uri: string, sessionId?: string): void {
        if (!sessionId) {
            sessionId = 'stdio'
        }

        const sessions = this.subscriptions.get(uri)
        if (sessions?.has(sessionId)) {
            sessions.delete(sessionId)
            logger.debug(`Session ${sessionId} unsubscribed from resource ${uri}`, {
                module: 'SubscriptionManager',
            })

            if (sessions.size === 0) {
                this.subscriptions.delete(uri)
            }
        }
    }

    /**
     * Unsubscribe a session from all resources (useful on transport disconnect).
     */
    public unsubscribeSession(sessionId: string): void {
        let count = 0
        for (const [uri, sessions] of this.subscriptions.entries()) {
            if (sessions.has(sessionId)) {
                sessions.delete(sessionId)
                count++
                if (sessions.size === 0) {
                    this.subscriptions.delete(uri)
                }
            }
        }
        if (count > 0) {
            logger.debug(
                `Session ${sessionId} disconnected, removed ${count} subscriptions`,
                { module: 'SubscriptionManager' }
            )
        }
    }

    /**
     * Notifies all subscribed clients that a resource has changed.
     */
    public async notifyResourceUpdated(uri: string): Promise<void> {
        const sessions = this.subscriptions.get(uri)
        if (!sessions || sessions.size === 0) {
            return
        }

        const promises: Promise<void>[] = []
        for (const sessionId of sessions) {
            const server = this.servers.get(sessionId)
            if (server) {
                promises.push(
                    server.server.sendResourceUpdated({ uri }).catch((error: unknown) => {
                        logger.error(`Failed to notify session ${sessionId} for ${uri}`, {
                            module: 'SubscriptionManager',
                            error: error instanceof Error ? error : new Error(String(error)),
                        })
                    })
                )
            }
        }
        await Promise.allSettled(promises)
    }

    /**
     * Check if there are any active subscribers for a specific URI.
     */
    public hasSubscribers(uri: string): boolean {
        const sessions = this.subscriptions.get(uri)
        return sessions ? sessions.size > 0 : false
    }
}

export const globalSubscriptionManager = new SubscriptionManager()
