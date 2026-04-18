/**
 * memory-journal-mcp — Token Validator
 *
 * JWT access token validation using JWKS for signature verification.
 * Supports RSA and EC algorithms commonly used with OAuth 2.0.
 */

import * as jose from 'jose'
import type { TokenValidationResult, TokenClaims, TokenValidatorConfig } from './types.js'
import {
    InvalidTokenError,
    TokenExpiredError,
    InvalidSignatureError,
    JwksFetchError,
    AUTH_ERROR_CODES,
} from './errors.js'
import { parseScopes } from './scopes.js'
import { logger } from '../utils/logger.js'

// =============================================================================
// Token Validator
// =============================================================================

/**
 * JWT Token Validator
 *
 * Validates OAuth 2.0 access tokens using JWKS for signature verification.
 */
export class TokenValidator {
    /** Resolved configuration with all defaults applied */
    private readonly jwksUri: string
    private readonly issuer: string
    private readonly audience: string
    private readonly clockTolerance: number
    private readonly jwksCacheTtl: number

    private jwks: jose.JWTVerifyGetKey | null = null
    private jwksExpiry = 0

    constructor(config: TokenValidatorConfig) {
        this.jwksUri = config.jwksUri
        this.issuer = config.issuer
        this.audience = config.audience
        this.clockTolerance = config.clockTolerance ?? 60
        this.jwksCacheTtl = config.jwksCacheTtl ?? 3600

        const issuerUrl = new URL(this.issuer)
        const jwksUrl = new URL(this.jwksUri)

        const isLoopback = (host: string): boolean => host === 'localhost' || host === '127.0.0.1' || host === '[::1]'

        if (issuerUrl.protocol !== 'https:' && !isLoopback(issuerUrl.hostname)) {
            throw new Error(`Security Violation: Issuer must use HTTPS protocol (got ${this.issuer})`)
        }

        if (jwksUrl.protocol !== 'https:' && !isLoopback(jwksUrl.hostname)) {
            throw new Error(`Security Violation: JWKS URI must use HTTPS protocol (got ${this.jwksUri})`)
        }

        if (issuerUrl.origin !== jwksUrl.origin) {
            throw new Error(`Security Violation: JWKS URI origin (${jwksUrl.origin}) does not match Issuer origin (${issuerUrl.origin})`)
        }

        const issuerHost = new URL(this.issuer).hostname
        logger.info(`Token Validator initialized for issuer: ${issuerHost}`, {
            module: 'AUTH',
            operation: 'init',
        })
    }

    /**
     * Validate an access token
     *
     * @param token - The JWT access token
     * @returns Validation result with claims or error
     */
    async validate(token: string): Promise<TokenValidationResult> {
        try {
            // Get or refresh JWKS
            const jwks = this.getJwks()

            // Verify the token
            const { payload } = await jose.jwtVerify(token, jwks, {
                issuer: this.issuer,
                audience: this.audience,
                clockTolerance: this.clockTolerance,
            })

            // Extract and normalize claims
            const claims = this.extractClaims(payload)

            logger.info(`Token validated for subject: ${claims.sub}`, {
                module: 'AUTH',
                operation: 'validate',
                entityId: claims.sub,
            })

            return {
                valid: true,
                claims,
            }
        } catch (error) {
            return this.handleValidationError(error)
        }
    }

    /**
     * Get or refresh the JWKS
     */
    private getJwks(): jose.JWTVerifyGetKey {
        // Check if JWKS is cached and valid
        if (this.jwks && Date.now() < this.jwksExpiry) {
            return this.jwks
        }

        const jwksHost = (() => {
            try {
                return new URL(this.jwksUri).hostname
            } catch {
                return '[configured]'
            }
        })()
        logger.info(`Fetching JWKS from: ${jwksHost}`, {
            module: 'AUTH',
            operation: 'jwks-fetch',
        })

        try {
            // Create JWKS remote key set
            this.jwks = jose.createRemoteJWKSet(new URL(this.jwksUri), {
                cooldownDuration: 30000, // 30 seconds between retries
                cacheMaxAge: this.jwksCacheTtl * 1000,
                timeoutDuration: 5000, // Explicit 5s timeout to prevent socket hangs
            })

            this.jwksExpiry = Date.now() + this.jwksCacheTtl * 1000

            logger.info(`JWKS cached for ${String(this.jwksCacheTtl)}s`, {
                module: 'AUTH',
                operation: 'jwks-cache',
            })

            return this.jwks
        } catch (error) {
            const cause = error instanceof Error ? error : new Error(String(error))

            logger.error('Failed to fetch JWKS', {
                module: 'AUTH',
                operation: 'jwks-fetch',
                error: cause.message,
            })

            throw new JwksFetchError(this.jwksUri, cause)
        }
    }

    /**
     * Extract and normalize token claims
     */
    private extractClaims(payload: jose.JWTPayload): TokenClaims {
        // Get scopes from 'scope' claim (space-delimited) or 'scopes' claim (array)
        let scopes: string[] = []

        if (typeof payload['scope'] === 'string') {
            scopes = parseScopes(payload['scope'])
        } else if (Array.isArray(payload['scopes'])) {
            scopes = payload['scopes'].filter((s): s is string => typeof s === 'string')
        } else if (Array.isArray(payload['scope'])) {
            scopes = payload['scope'].filter((s): s is string => typeof s === 'string')
        }

        return {
            sub: payload.sub ?? 'unknown',
            scopes,
            exp: payload.exp ?? 0,
            iat: payload.iat ?? 0,
            iss: payload.iss,
            aud: payload.aud,
            nbf: payload.nbf ?? undefined,
            jti: payload.jti,
            client_id: payload['client_id'] as string | undefined,
            // Include all other claims
            ...payload,
        }
    }

    /**
     * Handle validation errors and convert to TokenValidationResult
     */
    private handleValidationError(error: unknown): TokenValidationResult {
        // Handle jose-specific errors
        if (error instanceof jose.errors.JWTExpired) {
            logger.warning('Token has expired', {
                module: 'AUTH',
                operation: 'validate',
            })

            return {
                valid: false,
                error: 'Invalid or expired token',
                errorCode: AUTH_ERROR_CODES.TOKEN_EXPIRED,
            }
        }

        if (error instanceof jose.errors.JWTClaimValidationFailed) {
            logger.warning(`Token claim validation failed: ${error.message}`, {
                module: 'AUTH',
                operation: 'validate',
            })

            return {
                valid: false,
                error: 'Invalid or expired token',
                errorCode: AUTH_ERROR_CODES.TOKEN_INVALID,
            }
        }

        if (error instanceof jose.errors.JWSSignatureVerificationFailed) {
            logger.warning('Token signature verification failed', {
                module: 'AUTH',
                operation: 'validate',
            })

            return {
                valid: false,
                error: 'Invalid or expired token',
                errorCode: AUTH_ERROR_CODES.SIGNATURE_INVALID,
            }
        }

        if (error instanceof jose.errors.JWKSNoMatchingKey) {
            logger.warning('No matching key found in JWKS', {
                module: 'AUTH',
                operation: 'validate',
            })

            return {
                valid: false,
                error: 'Invalid or expired token',
                errorCode: AUTH_ERROR_CODES.TOKEN_INVALID,
            }
        }

        // Handle other errors
        const message = error instanceof Error ? error.message : String(error)

        logger.error(`Token validation failed: ${message}`, {
            module: 'AUTH',
            operation: 'validate',
        })

        return {
            valid: false,
            error: 'Invalid or expired token',
            errorCode: AUTH_ERROR_CODES.TOKEN_INVALID,
        }
    }

    /**
     * Refresh the JWKS cache
     */
    refreshJwks(): void {
        this.jwks = null
        this.jwksExpiry = 0
        this.getJwks()
        logger.info('JWKS cache refreshed', { module: 'AUTH', operation: 'jwks-refresh' })
    }

    /**
     * Clear the JWKS cache
     */
    clearCache(): void {
        this.jwks = null
        this.jwksExpiry = 0
        logger.info('Token validator cache cleared', { module: 'AUTH', operation: 'cache-clear' })
    }

    /**
     * Convert a validation error to the appropriate OAuth error class
     */
    static toOAuthError(
        result: TokenValidationResult
    ): InvalidTokenError | TokenExpiredError | InvalidSignatureError {
        if (result.errorCode === AUTH_ERROR_CODES.TOKEN_EXPIRED) {
            return new TokenExpiredError()
        }

        if (result.errorCode === AUTH_ERROR_CODES.SIGNATURE_INVALID) {
            return new InvalidSignatureError()
        }

        return new InvalidTokenError(result.error)
    }

    /**
     * Preload JWKS to validate availability at startup
     */
    async preload(): Promise<void> {
        const jwksHost = (() => {
            try {
                return new URL(this.jwksUri).hostname
            } catch {
                return '[configured]'
            }
        })()
        
        logger.info(`Pre-fetching JWKS from: ${jwksHost}`, {
            module: 'AUTH',
            operation: 'jwks-preload',
        })

        try {
            const response = await fetch(this.jwksUri, { 
                method: 'GET',
                signal: AbortSignal.timeout(10000)
            })
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`)
            }
        } catch (error) {
            const cause = error instanceof Error ? error : new Error(String(error))
            logger.error('Failed to pre-fetch JWKS at startup', {
                module: 'AUTH',
                operation: 'jwks-preload',
                error: cause.message,
            })
            throw new JwksFetchError(this.jwksUri, cause)
        }
    }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create a Token Validator instance
 */
export function createTokenValidator(config: TokenValidatorConfig): TokenValidator {
    return new TokenValidator(config)
}
