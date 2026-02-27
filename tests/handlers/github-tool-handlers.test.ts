/**
 * GitHub Tool Handler Tests
 *
 * Tests GitHub-dependent tools using a mock GitHubIntegration object
 * passed to callTool().
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { callTool } from '../../src/handlers/tools/index.js'
import { SqliteAdapter } from '../../src/database/SqliteAdapter.js'
import type { GitHubIntegration } from '../../src/github/GitHubIntegration.js'

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
    let db: SqliteAdapter
    const testDbPath = './test-gh-tools.db'

    beforeAll(async () => {
        db = new SqliteAdapter(testDbPath)
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
})
