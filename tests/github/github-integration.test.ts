/**
 * GitHubIntegration Tests
 *
 * Tests the GitHubIntegration class with mocked Octokit, GraphQL, and simple-git.
 * All external API calls are vi.mocked so no network access is needed.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { GitHubIntegration } from '../../src/github/GitHubIntegration.js'

// ============================================================================
// Module mocks
// ============================================================================

// Mock simple-git
const mockBranch = vi.fn()
const mockGetRemotes = vi.fn()
const mockLog = vi.fn()

vi.mock('simple-git', () => ({
    simpleGit: () => ({
        branch: mockBranch,
        getRemotes: mockGetRemotes,
        log: mockLog,
    }),
}))

// Helper to create an Octokit mock
function createOctokitMock() {
    return {
        issues: {
            listForRepo: vi.fn(),
            get: vi.fn(),
            create: vi.fn(),
            update: vi.fn(),
            createComment: vi.fn(),
            listMilestones: vi.fn(),
            getMilestone: vi.fn(),
            createMilestone: vi.fn(),
            updateMilestone: vi.fn(),
            deleteMilestone: vi.fn(),
        },
        pulls: {
            list: vi.fn(),
            get: vi.fn(),
        },
        repos: {
            get: vi.fn(),
        },
        rest: {
            actions: {
                listWorkflowRunsForRepo: vi.fn(),
            },
            repos: {
                getClones: vi.fn(),
                getViews: vi.fn(),
                getTopReferrers: vi.fn(),
                getTopPaths: vi.fn(),
            },
        },
    }
}

// Helper: inject private fields into GitHubIntegration for testing
function injectMocks(
    gh: GitHubIntegration,
    octokit: ReturnType<typeof createOctokitMock>,
    graphqlFn?: ReturnType<typeof vi.fn>
) {
    const inst = gh as unknown as { octokit: typeof octokit; graphqlWithAuth?: typeof graphqlFn }
    inst.octokit = octokit
    if (graphqlFn) inst.graphqlWithAuth = graphqlFn
}

describe('GitHubIntegration', () => {
    let gh: GitHubIntegration
    let octokit: ReturnType<typeof createOctokitMock>

    beforeEach(() => {
        // Save and clear env to prevent real token usage
        delete process.env['GITHUB_TOKEN']
        delete process.env['GITHUB_REPO_PATH']

        gh = new GitHubIntegration('.')
        octokit = createOctokitMock()
        injectMocks(gh, octokit)

        // Default git mock responses
        mockBranch.mockResolvedValue({ current: 'main' })
        mockGetRemotes.mockResolvedValue([
            { name: 'origin', refs: { fetch: 'git@github.com:testowner/testrepo.git' } },
        ])
        mockLog.mockResolvedValue({ latest: { hash: 'abc1234567890' } })
    })

    afterEach(() => {
        vi.restoreAllMocks()
    })

    // ========================================================================
    // Constructor & API availability
    // ========================================================================

    describe('isApiAvailable', () => {
        it('should return true when octokit is injected', () => {
            expect(gh.isApiAvailable()).toBe(true)
        })

        it('should return false when no token', () => {
            const noToken = new GitHubIntegration('.')
            expect(noToken.isApiAvailable()).toBe(false)
        })
    })

    // ========================================================================
    // Cache
    // ========================================================================

    describe('cache', () => {
        it('should return null for getCachedRepoInfo before getRepoInfo', () => {
            expect(gh.getCachedRepoInfo()).toBeNull()
        })

        it('should cache repo info after getRepoInfo', async () => {
            await gh.getRepoInfo()
            const cached = gh.getCachedRepoInfo()
            expect(cached).not.toBeNull()
            expect(cached!.owner).toBe('testowner')
            expect(cached!.repo).toBe('testrepo')
        })

        it('should clear all cache with clearCache', async () => {
            // Populate cache
            await gh.getRepoInfo()

            // Call an API method to populate the cache internally
            octokit.issues.listForRepo.mockResolvedValue({
                data: [
                    {
                        number: 1,
                        title: 'Test',
                        html_url: 'https://github.com/o/r/issues/1',
                        state: 'open',
                        pull_request: undefined,
                        milestone: null,
                    },
                ],
            })
            await gh.getIssues('o', 'r')

            // First call hits API
            expect(octokit.issues.listForRepo).toHaveBeenCalledTimes(1)

            // Second call should use cache
            await gh.getIssues('o', 'r')
            expect(octokit.issues.listForRepo).toHaveBeenCalledTimes(1)

            // After clearCache, next call should hit API again
            gh.clearCache()
            await gh.getIssues('o', 'r')
            expect(octokit.issues.listForRepo).toHaveBeenCalledTimes(2)
        })
    })

    // ========================================================================
    // Git operations
    // ========================================================================

    describe('getRepoInfo', () => {
        it('should parse SSH remote URL', async () => {
            const info = await gh.getRepoInfo()
            expect(info.owner).toBe('testowner')
            expect(info.repo).toBe('testrepo')
            expect(info.branch).toBe('main')
        })

        it('should parse HTTPS remote URL', async () => {
            mockGetRemotes.mockResolvedValue([
                { name: 'origin', refs: { fetch: 'https://github.com/httpsowner/httpsrepo.git' } },
            ])
            const info = await gh.getRepoInfo()
            expect(info.owner).toBe('httpsowner')
            expect(info.repo).toBe('httpsrepo')
        })

        it('should handle no origin remote', async () => {
            mockGetRemotes.mockResolvedValue([])
            const info = await gh.getRepoInfo()
            expect(info.owner).toBeNull()
            expect(info.repo).toBeNull()
            expect(info.remoteUrl).toBeNull()
        })

        it('should handle non-github remote', async () => {
            mockGetRemotes.mockResolvedValue([
                { name: 'origin', refs: { fetch: 'https://gitlab.com/owner/repo.git' } },
            ])
            const info = await gh.getRepoInfo()
            expect(info.owner).toBeNull()
            expect(info.repo).toBeNull()
        })

        it('should handle git errors gracefully', async () => {
            mockBranch.mockRejectedValue(new Error('Not a git repo'))
            const info = await gh.getRepoInfo()
            expect(info.owner).toBeNull()
            expect(info.branch).toBeNull()
        })
    })

    // ========================================================================
    // Issues API
    // ========================================================================

    describe('getIssues', () => {
        it('should return mapped issues filtering out PRs', async () => {
            octokit.issues.listForRepo.mockResolvedValue({
                data: [
                    {
                        number: 1,
                        title: 'Bug fix',
                        html_url: 'https://github.com/o/r/issues/1',
                        state: 'open',
                        pull_request: undefined,
                        milestone: { number: 5, title: 'v1.0' },
                    },
                    {
                        number: 2,
                        title: 'PR (should be filtered)',
                        html_url: 'https://github.com/o/r/pull/2',
                        state: 'open',
                        pull_request: { url: 'x' },
                        milestone: null,
                    },
                ],
            })

            const issues = await gh.getIssues('o', 'r')
            expect(issues).toHaveLength(1)
            expect(issues[0]!.number).toBe(1)
            expect(issues[0]!.state).toBe('OPEN')
            expect(issues[0]!.milestone?.number).toBe(5)
        })

        it('should return empty when no octokit', async () => {
            injectMocks(gh, null as unknown as ReturnType<typeof createOctokitMock>)
            ;(gh as unknown as { octokit: null }).octokit = null
            const issues = await gh.getIssues('o', 'r')
            expect(issues).toEqual([])
        })

        it('should handle API errors gracefully', async () => {
            octokit.issues.listForRepo.mockRejectedValue(new Error('Network error'))
            const issues = await gh.getIssues('o', 'r')
            expect(issues).toEqual([])
        })
    })

    describe('getIssue', () => {
        it('should return issue details', async () => {
            octokit.issues.get.mockResolvedValue({
                data: {
                    number: 42,
                    title: 'Test issue',
                    html_url: 'https://github.com/o/r/issues/42',
                    state: 'closed',
                    body: 'Description',
                    labels: [{ name: 'bug' }],
                    assignees: [{ login: 'dev1' }],
                    created_at: '2025-01-01T00:00:00Z',
                    updated_at: '2025-01-02T00:00:00Z',
                    closed_at: '2025-01-02T00:00:00Z',
                    comments: 3,
                    pull_request: undefined,
                },
            })

            const issue = await gh.getIssue('o', 'r', 42)
            expect(issue).not.toBeNull()
            expect(issue!.number).toBe(42)
            expect(issue!.state).toBe('CLOSED')
            expect(issue!.labels).toEqual(['bug'])
            expect(issue!.commentsCount).toBe(3)
        })

        it('should return null for PR masquerading as issue', async () => {
            octokit.issues.get.mockResolvedValue({
                data: {
                    number: 5,
                    title: 'PR',
                    html_url: 'url',
                    state: 'open',
                    pull_request: { url: 'x' },
                    body: null,
                    labels: [],
                    assignees: [],
                    created_at: 'x',
                    updated_at: 'x',
                    closed_at: null,
                    comments: 0,
                },
            })

            const issue = await gh.getIssue('o', 'r', 5)
            expect(issue).toBeNull()
        })

        it('should handle API error', async () => {
            octokit.issues.get.mockRejectedValue(new Error('Not found'))
            const issue = await gh.getIssue('o', 'r', 999)
            expect(issue).toBeNull()
        })
    })

    describe('createIssue', () => {
        it('should create an issue and return result', async () => {
            octokit.issues.create.mockResolvedValue({
                data: {
                    number: 10,
                    html_url: 'https://github.com/o/r/issues/10',
                    title: 'New issue',
                    node_id: 'NODE123',
                },
            })

            const result = await gh.createIssue('o', 'r', 'New issue', 'Body text')
            expect(result).not.toBeNull()
            expect(result!.number).toBe(10)
            expect(result!.nodeId).toBe('NODE123')
        })

        it('should return null on error', async () => {
            octokit.issues.create.mockRejectedValue(new Error('403'))
            const result = await gh.createIssue('o', 'r', 'Fail')
            expect(result).toBeNull()
        })

        it('should return null when no octokit', async () => {
            ;(gh as unknown as { octokit: null }).octokit = null
            const result = await gh.createIssue('o', 'r', 'No API')
            expect(result).toBeNull()
        })
    })

    describe('closeIssue', () => {
        it('should close an issue', async () => {
            octokit.issues.update.mockResolvedValue({
                data: { html_url: 'https://github.com/o/r/issues/1' },
            })

            const result = await gh.closeIssue('o', 'r', 1)
            expect(result).not.toBeNull()
            expect(result!.success).toBe(true)
        })

        it('should add comment before closing when provided', async () => {
            octokit.issues.createComment.mockResolvedValue({})
            octokit.issues.update.mockResolvedValue({
                data: { html_url: 'url' },
            })

            await gh.closeIssue('o', 'r', 1, 'Closing comment')
            expect(octokit.issues.createComment).toHaveBeenCalledWith({
                owner: 'o',
                repo: 'r',
                issue_number: 1,
                body: 'Closing comment',
            })
        })

        it('should return null on error', async () => {
            octokit.issues.update.mockRejectedValue(new Error('fail'))
            const result = await gh.closeIssue('o', 'r', 1)
            expect(result).toBeNull()
        })
    })

    // ========================================================================
    // Pull Requests API
    // ========================================================================

    describe('getPullRequests', () => {
        it('should return mapped PRs', async () => {
            octokit.pulls.list.mockResolvedValue({
                data: [
                    {
                        number: 10,
                        title: 'Feature PR',
                        html_url: 'url',
                        state: 'open',
                        merged_at: null,
                    },
                    {
                        number: 11,
                        title: 'Merged PR',
                        html_url: 'url2',
                        state: 'closed',
                        merged_at: '2025-01-01T00:00:00Z',
                    },
                ],
            })

            const prs = await gh.getPullRequests('o', 'r')
            expect(prs).toHaveLength(2)
            expect(prs[0]!.state).toBe('OPEN')
            expect(prs[1]!.state).toBe('MERGED')
        })

        it('should return empty when no octokit', async () => {
            ;(gh as unknown as { octokit: null }).octokit = null
            const prs = await gh.getPullRequests('o', 'r')
            expect(prs).toEqual([])
        })
    })

    describe('getPullRequest', () => {
        it('should return PR details', async () => {
            octokit.pulls.get.mockResolvedValue({
                data: {
                    number: 15,
                    title: 'PR',
                    html_url: 'url',
                    state: 'open',
                    merged_at: null,
                    body: 'PR body',
                    draft: false,
                    head: { ref: 'feature' },
                    base: { ref: 'main' },
                    user: { login: 'author1' },
                    created_at: '2025-01-01T00:00:00Z',
                    updated_at: '2025-01-02T00:00:00Z',
                    closed_at: null,
                    additions: 100,
                    deletions: 50,
                    changed_files: 5,
                },
            })

            const pr = await gh.getPullRequest('o', 'r', 15)
            expect(pr).not.toBeNull()
            expect(pr!.headBranch).toBe('feature')
            expect(pr!.baseBranch).toBe('main')
            expect(pr!.additions).toBe(100)
        })

        it('should handle error', async () => {
            octokit.pulls.get.mockRejectedValue(new Error('Not found'))
            const pr = await gh.getPullRequest('o', 'r', 999)
            expect(pr).toBeNull()
        })
    })

    // ========================================================================
    // Workflow Runs API
    // ========================================================================

    describe('getWorkflowRuns', () => {
        it('should return mapped workflow runs', async () => {
            octokit.rest.actions.listWorkflowRunsForRepo.mockResolvedValue({
                data: {
                    workflow_runs: [
                        {
                            id: 100,
                            name: 'CI',
                            status: 'completed',
                            conclusion: 'success',
                            html_url: 'url',
                            head_branch: 'main',
                            head_sha: 'abc123',
                            created_at: '2025-01-01T00:00:00Z',
                            updated_at: '2025-01-01T01:00:00Z',
                        },
                    ],
                },
            })

            const runs = await gh.getWorkflowRuns('o', 'r')
            expect(runs).toHaveLength(1)
            expect(runs[0]!.name).toBe('CI')
            expect(runs[0]!.conclusion).toBe('success')
        })

        it('should return empty when no octokit', async () => {
            ;(gh as unknown as { octokit: null }).octokit = null
            const runs = await gh.getWorkflowRuns('o', 'r')
            expect(runs).toEqual([])
        })
    })

    // ========================================================================
    // Repository Context
    // ========================================================================

    describe('getRepoContext', () => {
        it('should aggregate repo info, issues, PRs, workflows, milestones', async () => {
            octokit.issues.listForRepo.mockResolvedValue({ data: [] })
            octokit.pulls.list.mockResolvedValue({ data: [] })
            octokit.rest.actions.listWorkflowRunsForRepo.mockResolvedValue({
                data: { workflow_runs: [] },
            })
            octokit.issues.listMilestones.mockResolvedValue({ data: [] })

            const ctx = await gh.getRepoContext()
            expect(ctx.repoName).toBe('testrepo')
            expect(ctx.branch).toBe('main')
            expect(ctx.commit).toBe('abc1234567890')
            expect(ctx.issues).toEqual([])
        })

        it('should handle missing owner/repo', async () => {
            mockGetRemotes.mockResolvedValue([])
            const ctx = await gh.getRepoContext()
            expect(ctx.issues).toEqual([])
            expect(ctx.pullRequests).toEqual([])
        })
    })

    // ========================================================================
    // Milestones API
    // ========================================================================

    describe('getMilestones', () => {
        it('should return mapped milestones', async () => {
            octokit.issues.listMilestones.mockResolvedValue({
                data: [
                    {
                        number: 1,
                        title: 'v1.0',
                        description: 'First release',
                        state: 'open',
                        html_url: 'url',
                        due_on: '2025-06-01T00:00:00Z',
                        open_issues: 5,
                        closed_issues: 10,
                        created_at: '2025-01-01T00:00:00Z',
                        updated_at: '2025-01-02T00:00:00Z',
                        creator: { login: 'owner1' },
                    },
                ],
            })

            const milestones = await gh.getMilestones('o', 'r')
            expect(milestones).toHaveLength(1)
            expect(milestones[0]!.title).toBe('v1.0')
            expect(milestones[0]!.openIssues).toBe(5)
        })

        it('should return empty when no octokit', async () => {
            ;(gh as unknown as { octokit: null }).octokit = null
            const ms = await gh.getMilestones('o', 'r')
            expect(ms).toEqual([])
        })
    })

    describe('getMilestone', () => {
        it('should return single milestone', async () => {
            octokit.issues.getMilestone.mockResolvedValue({
                data: {
                    number: 1,
                    title: 'v1.0',
                    description: null,
                    state: 'open',
                    html_url: 'url',
                    due_on: null,
                    open_issues: 2,
                    closed_issues: 8,
                    created_at: '2025-01-01T00:00:00Z',
                    updated_at: '2025-01-02T00:00:00Z',
                    creator: null,
                },
            })

            const ms = await gh.getMilestone('o', 'r', 1)
            expect(ms).not.toBeNull()
            expect(ms!.closedIssues).toBe(8)
            expect(ms!.creator).toBeNull()
        })

        it('should handle error', async () => {
            octokit.issues.getMilestone.mockRejectedValue(new Error('Not found'))
            const ms = await gh.getMilestone('o', 'r', 999)
            expect(ms).toBeNull()
        })
    })

    describe('createMilestone', () => {
        it('should create and return milestone', async () => {
            octokit.issues.createMilestone.mockResolvedValue({
                data: {
                    number: 3,
                    title: 'v2.0',
                    description: 'Next release',
                    state: 'open',
                    html_url: 'url',
                    due_on: null,
                    open_issues: 0,
                    closed_issues: 0,
                    created_at: '2025-01-01T00:00:00Z',
                    updated_at: '2025-01-01T00:00:00Z',
                    creator: { login: 'me' },
                },
            })

            const ms = await gh.createMilestone('o', 'r', 'v2.0', 'Next release')
            expect(ms).not.toBeNull()
            expect(ms!.number).toBe(3)
        })

        it('should return null when no octokit', async () => {
            ;(gh as unknown as { octokit: null }).octokit = null
            const ms = await gh.createMilestone('o', 'r', 'v2.0')
            expect(ms).toBeNull()
        })
    })

    describe('updateMilestone', () => {
        it('should update and return milestone', async () => {
            octokit.issues.updateMilestone.mockResolvedValue({
                data: {
                    number: 1,
                    title: 'v1.1',
                    description: 'Updated',
                    state: 'closed',
                    html_url: 'url',
                    due_on: null,
                    open_issues: 0,
                    closed_issues: 15,
                    created_at: '2025-01-01T00:00:00Z',
                    updated_at: '2025-02-01T00:00:00Z',
                    creator: { login: 'me' },
                },
            })

            const ms = await gh.updateMilestone('o', 'r', 1, { title: 'v1.1', state: 'closed' })
            expect(ms).not.toBeNull()
            expect(ms!.state).toBe('closed')
        })

        it('should return null when no octokit', async () => {
            ;(gh as unknown as { octokit: null }).octokit = null
            const ms = await gh.updateMilestone('o', 'r', 1, { title: 'x' })
            expect(ms).toBeNull()
        })
    })

    describe('deleteMilestone', () => {
        it('should delete successfully', async () => {
            octokit.issues.deleteMilestone.mockResolvedValue({})
            const result = await gh.deleteMilestone('o', 'r', 1)
            expect(result.success).toBe(true)
        })

        it('should return error on failure', async () => {
            octokit.issues.deleteMilestone.mockRejectedValue(new Error('Forbidden'))
            const result = await gh.deleteMilestone('o', 'r', 1)
            expect(result.success).toBe(false)
            expect(result.error).toContain('Forbidden')
        })

        it('should return error when no octokit', async () => {
            ;(gh as unknown as { octokit: null }).octokit = null
            const result = await gh.deleteMilestone('o', 'r', 1)
            expect(result.success).toBe(false)
        })
    })

    // ========================================================================
    // GraphQL - Project Kanban
    // ========================================================================

    describe('getProjectKanban', () => {
        it('should return null when no graphql', async () => {
            const board = await gh.getProjectKanban('o', 1)
            expect(board).toBeNull()
        })

        it('should search user projects first', async () => {
            const mockGraphql = vi.fn()
            injectMocks(gh, octokit, mockGraphql)

            mockGraphql.mockResolvedValueOnce({
                user: {
                    projectV2: {
                        id: 'PVT_1',
                        title: 'My Board',
                        fields: {
                            nodes: [
                                {
                                    id: 'FIELD_1',
                                    name: 'Status',
                                    options: [
                                        { id: 'OPT_TODO', name: 'Todo', color: 'GREEN' },
                                        { id: 'OPT_DONE', name: 'Done', color: 'BLUE' },
                                    ],
                                },
                            ],
                        },
                        items: {
                            nodes: [
                                {
                                    id: 'ITEM_1',
                                    type: 'ISSUE',
                                    createdAt: '2025-01-01T00:00:00Z',
                                    updatedAt: '2025-01-02T00:00:00Z',
                                    fieldValues: {
                                        nodes: [
                                            {
                                                name: 'Todo',
                                                field: { name: 'Status' },
                                            },
                                        ],
                                    },
                                    content: {
                                        number: 5,
                                        title: 'Test Issue',
                                        url: 'https://github.com/o/r/issues/5',
                                        labels: { nodes: [{ name: 'bug' }] },
                                        assignees: { nodes: [{ login: 'dev' }] },
                                    },
                                },
                            ],
                        },
                    },
                },
            })

            const board = await gh.getProjectKanban('o', 1)
            expect(board).not.toBeNull()
            expect(board!.projectTitle).toBe('My Board')
            expect(board!.columns.length).toBeGreaterThan(0)
            expect(board!.totalItems).toBe(1)

            // Check item was placed in correct column
            const todoCol = board!.columns.find((c) => c.status === 'Todo')
            expect(todoCol).toBeDefined()
            expect(todoCol!.items).toHaveLength(1)
            expect(todoCol!.items[0]!.title).toBe('Test Issue')
        })

        it('should fall back to repo then org projects', async () => {
            const mockGraphql = vi.fn()
            injectMocks(gh, octokit, mockGraphql)

            // User query returns null
            mockGraphql.mockResolvedValueOnce({ user: { projectV2: null } })
            // Repo query returns null
            mockGraphql.mockResolvedValueOnce({ repository: { projectV2: null } })
            // Org query returns null
            mockGraphql.mockResolvedValueOnce({ organization: { projectV2: null } })

            const board = await gh.getProjectKanban('o', 99, 'r')
            expect(board).toBeNull()

            // Verify all 3 queries were attempted
            expect(mockGraphql).toHaveBeenCalledTimes(3)
        })
    })

    // ========================================================================
    // GraphQL - Move/Add Project Items
    // ========================================================================

    describe('moveProjectItem', () => {
        it('should return success on mutation', async () => {
            const mockGraphql = vi.fn()
            injectMocks(gh, octokit, mockGraphql)

            mockGraphql.mockResolvedValue({
                updateProjectV2ItemFieldValue: { projectV2Item: { id: 'ITEM_1' } },
            })

            const result = await gh.moveProjectItem('PVT_1', 'ITEM_1', 'FIELD_1', 'OPT_DONE')
            expect(result.success).toBe(true)
        })

        it('should return error when no graphql', async () => {
            const result = await gh.moveProjectItem('P', 'I', 'F', 'O')
            expect(result.success).toBe(false)
            expect(result.error).toContain('GraphQL not available')
        })

        it('should handle mutation error', async () => {
            const mockGraphql = vi.fn()
            injectMocks(gh, octokit, mockGraphql)
            mockGraphql.mockRejectedValue(new Error('Mutation failed'))

            const result = await gh.moveProjectItem('P', 'I', 'F', 'O')
            expect(result.success).toBe(false)
            expect(result.error).toContain('Mutation failed')
        })
    })

    describe('addProjectItem', () => {
        it('should add item and return itemId', async () => {
            const mockGraphql = vi.fn()
            injectMocks(gh, octokit, mockGraphql)

            mockGraphql.mockResolvedValue({
                addProjectV2ItemById: { item: { id: 'PVTITEM_NEW' } },
            })

            const result = await gh.addProjectItem('PVT_1', 'NODE_1')
            expect(result.success).toBe(true)
            expect(result.itemId).toBe('PVTITEM_NEW')
        })

        it('should return error when no graphql', async () => {
            const result = await gh.addProjectItem('P', 'C')
            expect(result.success).toBe(false)
        })

        it('should handle error', async () => {
            const mockGraphql = vi.fn()
            injectMocks(gh, octokit, mockGraphql)
            mockGraphql.mockRejectedValue(new Error('Failed'))

            const result = await gh.addProjectItem('P', 'C')
            expect(result.success).toBe(false)
            expect(result.error).toContain('Failed')
        })
    })

    // ==========================================================================
    // Repository Insights/Traffic Tests
    // ==========================================================================

    describe('getRepoStats', () => {
        it('should return repo stats', async () => {
            octokit.repos.get.mockResolvedValue({
                data: {
                    stargazers_count: 42,
                    forks_count: 10,
                    subscribers_count: 5,
                    open_issues_count: 3,
                    size: 1024,
                    default_branch: 'main',
                },
            })

            const result = await gh.getRepoStats('testowner', 'testrepo')
            expect(result).toEqual({
                stars: 42,
                forks: 10,
                watchers: 5,
                openIssues: 3,
                size: 1024,
                defaultBranch: 'main',
            })
        })

        it('should return null without octokit', async () => {
            const bare = new GitHubIntegration('.')
            const result = await bare.getRepoStats('o', 'r')
            expect(result).toBeNull()
        })

        it('should return null on API error', async () => {
            octokit.repos.get.mockRejectedValue(new Error('Not found'))
            const result = await gh.getRepoStats('o', 'r')
            expect(result).toBeNull()
        })

        it('should cache results with extended TTL', async () => {
            octokit.repos.get.mockResolvedValue({
                data: {
                    stargazers_count: 1,
                    forks_count: 0,
                    subscribers_count: 0,
                    open_issues_count: 0,
                    size: 100,
                    default_branch: 'main',
                },
            })

            await gh.getRepoStats('o', 'r')
            await gh.getRepoStats('o', 'r')
            expect(octokit.repos.get).toHaveBeenCalledTimes(1)
        })
    })

    describe('getTrafficData', () => {
        it('should return aggregated traffic data', async () => {
            octokit.rest.repos.getClones.mockResolvedValue({
                data: {
                    count: 100,
                    uniques: 50,
                    clones: new Array(10).fill({ count: 10, uniques: 5 }),
                },
            })
            octokit.rest.repos.getViews.mockResolvedValue({
                data: {
                    count: 500,
                    uniques: 200,
                    views: new Array(14).fill({ count: 36, uniques: 14 }),
                },
            })

            const result = await gh.getTrafficData('testowner', 'testrepo')
            expect(result).toEqual({
                clones: { total: 100, unique: 50, dailyAvg: 10 },
                views: { total: 500, unique: 200, dailyAvg: 36 },
                period: '14 days',
            })
        })

        it('should return null without octokit', async () => {
            const bare = new GitHubIntegration('.')
            const result = await bare.getTrafficData('o', 'r')
            expect(result).toBeNull()
        })

        it('should return null on API error', async () => {
            octokit.rest.repos.getClones.mockRejectedValue(new Error('Forbidden'))
            octokit.rest.repos.getViews.mockRejectedValue(new Error('Forbidden'))
            const result = await gh.getTrafficData('o', 'r')
            expect(result).toBeNull()
        })

        it('should handle zero days gracefully', async () => {
            octokit.rest.repos.getClones.mockResolvedValue({
                data: { count: 0, uniques: 0, clones: [] },
            })
            octokit.rest.repos.getViews.mockResolvedValue({
                data: { count: 0, uniques: 0, views: [] },
            })

            const result = await gh.getTrafficData('o', 'r')
            expect(result).toEqual({
                clones: { total: 0, unique: 0, dailyAvg: 0 },
                views: { total: 0, unique: 0, dailyAvg: 0 },
                period: '14 days',
            })
        })
    })

    describe('getTopReferrers', () => {
        it('should return referrer list', async () => {
            octokit.rest.repos.getTopReferrers.mockResolvedValue({
                data: [
                    { referrer: 'google.com', count: 100, uniques: 50 },
                    { referrer: 'github.com', count: 80, uniques: 40 },
                ],
            })

            const result = await gh.getTopReferrers('testowner', 'testrepo')
            expect(result).toHaveLength(2)
            expect(result[0]).toEqual({ referrer: 'google.com', count: 100, uniques: 50 })
        })

        it('should respect limit parameter', async () => {
            octokit.rest.repos.getTopReferrers.mockResolvedValue({
                data: [
                    { referrer: 'a.com', count: 10, uniques: 5 },
                    { referrer: 'b.com', count: 8, uniques: 4 },
                    { referrer: 'c.com', count: 6, uniques: 3 },
                ],
            })

            const result = await gh.getTopReferrers('o', 'r', 2)
            expect(result).toHaveLength(2)
        })

        it('should return empty array without octokit', async () => {
            const bare = new GitHubIntegration('.')
            const result = await bare.getTopReferrers('o', 'r')
            expect(result).toEqual([])
        })

        it('should return empty array on error', async () => {
            octokit.rest.repos.getTopReferrers.mockRejectedValue(new Error('Forbidden'))
            const result = await gh.getTopReferrers('o', 'r')
            expect(result).toEqual([])
        })
    })

    describe('getPopularPaths', () => {
        it('should return popular paths', async () => {
            octokit.rest.repos.getTopPaths.mockResolvedValue({
                data: [
                    { path: '/repo', title: 'repo', count: 200, uniques: 100 },
                    { path: '/repo/issues', title: 'Issues', count: 50, uniques: 30 },
                ],
            })

            const result = await gh.getPopularPaths('testowner', 'testrepo')
            expect(result).toHaveLength(2)
            expect(result[0]).toEqual({ path: '/repo', title: 'repo', count: 200, uniques: 100 })
        })

        it('should respect limit parameter', async () => {
            octokit.rest.repos.getTopPaths.mockResolvedValue({
                data: [
                    { path: '/a', title: 'A', count: 10, uniques: 5 },
                    { path: '/b', title: 'B', count: 8, uniques: 4 },
                    { path: '/c', title: 'C', count: 6, uniques: 3 },
                ],
            })

            const result = await gh.getPopularPaths('o', 'r', 1)
            expect(result).toHaveLength(1)
        })

        it('should return empty array without octokit', async () => {
            const bare = new GitHubIntegration('.')
            const result = await bare.getPopularPaths('o', 'r')
            expect(result).toEqual([])
        })

        it('should return empty array on error', async () => {
            octokit.rest.repos.getTopPaths.mockRejectedValue(new Error('Forbidden'))
            const result = await gh.getPopularPaths('o', 'r')
            expect(result).toEqual([])
        })
    })
})
