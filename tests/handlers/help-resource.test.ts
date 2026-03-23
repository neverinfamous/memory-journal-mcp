import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { getHelpResourceDefinitions } from '../../src/handlers/resources/help.js'
import { DatabaseAdapter } from '../../src/database/sqlite-adapter/index.js'
import type { ResourceContext } from '../../src/handlers/resources/shared.js'
import * as fs from 'fs'

describe('Help Resource Handlers', () => {
    let db: DatabaseAdapter

    beforeAll(async () => {
        const dbPath = './test-help-resource.db'
        if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath)
        db = new DatabaseAdapter(dbPath)
        await db.initialize()
    })

    afterAll(() => {
        db.close()
        const dbPath = './test-help-resource.db'
        if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath)
    })

    const getContext = (): ResourceContext => ({ db })

    it(
        'should generate memory://help listing all groups',
        async () => {
            const defs = getHelpResourceDefinitions()
            const rootHelp = defs.find((d) => d.uri === 'memory://help')
            expect(rootHelp).toBeDefined()

            const result = (await rootHelp!.handler('memory://help', getContext())) as any
            expect(result.data.totalGroups).toBeGreaterThan(0)
            expect(result.data.groups.some((g: any) => g.name === 'core')).toBe(true)
            expect(result.data.groups.some((g: any) => g.name === 'search')).toBe(true)
        },
        15000
    )

    it('should generate memory://help/{group} for a valid group', async () => {
        const defs = getHelpResourceDefinitions()
        const groupHelp = defs.find((d) => d.uri === 'memory://help/{group}')
        expect(groupHelp).toBeDefined()

        const result = (await groupHelp!.handler('memory://help/core', getContext())) as any
        expect(result.data.group).toBe('core')
        expect(result.data.tools.length).toBeGreaterThan(0)
        expect(result.data.tools.some((t: any) => t.name === 'create_entry')).toBe(true)

        // Check that parameters are extracted with correct types and required flags
        const createEntry = result.data.tools.find((t: any) => t.name === 'create_entry')
        expect(createEntry.parameters).toBeDefined()

        // content is z.string() — required
        const contentParam = createEntry.parameters.find((p: any) => p.name === 'content')
        expect(contentParam).toBeDefined()
        expect(contentParam.type).toBe('string')
        expect(contentParam.required).toBe(true)

        // tags is z.array(z.string()).optional() — not required
        const tagsParam = createEntry.parameters.find((p: any) => p.name === 'tags')
        expect(tagsParam).toBeDefined()
        expect(tagsParam.type).toBe('array')
        expect(tagsParam.required).toBe(false)
    })

    it('should return error for invalid group in memory://help/{group}', async () => {
        const defs = getHelpResourceDefinitions()
        const groupHelp = defs.find((d) => d.uri === 'memory://help/{group}')

        const result = (await groupHelp!.handler(
            'memory://help/invalid_group_name',
            getContext()
        )) as any
        expect(result.data.error).toContain('not found')
        expect(result.data.availableGroups).toBeDefined()
    })

    it('should return error for malformed URI in memory://help/{group}', async () => {
        const defs = getHelpResourceDefinitions()
        const groupHelp = defs.find((d) => d.uri === 'memory://help/{group}')

        const result = (await groupHelp!.handler('memory://help/', getContext())) as any
        expect(result.data.error).toContain('Invalid group')
    })

    it('should generate memory://help/gotchas', async () => {
        const defs = getHelpResourceDefinitions()
        const gotchasHelp = defs.find((d) => d.uri === 'memory://help/gotchas')
        expect(gotchasHelp).toBeDefined()

        const result = (await gotchasHelp!.handler('memory://help/gotchas', getContext())) as any
        expect(result.data).toContain('# memory-journal-mcp — Field Notes &')
        expect(gotchasHelp!.mimeType).toBe('text/markdown')
    })

    it('should handle all tool groups including codemode and team', async () => {
        const defs = getHelpResourceDefinitions()
        const rootHelp = defs.find((d) => d.uri === 'memory://help')

        const result = (await rootHelp!.handler('memory://help', getContext())) as any
        const groupNames = result.data.groups.map((g: any) => g.name)
        expect(groupNames).toContain('admin')
        expect(groupNames).toContain('backup')
    })

    it('should extract parameters from admin group tools', async () => {
        const defs = getHelpResourceDefinitions()
        const groupHelp = defs.find((d) => d.uri === 'memory://help/{group}')

        const result = (await groupHelp!.handler('memory://help/admin', getContext())) as any
        expect(result.data.group).toBe('admin')
        const updateEntry = result.data.tools.find((t: any) => t.name === 'update_entry')
        expect(updateEntry).toBeDefined()
        expect(updateEntry.parameters.length).toBeGreaterThan(0)
    })

    it('should handle search group with optional-heavy schemas', async () => {
        const defs = getHelpResourceDefinitions()
        const groupHelp = defs.find((d) => d.uri === 'memory://help/{group}')

        const result = (await groupHelp!.handler('memory://help/search', getContext())) as any
        expect(result.data.group).toBe('search')
        expect(result.data.tools.length).toBeGreaterThan(0)
    })

    it('should handle relationships group', async () => {
        const defs = getHelpResourceDefinitions()
        const groupHelp = defs.find((d) => d.uri === 'memory://help/{group}')

        const result = (await groupHelp!.handler(
            'memory://help/relationships',
            getContext()
        )) as any
        const linkEntries = result.data.tools.find((t: any) => t.name === 'link_entries')
        expect(linkEntries).toBeDefined()
        // relationship_type should be extracted with enum type
        const relTypeParam = linkEntries.parameters.find((p: any) => p.name === 'relationship_type')
        expect(relTypeParam).toBeDefined()
    })

    it('should handle analytics group with number/date params', async () => {
        const defs = getHelpResourceDefinitions()
        const groupHelp = defs.find((d) => d.uri === 'memory://help/{group}')

        const result = (await groupHelp!.handler('memory://help/analytics', getContext())) as any
        expect(result.data.group).toBe('analytics')
        expect(result.data.tools.length).toBeGreaterThan(0)
    })

    it('should handle export group', async () => {
        const defs = getHelpResourceDefinitions()
        const groupHelp = defs.find((d) => d.uri === 'memory://help/{group}')

        const result = (await groupHelp!.handler('memory://help/export', getContext())) as any
        expect(result.data.group).toBe('export')
    })

    it('should handle team group', async () => {
        const defs = getHelpResourceDefinitions()
        const groupHelp = defs.find((d) => d.uri === 'memory://help/{group}')

        const result = (await groupHelp!.handler('memory://help/team', getContext())) as any
        expect(result.data.group).toBe('team')
        expect(result.data.tools.length).toBeGreaterThan(0)
    })

    it('should handle backup group', async () => {
        const defs = getHelpResourceDefinitions()
        const groupHelp = defs.find((d) => d.uri === 'memory://help/{group}')

        const result = (await groupHelp!.handler('memory://help/backup', getContext())) as any
        expect(result.data.group).toBe('backup')
    })

    it('should handle codemode group', async () => {
        const defs = getHelpResourceDefinitions()
        const groupHelp = defs.find((d) => d.uri === 'memory://help/{group}')

        const result = (await groupHelp!.handler('memory://help/codemode', getContext())) as any
        expect(result.data.group).toBe('codemode')
        expect(result.data.tools.length).toBeGreaterThan(0)
    })

    it('should handle github group', async () => {
        const defs = getHelpResourceDefinitions()
        const groupHelp = defs.find((d) => d.uri === 'memory://help/{group}')

        const result = (await groupHelp!.handler('memory://help/github', getContext())) as any
        expect(result.data.group).toBe('github')
    })
})
