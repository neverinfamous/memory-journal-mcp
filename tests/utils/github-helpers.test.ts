/**
 * memory-journal-mcp — GitHub Helpers Unit Tests
 *
 * Tests for resolveIssueUrl utility function.
 */

import { describe, it, expect, vi } from 'vitest'
import { resolveIssueUrl } from '../../src/utils/github-helpers.js'

vi.mock('../../src/github/github-integration/index.js', () => {
    class MockGitHubIntegration {
        async getRepoInfo() {
            return { owner: 'dynamic-owner', repo: 'dynamic-test-repo' }
        }
    }
    return {
        GitHubIntegration: MockGitHubIntegration,
        getGitHubIntegration: () => new MockGitHubIntegration(),
    }
})

// ============================================================================
// Tests
// ============================================================================

describe('resolveIssueUrl', () => {
    it('should return existingUrl when provided', async () => {
        const result = await resolveIssueUrl(
            {} as never,
            undefined,
            42,
            'https://example.com/issue/42'
        )
        expect(result).toBe('https://example.com/issue/42')
    })

    it('should return undefined when no issueNumber', async () => {
        const result = await resolveIssueUrl({} as never, undefined, undefined, undefined)
        expect(result).toBeUndefined()
    })

    it('should return undefined when no github integration', async () => {
        const result = await resolveIssueUrl({} as never, undefined, 42, undefined)
        expect(result).toBeUndefined()
    })

    it('should construct URL from cached repo info', async () => {
        const github = {
            getCachedRepoInfo: vi
                .fn()
                .mockReturnValue({ owner: 'neverinfamous', repo: 'memory-journal-mcp' }),
            getRepoInfo: vi
                .fn()
                .mockResolvedValue({ owner: 'neverinfamous', repo: 'memory-journal-mcp' }),
        }

        const result = await resolveIssueUrl({ github } as never, undefined, 42, undefined)
        expect(result).toBe('https://github.com/neverinfamous/memory-journal-mcp/issues/42')
    })

    it('should return undefined when cached repo info is incomplete', async () => {
        const github = {
            getCachedRepoInfo: vi.fn().mockReturnValue(null),
            getRepoInfo: vi.fn().mockResolvedValue({ owner: null, repo: null }),
        }

        const result = await resolveIssueUrl({ github } as never, undefined, 42, undefined)
        expect(result).toBeUndefined()
    })

    it('should return undefined when cached repo has no owner', async () => {
        const github = {
            getCachedRepoInfo: vi.fn().mockReturnValue({ owner: '', repo: 'memory-journal-mcp' }),
            getRepoInfo: vi.fn().mockResolvedValue({ owner: '', repo: 'memory-journal-mcp' }),
        }

        const result = await resolveIssueUrl({ github } as never, undefined, 42, undefined)
        expect(result).toBeUndefined()
    })

    it('should dynamically resolve using projectRegistry if projectNumber provided', async () => {
        const context = {
            github: {
                getCachedRepoInfo: vi.fn(),
                getRepoInfo: vi.fn().mockResolvedValue({ owner: null, repo: null }),
            },
            config: {
                projectRegistry: {
                    testProject: { project_number: 99, path: '/test/dynamic/path' },
                },
            },
        }
        const result = await resolveIssueUrl(context as never, 99, 123, undefined)
        expect(result).toBe('https://github.com/dynamic-owner/dynamic-test-repo/issues/123')
    })

    it('should fallback to cached info if projectRegistry lacks projectNumber', async () => {
        const context = {
            github: {
                getCachedRepoInfo: vi
                    .fn()
                    .mockReturnValue({ owner: 'cached-owner', repo: 'cached-repo' }),
                getRepoInfo: vi
                    .fn()
                    .mockResolvedValue({ owner: 'cached-owner', repo: 'cached-repo' }),
            },
            config: {
                projectRegistry: {
                    testProject: { project_number: 55, path: '/test/dynamic/path' },
                },
            },
        }
        // passing 99 while registry only has 55
        const result = await resolveIssueUrl(context as never, 99, 124, undefined)
        expect(result).toBe('https://github.com/cached-owner/cached-repo/issues/124')
    })
})
