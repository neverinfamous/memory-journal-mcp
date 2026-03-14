/**
 * memory-journal-mcp — Pull Requests Manager Unit Tests
 *
 * Tests for PullRequestsManager: getPullRequests, getPullRequest,
 * getReviews, getReviewComments, getCopilotReviewSummary.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../src/utils/logger.js', () => ({
    logger: {
        info: vi.fn(),
        warning: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
    },
}))

import { PullRequestsManager } from '../../src/github/github-integration/pull-requests.js'

// ============================================================================
// Helpers
// ============================================================================

function createMockClient(overrides: Partial<Record<string, unknown>> = {}) {
    const cache = new Map<string, unknown>()
    return {
        octokit: {
            pulls: {
                list: vi.fn().mockResolvedValue({
                    data: [
                        {
                            number: 1,
                            title: 'Feature A',
                            html_url: 'https://github.com/x/1',
                            state: 'open',
                            merged_at: null,
                        },
                        {
                            number: 2,
                            title: 'Feature B',
                            html_url: 'https://github.com/x/2',
                            state: 'closed',
                            merged_at: '2025-01-01',
                        },
                    ],
                }),
                get: vi.fn().mockResolvedValue({
                    data: {
                        number: 1,
                        title: 'Feature A',
                        html_url: 'https://github.com/x/1',
                        state: 'open',
                        merged_at: null,
                        body: 'PR body',
                        draft: false,
                        head: { ref: 'feature-branch' },
                        base: { ref: 'main' },
                        user: { login: 'dev' },
                        created_at: '2025-01-01T00:00:00Z',
                        updated_at: '2025-01-02T00:00:00Z',
                        closed_at: null,
                        additions: 100,
                        deletions: 50,
                        changed_files: 5,
                    },
                }),
            },
            rest: {
                pulls: {
                    listReviews: vi.fn().mockResolvedValue({
                        data: [
                            {
                                id: 1,
                                user: { login: 'reviewer' },
                                state: 'APPROVED',
                                body: 'Looks good',
                                submitted_at: '2025-01-01T12:00:00Z',
                            },
                            {
                                id: 2,
                                user: { login: 'copilot-pull-request-reviewer[bot]' },
                                state: 'COMMENTED',
                                body: 'Found issues',
                                submitted_at: '2025-01-01T12:30:00Z',
                            },
                        ],
                    }),
                    listReviewComments: vi.fn().mockResolvedValue({
                        data: [
                            {
                                id: 1,
                                user: { login: 'copilot-pull-request-reviewer[bot]' },
                                body: 'Fix this',
                                path: 'src/index.ts',
                                line: 42,
                                side: 'RIGHT',
                                created_at: '2025-01-01T12:30:00Z',
                            },
                        ],
                    }),
                },
            },
        },
        getCached: vi.fn().mockImplementation((key: string) => cache.get(key)),
        setCache: vi
            .fn()
            .mockImplementation((key: string, value: unknown) => cache.set(key, value)),
        ...overrides,
    }
}

// ============================================================================
// Tests
// ============================================================================

describe('PullRequestsManager', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    // ========================================================================
    // getPullRequests
    // ========================================================================

    describe('getPullRequests', () => {
        it('should return empty array when no octokit', async () => {
            const client = createMockClient({ octokit: null })
            const mgr = new PullRequestsManager(client as never)
            const result = await mgr.getPullRequests('owner', 'repo')
            expect(result).toEqual([])
        })

        it('should fetch and map PR states correctly', async () => {
            const client = createMockClient()
            const mgr = new PullRequestsManager(client as never)
            const result = await mgr.getPullRequests('owner', 'repo')

            expect(result).toHaveLength(2)
            expect(result[0]!.state).toBe('OPEN')
            expect(result[1]!.state).toBe('MERGED') // merged_at is set
        })

        it('should return cached results on second call', async () => {
            const client = createMockClient()
            const mgr = new PullRequestsManager(client as never)

            await mgr.getPullRequests('owner', 'repo')
            const result = await mgr.getPullRequests('owner', 'repo')

            expect(result).toHaveLength(2)
            expect(client.octokit!.pulls.list).toHaveBeenCalledTimes(1)
        })

        it('should return empty array on API error', async () => {
            const client = createMockClient()
            client.octokit!.pulls.list.mockRejectedValue(new Error('API error'))
            const mgr = new PullRequestsManager(client as never)

            const result = await mgr.getPullRequests('owner', 'repo')
            expect(result).toEqual([])
        })
    })

    // ========================================================================
    // getPullRequest
    // ========================================================================

    describe('getPullRequest', () => {
        it('should return null when no octokit', async () => {
            const client = createMockClient({ octokit: null })
            const mgr = new PullRequestsManager(client as never)
            const result = await mgr.getPullRequest('owner', 'repo', 1)
            expect(result).toBeNull()
        })

        it('should fetch and map PR detail fields', async () => {
            const client = createMockClient()
            const mgr = new PullRequestsManager(client as never)
            const result = await mgr.getPullRequest('owner', 'repo', 1)

            expect(result).toBeDefined()
            expect(result!.title).toBe('Feature A')
            expect(result!.headBranch).toBe('feature-branch')
            expect(result!.baseBranch).toBe('main')
            expect(result!.additions).toBe(100)
            expect(result!.deletions).toBe(50)
        })

        it('should return null on API error', async () => {
            const client = createMockClient()
            client.octokit!.pulls.get.mockRejectedValue(new Error('API error'))
            const mgr = new PullRequestsManager(client as never)

            const result = await mgr.getPullRequest('owner', 'repo', 1)
            expect(result).toBeNull()
        })
    })

    // ========================================================================
    // getReviews
    // ========================================================================

    describe('getReviews', () => {
        it('should return empty array when no octokit', async () => {
            const client = createMockClient({ octokit: null })
            const mgr = new PullRequestsManager(client as never)
            const result = await mgr.getReviews('owner', 'repo', 1)
            expect(result).toEqual([])
        })

        it('should detect Copilot bot reviews', async () => {
            const client = createMockClient()
            const mgr = new PullRequestsManager(client as never)
            const result = await mgr.getReviews('owner', 'repo', 1)

            expect(result).toHaveLength(2)
            expect(result[0]!.isCopilot).toBe(false)
            expect(result[1]!.isCopilot).toBe(true)
        })

        it('should return empty array on API error', async () => {
            const client = createMockClient()
            client.octokit!.rest.pulls.listReviews.mockRejectedValue(new Error('API error'))
            const mgr = new PullRequestsManager(client as never)

            const result = await mgr.getReviews('owner', 'repo', 1)
            expect(result).toEqual([])
        })
    })

    // ========================================================================
    // getReviewComments
    // ========================================================================

    describe('getReviewComments', () => {
        it('should return empty array when no octokit', async () => {
            const client = createMockClient({ octokit: null })
            const mgr = new PullRequestsManager(client as never)
            const result = await mgr.getReviewComments('owner', 'repo', 1)
            expect(result).toEqual([])
        })

        it('should detect Copilot bot comments', async () => {
            const client = createMockClient()
            const mgr = new PullRequestsManager(client as never)
            const result = await mgr.getReviewComments('owner', 'repo', 1)

            expect(result).toHaveLength(1)
            expect(result[0]!.isCopilot).toBe(true)
            expect(result[0]!.path).toBe('src/index.ts')
        })
    })

    // ========================================================================
    // getCopilotReviewSummary
    // ========================================================================

    describe('getCopilotReviewSummary', () => {
        it('should aggregate Copilot review state from latest review', async () => {
            const client = createMockClient()
            const mgr = new PullRequestsManager(client as never)
            const result = await mgr.getCopilotReviewSummary('owner', 'repo', 1)

            expect(result.prNumber).toBe(1)
            expect(result.state).toBe('commented') // Latest Copilot review is COMMENTED
            expect(result.commentCount).toBe(1)
        })

        it('should return state=none when no Copilot reviews', async () => {
            const client = createMockClient()
            client.octokit!.rest.pulls.listReviews.mockResolvedValue({
                data: [
                    {
                        id: 1,
                        user: { login: 'human' },
                        state: 'APPROVED',
                        body: '',
                        submitted_at: '2025-01-01',
                    },
                ],
            })
            client.octokit!.rest.pulls.listReviewComments.mockResolvedValue({ data: [] })

            const mgr = new PullRequestsManager(client as never)
            const result = await mgr.getCopilotReviewSummary('owner', 'repo', 1)

            expect(result.state).toBe('none')
            expect(result.commentCount).toBe(0)
        })

        it('should handle APPROVED Copilot review', async () => {
            const client = createMockClient()
            client.octokit!.rest.pulls.listReviews.mockResolvedValue({
                data: [
                    {
                        id: 1,
                        user: { login: 'copilot[bot]' },
                        state: 'APPROVED',
                        body: '',
                        submitted_at: '2025-01-01',
                    },
                ],
            })
            client.octokit!.rest.pulls.listReviewComments.mockResolvedValue({ data: [] })

            const mgr = new PullRequestsManager(client as never)
            const result = await mgr.getCopilotReviewSummary('owner', 'repo', 1)

            expect(result.state).toBe('approved')
        })

        it('should handle CHANGES_REQUESTED Copilot review', async () => {
            const client = createMockClient()
            client.octokit!.rest.pulls.listReviews.mockResolvedValue({
                data: [
                    {
                        id: 1,
                        user: { login: 'github-copilot[bot]' },
                        state: 'CHANGES_REQUESTED',
                        body: '',
                        submitted_at: '2025-01-01',
                    },
                ],
            })
            client.octokit!.rest.pulls.listReviewComments.mockResolvedValue({ data: [] })

            const mgr = new PullRequestsManager(client as never)
            const result = await mgr.getCopilotReviewSummary('owner', 'repo', 1)

            expect(result.state).toBe('changes_requested')
        })
    })
})
