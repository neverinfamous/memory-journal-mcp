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

    // Reverse index: Session ID -> Set of subscribed URI strings
    private sessionUris = new Map<string, Set<string>>()

    // Reverse index: normalized base URI -> Set of subscribed full URI strings
    private baseUriToSubUris = new Map<string, Set<string>>()

    // Microtask-coalesced pending resource notifications
    private pendingNotificationUris = new Set<string>()
    private pendingNotificationWaiters: { resolve: () => void; reject: (err: unknown) => void }[] = []
    private flushScheduled = false

    private indexSubscribedUri(uri: string): void {
        const baseUri = getBaseUri(uri)
        let urisForBase = this.baseUriToSubUris.get(baseUri)
        if (urisForBase === undefined) {
            urisForBase = new Set<string>()
            this.baseUriToSubUris.set(baseUri, urisForBase)
        }
        urisForBase.add(uri)
    }

    private unindexSubscribedUri(uri: string): void {
        const baseUri = getBaseUri(uri)
        const urisForBase = this.baseUriToSubUris.get(baseUri)
        if (urisForBase === undefined) return
        urisForBase.delete(uri)
        if (urisForBase.size === 0) {
            this.baseUriToSubUris.delete(baseUri)
        }
    }

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

        let urisForSession = this.sessionUris.get(sessionId)
        if (urisForSession?.has(uri) === true) {
            return
        }
        if ((urisForSession?.size ?? 0) >= SubscriptionManager.MAX_SUBSCRIPTIONS_PER_SESSION) {
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
            this.indexSubscribedUri(uri)
        }

        sessions.add(sessionId)
        if (urisForSession === undefined) {
            urisForSession = new Set<string>()
            this.sessionUris.set(sessionId, urisForSession)
        }
        urisForSession.add(uri)
        logger.debug(`Session ${sessionId} subscribed to resource ${uri}`, {
            module: 'SubscriptionManager',
        })
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
            const urisForSession = this.sessionUris.get(sessionId)
            if (urisForSession !== undefined) {
                urisForSession.delete(uri)
                if (urisForSession.size === 0) {
                    this.sessionUris.delete(sessionId)
                }
            }
            logger.debug(`Session ${sessionId} unsubscribed from resource ${uri}`, {
                module: 'SubscriptionManager',
            })

            if (sessions.size === 0) {
                this.subscriptions.delete(uri)
                this.unindexSubscribedUri(uri)
            }
        }
    }

    /**
     * Unsubscribe a session from all resources (useful on transport disconnect).
     */
    public unsubscribeSession(sessionId: string): void {
        const urisForSession = this.sessionUris.get(sessionId)
        if (urisForSession === undefined || urisForSession.size === 0) {
            this.sessionUris.delete(sessionId)
            return
        }
        let count = 0
        for (const uri of urisForSession) {
            const sessions = this.subscriptions.get(uri)
            if (sessions?.delete(sessionId)) {
                count++
                if (sessions.size === 0) {
                    this.subscriptions.delete(uri)
                    this.unindexSubscribedUri(uri)
                }
            }
        }
        this.sessionUris.delete(sessionId)
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
        const sameBaseUris = this.baseUriToSubUris.get(baseUri)
        if (sameBaseUris !== undefined) {
            for (const subUri of sameBaseUris) {
                const subSessions = this.subscriptions.get(subUri)
                if (subSessions !== undefined) pushIfActive(subUri, subSessions)
            }
        }
        if (isBriefingRoot) {
            for (const [subBase, subUris] of this.baseUriToSubUris.entries()) {
                if (!subBase.startsWith('memory://briefing/')) continue
                for (const subUri of subUris) {
                    const subSessions = this.subscriptions.get(subUri)
                    if (subSessions !== undefined) pushIfActive(subUri, subSessions)
                }
            }
        } else if (isBriefingSection) {
            const rootUris = this.baseUriToSubUris.get('memory://briefing')
            if (rootUris !== undefined) {
                for (const subUri of rootUris) {
                    const subSessions = this.subscriptions.get(subUri)
                    if (subSessions !== undefined) pushIfActive(subUri, subSessions)
                }
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
