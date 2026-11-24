/**
 * Narrow structural types for the subset of `@octokit/rest` used by `GitHubIntegration`.
 * Avoids pulling 287k+ lines of `@octokit/openapi-types` into `tsc` and `typescript-eslint`.
 */

export interface OctokitRequestOptions {
    timeout?: number
    signal?: AbortSignal | undefined
}

export interface OctokitOptions {
    auth?: string
    request?: OctokitRequestOptions
}

export type OctokitGraphqlFn = <T = unknown>(
    query: string,
    parameters?: Record<string, unknown>
) => Promise<T>

export interface OctokitGraphqlClient extends OctokitGraphqlFn {
    defaults: (options: {
        headers?: Record<string, string>
        request?: OctokitRequestOptions
    }) => OctokitGraphqlFn
}

export interface OctokitMilestoneData {
    number: number
    title: string
    description?: string | null
    state: string
    html_url: string
    due_on?: string | null
    open_issues: number
    closed_issues: number
    created_at: string
    updated_at: string
    creator?: { login: string } | null
}

export interface OctokitRepoParams {
    owner: string
    repo: string
}

export interface OctokitClient {
    hook: {
        after: (
            name: 'request',
            callback: (response: {
                headers: Record<string, string | number | undefined>
            }) => void
        ) => void
    }
    rateLimit: {
        get: () => Promise<{ data: unknown }>
    }
    repos: {
        get: (params: OctokitRepoParams) => Promise<{
            data: {
                stargazers_count: number
                forks_count: number
                subscribers_count: number
                open_issues_count: number
                size: number
                default_branch: string
            }
        }>
    }
    issues: {
        listForRepo: (params: {
            owner: string
            repo: string
            state?: 'open' | 'closed' | 'all'
            per_page?: number
            sort?: 'created' | 'updated' | 'comments'
            direction?: 'asc' | 'desc'
            request?: { signal?: AbortSignal | undefined }
        }) => Promise<{
            data: {
                number: number
                title: string
                html_url: string
                state: string
                pull_request?: Record<string, unknown> | null
                milestone?: { number: number; title: string } | null
            }[]
        }>
        get: (params: { owner: string; repo: string; issue_number: number }) => Promise<{
            data: {
                number: number
                title: string
                html_url: string
                state: string
                node_id: string
                body?: string | null
                labels: (string | { name?: string })[]
                assignees?: { login: string }[] | null
                created_at: string
                updated_at: string
                closed_at: string | null
                comments: number
                pull_request?: Record<string, unknown> | null
                milestone?: { number: number; title: string } | null
            }
        }>
        listComments: (params: {
            owner: string
            repo: string
            issue_number: number
            per_page?: number
            sort?: 'created' | 'updated'
            direction?: 'asc' | 'desc'
        }) => Promise<{
            data: {
                user?: { login: string } | null
                body?: string | null
                created_at: string
            }[]
        }>
        create: (params: {
            owner: string
            repo: string
            title: string
            body?: string | undefined
            labels?: string[] | undefined
            assignees?: string[] | undefined
            milestone?: number | undefined
        }) => Promise<{
            data: { number: number; html_url: string; title: string; node_id: string }
        }>
        createComment: (params: {
            owner: string
            repo: string
            issue_number: number
            body: string
        }) => Promise<unknown>
        update: (params: {
            owner: string
            repo: string
            issue_number: number
            state?: 'open' | 'closed'
        }) => Promise<{ data: { html_url: string } }>
        listMilestones: (params: {
            owner: string
            repo: string
            state?: 'open' | 'closed' | 'all'
            per_page?: number
            sort?: 'due_on' | 'completeness'
            direction?: 'asc' | 'desc'
            request?: { signal?: AbortSignal | undefined }
        }) => Promise<{ data: OctokitMilestoneData[] }>
        getMilestone: (params: {
            owner: string
            repo: string
            milestone_number: number
        }) => Promise<{ data: OctokitMilestoneData }>
        createMilestone: (params: {
            owner: string
            repo: string
            title: string
            description?: string | undefined
            due_on?: string | undefined
        }) => Promise<{ data: OctokitMilestoneData }>
        updateMilestone: (params: {
            owner: string
            repo: string
            milestone_number: number
            title?: string | undefined
            description?: string | undefined
            due_on?: string | undefined
            state?: 'open' | 'closed' | undefined
        }) => Promise<{ data: OctokitMilestoneData }>
        deleteMilestone: (params: {
            owner: string
            repo: string
            milestone_number: number
        }) => Promise<unknown>
    }
    pulls: {
        list: (params: {
            owner: string
            repo: string
            state?: 'open' | 'closed' | 'all'
            per_page?: number
            sort?: 'created' | 'updated' | 'popularity' | 'long-running'
            direction?: 'asc' | 'desc'
            request?: { signal?: AbortSignal | undefined }
        }) => Promise<{
            data: {
                number: number
                title: string
                html_url: string
                state: string
                merged_at: string | null
                head?: { ref: string } | null
            }[]
        }>
        get: (params: { owner: string; repo: string; pull_number: number }) => Promise<{
            data: {
                number: number
                node_id: string
                title: string
                html_url: string
                state: string
                body: string | null
                draft?: boolean
                head: { ref: string }
                base: { ref: string }
                user: { login: string } | null
                created_at: string
                updated_at: string
                merged_at: string | null
                closed_at: string | null
                additions: number
                deletions: number
                changed_files: number
            }
        }>
    }
    rest: {
        repos: {
            getClones: (params: OctokitRepoParams) => Promise<{
                data: { count: number; uniques: number; clones?: unknown[] }
            }>
            getViews: (params: OctokitRepoParams) => Promise<{
                data: { count: number; uniques: number; views?: unknown[] }
            }>
            getTopReferrers: (params: OctokitRepoParams) => Promise<{
                data: { referrer: string; count: number; uniques: number }[]
            }>
            getTopPaths: (params: OctokitRepoParams) => Promise<{
                data: { path: string; title: string; count: number; uniques: number }[]
            }>
        }
        actions: {
            listWorkflowRunsForRepo: (params: {
                owner: string
                repo: string
                per_page?: number
                request?: { signal?: AbortSignal | undefined }
            }) => Promise<{
                data: {
                    workflow_runs: {
                        id: number
                        name?: string | null
                        status: string | null
                        conclusion: string | null
                        html_url: string
                        head_branch: string | null
                        head_sha: string
                        created_at: string
                        updated_at: string
                    }[]
                }
            }>
        }
        pulls: {
            listReviews: (params: {
                owner: string
                repo: string
                pull_number: number
                per_page?: number
            }) => Promise<{
                data: {
                    id: number
                    user?: { login: string } | null
                    state: string
                    body?: string | null
                    submitted_at?: string | null
                    commit_id?: string | null
                }[]
            }>
            listReviewComments: (params: {
                owner: string
                repo: string
                pull_number: number
                per_page?: number
            }) => Promise<{
                data: {
                    id: number
                    user?: { login: string } | null
                    body?: string | null
                    path: string
                    line?: number | null
                    original_line?: number | null
                    side?: 'LEFT' | 'RIGHT'
                    created_at: string
                }[]
            }>
        }
    }
}
