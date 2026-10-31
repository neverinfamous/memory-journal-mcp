/**
 * Unit Tests for Git Tools Handler (src/handlers/tools/git.ts)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { DatabaseAdapter } from '../../src/database/sqlite-adapter/index.js'
import { getGitTools } from '../../src/handlers/tools/git.js'
import { insertAnchors } from '../../src/database/sqlite-adapter/entries/anchors.js'
import type { ToolContext } from '../../src/types/index.js'

const { mockBuildGitBaseArgs, mockStreamGitRecords, mockParseGitRecord, mockProcessBatch } =
    vi.hoisted(() => ({
        mockBuildGitBaseArgs: vi.fn(() => ['log']),
        mockStreamGitRecords: vi.fn(),
        mockParseGitRecord: vi.fn((r: unknown) => r),
        mockProcessBatch: vi.fn(),
    }))

vi.mock('../../src/vendor/lib-git-history/git-runner.js', () => ({
    RECORD_SEPARATOR: '\x1e',
    FIELD_SEPARATOR: '\x1f',
    buildGitBaseArgs: mockBuildGitBaseArgs,
    streamGitRecords: mockStreamGitRecords,
}))

vi.mock('../../src/vendor/lib-git-history/parser.js', () => ({
    parseGitRecord: mockParseGitRecord,
    processBatch: mockProcessBatch,
}))

async function* fakeAsyncRecords(items: unknown[]): AsyncGenerator<unknown> {
    for (const item of items) {
        yield item
    }
}

describe('Git Tools Handler', () => {
    let db: DatabaseAdapter
    let context: ToolContext

    beforeEach(async () => {
        vi.clearAllMocks()
        mockStreamGitRecords.mockImplementation(() => fakeAsyncRecords(['raw-record-1']))
        mockProcessBatch.mockResolvedValue([
            {
                hash: 'abcdef123456',
                shortHash: 'abcdef1',
                author: 'Alice',
                date: '2026-03-01T10:00:00Z',
                subject: 'feat(core): add feature',
                type: 'feat',
                scope: 'core',
                isBreaking: false,
                totalInsertions: 15,
                totalDeletions: 3,
                metadata: {
                    impact: 0.8,
                    trust: 0.7,
                    validation: 'none',
                    category: ['feature'],
                },
            },
            {
                hash: '222222222222',
                shortHash: '2222222',
                author: 'Bob',
                date: '2026-03-02T10:00:00Z',
                subject: 'fix(ui)!: breaking fix',
                type: 'fix',
                scope: 'ui',
                isBreaking: true,
                totalInsertions: 5,
                totalDeletions: 2,
                metadata: {
                    impact: 0.3,
                    trust: 0.9,
                    validation: 'passed',
                    category: ['bugfix'],
                },
            },
        ])

        db = new DatabaseAdapter(':memory:')
        await db.initialize()
        context = {
            db,
            config: {},
        }
    })

    afterEach(() => {
        db.close()
    })

    it('get_commit_history should return commits and support scope, techDebtAudit, and sortBy impact', async () => {
        const tools = getGitTools(context)
        const tool = tools.find((t) => t.name === 'get_commit_history')!

        const res = (await tool.handler({
            maxCount: 1,
            sortBy: 'impact',
            scope: 'core',
            techDebtAudit: true,
        })) as {
            success: boolean
            commits: { shortHash: string; scope: string }[]
        }

        expect(res.success).toBe(true)
        expect(res.commits).toHaveLength(1)
        expect(res.commits[0]?.shortHash).toBe('abcdef1')
        expect(res.commits[0]?.scope).toBe('core')
    })

    it('search_commits should search commit history by query', async () => {
        const tools = getGitTools(context)
        const tool = tools.find((t) => t.name === 'search_commits')!
        const res = (await tool.handler({
            query: 'feature',
            maxCount: 10,
        })) as {
            success: boolean
            commits: { shortHash: string }[]
        }

        expect(res.success).toBe(true)
        expect(res.commits).toHaveLength(2)
    })

    it('get_release_info should return release commits', async () => {
        const tools = getGitTools(context)
        const tool = tools.find((t) => t.name === 'get_release_info')!
        const res = (await tool.handler({
            ref: 'v1.0.0',
        })) as {
            success: boolean
            commits: { shortHash: string }[]
        }

        expect(res.success).toBe(true)
        expect(res.commits).toHaveLength(2)
    })

    it('get_unreleased_commits should return changelog since last tag', async () => {
        const tools = getGitTools(context)
        const tool = tools.find((t) => t.name === 'get_unreleased_commits')!
        const res = (await tool.handler({})) as {
            success: boolean
            changelog: { latestTag: string | null; commits: unknown[] }
        }

        expect(res.success).toBe(true)
        expect(res.changelog.commits).toHaveLength(2)
    })

    it('analyze_commit_patterns should aggregate commit types, authors, breaking changes, and categories', async () => {
        const tools = getGitTools(context)
        const tool = tools.find((t) => t.name === 'analyze_commit_patterns')!
        const res = (await tool.handler({ maxCount: 50 })) as {
            success: boolean
            analysis: {
                totalCommits: number
                byType: Record<string, number>
                byAuthor: Record<string, number>
                breakingCount: number
                totalInsertions: number
                totalDeletions: number
                totalImpact: number
                byCategory: Record<string, number>
            }
        }

        expect(res.success).toBe(true)
        expect(res.analysis.totalCommits).toBe(2)
        expect(res.analysis.byType['feat']).toBe(1)
        expect(res.analysis.byType['fix']).toBe(1)
        expect(res.analysis.byAuthor['Alice']).toBe(1)
        expect(res.analysis.breakingCount).toBe(1)
        expect(res.analysis.totalInsertions).toBe(20)
        expect(res.analysis.totalDeletions).toBe(5)
        expect(res.analysis.byCategory['feature']).toBe(1)
    })

    describe('check_entry_staleness', () => {
        it('should return error when entry does not exist', async () => {
            const tools = getGitTools(context)
            const tool = tools.find((t) => t.name === 'check_entry_staleness')!
            const res = (await tool.handler({ entryId: 99999 })) as {
                success: boolean
                error: string
            }
            expect(res.success).toBe(false)
            expect(res.error).toContain('not found')
        })

        it('should return empty results when entry has no anchors', async () => {
            const entry = db.createEntry({ content: 'Entry without file references' })
            const tools = getGitTools(context)
            const tool = tools.find((t) => t.name === 'check_entry_staleness')!
            const res = (await tool.handler({ entryId: entry.id })) as {
                success: boolean
                results: unknown[]
            }
            expect(res.success).toBe(true)
            expect(res.results).toEqual([])
        })

        it('should detect existing modified files, deleted files, and path traversal anchors', async () => {
            const entry = db.createEntry({ content: 'Entry with anchors' })

            // Insert anchors directly using insertAnchors helper on underlying native connection
            const nativeDb = (
                db as unknown as { connection: { getNativeDb: () => never } }
            ).connection.getNativeDb()
            insertAnchors({ db: nativeDb } as never, entry.id, [
                { anchorPath: 'package.json', anchorType: 'file' },
                { anchorPath: 'src/nonexistent-deleted-file.ts', anchorType: 'file' },
                { anchorPath: '../../outside-traversal.ts', anchorType: 'file' },
            ])

            const tools = getGitTools(context)
            const tool = tools.find((t) => t.name === 'check_entry_staleness')!
            const res = (await tool.handler({ entryId: entry.id })) as {
                success: boolean
                results: {
                    path: string
                    newStatus: string
                    commitsSince: number
                    isDeleted: boolean
                }[]
            }

            expect(res.success).toBe(true)
            expect(res.results).toHaveLength(3)

            const pkgAnchor = res.results.find((r) => r.path === 'package.json')
            expect(pkgAnchor?.newStatus).toBe('stale')
            expect(pkgAnchor?.commitsSince).toBe(2)

            const deletedAnchor = res.results.find(
                (r) => r.path === 'src/nonexistent-deleted-file.ts'
            )
            expect(deletedAnchor?.newStatus).toBe('invalidated')
            expect(deletedAnchor?.isDeleted).toBe(true)

            const traversalAnchor = res.results.find(
                (r) => r.path === '../../outside-traversal.ts'
            )
            expect(traversalAnchor?.newStatus).toBe('unresolvable')
        })
    })
})
