/**
 * memory-journal-mcp — OAuth Middleware
 *
 * Express middleware for OAuth 2.0 authentication and authorization.
 * Extracts Bearer tokens, validates them, and enforces scope requirements.
 */

import type { Request, Response, NextFunction, RequestHandler } from 'express'
import type { TokenClaims } from './types.js'
import type { AuthInfo } from '@modelcontextprotocol/server'
import type { TokenValidator } from './token-validator.js'
import type { OAuthResourceServer } from './oauth-resource-server.js'
import { TokenMissingError, InsufficientScopeError, isOAuthError } from './errors.js'
import { hasAnyScope, hasScope as checkScope } from './scopes.js'
import { getRequiredScope } from './scope-map.js'
import { logger } from '../utils/logger.js'
import { extractBearerToken } from './transport-agnostic.js'

export { extractBearerToken }

// =============================================================================
// Express Type Extensions
// =============================================================================

/**
 * Extended Express Request with auth context
 */
export interface AuthRequest extends Request {
    /** MCP standard auth info */
    auth?: AuthInfo
    /** Original Token claims */
    tokenClaims?: TokenClaims
    /** Raw access token */
    accessToken?: string
    /** Request ID for tracing */
    requestId?: string
}

// =============================================================================
// Configuration
// =============================================================================

/**
 * Auth middleware configuration
 */
export interface AuthMiddlewareConfig {
    /** Token validator instance */
    tokenValidator: TokenValidator

    /** Resource server instance (for WWW-Authenticate header) */
    resourceServer: OAuthResourceServer

    /** Paths that bypass authentication (e.g., '/.well-known/*', '/health') */
    publicPaths?: string[]
}

// =============================================================================
// Path Matching
// =============================================================================

/**
 * Check if a path matches any of the public path patterns
 *
 * Supports:
 * - Exact matches: '/health' matches '/health'
 * - Wildcard suffix: '/api/*' matches '/api/users', '/api/posts/1'
 * - Well-known paths are always public
 */
function isPublicPath(path: string, publicPaths: string[]): boolean {
    // Exact OAuth discovery & JWKS endpoints are public
    if (
        path === '/.well-known/oauth-authorization-server' ||
        path === '/.well-known/oauth-protected-resource' ||
        path.startsWith('/.well-known/oauth-protected-resource/') ||
        path === '/.well-known/jwks.json'
    ) {
        return true
    }

    for (const pattern of publicPaths) {
        // Exact match
        if (pattern === path) {
            return true
        }

        // Wildcard match
        if (pattern.endsWith('/*')) {
            const prefix = pattern.slice(0, -2)
            if (path === prefix || path.startsWith(prefix + '/')) {
                return true
            }
        }
    }

    return false
}

// =============================================================================
// Main Authentication Middleware
// =============================================================================

function sendMissingTokenResponse(res: Response, resourceServer: OAuthResourceServer): void {
    const error = new TokenMissingError(resourceServer.getResourceUri())
    logger.warning('No access token provided', {
        module: 'AUTH',
        operation: 'authenticate',
    })
    res.status(error.httpStatus)
    res.setHeader('WWW-Authenticate', error.wwwAuthenticate ?? '')
    res.json({
        error: 'unauthorized',
        error_description: error.message,
    })
}

function sendInvalidTokenResponse(
    res: Response,
    resourceServer: OAuthResourceServer,
    errorMessage: string | undefined
): void {
    logger.warning(`Token validation failed: ${errorMessage ?? 'Unknown error'}`, {
        module: 'AUTH',
        operation: 'authenticate',
    })
    res.status(401)
    res.setHeader(
        'WWW-Authenticate',
        resourceServer.getWWWAuthenticateHeader('invalid_token', errorMessage)
    )
    res.json({
        error: 'invalid_token',
        error_description: errorMessage,
    })
}

function attachValidatedClaims(authReq: AuthRequest, token: string, claims: TokenClaims): void {
    // [INVARIANT] AuthInfo.expiresAt uses Unix epoch seconds matching JWT `exp` (M2).
    const authInfo: AuthInfo = {
        token,
        clientId: claims.client_id || claims.sub,
        scopes: claims.scopes,
        expiresAt: claims.exp,
    }
    authReq.auth = authInfo
    authReq.tokenClaims = claims
    authReq.accessToken = token
}

async function handleAuthRequest(
    req: Request,
    res: Response,
    next: NextFunction,
    tokenValidator: TokenValidator,
    resourceServer: OAuthResourceServer,
    publicPaths: string[]
): Promise<void> {
    const authReq: AuthRequest = req
    authReq.requestId = crypto.randomUUID()

    if ((req.method === 'GET' || req.method === 'HEAD') && isPublicPath(req.path, publicPaths)) {
        logger.debug(`Public path accessed: ${req.path}`, {
            module: 'AUTH',
            operation: 'public-path',
        })
        next()
        return
    }

    const token = extractBearerToken(req.headers.authorization)
    if (!token) {
        sendMissingTokenResponse(res, resourceServer)
        return
    }

    const result = await tokenValidator.validate(token)
    if (!result.valid) {
        sendInvalidTokenResponse(res, resourceServer, result.error)
        return
    }

    const claims = result.claims
    if (!claims) {
        res.status(500).json({ error: 'internal_error' })
        return
    }

    attachValidatedClaims(authReq, token, claims)
    logger.debug(`Request authenticated: ${claims.sub}`, {
        module: 'AUTH',
        operation: 'authenticate',
        entityId: claims.sub,
    })
    next()
}

/**
 * Create the main authentication middleware
 *
 * This middleware:
 * 1. Skips authentication for public paths (e.g., /.well-known/*)
 * 2. Extracts Bearer token from Authorization header
 * 3. Validates the token using the TokenValidator
 * 4. Attaches validated claims to req.auth
 * 5. Returns 401 with WWW-Authenticate header on failure
 */
export function createAuthMiddleware(config: AuthMiddlewareConfig): RequestHandler {
    const { tokenValidator, resourceServer, publicPaths = [] } = config

    return (req: Request, res: Response, next: NextFunction): Promise<void> =>
        handleAuthRequest(req, res, next, tokenValidator, resourceServer, publicPaths)
}

// =============================================================================
// Scope Enforcement Middleware
// =============================================================================

/**
 * Middleware factory that requires a specific scope
 *
 * @param scope - Required scope
 * @returns Express middleware
 */
export function requireScope(scope: string): RequestHandler {
    return (req: Request, res: Response, next: NextFunction): void => {
        const authReq: AuthRequest = req

        if (!authReq.auth) {
            // Should not happen if auth middleware is applied first
            res.status(401).json({
                error: 'unauthorized',
                error_description: 'Authentication required',
            })
            return
        }

        const scopeGranted = checkScope(authReq.auth.scopes, scope)

        if (!scopeGranted) {
            const error = new InsufficientScopeError(scope, authReq.auth.scopes)

            logger.warning(`Insufficient scope: required ${scope}`, {
                module: 'AUTH',
                operation: 'scope-check',
            })

            res.status(error.httpStatus)
            res.setHeader('WWW-Authenticate', error.wwwAuthenticate ?? '')
            res.json({
                error: 'insufficient_scope',
                error_description: error.message,
                required_scope: scope,
            })
            return
        }

        next()
    }
}

/**
 * Middleware factory that requires any of the specified scopes
 *
 * @param scopes - Array of acceptable scopes (user must have at least one)
 * @returns Express middleware
 */
export function requireAnyScope(scopes: string[]): RequestHandler {
    return (req: Request, res: Response, next: NextFunction): void => {
        const authReq: AuthRequest = req

        if (!authReq.auth) {
            res.status(401).json({
                error: 'unauthorized',
                error_description: 'Authentication required',
            })
            return
        }

        const grantedScopes = authReq.auth.scopes

        if (!hasAnyScope(grantedScopes, scopes)) {
            const error = new InsufficientScopeError(scopes, authReq.auth.scopes)

            logger.warning(`Insufficient scope: required one of [${scopes.join(', ')}]`, {
                module: 'AUTH',
                operation: 'scope-check',
            })

            res.status(error.httpStatus)
            res.setHeader('WWW-Authenticate', error.wwwAuthenticate ?? '')
            res.json({
                error: 'insufficient_scope',
                error_description: error.message,
                required_scopes: scopes,
            })
            return
        }

        next()
    }
}

/**
 * Middleware factory that requires scope for a specific tool
 *
 * @param toolName - Name of the tool being accessed
 * @returns Express middleware
 */
export function requireToolScope(toolName: string): RequestHandler {
    return (req: Request, res: Response, next: NextFunction): void => {
        const authReq: AuthRequest = req

        if (!authReq.auth) {
            res.status(401).json({
                error: 'unauthorized',
                error_description: 'Authentication required',
            })
            return
        }

        // Use scope hierarchy for tool access check
        const requiredScope = getRequiredScope(toolName)
        const hasAccess = checkScope(authReq.auth.scopes, requiredScope)

        if (!hasAccess) {
            const error = new InsufficientScopeError(requiredScope, authReq.auth.scopes)

            logger.warning(`Insufficient scope for tool: ${toolName}`, {
                module: 'AUTH',
                operation: 'scope-check',
            })

            res.status(error.httpStatus)
            res.setHeader('WWW-Authenticate', error.wwwAuthenticate ?? '')
            res.json({
                error: 'insufficient_scope',
                error_description: `Access to tool '${toolName}' denied`,
                tool: toolName,
            })
            return
        }

        next()
    }
}

// =============================================================================
// Error Handler
// =============================================================================

/**
 * Error handler middleware for OAuth errors
 *
 * Should be added after all routes to catch OAuth-related errors
 */
export function oauthErrorHandler(
    error: Error,
    _req: Request,
    res: Response,
    next: NextFunction
): void {
    if (isOAuthError(error)) {
        res.status(error.httpStatus)

        if (error.wwwAuthenticate) {
            res.setHeader('WWW-Authenticate', error.wwwAuthenticate)
        }

        res.json({
            error: error.code,
            error_description: error.message,
        })
        return
    }

    // Pass to next error handler
    next(error)
}

// =============================================================================
// Transport-Agnostic Auth (re-exports for backward compatibility)
// =============================================================================

export {
    createAuthenticatedContext,
    validateAuth,
    formatOAuthError,
    type AuthenticatedContext,
} from './transport-agnostic.js'
