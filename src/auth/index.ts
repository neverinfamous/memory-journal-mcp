/**
 * memory-journal-mcp — Auth Module Public Exports
 *
 * OAuth 2.0 authentication and authorization components.
 */

// Types
export type * from './types.js'
export * from './errors.js'

// Scopes
export * from './scopes.js'

// Scope Map (tool → scope reverse lookup)
export { getRequiredScope, getToolScopeMap } from './scope-map.js'

// Auth Context (AsyncLocalStorage per-request threading)
export { runWithAuthContext, getAuthContext } from './auth-context.js'

// Core classes
export { OAuthResourceServer, createOAuthResourceServer } from './oauth-resource-server.js'
export {
    AuthorizationServerDiscovery,
    createAuthServerDiscovery,
} from './authorization-server-discovery.js'
export { TokenValidator, createTokenValidator } from './token-validator.js'

// Middleware (Express-specific)
export {
    createAuthMiddleware,
    extractBearerToken,
    requireScope,
    requireAnyScope,
    requireToolScope,
    oauthErrorHandler,
    type AuthMiddlewareConfig,
} from './middleware.js'

// Middleware (transport-agnostic)
export {
    createAuthenticatedContext,
    validateAuth,
    formatOAuthError,
    type AuthenticatedContext,
} from './middleware.js'
