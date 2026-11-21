import type { McpServer } from '@modelcontextprotocol/server'
import { logger } from '../utils/logger.js'
import { getBaseUri } from '../handlers/resources/uri-and-fencing.js'

/**
 * Manages MCP resource subscriptions globally for the server.
 * Tracks which transport sessions are subscribed to which resource URIs,
 * and maintains references to the McpServer instances to broadcast notifications.
 */
export class SubscriptionManager {
    private static readonly MAX_TRACKED_SESSIONS = 1000
    private static readonly MAX_SUBSCRIPTIONS_PER_SESSION = 100

    // Map of Session ID (or 'stdio') -> McpServer instance
    private servers = new Map<string, McpServer>()

    // Map of URI string -> Set of Session IDs
    private subscriptions = new Map<string, Set<string>>()

    // Microtask-coalesced pending resource notifications
    private pendingNotificationUris = new Set<string>()
    private pendingNotificationWaiters: { resolve: () => void; reject: (err: unknown) => void }[] = []
    private flushScheduled = false

    /**
     * Register a server instance for a session to allow sending notifications.
     */
    public registerServer(sessionId: string, server: McpServer): void {
        if (!this.servers.has(sessionId) && this.servers.size >= SubscriptionManager.MAX_TRACKED_SESSIONS) {
            const oldestKey = this.servers.keys().next().value
            if (oldestKey !== undefined) {
                this.unregisterServer(oldestKey)
            }
        }
        this.servers.set(sessionId, server)
    }

    /**
     * Unregister a server instance and clean up its subscriptions.
     */
    public unregisterServer(sessionId: string): void {
        this.servers.delete(sessionId)
        this.unsubscribeSession(sessionId)
    }

    /** Unregister `sessionId` only when it is still bound to `server`. */
    public unregisterServerIfMatch(sessionId: string, server: McpServer): void {
        if (this.servers.get(sessionId) === server) {
            this.unregisterServer(sessionId)
        }
    }

    /**
     * Subscribe a session to a resource URI.
     */
    public subscribe(uri: string, sessionId?: string): void {
        if (!sessionId) {
            sessionId = 'stdio' // Fallback for stateless transports or stdio
        }

        let sessionSubCount = 0
        for (const sessSet of this.subscriptions.values()) {
            if (sessSet.has(sessionId)) {
                sessionSubCount++
            }
        }
        if (sessionSubCount >= SubscriptionManager.MAX_SUBSCRIPTIONS_PER_SESSION) {
            logger.warning(`Session ${sessionId} reached maximum resource subscription limit`, {
                module: 'SubscriptionManager',
            })
            return
        }

        let sessions = this.subscriptions.get(uri)
        if (!sessions) {
            if (this.subscriptions.size >= SubscriptionManager.MAX_TRACKED_SESSIONS) {
                return
            }
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
     * Notifies all subscribed clients that a resource has changed (coalesced per microtask).
     */
    public notifyResourceUpdated(uri: string): Promise<void> {
        if (this.subscriptions.size === 0) return Promise.resolve()
        this.pendingNotificationUris.add(uri)
        return new Promise<void>((resolve, reject) => {
            this.pendingNotificationWaiters.push({ resolve, reject })
            if (!this.flushScheduled) {
                this.flushScheduled = true
                queueMicrotask(() => {
                    void this.flushPendingNotifications()
                })
            }
        })
    }

    private collectTargetsForUri(uri: string): [string, Set<string>][] {
        const baseUri = getBaseUri(uri)
        const isBriefingRoot = baseUri === 'memory://briefing'
        const isBriefingSection = baseUri.startsWith('memory://briefing/')
        const seenUris = new Set<string>()
        const targets: [string, Set<string>][] = []
        const pushIfActive = (subUri: string, sessions: Set<string>): void => {
            if (sessions.size === 0 || seenUris.has(subUri)) return
            seenUris.add(subUri)
            targets.push([subUri, sessions])
        }
        const directSessions = this.subscriptions.get(uri)
        if (directSessions !== undefined) {
            pushIfActive(uri, directSessions)
        }
        for (const [subUri, subSessions] of this.subscriptions.entries()) {
            if (subSessions.size === 0 || seenUris.has(subUri)) continue
            const subBase = getBaseUri(subUri)
            if (
                subBase === baseUri ||
                (isBriefingRoot && subBase.startsWith('memory://briefing/')) ||
                (isBriefingSection && subBase === 'memory://briefing')
            ) {
                pushIfActive(subUri, subSessions)
            }
        }
        return targets
    }

    private enqueueTargetNotifications(
        targetUri: string,
        sessions: Set<string>,
        sent: Set<string>,
        promises: Promise<void>[]
    ): void {
        for (const sessionId of sessions) {
            const dedupKey = `${sessionId}\0${targetUri}`
            if (sent.has(dedupKey)) continue
            sent.add(dedupKey)
            const server = this.servers.get(sessionId)
            if (server === undefined) continue
            promises.push(
                server.server.sendResourceUpdated({ uri: targetUri }).catch((error: unknown) => {
                    logger.error(`Failed to notify session ${sessionId} for ${targetUri}`, {
                        module: 'SubscriptionManager',
                        error: error instanceof Error ? error : new Error(String(error)),
                    })
                })
            )
        }
    }

    private async flushPendingNotifications(): Promise<void> {
        this.flushScheduled = false
        const uris = Array.from(this.pendingNotificationUris)
        this.pendingNotificationUris.clear()
        const waiters = this.pendingNotificationWaiters
        this.pendingNotificationWaiters = []

        try {
            const promises: Promise<void>[] = []
            const sent = new Set<string>()
            for (const uri of uris) {
                for (const [targetUri, sessions] of this.collectTargetsForUri(uri)) {
                    this.enqueueTargetNotifications(targetUri, sessions, sent, promises)
                }
            }
            if (promises.length > 0) {
                await Promise.allSettled(promises)
            }
            for (const w of waiters) w.resolve()
        } catch (err) {
            for (const w of waiters) w.reject(err)
        }
    }

    /**
     * Broadcasts a generic notification to all connected clients.
     */
    public async broadcastNotification(method: string): Promise<void> {
        if (this.servers.size === 0) {
            return
        }

        const promises: Promise<void>[] = []
        for (const [sessionId, server] of this.servers.entries()) {
            promises.push(
                server.server.notification({ method }).catch((error: unknown) => {
                    logger.debug(`Failed to broadcast ${method} to session ${sessionId}`, {
                        module: 'SubscriptionManager',
                        error: error instanceof Error ? error.message : String(error),
                    })
                })
            )
        }
        await Promise.allSettled(promises)
    }
}

export const globalSubscriptionManager = new SubscriptionManager()
