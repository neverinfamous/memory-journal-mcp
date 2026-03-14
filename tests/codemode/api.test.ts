/**
 * Code Mode API Bridge Tests
 *
 * Tests for JournalApi, toolNameToMethodName, and createSandboxBindings:
 * - Tool name → camelCase conversion
 * - Group API creation
 * - Positional argument support
 * - Method aliases
 * - help() discoverability
 * - Top-level aliases
 * - Codemode tool exclusion (no recursion)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { JournalApi, toolNameToMethodName, createJournalApi } from '../../src/codemode/api.js'
import type { ToolDefinition } from '../../src/types/index.js'

// =============================================================================
// Test Fixtures
// =============================================================================

function createMockTool(
    name: string,
    group: string,
    handler?: (params: unknown) => unknown
): ToolDefinition {
    return {
        name,
        title: name,
        description: `Test tool: ${name}`,
        group: group as ToolDefinition['group'],
        inputSchema: {} as ToolDefinition['inputSchema'],
        outputSchema: {} as ToolDefinition['outputSchema'],
        annotations: { readOnlyHint: true },
        handler: handler ?? ((params: unknown) => Promise.resolve({ success: true, params })),
    }
}

function createMinimalToolSet(): ToolDefinition[] {
    return [
        createMockTool('create_entry', 'core'),
        createMockTool('create_entry_minimal', 'core'),
        createMockTool('get_entry_by_id', 'core'),
        createMockTool('get_recent_entries', 'core'),
        createMockTool('search_entries', 'search'),
        createMockTool('semantic_search', 'search'),
        createMockTool('get_statistics', 'analytics'),
        createMockTool('link_entries', 'relationships'),
        createMockTool('export_entries', 'export'),
        createMockTool('update_entry', 'admin'),
        createMockTool('delete_entry', 'admin'),
        createMockTool('get_github_issues', 'github'),
        createMockTool('backup_journal', 'backup'),
        createMockTool('team_create_entry', 'team'),
    ]
}

// =============================================================================
// toolNameToMethodName
// =============================================================================

describe('toolNameToMethodName', () => {
    it('should convert snake_case to camelCase', () => {
        expect(toolNameToMethodName('create_entry', 'core')).toBe('createEntry')
    })

    it('should handle multi-word names', () => {
        expect(toolNameToMethodName('get_recent_entries', 'core')).toBe('getRecentEntries')
    })

    it('should handle single-word names', () => {
        expect(toolNameToMethodName('export_entries', 'export')).toBe('exportEntries')
    })

    it('should keep prefix for github tools', () => {
        expect(toolNameToMethodName('get_github_issues', 'github')).toBe('getGithubIssues')
    })

    it('should keep prefix for team tools', () => {
        expect(toolNameToMethodName('team_create_entry', 'team')).toBe('teamCreateEntry')
    })

    it('should handle search tools', () => {
        expect(toolNameToMethodName('search_entries', 'search')).toBe('searchEntries')
        expect(toolNameToMethodName('semantic_search', 'search')).toBe('semanticSearch')
    })

    it('should handle admin tools', () => {
        expect(toolNameToMethodName('update_entry', 'admin')).toBe('updateEntry')
        expect(toolNameToMethodName('delete_entry', 'admin')).toBe('deleteEntry')
    })

    it('should handle backup tools', () => {
        expect(toolNameToMethodName('backup_journal', 'backup')).toBe('backupJournal')
        expect(toolNameToMethodName('list_backups', 'backup')).toBe('listBackups')
    })
})

// =============================================================================
// JournalApi
// =============================================================================

describe('JournalApi', () => {
    let api: JournalApi

    beforeEach(() => {
        api = new JournalApi(createMinimalToolSet())
    })

    // =========================================================================
    // Group Creation
    // =========================================================================

    describe('group creation', () => {
        it('should create all 9 group namespaces', () => {
            expect(api.core).toBeDefined()
            expect(api.search).toBeDefined()
            expect(api.analytics).toBeDefined()
            expect(api.relationships).toBeDefined()
            expect(api.export).toBeDefined()
            expect(api.admin).toBeDefined()
            expect(api.github).toBeDefined()
            expect(api.backup).toBeDefined()
            expect(api.team).toBeDefined()
        })

        it('should populate groups with methods', () => {
            expect(typeof api.core['createEntry']).toBe('function')
            expect(typeof api.search['searchEntries']).toBe('function')
            expect(typeof api.analytics['getStatistics']).toBe('function')
        })

        it('should exclude codemode tools', () => {
            const toolsWithCodemode = [
                ...createMinimalToolSet(),
                createMockTool('mj_execute_code', 'codemode'),
            ]
            const apiWithCodemode = new JournalApi(toolsWithCodemode)
            // Codemode group should not appear in groups
            expect(apiWithCodemode.getGroups()).not.toContain('codemode')
        })
    })

    // =========================================================================
    // Method Invocation
    // =========================================================================

    describe('method invocation', () => {
        it('should call handler with object params', async () => {
            const result = await api.core['createEntry']!({ content: 'test' })
            expect(result).toBeDefined()
        })

        it('should call handler with positional string arg', async () => {
            const handler = vi.fn().mockResolvedValue({ success: true })
            const tools = [createMockTool('create_entry', 'core', handler)]
            const testApi = new JournalApi(tools)
            await testApi.core['createEntry']!('My note')
            expect(handler).toHaveBeenCalledWith({ content: 'My note' })
        })

        it('should call handler with positional number arg', async () => {
            const handler = vi.fn().mockResolvedValue({ success: true })
            const tools = [createMockTool('get_entry_by_id', 'core', handler)]
            const testApi = new JournalApi(tools)
            await testApi.core['getEntryById']!(42)
            expect(handler).toHaveBeenCalledWith({ entry_id: 42 })
        })

        it('should pass through empty params for no-arg calls', async () => {
            const handler = vi.fn().mockResolvedValue({ success: true })
            const tools = [createMockTool('get_statistics', 'analytics', handler)]
            const testApi = new JournalApi(tools)
            await testApi.analytics['getStatistics']!()
            expect(handler).toHaveBeenCalledWith({})
        })
    })

    // =========================================================================
    // Aliases
    // =========================================================================

    describe('method aliases', () => {
        it('should have core aliases', () => {
            expect(api.core['create']).toBeDefined()
            expect(api.core['create']).toBe(api.core['createEntry'])
        })

        it('should have search aliases', () => {
            expect(api.search['find']).toBeDefined()
            expect(api.search['find']).toBe(api.search['searchEntries'])
        })

        it('should have backup aliases', () => {
            expect(api.backup['save']).toBeDefined()
            expect(api.backup['save']).toBe(api.backup['backupJournal'])
        })
    })

    // =========================================================================
    // help()
    // =========================================================================

    describe('help()', () => {
        it('should provide group-level help', async () => {
            const help = (await api.core['help']!()) as {
                group: string
                methods: string[]
                examples: string[]
            }
            expect(help.group).toBe('core')
            expect(help.methods).toContain('createEntry')
            expect(help.methods).not.toContain('help') // help itself is excluded
        })

        it('should include examples in help output', async () => {
            const help = (await api.core['help']!()) as { examples: string[] }
            expect(help.examples.length).toBeGreaterThan(0)
            expect(help.examples.some((e) => e.includes('createEntry'))).toBe(true)
        })
    })

    // =========================================================================
    // getGroups / getGroupMethods
    // =========================================================================

    describe('getGroups', () => {
        it('should return sorted group names', () => {
            const groups = api.getGroups()
            expect(groups.length).toBeGreaterThan(0)
            expect(groups).toContain('core')
            expect(groups).toContain('search')
            // Verify sorted
            const sorted = [...groups].sort()
            expect(groups).toEqual(sorted)
        })
    })

    describe('getGroupMethods', () => {
        it('should return method names for a group', () => {
            const methods = api.getGroupMethods('core')
            expect(methods).toContain('createEntry')
            expect(methods).not.toContain('help')
        })

        it('should return empty for unknown group', () => {
            const methods = api.getGroupMethods('nonexistent' as 'core')
            expect(methods).toEqual([])
        })
    })

    // =========================================================================
    // createSandboxBindings
    // =========================================================================

    describe('createSandboxBindings', () => {
        it('should include all group namespaces', () => {
            const bindings = api.createSandboxBindings()
            expect(bindings['core']).toBeDefined()
            expect(bindings['search']).toBeDefined()
            expect(bindings['analytics']).toBeDefined()
            expect(bindings['relationships']).toBeDefined()
            expect(bindings['export']).toBeDefined()
            expect(bindings['admin']).toBeDefined()
            expect(bindings['github']).toBeDefined()
            expect(bindings['backup']).toBeDefined()
            expect(bindings['team']).toBeDefined()
        })

        it('should include top-level convenience aliases', () => {
            const bindings = api.createSandboxBindings()
            expect(typeof bindings['createEntry']).toBe('function')
            expect(typeof bindings['getRecentEntries']).toBe('function')
            expect(typeof bindings['searchEntries']).toBe('function')
            expect(typeof bindings['getStatistics']).toBe('function')
        })

        it('should include top-level help()', () => {
            const bindings = api.createSandboxBindings()
            expect(typeof bindings['help']).toBe('function')
        })

        it('should return top-level help with groups and totalMethods', async () => {
            const bindings = api.createSandboxBindings()
            const help = (await (bindings['help'] as () => Promise<unknown>)()) as {
                groups: string[]
                totalMethods: number
                usage: string
            }
            expect(help.groups.length).toBeGreaterThan(0)
            expect(help.totalMethods).toBeGreaterThan(0)
            expect(help.usage).toContain('mj.')
        })
    })
})

// =============================================================================
// createJournalApi factory
// =============================================================================

describe('createJournalApi', () => {
    it('should create a JournalApi instance', () => {
        const api = createJournalApi(createMinimalToolSet())
        expect(api).toBeInstanceOf(JournalApi)
    })

    it('should work identically to constructor', () => {
        const tools = createMinimalToolSet()
        const api1 = new JournalApi(tools)
        const api2 = createJournalApi(tools)
        expect(api1.getGroups()).toEqual(api2.getGroups())
    })
})
