/**
 * memory-journal-mcp — GitHub Integration Branch Coverage Tests
 *
 * Targets uncovered branches in milestones.ts, repository.ts,
 * insights.ts, pull-requests.ts, and projects.ts:
 * error/catch paths, cache hit paths, null guards, ?? operators.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../src/utils/logger.js', () => ({
    logger: { info: vi.fn(), warning: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

import { MilestonesManager } from '../../src/github/github-integration/milestones.js'
import { RepositoryManager } from '../../src/github/github-integration/repository.js'
import { InsightsManager } from '../../src/github/github-integration/insights.js'
import { PullRequestsManager } from '../../src/github/github-integration/pull-requests.js'

// ============================================================================
// Helpers
// ============================================================================

function createMockClient(overrides: Partial<Record<string, unknown>> = {}) {
    const cache = new Map<string, { data: unknown; timestamp: number }>()
    return {
        octokit: {
            issues: {
                listMilestones: vi.fn(),
                getMilestone: vi.fn(),
                createMilestone: vi.fn(),
                updateMilestone: vi.fn(),
                deleteMilestone: vi.fn(),
            },
            repos: {
                get: vi.fn(),
                getClones: vi.fn(),
                getViews: vi.fn(),
                getTopReferrers: vi.fn(),
                getTopPaths: vi.fn(),
            },
            rest: {
                repos: {
                    getClones: vi.fn(),
                    getViews: vi.fn(),
                    getTopReferrers: vi.fn(),
                    getTopPaths: vi.fn(),
                },
                actions: {
                    listWorkflowRunsForRepo: vi.fn(),
                },
                pulls: {
                    listReviews: vi.fn(),
                    listReviewComments: vi.fn(),
                },
            },
            pulls: {
                list: vi.fn(),
                get: vi.fn(),
            },
        },
        git: {
            branch: vi.fn().mockResolvedValue({ current: 'main' }),
            getRemotes: vi
                .fn()
                .mockResolvedValue([
                    { name: 'origin', refs: { fetch: 'git@github.com:neverinfamous/test.git' } },
                ]),
        },
        cachedRepoInfo: null as Record<string, unknown> | null,
        getCached: vi.fn().mockImplementation((key: string) => cache.get(key)?.data),
        getCachedWithTtl: vi.fn().mockImplementation((key: string) => cache.get(key)?.data),
        setCache: vi.fn().mockImplementation((key: string, data: unknown) => {
            cache.set(key, { data, timestamp: Date.now() })
        }),
        invalidateCache: vi.fn(),
        ...overrides,
    }
}

function makeMilestoneData(overrides: Partial<Record<string, unknown>> = {}) {
    return {
        number: 1,
        title: 'v1.0',
        description: null,
        state: 'open',
        html_url: 'https://github.com/o/r/milestone/1',
        due_on: null,
        open_issues: 5,
        closed_issues: 3,
        created_at: '2025-01-01T00:00:00Z',
        updated_at: '2025-01-02T00:00:00Z',
        creator: null,
        ...overrides,
    }
}

// ============================================================================
// Milestones Manager
// ============================================================================

describe('MilestonesManager — branch coverage', () => {
    let client: ReturnType<typeof createMockClient>
    let manager: MilestonesManager

    beforeEach(() => {
        vi.clearAllMocks()
        client = createMockClient()
        manager = new MilestonesManager(client as never)
    })

    it('should return empty array when no octokit (getMilestones)', async () => {
        client.octokit = null as never
        await expect(manager.getMilestones('o', 'r')).rejects.toThrow()
    })

    it('should return cached milestones', async () => {
        const cached = [{ number: 1, title: 'cached' }]
        client.getCached = vi.fn().mockReturnValue(cached)
        const result = await manager.getMilestones('o', 'r')
        expect(result).toBe(cached)
    })

    it('should handle API error in getMilestones', async () => {
        client.octokit.issues.listMilestones.mockRejectedValue(new Error('API error'))
        await expect(manager.getMilestones('o', 'r')).rejects.toThrow()
    })

    it('should map milestone with creator', async () => {
        client.octokit.issues.listMilestones.mockResolvedValue({
            data: [
                makeMilestoneData({
                    creator: { login: 'user1' },
                    description: 'A desc',
                    due_on: '2025-06-01',
                }),
            ],
        })
        const result = await manager.getMilestones('o', 'r')
        expect(result[0]!.creator).toBe('user1')
        expect(result[0]!.description).toBe('A desc')
        expect(result[0]!.dueOn).toBe('2025-06-01')
    })

    it('should return null when no octokit (getMilestone)', async () => {
        client.octokit = null as never
        await expect(manager.getMilestone('o', 'r', 1)).rejects.toThrow()
    })

    it('should return cached milestone', async () => {
        const cached = { number: 1, title: 'cached' }
        client.getCached = vi.fn().mockReturnValue(cached)
        const result = await manager.getMilestone('o', 'r', 1)
        expect(result).toBe(cached)
    })

    it('should handle API error in getMilestone', async () => {
        client.octokit.issues.getMilestone.mockRejectedValue(new Error('not found'))
        await expect(manager.getMilestone('o', 'r', 99)).rejects.toThrow()
    })

    it('should handle API error in createMilestone', async () => {
        client.octokit.issues.createMilestone.mockRejectedValue(new Error('create failed'))
        await expect(manager.createMilestone('o', 'r', 'test')).rejects.toThrow()
    })

    it('should return null when no octokit (createMilestone)', async () => {
        client.octokit = null as never
        await expect(manager.createMilestone('o', 'r', 'test')).rejects.toThrow()
    })

    it('should handle API error in updateMilestone', async () => {
        client.octokit.issues.updateMilestone.mockRejectedValue(new Error('update failed'))
        await expect(manager.updateMilestone('o', 'r', 1, { title: 'new' })).rejects.toThrow()
    })

    it('should return null when no octokit (updateMilestone)', async () => {
        client.octokit = null as never
        await expect(manager.updateMilestone('o', 'r', 1, { title: 'x' })).rejects.toThrow()
    })

    it('should successfully update milestone with dueOn null', async () => {
        client.octokit.issues.updateMilestone.mockResolvedValue({
            data: makeMilestoneData({ state: 'closed' }),
        })
        const result = await manager.updateMilestone('o', 'r', 1, { dueOn: null })
        expect(result).not.toBeNull()
        expect(result!.state).toBe('closed')
    })

    it('should handle API error in deleteMilestone', async () => {
        client.octokit.issues.deleteMilestone.mockRejectedValue(new Error('delete failed'))
        const result = await manager.deleteMilestone('o', 'r', 1)
        expect(result.success).toBe(false)
        expect(result.error).toBe('delete failed')
    })

    it('should return success false when no octokit (deleteMilestone)', async () => {
        client.octokit = null as never
        const result = await manager.deleteMilestone('o', 'r', 1)
        expect(result.success).toBe(false)
    })
})

// ============================================================================
// Repository Manager
// ============================================================================

describe('RepositoryManager — branch coverage', () => {
    let client: ReturnType<typeof createMockClient>
    let manager: RepositoryManager

    beforeEach(() => {
        vi.clearAllMocks()
        client = createMockClient()
        manager = new RepositoryManager(client as never)
    })

    it('should parse HTTPS github URLs', async () => {
        client.git.getRemotes.mockResolvedValue([
            { name: 'origin', refs: { fetch: 'https://github.com/owner/repo.git' } },
        ])
        const result = await manager.getRepoInfo()
        expect(result.owner).toBe('owner')
        expect(result.repo).toBe('repo')
    })

    it('should return nulls when remote URL is not a github URL', async () => {
        client.git.getRemotes.mockResolvedValue([
            { name: 'origin', refs: { fetch: 'https://gitlab.com/owner/repo.git' } },
        ])
        const result = await manager.getRepoInfo()
        expect(result.owner).toBeNull()
        expect(result.repo).toBeNull()
    })

    it('should return nulls when no remotes', async () => {
        client.git.getRemotes.mockResolvedValue([])
        const result = await manager.getRepoInfo()
        expect(result.owner).toBeNull()
    })

    it('should handle error in getRepoInfo', async () => {
        client.git.branch.mockRejectedValue(new Error('not a git repo'))
        const result = await manager.getRepoInfo()
        expect(result.owner).toBeNull()
        expect(result.branch).toBeNull()
    })

    it('should return empty array when no octokit for getWorkflowRuns', async () => {
        client.octokit = null as never
        await expect(manager.getWorkflowRuns('o', 'r')).rejects.toThrow()
    })

    it('should return cached workflow runs', async () => {
        const cached = [{ id: 1, name: 'CI' }]
        client.getCached = vi.fn().mockReturnValue(cached)
        const result = await manager.getWorkflowRuns('o', 'r')
        expect(result).toBe(cached)
    })

    it('should handle API error in getWorkflowRuns', async () => {
        client.rest = client.octokit.rest
        client.octokit.rest.actions.listWorkflowRunsForRepo.mockRejectedValue(new Error('fail'))
        await expect(manager.getWorkflowRuns('o', 'r')).rejects.toThrow()
    })

    it('should map workflow run with null name', async () => {
        client.octokit.rest.actions.listWorkflowRunsForRepo.mockResolvedValue({
            data: {
                workflow_runs: [
                    {
                        id: 1,
                        name: null,
                        status: 'completed',
                        conclusion: 'success',
                        html_url: 'https://github.com/o/r/actions/runs/1',
                        head_branch: null,
                        head_sha: 'abc123',
                        created_at: '2025-01-01T00:00:00Z',
                        updated_at: '2025-01-01T00:00:00Z',
                    },
                ],
            },
        })
        const result = await manager.getWorkflowRuns('o', 'r')
        expect(result[0]!.name).toBe('Unknown Workflow')
        expect(result[0]!.headBranch).toBe('')
    })

    it('should return cached repo info', () => {
        const info = { owner: 'o', repo: 'r', branch: 'main', remoteUrl: null }
        client.getCached = vi.fn().mockReturnValue(info)
        const result = manager.getCachedRepoInfo()
        expect(result).toBe(info)
    })
})

// ============================================================================
// Insights Manager
// ============================================================================

describe('InsightsManager — branch coverage', () => {
    let client: ReturnType<typeof createMockClient>
    let manager: InsightsManager

    beforeEach(() => {
        vi.clearAllMocks()
        client = createMockClient()
        manager = new InsightsManager(client as never)
    })

    it('should return null when no octokit (getRepoStats)', async () => {
        client.octokit = null as never
        const result = await manager.getRepoStats('o', 'r')
        expect(result).toBeNull()
    })

    it('should return cached repo stats', async () => {
        const cached = { stars: 100 }
        client.getCachedWithTtl = vi.fn().mockReturnValue(cached)
        const result = await manager.getRepoStats('o', 'r')
        expect(result).toBe(cached)
    })

    it('should handle API error in getRepoStats', async () => {
        client.octokit.repos.get.mockRejectedValue(new Error('fail'))
        const result = await manager.getRepoStats('o', 'r')
        expect(result).toBeNull()
    })

    it('should return null when no octokit (getTrafficData)', async () => {
        client.octokit = null as never
        const result = await manager.getTrafficData('o', 'r')
        expect(result).toBeNull()
    })

    it('should return cached traffic data', async () => {
        const cached = { clones: { total: 10 } }
        client.getCachedWithTtl = vi.fn().mockReturnValue(cached)
        const result = await manager.getTrafficData('o', 'r')
        expect(result).toBe(cached)
    })

    it('should handle API error in getTrafficData', async () => {
        client.octokit.rest.repos.getClones.mockRejectedValue(new Error('403'))
        const result = await manager.getTrafficData('o', 'r')
        expect(result).toBeNull()
    })

    it('should compute zero dailyAvg when no clone/view days', async () => {
        client.octokit.rest.repos.getClones.mockResolvedValue({
            data: { count: 10, uniques: 5, clones: [] },
        })
        client.octokit.rest.repos.getViews.mockResolvedValue({
            data: { count: 20, uniques: 15, views: [] },
        })
        const result = await manager.getTrafficData('o', 'r')
        expect(result!.clones.dailyAvg).toBe(0)
        expect(result!.views.dailyAvg).toBe(0)
    })

    it('should handle null clones array', async () => {
        client.octokit.rest.repos.getClones.mockResolvedValue({
            data: { count: 5, uniques: 3, clones: null },
        })
        client.octokit.rest.repos.getViews.mockResolvedValue({
            data: { count: 10, uniques: 7, views: null },
        })
        const result = await manager.getTrafficData('o', 'r')
        expect(result!.clones.dailyAvg).toBe(0)
        expect(result!.views.dailyAvg).toBe(0)
    })

    it('should return empty array when no octokit (getTopReferrers)', async () => {
        client.octokit = null as never
        const result = await manager.getTopReferrers('o', 'r')
        expect(result).toEqual([])
    })

    it('should return cached referrers', async () => {
        const cached = [{ referrer: 'google.com', count: 10, uniques: 5 }]
        client.getCachedWithTtl = vi.fn().mockReturnValue(cached)
        const result = await manager.getTopReferrers('o', 'r')
        expect(result).toEqual(cached)
    })

    it('should handle API error in getTopReferrers', async () => {
        client.octokit.rest.repos.getTopReferrers.mockRejectedValue(new Error('fail'))
        const result = await manager.getTopReferrers('o', 'r')
        expect(result).toEqual([])
    })

    it('should return empty array when no octokit (getPopularPaths)', async () => {
        client.octokit = null as never
        const result = await manager.getPopularPaths('o', 'r')
        expect(result).toEqual([])
    })

    it('should return cached popular paths', async () => {
        const cached = [{ path: '/readme', count: 10 }]
        client.getCachedWithTtl = vi.fn().mockReturnValue(cached)
        const result = await manager.getPopularPaths('o', 'r')
        expect(result).toEqual(cached)
    })

    it('should handle API error in getPopularPaths', async () => {
        client.octokit.rest.repos.getTopPaths.mockRejectedValue(new Error('fail'))
        const result = await manager.getPopularPaths('o', 'r')
        expect(result).toEqual([])
    })
})

// ============================================================================
// Pull Requests Manager
// ============================================================================

describe('PullRequestsManager — branch coverage', () => {
    let client: ReturnType<typeof createMockClient>
    let manager: PullRequestsManager

    beforeEach(() => {
        vi.clearAllMocks()
        client = createMockClient()
        manager = new PullRequestsManager(client as never)
    })

    it('should return empty array when no octokit (getReviews)', async () => {
        client.octokit = null as never
        await expect(manager.getReviews('o', 'r', 1)).rejects.toThrow()
    })

    it('should return cached reviews', async () => {
        const cached = [{ id: 1, state: 'APPROVED' }]
        client.getCached = vi.fn().mockReturnValue(cached)
        const result = await manager.getReviews('o', 'r', 1)
        expect(result).toBe(cached)
    })

    it('should return empty array when no octokit (getReviewComments)', async () => {
        client.octokit = null as never
        await expect(manager.getReviewComments('o', 'r', 1)).rejects.toThrow()
    })

    it('should return cached review comments', async () => {
        const cached = [{ id: 1, body: 'fix this' }]
        client.getCached = vi.fn().mockReturnValue(cached)
        const result = await manager.getReviewComments('o', 'r', 1)
        expect(result).toBe(cached)
    })

    it('should handle API error in getReviewComments', async () => {
        client.octokit.rest.pulls.listReviewComments.mockRejectedValue(new Error('fail'))
        await expect(manager.getReviewComments('o', 'r', 1)).rejects.toThrow()
    })

    it('should handle review comment with null line and side', async () => {
        client.octokit.rest.pulls.listReviewComments.mockResolvedValue({
            data: [
                {
                    id: 1,
                    user: { login: 'copilot[bot]' },
                    body: 'test',
                    path: 'src/foo.ts',
                    line: null,
                    original_line: null,
                    side: null,
                    created_at: '2025-01-01T00:00:00Z',
                },
            ],
        })
        const result = await manager.getReviewComments('o', 'r', 1)
        expect(result[0]!.line).toBeNull()
        expect(result[0]!.side).toBe('RIGHT')
        expect(result[0]!.isCopilot).toBe(true)
    })
})
