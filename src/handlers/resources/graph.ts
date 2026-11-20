/**
 * Memory Journal MCP Server - Graph Resource Definitions
 *
 * Resources:
 * - memory://graph, memory://graph/{+repo} — compact recent relationship neighborhood
 *   (edge list + node labels + unlinked ids; no full content). Query: `?days=14&limit=40`.
 * - memory://actions/recent, memory://actions/recent/{+repo} — recent workflow runs
 */

import { ICON_GITHUB } from '../../constants/icons.js'
// removed ENTRY_COLUMNS
import { ASSISTANT_FOCUSED, withPriority } from '../../utils/resource-annotations.js'
import type { InternalResourceDef, ResourceContext, ResourceResult } from './shared.js'
import {
    getBaseUri,
    resolveScopedGitHubRepo,
    isResourceError,
    resourceWorkspace,
    safeDecodeUriSegment,
} from './shared.js'
import { markUntrustedContentInline } from '../../utils/security-utils.js'
import { sanitizeErrorMessageForResponse } from '../../utils/error-helpers.js'
import { ProtocolError, ProtocolErrorCode } from '@modelcontextprotocol/server'
import { buildGraphNeighborhoodMarkdown } from './graph-neighborhood.js'

/** memory://graph resources (static + dynamic repo template). */
export function getGraphNeighborhoodResourceDefinitions(): InternalResourceDef[] {
    const handler = (uri: string, context: ResourceContext): ResourceResult => {
        const match = /^memory:\/\/graph(?:\/(.+))?$/.exec(getBaseUri(uri))
        const repo = match?.[1] !== undefined ? safeDecodeUriSegment(match[1]) : undefined
        return { data: buildGraphNeighborhoodMarkdown(uri, context, repo) }
    }
    const base = {
        mimeType: 'text/markdown',
        annotations: withPriority(0.6, ASSISTANT_FOCUSED),
        handler,
    }
    return [
        {
            ...base,
            uri: 'memory://graph',
            name: 'Graph Neighborhood',
            title: 'Recent Relationship Neighborhood',
            description:
                'Compact edge list of the recent (default 14d) relationship neighborhood for the active workspace: node labels, link degrees, and unlinked entry ids. Query: ?days=1-90&limit=1-100.',
        },
        {
            ...base,
            uri: 'memory://graph/{+repo}',
            name: 'Graph Neighborhood (Dynamic)',
            title: 'Project Relationship Neighborhood',
            description:
                'Same as memory://graph for an explicit registered repository/workspace (e.g. memory://graph/my-repo?days=14).',
        },
    ]
}

/**
 * Get graph resource definitions
 */
export function getGraphResourceDefinitions(): InternalResourceDef[] {
    return [
        {
            uri: 'memory://actions/recent',
            name: 'Recent Actions',
            title: 'Recent Workflow Runs',
            description: 'Recent workflow runs with CI status',
            mimeType: 'application/json',
            icons: [ICON_GITHUB],
            annotations: ASSISTANT_FOCUSED,
            handler: async (uri: string, context: ResourceContext): Promise<ResourceResult> => {
                const match = /^memory:\/\/actions\/recent(?:\/(.+))?$/.exec(getBaseUri(uri))
                const targetRepo =
                    match?.[1] !== undefined ? safeDecodeUriSegment(match[1]) : undefined

                try {
                    const resolved = await resolveScopedGitHubRepo(context, targetRepo)

                    if (!isResourceError(resolved)) {
                        const { owner, repo, github } = resolved
                        const runs = await github.getWorkflowRuns(owner, repo, 10)

                        const entries = runs.map((run) => ({
                            id: -1 * run.id,
                            entryType: 'tool_output',
                            content: `Workflow: ${markUntrustedContentInline(run.name)}\nStatus: ${markUntrustedContentInline(run.status)}\nConclusion: ${run.conclusion ? markUntrustedContentInline(run.conclusion) : 'pending'}\nBranch: ${markUntrustedContentInline(run.headBranch)}\nURL: ${run.url}`,
                            timestamp: run.createdAt,
                            isPersonal: false,
                            significanceType: null,
                            workflowRunId: run.id,
                            workflowName: markUntrustedContentInline(run.name),
                            workflowStatus: markUntrustedContentInline(
                                run.conclusion || run.status
                            ),
                        }))

                        const data = { entries, count: entries.length, source: 'github_api' }
                        const tokenEstimate = Math.ceil(JSON.stringify(data).length / 4)
                        return { data: { ...data, _meta: { tokenEstimate } } }
                    } else if (targetRepo) {
                        throw new ProtocolError(ProtocolErrorCode.InternalError,  `Repository not found or GitHub integration unavailable for: ${targetRepo}`)
                    }
                } catch (error) {
                    if (error instanceof ProtocolError) throw error;
                    if (targetRepo) {
                        const rawErr = error instanceof Error ? error.message : String(error)
                        throw new ProtocolError(
                            ProtocolErrorCode.InternalError,
                            `GitHub integration failed: ${sanitizeErrorMessageForResponse(rawErr)}`
                        )
                    }
                    // Fallback to DB if GitHub fails for default case
                }

                const entries = context.db.getWorkflowActionEntries(10, resourceWorkspace(context))
                const data = { entries, count: entries.length, source: 'database' }
                const tokenEstimate = Math.ceil(JSON.stringify(data).length / 4)
                return { data: { ...data, _meta: { tokenEstimate } } }
            },
        },
    ]
}

export function getDynamicGraphResourceDefinitions(): InternalResourceDef[] {
    const definitions = getGraphResourceDefinitions()
    const dynamicDefinitions: InternalResourceDef[] = []

    for (const def of definitions) {
        if (def.uri === 'memory://actions/recent') {
            dynamicDefinitions.push({
                ...def,
                uri: def.uri + '/{+repo}',
                name: def.name + ' (Dynamic)',
                description:
                    def.description +
                    ' (Supports explicit multi-project repository targeting via {repo})',
            })
        }
    }

    return [...definitions, ...dynamicDefinitions, ...getGraphNeighborhoodResourceDefinitions()]
}
