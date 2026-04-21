/**
 * memory-journal-mcp — Authorization Server Discovery Unit Tests
 *
 * Tests for RFC 8414 authorization server metadata discovery.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as https from 'node:https'
import { EventEmitter } from 'node:events'
import {
    AuthorizationServerDiscovery,
    createAuthServerDiscovery,
} from '../../src/auth/authorization-server-discovery.js'

const { mockHttpsRequestFn } = vi.hoisted(() => ({
    mockHttpsRequestFn: vi.fn(),
}))

vi.mock('node:https', () => ({
    default: { request: mockHttpsRequestFn },
    request: mockHttpsRequestFn,
}))

function mockHttpsRequest(metadata: any, statusCode = 200) {
    const mockReq = new EventEmitter() as any
    mockReq.end = vi.fn()
    mockReq.destroy = vi.fn()

    const mockRes = new EventEmitter() as any
    mockRes.statusCode = statusCode
    mockRes.statusMessage = statusCode === 200 ? 'OK' : 'Error'

    mockHttpsRequestFn.mockImplementationOnce((url: any, options: any, callback: any) => {
        if (typeof callback === 'function') {
            process.nextTick(() => {
                callback(mockRes)
                if (metadata) {
                    mockRes.emit('data', Buffer.from(JSON.stringify(metadata)))
                }
                mockRes.emit('end')
            })
        }
        return mockReq as any
    })

    return mockHttpsRequestFn
}

vi.mock('node:dns', () => ({
    promises: {
        lookup: vi.fn().mockResolvedValue({ address: '203.0.113.1' }),
    },
}))

describe('AuthorizationServerDiscovery', () => {
    const authServerUrl = 'https://auth.example.com'

    beforeEach(() => {
        vi.clearAllMocks()
    })

    afterEach(() => {
        vi.restoreAllMocks()
    })

    describe('construction', () => {
        it('should create instance with URL', () => {
            const discovery = new AuthorizationServerDiscovery({
                authServerUrl,
            })
            expect(discovery).toBeInstanceOf(AuthorizationServerDiscovery)
        })

        it('should normalize URL (remove trailing slash)', () => {
            const discovery = new AuthorizationServerDiscovery({
                authServerUrl: 'https://auth.example.com/',
            })
            expect(discovery.getAuthServerUrl()).toBe('https://auth.example.com')
        })
    })

    describe('createAuthServerDiscovery factory', () => {
        it('should create instance', () => {
            const discovery = createAuthServerDiscovery(authServerUrl)
            expect(discovery).toBeInstanceOf(AuthorizationServerDiscovery)
        })

        it('should accept options', () => {
            const discovery = createAuthServerDiscovery(authServerUrl, {
                cacheTtl: 600,
                timeout: 10000,
            })
            expect(discovery).toBeDefined()
        })
    })

    describe('discover', () => {
        it('should fetch metadata from well-known endpoint', async () => {
            const mockMetadata = {
                issuer: authServerUrl,
                token_endpoint: `${authServerUrl}/oauth/token`,
                jwks_uri: `${authServerUrl}/.well-known/jwks.json`,
                scopes_supported: ['read', 'write', 'admin'],
            }

            mockHttpsRequest(mockMetadata)

            const discovery = new AuthorizationServerDiscovery({ authServerUrl })
            const metadata = await discovery.discover()

            expect(metadata.issuer).toBe(authServerUrl)
            expect(metadata.token_endpoint).toBe(`${authServerUrl}/oauth/token`)
        })

        it('should cache metadata', async () => {
            const mockMetadata = {
                issuer: authServerUrl,
                token_endpoint: `${authServerUrl}/oauth/token`,
            }

            const requestSpy = mockHttpsRequest(mockMetadata)

            const discovery = new AuthorizationServerDiscovery({ authServerUrl })
            await discovery.discover()
            await discovery.discover()

            // Should only be called once due to caching
            expect(requestSpy).toHaveBeenCalledTimes(1)
        })

        it('should throw on HTTP error', async () => {
            mockHttpsRequest(null, 404)

            const discovery = new AuthorizationServerDiscovery({ authServerUrl })

            await expect(discovery.discover()).rejects.toThrow()
        })

        it('should throw on missing issuer field', async () => {
            mockHttpsRequest({
                token_endpoint: `${authServerUrl}/oauth/token`,
            })

            const discovery = new AuthorizationServerDiscovery({ authServerUrl })

            await expect(discovery.discover()).rejects.toThrow()
        })

        it('should throw on missing token_endpoint', async () => {
            mockHttpsRequest({
                issuer: authServerUrl,
            })

            const discovery = new AuthorizationServerDiscovery({ authServerUrl })

            await expect(discovery.discover()).rejects.toThrow()
        })
    })

    describe('getMetadata', () => {
        it('should throw if not yet discovered', () => {
            const discovery = new AuthorizationServerDiscovery({ authServerUrl })
            expect(() => discovery.getMetadata()).toThrow('not yet discovered')
        })
    })

    describe('getJwksUri', () => {
        it('should return jwks_uri from metadata', async () => {
            const mockMetadata = {
                issuer: authServerUrl,
                token_endpoint: `${authServerUrl}/oauth/token`,
                jwks_uri: `${authServerUrl}/.well-known/jwks.json`,
            }

            mockHttpsRequest(mockMetadata)

            const discovery = new AuthorizationServerDiscovery({ authServerUrl })
            await discovery.discover()

            expect(discovery.getJwksUri()).toBe(`${authServerUrl}/.well-known/jwks.json`)
        })

        it('should throw if jwks_uri not in metadata', async () => {
            const mockMetadata = {
                issuer: authServerUrl,
                token_endpoint: `${authServerUrl}/oauth/token`,
            }

            mockHttpsRequest(mockMetadata)

            const discovery = new AuthorizationServerDiscovery({ authServerUrl })
            await discovery.discover()

            expect(() => discovery.getJwksUri()).toThrow('does not provide jwks_uri')
        })
    })

    describe('cache management', () => {
        it('should clear cache', () => {
            const discovery = new AuthorizationServerDiscovery({ authServerUrl })
            expect(() => discovery.clearCache()).not.toThrow()
        })

        it('should report cache validity', () => {
            const discovery = new AuthorizationServerDiscovery({ authServerUrl })
            expect(discovery.isCacheValid()).toBe(false)
        })

        it('should report valid cache after discover', async () => {
            mockHttpsRequest({
                issuer: authServerUrl,
                token_endpoint: `${authServerUrl}/oauth/token`,
            })

            const discovery = new AuthorizationServerDiscovery({ authServerUrl })
            await discovery.discover()

            expect(discovery.isCacheValid()).toBe(true)
        })
    })

    describe('accessor methods', () => {
        const mockMetadata = {
            issuer: authServerUrl,
            token_endpoint: `${authServerUrl}/oauth/token`,
            jwks_uri: `${authServerUrl}/.well-known/jwks.json`,
            scopes_supported: ['read', 'write'],
            registration_endpoint: `${authServerUrl}/oauth/register`,
        }

        it('should return token endpoint', async () => {
            mockHttpsRequest(mockMetadata)

            const discovery = new AuthorizationServerDiscovery({ authServerUrl })
            await discovery.discover()

            expect(discovery.getTokenEndpoint()).toBe(`${authServerUrl}/oauth/token`)
        })

        it('should return issuer', async () => {
            mockHttpsRequest(mockMetadata)

            const discovery = new AuthorizationServerDiscovery({ authServerUrl })
            await discovery.discover()

            expect(discovery.getIssuer()).toBe(authServerUrl)
        })

        it('should return registration endpoint', async () => {
            mockHttpsRequest(mockMetadata)

            const discovery = new AuthorizationServerDiscovery({ authServerUrl })
            await discovery.discover()

            expect(discovery.getRegistrationEndpoint()).toBe(`${authServerUrl}/oauth/register`)
            expect(discovery.supportsClientRegistration()).toBe(true)
        })

        it('should return supported scopes', async () => {
            mockHttpsRequest(mockMetadata)

            const discovery = new AuthorizationServerDiscovery({ authServerUrl })
            await discovery.discover()

            expect(discovery.getSupportedScopes()).toEqual(['read', 'write'])
            expect(discovery.isScopeSupported('read')).toBe(true)
            expect(discovery.isScopeSupported('unknown')).toBe(false)
        })
    })
})
