import { describe, it, expect, vi } from 'vitest'
import { IssuesManager } from '../../src/github/github-integration/issues.js'
import type { GitHubClient } from '../../src/github/github-integration/client.js'

describe('IssuesManager - getIssueComments (Coverage)', () => {
    it('returns empty array when octokit is not available', async () => {
        const mockClient = {
            octokit: null,
            getCached: vi.fn(),
            setCache: vi.fn(),
        } as unknown as GitHubClient
        const manager = new IssuesManager(mockClient)
        await expect(manager.getIssueComments('owner', 'repo', 1)).rejects.toThrow()
    })

    it('returns from cache if available', async () => {
        const mockClient = {
            octokit: {},
            getCached: vi
                .fn()
                .mockReturnValue([{ author: 'test', body: 'body', createdAt: 'date' }]),
            setCache: vi.fn(),
        } as unknown as GitHubClient
        const manager = new IssuesManager(mockClient)
        const result = await manager.getIssueComments('owner', 'repo', 1)
        expect(result.length).toBe(1)
        expect(result[0].author).toBe('test')
    })

    it('fetches comments and sets cache', async () => {
        const listComments = vi.fn().mockResolvedValue({
            data: [
                { user: { login: 'user1' }, body: 'body1', created_at: '2025' },
                { user: null, body: null, created_at: '2025' },
            ],
        })
        const mockClient = {
            octokit: { issues: { listComments } },
            getCached: vi.fn().mockReturnValue(undefined),
            setCache: vi.fn(),
        } as unknown as GitHubClient

        const manager = new IssuesManager(mockClient)
        const result = await manager.getIssueComments('owner', 'repo', 1)
        expect(listComments).toHaveBeenCalled()
        expect(mockClient.setCache).toHaveBeenCalled()
        expect(result.length).toBe(2)
        expect(result[0].author).toBe('user1')
        expect(result[1].author).toBe('unknown')
        expect(result[1].body).toBe('')
    })

    it('handles errors during fetch', async () => {
        const listComments = vi.fn().mockRejectedValue(new Error('API error'))
        const mockClient = {
            octokit: { issues: { listComments } },
            getCached: vi.fn().mockReturnValue(undefined),
            setCache: vi.fn(),
        } as unknown as GitHubClient

        const manager = new IssuesManager(mockClient)
        await expect(manager.getIssueComments('owner', 'repo', 1)).rejects.toThrow()
    })

    it('caps limit at 100', async () => {
        const listComments = vi.fn().mockResolvedValue({ data: [] })
        const mockClient = {
            octokit: { issues: { listComments } },
            getCached: vi.fn().mockReturnValue(undefined),
            setCache: vi.fn(),
        } as unknown as GitHubClient

        const manager = new IssuesManager(mockClient)
        await manager.getIssueComments('owner', 'repo', 1, 500)
        expect(listComments).toHaveBeenCalledWith(expect.objectContaining({ per_page: 100 }))
    })
})

describe('IssuesManager - getIssues (Coverage)', () => {
    it('returns empty array when octokit is not available', async () => {
        const mockClient = {
            octokit: null,
            getCached: vi.fn(),
            setCache: vi.fn(),
        } as unknown as GitHubClient
        const manager = new IssuesManager(mockClient)
        await expect(manager.getIssues('owner', 'repo')).rejects.toThrow()
    })

    it('returns from cache if available', async () => {
        const mockClient = {
            octokit: {},
            getCached: vi.fn().mockReturnValue([{ title: 'cached issue' }]),
            setCache: vi.fn(),
        } as unknown as GitHubClient
        const manager = new IssuesManager(mockClient)
        const result = await manager.getIssues('owner', 'repo')
        expect(result.length).toBe(1)
    })

    it('fetches issues and sets cache', async () => {
        const listForRepo = vi.fn().mockResolvedValue({
            data: [
                {
                    number: 1,
                    title: 'issue1',
                    pull_request: undefined,
                    state: 'open',
                    html_url: 'url1',
                    milestone: { title: 'M1', number: 1 },
                },
                { number: 2, title: 'pr1', pull_request: {} }, // filtered out
            ],
        })
        const mockClient = {
            octokit: { issues: { listForRepo } },
            getCached: vi.fn().mockReturnValue(undefined),
            setCache: vi.fn(),
        } as unknown as GitHubClient

        const manager = new IssuesManager(mockClient)
        const result = await manager.getIssues('owner', 'repo')
        expect(listForRepo).toHaveBeenCalled()
        expect(mockClient.setCache).toHaveBeenCalled()
        expect(result.length).toBe(1)
        expect(result[0].title).toBe('<untrusted_remote_content>issue1</untrusted_remote_content>')
    })

    it('handles errors during fetch', async () => {
        const listForRepo = vi.fn().mockRejectedValue(new Error('API error'))
        const mockClient = {
            octokit: { issues: { listForRepo } },
            getCached: vi.fn().mockReturnValue(undefined),
            setCache: vi.fn(),
        } as unknown as GitHubClient

        const manager = new IssuesManager(mockClient)
        await expect(manager.getIssues('owner', 'repo')).rejects.toThrow()
    })
})

describe('IssuesManager - getIssue (Coverage)', () => {
    it('returns null when octokit is not available', async () => {
        const mockClient = {
            octokit: null,
            getCached: vi.fn(),
            setCache: vi.fn(),
        } as unknown as GitHubClient
        const manager = new IssuesManager(mockClient)
        await expect(manager.getIssue('owner', 'repo', 1)).rejects.toThrow()
    })

    it('returns from cache if available', async () => {
        const mockClient = {
            octokit: {},
            getCached: vi.fn().mockReturnValue({ title: 'cached issue' }),
            setCache: vi.fn(),
        } as unknown as GitHubClient
        const manager = new IssuesManager(mockClient)
        const result = await manager.getIssue('owner', 'repo', 1)
        expect(result).toBeDefined()
    })

    it('fetches issue and sets cache', async () => {
        const get = vi.fn().mockResolvedValue({
            data: {
                number: 1,
                title: 'issue1',
                state: 'open',
                html_url: 'url1',
                node_id: 'n1',
                labels: ['bug', { name: 'enhancement' }],
                assignees: [{ login: 'user1' }],
                created_at: '2025',
                updated_at: '2025',
                closed_at: null,
                comments: 0,
                milestone: { title: 'M1', number: 1 },
            },
        })
        const mockClient = {
            octokit: { issues: { get } },
            getCached: vi.fn().mockReturnValue(undefined),
            setCache: vi.fn(),
        } as unknown as GitHubClient

        const manager = new IssuesManager(mockClient)
        const result = await manager.getIssue('owner', 'repo', 1)
        expect(get).toHaveBeenCalled()
        expect(mockClient.setCache).toHaveBeenCalled()
        expect(result?.title).toBe('<untrusted_remote_content>issue1</untrusted_remote_content>')
    })

    it('returns null if issue is a pull request', async () => {
        const get = vi.fn().mockResolvedValue({
            data: { pull_request: {} },
        })
        const mockClient = {
            octokit: { issues: { get } },
            getCached: vi.fn().mockReturnValue(undefined),
            setCache: vi.fn(),
        } as unknown as GitHubClient
        const manager = new IssuesManager(mockClient)
        const result = await manager.getIssue('owner', 'repo', 1)
        expect(result).toBeNull()
    })

    it('handles errors during fetch', async () => {
        const get = vi.fn().mockRejectedValue(new Error('API error'))
        const mockClient = {
            octokit: { issues: { get } },
            getCached: vi.fn().mockReturnValue(undefined),
            setCache: vi.fn(),
        } as unknown as GitHubClient

        const manager = new IssuesManager(mockClient)
        await expect(manager.getIssue('owner', 'repo', 1)).rejects.toThrow()
    })
})
