/**
 * Memory Journal MCP Server - Graph Resource Definitions
 *
 * Resources: graph/recent, graph/actions, actions/recent
 */

import { ICON_GITHUB } from '../../constants/icons.js'
// removed ENTRY_COLUMNS
import { ASSISTANT_FOCUSED } from '../../utils/resource-annotations.js'
import type { InternalResourceDef, ResourceContext, ResourceResult } from './shared.js'
import {
    getBaseUri,
    resolveScopedGitHubRepo,
    isResourceError,
    resourceWorkspace,
} from './shared.js'
import { markUntrustedContentInline } from '../../utils/security-utils.js'
import { ProtocolError, ProtocolErrorCode } from '@modelcontextprotocol/server'

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
                const match = /^memory:\/\/actions\/recent(?:\/(.*))?$/.exec(getBaseUri(uri))
                const targetRepo = match?.[1] ? decodeURIComponent(match[1]) : undefined

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
                        throw new ProtocolError(ProtocolErrorCode.InternalError,  `GitHub integration failed: ${error instanceof Error ? error.message : String(error)}`)
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

    return [...definitions, ...dynamicDefinitions]
}
