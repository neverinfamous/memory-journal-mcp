import { z } from 'zod'
import type { ToolDefinition, ToolContext } from '../../../types/index.js'
import type { GitHubIntegration } from '../../../github/github-integration/index.js'
import { formatHandlerError } from '../../../utils/error-helpers.js'
import { GitHubContextOutputSchema } from './schemas.js'
import {
    fenceIssueMilestone,
    githubScopeInputFields,
    githubScopeParseFields,
    resolveOwnerRepo,
} from './helpers.js'

/** Build the `get_github_context` tool (extracted from `github/read-tools.ts`, Appendix A). */
export function createGitHubContextTool(context: ToolContext): ToolDefinition {
    return {
        name: 'get_github_context',
        title: 'Get GitHub Repository Context',
        description:
            'Get current repository context including branch, open issues, and open PRs. IMPORTANT: Leave owner/repo empty to auto-detect from git, OR specify the repository name if working in a multi-project registry.',
        group: 'github',
        inputSchema: z.object({
            ...githubScopeInputFields,
            owner: z.string().optional().describe('Repository owner'),
            repo: z
                .string()
                .optional()
                .describe('Repository name (use this to switch projects dynamically)'),
        }),
        outputSchema: GitHubContextOutputSchema,
        annotations: {
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: true,
        },
        handler: async (params: unknown) => {
            try {
                const input = z
                    .object({
                        owner: z.string().optional(),
                        repo: z.string().optional(),
                        ...githubScopeParseFields,
                    })
                    .strict()
                    .parse(params)

                const resolved = await resolveOwnerRepo(
                    context,
                    input,
                    'would you like the context for'
                )

                let targetGithub: GitHubIntegration
                let target: { owner: string; repo: string } | undefined
                const callerScoped =
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
                return {
                    repoName: ctx.repoName,
                    branch: ctx.branch,
                    commit: ctx.commit,
                    remoteUrl: ctx.remoteUrl,
                    issues: ctx.issues.map(fenceIssueMilestone),
                    pullRequests: ctx.pullRequests,
                    issueCount: ctx.issues.length,
                    prCount: ctx.pullRequests.length,
                    ...(ctx.degraded !== undefined ? { degraded: ctx.degraded } : {}),
                    ...(ctx.degraded !== undefined && ctx.degraded.length > 0
                        ? {
                              warning: `Partial GitHub context: failed to fetch ${ctx.degraded.join(', ')}`,
                          }
                        : {}),
                }
            } catch (err) {
                return formatHandlerError(err)
            }
        },
    }
}
