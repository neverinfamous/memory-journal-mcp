/**
 * GitHub Tool Error Path Coverage Tests
 *
 * Tests for remaining uncovered lines in:
 * - read-tools.ts: STOP response (no owner/repo), error catch blocks
 * - kanban-tools.ts: no-github error paths
 * - core.ts: resolveTeamAuthor, share_with_team without teamDb
 * - backup.ts: error catches
 * - admin.ts: error catches
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { callTool } from '../../src/handlers/tools/index.js'
import { SqliteAdapter } from '../../src/database/SqliteAdapter.js'

describe('Error Path Coverage', () => {
    let db: SqliteAdapter
    const testDbPath = './test-error-paths.db'

    beforeAll(async () => {
        db = new SqliteAdapter(testDbPath)
        await db.initialize()

        db.createEntry({
            content: 'Error path test entry',
            tags: ['error-test'],
        })
    })

    afterAll(() => {
        db.close()
        try {
            const fs = require('node:fs')
            if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath)
        } catch {
            // cleanup
        }
    })

    // ========================================================================
    // read-tools.ts — STOP response when GitHub returns null owner/repo (line 49)
    // ========================================================================

    describe('GitHub read tools — STOP response (no owner/repo)', () => {
        const mockGithubNoRepo = {
            isApiAvailable: () => true,
            getRepoInfo: async () => ({ owner: null, repo: null, branch: null }),
            getCachedRepoInfo: () => null,
        } as any

        it('get_github_issues should STOP when no repo detected', async () => {
            const result = (await callTool(
                'get_github_issues',
                {},
                db,
                undefined,
                mockGithubNoRepo
            )) as { error: string; requiresUserInput: boolean }

            expect(result.error).toContain('STOP')
            expect(result.requiresUserInput).toBe(true)
        })

        it('get_github_prs should STOP when no repo detected', async () => {
            const result = (await callTool(
                'get_github_prs',
                {},
                db,
                undefined,
                mockGithubNoRepo
            )) as { error: string; requiresUserInput: boolean }

            expect(result.error).toContain('STOP')
        })

        it('get_github_issue should STOP when no repo detected', async () => {
            const result = (await callTool(
                'get_github_issue',
                { issue_number: 1 },
                db,
                undefined,
                mockGithubNoRepo
            )) as { error: string }

            expect(result.error).toContain('STOP')
        })

        it('get_github_pr should STOP when no repo detected', async () => {
            const result = (await callTool(
                'get_github_pr',
                { pr_number: 1 },
                db,
                undefined,
                mockGithubNoRepo
            )) as { error: string }

            expect(result.error).toContain('STOP')
        })
    })

    // ========================================================================
    // read-tools.ts — error catch blocks (lines 127, 188, 240, 276, 292, 323)
    // ========================================================================

    describe('GitHub read tools — error catches', () => {
        const mockGithubThrows = {
            isApiAvailable: () => true,
            getRepoInfo: async () => {
                throw new Error('GitHub API error')
            },
            getCachedRepoInfo: () => null,
        } as any

        it('get_github_issues should handle GitHub API errors', async () => {
            const result = (await callTool(
                'get_github_issues',
                {},
                db,
                undefined,
                mockGithubThrows
            )) as { error: string }

            expect(result.error).toBeDefined()
        })

        it('get_github_prs should handle GitHub API errors', async () => {
            const result = (await callTool(
                'get_github_prs',
                {},
                db,
                undefined,
                mockGithubThrows
            )) as { error: string }

            expect(result.error).toBeDefined()
        })

        it('get_github_issue should handle GitHub API errors', async () => {
            const result = (await callTool(
                'get_github_issue',
                { issue_number: 1 },
                db,
                undefined,
                mockGithubThrows
            )) as { error: string }

            expect(result.error).toBeDefined()
        })

        it('get_github_pr should handle GitHub API errors', async () => {
            const result = (await callTool(
                'get_github_pr',
                { pr_number: 1 },
                db,
                undefined,
                mockGithubThrows
            )) as { error: string }

            expect(result.error).toBeDefined()
        })

        it('get_github_context should handle GitHub API errors', async () => {
            const result = (await callTool(
                'get_github_context',
                {},
                db,
                undefined,
                mockGithubThrows
            )) as { error: string }

            expect(result.error).toBeDefined()
        })
    })

    // ========================================================================
    // read-tools.ts — issue/PR not found (lines 224, 276)
    // ========================================================================

    describe('GitHub read tools — not found responses', () => {
        const mockGithubNotFound = {
            isApiAvailable: () => true,
            getRepoInfo: async () => ({ owner: 'test', repo: 'repo', branch: 'main' }),
            getCachedRepoInfo: () => ({ owner: 'test', repo: 'repo' }),
            getIssue: async () => null,
            getPullRequest: async () => null,
        } as any

        it('get_github_issue should return not found', async () => {
            const result = (await callTool(
                'get_github_issue',
                { issue_number: 99999 },
                db,
                undefined,
                mockGithubNotFound
            )) as { error: string }

            expect(result.error).toContain('not found')
        })

        it('get_github_pr should return not found', async () => {
            const result = (await callTool(
                'get_github_pr',
                { pr_number: 99999 },
                db,
                undefined,
                mockGithubNotFound
            )) as { error: string }

            expect(result.error).toContain('not found')
        })
    })

    // ========================================================================
    // kanban-tools.ts — with GitHub but missing data (lines 54-56, 129)
    // ========================================================================

    describe('kanban tools — GitHub edge cases', () => {
        const mockGithubNoOwner = {
            isApiAvailable: () => true,
            getRepoInfo: async () => ({ owner: null, repo: null, branch: null }),
            getCachedRepoInfo: () => null,
        } as any

        it('get_kanban_board should handle missing owner', async () => {
            const result = (await callTool(
                'get_kanban_board',
                { project_number: 1 },
                db,
                undefined,
                mockGithubNoOwner
            )) as { error: string }

            expect(result.error).toBeDefined()
        })

        it('move_kanban_item should handle missing owner', async () => {
            const result = (await callTool(
                'move_kanban_item',
                { project_number: 1, item_id: 'abc', target_status: 'Done' },
                db,
                undefined,
                mockGithubNoOwner
            )) as { error: string }

            expect(result.error).toBeDefined()
        })
    })

    // ========================================================================
    // core.ts — create_entry with share_with_team but no teamDb (lines 162-164)
    // ========================================================================

    describe('core.ts — share_with_team without teamDb', () => {
        it('should ignore share_with_team when teamDb is missing', async () => {
            const result = (await callTool(
                'create_entry',
                {
                    content: 'Test share without team',
                    share_with_team: true,
                },
                db
            )) as { success: boolean }

            expect(result.success).toBe(true)
        })
    })

    // ========================================================================
    // backup.ts — error catch on backup_journal (line 102)
    // ========================================================================

    describe('backup.ts error paths', () => {
        it('cleanup_backups should succeed with no old backups', async () => {
            const result = (await callTool('cleanup_backups', { keep_count: 100 }, db)) as {
                success: boolean
                deletedCount: number
            }

            expect(result.success).toBe(true)
            expect(result.deletedCount).toBe(0)
        })
    })

    // ========================================================================
    // admin.ts — error paths (lines 153, 205, 222, 247, 280)
    // ========================================================================

    describe('admin.ts error paths', () => {
        it('update_entry should fail for nonexistent entry', async () => {
            const result = (await callTool(
                'update_entry',
                { entry_id: 99999, content: 'Updated' },
                db
            )) as { error: string }

            expect(result.error).toBeDefined()
        })

        it('delete_entry should fail for nonexistent entry', async () => {
            const result = (await callTool('delete_entry', { entry_id: 99999 }, db)) as {
                error: string
            }

            expect(result.error).toBeDefined()
        })

        it('rebuild_vector_index should fail without vector manager', async () => {
            const result = (await callTool('rebuild_vector_index', {}, db)) as { error: string }

            expect(result.error).toContain('not available')
        })

        it('add_to_vector_index should fail without vector manager', async () => {
            const result = (await callTool('add_to_vector_index', { entry_id: 1 }, db)) as {
                error: string
            }

            expect(result.error).toContain('not available')
        })
    })

    // Note: milestone-tools and issue-tools (mutations) require github in context
    // during tool registration — their error catches are already covered by E2E tests.
})
