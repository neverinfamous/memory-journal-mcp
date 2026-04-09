/**
 * memory-journal-mcp — Briefing Context Section Unit Tests
 *
 * Tests for buildJournalContext, buildTeamContext, buildRulesFileInfo,
 * and buildSkillsDirInfo used in the briefing resource.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
    buildJournalContext,
    buildTeamContext,
    buildRulesFileInfo,
    buildSkillsDirInfo,
} from '../../src/handlers/resources/core/briefing/context-section.js'

// Mock fs and logger
vi.mock('node:fs', () => ({
    statSync: vi.fn(),
    readdirSync: vi.fn(),
}))

vi.mock('../../src/utils/logger.js', () => ({
    logger: {
        info: vi.fn(),
        warning: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
    },
}))

// ============================================================================
// Shared Mocks
// ============================================================================

function createMockDb(overrides: Partial<Record<string, unknown>> = {}) {
    return {
        getRecentEntries: vi.fn().mockReturnValue([
            {
                id: 1,
                timestamp: '2025-01-15T10:00:00Z',
                entryType: 'note',
                content: 'This is a sample entry for testing purposes.',
            },
            {
                id: 2,
                timestamp: '2025-01-14T09:00:00Z',
                entryType: 'decision',
                content: 'Decided to use TypeScript for the project.',
            },
        ]),
        searchEntries: vi.fn().mockReturnValue([]),
        getActiveEntryCount: vi.fn().mockReturnValue(42),
        ...overrides,
    }
}

function createMockConfig(overrides: Partial<Record<string, unknown>> = {}) {
    return {
        entryCount: 5,
        includeTeam: false,
        issueCount: 5,
        prCount: 5,
        workflowCount: 3,
        copilotReviews: false,
        prStatusBreakdown: false,
        workflowStatusBreakdown: false,
        ...overrides,
    }
}

// ============================================================================
// buildJournalContext
// ============================================================================

describe('buildJournalContext', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('should return total entries and latest entries with previews', () => {
        const db = createMockDb()
        const config = createMockConfig()
        const context = { db } as never

        const result = buildJournalContext(context, config as never)

        expect(result.totalEntries).toBe(42)
        expect(result.latestEntries).toHaveLength(2)
        expect(result.latestEntries[0]!.id).toBe(1)
        expect(result.latestEntries[0]!.type).toBe('note')
        expect(result.latestEntries[0]!.preview).toBe(
            'This is a sample entry for testing purposes.'
        )
    })

    it('should truncate long content previews with ellipsis', () => {
        const longContent = 'A'.repeat(100)
        const db = createMockDb({
            getRecentEntries: vi.fn().mockReturnValue([
                {
                    id: 1,
                    timestamp: '2025-01-15T10:00:00Z',
                    entryType: 'note',
                    content: longContent,
                },
            ]),
        })
        const context = { db } as never

        const result = buildJournalContext(context, createMockConfig() as never)

        expect(result.latestEntries[0]!.preview).toHaveLength(83) // 80 + '...'
        expect(result.latestEntries[0]!.preview).toMatch(/\.\.\.$/)
    })

    it('should handle empty database', () => {
        const db = createMockDb({
            getRecentEntries: vi.fn().mockReturnValue([]),
            getActiveEntryCount: vi.fn().mockReturnValue(0),
        })
        const context = { db } as never

        const result = buildJournalContext(context, createMockConfig() as never)

        expect(result.totalEntries).toBe(0)
        expect(result.latestEntries).toHaveLength(0)
        // lastModified should fall back to current time
        expect(result.lastModified).toBeDefined()
    })

    it('should handle entries with null content', () => {
        const db = createMockDb({
            getRecentEntries: vi.fn().mockReturnValue([
                {
                    id: 1,
                    timestamp: '2025-01-15T10:00:00Z',
                    entryType: 'note',
                    content: null,
                },
            ]),
        })
        const context = { db } as never

        const result = buildJournalContext(context, createMockConfig() as never)

        expect(result.latestEntries[0]!.preview).toBe('')
    })
})

// ============================================================================
// buildTeamContext
// ============================================================================

describe('buildTeamContext', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('should return undefined when no teamDb', () => {
        const context = { teamDb: null } as never
        const result = buildTeamContext(context, createMockConfig() as never)
        expect(result).toBeUndefined()
    })

    it('should return team info with latest preview', () => {
        const teamDb = createMockDb({
            getRecentEntries: vi.fn().mockReturnValue([
                {
                    id: 5,
                    timestamp: '2025-01-15T10:00:00Z',
                    entryType: 'note',
                    content: 'Team entry content',
                },
            ]),
            getActiveEntryCount: vi.fn().mockReturnValue(10),
        })
        const context = { teamDb } as never

        const result = buildTeamContext(context, createMockConfig() as never)

        expect(result).toBeDefined()
        expect(result!.teamInfo.totalEntries).toBe(10)
        expect(result!.teamInfo.latestPreview).toContain('#5')
        expect(result!.teamInfo.latestPreview).toContain('Team entry content')
    })

    it('should include team entries when includeTeam is true', () => {
        const teamDb = createMockDb({
            getActiveEntryCount: vi.fn().mockReturnValue(5),
        })
        const context = { teamDb } as never
        const config = createMockConfig({ includeTeam: true })

        const result = buildTeamContext(context, config as never)

        expect(result).toBeDefined()
        expect(result!.teamLatestEntries).toBeDefined()
        expect(result!.teamLatestEntries).toHaveLength(2)
    })

    it('should NOT include team entries when includeTeam is false', () => {
        const teamDb = createMockDb({
            getActiveEntryCount: vi.fn().mockReturnValue(5),
        })
        const context = { teamDb } as never
        const config = createMockConfig({ includeTeam: false })

        const result = buildTeamContext(context, config as never)

        expect(result).toBeDefined()
        expect(result!.teamLatestEntries).toBeUndefined()
    })

    it('should return undefined on error', () => {
        const teamDb = {
            getActiveEntryCount: vi.fn().mockImplementation(() => {
                throw new Error('DB error')
            }),
        }
        const context = { teamDb } as never

        const result = buildTeamContext(context, createMockConfig() as never)
        expect(result).toBeUndefined()
    })

    it('should handle team DB with no entries', () => {
        const teamDb = createMockDb({
            getRecentEntries: vi.fn().mockReturnValue([]),
            getActiveEntryCount: vi.fn().mockReturnValue(0),
        })
        const context = { teamDb } as never

        const result = buildTeamContext(context, createMockConfig() as never)

        expect(result).toBeDefined()
        expect(result!.teamInfo.totalEntries).toBe(0)
        expect(result!.teamInfo.latestPreview).toBeNull()
    })

    it('should truncate long team content previews', () => {
        const longContent = 'B'.repeat(100)
        const teamDb = createMockDb({
            getRecentEntries: vi.fn().mockReturnValue([
                {
                    id: 1,
                    timestamp: '2025-01-15T10:00:00Z',
                    entryType: 'note',
                    content: longContent,
                },
            ]),
            getActiveEntryCount: vi.fn().mockReturnValue(1),
        })
        const context = { teamDb } as never
        const config = createMockConfig({ includeTeam: true })

        const result = buildTeamContext(context, config as never)

        // Team info preview uses 60 chars, team entries preview uses 80 chars
        expect(result!.teamInfo.latestPreview).toContain('...')
        expect(result!.teamLatestEntries![0]!.preview).toMatch(/\.\.\.$/)
    })
})

// ============================================================================
// buildRulesFileInfo
// ============================================================================

describe('buildRulesFileInfo', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('should return undefined for undefined path', () => {
        expect(buildRulesFileInfo(undefined)).toBeUndefined()
    })

    it('should return file info for valid path', async () => {
        const { statSync } = await import('node:fs')

        // File modified 2 days ago
        const twoHoursAgo = Date.now() - 2 * 3_600_000
        vi.mocked(statSync).mockReturnValue({
            size: 2048,
            mtimeMs: twoHoursAgo,
        } as never)

        const result = buildRulesFileInfo('/path/to/.rules')

        expect(result).toBeDefined()
        expect(result!.name).toBe('.rules')
        expect(result!.sizeKB).toBe(2)
        expect(result!.lastModified).toBe('2h ago')
        expect(result!.path).toBe('/path/to/.rules')
    })

    it('should format age as days when > 1 day', async () => {
        const { statSync } = await import('node:fs')

        const threeDaysAgo = Date.now() - 3 * 86_400_000
        vi.mocked(statSync).mockReturnValue({
            size: 1024,
            mtimeMs: threeDaysAgo,
        } as never)

        const result = buildRulesFileInfo('/path/to/.rules')

        expect(result!.lastModified).toBe('3d ago')
    })

    it('should format age as "just now" when < 1 hour', async () => {
        const { statSync } = await import('node:fs')

        vi.mocked(statSync).mockReturnValue({
            size: 512,
            mtimeMs: Date.now() - 1000, // 1 second ago
        } as never)

        const result = buildRulesFileInfo('/path/to/.rules')

        expect(result!.lastModified).toBe('just now')
    })

    it('should return undefined on file error', async () => {
        const { statSync } = await import('node:fs')

        vi.mocked(statSync).mockImplementation(() => {
            throw new Error('ENOENT: no such file')
        })

        const result = buildRulesFileInfo('/nonexistent/.rules')
        expect(result).toBeUndefined()
    })
})

// ============================================================================
// buildSkillsDirInfo
// ============================================================================

describe('buildSkillsDirInfo', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('should return undefined for undefined path', () => {
        expect(buildSkillsDirInfo(undefined)).toBeUndefined()
    })

    it('should return skills directory info', async () => {
        const { readdirSync } = await import('node:fs')

        vi.mocked(readdirSync).mockReturnValue([
            { name: 'skill-a', isDirectory: () => true, isFile: () => false },
            { name: 'skill-b', isDirectory: () => true, isFile: () => false },
            { name: 'readme.md', isDirectory: () => false, isFile: () => true },
        ] as never)

        const result = buildSkillsDirInfo('/path/to/skills')

        expect(result).toBeDefined()
        expect(result!.count).toBe(2)
        expect(result!.names).toEqual(['skill-a', 'skill-b'])
        expect(result!.path).toBe('/path/to/skills')
    })

    it('should return empty when no directories', async () => {
        const { readdirSync } = await import('node:fs')

        vi.mocked(readdirSync).mockReturnValue([
            { name: 'readme.md', isDirectory: () => false, isFile: () => true },
        ] as never)

        const result = buildSkillsDirInfo('/path/to/skills')

        expect(result).toBeDefined()
        expect(result!.count).toBe(0)
        expect(result!.names).toEqual([])
    })

    it('should return undefined on directory error', async () => {
        const { readdirSync } = await import('node:fs')

        vi.mocked(readdirSync).mockImplementation(() => {
            throw new Error('ENOENT: no such directory')
        })

        const result = buildSkillsDirInfo('/nonexistent/skills')
        expect(result).toBeUndefined()
    })
})
