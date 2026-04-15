import { describe, it, expect, vi } from 'vitest'
import { PullRequestsManager } from '../../src/github/github-integration/pull-requests.js'
import type { GitHubClient } from '../../src/github/github-integration/client.js'

describe('PullRequestsManager - coverage', () => {
    it('getPullRequests handles string error', async () => {
        const mockClient = {
            octokit: { pulls: { list: vi.fn().mockRejectedValue('String Error') } },
            getCached: vi.fn().mockReturnValue(undefined),
            setCache: vi.fn(),
        } as unknown as GitHubClient
        const manager = new PullRequestsManager(mockClient)
        await expect(manager.getPullRequests('owner', 'repo')).rejects.toThrow()
    })

    it('getPullRequest handles string error and draft', async () => {
        const mockClient = {
            octokit: {
                pulls: {
                    get: vi.fn().mockResolvedValue({
                        data: {
                            number: 1,
                            title: 't',
                            html_url: 'u',
                            state: 'open',
                            head: { ref: 'h' },
                            base: { ref: 'b' },
                            user: { login: 'u' },
                            created_at: 'c',
                            updated_at: 'u',
                            additions: 1,
                            deletions: 1,
                            changed_files: 1,
                            // missing draft to hit default ?? false
                        },
                    }),
                },
            },
            getCached: vi.fn().mockReturnValue(undefined),
            setCache: vi.fn(),
        } as unknown as GitHubClient
        const manager = new PullRequestsManager(mockClient)
        const result = await manager.getPullRequest('owner', 'repo', 1)
        expect(result?.draft).toBe(false)

        // error handling
        const errClient = {
            octokit: { pulls: { get: vi.fn().mockRejectedValue('String Error') } },
            getCached: vi.fn().mockReturnValue(undefined),
            setCache: vi.fn(),
        } as unknown as GitHubClient
        const errManager = new PullRequestsManager(errClient)
        await expect(errManager.getPullRequest('owner', 'repo', 1)).rejects.toThrow()
    })

    it('getReviews handles string error and missing submitted_at', async () => {
        const mockClient = {
            octokit: {
                rest: {
                    pulls: {
                        listReviews: vi.fn().mockResolvedValue({
                            data: [
                                {
                                    id: 1,
                                    user: { login: 'user' },
                                    state: 'APPROVED',
                                    body: 'body',
                                },
                            ],
                        }),
                    },
                },
            },
            getCached: vi.fn().mockReturnValue(undefined),
            setCache: vi.fn(),
        } as unknown as GitHubClient
        const manager = new PullRequestsManager(mockClient)
        const result = await manager.getReviews('owner', 'repo', 1)
        expect(result[0].submittedAt).toBeDefined()

        // error handling
        const errClient = {
            octokit: {
                rest: { pulls: { listReviews: vi.fn().mockRejectedValue('String Error') } },
            },
            getCached: vi.fn().mockReturnValue(undefined),
            setCache: vi.fn(),
        } as unknown as GitHubClient
        const errManager = new PullRequestsManager(errClient)
        await expect(errManager.getReviews('owner', 'repo', 1)).rejects.toThrow()
    })

    it('getReviewComments handles string error', async () => {
        const errClient = {
            octokit: {
                rest: { pulls: { listReviewComments: vi.fn().mockRejectedValue('String Error') } },
            },
            getCached: vi.fn().mockReturnValue(undefined),
            setCache: vi.fn(),
        } as unknown as GitHubClient
        const errManager = new PullRequestsManager(errClient)
        await expect(errManager.getReviewComments('owner', 'repo', 1)).rejects.toThrow()
    })

    it('getCopilotReviewSummary handles COMMENTED state', async () => {
        const mockClient = {
            octokit: {
                rest: {
                    pulls: {
                        listReviews: vi.fn().mockResolvedValue({
                            data: [{ id: 1, user: { login: 'copilot[bot]' }, state: 'COMMENTED' }],
                        }),
                        listReviewComments: vi.fn().mockResolvedValue({ data: [] }),
                    },
                },
            },
            getCached: vi.fn().mockReturnValue(undefined),
            setCache: vi.fn(),
        } as unknown as GitHubClient
        const manager = new PullRequestsManager(mockClient)
        const result = await manager.getCopilotReviewSummary('owner', 'repo', 1)
        expect(result.state).toBe('commented')
    })
})
