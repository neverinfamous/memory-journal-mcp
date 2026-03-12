/**
 * memory-journal-mcp — Token Validator Unit Tests
 *
 * Tests for JWT token validation including error handling,
 * scope parsing, and JWKS integration.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { TokenValidator, createTokenValidator } from '../token-validator.js'
import type { TokenValidatorConfig } from '../types.js'
import { AUTH_ERROR_CODES } from '../errors.js'

// Mock jose to avoid real JWKS fetching
vi.mock('jose', () => ({
    createRemoteJWKSet: vi.fn(() => vi.fn()),
    jwtVerify: vi.fn(),
    errors: {
        JWTExpired: class JWTExpired extends Error {
            constructor() {
                super('JWT expired')
                this.name = 'JWTExpired'
            }
        },
        JWKSNoMatchingKey: class JWKSNoMatchingKey extends Error {
            constructor() {
                super('No matching key')
                this.name = 'JWKSNoMatchingKey'
            }
        },
        JWSSignatureVerificationFailed: class JWSSignatureVerificationFailed extends Error {
            constructor() {
                super('Signature failed')
                this.name = 'JWSSignatureVerificationFailed'
            }
        },
        JWTClaimValidationFailed: class JWTClaimValidationFailed extends Error {
            constructor() {
                super('Claim validation failed')
                this.name = 'JWTClaimValidationFailed'
            }
        },
    },
}))

describe('TokenValidator', () => {
    let config: TokenValidatorConfig

    beforeEach(() => {
        vi.clearAllMocks()
        config = {
            jwksUri: 'https://auth.example.com/.well-known/jwks.json',
            issuer: 'https://auth.example.com',
            audience: 'memory-journal-mcp',
        }
    })

    describe('construction', () => {
        it('should create instance with config', () => {
            const validator = new TokenValidator(config)
            expect(validator).toBeInstanceOf(TokenValidator)
        })

        it('should apply default clockTolerance', () => {
            const validator = new TokenValidator(config)
            expect(validator).toBeDefined()
        })
    })

    describe('createTokenValidator factory', () => {
        it('should create TokenValidator instance', () => {
            const validator = createTokenValidator(config)
            expect(validator).toBeInstanceOf(TokenValidator)
        })
    })

    describe('validate', () => {
        it('should validate token and return claims on success', async () => {
            const { jwtVerify } = await import('jose')
            const mockVerify = vi.mocked(jwtVerify)

            const mockPayload = {
                sub: 'user-1',
                iss: 'https://auth.example.com',
                aud: 'memory-journal-mcp',
                exp: Math.floor(Date.now() / 1000) + 3600,
                iat: Math.floor(Date.now() / 1000),
                scope: 'read write',
            }

            mockVerify.mockResolvedValueOnce({
                payload: mockPayload,
                protectedHeader: { alg: 'RS256' },
            } as never)

            const validator = new TokenValidator(config)
            const result = await validator.validate('valid-jwt-token')

            expect(result.valid).toBe(true)
            expect(result.claims).toBeDefined()
            expect(result.claims?.sub).toBe('user-1')
            expect(result.claims?.scopes).toEqual(['read', 'write'])
        })

        it('should return invalid for expired tokens', async () => {
            const { jwtVerify, errors } = await import('jose')
            const mockVerify = vi.mocked(jwtVerify)
            
            const mockError = Object.create(errors.JWTExpired.prototype) as Error
            mockError.message = 'JWT expired'
            mockError.name = 'JWTExpired'

            mockVerify.mockRejectedValueOnce(mockError)

            const validator = new TokenValidator(config)
            const result = await validator.validate('expired-token')

            expect(result.valid).toBe(false)
            expect(result.error).toBeDefined()
            expect(result.errorCode).toBe(AUTH_ERROR_CODES.TOKEN_EXPIRED)
        })

        it('should handle signature verification failure', async () => {
            const { jwtVerify, errors } = await import('jose')
            const mockVerify = vi.mocked(jwtVerify)
            
            const mockError = Object.create(errors.JWSSignatureVerificationFailed.prototype) as Error
            mockError.message = 'Signature failed'
            mockError.name = 'JWSSignatureVerificationFailed'

            mockVerify.mockRejectedValueOnce(mockError)

            const validator = new TokenValidator(config)
            const result = await validator.validate('bad-sig-token')

            expect(result.valid).toBe(false)
            expect(result.errorCode).toBe(AUTH_ERROR_CODES.SIGNATURE_INVALID)
        })

        it('should handle claim validation failure', async () => {
            const { jwtVerify, errors } = await import('jose')
            const mockVerify = vi.mocked(jwtVerify)
            
            const mockError = Object.create(errors.JWTClaimValidationFailed.prototype) as Error
            mockError.message = 'Claim validation failed'
            mockError.name = 'JWTClaimValidationFailed'

            mockVerify.mockRejectedValueOnce(mockError)

            const validator = new TokenValidator(config)
            const result = await validator.validate('bad-claims-token')

            expect(result.valid).toBe(false)
            expect(result.errorCode).toBe(AUTH_ERROR_CODES.TOKEN_INVALID)
        })

        it('should handle no matching key in JWKS', async () => {
            const { jwtVerify, errors } = await import('jose')
            const mockVerify = vi.mocked(jwtVerify)
            
            const mockError = Object.create(errors.JWKSNoMatchingKey.prototype) as Error
            mockError.message = 'No matching key'
            mockError.name = 'JWKSNoMatchingKey'

            mockVerify.mockRejectedValueOnce(mockError)

            const validator = new TokenValidator(config)
            const result = await validator.validate('no-matching-key-token')

            expect(result.valid).toBe(false)
            expect(result.errorCode).toBe(AUTH_ERROR_CODES.TOKEN_INVALID)
        })

        it('should handle unknown errors', async () => {
            const { jwtVerify } = await import('jose')
            const mockVerify = vi.mocked(jwtVerify)

            mockVerify.mockRejectedValueOnce(new Error('Unknown error'))

            const validator = new TokenValidator(config)
            const result = await validator.validate('unknown-error-token')

            expect(result.valid).toBe(false)
            expect(result.errorCode).toBe(AUTH_ERROR_CODES.TOKEN_INVALID)
        })

        it('should parse scope claim as string', async () => {
            const { jwtVerify } = await import('jose')
            const mockVerify = vi.mocked(jwtVerify)

            mockVerify.mockResolvedValueOnce({
                payload: {
                    sub: 'user-1',
                    scope: 'read admin',
                    exp: Math.floor(Date.now() / 1000) + 3600,
                    iat: Math.floor(Date.now() / 1000),
                },
                protectedHeader: { alg: 'RS256' },
            } as never)

            const validator = new TokenValidator(config)
            const result = await validator.validate('scope-token')

            expect(result.valid).toBe(true)
            expect(result.claims?.scopes).toEqual(['read', 'admin'])
        })

        it('should parse scopes claim as array', async () => {
            const { jwtVerify } = await import('jose')
            const mockVerify = vi.mocked(jwtVerify)

            mockVerify.mockResolvedValueOnce({
                payload: {
                    sub: 'user-2',
                    scopes: ['write', 'admin'],
                    exp: Math.floor(Date.now() / 1000) + 3600,
                    iat: Math.floor(Date.now() / 1000),
                },
                protectedHeader: { alg: 'RS256' },
            } as never)

            const validator = new TokenValidator(config)
            const result = await validator.validate('array-scope-token')

            expect(result.valid).toBe(true)
            expect(result.claims?.scopes).toEqual(['write', 'admin'])
        })
    })

    describe('cache management', () => {
        it('should clear cache', () => {
            const validator = new TokenValidator(config)
            expect(() => validator.clearCache()).not.toThrow()
        })

        it('should refresh JWKS', () => {
            const validator = new TokenValidator(config)
            expect(() => validator.refreshJwks()).not.toThrow()
        })
    })

    describe('toOAuthError', () => {
        it('should convert expired error code to TokenExpiredError', () => {
            const error = TokenValidator.toOAuthError({
                valid: false,
                error: 'Token has expired',
                errorCode: AUTH_ERROR_CODES.TOKEN_EXPIRED,
            })
            expect(error.name).toBe('TokenExpiredError')
        })

        it('should convert signature error code to InvalidSignatureError', () => {
            const error = TokenValidator.toOAuthError({
                valid: false,
                error: 'Signature failed',
                errorCode: AUTH_ERROR_CODES.SIGNATURE_INVALID,
            })
            expect(error.name).toBe('InvalidSignatureError')
        })

        it('should convert generic error to InvalidTokenError', () => {
            const error = TokenValidator.toOAuthError({
                valid: false,
                error: 'Something went wrong',
                errorCode: AUTH_ERROR_CODES.TOKEN_INVALID,
            })
            expect(error.name).toBe('InvalidTokenError')
        })
    })
})
