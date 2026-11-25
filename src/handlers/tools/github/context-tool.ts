import { z } from 'zod'
import type { ToolDefinition, ToolContext } from '../../../types/index.js'
import type { GitHubIntegration } from '../../../github/github-integration/index.js'
import { formatHandlerError } from '../../../utils/error-helpers.js'
import { fenceNonCanonicalRefOrKey, sanitizeRemoteUrl } from '../../../utils/security-utils.js'
import { GitHubContextOutputSchema } from './schemas.js'
import {
    fenceIssueMilestone,
    githubScopeInputFields,
    githubScopeParseFields,
    resolveOwnerRepo,
} from './helpers.js'
import {
    ensureInlineFenced,
    fenceGitHubPullRequestSummary,
} from './fencing-helpers.js'

const GetGitHubContextInputSchema = z.object({
    ...githubScopeInputFields,
    owner: z.string().optional().describe('Repository owner'),
    repo: z
        .string()
        .optional()
        .describe('Repository name (use this to switch projects dynamically)'),
})

const ContextInputSchema = z
    .object({
        owner: z.string().optional(),
        repo: z.string().optional(),
        ...githubScopeParseFields,
    })
    .strict()

async function executeGitHubContext(
    params: unknown,
    context: ToolContext
): Promise<Record<string, unknown>> {
    const input = ContextInputSchema.parse(params)
    const resolved = await resolveOwnerRepo(context, input, 'would you like the context for')

    let targetGithub: GitHubIntegration
    let target: { owner: string; repo: string } | undefined
    const configuredWs = context.config?.defaultWorkspaceId?.trim()
    const hasConcreteDefaultWs =
        configuredWs !== undefined &&
        configuredWs !== '' &&
        configuredWs !== '*' &&
        configuredWs.toLowerCase() !== 'default'
    const callerScoped =
        hasConcreteDefaultWs ||
        input.owner !== undefined ||
        input.repo !== undefined ||
        input.workspace_id !== undefined ||
        input.project_number !== undefined
    if ('error' in resolved) {
        if (
            callerScoped ||
            context.github === undefined ||
            resolved.response['code'] === 'VALIDATION_ERROR'
        ) {
            return resolved.response
        }
        targetGithub = context.github
    } else {
        targetGithub = resolved.github
        target = { owner: resolved.owner, repo: resolved.repo }
    }

    const ctx = await targetGithub.getRepoContext(undefined, target)
    const sanitizedRemoteUrl = sanitizeRemoteUrl(ctx.remoteUrl)
    return {
        repoName:
            ctx.repoName !== undefined && ctx.repoName !== null
                ? fenceNonCanonicalRefOrKey(ctx.repoName)
                : ctx.repoName,
        branch:
            ctx.branch !== undefined && ctx.branch !== null
                ? fenceNonCanonicalRefOrKey(ctx.branch)
                : ctx.branch,
        commit: ctx.commit,
        remoteUrl:
            sanitizedRemoteUrl !== null
                ? ensureInlineFenced(sanitizedRemoteUrl)
                : ctx.remoteUrl === null
                  ? null
                  : undefined,
        issues: ctx.issues.map((i) => ({
            ...fenceIssueMilestone(i),
            title: ensureInlineFenced(i.title),
        })),
        pullRequests: ctx.pullRequests.map(fenceGitHubPullRequestSummary),
        issueCount: ctx.issues.length,
        prCount: ctx.pullRequests.length,
        ...(ctx.degraded !== undefined ? { degraded: ctx.degraded } : {}),
        ...(ctx.degraded !== undefined && ctx.degraded.length > 0
            ? {
                  warning: `Partial GitHub context: failed to fetch ${ctx.degraded.join(', ')}`,
              }
            : {}),
    }
}

/** Build the `get_github_context` tool (extracted from `github/read-tools.ts`, Appendix A). */
export function createGitHubContextTool(context: ToolContext): ToolDefinition {
    return {
        name: 'get_github_context',
        title: 'Get GitHub Repository Context',
        description:
            'Get current repository context including branch, open issues, and open PRs. IMPORTANT: Leave owner/repo empty to auto-detect from git, OR specify the repository name if working in a multi-project registry.',
        group: 'github',
        inputSchema: GetGitHubContextInputSchema,
        outputSchema: GitHubContextOutputSchema,
        annotations: {
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: true,
        },
        handler: async (params: unknown) => {
            try {
                return await executeGitHubContext(params, context)
            } catch (err) {
                return formatHandlerError(err)
            }
        },
    }
}
