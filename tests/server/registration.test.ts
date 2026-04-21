import { describe, it, expect, vi } from 'vitest'
import { registerResources, registerPrompts } from '../../src/server/registration.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { ConfigurationError } from '../../src/types/errors.js'

describe('Registration Helpers', () => {
    describe('registerResources', () => {
        it('should throw ConfigurationError if runtime is missing for template resource', async () => {
            const server = new McpServer({ name: 'test', version: '1.0' })
            server.registerResource = vi.fn()

            registerResources(server, [{ name: 'test', uri: 'test://{var}' }], vi.fn())
            
            const handler = vi.mocked(server.registerResource).mock.calls[0][3] as Function
            await expect(handler(new URL('test://abc'), { var: 'abc' })).rejects.toThrow(ConfigurationError)
        })

        it('should throw ConfigurationError if runtime is missing for static resource', async () => {
            const server = new McpServer({ name: 'test', version: '1.0' })
            server.registerResource = vi.fn()

            registerResources(server, [{ name: 'test', uri: 'test://static' }], vi.fn())
            
            const handler = vi.mocked(server.registerResource).mock.calls[0][3] as Function
            await expect(handler(new URL('test://static'))).rejects.toThrow(ConfigurationError)
        })
    })

    describe('registerPrompts', () => {
        it('should throw ConfigurationError if runtime is missing', () => {
            const server = new McpServer({ name: 'test', version: '1.0' })
            server.registerPrompt = vi.fn()

            registerPrompts(server, [{ name: 'test-prompt' }], {} as any)
            
            const handler = vi.mocked(server.registerPrompt).mock.calls[0][2] as Function
            expect(() => handler({})).toThrow(ConfigurationError)
        })
    })
})
