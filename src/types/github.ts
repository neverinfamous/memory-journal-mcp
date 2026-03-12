/**
 * Memory Journal MCP Server - GitHub Integration Types
 */

// ============================================================================
// GitHub API Types
// ============================================================================

/**
 * GitHub project information
 */
export interface GitHubProject {
    number: number
    title: string
    url: string
    state: 'OPEN' | 'CLOSED'
}

/**
 * GitHub issue information
 */
export interface GitHubIssue {
    number: number
    title: string
    url: string
    state: 'OPEN' | 'CLOSED'
    milestone?: { number: number; title: string } | null
}

/**
 * GitHub pull request information
 */
export interface GitHubPullRequest {
    number: number
    title: string
    url: string
    state: 'OPEN' | 'CLOSED' | 'MERGED'
}

/**
 * GitHub milestone information
 */
export interface GitHubMilestone {
    number: number
    title: string
    description: string | null
    state: 'open' | 'closed'
    url: string
    dueOn: string | null
    openIssues: number
    closedIssues: number
    createdAt: string
    updatedAt: string
    creator: string | null
}

/**
 * GitHub workflow run information
 */
export interface GitHubWorkflowRun {
    id: number
    name: string
    status: 'queued' | 'in_progress' | 'completed'
    conclusion: 'success' | 'failure' | 'cancelled' | 'skipped' | null
    url: string
    headBranch: string
    headSha: string
    createdAt: string
    updatedAt: string
}

/**
 * GitHub PR review
 */
export interface GitHubReview {
    id: number
    author: string
    state: 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED' | 'DISMISSED' | 'PENDING'
    body: string | null
    submittedAt: string
    isCopilot: boolean
}

/**
 * GitHub PR review comment (file-level)
 */
export interface GitHubReviewComment {
    id: number
    author: string
    body: string
    path: string
    line: number | null
    side: 'LEFT' | 'RIGHT'
    createdAt: string
    isCopilot: boolean
}

/**
 * Copilot review summary for a PR
 */
export interface CopilotReviewSummary {
    prNumber: number
    state: 'approved' | 'changes_requested' | 'commented' | 'none'
    commentCount: number
    comments: GitHubReviewComment[]
}

/**
 * Auto-captured project context
 */
export interface ProjectContext {
    repoName: string | null
    branch: string | null
    commit: string | null
    remoteUrl: string | null
    projects: GitHubProject[]
    issues: GitHubIssue[]
    pullRequests: GitHubPullRequest[]
    workflowRuns: GitHubWorkflowRun[]
    milestones: GitHubMilestone[]
}

// ============================================================================
// Repository Insights/Traffic Types
// ============================================================================

/**
 * Repository statistics (stars, forks, watchers)
 */
export interface RepoStats {
    stars: number
    forks: number
    watchers: number
    openIssues: number
    size: number // KB
    defaultBranch: string
}

/**
 * Aggregated traffic data (14-day rolling)
 */
export interface TrafficData {
    clones: { total: number; unique: number; dailyAvg: number }
    views: { total: number; unique: number; dailyAvg: number }
    period: string // e.g. "14 days"
}

/**
 * Traffic referrer source
 */
export interface TrafficReferrer {
    referrer: string
    count: number
    uniques: number
}

/**
 * Popular repository path
 */
export interface PopularPath {
    path: string
    title: string
    count: number
    uniques: number
}

// ============================================================================
// GitHub Projects v2 Kanban Types
// ============================================================================

/**
 * Status option for single-select field in Projects v2
 */
export interface ProjectV2StatusOption {
    id: string
    name: string
    color?: string
}

/**
 * Project item in a Kanban board
 */
export interface ProjectV2Item {
    id: string
    title: string
    url: string
    type: 'ISSUE' | 'PULL_REQUEST' | 'DRAFT_ISSUE'
    status: string | null
    number?: number
    labels?: string[]
    assignees?: string[]
    createdAt: string
    updatedAt: string
}

/**
 * Kanban column (grouped by Status)
 */
export interface KanbanColumn {
    status: string
    statusOptionId: string
    items: ProjectV2Item[]
}

/**
 * Full Kanban board response
 */
export interface KanbanBoard {
    projectId: string
    projectNumber: number
    projectTitle: string
    statusFieldId: string
    statusOptions: ProjectV2StatusOption[]
    columns: KanbanColumn[]
    totalItems: number
}
