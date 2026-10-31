import { describe, it, expect } from 'vitest'
import { McpServer, InMemoryTransport } from '@modelcontextprotocol/server'
import { Client } from '@modelcontextprotocol/client'
import { SkillsClient } from '@modelcontextprotocol/client/ext/skills'
import {
    resolveBundledSkillsDir,
    loadBundledSkillCatalog,
} from '../../src/server/mcp-server/initialization.js'

describe('Bundled SEP-2640 Skills over MCP', () => {
    it('resolves the bundled skills directory containing memory-journal-mcp/SKILL.md', () => {
        const dir = resolveBundledSkillsDir()
        expect(dir).toBeDefined()
        expect(dir).toMatch(/skills$/)
    })

    it('loads the bundled skill catalog and exposes memory-journal-mcp', async () => {
        const catalog = await loadBundledSkillCatalog()
        expect(catalog).toBeDefined()
        expect(catalog?.entries.length).toBeGreaterThanOrEqual(1)

        const entry = catalog?.entries.find(
            (e) => e.uri === 'skill://memory-journal-mcp/SKILL.md'
        )
        expect(entry).toBeDefined()
        expect(entry?.frontmatter.name).toBe('memory-journal-mcp')
        expect(entry?.frontmatter.description).toContain('Memory Journal MCP')
    })

    it('degrades gracefully when given a nonexistent skills directory', async () => {
        const catalog = await loadBundledSkillCatalog('/nonexistent/skills/directory/path')
        expect(catalog).toBeUndefined()
    })

    it('serves skills/list, skills/get, and verified skill:// resource reads via SkillsClient', async () => {
        const catalog = await loadBundledSkillCatalog()
        expect(catalog).toBeDefined()
        if (!catalog) return

        const server = new McpServer(
            { name: 'memory-journal-mcp', version: '1.0.0' },
            {
                capabilities: {
                    resources: { subscribe: true, listChanged: true },
                },
            }
        )
        catalog.attach(server)

        const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
        const client = new Client({ name: 'test-skills-client', version: '1.0.0' })
        await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])

        const skillsClient = new SkillsClient(client)
        expect(skillsClient.supported).toBe(true)
        expect(skillsClient.directoryRead).toBe(true)

        const listing = await skillsClient.list()
        expect(listing.invalid).toEqual([])
        expect(listing.skills.length).toBeGreaterThanOrEqual(1)

        const skill = listing.skills.find(
            (s) => s.uri === 'skill://memory-journal-mcp/SKILL.md'
        )
        expect(skill).toBeDefined()
        if (!skill) {
            await Promise.all([client.close(), server.close()])
            return
        }

        const fetched = await skillsClient.get('skill://memory-journal-mcp/SKILL.md')
        expect(fetched.skill.uri).toBe('skill://memory-journal-mcp/SKILL.md')
        expect(fetched.skill.frontmatter.name).toBe('memory-journal-mcp')

        const file = await skillsClient.read(skill)
        expect(file.verified).toBe(true)
        expect(file.uri).toBe('skill://memory-journal-mcp/SKILL.md')
        expect(file.body).toContain('# Memory Journal MCP Guidelines')

        const resources = await client.listResources()
        expect(resources.resources.map((r) => r.uri)).toContain(
            'skill://memory-journal-mcp/SKILL.md'
        )

        await Promise.all([client.close(), server.close()])
    })
})
