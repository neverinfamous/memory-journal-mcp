/**
 * GitHub Resource Handler Tests
 *
 * Tests GitHub-dependent resources using a mock GitHubIntegration object.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { readResource } from '../../src/handlers/resources/index.js'
import { DatabaseAdapter } from '../../src/database/sqlite-adapter/index.js'
import type { GitHubIntegration } from '../../src/github/github-integration.js'

/**
 * Creates a minimal mock GitHubIntegration with sensible defaults.
 */
function createMockGitHub(overrides: Partial<Record<string, unknown>> = {}): GitHubIntegration {
    const mock = {
        isApiAvailable: vi.fn().mockReturnValue(true),
        getRepoInfo: vi.fn().mockResolvedValue({
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
                { number: 1, title: 'Bug fix needed', url: 'url1', state: 'OPEN', milestone: null },
            ]),
        getPullRequests: vi
            .fn()
            .mockResolvedValue([{ number: 10, title: 'Feature PR', url: 'url10', state: 'OPEN' }]),
        getWorkflowRuns: vi.fn().mockResolvedValue([
            {
                id: 100,
                name: 'CI',
                status: 'completed',
                conclusion: 'success',
                url: 'url',
                headBranch: 'main',
                headSha: 'abc1234',
                createdAt: '2025-01-01T00:00:00Z',
                updatedAt: '2025-01-01T01:00:00Z',
            },
        ]),
        getProjectKanban: vi.fn().mockResolvedValue(null),
        getMilestones: vi.fn().mockResolvedValue([
            {
                number: 1,
                title: 'v1.0',
                description: 'First release',
                state: 'open',
                url: 'url',
                dueOn: '2025-06-01T00:00:00Z',
                openIssues: 5,
                closedIssues: 10,
                createdAt: '2025-01-01T00:00:00Z',
                updatedAt: '2025-01-02T00:00:00Z',
                creator: 'owner1',
            },
        ]),
        getMilestone: vi.fn().mockResolvedValue({
            number: 1,
            title: 'v1.0',
            description: 'First release',
            state: 'open',
            url: 'url',
            dueOn: '2025-06-01T00:00:00Z',
            openIssues: 5,
            closedIssues: 10,
            createdAt: '2025-01-01T00:00:00Z',
            updatedAt: '2025-01-02T00:00:00Z',
            creator: 'owner1',
        }),
        getCachedRepoInfo: vi.fn().mockReturnValue({
            owner: 'testowner',
            repo: 'testrepo',
            branch: 'main',
            remoteUrl: 'git@github.com:testowner/testrepo.git',
        }),
        getRepoStats: vi.fn().mockResolvedValue({
            stars: 42,
            forks: 7,
            watchers: 3,
        }),
        getTrafficData: vi.fn().mockResolvedValue({
            clones: { total: 120, uniqueCloners: 30 },
            views: { total: 500, uniqueVisitors: 80 },
        }),
        ...overrides,
    }
    return mock as unknown as GitHubIntegration
}

describe('GitHub Resource Handlers', () => {
    let db: DatabaseAdapter
    const testDbPath = './test-gh-resources.db'

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
            // Ignore cleanup errors
        }
    })

    // ========================================================================
    // memory://github/status
    // ========================================================================

    describe('memory://github/status', () => {
        it('should return status with repo info, CI, issues, PRs', async () => {
            const github = createMockGitHub()
            const result = await readResource(
                'memory://github/status',
                db,
                undefined,
                undefined,
                github
            )

            const data = result.data as {
                repository: string
                branch: string
                ci: { status: string }
                issues: { openCount: number }
                pullRequests: { openCount: number }
            }

            expect(data.repository).toBe('testowner/testrepo')
            expect(data.branch).toBe('main')
            expect(data.ci.status).toBe('passing')
            expect(data.issues.openCount).toBe(1)
            expect(data.pullRequests.openCount).toBe(1)
        })

        it('should return error when no github integration', async () => {
            const result = await readResource(
                'memory://github/status',
                db,
                undefined,
                undefined,
                null
            )

            const data = result.data as { error: string; hint: string }
            expect(data.error).toContain('GitHub integration not available')
        })

        it('should handle missing owner/repo', async () => {
            const github = createMockGitHub({
                getRepoInfo: vi.fn().mockResolvedValue({
                    owner: null,
                    repo: null,
                    branch: 'main',
                    remoteUrl: null,
                }),
            })

            const result = await readResource(
                'memory://github/status',
                db,
                undefined,
                undefined,
                github
            )

            const data = result.data as { error: string }
            expect(data.error).toContain('Could not detect repository')
        })
    })

    // ========================================================================
    // memory://github/milestones
    // ========================================================================

    describe('memory://github/milestones', () => {
        it('should return milestones with completion percentages', async () => {
            const github = createMockGitHub()
            const result = await readResource(
                'memory://github/milestones',
                db,
                undefined,
                undefined,
                github
            )

            const data = result.data as {
                repository: string
                milestones: { completionPercentage: number }[]
                count: number
            }

            expect(data.repository).toBe('testowner/testrepo')
            expect(data.count).toBe(1)
            // 10 closed / (5 open + 10 closed) = 66.67% => 67%
            expect(data.milestones[0]!.completionPercentage).toBe(67)
        })

        it('should return error when no github', async () => {
            const result = await readResource(
                'memory://github/milestones',
                db,
                undefined,
                undefined,
                null
            )

            const data = result.data as { error: string }
            expect(data.error).toContain('GitHub integration not available')
        })
    })

    // ========================================================================
    // memory://milestones/{number}
    // ========================================================================

    describe('memory://milestones/{number}', () => {
        it('should return single milestone detail', async () => {
            const github = createMockGitHub()
            const result = await readResource(
                'memory://milestones/1',
                db,
                undefined,
                undefined,
                github
            )

            const data = result.data as {
                repository: string
                milestone: { number: number; completionPercentage: number }
            }

            expect(data.repository).toBe('testowner/testrepo')
            expect(data.milestone.number).toBe(1)
            expect(data.milestone.completionPercentage).toBe(67)
        })

        it('should return error for not found milestone', async () => {
            const github = createMockGitHub({
                getMilestone: vi.fn().mockResolvedValue(null),
            })
            const result = await readResource(
                'memory://milestones/999',
                db,
                undefined,
                undefined,
                github
            )

            const data = result.data as { error: string }
            expect(data.error).toContain('not found')
        })
    })

    // ========================================================================
    // memory://kanban/{project_number}
    // ========================================================================

    describe('memory://kanban/{project_number}', () => {
        it('should return kanban board when available', async () => {
            const github = createMockGitHub({
                getProjectKanban: vi.fn().mockResolvedValue({
                    projectId: 'PVT_1',
                    projectTitle: 'My Board',
                    columns: [
                        {
                            status: 'Todo',
                            items: [{ id: 'I1', type: 'ISSUE', title: 'Task', number: 1 }],
                        },
                    ],
                    statusOptions: [],
                    totalItems: 1,
                }),
            })

            const result = await readResource('memory://kanban/1', db, undefined, undefined, github)

            const data = result.data as { projectTitle: string; totalItems: number }
            expect(data.projectTitle).toBe('My Board')
            expect(data.totalItems).toBe(1)
        })

        it('should return error when project not found', async () => {
            const github = createMockGitHub()
            const result = await readResource(
                'memory://kanban/999',
                db,
                undefined,
                undefined,
                github
            )

            const data = result.data as { error: string }
            expect(data.error).toContain('not found')
        })

        it('should return error when no github', async () => {
            const result = await readResource('memory://kanban/1', db, undefined, undefined, null)

            const data = result.data as { error: string }
            expect(data.error).toContain('GitHub integration not available')
        })
    })

    // ========================================================================
    // memory://kanban/{project_number}/diagram
    // ========================================================================

    describe('memory://kanban/{project_number}/diagram', () => {
        it('should return mermaid diagram', async () => {
            const github = createMockGitHub({
                getProjectKanban: vi.fn().mockResolvedValue({
                    projectId: 'PVT_1',
                    projectTitle: 'Board',
                    columns: [
                        {
                            status: 'Done',
                            items: [
                                {
                                    id: 'PVTITEM_A1B2C3D4',
                                    type: 'ISSUE',
                                    title: 'Completed task',
                                    number: 5,
                                },
                            ],
                        },
                    ],
                    statusOptions: [],
                    totalItems: 1,
                }),
            })

            const result = await readResource(
                'memory://kanban/1/diagram',
                db,
                undefined,
                undefined,
                github
            )

            const data = result.data as string

            expect(typeof data).toBe('string')
            expect(data).toContain('graph LR')
            expect(data).toContain('Done')
        })

        it('should show fallback when no github', async () => {
            const result = await readResource(
                'memory://kanban/1/diagram',
                db,
                undefined,
                undefined,
                null
            )

            expect(typeof result.data).toBe('string')
            expect(result.data as string).toContain('NoGitHub')
        })
    })

    // ========================================================================
    // memory://briefing with GitHub insights
    // ========================================================================

    describe('memory://briefing with GitHub', () => {
        it('should include insights with stars, forks, and traffic', async () => {
            const github = createMockGitHub()
            const result = await readResource('memory://briefing', db, undefined, undefined, github)

            const data = result.data as {
                github: {
                    repo: string
                    insights?: {
                        stars: number | null
                        forks: number | null
                        clones14d?: number
                        views14d?: number
                    }
                }
                userMessage: string
            }

            expect(data.github.repo).toBe('testowner/testrepo')
            expect(data.github.insights).toBeDefined()
            expect(data.github.insights!.stars).toBe(42)
            expect(data.github.insights!.forks).toBe(7)
            expect(data.github.insights!.clones14d).toBe(120)
            expect(data.github.insights!.views14d).toBe(500)
            expect(data.userMessage).toContain('stars')
            expect(data.userMessage).toContain('forks')
            expect(data.userMessage).toContain('clones')
        })

        it('should include insights without traffic when getTrafficData fails', async () => {
            const github = createMockGitHub({
                getTrafficData: vi.fn().mockRejectedValue(new Error('403 Forbidden')),
            })
            const result = await readResource('memory://briefing', db, undefined, undefined, github)

            const data = result.data as {
                github: {
                    insights?: {
                        stars: number | null
                        forks: number | null
                        clones14d?: number
                        views14d?: number
                    }
                }
                userMessage: string
            }

            // Stars and forks should still be present
            expect(data.github.insights).toBeDefined()
            expect(data.github.insights!.stars).toBe(42)
            expect(data.github.insights!.forks).toBe(7)
            // Traffic should be absent
            expect(data.github.insights!.clones14d).toBeUndefined()
            expect(data.github.insights!.views14d).toBeUndefined()
        })

        it('should omit insights when getRepoStats fails', async () => {
            const github = createMockGitHub({
                getRepoStats: vi.fn().mockRejectedValue(new Error('API error')),
            })
            const result = await readResource('memory://briefing', db, undefined, undefined, github)

            const data = result.data as {
                github: {
                    insights?: unknown
                }
            }

            expect(data.github.insights).toBeUndefined()
        })

        it('should include repoInsights in more section', async () => {
            const github = createMockGitHub()
            const result = await readResource('memory://briefing', db, undefined, undefined, github)

            const data = result.data as {
                more: { repoInsights: string }
            }

            expect(data.more.repoInsights).toBe('memory://github/insights')
        })
    })

    // ========================================================================
    // memory://github/insights
    // ========================================================================

    describe('memory://github/insights', () => {
        it('should return insights with stars and traffic', async () => {
            const github = createMockGitHub()
            const result = await readResource(
                'memory://github/insights',
                db,
                undefined,
                undefined,
                github
            )

            const data = result.data as {
                repository: string
                stars: number
                forks: number
                clones14d?: number
                views14d?: number
            }

            expect(data.repository).toBe('testowner/testrepo')
            expect(data.stars).toBe(42)
            expect(data.forks).toBe(7)
            expect(data.clones14d).toBe(120)
            expect(data.views14d).toBe(500)
        })

        it('should return error when no github', async () => {
            const result = await readResource(
                'memory://github/insights',
                db,
                undefined,
                undefined,
                null
            )

            const data = result.data as { error: string }
            expect(data.error).toContain('GitHub integration not available')
        })

        it('should return error when no owner/repo', async () => {
            const github = createMockGitHub({
                getRepoInfo: vi.fn().mockResolvedValue({ owner: null, repo: null, branch: null }),
            })

            const result = await readResource(
                'memory://github/insights',
                db,
                undefined,
                undefined,
                github
            )

            const data = result.data as { error: string }
            expect(data.error).toContain('Could not detect repository')
        })

        it('should handle traffic data failure gracefully', async () => {
            const github = createMockGitHub({
                getTrafficData: vi.fn().mockRejectedValue(new Error('403')),
            })

            const result = await readResource(
                'memory://github/insights',
                db,
                undefined,
                undefined,
                github
            )

            const data = result.data as {
                stars: number
                hint?: string
            }

            expect(data.stars).toBe(42)
            expect(data.hint).toBeDefined()
        })
    })

    // ========================================================================
    // memory://graph/actions
    // ========================================================================

    describe('memory://graph/actions', () => {
        it('should return mermaid diagram with workflow runs', async () => {
            const github = createMockGitHub()
            const result = await readResource(
                'memory://graph/actions',
                db,
                undefined,
                undefined,
                github
            )

            const data = result.data as string

            expect(typeof data).toBe('string')
            expect(data).toContain('graph LR')
        })

        it('should return fallback when no github', async () => {
            const result = await readResource(
                'memory://graph/actions',
                db,
                undefined,
                undefined,
                null
            )

            expect(typeof result.data).toBe('string')
            expect(result.data as string).toContain('NoGitHub')
        })

        it('should return fallback when no repo detected', async () => {
            const github = createMockGitHub({
                getRepoInfo: vi.fn().mockResolvedValue({ owner: null, repo: null, branch: null }),
            })

            const result = await readResource(
                'memory://graph/actions',
                db,
                undefined,
                undefined,
                github
            )

            expect(typeof result.data).toBe('string')
            expect(result.data as string).toContain('NoRepo')
        })

        it('should return fallback when no workflow runs', async () => {
            const github = createMockGitHub({
                getWorkflowRuns: vi.fn().mockResolvedValue([]),
            })

            const result = await readResource(
                'memory://graph/actions',
                db,
                undefined,
                undefined,
                github
            )

            expect(typeof result.data).toBe('string')
            expect(result.data as string).toContain('NoRuns')
        })
    })

    // ========================================================================
    // memory://actions/recent
    // ========================================================================

    describe('memory://actions/recent', () => {
        it('should return entries from GitHub API when available', async () => {
            const github = createMockGitHub()
            const result = await readResource(
                'memory://actions/recent',
                db,
                undefined,
                undefined,
                github
            )

            const data = result.data as {
                entries: unknown[]
                count: number
                source: string
            }

            expect(data.source).toBe('github_api')
            expect(data.count).toBe(1)
        })

        it('should fallback to database when no github', async () => {
            const result = await readResource(
                'memory://actions/recent',
                db,
                undefined,
                undefined,
                null
            )

            const data = result.data as { source: string }
            expect(data.source).toBe('database')
        })

        it('should fallback to database when github API fails', async () => {
            const github = createMockGitHub({
                getRepoInfo: vi.fn().mockRejectedValue(new Error('API error')),
            })

            const result = await readResource(
                'memory://actions/recent',
                db,
                undefined,
                undefined,
                github
            )

            const data = result.data as { source: string }
            expect(data.source).toBe('database')
        })
    })

    // ========================================================================
    // memory://prs/{n}/timeline
    // ========================================================================

    describe('memory://prs/{n}/timeline', () => {
        it('should return timeline with PR metadata from GitHub', async () => {
            const github = createMockGitHub({
                getPullRequest: vi.fn().mockResolvedValue({
                    number: 10,
                    title: 'Feature PR',
                    state: 'open',
                    draft: false,
                    mergedAt: null,
                    closedAt: null,
                    author: 'dev1',
                    headBranch: 'feature',
                    baseBranch: 'main',
                }),
            })

            const result = await readResource(
                'memory://prs/10/timeline',
                db,
                undefined,
                undefined,
                github
            )

            const data = result.data as {
                prNumber: number
                prMetadata: { title: string; state: string }
                timelineNote: string
            }

            expect(data.prNumber).toBe(10)
            expect(data.prMetadata).toBeDefined()
            expect(data.prMetadata.title).toBe('Feature PR')
            expect(data.timelineNote).toContain('open')
        })

        it('should return timeline without PR metadata when no github', async () => {
            const result = await readResource(
                'memory://prs/10/timeline',
                db,
                undefined,
                undefined,
                null
            )

            const data = result.data as {
                prNumber: number
                prMetadata: unknown
                timelineNote: string
            }

            expect(data.prNumber).toBe(10)
            expect(data.prMetadata).toBeNull()
            expect(data.timelineNote).toContain('unavailable')
        })

        it('should return error for invalid PR number', async () => {
            const result = await readResource(
                'memory://prs/abc/timeline',
                db,
                undefined,
                undefined,
                null
            )

            const data = result.data as { error: string }
            expect(data.error).toContain('Invalid PR number')
        })
    })

    // ========================================================================
    // memory://health
    // ========================================================================

    describe('memory://health', () => {
        it('should return health status with vector and scheduler info', async () => {
            const mockVectorManager = {
                getStats: vi.fn().mockReturnValue({
                    itemCount: 50,
                    modelName: 'test-model',
                    dimensions: 384,
                }),
            }
            const mockScheduler = {
                getStatus: vi.fn().mockReturnValue({
                    active: true,
                    jobs: [{ name: 'backup', intervalMinutes: 60 }],
                }),
            }

            const result = await readResource(
                'memory://health',
                db,
                mockVectorManager as any,
                null,
                null,
                mockScheduler as any
            )

            const data = result.data as {
                vectorIndex: { available: boolean; itemCount: number }
                scheduler: { active: boolean }
                toolFilter: { active: boolean }
            }

            expect(data.vectorIndex).toBeDefined()
            expect(data.vectorIndex.available).toBe(true)
            expect(data.vectorIndex.itemCount).toBe(50)
            expect(data.scheduler.active).toBe(true)
            expect(data.toolFilter.active).toBe(false) // filterConfig is null
        })

        it('should handle vector manager error gracefully', async () => {
            const mockVectorManager = {
                getStats: vi.fn().mockImplementation(() => {
                    throw new Error('Not initialized')
                }),
            }

            const result = await readResource(
                'memory://health',
                db,
                mockVectorManager as any,
                null,
                null,
                null
            )

            const data = result.data as {
                vectorIndex: { available: boolean }
            }

            expect(data.vectorIndex.available).toBe(false)
        })
    })

    // ========================================================================
    // memory://github/status CI edge cases
    // ========================================================================

    describe('memory://github/status CI edge cases', () => {
        it('should report failing CI when latest completed run failed', async () => {
            const github = createMockGitHub({
                getWorkflowRuns: vi.fn().mockResolvedValue([
                    {
                        id: 200,
                        name: 'CI',
                        status: 'completed',
                        conclusion: 'failure',
                        url: 'url',
                        headBranch: 'main',
                        headSha: 'def5678',
                        createdAt: '2025-01-02T00:00:00Z',
                        updatedAt: '2025-01-02T01:00:00Z',
                    },
                ]),
            })

            const result = await readResource(
                'memory://github/status',
                db,
                undefined,
                undefined,
                github
            )

            const data = result.data as {
                ci: { status: string }
            }

            expect(data.ci.status).toBe('failing')
        })

        it('should report pending CI when runs are in progress', async () => {
            const github = createMockGitHub({
                getWorkflowRuns: vi.fn().mockResolvedValue([
                    {
                        id: 300,
                        name: 'CI',
                        status: 'in_progress',
                        conclusion: null,
                        url: 'url',
                        headBranch: 'main',
                        headSha: 'ghi9012',
                        createdAt: '2025-01-03T00:00:00Z',
                        updatedAt: '2025-01-03T00:30:00Z',
                    },
                ]),
            })

            const result = await readResource(
                'memory://github/status',
                db,
                undefined,
                undefined,
                github
            )

            const data = result.data as {
                ci: { status: string }
            }

            expect(data.ci.status).toBe('pending')
        })

        it('should include kanban summary and milestones in status', async () => {
            const github = createMockGitHub({
                getProjectKanban: vi.fn().mockResolvedValue({
                    projectId: 'PVT_1',
                    columns: [
                        { status: 'Todo', items: [{ id: 'I1' }, { id: 'I2' }] },
                        { status: 'Done', items: [{ id: 'I3' }] },
                    ],
                    statusOptions: [],
                    totalItems: 3,
                }),
            })

            const result = await readResource(
                'memory://github/status',
                db,
                undefined,
                undefined,
                github,
                undefined,
                undefined,
                { entryCount: 3, includeTeam: false, issueCount: 0, prCount: 0, prStatusBreakdown: false, workflowCount: 0, workflowStatusBreakdown: false, copilotReviews: false, defaultProjectNumber: 1 }
            )

            const data = result.data as {
                kanbanSummary: Record<string, number> | null
                milestones: unknown[] | null
            }

            expect(data.kanbanSummary).toBeDefined()
            expect(data.kanbanSummary!['Todo']).toBe(2)
            expect(data.kanbanSummary!['Done']).toBe(1)
            expect(data.milestones).toBeDefined()
        })
    })
})
