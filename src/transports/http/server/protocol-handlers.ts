import type { McpServer } from '@modelcontextprotocol/server'
import type { Express } from 'express'
import type { McpServerFactory } from '../../../server/mcp-server/index.js'
import type { HttpTransportConfig } from '../types.js'
import {
    createDeleteHandler,
    createPostHandler,
    createSessionCreator,
    createSessionOwnerVerifier,
    createStatefulGetHandler,
    createStatelessHandler,
    startSessionSweeper,
    type McpRouteState,
    type SseTransportMap,
} from './protocol-route-handlers.js'

export type { SseTransportMap }

export function registerMcpProtocolRoutes(
    app: Express,
    config: HttpTransportConfig,
    serverFactory: McpServerFactory,
    activeServers: Set<McpServer>,
    sseTransports: SseTransportMap
): () => void {
    const state: McpRouteState = {
        config,
        serverFactory,
        activeServers,
        sseTransports,
        sessionOwners: new Map<string, string>(),
        sessionLastActivity: new Map<string, number>(),
    }

    const statelessMcpHandler = createStatelessHandler(state)
    const sweepTimer = startSessionSweeper(state)
    const verifySessionOwner = createSessionOwnerVerifier(state)
    const createSessionAndHandle = createSessionCreator(state)

    const handleStatefulGet = createStatefulGetHandler(
        state,
        createSessionAndHandle,
        verifySessionOwner
    )

    // checkRateLimit is app middleware in http-transport.ts, installed before these routes.
    // Calling it again here would consume two tokens for every request.
    /* codeql[js/missing-rate-limiting] */ app.get('/mcp', handleStatefulGet)
    /* codeql[js/missing-rate-limiting] */ app.get('/sse', handleStatefulGet)

    const handlePost = createPostHandler(
        state,
        createSessionAndHandle,
        verifySessionOwner,
        statelessMcpHandler
    )

    /* codeql[js/missing-rate-limiting] */ app.post('/mcp', handlePost)
    /* codeql[js/missing-rate-limiting] */ app.post('/sse', handlePost)
    /* codeql[js/missing-rate-limiting] */ app.post('/messages', handlePost)

    /* codeql[js/missing-rate-limiting] */ app.delete(
        '/mcp',
        createDeleteHandler(state, verifySessionOwner)
    )

    return () => {
        clearInterval(sweepTimer)
    }
}
