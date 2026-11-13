/**
 * GitHub Insights Tools - 1 tool
 *
 * Tools: get_repo_insights
 */

import { z } from 'zod'
import type { ToolDefinition, ToolContext } from '../../../types/index.js'
import { formatHandlerError } from '../../../utils/error-helpers.js'
import { RepoInsightsOutputSchema } from './schemas.js'
import { githubScopeInputFields, githubScopeParseFields, resolveOwnerRepo } from './helpers.js'

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
                ...githubScopeInputFields,
                sections: z
                    .union([
                        z.enum(['stars', 'traffic', 'referrers', 'paths', 'all']),
                        z.array(z.enum(['stars', 'traffic', 'referrers', 'paths', 'all'])),
                    ])
                    .optional()
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
                            sections: z
                                .union([
                                    z.enum(['stars', 'traffic', 'referrers', 'paths', 'all']),
                                    z.array(
                                        z.enum(['stars', 'traffic', 'referrers', 'paths', 'all'])
                                    ),
                                ])
                                .optional()
                                .default('stars'),
                            owner: z.string().optional(),
                            repo: z.string().optional(),
                            ...githubScopeParseFields,
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

                    const sectionSet = new Set(
                        Array.isArray(input.sections)
                            ? input.sections.length > 0
                                ? input.sections
                                : ['stars' as const]
                            : [input.sections]
                    )
                    const hasSection = (
                        s: 'stars' | 'traffic' | 'referrers' | 'paths'
                    ): boolean => sectionSet.has('all') || sectionSet.has(s)
                    const section =
                        sectionSet.has('all')
                            ? 'all'
                            : sectionSet.size === 1
                              ? Array.from(sectionSet)[0] ?? 'stars'
                              : Array.from(sectionSet).join(',')

                    const result: z.infer<typeof RepoInsightsOutputSchema> = {
                        success: true,
                        owner,
                        repo,
                        section,
                    }

                    const sectionFailure = (
                        label: string
                    ): {
                        success: false
                        error: string
                        code: 'GITHUB_API_ERROR'
                        category: 'connection'
                        recoverable: true
                    } => ({
                        success: false,
                        error: `Failed to fetch repository ${label} for ${owner}/${repo}`,
                        code: 'GITHUB_API_ERROR',
                        category: 'connection',
                        recoverable: true,
                    })

                    if (hasSection('stars')) {
                        const stats = await resolved.github.getRepoStats(owner, repo)
                        if (stats === null) {
                            return sectionFailure('stats')
                        }
                        result.stars = stats.stars
                        result.forks = stats.forks
                        result.watchers = stats.watchers
                        result.openIssues = stats.openIssues
                        if (sectionSet.has('all')) {
                            result.size = stats.size
                            result.defaultBranch = stats.defaultBranch
                        }
                    }

                    if (hasSection('traffic')) {
                        const traffic = await resolved.github.getTrafficData(owner, repo)
                        if (traffic === null) {
                            return sectionFailure('traffic')
                        }
                        result.traffic = traffic
                    }

                    if (hasSection('referrers')) {
                        const referrers = await resolved.github.getTopReferrers(owner, repo, 5)
                        if (referrers === null) {
                            return sectionFailure('referrers')
                        }
                        result.referrers = referrers
                    }

                    if (hasSection('paths')) {
                        const paths = await resolved.github.getPopularPaths(owner, repo, 5)
                        if (paths === null) {
                            return sectionFailure('paths')
                        }
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
