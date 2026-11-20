/**
 * Resource Query-String Matching & Audited Callback Registration Helpers
 *
 * Preserves exact `@modelcontextprotocol/server` static/ResourceTemplate registrations while
 * stripping `?query` and `#fragment` prior to SDK URI matching so `resources/read` requests
 * like `memory://briefing?pin_session=false` or `memory://audit?workspace_id=...` succeed
 * and still deliver the full `URL` (including query parameters) to `handleResourceRead`.
 */

import { AsyncLocalStorage } from 'node:async_hooks'
import type { McpServer } from '@modelcontextprotocol/server'

import { auditOperation } from '../audit/interceptor.js'
import { enforceAccessBoundary } from '../auth/validation.js'
import { ConfigurationError } from '../types/errors.js'
import type { ServerRuntime } from '../utils/maintenance-lock.js'
import type { ResourceDefinition, ResourceReadHandler } from './registration.js'

const pendingResourceReadUriStorage = new AsyncLocalStorage<URL>()
const wrappedResourceServers = new WeakSet()

type RequestHandler = (request: unknown, extra: unknown) => Promise<unknown>
type RequestHandlerMap = Map<string, RequestHandler>

function isPlainRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function getServerRequestHandlers(server: McpServer): RequestHandlerMap | undefined {
    if (!('server' in server) || !isPlainRecord(server.server)) {
        return undefined
    }
    const rawServer: object = server.server
    const handlers: unknown = Reflect.get(rawServer, '_requestHandlers')
    if (handlers instanceof Map) {
        return handlers as RequestHandlerMap
    }
    return undefined
}

/**
 * Create the audited MCP SDK resource callback, restoring the original `?query` URL
 * carried via `AsyncLocalStorage` when `resources/read` matched by stripped base URI.
 */
export function createAuditedResourceCallback(
    resDef: ResourceDefinition,
    mimeType: string,
    handleResourceRead: ResourceReadHandler,
    runtime: ServerRuntime | undefined
): (matchedUri: URL) => ReturnType<ResourceReadHandler> {
    return async (matchedUri: URL) => {
        if (!runtime) {
            throw new ConfigurationError(
                'ServerRuntime is logically required for secure resource execution.'
            )
        }
        const effectiveUri = pendingResourceReadUriStorage.getStore() ?? matchedUri
        const auditLog = runtime.auditLogger
        enforceAccessBoundary(effectiveUri.href, 'resource', resDef.capabilities, auditLog)
        const forceAudit =
            resDef.capabilities?.requiresTeamScope === true ||
            resDef.capabilities?.requiresAuditScope === true ||
            resDef.capabilities?.requiresAdminScope === true
        return auditOperation(
            auditLog,
            'resource',
            resDef.name,
            async () =>
                runtime.maintenanceManager.withActiveJob(() =>
                    handleResourceRead(effectiveUri, mimeType)
                ),
            { forceAudit, resourceUri: effectiveUri.href, capabilities: resDef.capabilities }
        )
    }
}

/**
 * Wrap the SDK's `resources/read` request handler so URIs carrying `?query` or `#fragment`
 * match static/template registrations cleanly while forwarding the original URL downstream.
 */
export function attachResourceQueryHandler(server: McpServer): void {
    const requestHandlers = getServerRequestHandlers(server)
    if (requestHandlers === undefined) return
    const rawServer = server.server
    if (wrappedResourceServers.has(rawServer)) return
    const originalHandler = requestHandlers.get('resources/read')
    if (originalHandler === undefined) return

    wrappedResourceServers.add(rawServer)
    requestHandlers.set('resources/read', (request: unknown, extra: unknown) => {
        if (!isPlainRecord(request) || !isPlainRecord(request['params'])) {
            return originalHandler(request, extra)
        }
        const rawUri = request['params']['uri']
        if (typeof rawUri !== 'string') {
            return originalHandler(request, extra)
        }
        if (Buffer.byteLength(rawUri, 'utf8') > 8_192) {
            throw new ConfigurationError('Resource URI exceeds maximum allowed length (8192 bytes)')
        }
        let parsedUri: URL
        try {
            parsedUri = new URL(rawUri)
        } catch {
            return originalHandler(request, extra)
        }
        if (parsedUri.search === '' && parsedUri.hash === '') {
            return originalHandler(request, extra)
        }
        const baseUri = new URL(parsedUri.href)
        baseUri.search = ''
        baseUri.hash = ''
        const sanitizedRequest = {
            ...request,
            params: {
                ...request['params'],
                uri: baseUri.toString(),
            },
        }
        return pendingResourceReadUriStorage.run(parsedUri, () =>
            originalHandler(sanitizedRequest, extra)
        )
    })
}
