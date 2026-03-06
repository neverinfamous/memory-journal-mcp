/**
 * GitHub Insights Tools - 1 tool
 *
 * Tools: get_repo_insights
 */

import { z } from 'zod'
import type { ToolDefinition, ToolContext } from '../../../types/index.js'
import { formatHandlerError } from '../../../utils/error-helpers.js'
import { RepoInsightsOutputSchema } from './schemas.js'

// ============================================================================
// Tool Definitions
// ============================================================================

export function getGitHubInsightsTools(context: ToolContext): ToolDefinition[] {
    return [
        {
            name: 'get_repo_insights',
            title: 'Repository Insights',
            description:
                'Get repository insights: stars, forks, traffic (clones/views), referrers, and popular paths. Use "sections" to control token usage: stars (~50 tokens), traffic (~100), referrers (~100), paths (~100), or all (~350).',
            group: 'github',
            inputSchema: z.object({
                sections: z
                    .enum(['stars', 'traffic', 'referrers', 'paths', 'all'])
                    .optional()
                    .default('stars')
                    .describe(
                        'Data section to return (default: stars). Use "all" for full payload.'
                    ),
                owner: z
                    .string()
                    .optional()
                    .describe('Repository owner - LEAVE EMPTY to auto-detect'),
                repo: z
                    .string()
                    .optional()
                    .describe('Repository name - LEAVE EMPTY to auto-detect'),
            }),
            outputSchema: RepoInsightsOutputSchema,
            annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
            handler: async (params: unknown) => {
                try {
                    const input = z
                        .object({
                            sections: z
                                .enum(['stars', 'traffic', 'referrers', 'paths', 'all'])
                                .optional()
                                .default('stars'),
                            owner: z.string().optional(),
                            repo: z.string().optional(),
                        })
                        .parse(params)

                    if (!context.github) {
                        return { error: 'GitHub integration not available' }
                    }

                    const repoInfo = await context.github.getRepoInfo()
                    const owner = input.owner ?? repoInfo.owner ?? undefined
                    const repo = input.repo ?? repoInfo.repo ?? undefined

                    if (!owner || !repo) {
                        return {
                            error: 'STOP: Could not auto-detect repository. DO NOT GUESS. You MUST ask the user to provide the GitHub owner and repository name.',
                            requiresUserInput: true,
                            instruction:
                                'Ask the user: "What GitHub repository should I get insights for? Please provide the owner and repo name (e.g., owner/repo)."',
                        }
                    }

                    const section = input.sections
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- building response dynamically
                    const result: Record<string, any> = {
                        owner,
                        repo,
                        section,
                    }

                    if (section === 'stars' || section === 'all') {
                        const stats = await context.github.getRepoStats(owner, repo)
                        if (stats) {
                            result['stars'] = stats.stars
                            result['forks'] = stats.forks
                            result['watchers'] = stats.watchers
                            result['openIssues'] = stats.openIssues
                            if (section === 'all') {
                                result['size'] = stats.size
                                result['defaultBranch'] = stats.defaultBranch
                            }
                        }
                    }

                    if (section === 'traffic' || section === 'all') {
                        const traffic = await context.github.getTrafficData(owner, repo)
                        if (traffic) {
                            result['traffic'] = traffic
                        }
                    }

                    if (section === 'referrers' || section === 'all') {
                        const referrers = await context.github.getTopReferrers(owner, repo, 5)
                        result['referrers'] = referrers
                    }

                    if (section === 'paths' || section === 'all') {
                        const paths = await context.github.getPopularPaths(owner, repo, 5)
                        result['paths'] = paths
                    }

                    return result
                } catch (err) {
                    return formatHandlerError(err)
                }
            },
        },
    ]
}
