/**
 * memory-journal-mcp — GitHub Managers (Projects, PRs, Repository, Milestones) Branch Coverage
 *
 * Targets uncovered branches in:
 * - projects.ts (71.42%): user→repo→org fallback, no statusField, unknown status, null content
 * - pull-requests.ts (72.05%): PR state mapping, copilot review states, cache hits, error paths
 * - repository.ts (74.28%): parseRemoteUrl (SSH, HTTPS, invalid), workflow runs branches
 * - milestones.ts (76.66%): cache hits, CRUD error paths, null description/dueOn/creator
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

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
    simpleGit: vi.fn().mockReturnValue({
        branch: vi.fn(),
        getRemotes: vi.fn(),
    }),
}))

import { GitHubClient } from '../../src/github/github-integration/client.js'
import { ProjectsManager } from '../../src/github/github-integration/projects.js'
import { PullRequestsManager } from '../../src/github/github-integration/pull-requests.js'
import { RepositoryManager } from '../../src/github/github-integration/repository.js'
import { MilestonesManager } from '../../src/github/github-integration/milestones.js'

// ============================================================================
// ProjectsManager Branch Coverage
// ============================================================================

describe('ProjectsManager — branch coverage', () => {
    let client: GitHubClient
    let projects: ProjectsManager

    beforeEach(() => {
        vi.clearAllMocks()
        delete process.env['GITHUB_TOKEN']
        client = new GitHubClient('.')
        projects = new ProjectsManager(client)
    })

    describe('getProjectKanban', () => {
        it('should return null when no graphqlWithAuth', async () => {
            const result = await projects.getProjectKanban('owner', 1)
            expect(result).toBeNull()
        })

        it('should fallback to repo query when user query throws', async () => {
            const projectData = {
                id: 'P1',
                title: 'Test Project',
                fields: {
                    nodes: [
                        { id: 'SF1', name: 'Status', options: [{ id: 'opt1', name: 'Todo', color: 'green' }] },
                    ],
                },
                items: { nodes: [] },
            }

            let callCount = 0
            client.graphqlWithAuth = vi.fn().mockImplementation(async () => {
                callCount++
                if (callCount === 1) throw new Error('User not found')
                return { repository: { projectV2: projectData } }
            })

            const result = await projects.getProjectKanban('owner', 1, 'repo')
            expect(result).not.toBeNull()
            expect(result!.projectTitle).toBe('Test Project')
        })

        it('should fallback to org query when both user and repo fail', async () => {
            const projectData = {
                id: 'P1',
                title: 'Org Project',
                fields: {
                    nodes: [
                        { id: 'SF1', name: 'Status', options: [{ id: 'opt1', name: 'Backlog' }] },
                    ],
                },
                items: { nodes: [] },
            }

            let callCount = 0
            client.graphqlWithAuth = vi.fn().mockImplementation(async () => {
                callCount++
                if (callCount === 1) throw new Error('User not found')
                if (callCount === 2) throw new Error('Repo not found')
                return { organization: { projectV2: projectData } }
            })

            const result = await projects.getProjectKanban('owner', 1, 'repo')
            expect(result).not.toBeNull()
            expect(result!.projectTitle).toBe('Org Project')
        })

        it('should return null when all sources fail', async () => {
            client.graphqlWithAuth = vi.fn().mockRejectedValue(new Error('fail'))
            const result = await projects.getProjectKanban('owner', 1)
            expect(result).toBeNull()
        })

        it('should return null when no Status field', async () => {
            client.graphqlWithAuth = vi.fn().mockResolvedValue({
                user: {
                    projectV2: {
                        id: 'P1',
                        title: 'No Status',
                        fields: { nodes: [{ name: 'Priority' }] },
                        items: { nodes: [] },
                    },
                },
            })
            const result = await projects.getProjectKanban('owner', 1)
            expect(result).toBeNull()
        })

        it('should handle items with null content (Draft Issues)', async () => {
            client.graphqlWithAuth = vi.fn().mockResolvedValue({
                user: {
                    projectV2: {
                        id: 'P1',
                        title: 'Test',
                        fields: {
                            nodes: [
                                { id: 'SF1', name: 'Status', options: [{ id: 'opt1', name: 'Todo' }] },
                            ],
                        },
                        items: {
                            nodes: [
                                {
                                    id: 'item1',
                                    type: 'DRAFT_ISSUE',
                                    createdAt: '2025-01-01',
                                    updatedAt: '2025-01-01',
                                    fieldValues: { nodes: [{ name: 'Todo', field: { name: 'Status' } }] },
                                    content: null,
                                },
                            ],
                        },
                    },
                },
            })
            const result = await projects.getProjectKanban('owner', 1)
            expect(result).not.toBeNull()
            expect(result!.columns[0]!.items[0]!.title).toBe('Draft Issue')
        })

        it('should put items with unknown status into No Status column', async () => {
            client.graphqlWithAuth = vi.fn().mockResolvedValue({
                user: {
                    projectV2: {
                        id: 'P1',
                        title: 'Test',
                        fields: {
                            nodes: [
                                { id: 'SF1', name: 'Status', options: [{ id: 'opt1', name: 'Todo' }] },
                            ],
                        },
                        items: {
                            nodes: [
                                {
                                    id: 'item1',
                                    type: 'ISSUE',
                                    createdAt: '2025-01-01',
                                    updatedAt: '2025-01-01',
                                    fieldValues: { nodes: [{ name: 'Unknown Column', field: { name: 'Status' } }] },
                                    content: { number: 1, title: 'Orphan', url: 'http://test', labels: { nodes: [] }, assignees: { nodes: [] } },
                                },
                            ],
                        },
                    },
                },
            })
            const result = await projects.getProjectKanban('owner', 1)
            expect(result).not.toBeNull()
            // The "No Status" column should exist and contain the orphan item
            const noStatus = result!.columns.find((c) => c.status === 'No Status')
            expect(noStatus).toBeDefined()
            expect(noStatus!.items.length).toBe(1)
        })
    })

    describe('moveProjectItem', () => {
        it('should return error when no graphqlWithAuth', async () => {
            const result = await projects.moveProjectItem('P1', 'item1', 'SF1', 'opt1')
            expect(result.success).toBe(false)
        })

        it('should handle error during mutation', async () => {
            client.graphqlWithAuth = vi.fn().mockRejectedValue(new Error('mutation fail'))
            const result = await projects.moveProjectItem('P1', 'item1', 'SF1', 'opt1')
            expect(result.success).toBe(false)
            expect(result.error).toContain('mutation fail')
        })

        it('should succeed on valid mutation', async () => {
            client.graphqlWithAuth = vi.fn().mockResolvedValue({
                updateProjectV2ItemFieldValue: { projectV2Item: { id: 'item1' } },
            })
            const result = await projects.moveProjectItem('P1', 'item1', 'SF1', 'opt1')
            expect(result.success).toBe(true)
        })
    })

    describe('addProjectItem', () => {
        it('should return error when no graphqlWithAuth', async () => {
            const result = await projects.addProjectItem('P1', 'content1')
            expect(result.success).toBe(false)
        })

        it('should handle error during add mutation', async () => {
            client.graphqlWithAuth = vi.fn().mockRejectedValue(new Error('add fail'))
            const result = await projects.addProjectItem('P1', 'content1')
            expect(result.success).toBe(false)
            expect(result.error).toContain('add fail')
        })

        it('should succeed and return itemId', async () => {
            client.graphqlWithAuth = vi.fn().mockResolvedValue({
                addProjectV2ItemById: { item: { id: 'new-item-id' } },
            })
            const result = await projects.addProjectItem('P1', 'content1')
            expect(result.success).toBe(true)
            expect(result.itemId).toBe('new-item-id')
        })
    })
})

// ============================================================================
// PullRequestsManager Branch Coverage
// ============================================================================

describe('PullRequestsManager — branch coverage', () => {
    let client: GitHubClient
    let prs: PullRequestsManager

    beforeEach(() => {
        vi.clearAllMocks()
        delete process.env['GITHUB_TOKEN']
        client = new GitHubClient('.')
        prs = new PullRequestsManager(client)
    })

    describe('getPullRequests', () => {
        it('should return empty when no octokit', async () => {
            expect(await prs.getPullRequests('o', 'r')).toEqual([])
        })

        it('should return cached PRs', async () => {
            const cached = [{ number: 1 }]
            client.setCache('prs:o:r:open:20', cached)
            client.octokit = {} as never
            expect(await prs.getPullRequests('o', 'r')).toEqual(cached)
        })

        it('should map PR states correctly (OPEN, MERGED, CLOSED)', async () => {
            client.octokit = {
                pulls: {
                    list: vi.fn().mockResolvedValue({
                        data: [
                            { number: 1, title: 'Open PR', html_url: 'u1', state: 'open', merged_at: null },
                            { number: 2, title: 'Merged PR', html_url: 'u2', state: 'closed', merged_at: '2025-01-01' },
                            { number: 3, title: 'Closed PR', html_url: 'u3', state: 'closed', merged_at: null },
                        ],
                    }),
                },
            } as never
            const result = await prs.getPullRequests('o', 'r')
            expect(result[0]!.state).toBe('OPEN')
            expect(result[1]!.state).toBe('MERGED')
            expect(result[2]!.state).toBe('CLOSED')
        })

        it('should handle API error', async () => {
            client.octokit = {
                pulls: { list: vi.fn().mockRejectedValue(new Error('fail')) },
            } as never
            expect(await prs.getPullRequests('o', 'r')).toEqual([])
        })
    })

    describe('getPullRequest', () => {
        it('should return null when no octokit', async () => {
            expect(await prs.getPullRequest('o', 'r', 1)).toBeNull()
        })

        it('should return cached PR details', async () => {
            const cached = { number: 1, title: 'cached' }
            client.setCache('pr:o:r:1', cached)
            client.octokit = {} as never
            expect(await prs.getPullRequest('o', 'r', 1)).toEqual(cached)
        })

        it('should map detail fields including draft and merged state', async () => {
            client.octokit = {
                pulls: {
                    get: vi.fn().mockResolvedValue({
                        data: {
                            number: 5,
                            title: 'Test PR',
                            html_url: 'url',
                            state: 'closed',
                            merged_at: '2025-01-10',
                            body: 'body',
                            draft: false,
                            head: { ref: 'feature' },
                            base: { ref: 'main' },
                            user: { login: 'alice' },
                            created_at: 'c',
                            updated_at: 'u',
                            closed_at: 'cl',
                            additions: 10,
                            deletions: 5,
                            changed_files: 3,
                        },
                    }),
                },
            } as never
            const result = await prs.getPullRequest('o', 'r', 5)
            expect(result!.state).toBe('MERGED')
            expect(result!.author).toBe('alice')
            expect(result!.draft).toBe(false)
        })

        it('should handle missing user (null login)', async () => {
            client.octokit = {
                pulls: {
                    get: vi.fn().mockResolvedValue({
                        data: {
                            number: 6, title: 'T', html_url: 'u', state: 'open', merged_at: null,
                            body: null, draft: undefined, head: { ref: 'h' }, base: { ref: 'b' },
                            user: null, created_at: 'c', updated_at: 'u', closed_at: null,
                            additions: 0, deletions: 0, changed_files: 0,
                        },
                    }),
                },
            } as never
            const result = await prs.getPullRequest('o', 'r', 6)
            expect(result!.author).toBe('unknown')
            expect(result!.draft).toBe(false)
        })

        it('should handle API error', async () => {
            client.octokit = {
                pulls: { get: vi.fn().mockRejectedValue(new Error('404')) },
            } as never
            expect(await prs.getPullRequest('o', 'r', 999)).toBeNull()
        })
    })

    describe('getReviews', () => {
        it('should return empty when no octokit', async () => {
            expect(await prs.getReviews('o', 'r', 1)).toEqual([])
        })

        it('should return cached reviews', async () => {
            const cached = [{ id: 1 }]
            client.setCache('reviews:o:r:1', cached)
            client.octokit = {} as never
            expect(await prs.getReviews('o', 'r', 1)).toEqual(cached)
        })

        it('should detect copilot reviews', async () => {
            client.octokit = {
                rest: {
                    pulls: {
                        listReviews: vi.fn().mockResolvedValue({
                            data: [
                                { id: 1, user: { login: 'copilot-pull-request-reviewer[bot]' }, state: 'APPROVED', body: 'ok', submitted_at: '2025-01-01', commit_id: null },
                                { id: 2, user: { login: 'human-reviewer' }, state: 'COMMENTED', body: 'comment', submitted_at: null, commit_id: 'abc123' },
                            ],
                        }),
                    },
                },
            } as never
            const result = await prs.getReviews('o', 'r', 1)
            expect(result[0]!.isCopilot).toBe(true)
            expect(result[1]!.isCopilot).toBe(false)
        })

        it('should handle API error', async () => {
            client.octokit = {
                rest: { pulls: { listReviews: vi.fn().mockRejectedValue(new Error('fail')) } },
            } as never
            expect(await prs.getReviews('o', 'r', 1)).toEqual([])
        })
    })

    describe('getReviewComments', () => {
        it('should return empty when no octokit', async () => {
            expect(await prs.getReviewComments('o', 'r', 1)).toEqual([])
        })

        it('should return cached comments', async () => {
            const cached = [{ id: 1 }]
            client.setCache('review-comments:o:r:1', cached)
            client.octokit = {} as never
            expect(await prs.getReviewComments('o', 'r', 1)).toEqual(cached)
        })

        it('should map comments with line/side fallbacks', async () => {
            client.octokit = {
                rest: {
                    pulls: {
                        listReviewComments: vi.fn().mockResolvedValue({
                            data: [
                                { id: 1, user: { login: 'github-copilot[bot]' }, body: 'fix', path: 'a.ts', line: null, original_line: 42, side: null, created_at: 'c' },
                                { id: 2, user: null, body: 'note', path: 'b.ts', line: 10, original_line: null, side: 'LEFT', created_at: 'c' },
                            ],
                        }),
                    },
                },
            } as never
            const result = await prs.getReviewComments('o', 'r', 1)
            expect(result[0]!.isCopilot).toBe(true)
            expect(result[0]!.line).toBe(42)
            expect(result[0]!.side).toBe('RIGHT')
            expect(result[1]!.author).toBe('unknown')
            expect(result[1]!.line).toBe(10)
            expect(result[1]!.side).toBe('LEFT')
        })

        it('should handle API error', async () => {
            client.octokit = {
                rest: { pulls: { listReviewComments: vi.fn().mockRejectedValue(new Error('fail')) } },
            } as never
            expect(await prs.getReviewComments('o', 'r', 1)).toEqual([])
        })
    })

    describe('getCopilotReviewSummary', () => {
        it('should return "none" state when no copilot reviews', async () => {
            client.octokit = {
                rest: {
                    pulls: {
                        listReviews: vi.fn().mockResolvedValue({ data: [] }),
                        listReviewComments: vi.fn().mockResolvedValue({ data: [] }),
                    },
                },
            } as never
            const result = await prs.getCopilotReviewSummary('o', 'r', 1)
            expect(result.state).toBe('none')
            expect(result.commentCount).toBe(0)
        })

        it('should detect CHANGES_REQUESTED state', async () => {
            client.octokit = {
                rest: {
                    pulls: {
                        listReviews: vi.fn().mockResolvedValue({
                            data: [
                                { id: 1, user: { login: 'copilot-pull-request-reviewer[bot]' }, state: 'CHANGES_REQUESTED', body: null, submitted_at: '2025-01-01', commit_id: null },
                            ],
                        }),
                        listReviewComments: vi.fn().mockResolvedValue({ data: [] }),
                    },
                },
            } as never
            const result = await prs.getCopilotReviewSummary('o', 'r', 1)
            expect(result.state).toBe('changes_requested')
        })

        it('should detect COMMENTED state', async () => {
            client.octokit = {
                rest: {
                    pulls: {
                        listReviews: vi.fn().mockResolvedValue({
                            data: [
                                { id: 1, user: { login: 'copilot[bot]' }, state: 'COMMENTED', body: 'review', submitted_at: '2025-01-01', commit_id: null },
                            ],
                        }),
                        listReviewComments: vi.fn().mockResolvedValue({ data: [] }),
                    },
                },
            } as never
            const result = await prs.getCopilotReviewSummary('o', 'r', 1)
            expect(result.state).toBe('commented')
        })
    })
})

// ============================================================================
// RepositoryManager Branch Coverage
// ============================================================================

describe('RepositoryManager — branch coverage', () => {
    let client: GitHubClient
    let repo: RepositoryManager

    beforeEach(() => {
        vi.clearAllMocks()
        delete process.env['GITHUB_TOKEN']
        client = new GitHubClient('.')
        repo = new RepositoryManager(client)
    })

    describe('getRepoInfo', () => {
        it('should parse SSH remote URL', async () => {
            client.git = {
                branch: vi.fn().mockResolvedValue({ current: 'main' }),
                getRemotes: vi.fn().mockResolvedValue([
                    { name: 'origin', refs: { fetch: 'git@github.com:owner/repo.git' } },
                ]),
            } as never
            const result = await repo.getRepoInfo()
            expect(result.owner).toBe('owner')
            expect(result.repo).toBe('repo')
        })

        it('should parse HTTPS remote URL', async () => {
            client.git = {
                branch: vi.fn().mockResolvedValue({ current: 'dev' }),
                getRemotes: vi.fn().mockResolvedValue([
                    { name: 'origin', refs: { fetch: 'https://github.com/org/project.git' } },
                ]),
            } as never
            const result = await repo.getRepoInfo()
            expect(result.owner).toBe('org')
            expect(result.repo).toBe('project')
        })

        it('should handle null remote URL', async () => {
            client.git = {
                branch: vi.fn().mockResolvedValue({ current: 'main' }),
                getRemotes: vi.fn().mockResolvedValue([]),
            } as never
            const result = await repo.getRepoInfo()
            expect(result.owner).toBeNull()
        })

        it('should handle non-GitHub URL', async () => {
            client.git = {
                branch: vi.fn().mockResolvedValue({ current: 'main' }),
                getRemotes: vi.fn().mockResolvedValue([
                    { name: 'origin', refs: { fetch: 'https://gitlab.com/user/repo.git' } },
                ]),
            } as never
            const result = await repo.getRepoInfo()
            expect(result.owner).toBeNull()
        })

        it('should handle invalid URL string', async () => {
            client.git = {
                branch: vi.fn().mockResolvedValue({ current: 'main' }),
                getRemotes: vi.fn().mockResolvedValue([
                    { name: 'origin', refs: { fetch: 'not-a-url' } },
                ]),
            } as never
            const result = await repo.getRepoInfo()
            expect(result.owner).toBeNull()
        })

        it('should handle git errors gracefully', async () => {
            client.git = {
                branch: vi.fn().mockRejectedValue(new Error('not a git repo')),
            } as never
            const result = await repo.getRepoInfo()
            expect(result.owner).toBeNull()
            expect(result.repo).toBeNull()
        })

        it('should handle empty branch name', async () => {
            client.git = {
                branch: vi.fn().mockResolvedValue({ current: '' }),
                getRemotes: vi.fn().mockResolvedValue([
                    { name: 'origin', refs: { fetch: 'git@github.com:a/b.git' } },
                ]),
            } as never
            const result = await repo.getRepoInfo()
            expect(result.branch).toBeNull()
        })
    })

    describe('getCachedRepoInfo', () => {
        it('should return null when no cached info', () => {
            expect(repo.getCachedRepoInfo()).toBeNull()
        })
    })

    describe('getWorkflowRuns', () => {
        it('should return empty when no octokit', async () => {
            expect(await repo.getWorkflowRuns('o', 'r')).toEqual([])
        })

        it('should return cached runs', async () => {
            const cached = [{ id: 1 }]
            client.setCache('workflows:o:r:10', cached)
            client.octokit = {} as never
            expect(await repo.getWorkflowRuns('o', 'r')).toEqual(cached)
        })

        it('should map workflow runs with null name', async () => {
            client.octokit = {
                rest: {
                    actions: {
                        listWorkflowRunsForRepo: vi.fn().mockResolvedValue({
                            data: {
                                workflow_runs: [
                                    { id: 1, name: null, status: 'completed', conclusion: 'success', html_url: 'u', head_branch: null, head_sha: 'abc', created_at: 'c', updated_at: 'u' },
                                ],
                            },
                        }),
                    },
                },
            } as never
            const result = await repo.getWorkflowRuns('o', 'r')
            expect(result[0]!.name).toBe('Unknown Workflow')
            expect(result[0]!.headBranch).toBe('')
        })

        it('should handle API error', async () => {
            client.octokit = {
                rest: {
                    actions: { listWorkflowRunsForRepo: vi.fn().mockRejectedValue(new Error('fail')) },
                },
            } as never
            expect(await repo.getWorkflowRuns('o', 'r')).toEqual([])
        })
    })
})

// ============================================================================
// MilestonesManager Branch Coverage
// ============================================================================

describe('MilestonesManager — branch coverage', () => {
    let client: GitHubClient
    let milestones: MilestonesManager

    beforeEach(() => {
        vi.clearAllMocks()
        delete process.env['GITHUB_TOKEN']
        client = new GitHubClient('.')
        milestones = new MilestonesManager(client)
    })

    const mockMilestoneData = {
        number: 1,
        title: 'v1.0',
        description: null,
        state: 'open',
        html_url: 'url',
        due_on: null,
        open_issues: 3,
        closed_issues: 7,
        created_at: 'c',
        updated_at: 'u',
        creator: null,
    }

    describe('getMilestones', () => {
        it('should return empty when no octokit', async () => {
            expect(await milestones.getMilestones('o', 'r')).toEqual([])
        })

        it('should return cached milestones', async () => {
            const cached = [{ number: 1 }]
            client.setCache('milestones:o:r:open:20', cached)
            client.octokit = {} as never
            expect(await milestones.getMilestones('o', 'r')).toEqual(cached)
        })

        it('should map milestone fields with null description/dueOn/creator', async () => {
            client.octokit = {
                issues: {
                    listMilestones: vi.fn().mockResolvedValue({ data: [mockMilestoneData] }),
                },
            } as never
            const result = await milestones.getMilestones('o', 'r')
            expect(result[0]!.description).toBeNull()
            expect(result[0]!.dueOn).toBeNull()
            expect(result[0]!.creator).toBeNull()
        })

        it('should handle API error', async () => {
            client.octokit = {
                issues: { listMilestones: vi.fn().mockRejectedValue(new Error('fail')) },
            } as never
            expect(await milestones.getMilestones('o', 'r')).toEqual([])
        })
    })

    describe('getMilestone', () => {
        it('should return null when no octokit', async () => {
            expect(await milestones.getMilestone('o', 'r', 1)).toBeNull()
        })

        it('should return cached milestone', async () => {
            const cached = { number: 1, title: 'cached' }
            client.setCache('milestone:o:r:1', cached)
            client.octokit = {} as never
            expect(await milestones.getMilestone('o', 'r', 1)).toEqual(cached)
        })

        it('should handle API error', async () => {
            client.octokit = {
                issues: { getMilestone: vi.fn().mockRejectedValue(new Error('404')) },
            } as never
            expect(await milestones.getMilestone('o', 'r', 999)).toBeNull()
        })
    })

    describe('createMilestone', () => {
        it('should return null when no octokit', async () => {
            expect(await milestones.createMilestone('o', 'r', 'v1')).toBeNull()
        })

        it('should create milestone and return data', async () => {
            client.octokit = {
                issues: {
                    createMilestone: vi.fn().mockResolvedValue({ data: mockMilestoneData }),
                },
            } as never
            const result = await milestones.createMilestone('o', 'r', 'v1.0')
            expect(result).not.toBeNull()
            expect(result!.number).toBe(1)
        })

        it('should handle API error', async () => {
            client.octokit = {
                issues: { createMilestone: vi.fn().mockRejectedValue(new Error('fail')) },
            } as never
            expect(await milestones.createMilestone('o', 'r', 'v1')).toBeNull()
        })
    })

    describe('updateMilestone', () => {
        it('should return null when no octokit', async () => {
            expect(await milestones.updateMilestone('o', 'r', 1, { title: 'new' })).toBeNull()
        })

        it('should update milestone with dueOn null', async () => {
            client.octokit = {
                issues: {
                    updateMilestone: vi.fn().mockResolvedValue({ data: mockMilestoneData }),
                },
            } as never
            const result = await milestones.updateMilestone('o', 'r', 1, { dueOn: null })
            expect(result).not.toBeNull()
        })

        it('should handle API error', async () => {
            client.octokit = {
                issues: { updateMilestone: vi.fn().mockRejectedValue(new Error('fail')) },
            } as never
            expect(await milestones.updateMilestone('o', 'r', 1, {})).toBeNull()
        })
    })

    describe('deleteMilestone', () => {
        it('should return error when no octokit', async () => {
            const result = await milestones.deleteMilestone('o', 'r', 1)
            expect(result.success).toBe(false)
        })

        it('should delete successfully', async () => {
            client.octokit = {
                issues: { deleteMilestone: vi.fn().mockResolvedValue({}) },
            } as never
            const result = await milestones.deleteMilestone('o', 'r', 1)
            expect(result.success).toBe(true)
        })

        it('should handle API error', async () => {
            client.octokit = {
                issues: { deleteMilestone: vi.fn().mockRejectedValue(new Error('forbidden')) },
            } as never
            const result = await milestones.deleteMilestone('o', 'r', 1)
            expect(result.success).toBe(false)
            expect(result.error).toContain('forbidden')
        })
    })
})
