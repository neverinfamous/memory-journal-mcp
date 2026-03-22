/**
 * memory-journal-mcp — Template Resources & GitHub Resources Branch Coverage
 *
 * Targets uncovered branches in:
 * - templates.ts (77.14%): invalid URIs, empty entries, PR timeline branches, kanban diagram types
 * - github.ts resources (66.66%): CI status switch cases, rejected Promise.allSettled, milestone detail
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../src/utils/logger.js', () => ({
    logger: { info: vi.fn(), warning: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

import { getTemplateResourceDefinitions } from '../../src/handlers/resources/templates.js'
import { getGitHubResourceDefinitions } from '../../src/handlers/resources/github.js'

// ============================================================================
// Helpers
// ============================================================================

function createMockDb(overrides: Record<string, unknown> = {}) {
    return {
        searchEntries: vi.fn().mockReturnValue([]),
        searchByDateRange: vi.fn().mockReturnValue([]),
        getRecentEntries: vi.fn().mockReturnValue([]),
        getStatistics: vi.fn().mockReturnValue({ totalEntries: 0 }),
        executeRawQuery: vi.fn().mockReturnValue([]),
        ...overrides,
    }
}

function createMockContext(overrides: Record<string, unknown> = {}) {
    return {
        db: createMockDb(),
        teamDb: null,
        github: null,
        ...overrides,
    }
}

// ============================================================================
// Template Resources Branch Coverage
// ============================================================================

describe('Template resources — branch coverage', () => {
    let resources: ReturnType<typeof getTemplateResourceDefinitions>

    beforeEach(() => {
        vi.clearAllMocks()
        resources = getTemplateResourceDefinitions()
    })

    describe('projects/{number}/timeline', () => {
        it('should return error for invalid project number', () => {
            const resource = resources.find((r) => r.uri === 'memory://projects/{number}/timeline')!
            const result = resource.handler(
                'memory://projects/abc/timeline',
                createMockContext() as never
            ) as Record<string, unknown>
            expect(result.error).toContain('Invalid project number')
        })

        it('should return entries for valid project', () => {
            const resource = resources.find((r) => r.uri === 'memory://projects/{number}/timeline')!
            const result = resource.handler(
                'memory://projects/42/timeline',
                createMockContext() as never
            ) as Record<string, unknown>
            expect(result.projectNumber).toBe(42)
        })
    })

    describe('issues/{issue_number}/entries', () => {
        it('should return error for invalid issue number', () => {
            const resource = resources.find(
                (r) => r.uri === 'memory://issues/{issue_number}/entries'
            )!
            const result = resource.handler(
                'memory://issues/xyz/entries',
                createMockContext() as never
            ) as Record<string, unknown>
            expect(result.error).toContain('Invalid issue number')
        })

        it('should return entries for valid issue', () => {
            const resource = resources.find(
                (r) => r.uri === 'memory://issues/{issue_number}/entries'
            )!
            const result = resource.handler(
                'memory://issues/1/entries',
                createMockContext() as never
            ) as Record<string, unknown>
            expect(result.issueNumber).toBe(1)
        })
    })

    describe('prs/{pr_number}/entries', () => {
        it('should return error for invalid PR number', () => {
            const resource = resources.find((r) => r.uri === 'memory://prs/{pr_number}/entries')!
            const result = resource.handler(
                'memory://prs/bad/entries',
                createMockContext() as never
            ) as Record<string, unknown>
            expect(result.error).toContain('Invalid PR number')
        })

        it('should include hint when no entries', () => {
            const resource = resources.find((r) => r.uri === 'memory://prs/{pr_number}/entries')!
            const result = resource.handler(
                'memory://prs/5/entries',
                createMockContext() as never
            ) as Record<string, unknown>
            expect(result.count).toBe(0)
            expect(result.hint).toContain('No journal entries')
        })
    })

    describe('prs/{pr_number}/timeline', () => {
        it('should return error for invalid PR number', async () => {
            const resource = resources.find((r) => r.uri === 'memory://prs/{pr_number}/timeline')!
            const result = (await resource.handler(
                'memory://prs/x/timeline',
                createMockContext() as never
            )) as Record<string, unknown>
            expect(result.error).toContain('Invalid PR number')
        })

        it('should include unavailable note when no github', async () => {
            const resource = resources.find((r) => r.uri === 'memory://prs/{pr_number}/timeline')!
            const result = (await resource.handler(
                'memory://prs/1/timeline',
                createMockContext() as never
            )) as Record<string, unknown>
            expect(result.timelineNote).toContain('unavailable')
        })

        it('should include PR metadata when github available', async () => {
            const github = {
                getRepoInfo: vi.fn().mockResolvedValue({ owner: 'o', repo: 'r' }),
                getPullRequest: vi.fn().mockResolvedValue({
                    title: 'Test PR',
                    state: 'OPEN',
                    draft: false,
                    mergedAt: null,
                    closedAt: null,
                    author: 'alice',
                    headBranch: 'feature',
                    baseBranch: 'main',
                }),
            }
            const resource = resources.find((r) => r.uri === 'memory://prs/{pr_number}/timeline')!
            const result = (await resource.handler(
                'memory://prs/1/timeline',
                createMockContext({ github }) as never
            )) as Record<string, unknown>
            expect(result.prMetadata).not.toBeNull()
            expect(result.timelineNote).toContain('open')
        })

        it('should handle merged PR metadata', async () => {
            const github = {
                getRepoInfo: vi.fn().mockResolvedValue({ owner: 'o', repo: 'r' }),
                getPullRequest: vi.fn().mockResolvedValue({
                    title: 'Merged PR',
                    state: 'CLOSED',
                    draft: false,
                    mergedAt: '2025-01-10T00:00:00Z',
                    closedAt: '2025-01-10T00:00:00Z',
                    author: 'bob',
                    headBranch: 'fix',
                    baseBranch: 'main',
                }),
            }
            const resource = resources.find((r) => r.uri === 'memory://prs/{pr_number}/timeline')!
            const result = (await resource.handler(
                'memory://prs/2/timeline',
                createMockContext({ github }) as never
            )) as Record<string, unknown>
            expect(result.timelineNote).toContain('merged')
        })

        it('should handle draft PR metadata', async () => {
            const github = {
                getRepoInfo: vi.fn().mockResolvedValue({ owner: 'o', repo: 'r' }),
                getPullRequest: vi.fn().mockResolvedValue({
                    title: 'Draft PR',
                    state: 'OPEN',
                    draft: true,
                    mergedAt: null,
                    closedAt: null,
                    author: 'charlie',
                    headBranch: 'wip',
                    baseBranch: 'main',
                }),
            }
            const resource = resources.find((r) => r.uri === 'memory://prs/{pr_number}/timeline')!
            const result = (await resource.handler(
                'memory://prs/3/timeline',
                createMockContext({ github }) as never
            )) as Record<string, unknown>
            expect(result.timelineNote).toContain('DRAFT')
        })

        it('should handle github error gracefully', async () => {
            const github = {
                getRepoInfo: vi.fn().mockRejectedValue(new Error('fail')),
            }
            const resource = resources.find((r) => r.uri === 'memory://prs/{pr_number}/timeline')!
            const result = (await resource.handler(
                'memory://prs/1/timeline',
                createMockContext({ github }) as never
            )) as Record<string, unknown>
            expect(result.prMetadata).toBeNull()
        })

        it('should handle null PR response', async () => {
            const github = {
                getRepoInfo: vi.fn().mockResolvedValue({ owner: 'o', repo: 'r' }),
                getPullRequest: vi.fn().mockResolvedValue(null),
            }
            const resource = resources.find((r) => r.uri === 'memory://prs/{pr_number}/timeline')!
            const result = (await resource.handler(
                'memory://prs/1/timeline',
                createMockContext({ github }) as never
            )) as Record<string, unknown>
            expect(result.prMetadata).toBeNull()
        })

        it('should handle missing owner in repoInfo', async () => {
            const github = {
                getRepoInfo: vi.fn().mockResolvedValue({ owner: null, repo: null }),
            }
            const resource = resources.find((r) => r.uri === 'memory://prs/{pr_number}/timeline')!
            const result = (await resource.handler(
                'memory://prs/1/timeline',
                createMockContext({ github }) as never
            )) as Record<string, unknown>
            expect(result.prMetadata).toBeNull()
        })
    })

    describe('kanban/{project_number}', () => {
        it('should return error for invalid project number', async () => {
            const resource = resources.find((r) => r.uri === 'memory://kanban/{project_number}')!
            const result = (await resource.handler(
                'memory://kanban/abc',
                createMockContext() as never
            )) as Record<string, unknown>
            expect(result.error).toContain('Invalid project number')
        })

        it('should return error when no github', async () => {
            const resource = resources.find((r) => r.uri === 'memory://kanban/{project_number}')!
            const result = (await resource.handler(
                'memory://kanban/1',
                createMockContext() as never
            )) as Record<string, unknown>
            expect(result.error).toContain('GitHub integration not available')
        })

        it('should return error when no owner', async () => {
            const github = {
                getRepoInfo: vi.fn().mockResolvedValue({ owner: null, repo: null }),
            }
            const resource = resources.find((r) => r.uri === 'memory://kanban/{project_number}')!
            const result = (await resource.handler(
                'memory://kanban/1',
                createMockContext({ github }) as never
            )) as Record<string, unknown>
            expect(result.error).toContain('Could not detect repository owner')
        })

        it('should return error when board not found', async () => {
            const github = {
                getRepoInfo: vi.fn().mockResolvedValue({ owner: 'o', repo: 'r' }),
                getProjectKanban: vi.fn().mockResolvedValue(null),
            }
            const resource = resources.find((r) => r.uri === 'memory://kanban/{project_number}')!
            const result = (await resource.handler(
                'memory://kanban/1',
                createMockContext({ github }) as never
            )) as Record<string, unknown>
            expect(result.error).toContain('not found')
        })
    })

    describe('kanban/{project_number}/diagram', () => {
        it('should return error for invalid project number', async () => {
            const resource = resources.find(
                (r) => r.uri === 'memory://kanban/{project_number}/diagram'
            )!
            const result = (await resource.handler(
                'memory://kanban/bad/diagram',
                createMockContext() as never
            )) as Record<string, unknown>
            expect(result.error).toContain('Invalid project number')
        })

        it('should return no-github mermaid', async () => {
            const resource = resources.find(
                (r) => r.uri === 'memory://kanban/{project_number}/diagram'
            )!
            const result = (await resource.handler(
                'memory://kanban/1/diagram',
                createMockContext() as never
            )) as string
            expect(result).toContain('NoGitHub')
        })

        it('should return no-owner mermaid', async () => {
            const github = {
                getRepoInfo: vi.fn().mockResolvedValue({ owner: null, repo: null }),
            }
            const resource = resources.find(
                (r) => r.uri === 'memory://kanban/{project_number}/diagram'
            )!
            const result = (await resource.handler(
                'memory://kanban/1/diagram',
                createMockContext({ github }) as never
            )) as string
            expect(result).toContain('NoOwner')
        })

        it('should return not-found mermaid', async () => {
            const github = {
                getRepoInfo: vi.fn().mockResolvedValue({ owner: 'o', repo: null }),
                getProjectKanban: vi.fn().mockResolvedValue(null),
            }
            const resource = resources.find(
                (r) => r.uri === 'memory://kanban/{project_number}/diagram'
            )!
            const result = (await resource.handler(
                'memory://kanban/1/diagram',
                createMockContext({ github }) as never
            )) as string
            expect(result).toContain('NotFound')
        })

        it('should render diagram with all item types', async () => {
            const github = {
                getRepoInfo: vi.fn().mockResolvedValue({ owner: 'o', repo: 'r' }),
                getProjectKanban: vi.fn().mockResolvedValue({
                    projectId: 'P1',
                    projectNumber: 1,
                    projectTitle: 'Test Project',
                    columns: [
                        {
                            status: 'In Progress',
                            statusOptionId: 'opt-1',
                            items: [
                                {
                                    id: 'item-abc12345',
                                    title: 'Issue item',
                                    type: 'ISSUE',
                                    number: 10,
                                },
                                {
                                    id: 'item-def67890',
                                    title: 'PR item',
                                    type: 'PULL_REQUEST',
                                    number: 20,
                                },
                                {
                                    id: 'item-ghi99999',
                                    title: 'Draft item',
                                    type: 'DRAFT_ISSUE',
                                    number: 0,
                                },
                            ],
                        },
                    ],
                    totalItems: 3,
                }),
            }
            const resource = resources.find(
                (r) => r.uri === 'memory://kanban/{project_number}/diagram'
            )!
            const result = (await resource.handler(
                'memory://kanban/1/diagram',
                createMockContext({ github }) as never
            )) as string
            expect(result).toContain('🔵')
            expect(result).toContain('🟣')
            expect(result).toContain('⚪')
            expect(result).toContain('#10')
            expect(result).toContain('#20')
        })
    })
})

// ============================================================================
// GitHub Resources Branch Coverage
// ============================================================================

describe('GitHub resources — branch coverage', () => {
    let resources: ReturnType<typeof getGitHubResourceDefinitions>

    beforeEach(() => {
        vi.clearAllMocks()
        resources = getGitHubResourceDefinitions()
    })

    describe('memory://github/status', () => {
        it('should return error when no github', async () => {
            const resource = resources.find((r) => r.uri === 'memory://github/status')!
            const result = (await resource.handler(
                'memory://github/status',
                createMockContext() as never
            )) as Record<string, unknown>
            const data = result.data as Record<string, unknown>
            expect(data.error).toContain('GitHub integration not available')
        })

        it('should handle all rejected Promise.allSettled gracefully', async () => {
            const github = {
                getRepoInfo: vi.fn().mockResolvedValue({ owner: 'o', repo: 'r', branch: 'main' }),
                getRepoContext: vi.fn().mockRejectedValue(new Error('fail')),
                getIssues: vi.fn().mockRejectedValue(new Error('fail')),
                getPullRequests: vi.fn().mockRejectedValue(new Error('fail')),
                getWorkflowRuns: vi.fn().mockRejectedValue(new Error('fail')),
                getProjectKanban: vi.fn().mockRejectedValue(new Error('fail')),
                getMilestones: vi.fn().mockRejectedValue(new Error('fail')),
            }
            const resource = resources.find((r) => r.uri === 'memory://github/status')!
            const result = (await resource.handler(
                'memory://github/status',
                createMockContext({ github }) as never
            )) as Record<string, unknown>
            const data = result.data as Record<string, unknown>
            expect(data.repository).toBe('o/r')
            expect((data.ci as Record<string, unknown>).status).toBe('unknown')
        })

        it('should compute CI status from workflow runs', async () => {
            const github = {
                getRepoInfo: vi.fn().mockResolvedValue({ owner: 'o', repo: 'r', branch: 'main' }),
                getRepoContext: vi.fn().mockResolvedValue({ commit: 'abc1234567', branch: 'main' }),
                getIssues: vi.fn().mockResolvedValue([]),
                getPullRequests: vi.fn().mockResolvedValue([]),
                getWorkflowRuns: vi.fn().mockResolvedValue([
                    {
                        id: 1,
                        name: 'CI',
                        status: 'completed',
                        conclusion: 'failure',
                        headSha: 'abc1234',
                        headBranch: 'main',
                        url: '',
                        createdAt: '',
                    },
                ]),
                getProjectKanban: vi.fn().mockResolvedValue(null),
                getMilestones: vi.fn().mockResolvedValue([]),
            }
            const resource = resources.find((r) => r.uri === 'memory://github/status')!
            const result = (await resource.handler(
                'memory://github/status',
                createMockContext({ github }) as never
            )) as Record<string, unknown>
            const data = result.data as Record<string, unknown>
            expect((data.ci as Record<string, unknown>).status).toBe('failing')
        })

        it('should show pending CI status', async () => {
            const github = {
                getRepoInfo: vi.fn().mockResolvedValue({ owner: 'o', repo: 'r', branch: 'main' }),
                getRepoContext: vi.fn().mockResolvedValue({ commit: null }),
                getIssues: vi.fn().mockResolvedValue([]),
                getPullRequests: vi.fn().mockResolvedValue([]),
                getWorkflowRuns: vi.fn().mockResolvedValue([
                    {
                        id: 1,
                        name: 'CI',
                        status: 'in_progress',
                        conclusion: null,
                        headSha: 'abc1234',
                        headBranch: 'main',
                        url: '',
                        createdAt: '',
                    },
                ]),
                getProjectKanban: vi.fn().mockResolvedValue(null),
                getMilestones: vi.fn().mockResolvedValue([]),
            }
            const resource = resources.find((r) => r.uri === 'memory://github/status')!
            const result = (await resource.handler(
                'memory://github/status',
                createMockContext({ github }) as never
            )) as Record<string, unknown>
            const data = result.data as Record<string, unknown>
            expect((data.ci as Record<string, unknown>).status).toBe('pending')
        })

        it('should show cancelled CI status', async () => {
            const github = {
                getRepoInfo: vi.fn().mockResolvedValue({ owner: 'o', repo: 'r', branch: null }),
                getRepoContext: vi.fn().mockResolvedValue({ commit: null }),
                getIssues: vi.fn().mockResolvedValue([]),
                getPullRequests: vi.fn().mockResolvedValue([]),
                getWorkflowRuns: vi.fn().mockResolvedValue([
                    {
                        id: 1,
                        name: 'CI',
                        status: 'completed',
                        conclusion: 'cancelled',
                        headSha: 'abc1234',
                        headBranch: 'main',
                        url: '',
                        createdAt: '',
                    },
                ]),
                getProjectKanban: vi.fn().mockResolvedValue(null),
                getMilestones: vi.fn().mockResolvedValue([]),
            }
            const resource = resources.find((r) => r.uri === 'memory://github/status')!
            const result = (await resource.handler(
                'memory://github/status',
                createMockContext({ github }) as never
            )) as Record<string, unknown>
            const data = result.data as Record<string, unknown>
            expect((data.ci as Record<string, unknown>).status).toBe('cancelled')
        })

        it('should include kanbanSummary when board available', async () => {
            const github = {
                getRepoInfo: vi.fn().mockResolvedValue({ owner: 'o', repo: 'r', branch: 'main' }),
                getRepoContext: vi.fn().mockResolvedValue({ commit: null }),
                getIssues: vi.fn().mockResolvedValue([]),
                getPullRequests: vi.fn().mockResolvedValue([]),
                getWorkflowRuns: vi.fn().mockResolvedValue([]),
                getProjectKanban: vi.fn().mockResolvedValue({
                    columns: [
                        { status: 'Todo', items: [1, 2] },
                        { status: 'Done', items: [3] },
                    ],
                }),
                getMilestones: vi.fn().mockResolvedValue([]),
            }
            const resource = resources.find((r) => r.uri === 'memory://github/status')!
            const result = (await resource.handler(
                'memory://github/status',
                createMockContext({
                    github,
                    briefingConfig: {
                        entryCount: 3,
                        includeTeam: false,
                        issueCount: 0,
                        prCount: 0,
                        prStatusBreakdown: false,
                        workflowCount: 0,
                        workflowStatusBreakdown: false,
                        copilotReviews: false,
                        defaultProjectNumber: 1,
                    },
                }) as never
            )) as Record<string, unknown>
            const data = result.data as Record<string, unknown>
            const kanban = data.kanbanSummary as Record<string, number>
            expect(kanban['Todo']).toBe(2)
            expect(kanban['Done']).toBe(1)
        })

        it('should include milestoneSummary when milestones available', async () => {
            const github = {
                getRepoInfo: vi.fn().mockResolvedValue({ owner: 'o', repo: 'r', branch: 'main' }),
                getRepoContext: vi.fn().mockResolvedValue({ commit: null }),
                getIssues: vi.fn().mockResolvedValue([]),
                getPullRequests: vi.fn().mockResolvedValue([]),
                getWorkflowRuns: vi.fn().mockResolvedValue([]),
                getProjectKanban: vi.fn().mockResolvedValue(null),
                getMilestones: vi.fn().mockResolvedValue([
                    {
                        number: 1,
                        title: 'v1.0',
                        state: 'open',
                        openIssues: 3,
                        closedIssues: 7,
                        dueOn: '2025-06-01',
                    },
                ]),
            }
            const resource = resources.find((r) => r.uri === 'memory://github/status')!
            const result = (await resource.handler(
                'memory://github/status',
                createMockContext({ github }) as never
            )) as Record<string, unknown>
            const data = result.data as Record<string, unknown>
            const milestones = data.milestones as { completionPercentage: number }[]
            expect(milestones[0]!.completionPercentage).toBe(70)
        })
    })

    describe('memory://github/insights', () => {
        it('should handle traffic data unavailable', async () => {
            const github = {
                getRepoInfo: vi.fn().mockResolvedValue({ owner: 'o', repo: 'r', branch: 'main' }),
                getRepoStats: vi.fn().mockResolvedValue({ stars: 100, forks: 10, watchers: 5 }),
                getTrafficData: vi.fn().mockRejectedValue(new Error('no push access')),
            }
            const resource = resources.find((r) => r.uri === 'memory://github/insights')!
            const result = (await resource.handler(
                'memory://github/insights',
                createMockContext({ github }) as never
            )) as Record<string, unknown>
            const data = result.data as Record<string, unknown>
            expect(data.stars).toBe(100)
            expect(data.hint).toContain('push access')
        })

        it('should include traffic data when available', async () => {
            const github = {
                getRepoInfo: vi.fn().mockResolvedValue({ owner: 'o', repo: 'r', branch: 'main' }),
                getRepoStats: vi.fn().mockResolvedValue(null),
                getTrafficData: vi.fn().mockResolvedValue({
                    clones: { total: 50 },
                    views: { total: 200 },
                }),
            }
            const resource = resources.find((r) => r.uri === 'memory://github/insights')!
            const result = (await resource.handler(
                'memory://github/insights',
                createMockContext({ github }) as never
            )) as Record<string, unknown>
            const data = result.data as Record<string, unknown>
            expect(data.clones14d).toBe(50)
            expect(data.views14d).toBe(200)
        })
    })

    describe('memory://milestones/{number}', () => {
        it('should return error for invalid milestone number', async () => {
            const resource = resources.find((r) => r.uri === 'memory://milestones/{number}')!
            const result = (await resource.handler(
                'memory://milestones/bad',
                createMockContext() as never
            )) as Record<string, unknown>
            const data = result.data as Record<string, unknown>
            expect(data.error).toContain('Invalid milestone number')
        })

        it('should return not-found for missing milestone', async () => {
            const github = {
                getRepoInfo: vi.fn().mockResolvedValue({ owner: 'o', repo: 'r', branch: 'main' }),
                getMilestone: vi.fn().mockResolvedValue(null),
            }
            const resource = resources.find((r) => r.uri === 'memory://milestones/{number}')!
            const result = (await resource.handler(
                'memory://milestones/99',
                createMockContext({ github }) as never
            )) as Record<string, unknown>
            const data = result.data as Record<string, unknown>
            expect(data.error).toContain('not found')
        })

        it('should return milestone with completion percentage', async () => {
            const github = {
                getRepoInfo: vi.fn().mockResolvedValue({ owner: 'o', repo: 'r', branch: 'main' }),
                getMilestone: vi.fn().mockResolvedValue({
                    number: 1,
                    title: 'v1.0',
                    openIssues: 2,
                    closedIssues: 8,
                }),
            }
            const resource = resources.find((r) => r.uri === 'memory://milestones/{number}')!
            const result = (await resource.handler(
                'memory://milestones/1',
                createMockContext({ github }) as never
            )) as Record<string, unknown>
            const data = result.data as Record<string, unknown>
            const ms = data.milestone as Record<string, unknown>
            expect(ms.completionPercentage).toBe(80)
        })
    })
})
