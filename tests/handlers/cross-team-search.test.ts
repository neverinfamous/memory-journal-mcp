import { describe, it, expect, beforeEach, vi } from 'vitest'
import { handleCrossTeamSearch, resetCrossTeamCacheForTests, CrossTeamSearchSchema } from '../../src/handlers/tools/search/cross-team.js'
import type { ToolContext } from '../../src/types/index.js'
import { ConfigurationError } from '../../src/types/errors.js'
import { DatabaseAdapterFactory } from '../../src/database/adapter-factory.js'

// Mock the DatabaseAdapterFactory
vi.mock('../../src/database/adapter-factory.js', () => ({
    DatabaseAdapterFactory: {
        create: vi.fn(),
    },
}))

describe('Cross-Team Search Handler', () => {
    let mockContext: ToolContext

    beforeEach(() => {
        vi.clearAllMocks()
        resetCrossTeamCacheForTests()

        mockContext = {
            db: {} as any,
            config: {
                additionalTeamDbs: {
                    'team-a': '/path/to/team-a.db',
                    'team-b': '/path/to/team-b.db',
                },
            },
        }
    })

    function createMockAdapter(entries: any[], shouldThrow = false) {
        return {
            initialize: vi.fn().mockResolvedValue(undefined),
            applyTeamSchema: vi.fn(),
            searchEntries: vi.fn().mockImplementation(() => {
                if (shouldThrow) {
                    throw new Error('Mock DB Error')
                }
                return {
                    entries,
                    count: entries.length,
                }
            }),
        }
    }

    it('throws ConfigurationError if no additionalTeamDbs configured', async () => {
        mockContext.config!.additionalTeamDbs = {}
        await expect(
            handleCrossTeamSearch(CrossTeamSearchSchema.parse({ query: 'test', limit: 10 }), mockContext)
        ).rejects.toThrow(ConfigurationError)
    })

    it('returns degraded result if requested team DB is not configured', async () => {
        const result = await handleCrossTeamSearch(
            CrossTeamSearchSchema.parse({ query: 'test', team_dbs: ['nonexistent'], limit: 10 }),
            mockContext
        )
        expect(result.success).toBe(true)
        expect(result.entries).toHaveLength(0)
        expect(result.degraded).toBe(true)
        expect(result.errors?.[0]?.error).toContain('None of the requested team DBs')
    })

    it('searches all configured DBs and merges results', async () => {
        const adapterA = createMockAdapter([
            { id: 1, content: 'Team A result', timestamp: '2026-01-02T10:00:00Z', importanceScore: 0.8 },
        ])
        const adapterB = createMockAdapter([
            { id: 1, content: 'Team B result', timestamp: '2026-01-03T10:00:00Z', importanceScore: 0.5 },
        ])

        vi.mocked(DatabaseAdapterFactory.create).mockImplementation(async (path) => {
            if (path === '/path/to/team-a.db') return adapterA as any
            if (path === '/path/to/team-b.db') return adapterB as any
            throw new Error('Unknown path')
        })

        const result = await handleCrossTeamSearch(CrossTeamSearchSchema.parse({ query: 'result', limit: 10 }), mockContext)

        expect(result.success).toBe(true)
        expect(result.searched_dbs).toEqual(['team-a', 'team-b'])
        expect(result.entries).toHaveLength(2)
        expect(result.degraded).toBeFalsy()

        // Should be sorted by timestamp DESC by default
        expect(result.entries![0]!.content).toBe('Team B result')
        expect(result.entries![0]!.team_db).toBe('team-b')
        expect(result.entries![1]!.content).toBe('Team A result')
        expect(result.entries![1]!.team_db).toBe('team-a')
        
        // Assert adapter was called with correctly boosted limit
        expect(adapterA.searchEntries).toHaveBeenCalledWith(
            'result',
            {
                limit: 20,
                tags: undefined,
                entryType: undefined,
                startDate: undefined,
                endDate: undefined,
                fuzzy_match: false,
                includeArchived: false,
            }
        )
    })

    it('filters target DBs when team_dbs is provided', async () => {
        const adapterA = createMockAdapter([{ id: 1, content: 'Team A', timestamp: '2026-01-01' }])
        const adapterB = createMockAdapter([{ id: 1, content: 'Team B', timestamp: '2026-01-01' }])

        vi.mocked(DatabaseAdapterFactory.create).mockImplementation(async (path) => {
            if (path === '/path/to/team-a.db') return adapterA as any
            if (path === '/path/to/team-b.db') return adapterB as any
            throw new Error('Unknown path')
        })

        const result = await handleCrossTeamSearch(
            CrossTeamSearchSchema.parse({ query: 'test', team_dbs: ['team-a'], limit: 10 }),
            mockContext
        )

        expect(result.success).toBe(true)
        expect(result.searched_dbs).toEqual(['team-a'])
        expect(result.entries).toHaveLength(1)
        expect(result.entries![0]!.team_db).toBe('team-a')
        expect(adapterB.searchEntries).not.toHaveBeenCalled()
    })

    it('gracefully degrades when one DB fails', async () => {
        const adapterA = createMockAdapter([{ id: 1, content: 'Team A', timestamp: '2026-01-01' }])
        const adapterB = createMockAdapter([], true) // This one throws

        vi.mocked(DatabaseAdapterFactory.create).mockImplementation(async (path) => {
            if (path === '/path/to/team-a.db') return adapterA as any
            if (path === '/path/to/team-b.db') return adapterB as any
            throw new Error('Unknown path')
        })

        const result = await handleCrossTeamSearch(CrossTeamSearchSchema.parse({ query: 'test', limit: 10 }), mockContext)

        expect(result.success).toBe(true)
        expect(result.searched_dbs).toEqual(['team-a'])
        expect(result.entries).toHaveLength(1)
        expect(result.degraded).toBe(true)
        expect(result.errors).toHaveLength(1)
        expect(result.errors![0]!.team_db).toBe('team-b')
        expect(result.errors![0]!.error).toBe('Mock DB Error')
    })
    
    it('sorts by importance when requested', async () => {
        const adapterA = createMockAdapter([
            { id: 1, content: 'Team A low', timestamp: '2026-01-02T10:00:00Z', importanceScore: 0.1 },
        ])
        const adapterB = createMockAdapter([
            { id: 1, content: 'Team B high', timestamp: '2026-01-01T10:00:00Z', importanceScore: 0.9 }, // Older but higher importance
        ])

        vi.mocked(DatabaseAdapterFactory.create).mockImplementation(async (path) => {
            if (path === '/path/to/team-a.db') return adapterA as any
            if (path === '/path/to/team-b.db') return adapterB as any
            throw new Error('Unknown path')
        })

        const result = await handleCrossTeamSearch(CrossTeamSearchSchema.parse({ query: 'result', limit: 10, sort_by: 'importance' }), mockContext)

        expect(result.success).toBe(true)
        expect(result.entries).toHaveLength(2)
        expect(result.entries![0]!.content).toBe('Team B high') // High importance first
    })
    
    it('applies final limit after merge', async () => {
        const adapterA = createMockAdapter([
            { id: 1, content: 'A1', timestamp: '2026-01-05T10:00:00Z' },
            { id: 2, content: 'A2', timestamp: '2026-01-03T10:00:00Z' },
        ])
        const adapterB = createMockAdapter([
            { id: 1, content: 'B1', timestamp: '2026-01-04T10:00:00Z' },
            { id: 2, content: 'B2', timestamp: '2026-01-02T10:00:00Z' },
        ])

        vi.mocked(DatabaseAdapterFactory.create).mockImplementation(async (path) => {
            if (path === '/path/to/team-a.db') return adapterA as any
            if (path === '/path/to/team-b.db') return adapterB as any
            throw new Error('Unknown path')
        })

        const result = await handleCrossTeamSearch(CrossTeamSearchSchema.parse({ query: 'test', limit: 2 }), mockContext)

        expect(result.success).toBe(true)
        expect(result.entries).toHaveLength(2) // Kept only 2
        // Should be A1, B1 (newest overall)
        expect(result.entries![0]!.content).toBe('A1')
        expect(result.entries![1]!.content).toBe('B1')
    })
})
