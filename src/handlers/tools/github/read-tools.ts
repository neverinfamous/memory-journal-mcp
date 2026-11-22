/**
 * GitHub Read Tools - 5 tools
 *
 * Tools: get_github_issues, get_github_prs, get_github_issue, get_github_pr, get_github_context
 */

import { z } from 'zod'
import type { ToolDefinition, ToolContext } from '../../../types/index.js'
import { formatHandlerError } from '../../../utils/error-helpers.js'
import { coerceIntString, relaxedNumber, MAX_QUERY_LIMIT } from '../schemas.js'
import {
    GitHubIssuesListOutputSchema,
    GitHubIssueResultOutputSchema,
    GitHubPRsListOutputSchema,
    GitHubPRResultOutputSchema,
} from './schemas.js'
import {
    fenceIssueMilestone,
    githubScopeInputFields,
    githubScopeParseFields,
    resolveOwnerRepo,
} from './helpers.js'
import {
    ensureBlockFenced,
    ensureInlineFenced,
    fenceGitHubIssueDetailsFields,
    fenceGitHubPullRequestDetails,
    fenceGitHubPullRequestSummary,
    fenceUntrustedHandle,
} from './fencing-helpers.js'
import { createGitHubContextTool } from './context-tool.js'

const GetGitHubIssueInputSchema = z
    .object({
        issue_number: z.preprocess(coerceIntString, z.number().int().positive()),
        owner: z.string().optional(),
        repo: z.string().optional(),
        ...githubScopeParseFields,
        truncate_body: z.preprocess(coerceIntString, z.number().int().min(0).max(100000)).optional().default(800),
        include_comments: z.boolean().optional().default(false),
    })
    .strict()

function truncateItemBody(
    body: string | null,
    truncateBody: number
): { body: string | null; bodyTruncated: boolean; bodyFullLength?: number } {
    if (truncateBody > 0 && body !== null && body !== '' && body.length > truncateBody) {
        const bodyFullLength = body.length
        const truncated =
            body.slice(0, truncateBody) +
            `\n\n[Truncated... remaining ${String(bodyFullLength - truncateBody)} chars]`
        return { body: truncated, bodyTruncated: true, bodyFullLength }
    }
    return { body, bodyTruncated: false }
}

async function executeGetGitHubIssue(context: ToolContext, params: unknown): Promise<unknown> {
    try {
        const input = GetGitHubIssueInputSchema.parse(params)
        const resolved = await resolveOwnerRepo(context, input, 'is this issue from')
        if ('error' in resolved) return resolved.response

        const issuePromise = resolved.github.getIssue(
            resolved.owner,
            resolved.repo,
            input.issue_number
        )
        const commentsPromise = input.include_comments
            ? resolved.github
                  .getIssueComments(resolved.owner, resolved.repo, input.issue_number)
                  .then(
                      (value) => ({ ok: true as const, value }),
                      (error: unknown) => ({ ok: false as const, error })
                  )
            : undefined

        const issue = await issuePromise
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

        // Clone issue to avoid mutating cache
        const safeIssue = fenceGitHubIssueDetailsFields(issue)
        const { body, bodyTruncated, bodyFullLength } = truncateItemBody(
            safeIssue.body,
            input.truncate_body
        )
        safeIssue.body = ensureBlockFenced(body)

        // Collect comments fetched concurrently when requested
        let comments: { author: string; body: string; createdAt: string }[] | undefined
        if (commentsPromise !== undefined) {
            const commentsResult = await commentsPromise
            if (!commentsResult.ok) throw commentsResult.error
            comments = commentsResult.value.map((c) => ({
                ...c,
                author: fenceUntrustedHandle(c.author),
                body: ensureBlockFenced(c.body),
            }))
        }

        return {
            issue: {
                ...safeIssue,
                bodyTruncated,
                ...(bodyFullLength !== undefined ? { bodyFullLength } : {}),
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
}

const GetGitHubIssuesSchemaMcp = z.object({
    ...githubScopeInputFields,
    owner: z.string().optional().describe('Repository owner - LEAVE EMPTY to auto-detect from git. Only specify if user explicitly provides.'),
    repo: z.string().optional().describe('Repository name - LEAVE EMPTY to auto-detect from git. Accepts repository name or full "owner/repo" slug.'),
    state: z.string().optional().default('open'),
    limit: relaxedNumber().optional().default(20),
})
const GetGitHubListInputSchema = z.object({
    owner: z.string().optional(),
    repo: z.string().optional(),
    ...githubScopeParseFields,
    state: z.enum(['open', 'closed', 'all']).optional().default('open'),
    limit: z.preprocess(coerceIntString, z.number().int().min(1).max(MAX_QUERY_LIMIT)).optional().default(20),
}).strict()
const GetGitHubIssueSchemaMcp = z.object({
    ...githubScopeInputFields,
    issue_number: relaxedNumber().optional(),
    owner: z.string().optional().describe('LEAVE EMPTY to auto-detect from git'),
    repo: z.string().optional().describe('LEAVE EMPTY to auto-detect from git'),
    truncate_body: relaxedNumber().optional().default(800).describe('Max characters for body text (0 = full body, default 800). Reduces token usage.'),
    include_comments: z.boolean().optional().default(false).describe('Include issue comments (default false). Each comment adds tokens.'),
})
const GetGitHubPrSchemaMcp = z.object({
    ...githubScopeInputFields,
    pr_number: relaxedNumber().optional(),
    owner: z.string().optional().describe('LEAVE EMPTY to auto-detect from git'),
    repo: z.string().optional().describe('LEAVE EMPTY to auto-detect from git'),
    truncate_body: relaxedNumber().optional().default(800).describe('Max characters for body text (0 = full body, default 800). Reduces token usage.'),
})
const GetGitHubPrInputSchema = z.object({
    pr_number: z.preprocess(coerceIntString, z.number().int().positive()),
    owner: z.string().optional(),
    repo: z.string().optional(),
    ...githubScopeParseFields,
    truncate_body: z.preprocess(coerceIntString, z.number().int().min(0).max(100000)).optional().default(800),
}).strict()

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
            inputSchema: GetGitHubIssuesSchemaMcp,
            outputSchema: GitHubIssuesListOutputSchema,
            annotations: {
                readOnlyHint: true,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: true,
            },
            handler: async (params: unknown) => {
                try {
                    const input = GetGitHubListInputSchema.parse(params)

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
                    const safeIssues = issues.map((issue) => ({
                        ...fenceIssueMilestone(issue),
                        title: ensureInlineFenced(issue.title),
                    }))
                    return {
                        owner: resolved.owner,
                        repo: resolved.repo,
                        detectedOwner: resolved.detectedOwner,
                        detectedRepo: resolved.detectedRepo,
                        issues: safeIssues,
                        count: safeIssues.length,
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
            inputSchema: GetGitHubIssuesSchemaMcp,
            outputSchema: GitHubPRsListOutputSchema,
            annotations: {
                readOnlyHint: true,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: true,
            },
            handler: async (params: unknown) => {
                try {
                    const input = GetGitHubListInputSchema.parse(params)

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
                    const safePrs = pullRequests.map(fenceGitHubPullRequestSummary)
                    return {
                        owner: resolved.owner,
                        repo: resolved.repo,
                        detectedOwner: resolved.detectedOwner,
                        detectedRepo: resolved.detectedRepo,
                        pullRequests: safePrs,
                        count: safePrs.length,
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
            inputSchema: GetGitHubIssueSchemaMcp,
            outputSchema: GitHubIssueResultOutputSchema,
            annotations: {
                readOnlyHint: true,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: true,
            },
            handler: async (params: unknown) => executeGetGitHubIssue(context, params),
        },
        {
            name: 'get_github_pr',
            title: 'Get GitHub PR Details',
            description:
                'Get detailed information about a specific GitHub pull request, including live prStatus. IMPORTANT: Do NOT guess owner/repo values - leave them empty to auto-detect from the current git repository.',
            group: 'github',
            inputSchema: GetGitHubPrSchemaMcp,
            outputSchema: GitHubPRResultOutputSchema,
            annotations: {
                readOnlyHint: true,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: true,
            },
            handler: async (params: unknown) => {
                try {
                    const input = GetGitHubPrInputSchema.parse(params)

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

                    // Clone PR and truncate BEFORE fencing to avoid slicing inside wrapper tags
                    const safePr = fenceGitHubPullRequestDetails(pullRequest)
                    const { body, bodyTruncated, bodyFullLength } = truncateItemBody(
                        safePr.body,
                        input.truncate_body
                    )
                    safePr.body = ensureBlockFenced(body)

                    return {
                        pullRequest: {
                            ...safePr,
                            bodyTruncated,
                            ...(bodyFullLength !== undefined ? { bodyFullLength } : {}),
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
        createGitHubContextTool(context),
    ]
}
