/**
 * memory-journal-mcp — GitHub Client, Issues Manager, Error Helpers Branch Coverage
 *
 * Targets uncovered branches in:
 * - client.ts (66.66%): LRU cache eviction (>100 items), getCachedWithTtl, expired entries
 * - issues.ts (66.66%): cache hits, error/catch, milestone/labels mapping, closeIssue branches
 * - error-helpers.ts (62.5%): ZodError empty path, non-Error throw
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ZodError, ZodIssueCode } from 'zod'

vi.mock('../../src/utils/logger.js', () => ({
    logger: { info: vi.fn(), warning: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

vi.mock('@octokit/rest', () => ({
    Octokit: vi.fn(),
}))

vi.mock('@octokit/graphql', () => ({
    graphql: { defaults: vi.fn() },
}))

vi.mock('simple-git', () => ({
    simpleGit: vi.fn().mockReturnValue({}),
}))

import { GitHubClient } from '../../src/github/github-integration/client.js'
import { IssuesManager } from '../../src/github/github-integration/issues.js'
import { formatZodError, formatHandlerError } from '../../src/utils/error-helpers.js'
import { MemoryJournalMcpError } from '../../src/types/errors.js'
import { ErrorCategory } from '../../src/types/error-types.js'

// ============================================================================
// GitHubClient Branch Coverage
// ============================================================================

describe('GitHubClient — branch coverage', () => {
    let client: GitHubClient

    beforeEach(() => {
        vi.clearAllMocks()
        delete process.env['GITHUB_TOKEN']

        client = new GitHubClient('.')
    })

    it('should initialize without token', () => {
        expect(client.octokit).toBeNull()
        expect(client.graphqlWithAuth).toBeNull()
    })

    describe('getCached', () => {
        it('should return undefined for non-existent key', () => {
            expect(client.getCached('missing')).toBeUndefined()
        })

        it('should return cached data for valid entry', () => {
            client.setCache('key1', { data: 'test' })
            expect(client.getCached('key1')).toEqual({ data: 'test' })
        })

        it('should delete expired entries and return undefined', () => {
            client.apiCache.set('expired', { data: 'old', timestamp: Date.now() - 10 * 60 * 1000 })
            expect(client.getCached('expired')).toBeUndefined()
            expect(client.apiCache.has('expired')).toBe(false)
        })
    })

    describe('getCachedWithTtl', () => {
        it('should return data when within custom TTL', () => {
            client.setCache('ttl-key', 'custom-data')
            expect(client.getCachedWithTtl('ttl-key', 60_000)).toBe('custom-data')
        })

        it('should return undefined for expired entry with custom TTL', () => {
            client.apiCache.set('old-ttl', { data: 'stale', timestamp: Date.now() - 120_000 })
            expect(client.getCachedWithTtl('old-ttl', 60_000)).toBeUndefined()
            expect(client.apiCache.has('old-ttl')).toBe(false)
        })

        it('should return undefined for non-existent key', () => {
            expect(client.getCachedWithTtl('nope', 5000)).toBeUndefined()
        })
    })

    describe('setCache — LRU eviction', () => {
        it('should evict oldest entry when cache exceeds 100 items', () => {
            for (let i = 0; i < 101; i++) {
                client.setCache(`key-${String(i)}`, i)
            }
            // key-0 should be evicted
            expect(client.apiCache.has('key-0')).toBe(false)
            expect(client.apiCache.has('key-100')).toBe(true)
            expect(client.apiCache.size).toBe(100)
        })
    })

    describe('invalidateCache', () => {
        it('should remove entries matching prefix', () => {
            client.setCache('issues:owner:repo:open:20', [])
            client.setCache('issues:owner:repo:closed:20', [])
            client.setCache('prs:owner:repo:open:20', [])
            client.invalidateCache('issues:')
            expect(client.apiCache.has('issues:owner:repo:open:20')).toBe(false)
            expect(client.apiCache.has('prs:owner:repo:open:20')).toBe(true)
        })
    })

    describe('clearCache', () => {
        it('should clear all cache entries', () => {
            client.setCache('a', 1)
            client.setCache('b', 2)
            client.clearCache()
            expect(client.apiCache.size).toBe(0)
        })
    })

    describe('isApiAvailable', () => {
        it('should return false when no token', () => {
            expect(client.isApiAvailable()).toBe(false)
        })
    })
})

// ============================================================================
// IssuesManager Branch Coverage
// ============================================================================

describe('IssuesManager — branch coverage', () => {
    let client: GitHubClient
    let issues: IssuesManager

    beforeEach(() => {
        vi.clearAllMocks()
        delete process.env['GITHUB_TOKEN']
        client = new GitHubClient('.')
        issues = new IssuesManager(client)
    })

    describe('getIssues', () => {
        it('should return empty array when no octokit', async () => {
            await expect(issues.getIssues('o', 'r')).rejects.toThrow()
        })

        it('should return cached issues', async () => {
            const cached = [{ number: 1, title: 'cached' }]
            client.setCache('issues:o:r:open:20', cached)
            client.octokit = {} as any // enable the octokit check
            const result = await issues.getIssues('o', 'r')
            expect(result).toEqual(cached)
        })

        it('should handle API error gracefully', async () => {
            client.octokit = {
                issues: {
                    listForRepo: vi.fn().mockRejectedValue(new Error('API down')),
                },
            } as any
            await expect(issues.getIssues('o', 'r')).rejects.toThrow()
        })

        it('should filter out PRs and map milestone/state', async () => {
            client.octokit = {
                issues: {
                    listForRepo: vi.fn().mockResolvedValue({
                        data: [
                            {
                                number: 1,
                                title: 'Issue 1',
                                html_url: 'https://github.com/o/r/issues/1',
                                state: 'open',
                                milestone: { number: 5, title: 'v1.0' },
                                pull_request: undefined,
                            },
                            {
                                number: 2,
                                title: 'PR (should be filtered)',
                                html_url: 'https://github.com/o/r/pull/2',
                                state: 'closed',
                                milestone: null,
                                pull_request: { url: 'https://api.github.com/repos/o/r/pulls/2' },
                            },
                            {
                                number: 3,
                                title: 'Closed Issue',
                                html_url: 'https://github.com/o/r/issues/3',
                                state: 'closed',
                                milestone: null,
                                pull_request: undefined,
                            },
                        ],
                    }),
                },
            } as any
            const result = await issues.getIssues('o', 'r', 'all', 10)
            expect(result).toHaveLength(2)
            expect(result[0]!.state).toBe('OPEN')
            expect(result[0]!.milestone).toEqual({ number: 5, title: 'v1.0' })
            expect(result[1]!.state).toBe('CLOSED')
            expect(result[1]!.milestone).toBeNull()
        })
    })

    describe('getIssue', () => {
        it('should return null when no octokit', async () => {
            await expect(issues.getIssue('o', 'r', 1)).rejects.toThrow()
        })

        it('should return cached issue', async () => {
            const cached = { number: 1, title: 'cached issue' }
            client.setCache('issue:o:r:1', cached)
            client.octokit = {} as any
            const result = await issues.getIssue('o', 'r', 1)
            expect(result).toEqual(cached)
        })

        it('should return null for pull_request', async () => {
            client.octokit = {
                issues: {
                    get: vi.fn().mockResolvedValue({
                        data: { pull_request: { url: 'http://example.com' } },
                    }),
                },
            } as any
            const result = await issues.getIssue('o', 'r', 1)
            expect(result).toBeNull()
        })

        it('should map issue details including labels and assignees', async () => {
            client.octokit = {
                issues: {
                    get: vi.fn().mockResolvedValue({
                        data: {
                            number: 42,
                            title: 'Test issue',
                            html_url: 'https://github.com/o/r/issues/42',
                            state: 'open',
                            body: 'Issue body',
                            labels: [{ name: 'bug' }, 'string-label'],
                            assignees: [{ login: 'alice' }],
                            created_at: '2025-01-01T00:00:00Z',
                            updated_at: '2025-01-02T00:00:00Z',
                            closed_at: null,
                            comments: 3,
                            milestone: null,
                            pull_request: undefined,
                        },
                    }),
                },
            } as any
            const result = await issues.getIssue('o', 'r', 42)
            expect(result).not.toBeNull()
            expect(result!.labels).toEqual(['bug', 'string-label'])
            expect(result!.assignees).toEqual(['alice'])
            expect(result!.body).toBe('<untrusted_remote_content>\nIssue body\n</untrusted_remote_content>')
        })

        it('should handle API error', async () => {
            client.octokit = {
                issues: {
                    get: vi.fn().mockRejectedValue(new Error('Not found')),
                },
            } as any
            await expect(issues.getIssue('o', 'r', 999)).rejects.toThrow()
        })
    })

    describe('createIssue', () => {
        it('should return null when no octokit', async () => {
            await expect(issues.createIssue('o', 'r', 'title')).rejects.toThrow()
        })

        it('should handle API error', async () => {
            client.octokit = {
                issues: {
                    create: vi.fn().mockRejectedValue(new Error('forbidden')),
                },
            } as any
            // Need to set apiCache just so invalidateCache doesn't break
            await expect(issues.createIssue('o', 'r', 'title')).rejects.toThrow()
        })
    })

    describe('closeIssue', () => {
        it('should return null when no octokit', async () => {
            await expect(issues.closeIssue('o', 'r', 1)).rejects.toThrow()
        })

        it('should close without comment', async () => {
            client.octokit = {
                issues: {
                    update: vi.fn().mockResolvedValue({
                        data: { html_url: 'https://github.com/o/r/issues/1' },
                    }),
                    createComment: vi.fn(),
                },
            } as any
            const result = await issues.closeIssue('o', 'r', 1)
            expect(result?.success).toBe(true)
            expect(client.octokit!.issues.createComment).not.toHaveBeenCalled()
        })

        it('should close with comment', async () => {
            client.octokit = {
                issues: {
                    update: vi.fn().mockResolvedValue({
                        data: { html_url: 'https://github.com/o/r/issues/1' },
                    }),
                    createComment: vi.fn().mockResolvedValue({}),
                },
            } as any
            const result = await issues.closeIssue('o', 'r', 1, 'closing comment')
            expect(result?.success).toBe(true)
            expect(client.octokit!.issues.createComment).toHaveBeenCalledWith({
                owner: 'o',
                repo: 'r',
                issue_number: 1,
                body: 'closing comment',
            })
        })

        it('should handle error during close', async () => {
            client.octokit = {
                issues: {
                    update: vi.fn().mockRejectedValue(new Error('fail')),
                },
            } as any
            await expect(issues.closeIssue('o', 'r', 1)).rejects.toThrow()
        })
    })
})

// ============================================================================
// Error Helpers Branch Coverage
// ============================================================================

describe('Error helpers — branch coverage', () => {
    describe('formatZodError', () => {
        it('should format ZodError with path', () => {
            const error = new ZodError([
                {
                    code: ZodIssueCode.invalid_type,
                    expected: 'string' as any,
                    received: 'number' as any,
                    path: ['name'],
                    message: 'Expected string',
                },
            ] as any)
            expect(formatZodError(error)).toBe('name: Expected string')
        })

        it('should format ZodError without path', () => {
            const error = new ZodError([
                {
                    code: ZodIssueCode.invalid_type,
                    expected: 'string' as any,
                    received: 'number' as any,
                    path: [],
                    message: 'Required',
                },
            ] as any)
            expect(formatZodError(error)).toBe('Required')
        })

        it('should join multiple issues', () => {
            const error = new ZodError([
                {
                    code: ZodIssueCode.invalid_type,
                    expected: 'string' as any,
                    received: 'number' as any,
                    path: ['a'],
                    message: 'Bad A',
                },
                {
                    code: ZodIssueCode.invalid_type,
                    expected: 'number' as any,
                    received: 'string' as any,
                    path: ['b'],
                    message: 'Bad B',
                },
            ] as any)
            expect(formatZodError(error)).toBe('a: Bad A; b: Bad B')
        })
    })

    describe('formatHandlerError', () => {
        it('should handle MemoryJournalMcpError', () => {
            const err = new MemoryJournalMcpError('test error', 'TEST_CODE', ErrorCategory.INTERNAL)
            const result = formatHandlerError(err)
            expect(result.success).toBe(false)
            expect(result.code).toBe('TEST_CODE')
        })

        it('should handle ZodError', () => {
            const err = new ZodError([
                {
                    code: ZodIssueCode.invalid_type,
                    expected: 'string' as any,
                    received: 'number' as any,
                    path: ['x'],
                    message: 'bad',
                },
            ] as any)
            const result = formatHandlerError(err)
            expect(result.success).toBe(false)
            expect(result.code).toBe('VALIDATION_ERROR')
            expect(result.category).toBe(ErrorCategory.VALIDATION)
        })

        it('should handle plain Error', () => {
            const result = formatHandlerError(new Error('oops'))
            expect(result.success).toBe(false)
            expect(result.error).toBe('An internal error occurred during tool execution. Please check the server logs for more details.')
            expect(result.code).toBe('INTERNAL_ERROR')
        })

        it('should handle non-Error throw (string)', () => {
            const result = formatHandlerError('string error')
            expect(result.error).toBe('An internal error occurred during tool execution. Please check the server logs for more details.')
            expect(result.code).toBe('INTERNAL_ERROR')
        })
    })
})
