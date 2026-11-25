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

    it('get_commit_history passes %(trailers) and %(trailers:separator=%x1C) so multi-trailer commits parse cleanly', async () => {
        const tools = getGitTools(context)
        const tool = tools.find((t) => t.name === 'get_commit_history')!
        const res = (await tool.handler({ maxCount: 5 })) as { success: boolean }

        expect(res.success).toBe(true)
        expect(mockStreamGitRecords).toHaveBeenCalledWith(
            expect.arrayContaining([
                expect.stringContaining('%(trailers)'),
                expect.stringContaining('%(trailers:separator=%x1C)'),
            ]),
            expect.any(String)
        )
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
            changelog: { latestTag: string | null; commits: unknown[]; truncated: boolean }
        }

        expect(res.success).toBe(true)
        expect(res.changelog.commits).toHaveLength(2)
        expect(res.changelog.truncated).toBe(false)
    })

    it('get_unreleased_commits should flag truncation when the commit cap is reached', async () => {
        mockProcessBatch.mockResolvedValue(
            Array.from({ length: 5000 }, (_, i) => ({
                hash: String(i).padStart(12, '0'),
                shortHash: String(i).padStart(7, '0'),
                author: 'Alice',
                date: '2026-03-01T10:00:00Z',
                subject: `chore: commit ${String(i)}`,
                type: 'chore',
                isBreaking: false,
                totalInsertions: 0,
                totalDeletions: 0,
            }))
        )
        const tools = getGitTools(context)
        const tool = tools.find((t) => t.name === 'get_unreleased_commits')!
        const res = (await tool.handler({})) as {
            success: boolean
            changelog: { commits: unknown[]; truncated: boolean }
        }

        expect(res.success).toBe(true)
        expect(res.changelog.truncated).toBe(true)
        expect(res.changelog.commits).toHaveLength(100)
    })

    it('get_unreleased_commits should honor explicit limit and summary options', async () => {
        const tools = getGitTools(context)
        const tool = tools.find((t) => t.name === 'get_unreleased_commits')
        if (tool === undefined) throw new Error('get_unreleased_commits missing')
        const res = (await tool.handler({ limit: 25, summary: true })) as {
            success: boolean
            changelog: { commits: unknown[]; truncated: boolean }
        }

        expect(res.success).toBe(true)
        expect(res.changelog.commits).toHaveLength(2)
        expect(res.changelog.truncated).toBe(false)
        expect(mockBuildGitBaseArgs).toHaveBeenCalledWith(
            expect.objectContaining({ limit: 26, summary: true }),
            expect.any(String)
        )
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
            context.config = {
                defaultWorkspaceId: 'default',
                projectRegistry: {
                    default: { path: process.cwd() },
                },
            }
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
            context.config = {
                defaultWorkspaceId: 'default',
                projectRegistry: {
                    default: { path: process.cwd() },
                },
            }
            const tools = getGitTools(context)
            const tool = tools.find((t) => t.name === 'check_entry_staleness')!
            const res = (await tool.handler({ entryId: entry.id })) as {
                success: boolean
                results: unknown[]
            }
            expect(res.success).toBe(true)
            expect(res.results).toEqual([])
        })

        it('should locate an entry only in its own workspace', async () => {
            const entry = db.createEntry({ content: 'Non-default workspace entry', workspaceId: 'custom-ws' })
            context.config = {
                defaultWorkspaceId: 'default',
                projectRegistry: {
                    default: { path: process.cwd() },
                    'custom-ws': { path: process.cwd() },
                },
            }
            const tools = getGitTools(context)
            const tool = tools.find((t) => t.name === 'check_entry_staleness')!
            const res = (await tool.handler({ entry_id: entry.id, workspace_id: 'custom-ws' })) as {
                success: boolean
                results: unknown[]
            }
            expect(res.success).toBe(true)
            expect(res.results).toEqual([])

            const resOmitted = (await tool.handler({ entry_id: entry.id })) as {
                success: boolean
                error?: string
            }
            expect(resOmitted.success).toBe(false)
            expect(resOmitted.error).toContain('not found')
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

            context.config = {
                defaultWorkspaceId: 'default',
                projectRegistry: {
                    default: { path: process.cwd() },
                },
            }
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

        it('does not persist unresolvable when git fails', async () => {
            mockStreamGitRecords.mockImplementation(() => {
                throw new Error('git failed')
            })
            const update = vi.spyOn(db, 'updateAnchorStatus')
            const entry = db.createEntry({ content: 'Entry whose git lookup fails' })
            const nativeDb = (
                db as unknown as { connection: { getNativeDb: () => never } }
            ).connection.getNativeDb()
            insertAnchors({ db: nativeDb } as never, entry.id, [
                { anchorPath: 'package.json', anchorType: 'file' },
            ])

            context.config = {
                defaultWorkspaceId: 'default',
                projectRegistry: {
                    default: { path: process.cwd() },
                },
            }
            const tools = getGitTools(context)
            const tool = tools.find((t) => t.name === 'check_entry_staleness')
            if (tool === undefined) throw new Error('check_entry_staleness missing')
            const res = (await tool.handler({ entryId: entry.id })) as {
                success: boolean
                error?: string
                results: { path: string; newStatus: string; error?: string }[]
            }

            expect(res.success).toBe(false)
            expect(res.results[0]?.newStatus).toBe('pending')
            expect(res.results[0]?.error).toContain('git failed')
            expect(update).not.toHaveBeenCalled()
        })

        it('refuses a staleness check when the workspace has no registered path', async () => {
            context.config = { projectRegistry: {} }
            const tools = getGitTools(context)
            const tool = tools.find((t) => t.name === 'check_entry_staleness')
            if (tool === undefined) throw new Error('check_entry_staleness missing')
            const res = (await tool.handler({})) as { success: boolean; error?: string }
            expect(res.success).toBe(false)
            expect(res.error).toContain('No registered repository path')
        })

        it('records workspaces skipped by a star scan when they have no repository path', async () => {
            context.config = {
                projectRegistry: {
                    alpha: { path: '' },
                    beta: { path: '' },
                },
            }
            const tools = getGitTools(context)
            const tool = tools.find((t) => t.name === 'check_entry_staleness')
            if (tool === undefined) throw new Error('check_entry_staleness missing')
            const res = (await tool.handler({ workspace_id: '*' })) as {
                success: boolean
                error?: string
                skippedWorkspaces?: string[]
            }
            expect(res.success).toBe(false)
            expect(res.error).toContain('No anchor check ran')
            expect(res.skippedWorkspaces).toEqual(['alpha', 'beta'])
        })

        it('uses lightweight --name-status -z prefetch without processBatch when prefetching >= 4 live anchors', async () => {
            const futureDate = new Date(Date.now() + 60_000).toISOString()
            mockStreamGitRecords.mockImplementationOnce(() =>
                fakeAsyncRecords([`${futureDate}\n\0M\0package.json\0`])
            )

            const entry = db.createEntry({ content: 'Entry with four live file anchors' })
            const nativeDb = (
                db as unknown as { connection: { getNativeDb: () => never } }
            ).connection.getNativeDb()
            insertAnchors({ db: nativeDb } as never, entry.id, [
                { anchorPath: 'package.json', anchorType: 'file' },
                { anchorPath: 'README.md', anchorType: 'file' },
                { anchorPath: 'AGENT_README.md', anchorType: 'file' },
                { anchorPath: 'tsconfig.json', anchorType: 'file' },
            ])

            context.config = {
                defaultWorkspaceId: 'default',
                projectRegistry: {
                    default: { path: process.cwd() },
                },
            }
            const tools = getGitTools(context)
            const tool = tools.find((t) => t.name === 'check_entry_staleness')
            if (tool === undefined) throw new Error('check_entry_staleness missing')
            const res = (await tool.handler({ entryId: entry.id })) as {
                success: boolean
                results: { path: string; newStatus: string; commitsSince: number }[]
            }

            expect(res.success).toBe(true)
            expect(mockStreamGitRecords).toHaveBeenCalledWith(
                expect.arrayContaining(['--name-status', '-z', '--no-merges']),
                expect.any(String)
            )
            expect(mockProcessBatch).not.toHaveBeenCalled()
            const pkgRow = res.results.find((r) => r.path === 'package.json')
            expect(pkgRow?.newStatus).toBe('stale')
            expect(pkgRow?.commitsSince).toBe(1)
        })
    })
})
