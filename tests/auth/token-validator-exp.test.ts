/**
 * memory-journal-mcp — Token Validator `exp` requirement (real jose, no mocks)
 *
 * jose only validates `exp` when it is present. These tests prove that the validator
 * rejects validly signed tokens that carry no expiry, while still accepting normal ones.
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { SignJWT, generateKeyPair, exportJWK, createLocalJWKSet } from 'jose'
import { TokenValidator } from '../../src/auth/token-validator.js'
import { AUTH_ERROR_CODES } from '../../src/auth/errors.js'

const ISSUER = 'https://auth.example.com'
const AUDIENCE = 'memory-journal-mcp'

describe('TokenValidator — required exp claim (real jose)', () => {
    let validator: TokenValidator
    let privateKey: CryptoKey

    beforeAll(async () => {
        const pair = await generateKeyPair('RS256')
        privateKey = pair.privateKey
        const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'test-key', alg: 'RS256', use: 'sig' }

        validator = new TokenValidator({
            jwksUri: `${ISSUER}/.well-known/jwks.json`,
            issuer: ISSUER,
            audience: AUDIENCE,
        })
        // Inject a local key set into the JWKS cache so no network access is needed.
        Object.assign(validator, {
            jwks: createLocalJWKSet({ keys: [jwk] }),
            jwksExpiry: Date.now() + 60 * 60 * 1000,
        })
    })

    function baseToken(): SignJWT {
        return new SignJWT({ scope: 'read write' })
            .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
            .setIssuer(ISSUER)
            .setAudience(AUDIENCE)
            .setSubject('user-1')
            .setIssuedAt()
    }

    it('accepts a token that has an expiry', async () => {
        const token = await baseToken().setExpirationTime('5m').sign(privateKey)

        const result = await validator.validate(token)

        expect(result.valid).toBe(true)
        expect(result.claims?.sub).toBe('user-1')
        expect(result.claims?.exp).toBeGreaterThan(Math.floor(Date.now() / 1000))
        expect(result.claims?.scopes).toEqual(['read', 'write'])
    })

    it('rejects a validly signed token that has no exp claim', async () => {
        const token = await baseToken().sign(privateKey)

        const result = await validator.validate(token)

        expect(result.valid).toBe(false)
        expect(result.claims).toBeUndefined()
        expect(result.errorCode).toBe(AUTH_ERROR_CODES.TOKEN_INVALID)
    })

    it('does not leak the missing-claim detail to the caller', async () => {
        const token = await baseToken().sign(privateKey)

        const result = await validator.validate(token)

        expect(result.error).toBe('Invalid or expired token')
        expect(result.error).not.toMatch(/missing|claim|"exp"/i)
    })

    it('still reports an expired token as expired', async () => {
        const past = Math.floor(Date.now() / 1000) - 3600
        const token = await baseToken().setExpirationTime(past).sign(privateKey)

        const result = await validator.validate(token)

        expect(result.valid).toBe(false)
        expect(result.errorCode).toBe(AUTH_ERROR_CODES.TOKEN_EXPIRED)
    })

    it('still rejects a token for a different audience', async () => {
        const token = await new SignJWT({ scope: 'read' })
            .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
            .setIssuer(ISSUER)
            .setAudience('some-other-service')
            .setSubject('user-1')
            .setExpirationTime('5m')
            .sign(privateKey)

        const result = await validator.validate(token)

        expect(result.valid).toBe(false)
        expect(result.errorCode).toBe(AUTH_ERROR_CODES.TOKEN_INVALID)
    })
})
