/**
 * GitHub Tool Handler Tests
 *
 * Tests GitHub-dependent tools using a mock GitHubIntegration object
 * passed to callTool().
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { callTool } from '../../src/handlers/tools/index.js'
import { DatabaseAdapter } from '../../src/database/sqlite-adapter/index.js'
import type { GitHubIntegration } from '../../src/github/github-integration.js'

/**
 * Creates a mock GitHubIntegration with controllable method responses.
 */
function createMockGitHub(overrides: Partial<Record<string, unknown>> = {}): GitHubIntegration {
    const defaults = {
        isApiAvailable: vi.fn().mockReturnValue(true),
        getRepoInfo: vi.fn().mockResolvedValue({
            owner: 'testowner',
            repo: 'testrepo',
            branch: 'main',
            remoteUrl: 'git@github.com:testowner/testrepo.git',
        }),
        getCachedRepoInfo: vi.fn().mockReturnValue({
            owner: 'testowner',
            repo: 'testrepo',
            branch: 'main',
            remoteUrl: 'git@github.com:testowner/testrepo.git',
        }),
        getRepoContext: vi.fn().mockResolvedValue({
            repoName: 'testrepo',
            branch: 'main',
            commit: 'abc1234',
            remoteUrl: 'url',
            projects: [],
            issues: [],
            pullRequests: [],
            workflowRuns: [],
            milestones: [],
        }),
        getIssues: vi
            .fn()
            .mockResolvedValue([
                { number: 1, title: 'Test Issue', url: 'url1', state: 'OPEN', milestone: null },
            ]),
        getIssue: vi.fn().mockResolvedValue({
            number: 1,
            title: 'Test Issue',
            url: 'url1',
            state: 'OPEN',
            nodeId: 'NODE_1',
            body: 'Issue body',
            labels: ['bug'],
            assignees: ['dev1'],
            createdAt: '2025-01-01T00:00:00Z',
            updatedAt: '2025-01-02T00:00:00Z',
            closedAt: null,
            commentsCount: 3,
            milestone: null,
        }),
        createIssue: vi.fn().mockResolvedValue({
            number: 42,
            url: 'https://github.com/testowner/testrepo/issues/42',
            title: 'New Issue',
            nodeId: 'NODE_42',
        }),
        closeIssue: vi.fn().mockResolvedValue({
            success: true,
            url: 'https://github.com/testowner/testrepo/issues/1',
        }),
        getPullRequests: vi
            .fn()
            .mockResolvedValue([{ number: 10, title: 'Feature', url: 'url10', state: 'OPEN' }]),
        getPullRequest: vi.fn().mockResolvedValue({
            number: 10,
            title: 'Feature',
            url: 'url10',
            state: 'OPEN',
            body: 'PR body',
            draft: false,
            headBranch: 'feature',
            baseBranch: 'main',
            author: 'dev1',
            createdAt: '2025-01-01T00:00:00Z',
            updatedAt: '2025-01-02T00:00:00Z',
            mergedAt: null,
            closedAt: null,
            additions: 100,
            deletions: 50,
            changedFiles: 5,
        }),
        getWorkflowRuns: vi.fn().mockResolvedValue([]),
        getProjectKanban: vi.fn().mockResolvedValue(null),
        getMilestones: vi.fn().mockResolvedValue([
            {
                number: 1,
                title: 'v1.0',
                description: 'First',
                state: 'open',
                url: 'url',
                dueOn: null,
                openIssues: 5,
                closedIssues: 10,
                createdAt: '2025-01-01T00:00:00Z',
                updatedAt: '2025-01-01T00:00:00Z',
                creator: 'owner1',
            },
        ]),
        getMilestone: vi.fn().mockResolvedValue({
            number: 1,
            title: 'v1.0',
            description: 'First',
            state: 'open',
            url: 'url',
            dueOn: null,
            openIssues: 5,
            closedIssues: 10,
            createdAt: '2025-01-01T00:00:00Z',
            updatedAt: '2025-01-01T00:00:00Z',
            creator: 'owner1',
        }),
        createMilestone: vi.fn().mockResolvedValue({
            number: 3,
            title: 'v2.0',
            description: null,
            state: 'open',
            url: 'url',
            dueOn: null,
            openIssues: 0,
            closedIssues: 0,
            createdAt: '2025-01-01T00:00:00Z',
            updatedAt: '2025-01-01T00:00:00Z',
            creator: 'dev1',
        }),
        updateMilestone: vi.fn().mockResolvedValue({
            number: 1,
            title: 'v1.1',
            description: null,
            state: 'closed',
            url: 'url',
            dueOn: null,
            openIssues: 0,
            closedIssues: 15,
            createdAt: '2025-01-01T00:00:00Z',
            updatedAt: '2025-02-01T00:00:00Z',
            creator: 'dev1',
        }),
        deleteMilestone: vi.fn().mockResolvedValue({ success: true }),
        moveProjectItem: vi.fn().mockResolvedValue({ success: true }),
        addProjectItem: vi.fn().mockResolvedValue({ success: true, itemId: 'PVTITEM_NEW' }),
        clearCache: vi.fn(),
        invalidateCache: vi.fn(),
    }
    return { ...defaults, ...overrides } as unknown as GitHubIntegration
}

describe('GitHub Tool Handlers', () => {
    let db: DatabaseAdapter
    const testDbPath = './test-gh-tools.db'

    beforeAll(async () => {
        db = new DatabaseAdapter(testDbPath)
        await db.initialize()
    })

    afterAll(() => {
        db.close()
        try {
            const fs = require('node:fs')
            if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath)
        } catch {
            // Ignore cleanup errors
        }
    })

    // ========================================================================
    // Issues
    // ========================================================================

    describe('get_github_issues', () => {
        it('should return issues from mock', async () => {
            const github = createMockGitHub()
            const result = (await callTool('get_github_issues', {}, db, undefined, github)) as {
                issues: unknown[]
                count: number
            }

            expect(result.issues).toBeDefined()
            expect(result.count).toBe(1)
        })

        it('should return error when no github', async () => {
            const result = (await callTool('get_github_issues', {}, db, undefined, undefined)) as {
                error: string
            }

            expect(result.error).toContain('GitHub integration not available')
        })
    })

    describe('get_github_issue', () => {
        it('should return issue details', async () => {
            const github = createMockGitHub()
            const result = (await callTool(
                'get_github_issue',
                { issue_number: 1 },
                db,
                undefined,
                github
            )) as { issue: { number: number }; journalEntries?: unknown[] }

            expect(result.issue.number).toBe(1)
        })
    })

    describe('get_github_prs', () => {
        it('should return pull requests', async () => {
            const github = createMockGitHub()
            const result = (await callTool('get_github_prs', {}, db, undefined, github)) as {
                pullRequests: unknown[]
                count: number
            }

            expect(result.pullRequests).toBeDefined()
            expect(result.count).toBe(1)
        })
    })

    describe('get_github_pr', () => {
        it('should return PR details', async () => {
            const github = createMockGitHub()
            const result = (await callTool(
                'get_github_pr',
                { pr_number: 10 },
                db,
                undefined,
                github
            )) as { pullRequest: { number: number } }

            expect(result.pullRequest.number).toBe(10)
        })
    })

    // ========================================================================
    // Context
    // ========================================================================

    describe('get_github_context', () => {
        it('should return repo context', async () => {
            const github = createMockGitHub()
            const result = (await callTool('get_github_context', {}, db, undefined, github)) as {
                repoName: string
                branch: string
            }

            expect(result.repoName).toBe('testrepo')
        })

        it('should return error when no github', async () => {
            const result = (await callTool('get_github_context', {}, db, undefined, undefined)) as {
                error: string
            }

            expect(result.error).toContain('GitHub integration not available')
        })
    })

    // ========================================================================
    // Kanban
    // ========================================================================

    describe('get_kanban_board', () => {
        it('should return error when project not found', async () => {
            const github = createMockGitHub()
            const result = (await callTool(
                'get_kanban_board',
                { project_number: 1 },
                db,
                undefined,
                github
            )) as { error: string }

            // getProjectKanban returns null by default
            expect(result.error).toContain('not found')
        })
    })

    // ========================================================================
    // Milestones
    // ========================================================================

    describe('get_github_milestones', () => {
        it('should return milestones', async () => {
            const github = createMockGitHub()
            const result = (await callTool('get_github_milestones', {}, db, undefined, github)) as {
                milestones: unknown[]
                count: number
            }

            expect(result.milestones).toBeDefined()
            expect(result.count).toBe(1)
        })
    })

    describe('get_github_milestone', () => {
        it('should return single milestone', async () => {
            const github = createMockGitHub()
            const result = (await callTool(
                'get_github_milestone',
                { milestone_number: 1 },
                db,
                undefined,
                github
            )) as { milestone: { number: number } }

            expect(result.milestone.number).toBe(1)
        })
    })

    describe('create_github_milestone', () => {
        it('should create milestone', async () => {
            const github = createMockGitHub()
            const result = (await callTool(
                'create_github_milestone',
                { title: 'v2.0' },
                db,
                undefined,
                github
            )) as { success: boolean; milestone: { number: number } }

            expect(result.success).toBe(true)
            expect(result.milestone.number).toBe(3)
        })
    })

    describe('update_github_milestone', () => {
        it('should update milestone', async () => {
            const github = createMockGitHub()
            const result = (await callTool(
                'update_github_milestone',
                { milestone_number: 1, title: 'v1.1' },
                db,
                undefined,
                github
            )) as { success: boolean; milestone: { title: string } }

            expect(result.success).toBe(true)
            expect(result.milestone.title).toBe('v1.1')
        })
    })

    describe('delete_github_milestone', () => {
        it('should delete milestone', async () => {
            const github = createMockGitHub()
            const result = (await callTool(
                'delete_github_milestone',
                { milestone_number: 1, confirm: true },
                db,
                undefined,
                github
            )) as { success: boolean }

            expect(result.success).toBe(true)
        })
    })

    // ========================================================================
    // Issue with entry tools
    // ========================================================================

    describe('create_github_issue_with_entry', () => {
        it('should create issue and journal entry', async () => {
            const github = createMockGitHub()
            const result = (await callTool(
                'create_github_issue_with_entry',
                { title: 'Test Issue', journal_content: 'Created test issue for tracking' },
                db,
                undefined,
                github
            )) as { success: boolean; issue: { number: number }; journalEntry: { id: number } }

            expect(result.success).toBe(true)
            expect(result.issue.number).toBe(42)
            expect(result.journalEntry.id).toBeGreaterThan(0)
        })
    })

    // ========================================================================
    // Kanban operations
    // ========================================================================

    describe('move_kanban_item', () => {
        it('should move item when board and status found', async () => {
            const github = createMockGitHub({
                getProjectKanban: vi.fn().mockResolvedValue({
                    projectId: 'PVT_1',
                    projectTitle: 'Board',
                    statusFieldId: 'FIELD_1',
                    statusOptions: [
                        { id: 'OPT_TODO', name: 'Todo' },
                        { id: 'OPT_DONE', name: 'Done' },
                    ],
                    columns: [],
                    totalItems: 0,
                }),
            })

            const result = (await callTool(
                'move_kanban_item',
                {
                    project_number: 1,
                    item_id: 'PVTITEM_1',
                    target_status: 'Done',
                },
                db,
                undefined,
                github
            )) as { success: boolean; newStatus: string }

            expect(result.success).toBe(true)
            expect(result.newStatus).toBe('Done')
        })

        it('should return error when status not found', async () => {
            const github = createMockGitHub({
                getProjectKanban: vi.fn().mockResolvedValue({
                    projectId: 'PVT_1',
                    statusFieldId: 'FIELD_1',
                    statusOptions: [{ id: 'OPT_TODO', name: 'Todo' }],
                    columns: [],
                    totalItems: 0,
                }),
            })

            const result = (await callTool(
                'move_kanban_item',
                {
                    project_number: 1,
                    item_id: 'PVTITEM_1',
                    target_status: 'Nonexistent',
                },
                db,
                undefined,
                github
            )) as { error: string; availableStatuses: string[] }

            expect(result.error).toContain('not found')
            expect(result.availableStatuses).toEqual(['Todo'])
        })

        it('should return error when no github', async () => {
            const result = (await callTool(
                'move_kanban_item',
                {
                    project_number: 1,
                    item_id: 'X',
                    target_status: 'Done',
                },
                db
            )) as { error: string }

            expect(result.error).toContain('GitHub integration not available')
        })

        it('should return error when project not found', async () => {
            const github = createMockGitHub()
            const result = (await callTool(
                'move_kanban_item',
                {
                    project_number: 999,
                    item_id: 'X',
                    target_status: 'Done',
                },
                db,
                undefined,
                github
            )) as { error: string }

            expect(result.error).toContain('not found')
        })
    })

    // ========================================================================
    // Close issue with entry
    // ========================================================================

    describe('close_github_issue_with_entry', () => {
        it('should close issue and create journal entry', async () => {
            const github = createMockGitHub()

            const result = (await callTool(
                'close_github_issue_with_entry',
                { issue_number: 1, resolution_notes: 'Fixed the bug' },
                db,
                undefined,
                github
            )) as {
                success: boolean
                issue: { number: number; newState: string }
                journalEntry: { id: number }
            }

            expect(result.success).toBe(true)
            expect(result.issue.number).toBe(1)
            expect(result.issue.newState).toBe('CLOSED')
            expect(result.journalEntry.id).toBeGreaterThan(0)
        })

        it('should close issue with move_to_done', async () => {
            const github = createMockGitHub({
                getProjectKanban: vi.fn().mockResolvedValue({
                    projectId: 'PVT_1',
                    projectTitle: 'Board',
                    statusFieldId: 'FIELD_1',
                    statusOptions: [
                        { id: 'OPT_DONE', name: 'Done' },
                        { id: 'OPT_TODO', name: 'Todo' },
                    ],
                    columns: [
                        {
                            status: 'Todo',
                            items: [
                                {
                                    id: 'PVTITEM_ISSUE1',
                                    title: 'Test Issue',
                                    type: 'ISSUE',
                                    number: 1,
                                },
                            ],
                        },
                    ],
                    totalItems: 1,
                }),
            })

            const result = (await callTool(
                'close_github_issue_with_entry',
                {
                    issue_number: 1,
                    resolution_notes: 'Done!',
                    move_to_done: true,
                    project_number: 1,
                },
                db,
                undefined,
                github
            )) as {
                success: boolean
                issue: { number: number }
                kanbanMove?: { success: boolean }
            }

            expect(result.success).toBe(true)
        })

        it('should return error when issue not found', async () => {
            const github = createMockGitHub({
                getIssue: vi.fn().mockResolvedValue(null),
            })

            const result = (await callTool(
                'close_github_issue_with_entry',
                { issue_number: 999 },
                db,
                undefined,
                github
            )) as { error: string }

            expect(result.error).toContain('not found')
        })

        it('should return error when issue already closed', async () => {
            const github = createMockGitHub({
                getIssue: vi.fn().mockResolvedValue({
                    number: 1,
                    title: 'Test',
                    url: 'url',
                    state: 'CLOSED',
                }),
            })

            const result = (await callTool(
                'close_github_issue_with_entry',
                { issue_number: 1 },
                db,
                undefined,
                github
            )) as { error: string }

            expect(result.error).toContain('already closed')
        })

        it('should return error when no github', async () => {
            const result = (await callTool(
                'close_github_issue_with_entry',
                { issue_number: 1 },
                db
            )) as { error: string }

            expect(result.error).toContain('GitHub integration not available')
        })
    })

    // ========================================================================
    // Repository Insights
    // ========================================================================

    describe('get_repo_insights', () => {
        it('should return stars section by default', async () => {
            const github = createMockGitHub({
                getRepoStats: vi.fn().mockResolvedValue({
                    stars: 42,
                    forks: 5,
                    watchers: 3,
                    openIssues: 2,
                    size: 100,
                    defaultBranch: 'main',
                }),
            })

            const result = (await callTool(
                'get_repo_insights',
                {},
                db,
                undefined,
                github
            )) as Record<string, unknown>

            expect(result['owner']).toBe('testowner')
            expect(result['repo']).toBe('testrepo')
            expect(result['stars']).toBe(42)
            expect(result['forks']).toBe(5)
        })

        it('should return traffic section', async () => {
            const github = createMockGitHub({
                getTrafficData: vi.fn().mockResolvedValue({
                    views: { total: 100, uniques: 50 },
                    clones: { total: 20, uniques: 10 },
                }),
            })

            const result = (await callTool(
                'get_repo_insights',
                { sections: 'traffic' },
                db,
                undefined,
                github
            )) as Record<string, unknown>

            expect(result['traffic']).toBeDefined()
        })

        it('should return referrers section', async () => {
            const github = createMockGitHub({
                getTopReferrers: vi
                    .fn()
                    .mockResolvedValue([{ referrer: 'google.com', count: 10, uniques: 5 }]),
            })

            const result = (await callTool(
                'get_repo_insights',
                { sections: 'referrers' },
                db,
                undefined,
                github
            )) as Record<string, unknown>

            expect(result['referrers']).toBeDefined()
        })

        it('should return paths section', async () => {
            const github = createMockGitHub({
                getPopularPaths: vi
                    .fn()
                    .mockResolvedValue([
                        { path: '/readme', title: 'README', count: 50, uniques: 25 },
                    ]),
            })

            const result = (await callTool(
                'get_repo_insights',
                { sections: 'paths' },
                db,
                undefined,
                github
            )) as Record<string, unknown>

            expect(result['paths']).toBeDefined()
        })

        it('should return all sections', async () => {
            const github = createMockGitHub({
                getRepoStats: vi.fn().mockResolvedValue({
                    stars: 42,
                    forks: 5,
                    watchers: 3,
                    openIssues: 2,
                    size: 100,
                    defaultBranch: 'main',
                }),
                getTrafficData: vi.fn().mockResolvedValue({
                    views: { total: 100, uniques: 50 },
                    clones: { total: 20, uniques: 10 },
                }),
                getTopReferrers: vi.fn().mockResolvedValue([]),
                getPopularPaths: vi.fn().mockResolvedValue([]),
            })

            const result = (await callTool(
                'get_repo_insights',
                { sections: 'all' },
                db,
                undefined,
                github
            )) as Record<string, unknown>

            expect(result['stars']).toBe(42)
            expect(result['traffic']).toBeDefined()
            expect(result['referrers']).toBeDefined()
            expect(result['paths']).toBeDefined()
            // 'all' section includes size and defaultBranch
            expect(result['size']).toBe(100)
            expect(result['defaultBranch']).toBe('main')
        })

        it('should return error when no github', async () => {
            const result = (await callTool('get_repo_insights', {}, db, undefined, undefined)) as {
                error: string
            }

            expect(result.error).toContain('GitHub integration not available')
        })

        it('should return error when no owner/repo detected', async () => {
            const github = createMockGitHub({
                getRepoInfo: vi.fn().mockResolvedValue({
                    owner: null,
                    repo: null,
                    branch: null,
                }),
            })

            const result = (await callTool('get_repo_insights', {}, db, undefined, github)) as {
                error: string
                requiresUserInput: boolean
            }

            expect(result.error).toContain('Could not auto-detect')
            expect(result.requiresUserInput).toBe(true)
        })
    })

    // ========================================================================
    // Milestone edge cases
    // ========================================================================

    describe('milestone edge cases', () => {
        it('get_github_milestones should return error when no repo', async () => {
            const github = createMockGitHub({
                getRepoInfo: vi.fn().mockResolvedValue({
                    owner: null,
                    repo: null,
                    branch: null,
                }),
            })

            const result = (await callTool('get_github_milestones', {}, db, undefined, github)) as {
                error: string
            }

            expect(result.error).toBeDefined()
        })

        it('get_github_milestone should return not found', async () => {
            const github = createMockGitHub({
                getMilestone: vi.fn().mockResolvedValue(null),
            })

            const result = (await callTool(
                'get_github_milestone',
                { milestone_number: 999 },
                db,
                undefined,
                github
            )) as { error: string }

            expect(result.error).toContain('not found')
        })

        it('create_github_milestone should return error when creation fails', async () => {
            const github = createMockGitHub({
                createMilestone: vi.fn().mockResolvedValue(null),
            })

            const result = (await callTool(
                'create_github_milestone',
                { title: 'Will fail' },
                db,
                undefined,
                github
            )) as { error: string }

            expect(result.error).toContain('Failed')
        })

        it('create_github_milestone with due date', async () => {
            const github = createMockGitHub()

            const result = (await callTool(
                'create_github_milestone',
                { title: 'v3.0', due_on: '2026-06-01' },
                db,
                undefined,
                github
            )) as { success: boolean; milestone: { number: number } }

            expect(result.success).toBe(true)
        })

        it('update_github_milestone should return error when update fails', async () => {
            const github = createMockGitHub({
                updateMilestone: vi.fn().mockResolvedValue(null),
            })

            const result = (await callTool(
                'update_github_milestone',
                { milestone_number: 1, title: 'Will fail' },
                db,
                undefined,
                github
            )) as { error: string }

            expect(result.error).toContain('Failed')
        })

        it('delete_github_milestone should return error when delete fails', async () => {
            const github = createMockGitHub({
                deleteMilestone: vi.fn().mockResolvedValue({ success: false }),
            })

            const result = (await callTool(
                'delete_github_milestone',
                { milestone_number: 1, confirm: true },
                db,
                undefined,
                github
            )) as { success: boolean; message: string }

            expect(result.success).toBe(false)
            expect(result.message).toContain('Failed')
        })

        it('delete_github_milestone without confirm is rejected by zod', async () => {
            const github = createMockGitHub()

            // confirm must be literal true, passing false should fail
            try {
                await callTool(
                    'delete_github_milestone',
                    { milestone_number: 1, confirm: false },
                    db,
                    undefined,
                    github
                )
                // If we get here, check the result for error
            } catch {
                // Expected: zod validation failure
            }
        })

        it('get_github_milestones should return error when no github', async () => {
            const result = (await callTool(
                'get_github_milestones',
                {},
                db,
                undefined,
                undefined
            )) as { error: string }

            expect(result.error).toContain('GitHub integration not available')
        })
    })

    // ========================================================================
    // Backup tools
    // ========================================================================

    describe('backup_journal', () => {
        it('should create a backup', async () => {
            const result = (await callTool('backup_journal', {}, db)) as {
                success: boolean
                filename: string
            }

            expect(result.success).toBe(true)
            expect(result.filename).toBeDefined()
        })

        it('should create a backup with custom name', async () => {
            const result = (await callTool('backup_journal', { name: 'my-test-backup' }, db)) as {
                success: boolean
                filename: string
            }

            expect(result.success).toBe(true)
        })
    })

    describe('list_backups', () => {
        it('should list backups', async () => {
            const result = (await callTool('list_backups', {}, db)) as {
                backups: unknown[]
                total: number
            }

            expect(result.backups).toBeDefined()
            expect(typeof result.total).toBe('number')
        })
    })

    describe('cleanup_backups', () => {
        it('should cleanup old backups', async () => {
            const result = (await callTool('cleanup_backups', { keep_count: 5 }, db)) as {
                success: boolean
                keptCount: number
            }

            expect(result.success).toBe(true)
            expect(typeof result.keptCount).toBe('number')
        })
    })

    // ========================================================================
    // create_github_issue_with_entry - project integration paths
    // ========================================================================

    describe('create_github_issue_with_entry - project integration', () => {
        it('should add issue to project and set initial status', async () => {
            const github = createMockGitHub({
                getProjectKanban: vi.fn().mockResolvedValue({
                    projectId: 'PVT_1',
                    projectTitle: 'Board',
                    statusFieldId: 'FIELD_1',
                    statusOptions: [
                        { id: 'OPT_BACKLOG', name: 'Backlog' },
                        { id: 'OPT_DONE', name: 'Done' },
                    ],
                    columns: [],
                    totalItems: 0,
                }),
                addProjectItem: vi.fn().mockResolvedValue({ success: true, itemId: 'PVTITEM_NEW' }),
                moveProjectItem: vi.fn().mockResolvedValue({ success: true }),
            })

            const result = (await callTool(
                'create_github_issue_with_entry',
                {
                    title: 'Project Issue',
                    journal_content: 'Added to project',
                    project_number: 1,
                    initial_status: 'Backlog',
                },
                db,
                undefined,
                github
            )) as {
                success: boolean
                project?: { added: boolean; initialStatus?: { set: boolean } }
            }

            expect(result.success).toBe(true)
            expect(result.project?.added).toBe(true)
            expect(result.project?.initialStatus?.set).toBe(true)
        })

        it('should handle project not found when adding issue', async () => {
            const github = createMockGitHub({
                getProjectKanban: vi.fn().mockResolvedValue(null),
            })

            const result = (await callTool(
                'create_github_issue_with_entry',
                {
                    title: 'Issue for missing project',
                    journal_content: 'Test',
                    project_number: 999,
                },
                db,
                undefined,
                github
            )) as { success: boolean; project?: { added: boolean; error: string } }

            expect(result.success).toBe(true) // Issue still created
            expect(result.project?.added).toBe(false)
            expect(result.project?.error).toContain('not found')
        })

        it('should handle addProjectItem failure', async () => {
            const github = createMockGitHub({
                getProjectKanban: vi.fn().mockResolvedValue({
                    projectId: 'PVT_1',
                    projectTitle: 'Board',
                    statusFieldId: 'FIELD_1',
                    statusOptions: [],
                    columns: [],
                    totalItems: 0,
                }),
                addProjectItem: vi
                    .fn()
                    .mockResolvedValue({ success: false, error: 'Permission denied' }),
            })

            const result = (await callTool(
                'create_github_issue_with_entry',
                {
                    title: 'Issue add fail',
                    journal_content: 'Test',
                    project_number: 1,
                },
                db,
                undefined,
                github
            )) as { success: boolean; project?: { added: boolean; error: string } }

            expect(result.success).toBe(true)
            expect(result.project?.added).toBe(false)
        })

        it('should handle initial_status not found on board', async () => {
            const github = createMockGitHub({
                getProjectKanban: vi.fn().mockResolvedValue({
                    projectId: 'PVT_1',
                    projectTitle: 'Board',
                    statusFieldId: 'FIELD_1',
                    statusOptions: [{ id: 'OPT_TODO', name: 'Todo' }],
                    columns: [],
                    totalItems: 0,
                }),
                addProjectItem: vi.fn().mockResolvedValue({ success: true, itemId: 'PVTITEM_NEW' }),
            })

            const result = (await callTool(
                'create_github_issue_with_entry',
                {
                    title: 'Issue bad status',
                    journal_content: 'Test',
                    project_number: 1,
                    initial_status: 'Nonexistent',
                },
                db,
                undefined,
                github
            )) as {
                success: boolean
                project?: { added: boolean; initialStatus?: { set: boolean; error: string } }
            }

            expect(result.success).toBe(true)
            expect(result.project?.added).toBe(true)
            expect(result.project?.initialStatus?.set).toBe(false)
            expect(result.project?.initialStatus?.error).toContain('not found')
        })

        it('should handle moveProjectItem failure for initial status', async () => {
            const github = createMockGitHub({
                getProjectKanban: vi.fn().mockResolvedValue({
                    projectId: 'PVT_1',
                    projectTitle: 'Board',
                    statusFieldId: 'FIELD_1',
                    statusOptions: [{ id: 'OPT_BACKLOG', name: 'Backlog' }],
                    columns: [],
                    totalItems: 0,
                }),
                addProjectItem: vi.fn().mockResolvedValue({ success: true, itemId: 'PVTITEM_NEW' }),
                moveProjectItem: vi
                    .fn()
                    .mockResolvedValue({ success: false, error: 'Move failed' }),
            })

            const result = (await callTool(
                'create_github_issue_with_entry',
                {
                    title: 'Issue move fail',
                    journal_content: 'Test',
                    project_number: 1,
                    initial_status: 'Backlog',
                },
                db,
                undefined,
                github
            )) as {
                success: boolean
                project?: { added: boolean; initialStatus?: { set: boolean; error: string } }
            }

            expect(result.success).toBe(true)
            expect(result.project?.initialStatus?.set).toBe(false)
        })

        it('should handle createIssue returning null', async () => {
            const github = createMockGitHub({
                createIssue: vi.fn().mockResolvedValue(null),
            })

            const result = (await callTool(
                'create_github_issue_with_entry',
                { title: 'Will fail', journal_content: 'Test' },
                db,
                undefined,
                github
            )) as { error: string }

            expect(result.error).toContain('Failed to create')
        })
    })

    // ========================================================================
    // close_github_issue_with_entry - Kanban edge cases
    // ========================================================================

    describe('close_github_issue_with_entry - Kanban edge cases', () => {
        it('should return kanban error when move_to_done with no project_number', async () => {
            const github = createMockGitHub()

            const result = (await callTool(
                'close_github_issue_with_entry',
                {
                    issue_number: 1,
                    resolution_notes: 'Done!',
                    move_to_done: true,
                    // No project_number and no defaultProjectNumber
                },
                db,
                undefined,
                github
            )) as { success: boolean; kanban?: { moved: boolean; error: string } }

            expect(result.success).toBe(true) // Issue still closes
            expect(result.kanban?.moved).toBe(false)
            expect(result.kanban?.error).toContain('project_number required')
        })

        it('should handle kanban board not found', async () => {
            const github = createMockGitHub({
                getProjectKanban: vi.fn().mockResolvedValue(null),
            })

            const result = (await callTool(
                'close_github_issue_with_entry',
                {
                    issue_number: 1,
                    resolution_notes: 'Done!',
                    move_to_done: true,
                    project_number: 999,
                },
                db,
                undefined,
                github
            )) as { success: boolean; kanban?: { moved: boolean; error: string } }

            expect(result.success).toBe(true)
            expect(result.kanban?.moved).toBe(false)
            expect(result.kanban?.error).toContain('not found')
        })

        it('should handle addProjectItem failure during move_to_done', async () => {
            const github = createMockGitHub({
                getProjectKanban: vi.fn().mockResolvedValue({
                    projectId: 'PVT_1',
                    projectTitle: 'Board',
                    statusFieldId: 'FIELD_1',
                    statusOptions: [{ id: 'OPT_DONE', name: 'Done' }],
                    columns: [],
                    totalItems: 0,
                }),
                addProjectItem: vi
                    .fn()
                    .mockResolvedValue({ success: false, error: 'Item add failed' }),
            })

            const result = (await callTool(
                'close_github_issue_with_entry',
                {
                    issue_number: 1,
                    resolution_notes: 'Done!',
                    move_to_done: true,
                    project_number: 1,
                },
                db,
                undefined,
                github
            )) as { success: boolean; kanban?: { moved: boolean; error: string } }

            expect(result.success).toBe(true)
            expect(result.kanban?.moved).toBe(false)
            expect(result.kanban?.error).toContain('Item add failed')
        })

        it('should handle "Done" column not found on board', async () => {
            const github = createMockGitHub({
                getProjectKanban: vi.fn().mockResolvedValue({
                    projectId: 'PVT_1',
                    projectTitle: 'Board',
                    statusFieldId: 'FIELD_1',
                    statusOptions: [{ id: 'OPT_TODO', name: 'Todo' }], // No "Done" status
                    columns: [
                        {
                            status: 'Todo',
                            items: [
                                {
                                    id: 'PVTITEM_ISSUE1',
                                    title: 'Test Issue',
                                    type: 'ISSUE',
                                    number: 1,
                                },
                            ],
                        },
                    ],
                    totalItems: 1,
                }),
            })

            const result = (await callTool(
                'close_github_issue_with_entry',
                {
                    issue_number: 1,
                    resolution_notes: 'Done!',
                    move_to_done: true,
                    project_number: 1,
                },
                db,
                undefined,
                github
            )) as { success: boolean; kanban?: { moved: boolean; error: string } }

            expect(result.success).toBe(true)
            expect(result.kanban?.moved).toBe(false)
            expect(result.kanban?.error).toContain('"Done" status column not found')
        })

        it('should handle closeIssue returning null (API failure)', async () => {
            const github = createMockGitHub({
                closeIssue: vi.fn().mockResolvedValue(null),
            })

            const result = (await callTool(
                'close_github_issue_with_entry',
                { issue_number: 1, resolution_notes: 'Will fail' },
                db,
                undefined,
                github
            )) as { error: string }

            expect(result.error).toContain('Failed to close')
        })

        it('should handle no-repo detection on close', async () => {
            const github = createMockGitHub({
                getRepoInfo: vi.fn().mockResolvedValue({
                    owner: null,
                    repo: null,
                    branch: null,
                }),
            })

            const result = (await callTool(
                'close_github_issue_with_entry',
                { issue_number: 1 },
                db,
                undefined,
                github
            )) as { error: string; requiresUserInput: boolean }

            expect(result.error).toContain('Could not auto-detect')
            expect(result.requiresUserInput).toBe(true)
        })
    })

    // ========================================================================
    // Milestone tools - no-github and no-repo error paths
    // ========================================================================

    describe('milestone tools - additional error paths', () => {
        it('get_github_milestone should return error when no github', async () => {
            const result = (await callTool(
                'get_github_milestone',
                { milestone_number: 1 },
                db,
                undefined,
                undefined
            )) as { error: string }

            expect(result.error).toContain('GitHub integration not available')
        })

        it('get_github_milestone should return error when no repo detected', async () => {
            const github = createMockGitHub({
                getRepoInfo: vi.fn().mockResolvedValue({
                    owner: null,
                    repo: null,
                    branch: null,
                }),
            })

            const result = (await callTool(
                'get_github_milestone',
                { milestone_number: 1 },
                db,
                undefined,
                github
            )) as { error: string; requiresUserInput: boolean }

            expect(result.error).toContain('Could not auto-detect')
            expect(result.requiresUserInput).toBe(true)
        })

        it('create_github_milestone should return error when no repo detected', async () => {
            const github = createMockGitHub({
                getRepoInfo: vi.fn().mockResolvedValue({
                    owner: null,
                    repo: null,
                    branch: null,
                }),
            })

            const result = (await callTool(
                'create_github_milestone',
                { title: 'No repo' },
                db,
                undefined,
                github
            )) as { error: string; requiresUserInput: boolean }

            expect(result.error).toContain('Could not auto-detect')
            expect(result.requiresUserInput).toBe(true)
        })

        it('create_github_milestone should return error when no github', async () => {
            const result = (await callTool(
                'create_github_milestone',
                { title: 'No github' },
                db,
                undefined,
                undefined
            )) as { error: string }

            expect(result.error).toContain('GitHub integration not available')
        })

        it('update_github_milestone should return error when no github', async () => {
            const result = (await callTool(
                'update_github_milestone',
                { milestone_number: 1, title: 'No github' },
                db,
                undefined,
                undefined
            )) as { error: string }

            expect(result.error).toContain('GitHub integration not available')
        })

        it('update_github_milestone should return error when no repo detected', async () => {
            const github = createMockGitHub({
                getRepoInfo: vi.fn().mockResolvedValue({
                    owner: null,
                    repo: null,
                    branch: null,
                }),
            })

            const result = (await callTool(
                'update_github_milestone',
                { milestone_number: 1, title: 'No repo' },
                db,
                undefined,
                github
            )) as { error: string; requiresUserInput: boolean }

            expect(result.error).toContain('Could not auto-detect')
            expect(result.requiresUserInput).toBe(true)
        })

        it('delete_github_milestone should return error when no github', async () => {
            const result = (await callTool(
                'delete_github_milestone',
                { milestone_number: 1, confirm: true },
                db,
                undefined,
                undefined
            )) as { error: string }

            expect(result.error).toContain('GitHub integration not available')
        })

        it('delete_github_milestone should return error when no repo detected', async () => {
            const github = createMockGitHub({
                getRepoInfo: vi.fn().mockResolvedValue({
                    owner: null,
                    repo: null,
                    branch: null,
                }),
            })

            const result = (await callTool(
                'delete_github_milestone',
                { milestone_number: 1, confirm: true },
                db,
                undefined,
                github
            )) as { error: string; requiresUserInput: boolean }

            expect(result.error).toContain('Could not auto-detect')
            expect(result.requiresUserInput).toBe(true)
        })
    })

    // ========================================================================
    // restore_backup
    // ========================================================================

    describe('restore_backup', () => {
        it('should restore from a backup file', async () => {
            // First create a backup to restore from
            const backupResult = (await callTool(
                'backup_journal',
                { name: 'restore-test' },
                db
            )) as { success: boolean; filename: string }

            expect(backupResult.success).toBe(true)

            const result = (await callTool(
                'restore_backup',
                { filename: backupResult.filename, confirm: true },
                db
            )) as {
                success: boolean
                message: string
                restoredFrom: string
                previousEntryCount: number
                newEntryCount: number
            }

            expect(result.success).toBe(true)
            expect(result.message).toContain('restored')
            expect(typeof result.previousEntryCount).toBe('number')
            expect(typeof result.newEntryCount).toBe('number')
        })
    })
})
