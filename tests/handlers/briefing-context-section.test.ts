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
        getRecentEntries: vi.fn().mockReturnValue({ entries: [
            {
                id: 1,
                timestamp: '2025-01-15T10:00:00Z',
                entryType: 'note',
                content: 'This is a sample entry for testing purposes.',
                importanceScore: 0.5,
            },
            {
                id: 2,
                timestamp: '2025-01-14T09:00:00Z',
                entryType: 'decision',
                content: 'Decided to use TypeScript for the project.',
                importanceScore: 0.5,
            },
        ] }),
        searchEntries: vi.fn().mockReturnValue({ entries: [] }),
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
            '<untrusted_remote_content>This is a sample entry for testing purposes.</untrusted_remote_content>'
        )
    })

    it('should truncate long content previews with ellipsis', () => {
        const longContent = 'A'.repeat(200)
        const db = createMockDb({
            getRecentEntries: vi.fn().mockReturnValue({ entries: [
                {
                    id: 1,
                    timestamp: '2025-01-15T10:00:00Z',
                    entryType: 'note',
                    content: longContent,
                    importanceScore: 0.5,
                },
            ] }),
        })
        const context = { db } as never

        const result = buildJournalContext(context, createMockConfig() as never)

        // 120-char preview with word-boundary truncation, using Unicode ellipsis
        // No word boundaries in 'AAAA...' so it truncates at exactly 120
        expect(result.latestEntries[0]!.preview).toContain('\u2026</untrusted_remote_content>')
    })

    it('should handle empty database', () => {
        const db = createMockDb({
            getRecentEntries: vi.fn().mockReturnValue({ entries: [] }),
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
            getRecentEntries: vi.fn().mockReturnValue({ entries: [
                {
                    id: 1,
                    timestamp: '2025-01-15T10:00:00Z',
                    entryType: 'note',
                    content: null,
                    importanceScore: 0.5,
                },
            ] }),
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
            getRecentEntries: vi.fn().mockReturnValue({ entries: [
                {
                    id: 5,
                    timestamp: '2025-01-15T10:00:00Z',
                    entryType: 'note',
                    content: 'Team entry content',
                },
            ] }),
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
            getRecentEntries: vi.fn().mockReturnValue({ entries: [] }),
            getActiveEntryCount: vi.fn().mockReturnValue(0),
        })
        const context = { teamDb } as never

        const result = buildTeamContext(context, createMockConfig() as never)

        expect(result).toBeDefined()
        expect(result!.teamInfo.totalEntries).toBe(0)
        expect(result!.teamInfo.latestPreview).toBeNull()
    })

    it('should truncate long team content previews', () => {
        const longContent = 'B'.repeat(200)
        const teamDb = createMockDb({
            getRecentEntries: vi.fn().mockReturnValue({ entries: [
                {
                    id: 1,
                    timestamp: '2025-01-15T10:00:00Z',
                    entryType: 'note',
                    content: longContent,
                },
            ] }),
            getActiveEntryCount: vi.fn().mockReturnValue(1),
        })
        const context = { teamDb } as never
        const config = createMockConfig({ includeTeam: true })

        const result = buildTeamContext(context, config as never)

        // Team info preview uses 60 chars, team entries preview uses 120 chars
        // Unicode ellipsis (…) instead of ASCII dots (...)
        expect(result!.teamInfo.latestPreview).toContain('\u2026')
        expect(result!.teamLatestEntries![0]!.preview).toContain('\u2026')
    })
})


