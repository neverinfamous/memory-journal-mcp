import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../src/utils/error-helpers.js', () => ({
    formatHandlerError: vi.fn().mockImplementation((err: Error) => ({
        success: false,
        error: err.message,
    })),
}))

vi.mock('../../src/utils/progress-utils.js', () => ({
    sendProgress: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../../src/markdown/index.js', () => ({
    exportEntriesToMarkdown: vi.fn().mockResolvedValue({
        success: true,
        exported_count: 2,
    }),
    importMarkdownEntries: vi.fn().mockResolvedValue({
        success: true,
        created: 1,
    }),
}))

import { getTeamIoTools } from '../../src/handlers/tools/team/io-tools.js'
import { resolveAuthor } from '../../src/utils/security-utils.js'

vi.mock('../../src/utils/security-utils.js', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../src/utils/security-utils.js')>()
    return {
        ...actual,
        resolveAuthor: vi.fn().mockReturnValue('TestAuthor'),
    }
})

describe('getTeamIoTools', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    function createMockContext() {
        return {
            teamDb: {
                getRecentEntries: vi.fn().mockReturnValue([]),
            },
            progress: null,
        }
    }

    it('should define team IO tools', () => {
        const context = createMockContext()
        const tools = getTeamIoTools(context as never)

        expect(tools.length).toBeGreaterThan(0)
        expect(tools.map((t) => t.name)).toContain('team_export_markdown')
        expect(tools.map((t) => t.name)).toContain('team_import_markdown')

        // Assert they are in the team group
        for (const tool of tools) {
            expect(tool.group).toBe('team')
        }
    })

    describe('team_export_markdown', () => {
        it('should return error when teamDb not configured', async () => {
            const context = { progress: null } as any
            const handler = getTeamIoTools(context).find(
                (t) => t.name === 'team_export_markdown'
            )!.handler
            const result = (await handler({ output_dir: '/tmp/team-out' })) as any
            expect(result.success).toBe(false)
            expect(result.error).toContain('Team collaboration is not configured')
        })

        it('should fetch by dates when start_date is provided', async () => {
            const context = createMockContext()
            ;(context.teamDb as any).searchByDateRange = vi.fn().mockReturnValue([])
            const handler = getTeamIoTools(context as never).find(
                (t) => t.name === 'team_export_markdown'
            )!.handler

            await handler({
                output_dir: '/tmp/team-out',
                start_date: '2025-01-01',
            })
            expect((context.teamDb as any).searchByDateRange).toHaveBeenCalled()
        })

        it('should handle errors during export', async () => {
            const context = createMockContext()
            context.teamDb.getRecentEntries = vi.fn().mockImplementation(() => {
                throw new Error('Export error')
            })
            const handler = getTeamIoTools(context as never).find(
                (t) => t.name === 'team_export_markdown'
            )!.handler

            const result = (await handler({ output_dir: '/tmp/team-out' })) as any
            expect(result.success).toBe(false)
            expect(result.error).toContain('Export error')
        })

        it('should call export tool with teamDb', async () => {
            const context = createMockContext()
            const handler = getTeamIoTools(context as never).find(
                (t) => t.name === 'team_export_markdown'
            )!.handler

            const result = (await handler({ output_dir: '/tmp/team-out' })) as Record<
                string,
                unknown
            >

            expect(result['success']).toBe(true)
            expect(result['exported_count']).toBe(2)
        })
    })

    describe('team_import_markdown', () => {
        it('should return error when teamDb not configured', async () => {
            const context = { progress: null } as any
            const handler = getTeamIoTools(context).find(
                (t) => t.name === 'team_import_markdown'
            )!.handler
            const result = (await handler({ source_dir: '/tmp/team-in' })) as any
            expect(result.success).toBe(false)
            expect(result.error).toContain('Team collaboration is not configured')
        })

        it('should handle errors during import', async () => {
            const context = createMockContext()
            const handler = getTeamIoTools(context as never).find(
                (t) => t.name === 'team_import_markdown'
            )!.handler
            const result = (await handler({ source_dir: '/tmp/team-in', limit: 1000 })) as any
            expect(result.success).toBe(false)
        })

        it('should resolve author and pass to importer options', async () => {
            const context = createMockContext()
            const handler = getTeamIoTools(context as never).find(
                (t) => t.name === 'team_import_markdown'
            )!.handler

            const result = (await handler({ source_dir: '/tmp/team-in' })) as Record<
                string,
                unknown
            >

            expect(result['success']).toBe(true)
            expect(result['created']).toBe(1)
            expect(resolveAuthor).toHaveBeenCalled()
        })
    })
})
