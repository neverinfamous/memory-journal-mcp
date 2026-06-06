import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getTeamAliasTools } from '../../src/handlers/tools/team/alias-tools.js'
import type { ToolContext } from '../../src/types/index.js'
import { StructuredError } from '../../src/types/errors.js'

describe('Team Alias Tools', () => {
    let mockContext: Partial<ToolContext>
    let tools: ReturnType<typeof getTeamAliasTools>

    beforeEach(() => {
        mockContext = {
            resolvedAuthor: 'test_admin',
            teamDb: {
                resolveTeamRole: vi.fn().mockReturnValue(null), // By default, aliases are not existing members
                addAuthorAlias: vi.fn(),
                removeAuthorAlias: vi.fn(),
                listAuthorAliases: vi.fn(),
                resolveAuthor: vi.fn(),
                consolidateAuthors: vi.fn(),
            } as any
        }
        tools = getTeamAliasTools(mockContext as ToolContext)
    })

    const getTool = (name: string) => tools.find(t => t.name === name)!

    describe('team_add_author_alias', () => {
        it('successfully adds an alias', async () => {
            mockContext.teamDb!.addAuthorAlias = vi.fn().mockReturnValue({
                id: 1,
                alias: 'chris',
                canonicalAuthor: 'christopher',
                createdAt: '2026-06-06',
                createdBy: 'test_admin'
            })
            const tool = getTool('team_add_author_alias')
            const result = await tool.handler({ alias: 'chris', canonical_author: 'christopher' }) as any
            
            expect(result.success).toBe(true)
            expect(result.alias.canonicalAuthor).toBe('christopher')
            expect(mockContext.teamDb!.addAuthorAlias).toHaveBeenCalledWith('chris', 'christopher', 'test-author')
        })

        it('rejects if alias is an existing member role', async () => {
            mockContext.teamDb!.resolveTeamRole = vi.fn().mockReturnValue('viewer')
            const tool = getTool('team_add_author_alias')
            
            const result = await tool.handler({ alias: 'existing_user', canonical_author: 'christopher' }) as any
            expect(result.success).toBe(false)
            expect(result.error).toMatch(/Cannot alias 'existing_user' because it is an existing team member/)
        })
    })

    describe('team_remove_author_alias', () => {
        it('successfully removes an alias', async () => {
            mockContext.teamDb!.removeAuthorAlias = vi.fn().mockReturnValue(true)
            const tool = getTool('team_remove_author_alias')
            const result = await tool.handler({ alias: 'chris' }) as any
            
            expect(result.success).toBe(true)
            expect(mockContext.teamDb!.removeAuthorAlias).toHaveBeenCalledWith('chris')
        })

        it('returns RESOURCE_NOT_FOUND if alias does not exist', async () => {
            mockContext.teamDb!.removeAuthorAlias = vi.fn().mockReturnValue(false)
            const tool = getTool('team_remove_author_alias')
            
            const result = await tool.handler({ alias: 'unknown' }) as any
            expect(result.success).toBe(false)
            expect(result.error).toMatch(/not found/)
        })
    })

    describe('team_list_author_aliases', () => {
        it('successfully lists aliases', async () => {
            mockContext.teamDb!.listAuthorAliases = vi.fn().mockReturnValue([
                { alias: 'chris', canonicalAuthor: 'christopher' }
            ])
            const tool = getTool('team_list_author_aliases')
            const result = await tool.handler({}) as any
            
            expect(result.aliases).toHaveLength(1)
            expect(result.aliases[0].alias).toBe('chris')
        })
    })

    describe('team_resolve_author', () => {
        it('successfully resolves an author', async () => {
            mockContext.teamDb!.resolveAuthor = vi.fn().mockReturnValue('christopher')
            const tool = getTool('team_resolve_author')
            const result = await tool.handler({ author: 'chris' }) as any
            
            expect(result.original_author).toBe('chris')
            expect(result.canonical_author).toBe('christopher')
            expect(result.is_aliased).toBe(true)
        })

        it('returns false for is_aliased if author is not aliased', async () => {
            mockContext.teamDb!.resolveAuthor = vi.fn().mockReturnValue('chris')
            const tool = getTool('team_resolve_author')
            const result = await tool.handler({ author: 'chris' }) as any
            
            expect(result.canonical_author).toBe('chris')
            expect(result.is_aliased).toBe(false)
        })
    })

    describe('team_consolidate_authors', () => {
        it('successfully consolidates authors', async () => {
            mockContext.teamDb!.consolidateAuthors = vi.fn().mockReturnValue(42)
            const tool = getTool('team_consolidate_authors')
            const result = await tool.handler({ canonical_author: 'christopher' }) as any
            
            expect(result.success).toBe(true)
            expect(result.updated_count).toBe(42)
            expect(mockContext.teamDb!.consolidateAuthors).toHaveBeenCalledWith('christopher')
        })
    })
})
