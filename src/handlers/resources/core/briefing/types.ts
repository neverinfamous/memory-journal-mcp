export interface GitHubBriefingContext {
    repo: string | null
    branch: string | null
    ci: 'passing' | 'failing' | 'pending' | 'cancelled' | 'unknown'
    openIssues: number
    openPRs: number
    milestones: { title: string; progress: string; dueOn: string | null }[]
    insights?: {
        stars: number | null
        forks: number | null
        clones14d?: number
        views14d?: number
    }
    openIssueList?: { number: number; title: string }[]
    openPrList?: { number: number; title: string; state: string }[]
    prStatusSummary?: { open: number; merged: number; closed: number }
    workflowSummary?: {
        passing: number
        failing: number
        pending: number
        cancelled: number
        runs?: { name: string; conclusion: string }[]
    }
    copilotReviews?: {
        reviewed: number
        approved: number
        changesRequested: number
        totalComments: number
    }
}

export interface TeamBriefingContext {
    teamContext?: { totalEntries: number; latestPreview: string | null }
    teamLatestEntries?: { id: number; timestamp: string; type: string; preview: string }[]
}

export interface SystemBriefingContext {
    rulesFile?: { path: string; name: string; sizeKB: number; lastModified: string }
    skillsDir?: { path: string; count: number; names: string[] }
}
