/**
 * memory-journal-mcp — OAuth Middleware Unit Tests
 *
 * Tests for Express middleware, token extraction, path matching,
 * scope enforcement, error handling, and transport-agnostic utilities.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
    extractBearerToken,
    requireScope,
    requireAnyScope,
    requireToolScope,
    oauthErrorHandler,
    createAuthMiddleware,
    createAuthenticatedContext,
    validateAuth,
    formatOAuthError,
} from '../../src/auth/middleware.js'
import {
    TokenMissingError,
    InvalidTokenError,
    InsufficientScopeError,
} from '../../src/auth/errors.js'
import { TokenValidator } from '../../src/auth/token-validator.js'

// =============================================================================
// extractBearerToken
// =============================================================================

describe('extractBearerToken', () => {
    it('should extract token from valid Bearer header', () => {
        expect(extractBearerToken('Bearer abc123')).toBe('abc123')
    })

    it('should return null for missing header', () => {
        expect(extractBearerToken(undefined)).toBeNull()
    })

    it('should return null for non-Bearer scheme', () => {
        expect(extractBearerToken('Basic abc123')).toBeNull()
    })

    it('should return null for empty token', () => {
        expect(extractBearerToken('Bearer ')).toBeNull()
    })

    it('should return null for malformed header', () => {
        expect(extractBearerToken('Bearer')).toBeNull()
        expect(extractBearerToken('Bearer a b c')).toBeNull()
    })

    it('should be case-insensitive for scheme', () => {
        expect(extractBearerToken('bearer abc123')).toBe('abc123')
        expect(extractBearerToken('BEARER abc123')).toBe('abc123')
    })
})

// =============================================================================
// requireScope
// =============================================================================

describe('requireScope', () => {
    it('should call next when scope is present', () => {
        const middleware = requireScope('read')

        const req = { auth: { scopes: ['read', 'write'] } } as never
        const res = { status: vi.fn().mockReturnThis(), json: vi.fn(), setHeader: vi.fn() } as never
        const next = vi.fn()

        middleware(req, res, next)
        expect(next).toHaveBeenCalled()
    })

    it('should return 403 when scope is missing', () => {
        const middleware = requireScope('admin')

        const req = { auth: { scopes: ['read'] } } as never
        const statusMock = vi.fn().mockReturnThis()
        const res = { status: statusMock, json: vi.fn(), setHeader: vi.fn() } as never
        const next = vi.fn()

        middleware(req, res, next)
        expect(next).not.toHaveBeenCalled()
        expect(statusMock).toHaveBeenCalledWith(403)
    })

    it('should return 401 when no auth context', () => {
        const middleware = requireScope('read')

        const req = {} as never
        const statusMock = vi.fn().mockReturnThis()
        const res = { status: statusMock, json: vi.fn() } as never
        const next = vi.fn()

        middleware(req, res, next)
        expect(statusMock).toHaveBeenCalledWith(401)
    })

    it('should grant access for admin scope', () => {
        const middleware = requireScope('read')

        const req = { auth: { scopes: ['admin'] } } as never
        const res = { status: vi.fn().mockReturnThis(), json: vi.fn(), setHeader: vi.fn() } as never
        const next = vi.fn()

        middleware(req, res, next)
        expect(next).toHaveBeenCalled()
    })

    it('should grant access for full scope', () => {
        const middleware = requireScope('admin')

        const req = { auth: { scopes: ['full'] } } as never
        const res = { status: vi.fn().mockReturnThis(), json: vi.fn(), setHeader: vi.fn() } as never
        const next = vi.fn()

        middleware(req, res, next)
        expect(next).toHaveBeenCalled()
    })
})

// =============================================================================
// requireAnyScope
// =============================================================================

describe('requireAnyScope', () => {
    it('should call next when any scope matches', () => {
        const middleware = requireAnyScope(['read', 'write'])

        const req = { auth: { scopes: ['write'] } } as never
        const res = { status: vi.fn().mockReturnThis(), json: vi.fn(), setHeader: vi.fn() } as never
        const next = vi.fn()

        middleware(req, res, next)
        expect(next).toHaveBeenCalled()
    })

    it('should return 403 when no scopes match', () => {
        const middleware = requireAnyScope(['admin'])

        const req = { auth: { scopes: ['read'] } } as never
        const statusMock = vi.fn().mockReturnThis()
        const res = { status: statusMock, json: vi.fn(), setHeader: vi.fn() } as never
        const next = vi.fn()

        middleware(req, res, next)
        expect(next).not.toHaveBeenCalled()
        expect(statusMock).toHaveBeenCalledWith(403)
    })

    it('should return 401 when no auth context', () => {
        const middleware = requireAnyScope(['read'])

        const req = {} as never
        const statusMock = vi.fn().mockReturnThis()
        const res = { status: statusMock, json: vi.fn() } as never
        const next = vi.fn()

        middleware(req, res, next)
        expect(statusMock).toHaveBeenCalledWith(401)
    })

    it('should grant access for full scope', () => {
        const middleware = requireAnyScope(['admin'])

        const req = { auth: { scopes: ['full'] } } as never
        const res = { status: vi.fn().mockReturnThis(), json: vi.fn(), setHeader: vi.fn() } as never
        const next = vi.fn()

        middleware(req, res, next)
        expect(next).toHaveBeenCalled()
    })
})

// =============================================================================
// requireToolScope
// =============================================================================

describe('requireToolScope', () => {
    it('should call next when sufficient scope for tool', () => {
        // get_recent_entries is a core tool → requires read scope
        const middleware = requireToolScope('get_recent_entries')

        const req = { auth: { scopes: ['read'] } } as never
        const res = { status: vi.fn().mockReturnThis(), json: vi.fn(), setHeader: vi.fn() } as never
        const next = vi.fn()

        middleware(req, res, next)
        expect(next).toHaveBeenCalled()
    })

    it('should return 401 when no auth context', () => {
        const middleware = requireToolScope('get_recent_entries')

        const req = {} as never
        const statusMock = vi.fn().mockReturnThis()
        const res = { status: statusMock, json: vi.fn() } as never
        const next = vi.fn()

        middleware(req, res, next)
        expect(statusMock).toHaveBeenCalledWith(401)
    })
})

// =============================================================================
// oauthErrorHandler
// =============================================================================

describe('oauthErrorHandler', () => {
    it('should handle OAuthError', () => {
        const error = new TokenMissingError()

        const req = {} as never
        const statusMock = vi.fn().mockReturnThis()
        const jsonMock = vi.fn()
        const setHeaderMock = vi.fn()
        const res = { status: statusMock, json: jsonMock, setHeader: setHeaderMock } as never
        const next = vi.fn()

        oauthErrorHandler(error, req, res, next)
        expect(statusMock).toHaveBeenCalledWith(401)
        expect(next).not.toHaveBeenCalled()
    })

    it('should pass non-OAuth errors to next', () => {
        const error = new Error('generic')

        const req = {} as never
        const res = { status: vi.fn().mockReturnThis(), json: vi.fn(), setHeader: vi.fn() } as never
        const next = vi.fn()

        oauthErrorHandler(error, req, res, next)
        expect(next).toHaveBeenCalledWith(error)
    })
})

// =============================================================================
// createAuthenticatedContext
// =============================================================================

describe('createAuthenticatedContext', () => {
    const mockValidator = Object.create(TokenValidator.prototype) as TokenValidator
    mockValidator.validate = vi.fn()

    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('should return unauthenticated context when no token', async () => {
        const ctx = await createAuthenticatedContext(undefined, mockValidator)
        expect(ctx.authenticated).toBe(false)
        expect(ctx.scopes).toEqual([])
    })

    it('should return unauthenticated context for invalid token', async () => {
        vi.mocked(mockValidator.validate).mockResolvedValueOnce({
            valid: false,
            error: 'Invalid token',
        })

        const ctx = await createAuthenticatedContext('Bearer invalid', mockValidator)
        expect(ctx.authenticated).toBe(false)
    })

    it('should return authenticated context for valid token', async () => {
        vi.mocked(mockValidator.validate).mockResolvedValueOnce({
            valid: true,
            claims: {
                sub: 'user-1',
                scopes: ['read', 'write'],
                exp: 0,
                iat: 0,
            },
        })

        const ctx = await createAuthenticatedContext('Bearer valid-token', mockValidator)
        expect(ctx.authenticated).toBe(true)
        expect(ctx.scopes).toEqual(['read', 'write'])
    })
})

// =============================================================================
// validateAuth
// =============================================================================

describe('validateAuth', () => {
    const mockValidator = Object.create(TokenValidator.prototype) as TokenValidator
    mockValidator.validate = vi.fn()

    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('should throw TokenMissingError when required and no token', async () => {
        await expect(validateAuth(undefined, mockValidator, { required: true })).rejects.toThrow(
            TokenMissingError
        )
    })

    it('should return unauthenticated when not required and no token', async () => {
        const ctx = await validateAuth(undefined, mockValidator, { required: false })
        expect(ctx.authenticated).toBe(false)
    })

    it('should throw InvalidTokenError for invalid token', async () => {
        vi.mocked(mockValidator.validate).mockResolvedValueOnce({
            valid: false,
            error: 'Invalid token',
        })

        await expect(
            validateAuth('Bearer invalid', mockValidator, { required: true })
        ).rejects.toThrow(InvalidTokenError)
    })

    it('should throw InsufficientScopeError for missing required scope', async () => {
        vi.mocked(mockValidator.validate).mockResolvedValueOnce({
            valid: true,
            claims: {
                sub: 'user-1',
                scopes: ['read'],
                exp: 0,
                iat: 0,
            },
        })

        await expect(
            validateAuth('Bearer valid', mockValidator, {
                required: true,
                requiredScopes: ['admin'],
            })
        ).rejects.toThrow(InsufficientScopeError)
    })

    it('should return authenticated context for valid token with required scope', async () => {
        vi.mocked(mockValidator.validate).mockResolvedValueOnce({
            valid: true,
            claims: {
                sub: 'user-1',
                scopes: ['read', 'admin'],
                exp: 0,
                iat: 0,
            },
        })

        const ctx = await validateAuth('Bearer valid', mockValidator, {
            required: true,
            requiredScopes: ['admin'],
        })
        expect(ctx.authenticated).toBe(true)
        expect(ctx.scopes).toContain('admin')
    })
})

// =============================================================================
// formatOAuthError
// =============================================================================

describe('formatOAuthError', () => {
    it('should format TokenMissingError', () => {
        const result = formatOAuthError(new TokenMissingError())
        expect(result.status).toBe(401)
        expect(result.body).toHaveProperty('error', 'invalid_token')
    })

    it('should format InvalidTokenError', () => {
        const result = formatOAuthError(new InvalidTokenError('Token is bad'))
        expect(result.status).toBe(401)
        expect(result.body).toHaveProperty('error', 'invalid_token')
    })

    it('should format InsufficientScopeError', () => {
        const result = formatOAuthError(new InsufficientScopeError('admin'))
        expect(result.status).toBe(403)
        expect(result.body).toHaveProperty('error', 'insufficient_scope')
    })

    it('should format generic errors as 500', () => {
        const result = formatOAuthError(new Error('Unknown'))
        expect(result.status).toBe(500)
        expect(result.body).toHaveProperty('error', 'server_error')
    })
})

// =============================================================================
// createAuthMiddleware
// =============================================================================

describe('createAuthMiddleware', () => {
    function makeReqResNext(overrides: Record<string, unknown> = {}) {
        const req = {
            path: '/mcp',
            headers: {} as Record<string, string>,
            ...overrides,
        } as never
        const statusMock = vi.fn().mockReturnThis()
        const jsonMock = vi.fn()
        const setHeaderMock = vi.fn()
        const res = { status: statusMock, json: jsonMock, setHeader: setHeaderMock } as never
        const next = vi.fn()
        return { req, res, next, statusMock, jsonMock, setHeaderMock }
    }

    const mockValidator = Object.create(TokenValidator.prototype) as TokenValidator
    mockValidator.validate = vi.fn()

    const mockResourceServer = {
        getResourceUri: () => 'https://mcp.example.com',
        getWWWAuthenticateHeader: (error?: string, description?: string) =>
            `Bearer realm="mcp", error="${error ?? ''}", error_description="${description ?? ''}"`,
    } as never

    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('should bypass auth for .well-known paths', async () => {
        const middleware = createAuthMiddleware({
            tokenValidator: mockValidator,
            resourceServer: mockResourceServer,
        })
        const { req, res, next } = makeReqResNext({
            path: '/.well-known/oauth-authorization-server',
        })

        await middleware(req, res, next)
        expect(next).toHaveBeenCalled()
    })

    it('should bypass auth for exact public paths', async () => {
        const middleware = createAuthMiddleware({
            tokenValidator: mockValidator,
            resourceServer: mockResourceServer,
            publicPaths: ['/health'],
        })
        const { req, res, next } = makeReqResNext({ path: '/health' })

        await middleware(req, res, next)
        expect(next).toHaveBeenCalled()
    })

    it('should bypass auth for wildcard public paths', async () => {
        const middleware = createAuthMiddleware({
            tokenValidator: mockValidator,
            resourceServer: mockResourceServer,
            publicPaths: ['/api/*'],
        })
        const { req, res, next } = makeReqResNext({ path: '/api/users' })

        await middleware(req, res, next)
        expect(next).toHaveBeenCalled()
    })

    it('should bypass auth for wildcard prefix exact match', async () => {
        const middleware = createAuthMiddleware({
            tokenValidator: mockValidator,
            resourceServer: mockResourceServer,
            publicPaths: ['/api/*'],
        })
        const { req, res, next } = makeReqResNext({ path: '/api' })

        await middleware(req, res, next)
        expect(next).toHaveBeenCalled()
    })

    it('should return 401 when no token provided', async () => {
        const middleware = createAuthMiddleware({
            tokenValidator: mockValidator,
            resourceServer: mockResourceServer,
        })
        const { req, res, next, statusMock, jsonMock } = makeReqResNext({
            path: '/mcp',
            headers: {},
        })

        await middleware(req, res, next)
        expect(next).not.toHaveBeenCalled()
        expect(statusMock).toHaveBeenCalledWith(401)
        expect(jsonMock).toHaveBeenCalledWith(expect.objectContaining({ error: 'unauthorized' }))
    })

    it('should return 401 when token is invalid', async () => {
        vi.mocked(mockValidator.validate).mockResolvedValueOnce({
            valid: false,
            error: 'Token expired',
        })

        const middleware = createAuthMiddleware({
            tokenValidator: mockValidator,
            resourceServer: mockResourceServer,
        })
        const { req, res, next, statusMock, jsonMock } = makeReqResNext({
            path: '/mcp',
            headers: { authorization: 'Bearer bad-token' },
        })

        await middleware(req, res, next)
        expect(next).not.toHaveBeenCalled()
        expect(statusMock).toHaveBeenCalledWith(401)
        expect(jsonMock).toHaveBeenCalledWith(expect.objectContaining({ error: 'invalid_token' }))
    })

    it('should attach auth context and call next() for valid token', async () => {
        vi.mocked(mockValidator.validate).mockResolvedValueOnce({
            valid: true,
            claims: { sub: 'user-42', scopes: ['read', 'write'], exp: 0, iat: 0 },
        })

        const middleware = createAuthMiddleware({
            tokenValidator: mockValidator,
            resourceServer: mockResourceServer,
        })

        const rawReq = {
            path: '/mcp',
            headers: { authorization: 'Bearer good-token' },
        } as unknown as Record<string, unknown>
        const statusMock = vi.fn().mockReturnThis()
        const res = { status: statusMock, json: vi.fn(), setHeader: vi.fn() } as never
        const next = vi.fn()

        await middleware(rawReq as never, res, next)
        expect(next).toHaveBeenCalled()
        expect(rawReq['auth']).toBeDefined()
        expect((rawReq['auth'] as { sub: string }).sub).toBe('user-42')
    })

    it('should return 500 when valid=true but claims is undefined', async () => {
        vi.mocked(mockValidator.validate).mockResolvedValueOnce({
            valid: true,
            claims: undefined,
        } as never)

        const middleware = createAuthMiddleware({
            tokenValidator: mockValidator,
            resourceServer: mockResourceServer,
        })
        const { req, res, next, statusMock, jsonMock } = makeReqResNext({
            path: '/mcp',
            headers: { authorization: 'Bearer weird-token' },
        })

        await middleware(req, res, next)
        expect(next).not.toHaveBeenCalled()
        expect(statusMock).toHaveBeenCalledWith(500)
        expect(jsonMock).toHaveBeenCalledWith(expect.objectContaining({ error: 'internal_error' }))
    })

    it('should not bypass non-matching paths', async () => {
        const middleware = createAuthMiddleware({
            tokenValidator: mockValidator,
            resourceServer: mockResourceServer,
            publicPaths: ['/health', '/api/*'],
        })
        const { req, res, next, statusMock } = makeReqResNext({
            path: '/secret',
            headers: {},
        })

        await middleware(req, res, next)
        expect(next).not.toHaveBeenCalled()
        expect(statusMock).toHaveBeenCalledWith(401)
    })
})

// =============================================================================
// requireToolScope — scope-denied branch
// =============================================================================

describe('requireToolScope - scope denied', () => {
    it('should return 403 when user lacks required scope for tool', () => {
        // backup_journal requires admin scope
        const middleware = requireToolScope('backup_journal')

        const req = { auth: { scopes: ['read'] } } as never
        const statusMock = vi.fn().mockReturnThis()
        const res = { status: statusMock, json: vi.fn(), setHeader: vi.fn() } as never
        const next = vi.fn()

        middleware(req, res, next)
        expect(next).not.toHaveBeenCalled()
        expect(statusMock).toHaveBeenCalledWith(403)
    })
})
