/**
 * GitHub Read Tools - 5 tools
 *
 * Tools: get_github_issues, get_github_prs, get_github_issue, get_github_pr, get_github_context
 */

import { z } from 'zod'
import type { ToolDefinition, ToolContext } from '../../../types/index.js'
import { formatHandlerError } from '../../../utils/error-helpers.js'
import { relaxedNumber } from '../schemas.js'
import { MAX_QUERY_LIMIT } from '../schemas.js'
import {
    GitHubIssuesListOutputSchema,
    GitHubIssueResultOutputSchema,
    GitHubPRsListOutputSchema,
    GitHubPRResultOutputSchema,
    GitHubContextOutputSchema,
} from './schemas.js'
import { resolveOwnerRepo } from './helpers.js'
import type { GitHubIntegration } from '../../../github/github-integration/index.js'

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
                limit: relaxedNumber().optional().default(20),
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
                            limit: z.number().max(MAX_QUERY_LIMIT).optional().default(20),
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
                limit: relaxedNumber().optional().default(20),
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
                            limit: z.number().max(MAX_QUERY_LIMIT).optional().default(20),
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
                truncate_body: relaxedNumber()
                    .optional()
                    .default(800)
                    .describe(
                        'Max characters for body text (0 = full body, default 800). Reduces token usage.'
                    ),
                include_comments: z
                    .boolean()
                    .optional()
                    .default(false)
                    .describe('Include issue comments (default false). Each comment adds tokens.'),
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
                            truncate_body: z.number().optional().default(800),
                            include_comments: z.boolean().optional().default(false),
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
                            code: 'RESOURCE_NOT_FOUND',
                            category: 'resource',
                            suggestion: 'Verify the issue number exists in this repository.',
                            recoverable: true,
                            owner: resolved.owner,
                            repo: resolved.repo,
                            detectedOwner: resolved.detectedOwner,
                            detectedRepo: resolved.detectedRepo,
                        }
                    }

                    // Apply body truncation
                    const truncateBody = input.truncate_body
                    let bodyTruncated = false
                    let bodyFullLength: number | undefined
                    if (truncateBody > 0 && issue.body && issue.body.length > truncateBody) {
                        bodyFullLength = issue.body.length
                        const remaining = issue.body.length - truncateBody
                        issue.body =
                            issue.body.slice(0, truncateBody) +
                            `\n[Truncated. Re-run with truncate_body: 0 to view remaining ${String(remaining)} chars]`
                        bodyTruncated = true
                    }

                    // Fetch comments if requested
                    let comments: { author: string; body: string; createdAt: string }[] | undefined
                    if (input.include_comments) {
                        comments = await resolved.github.getIssueComments(
                            resolved.owner,
                            resolved.repo,
                            input.issue_number
                        )
                    }

                    return {
                        issue: {
                            ...issue,
                            ...(bodyTruncated ? { bodyTruncated: true, bodyFullLength } : {}),
                        },
                        ...(comments ? { comments, commentCount: comments.length } : {}),
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
                truncate_body: relaxedNumber()
                    .optional()
                    .default(800)
                    .describe(
                        'Max characters for body text (0 = full body, default 800). Reduces token usage.'
                    ),
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
                            truncate_body: z.number().optional().default(800),
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
                            code: 'RESOURCE_NOT_FOUND',
                            category: 'resource',
                            suggestion: 'Verify the PR number exists in this repository.',
                            recoverable: true,
                            owner: resolved.owner,
                            repo: resolved.repo,
                            detectedOwner: resolved.detectedOwner,
                            detectedRepo: resolved.detectedRepo,
                        }
                    }

                    // Apply body truncation
                    const truncateBody = input.truncate_body
                    let bodyTruncated = false
                    let bodyFullLength: number | undefined
                    if (
                        truncateBody > 0 &&
                        pullRequest.body &&
                        pullRequest.body.length > truncateBody
                    ) {
                        bodyFullLength = pullRequest.body.length
                        const remaining = pullRequest.body.length - truncateBody
                        pullRequest.body =
                            pullRequest.body.slice(0, truncateBody) +
                            `\n[Truncated. Re-run with truncate_body: 0 to view remaining ${String(remaining)} chars]`
                        bodyTruncated = true
                    }

                    return {
                        pullRequest: {
                            ...pullRequest,
                            ...(bodyTruncated ? { bodyTruncated: true, bodyFullLength } : {}),
                        },
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
                'Get current repository context including branch, open issues, and open PRs. IMPORTANT: Leave owner/repo empty to auto-detect from git, OR specify the repository name if working in a multi-project registry.',
            group: 'github',
            inputSchema: z.object({
                owner: z.string().optional().describe('Repository owner'),
                repo: z
                    .string()
                    .optional()
                    .describe('Repository name (use this to switch projects dynamically)'),
            }),
            outputSchema: GitHubContextOutputSchema,
            annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
            handler: async (params: unknown) => {
                try {
                    const input = z
                        .object({
                            owner: z.string().optional(),
                            repo: z.string().optional(),
                        })
                        .parse(params)

                    const resolved = await resolveOwnerRepo(
                        context,
                        input,
                        'would you like the context for'
                    )

                    let targetGithub: GitHubIntegration
                    if ('error' in resolved) {
                        // Maintain strict payload contract: gracefully degrade instead of erroring
                        // when no specific repo input is provided and auto-detect fails.
                        if (!context.github) return resolved.response
                        targetGithub = context.github
                    } else {
                        targetGithub = resolved.github
                    }

                    const ctx = await targetGithub.getRepoContext()
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
