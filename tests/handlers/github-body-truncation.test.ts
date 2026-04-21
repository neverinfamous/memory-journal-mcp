/**
 * GitHub Body Truncation Tests
 *
 * Tests truncate_body and include_comments for get_github_issue
 * and truncate_body for get_github_pr.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { callTool as _callTool } from '../../src/handlers/tools/index.js'
import { DatabaseAdapter } from '../../src/database/sqlite-adapter/index.js'
import type { GitHubIntegration } from '../../src/github/github-integration/index.js'

const callTool = (
    name: any,
    params: any,
    db: any,
    vectorManager?: any,
    github?: any,
    config?: any,
    progress?: any,
    teamDb?: any,
    teamVector?: any
) =>
    _callTool(
        name,
        params,
        db,
        vectorManager,
        github,
        config ??
            ({
                runtime: {
                    maintenanceManager: {
                        withActiveJob: (fn: any) => fn(),
                        acquireMaintenanceLock: async () => {},
                        releaseMaintenanceLock: () => {},
                    },
                },
                io: { allowedRoots: [process.cwd()] },
            } as any),
        progress,
        teamDb,
        teamVector
    )

// ============================================================================
// Mock
// ============================================================================

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
        getIssue: vi.fn().mockResolvedValue({
            number: 1,
            title: 'Test Issue',
            url: 'url1',
            state: 'OPEN',
            nodeId: 'NODE_1',
            body: 'x'.repeat(2000),
            labels: ['bug'],
            assignees: ['dev1'],
            createdAt: '2025-01-01T00:00:00Z',
            updatedAt: '2025-01-02T00:00:00Z',
            closedAt: null,
            commentsCount: 3,
            milestone: null,
        }),
        getIssueComments: vi.fn().mockResolvedValue([
            { author: 'dev1', body: 'First comment', createdAt: '2025-01-01T01:00:00Z' },
            { author: 'dev2', body: 'Second comment', createdAt: '2025-01-01T02:00:00Z' },
        ]),
        getPullRequest: vi.fn().mockResolvedValue({
            number: 10,
            title: 'Feature PR',
            url: 'url10',
            state: 'OPEN',
            body: 'y'.repeat(3000),
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
        clearCache: vi.fn(),
    }
    return { ...defaults, ...overrides } as unknown as GitHubIntegration
}

// ============================================================================
// Tests
// ============================================================================

describe('GitHub Body Truncation', () => {
    let db: DatabaseAdapter
    const testDbPath = './test-body-truncation.db'

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
            // Ignore
        }
    })

    // =========================================================================
    // Issue body truncation
    // =========================================================================

    describe('get_github_issue truncate_body', () => {
        it('should truncate body to default 800 chars', async () => {
            const github = createMockGitHub()
            const result = (await callTool(
                'get_github_issue',
                { issue_number: 1 },
                db,
                undefined,
                github
            )) as { issue: { body: string; bodyTruncated: boolean; bodyFullLength: number } }

            expect(result.issue.bodyTruncated).toBe(true)
            expect(result.issue.bodyFullLength).toBe(2000)
            expect(result.issue.body.length).toBeLessThan(2000)
            expect(result.issue.body).toContain('[Truncated')
        })

        it('should return full body when truncate_body is 0', async () => {
            const github = createMockGitHub()
            const result = (await callTool(
                'get_github_issue',
                { issue_number: 1, truncate_body: 0 },
                db,
                undefined,
                github
            )) as { issue: { body: string; bodyTruncated?: boolean } }

            expect(result.issue.bodyTruncated).toBeUndefined()
            expect(result.issue.body).toHaveLength(2055)
        })

        it('should not truncate short bodies', async () => {
            const github = createMockGitHub({
                getIssue: vi.fn().mockResolvedValue({
                    number: 2,
                    title: 'Short',
                    url: 'url2',
                    state: 'OPEN',
                    nodeId: 'NODE_2',
                    body: 'Short body text',
                    labels: [],
                    assignees: [],
                    createdAt: '2025-01-01T00:00:00Z',
                    updatedAt: '2025-01-02T00:00:00Z',
                    closedAt: null,
                    commentsCount: 0,
                    milestone: null,
                }),
            })

            const result = (await callTool(
                'get_github_issue',
                { issue_number: 2 },
                db,
                undefined,
                github
            )) as { issue: { body: string; bodyTruncated?: boolean } }

            expect(result.issue.bodyTruncated).toBeUndefined()
            expect(result.issue.body).toBe(
                '<untrusted_remote_content>\nShort body text\n</untrusted_remote_content>'
            )
        })

        it('should include remaining chars count in truncation message', async () => {
            const github = createMockGitHub()
            const result = (await callTool(
                'get_github_issue',
                { issue_number: 1, truncate_body: 500 },
                db,
                undefined,
                github
            )) as { issue: { body: string; bodyFullLength: number } }

            expect(result.issue.body).toContain('1500 chars')
            expect(result.issue.bodyFullLength).toBe(2000)
        })
    })

    // =========================================================================
    // Issue comments
    // =========================================================================

    describe('get_github_issue include_comments', () => {
        it('should not include comments by default', async () => {
            const github = createMockGitHub()
            const result = (await callTool(
                'get_github_issue',
                { issue_number: 1 },
                db,
                undefined,
                github
            )) as { comments?: unknown[]; commentCount?: number }

            expect(result.comments).toBeUndefined()
            expect(result.commentCount).toBeUndefined()
        })

        it('should include comments when include_comments is true', async () => {
            const github = createMockGitHub()
            const result = (await callTool(
                'get_github_issue',
                { issue_number: 1, include_comments: true },
                db,
                undefined,
                github
            )) as {
                comments: { author: string; body: string; createdAt: string }[]
                commentCount: number
            }

            expect(result.comments).toHaveLength(2)
            expect(result.commentCount).toBe(2)
            expect(result.comments[0]!.author).toBe('dev1')
        })
    })

    // =========================================================================
    // PR body truncation
    // =========================================================================

    describe('get_github_pr truncate_body', () => {
        it('should truncate PR body to default 800 chars', async () => {
            const github = createMockGitHub()
            const result = (await callTool(
                'get_github_pr',
                { pr_number: 10 },
                db,
                undefined,
                github
            )) as { pullRequest: { body: string; bodyTruncated: boolean; bodyFullLength: number } }

            expect(result.pullRequest.bodyTruncated).toBe(true)
            expect(result.pullRequest.bodyFullLength).toBe(3000)
            expect(result.pullRequest.body).toContain('[Truncated')
        })

        it('should return full PR body when truncate_body is 0', async () => {
            const github = createMockGitHub()
            const result = (await callTool(
                'get_github_pr',
                { pr_number: 10, truncate_body: 0 },
                db,
                undefined,
                github
            )) as { pullRequest: { body: string; bodyTruncated?: boolean } }

            expect(result.pullRequest.bodyTruncated).toBeUndefined()
            expect(result.pullRequest.body).toHaveLength(3055)
        })
    })
})
