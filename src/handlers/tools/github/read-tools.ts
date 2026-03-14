/**
 * GitHub Read Tools - 5 tools
 *
 * Tools: get_github_issues, get_github_prs, get_github_issue, get_github_pr, get_github_context
 */

import { z } from 'zod'
import type { ToolDefinition, ToolContext } from '../../../types/index.js'
import { formatHandlerError } from '../../../utils/error-helpers.js'
import {
    GitHubIssuesListOutputSchema,
    GitHubIssueResultOutputSchema,
    GitHubPRsListOutputSchema,
    GitHubPRResultOutputSchema,
    GitHubContextOutputSchema,
} from './schemas.js'
import { resolveOwnerRepo } from './helpers.js'

// ============================================================================
// Tool Definitions
// ============================================================================

export function getGitHubReadTools(context: ToolContext): ToolDefinition[] {
    return [
        {
            name: 'get_github_issues',
            title: 'Get GitHub Issues',
            description:
                'List issues from a GitHub repository. IMPORTANT: Do NOT guess owner/repo values - leave them empty to auto-detect from the current git repository.',
            group: 'github',
            inputSchema: z.object({
                owner: z
                    .string()
                    .optional()
                    .describe(
                        'Repository owner - LEAVE EMPTY to auto-detect from git. Only specify if user explicitly provides.'
                    ),
                repo: z
                    .string()
                    .optional()
                    .describe(
                        'Repository name - LEAVE EMPTY to auto-detect from git. Only specify if user explicitly provides.'
                    ),
                state: z.string().optional().default('open'),
                limit: z.number().optional().default(20),
            }),
            outputSchema: GitHubIssuesListOutputSchema,
            annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
            handler: async (params: unknown) => {
                try {
                    const input = z
                        .object({
                            owner: z.string().optional(),
                            repo: z.string().optional(),
                            state: z.enum(['open', 'closed', 'all']).optional().default('open'),
                            limit: z.number().optional().default(20),
                        })
                        .parse(params)

                    const resolved = await resolveOwnerRepo(
                        context,
                        input,
                        'would you like to query'
                    )
                    if ('error' in resolved) return resolved.response

                    const issues = await resolved.github.getIssues(
                        resolved.owner,
                        resolved.repo,
                        input.state,
                        input.limit
                    )
                    return {
                        owner: resolved.owner,
                        repo: resolved.repo,
                        detectedOwner: resolved.detectedOwner,
                        detectedRepo: resolved.detectedRepo,
                        issues,
                        count: issues.length,
                    }
                } catch (err) {
                    return formatHandlerError(err)
                }
            },
        },
        {
            name: 'get_github_prs',
            title: 'Get GitHub Pull Requests',
            description:
                'List pull requests from a GitHub repository. IMPORTANT: Do NOT guess owner/repo values - leave them empty to auto-detect from the current git repository.',
            group: 'github',
            inputSchema: z.object({
                owner: z
                    .string()
                    .optional()
                    .describe(
                        'Repository owner - LEAVE EMPTY to auto-detect from git. Only specify if user explicitly provides.'
                    ),
                repo: z
                    .string()
                    .optional()
                    .describe(
                        'Repository name - LEAVE EMPTY to auto-detect from git. Only specify if user explicitly provides.'
                    ),
                state: z.string().optional().default('open'),
                limit: z.number().optional().default(20),
            }),
            outputSchema: GitHubPRsListOutputSchema,
            annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
            handler: async (params: unknown) => {
                try {
                    const input = z
                        .object({
                            owner: z.string().optional(),
                            repo: z.string().optional(),
                            state: z.enum(['open', 'closed', 'all']).optional().default('open'),
                            limit: z.number().optional().default(20),
                        })
                        .parse(params)

                    const resolved = await resolveOwnerRepo(
                        context,
                        input,
                        'would you like to query'
                    )
                    if ('error' in resolved) return resolved.response

                    const pullRequests = await resolved.github.getPullRequests(
                        resolved.owner,
                        resolved.repo,
                        input.state,
                        input.limit
                    )
                    return {
                        owner: resolved.owner,
                        repo: resolved.repo,
                        detectedOwner: resolved.detectedOwner,
                        detectedRepo: resolved.detectedRepo,
                        pullRequests,
                        count: pullRequests.length,
                    }
                } catch (err) {
                    return formatHandlerError(err)
                }
            },
        },
        {
            name: 'get_github_issue',
            title: 'Get GitHub Issue Details',
            description:
                'Get detailed information about a specific GitHub issue. IMPORTANT: Do NOT guess owner/repo values - leave them empty to auto-detect from the current git repository.',
            group: 'github',
            inputSchema: z.object({
                issue_number: z.number(),
                owner: z.string().optional().describe('LEAVE EMPTY to auto-detect from git'),
                repo: z.string().optional().describe('LEAVE EMPTY to auto-detect from git'),
            }),
            outputSchema: GitHubIssueResultOutputSchema,
            annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
            handler: async (params: unknown) => {
                try {
                    const input = z
                        .object({
                            issue_number: z.number(),
                            owner: z.string().optional(),
                            repo: z.string().optional(),
                        })
                        .parse(params)

                    const resolved = await resolveOwnerRepo(context, input, 'is this issue from')
                    if ('error' in resolved) return resolved.response

                    const issue = await resolved.github.getIssue(
                        resolved.owner,
                        resolved.repo,
                        input.issue_number
                    )
                    if (!issue) {
                        return {
                            success: false,
                            error: `Issue #${String(input.issue_number)} not found`,
                            owner: resolved.owner,
                            repo: resolved.repo,
                            detectedOwner: resolved.detectedOwner,
                            detectedRepo: resolved.detectedRepo,
                        }
                    }
                    return {
                        issue,
                        owner: resolved.owner,
                        repo: resolved.repo,
                        detectedOwner: resolved.detectedOwner,
                        detectedRepo: resolved.detectedRepo,
                    }
                } catch (err) {
                    return formatHandlerError(err)
                }
            },
        },
        {
            name: 'get_github_pr',
            title: 'Get GitHub PR Details',
            description:
                'Get detailed information about a specific GitHub pull request. IMPORTANT: Do NOT guess owner/repo values - leave them empty to auto-detect from the current git repository.',
            group: 'github',
            inputSchema: z.object({
                pr_number: z.number(),
                owner: z.string().optional().describe('LEAVE EMPTY to auto-detect from git'),
                repo: z.string().optional().describe('LEAVE EMPTY to auto-detect from git'),
            }),
            outputSchema: GitHubPRResultOutputSchema,
            annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
            handler: async (params: unknown) => {
                try {
                    const input = z
                        .object({
                            pr_number: z.number(),
                            owner: z.string().optional(),
                            repo: z.string().optional(),
                        })
                        .parse(params)

                    const resolved = await resolveOwnerRepo(context, input, 'is this PR from')
                    if ('error' in resolved) return resolved.response

                    const pullRequest = await resolved.github.getPullRequest(
                        resolved.owner,
                        resolved.repo,
                        input.pr_number
                    )
                    if (!pullRequest) {
                        return {
                            success: false,
                            error: `PR #${String(input.pr_number)} not found`,
                            owner: resolved.owner,
                            repo: resolved.repo,
                            detectedOwner: resolved.detectedOwner,
                            detectedRepo: resolved.detectedRepo,
                        }
                    }
                    return {
                        pullRequest,
                        owner: resolved.owner,
                        repo: resolved.repo,
                        detectedOwner: resolved.detectedOwner,
                        detectedRepo: resolved.detectedRepo,
                    }
                } catch (err) {
                    return formatHandlerError(err)
                }
            },
        },
        {
            name: 'get_github_context',
            title: 'Get GitHub Repository Context',
            description:
                'Get current repository context including branch, open issues, and open PRs. Only counts OPEN items (closed items excluded).',
            group: 'github',
            inputSchema: z.object({}).strict(),
            outputSchema: GitHubContextOutputSchema,
            annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
            handler: async (_params: unknown) => {
                try {
                    if (!context.github) {
                        return { success: false, error: 'GitHub integration not available' }
                    }

                    const ctx = await context.github.getRepoContext()
                    return {
                        repoName: ctx.repoName,
                        branch: ctx.branch,
                        commit: ctx.commit,
                        remoteUrl: ctx.remoteUrl,
                        issues: ctx.issues,
                        pullRequests: ctx.pullRequests,
                        issueCount: ctx.issues.length,
                        prCount: ctx.pullRequests.length,
                    }
                } catch (err) {
                    return formatHandlerError(err)
                }
            },
        },
    ]
}
