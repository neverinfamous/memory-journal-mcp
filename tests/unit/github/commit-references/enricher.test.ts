import { describe, it, expect, vi, beforeEach } from 'vitest'
import { enrichCommits } from '../../../../src/github/commit-references/enricher.js'
import type { GitHubIntegration } from '../../../../src/github/github-integration/index.js'

vi.mock('simple-git', () => ({
    simpleGit: vi.fn(() => ({
        log: vi.fn().mockResolvedValue({
            latest: {
                hash: '1234567890abcdef',
                message: 'Fix some bug',
                body: 'This fixes #42 and closes #43',
                author_name: 'Test Author',
                date: '2023-01-01T00:00:00Z',
            },
        }),
    })),
}))

describe('enrichCommits', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('enriches commits without github integration', async () => {
        const enriched = await enrichCommits('/fake/dir', ['1234567890abcdef'])

        expect(enriched).toHaveLength(1)
        expect(enriched[0].hash).toBe('1234567890abcdef')
        expect(enriched[0].subject).toBe('Fix some bug')
        expect(enriched[0].references).toHaveLength(2)
        expect(enriched[0].references[0].type).toBe('unknown')
        expect(enriched[0].references[0].number).toBe(42)
    })

    it('resolves references when github integration is provided', async () => {
        const mockGithub = {
            getCachedRepoInfo: vi.fn().mockReturnValue({ owner: 'owner', repo: 'repo' }),
            getRepoInfo: vi.fn().mockResolvedValue({ owner: 'owner', repo: 'repo' }),
            isApiAvailable: vi.fn().mockReturnValue(true),
            getIssue: vi.fn().mockImplementation(async (owner, repo, number) => {
                if (number === 42) {
                    return {
                        title: 'Issue 42',
                        state: 'OPEN',
                        milestone: { number: 1, title: 'v1.0' },
                    }
                }
                return null
            }),
            getPullRequest: vi.fn().mockImplementation(async (owner, repo, number) => {
                if (number === 43) {
                    return {
                        title: 'PR 43',
                        state: 'MERGED',
                    }
                }
                return null
            }),
        } as unknown as GitHubIntegration

        const enriched = await enrichCommits('/fake/dir', ['1234567890abcdef'], mockGithub)

        expect(enriched).toHaveLength(1)
        expect(enriched[0].references).toHaveLength(2)
        expect(enriched[0].references[0].type).toBe('issue')
        expect(enriched[0].references[0].title).toBe('Issue 42')
        expect(enriched[0].references[0].milestone?.title).toBe('v1.0')
        expect(enriched[0].references[1].type).toBe('pull_request')
        expect(enriched[0].references[1].title).toBe('PR 43')
        expect(enriched[0].references[1].state).toBe('MERGED')
    })
})
