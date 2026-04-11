/**
 * GitHub Insights Tools - 1 tool
 *
 * Tools: get_repo_insights
 */

import { z } from 'zod'
import type { ToolDefinition, ToolContext } from '../../../types/index.js'
import { formatHandlerError } from '../../../utils/error-helpers.js'
import { RepoInsightsOutputSchema } from './schemas.js'
import { resolveOwnerRepo } from './helpers.js'

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

                    const resolved = await resolveOwnerRepo(
                        context,
                        input,
                        'should I get insights for'
                    )
                    if ('error' in resolved) return resolved.response

                    const owner = resolved.owner
                    const repo = resolved.repo

                    const section = input.sections
                    const result: z.infer<typeof RepoInsightsOutputSchema> = {
                        success: true,
                        owner,
                        repo,
                        section,
                    }

                    if (section === 'stars' || section === 'all') {
                        const stats = await resolved.github.getRepoStats(owner, repo)
                        if (stats) {
                            result.stars = stats.stars
                            result.forks = stats.forks
                            result.watchers = stats.watchers
                            result.openIssues = stats.openIssues
                            if (section === 'all') {
                                result.size = stats.size
                                result.defaultBranch = stats.defaultBranch
                            }
                        }
                    }

                    if (section === 'traffic' || section === 'all') {
                        const traffic = await resolved.github.getTrafficData(owner, repo)
                        if (traffic) {
                            result.traffic = traffic
                        }
                    }

                    if (section === 'referrers' || section === 'all') {
                        const referrers = await resolved.github.getTopReferrers(owner, repo, 5)
                        result.referrers = referrers
                    }

                    if (section === 'paths' || section === 'all') {
                        const paths = await resolved.github.getPopularPaths(owner, repo, 5)
                        result.paths = paths
                    }

                    return result
                } catch (err) {
                    return formatHandlerError(err)
                }
            },
        },
    ]
}
