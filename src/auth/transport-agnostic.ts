/**
 * memory-journal-mcp — Transport-Agnostic Auth
 *
 * Authentication utilities that work across any transport layer
 * (Express, Streamable HTTP, or future transports).
 * Split from middleware.ts to keep files under ~500 lines.
 */

import type { TokenClaims } from './types.js'
import { TokenValidator } from './token-validator.js'
import {
    OAuthError,
    TokenMissingError,
    InvalidTokenError,
    InsufficientScopeError,
} from './errors.js'
import { hasAnyScope } from './scopes.js'

/**
 * Extract a Bearer token from an Authorization header.
 */
export function extractBearerToken(authHeader: string | undefined): string | null {
    if (!authHeader) return null
    const parts = authHeader.split(' ')
    const scheme = parts[0]
    const tokenPart = parts[1]
    if (parts.length !== 2 || scheme?.toLowerCase() !== 'bearer') return null
    if (tokenPart === undefined) return null
    const token = tokenPart.trim()
    return token.length > 0 ? token : null
}

// =============================================================================
// Transport-Agnostic Auth Context
// =============================================================================

/**
 * Transport-agnostic authenticated request context.
 * Usable by Express middleware, Streamable HTTP, or any future transport.
 */
export interface AuthenticatedContext {
    /** Whether request is authenticated */
    authenticated: boolean

    /** Token claims (if authenticated) */
    claims?: TokenClaims

    /** Token scopes (convenience) */
    scopes: string[]
}

/**
 * Create authentication context from an Authorization header.
 * Does not throw — returns unauthenticated context when token is missing/invalid.
 */
export async function createAuthenticatedContext(
    authHeader: string | undefined,
    tokenValidator: TokenValidator
): Promise<AuthenticatedContext> {
    const token = extractBearerToken(authHeader)

    if (!token) {
        return { authenticated: false, scopes: [] }
    }

    const result = await tokenValidator.validate(token)

    if (!result.valid || !result.claims) {
        return { authenticated: false, scopes: [] }
    }

    return {
        authenticated: true,
        claims: result.claims,
        scopes: result.claims.scopes,
    }
}

/**
 * Validate authentication and authorization.
 * Throws OAuth errors when token missing, invalid, or insufficient scope.
 */
export async function validateAuth(
    authHeader: string | undefined,
    tokenValidator: TokenValidator,
    options: { required?: boolean; requiredScopes?: string[] } = {}
): Promise<AuthenticatedContext> {
    const { required = true, requiredScopes } = options
    const token = extractBearerToken(authHeader)

    if (!token) {
        if (required) {
            throw new TokenMissingError()
        }
        return { authenticated: false, scopes: [] }
    }

    const result = await tokenValidator.validate(token)

    if (!result.valid || !result.claims) {
        throw TokenValidator.toOAuthError(result)
    }

    const context: AuthenticatedContext = {
        authenticated: true,
        claims: result.claims,
        scopes: result.claims.scopes,
    }

    if (requiredScopes && requiredScopes.length > 0) {
        if (!hasAnyScope(context.scopes, requiredScopes)) {
            throw new InsufficientScopeError(requiredScopes, context.scopes)
        }
    }

    return context
}

/**
 * Format an OAuth error for HTTP response.
 * Transport-agnostic — returns status and body without Express dependency.
 */
export function formatOAuthError(error: unknown): {
    status: number
    body: object
} {
    if (error instanceof TokenMissingError) {
        return {
            status: 401,
            body: {
                error: 'invalid_token',
                error_description: error.message,
            },
        }
    }

    if (error instanceof InvalidTokenError) {
        return {
            status: 401,
            body: {
                error: 'invalid_token',
                error_description: error.message,
            },
        }
    }

    if (error instanceof InsufficientScopeError) {
        const rawRequired = error.details?.['requiredScope']
        const required = Array.isArray(rawRequired)
            ? rawRequired.filter((s): s is string => typeof s === 'string')
            : undefined
        return {
            status: 403,
            body: {
                error: 'insufficient_scope',
                error_description: error.message,
                scope: required !== undefined && required.length > 0 ? required.join(' ') : undefined,
            },
        }
    }

    if (error instanceof OAuthError) {
        const errorCode =
            error.httpStatus === 401
                ? 'invalid_token'
                : error.httpStatus === 403
                  ? 'insufficient_scope'
                  : 'server_error'
        return {
            status: error.httpStatus,
            body: {
                error: errorCode,
                error_description: error.message,
            },
        }
    }

    // Generic error
    return {
        status: 500,
        body: {
            error: 'server_error',
            error_description: 'Internal server error',
        },
    }
}
