/**
 * memory-journal-mcp — OAuth Resource Server Unit Tests
 *
 * Tests for RFC 9728 Protected Resource Metadata.
 */

import { describe, it, expect } from 'vitest'
import {
    OAuthResourceServer,
    createOAuthResourceServer,
} from '../../src/auth/oauth-resource-server.js'

describe('OAuthResourceServer', () => {
    const config = {
        resource: 'http://localhost:3000',
        authorizationServers: ['https://auth.example.com'],
        scopesSupported: ['read', 'write', 'admin'],
    }

    describe('construction', () => {
        it('should create instance with config', () => {
            const server = new OAuthResourceServer(config)
            expect(server).toBeInstanceOf(OAuthResourceServer)
        })

        it('should default bearerMethodsSupported to [header]', () => {
            const server = new OAuthResourceServer(config)
            const metadata = server.getMetadata()
            expect(metadata.bearer_methods_supported).toEqual(['header'])
        })
    })

    describe('createOAuthResourceServer factory', () => {
        it('should create OAuthResourceServer instance', () => {
            const server = createOAuthResourceServer(config)
            expect(server).toBeInstanceOf(OAuthResourceServer)
        })
    })

    describe('getMetadata', () => {
        it('should return RFC 9728 compliant metadata', () => {
            const server = new OAuthResourceServer(config)
            const metadata = server.getMetadata()

            expect(metadata.resource).toBe('http://localhost:3000')
            expect(metadata.authorization_servers).toEqual(['https://auth.example.com'])
            expect(metadata.scopes_supported).toEqual(['read', 'write', 'admin'])
            expect(metadata.bearer_methods_supported).toEqual(['header'])
        })

        it('should include signing algorithms', () => {
            const server = new OAuthResourceServer(config)
            const metadata = server.getMetadata()

            expect(metadata.resource_signing_alg_values_supported).toEqual(['RS256', 'ES256'])
        })

        it('should include documentation link', () => {
            const server = new OAuthResourceServer(config)
            const metadata = server.getMetadata()

            expect(metadata.resource_documentation).toBe('http://localhost:3000/docs')
        })

        it('should cache metadata', () => {
            const server = new OAuthResourceServer(config)
            const metadata1 = server.getMetadata()
            const metadata2 = server.getMetadata()

            expect(metadata1).toBe(metadata2) // Same reference (cached)
        })
    })

    describe('getWWWAuthenticateHeader', () => {
        it('should return Bearer realm header', () => {
            const server = new OAuthResourceServer(config)
            const header = server.getWWWAuthenticateHeader()
            expect(header).toContain('Bearer realm="http://localhost:3000"')
        })

        it('should include error when provided', () => {
            const server = new OAuthResourceServer(config)
            const header = server.getWWWAuthenticateHeader('invalid_token')
            expect(header).toContain('error="invalid_token"')
        })

        it('should include error description when provided', () => {
            const server = new OAuthResourceServer(config)
            const header = server.getWWWAuthenticateHeader('invalid_token', 'Token has expired')
            expect(header).toContain('error_description="Token has expired"')
        })
    })

    describe('accessor methods', () => {
        it('should return resource URI', () => {
            const server = new OAuthResourceServer(config)
            expect(server.getResourceUri()).toBe('http://localhost:3000')
        })

        it('should return authorization servers', () => {
            const server = new OAuthResourceServer(config)
            expect(server.getAuthorizationServers()).toEqual(['https://auth.example.com'])
        })

        it('should return supported scopes', () => {
            const server = new OAuthResourceServer(config)
            expect(server.getSupportedScopes()).toEqual(['read', 'write', 'admin'])
        })

        it('should return well-known path', () => {
            const server = new OAuthResourceServer(config)
            expect(server.getWellKnownPath()).toBe('/.well-known/oauth-protected-resource')
        })
    })

    describe('isScopeSupported', () => {
        it('should return true for base scopes', () => {
            const server = new OAuthResourceServer(config)
            expect(server.isScopeSupported('read')).toBe(true)
            expect(server.isScopeSupported('write')).toBe(true)
            expect(server.isScopeSupported('admin')).toBe(true)
            expect(server.isScopeSupported('full')).toBe(true)
        })

        it('should return false for unsupported scopes', () => {
            const server = new OAuthResourceServer(config)
            expect(server.isScopeSupported('unknown')).toBe(false)
        })
    })

    describe('clearCache', () => {
        it('should clear cached metadata', () => {
            const server = new OAuthResourceServer(config)
            const metadata1 = server.getMetadata()
            server.clearCache()
            const metadata2 = server.getMetadata()

            // Different references after cache clear
            expect(metadata1).not.toBe(metadata2)
            // But same content
            expect(metadata1).toEqual(metadata2)
        })
    })

    describe('getMetadataHandler', () => {
        it('should return a function', () => {
            const server = new OAuthResourceServer(config)
            const handler = server.getMetadataHandler()
            expect(typeof handler).toBe('function')
        })

        it('should serve metadata with correct headers', () => {
            const server = new OAuthResourceServer(config)
            const handler = server.getMetadataHandler()
            
            const mockReq = {} as any
            const mockRes = {
                setHeader: vi.fn(),
                json: vi.fn(),
            } as any

            handler(mockReq, mockRes, vi.fn())

            expect(mockRes.setHeader).toHaveBeenCalledWith('Content-Type', 'application/json')
            expect(mockRes.setHeader).toHaveBeenCalledWith('Cache-Control', 'public, max-age=3600')
            expect(mockRes.json).toHaveBeenCalled()
            
            // Check that it sent the actual metadata
            const metadata = mockRes.json.mock.calls[0][0]
            expect(metadata.resource).toBe(config.resource)
        })
    })
})
