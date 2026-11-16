/**
 * GitHub Insights Tools - 1 tool
 *
 * Tools: get_repo_insights
 */

import { z } from 'zod'
import type { ToolDefinition, ToolContext } from '../../../types/index.js'
import { formatHandlerError } from '../../../utils/error-helpers.js'
import { markUntrustedContentInline } from '../../../utils/security-utils.js'
import { RepoInsightsOutputSchema } from './schemas.js'
import { githubScopeInputFields, githubScopeParseFields, resolveOwnerRepo } from './helpers.js'

const INSIGHT_SECTIONS = ['stars', 'traffic', 'referrers', 'paths', 'all'] as const
type InsightSectionKey = 'stars' | 'traffic' | 'referrers' | 'paths'
type RepoInsightsResult = z.infer<typeof RepoInsightsOutputSchema>

const RepoInsightsInputSchema = z.object({
    sections: z
        .union([z.enum(INSIGHT_SECTIONS), z.array(z.enum(INSIGHT_SECTIONS))])
        .optional()
        .default('stars'),
    owner: z.string().optional(),
    repo: z.string().optional(),
    ...githubScopeParseFields,
})

function buildInsightSectionFailure(
    owner: string,
    repo: string,
    label: string
): {
    success: false
    error: string
    code: 'GITHUB_API_ERROR'
    category: 'connection'
    recoverable: true
} {
    return {
        success: false,
        error: `Failed to fetch repository ${label} for ${owner}/${repo}`,
        code: 'GITHUB_API_ERROR',
        category: 'connection',
        recoverable: true,
    }
}

function parseInsightSections(
    sections: z.infer<typeof RepoInsightsInputSchema>['sections']
): { sectionSet: Set<(typeof INSIGHT_SECTIONS)[number]>; section: string } {
    const rawList = Array.isArray(sections)
        ? sections.length > 0
            ? sections
            : (['stars'] as const)
        : [sections]
    const sectionSet = new Set<(typeof INSIGHT_SECTIONS)[number]>(rawList)
    let section: string
    if (sectionSet.has('all')) {
        section = 'all'
    } else if (sectionSet.size === 1) {
        section = Array.from(sectionSet)[0] ?? 'stars'
    } else {
        section = Array.from(sectionSet).join(',')
    }
    return { sectionSet, section }
}

async function fetchRepoInsightSections(
    github: NonNullable<ToolContext['github']>,
    owner: string,
    repo: string,
    sectionSet: Set<(typeof INSIGHT_SECTIONS)[number]>,
    result: RepoInsightsResult
): Promise<Record<string, unknown> | undefined> {
    const hasSection = (s: InsightSectionKey): boolean => sectionSet.has('all') || sectionSet.has(s)

    if (hasSection('stars')) {
        const stats = await github.getRepoStats(owner, repo)
        if (stats === null) return buildInsightSectionFailure(owner, repo, 'stats')
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
        const traffic = await github.getTrafficData(owner, repo)
        if (traffic === null) return buildInsightSectionFailure(owner, repo, 'traffic')
        result.traffic = traffic
    }

    if (hasSection('referrers')) {
        const referrers = await github.getTopReferrers(owner, repo, 5)
        if (referrers === null) return buildInsightSectionFailure(owner, repo, 'referrers')
        result.referrers = referrers.map((r) => ({
            ...r,
            referrer: markUntrustedContentInline(r.referrer),
        }))
    }

    if (hasSection('paths')) {
        const paths = await github.getPopularPaths(owner, repo, 5)
        if (paths === null) return buildInsightSectionFailure(owner, repo, 'paths')
        result.paths = paths.map((p) => ({
            ...p,
            path: markUntrustedContentInline(p.path),
            title: markUntrustedContentInline(p.title),
        }))
    }

    return undefined
}

async function executeGetRepoInsights(context: ToolContext, params: unknown): Promise<unknown> {
    try {
        const input = RepoInsightsInputSchema.parse(params)
        const resolved = await resolveOwnerRepo(context, input, 'should I get insights for')
        if ('error' in resolved) return resolved.response

        const { owner, repo } = resolved
        const { sectionSet, section } = parseInsightSections(input.sections)
        const result: RepoInsightsResult = {
            success: true,
            owner,
            repo,
            section,
        }

        const failure = await fetchRepoInsightSections(
            resolved.github,
            owner,
            repo,
            sectionSet,
            result
        )
        return failure ?? result
    } catch (err) {
        return formatHandlerError(err)
    }
}

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
                        z.enum(INSIGHT_SECTIONS),
                        z.array(z.enum(INSIGHT_SECTIONS)),
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
            handler: async (params: unknown) => executeGetRepoInsights(context, params),
        },
    ]
}
