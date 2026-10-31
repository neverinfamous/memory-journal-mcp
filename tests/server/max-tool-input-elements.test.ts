import { describe, it, expect } from 'vitest'
import { Command } from 'commander'
import { z } from 'zod'
import { McpServer, InMemoryTransport } from '@modelcontextprotocol/server'
import { Client } from '@modelcontextprotocol/client'
import {
    DEFAULT_MAX_TOOL_INPUT_ELEMENTS,
    resolveEffectiveMaxToolInputElements,
} from '../../src/server/mcp-server/tool-registration.js'
import { addServerOptions } from '../../src/cli/option-groups.js'
import { buildServerOptions } from '../../src/cli/server-options-builder.js'
import { ConfigResolver } from '../../src/utils/config-resolver.js'

describe('maxToolInputElements configuration and enforcement', () => {
    it('resolves undefined to DEFAULT_MAX_TOOL_INPUT_ELEMENTS (25,000)', () => {
        expect(DEFAULT_MAX_TOOL_INPUT_ELEMENTS).toBe(25_000)
        expect(resolveEffectiveMaxToolInputElements(undefined)).toBe(25_000)
    })

    it('resolves 0 and Infinity to Infinity (disabled)', () => {
        expect(resolveEffectiveMaxToolInputElements(0)).toBe(Infinity)
        expect(resolveEffectiveMaxToolInputElements(Infinity)).toBe(Infinity)
    })

    it('preserves positive numeric limits', () => {
        expect(resolveEffectiveMaxToolInputElements(100)).toBe(100)
        expect(resolveEffectiveMaxToolInputElements(50_000)).toBe(50_000)
    })

    it('parses CLI --max-tool-input-elements and env MAX_TOOL_INPUT_ELEMENTS', () => {
        const cmd = addServerOptions(new Command())
        cmd.parse(['node', 'cli.js', '--max-tool-input-elements', '12345'])
        const opts = cmd.opts<Record<string, unknown>>()
        const errors: string[] = []
        const resolver = new ConfigResolver(cmd, opts)
        const { serverOptions } = buildServerOptions(resolver, opts, cmd, errors)
        expect(errors).toEqual([])
        expect(serverOptions.maxToolInputElements).toBe(12_345)

        const cmdZero = addServerOptions(new Command())
        cmdZero.parse(['node', 'cli.js', '--max-tool-input-elements', '0'])
        const optsZero = cmdZero.opts<Record<string, unknown>>()
        const errorsZero: string[] = []
        const resolverZero = new ConfigResolver(cmdZero, optsZero)
        const { serverOptions: zeroOptions } = buildServerOptions(
            resolverZero,
            optsZero,
            cmdZero,
            errorsZero
        )
        expect(errorsZero).toEqual([])
        expect(zeroOptions.maxToolInputElements).toBe(0)
        expect(resolveEffectiveMaxToolInputElements(zeroOptions.maxToolInputElements)).toBe(
            Infinity
        )
    })

    it('rejects tool arguments exceeding maxToolInputElements before handler runs', async () => {
        let handlerCalled = false
        const server = new McpServer(
            { name: 'test-server', version: '1.0.0' },
            { maxToolInputElements: resolveEffectiveMaxToolInputElements(10) }
        )

        server.registerTool(
            'test_batch',
            {
                description: 'Test batch tool',
                inputSchema: z.object({
                    items: z.array(z.string()),
                }),
            },
            () => {
                handlerCalled = true
                return {
                    content: [{ type: 'text', text: 'ok' }],
                }
            }
        )

        const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
        const client = new Client({ name: 'test-client', version: '1.0.0' })
        await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])

        const result = await client.callTool({
            name: 'test_batch',
            arguments: {
                items: Array.from({ length: 20 }, (_, i) => `item-${String(i)}`),
            },
        })

        expect(result.isError).toBe(true)
        expect(JSON.stringify(result.content)).toMatch(
            /arguments contain more than the maximum of 10 elements/
        )
        expect(handlerCalled).toBe(false)
        await Promise.all([client.close(), server.close()])
    })

    it('allows 50-entry batch_create_entries-shaped payloads under DEFAULT_MAX_TOOL_INPUT_ELEMENTS', async () => {
        let receivedCount = 0
        const server = new McpServer(
            { name: 'test-server', version: '1.0.0' },
            { maxToolInputElements: resolveEffectiveMaxToolInputElements(undefined) }
        )

        server.registerTool(
            'batch_create_entries',
            {
                description: 'Batch create entries',
                inputSchema: z.object({
                    entries: z.array(
                        z.object({
                            content: z.string(),
                            entry_type: z.string(),
                            tags: z.array(z.string()),
                            auto_context: z.object({
                                commits: z.array(z.string()),
                            }),
                        })
                    ),
                }),
            },
            (args) => {
                receivedCount = args.entries.length
                return {
                    content: [{ type: 'text', text: `created ${String(receivedCount)}` }],
                }
            }
        )

        const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
        const client = new Client({ name: 'test-client', version: '1.0.0' })
        await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])

        const entries = Array.from({ length: 50 }, (_, i) => ({
            content: `Entry ${String(i)}`,
            entry_type: 'technical_note',
            tags: ['tag-a', 'tag-b', 'tag-c', 'tag-d', 'tag-e'],
            auto_context: {
                commits: ['abc1234', 'def5678'],
            },
        }))

        const result = await client.callTool({
            name: 'batch_create_entries',
            arguments: { entries },
        })

        expect(receivedCount).toBe(50)
        expect(result.isError).toBeFalsy()
        await Promise.all([client.close(), server.close()])
    })
})
