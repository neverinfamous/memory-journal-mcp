/**
 * memory-journal-mcp — OAuth Error Classes
 *
 * Module-prefixed error classes for OAuth 2.0 authentication
 * and authorization failures.
 */

// =============================================================================
// Error Codes
// =============================================================================

/**
 * OAuth error code constants
 */
export const AUTH_ERROR_CODES = {
    TOKEN_MISSING: 'AUTH_TOKEN_MISSING',
    TOKEN_INVALID: 'AUTH_TOKEN_INVALID',
    TOKEN_EXPIRED: 'AUTH_TOKEN_EXPIRED',
    SIGNATURE_INVALID: 'AUTH_SIGNATURE_INVALID',
    SCOPE_DENIED: 'AUTH_SCOPE_DENIED',
    DISCOVERY_FAILED: 'AUTH_DISCOVERY_FAILED',
    JWKS_FETCH_FAILED: 'AUTH_JWKS_FETCH_FAILED',
    REGISTRATION_FAILED: 'AUTH_REGISTRATION_FAILED',
} as const

// =============================================================================
// Base OAuth Error
// =============================================================================

/**
 * Base class for OAuth-related errors
 */
export class OAuthError extends Error {
    /** Module-prefixed error code */
    readonly code: string

    /** HTTP status code for this error */
    readonly httpStatus: number

    /** WWW-Authenticate header value */
    readonly wwwAuthenticate?: string | undefined

    /** Structured error details */
    readonly details?: Record<string, unknown> | undefined

    constructor(
        message: string,
        code: string,
        httpStatus: number,
        details?: Record<string, unknown>,
        wwwAuthenticate?: string
    ) {
        super(message)
        this.name = 'OAuthError'
        this.code = code
        this.httpStatus = httpStatus
        this.details = details
        this.wwwAuthenticate = wwwAuthenticate
    }
}

// =============================================================================
// Authentication Errors (401)
// =============================================================================

/**
 * Token is missing from the request
 */
export class TokenMissingError extends OAuthError {
    constructor(realm = 'memory-journal-mcp') {
        super(
            'No access token provided',
            AUTH_ERROR_CODES.TOKEN_MISSING,
            401,
            undefined,
            `Bearer realm="${realm}"`
        )
        this.name = 'TokenMissingError'
    }
}

/**
 * Token is invalid (malformed, wrong format, etc.)
 */
export class InvalidTokenError extends OAuthError {
    constructor(message = 'Invalid access token', details?: Record<string, unknown>) {
        super(message, AUTH_ERROR_CODES.TOKEN_INVALID, 401, details, 'Bearer error="invalid_token"')
        this.name = 'InvalidTokenError'
    }
}

/**
 * Token has expired
 */
export class TokenExpiredError extends OAuthError {
    constructor(expiredAt?: Date) {
        super(
            'Access token has expired',
            AUTH_ERROR_CODES.TOKEN_EXPIRED,
            401,
            expiredAt ? { expiredAt: expiredAt.toISOString() } : undefined,
            'Bearer error="invalid_token", error_description="Token has expired"'
        )
        this.name = 'TokenExpiredError'
    }
}

/**
 * Token signature is invalid
 */
export class InvalidSignatureError extends OAuthError {
    constructor(message = 'Token signature verification failed') {
        super(
            message,
            AUTH_ERROR_CODES.SIGNATURE_INVALID,
            401,
            undefined,
            'Bearer error="invalid_token", error_description="Signature verification failed"'
        )
        this.name = 'InvalidSignatureError'
    }
}

// =============================================================================
// Authorization Errors (403)
// =============================================================================

/**
 * Token does not have required scope
 */
export class InsufficientScopeError extends OAuthError {
    constructor(requiredScope: string | string[], providedScopes?: string[]) {
        const required = Array.isArray(requiredScope) ? requiredScope : [requiredScope]
        const scopeValue = required.join(' ')

        super(
            `Insufficient scope. Required: ${scopeValue}`,
            AUTH_ERROR_CODES.SCOPE_DENIED,
            403,
            { requiredScope: required, providedScopes },
            `Bearer error="insufficient_scope", scope="${scopeValue}"`
        )
        this.name = 'InsufficientScopeError'
    }
}

// =============================================================================
// Server Errors (500)
// =============================================================================

/**
 * Failed to discover authorization server metadata
 */
export class AuthServerDiscoveryError extends OAuthError {
    constructor(serverUrl: string, cause?: Error) {
        super('Failed to discover authorization server metadata: ' + serverUrl, AUTH_ERROR_CODES.DISCOVERY_FAILED, 500, {
            serverUrl,
            cause: cause?.message,
        })
        this.name = 'AuthServerDiscoveryError'
    }
}

/**
 * Failed to fetch JWKS
 */
export class JwksFetchError extends OAuthError {
    constructor(jwksUri: string, cause?: Error) {
        super('Failed to fetch JWKS: ' + jwksUri, AUTH_ERROR_CODES.JWKS_FETCH_FAILED, 500, {
            jwksUri,
            cause: cause?.message,
        })
        this.name = 'JwksFetchError'
    }
}

/**
 * Failed to register client
 */
export class ClientRegistrationError extends OAuthError {
    constructor(message: string, details?: Record<string, unknown>) {
        super(message, AUTH_ERROR_CODES.REGISTRATION_FAILED, 500, details)
        this.name = 'ClientRegistrationError'
    }
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Check if an error is an OAuth error
 */
export function isOAuthError(error: unknown): error is OAuthError {
    return error instanceof OAuthError
}

/**
 * Get WWW-Authenticate header for an OAuth error
 */
export function getWWWAuthenticateHeader(error: OAuthError, realm = 'memory-journal-mcp'): string {
    return error.wwwAuthenticate ?? `Bearer realm="${realm}"`
}
