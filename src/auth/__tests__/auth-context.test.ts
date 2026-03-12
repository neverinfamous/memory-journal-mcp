/**
 * memory-journal-mcp — Auth Context Unit Tests
 *
 * Tests for AsyncLocalStorage-based per-request auth context.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import {
    getAuthContext,
    setAuthContext,
    withAuthContext,
    isAuthenticated,
    getAuthenticatedScopes,
} from '../auth-context.js'

describe('auth-context', () => {
    afterEach(() => {
        vi.restoreAllMocks()
    })

    describe('getAuthContext', () => {
        it('should return undefined when no context is set', () => {
            // Outside of any AsyncLocalStorage run, should be undefined
            const ctx = getAuthContext()
            expect(ctx).toBeUndefined()
        })
    })

    describe('withAuthContext', () => {
        it('should run callback with context', () => {
            const context = {
                authenticated: true as const,
                claims: {
                    sub: 'user-1',
                    scopes: ['read', 'write'],
                    exp: Math.floor(Date.now() / 1000) + 3600,
                    iat: Math.floor(Date.now() / 1000),
                },
                token: 'test-token',
            }

            const result = withAuthContext(context, () => {
                const ctx = getAuthContext()
                return ctx?.claims?.sub
            })

            expect(result).toBe('user-1')
        })

        it('should isolate context between calls', () => {
            const context1 = {
                authenticated: true as const,
                claims: {
                    sub: 'user-1',
                    scopes: ['read'],
                    exp: 0,
                    iat: 0,
                },
                token: 'token-1',
            }

            const context2 = {
                authenticated: true as const,
                claims: {
                    sub: 'user-2',
                    scopes: ['admin'],
                    exp: 0,
                    iat: 0,
                },
                token: 'token-2',
            }

            withAuthContext(context1, () => {
                const ctx1 = getAuthContext()
                expect(ctx1?.claims?.sub).toBe('user-1')

                // Nested context should override
                withAuthContext(context2, () => {
                    const ctx2 = getAuthContext()
                    expect(ctx2?.claims?.sub).toBe('user-2')
                })

                // Back to original context
                const ctxAfter = getAuthContext()
                expect(ctxAfter?.claims?.sub).toBe('user-1')
            })
        })
    })

    describe('setAuthContext', () => {
        it('should set and return context', () => {
            const context = {
                authenticated: true as const,
                claims: {
                    sub: 'user-1',
                    scopes: ['read'],
                    exp: 0,
                    iat: 0,
                },
                token: 'test-token',
            }

            // setAuthContext sets the context for checking later
            // This function uses enterWith which replaces the current store
            setAuthContext(context)

            const ctx = getAuthContext()
            expect(ctx?.authenticated).toBe(true)
            expect(ctx?.claims?.sub).toBe('user-1')
        })
    })

    describe('isAuthenticated', () => {
        it('should return false when no context', () => {
            expect(isAuthenticated()).toBe(false)
        })

        it('should return true when authenticated context is set', () => {
            const context = {
                authenticated: true as const,
                claims: {
                    sub: 'user-1',
                    scopes: ['read'],
                    exp: 0,
                    iat: 0,
                },
                token: 'test-token',
            }

            const result = withAuthContext(context, () => {
                return isAuthenticated()
            })

            expect(result).toBe(true)
        })
    })

    describe('getAuthenticatedScopes', () => {
        it('should return empty array when no context', () => {
            expect(getAuthenticatedScopes()).toEqual([])
        })

        it('should return scopes from authenticated context', () => {
            const context = {
                authenticated: true as const,
                claims: {
                    sub: 'user-1',
                    scopes: ['read', 'write'],
                    exp: 0,
                    iat: 0,
                },
                token: 'test-token',
            }

            const result = withAuthContext(context, () => {
                return getAuthenticatedScopes()
            })

            expect(result).toEqual(['read', 'write'])
        })
    })
})
