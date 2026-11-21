import { ICON_MILESTONE } from '../../constants/icons.js'
import { withPriority, ASSISTANT_FOCUSED } from '../../utils/resource-annotations.js'
import { markUntrustedContent } from '../../utils/security-utils.js'
import type { InternalResourceDef, ResourceContext, ResourceResult } from './shared.js'
import {
    getBaseUri,
    resolveScopedGitHubRepo,
    isResourceError,
    milestoneCompletionPct,
    safeDecodeUriSegment,
    fenceUntrustedInline,
    withResourceTokenMeta,
} from './shared.js'

function fenceMilestoneResource<
    T extends { title: string; description?: string | null; creator?: string | null },
>(ms: T): T {
    return {
        ...ms,
        title: fenceUntrustedInline(ms.title),
        ...(ms.description !== undefined && ms.description !== null
            ? { description: markUntrustedContent(ms.description) }
            : {}),
        ...(ms.creator !== undefined && ms.creator !== null
            ? { creator: fenceUntrustedInline(ms.creator) }
            : {}),
    }
}

/** Build milestone resource definitions (extracted from `resources/github.ts`, Appendix A). */
export function createGitHubMilestoneResources(resourceMilestoneLimit: number): InternalResourceDef[] {
    return [
        {
            uri: 'memory://github/milestones',
            name: 'GitHub Milestones',
            title: 'GitHub Repository Milestones',
            description:
                'Open GitHub milestones with completion percentages, due dates, and issue counts',
            mimeType: 'application/json',
            icons: [ICON_MILESTONE],
            annotations: withPriority(0.6, ASSISTANT_FOCUSED),
            handler: async (uri: string, context: ResourceContext): Promise<ResourceResult> => {
                const match = /^memory:\/\/github\/milestones(?:\/(.*))?$/.exec(getBaseUri(uri))
                const targetRepo = match?.[1] ? safeDecodeUriSegment(match[1]) : undefined
                const resolved = await resolveScopedGitHubRepo(context, targetRepo)
                if (isResourceError(resolved)) return resolved
                const { owner, repo, lastModified, github } = resolved

                const milestones = await github.getMilestones(
                    owner,
                    repo,
                    'open',
                    resourceMilestoneLimit
                )
                const milestonesWithProgress = milestones.map((ms) => ({
                    ...fenceMilestoneResource(ms),
                    completionPercentage: milestoneCompletionPct(ms.openIssues, ms.closedIssues),
                }))
                const responseData = {
                    repository: `${owner}/${repo}`,
                    milestones: milestonesWithProgress,
                    count: milestonesWithProgress.length,
                    hint: 'Use get_github_milestones tool for state filtering. Use memory://milestones/{number} for detail.',
                }
                return { data: withResourceTokenMeta(responseData), annotations: { lastModified } }
            },
        },
        {
            uri: 'memory://milestones/{number}',
            name: 'Milestone Detail',
            title: 'GitHub Milestone Detail',
            description:
                'Detailed view of a single GitHub milestone with completion progress and issue counts. Use get_github_issues with the milestone filter for individual issue details.',
            mimeType: 'application/json',
            icons: [ICON_MILESTONE],
            annotations: withPriority(0.6, ASSISTANT_FOCUSED),
            handler: async (uri: string, context: ResourceContext): Promise<ResourceResult> => {
                const lastModified = new Date().toISOString()
                const match = /^memory:\/\/milestones\/(?:(.+)\/)?([1-9]\d*)$/.exec(
                    getBaseUri(uri)
                )
                const targetRepo = match?.[1] ? safeDecodeUriSegment(match[1]) : undefined
                const milestoneNumber = match?.[2] ? Number.parseInt(match[2], 10) : null
                if (
                    milestoneNumber === null ||
                    !Number.isSafeInteger(milestoneNumber) ||
                    milestoneNumber <= 0
                ) {
                    return {
                        data: { error: 'Invalid milestone number', code: -32002 },
                        annotations: { lastModified },
                    }
                }
                const resolved = await resolveScopedGitHubRepo(context, targetRepo)
                if (isResourceError(resolved)) return resolved
                const { owner, repo, github } = resolved
                const milestone = await github.getMilestone(owner, repo, milestoneNumber)
                if (!milestone) {
                    return {
                        data: { error: `Milestone #${String(milestoneNumber)} not found`, code: -32002 },
                        annotations: { lastModified },
                    }
                }
                const responseData = {
                    repository: `${owner}/${repo}`,
                    milestone: {
                        ...fenceMilestoneResource(milestone),
                        completionPercentage: milestoneCompletionPct(
                            milestone.openIssues,
                            milestone.closedIssues
                        ),
                    },
                    hint: 'Use get_github_issues tool to list issues associated with this milestone.',
                }
                return {
                    data: withResourceTokenMeta(responseData),
                    annotations: { lastModified },
                }
            },
        },
    ]
}
