/**
 * Memory Journal MCP Server - Graph Resource Definitions
 *
 * Resources: graph/recent, graph/actions, actions/recent
 */

import { ICON_GITHUB } from '../../constants/icons.js'
// removed ENTRY_COLUMNS
import { ASSISTANT_FOCUSED } from '../../utils/resource-annotations.js'
import type { InternalResourceDef, ResourceContext, ResourceResult } from './shared.js'
import { resolveGitHubRepo, isResourceError } from './shared.js'
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js'

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
                const match = /memory:\/\/actions\/recent\/?(.*)?/.exec(uri)
                const targetRepo = match?.[1] ? decodeURIComponent(match[1]) : undefined

                try {
                    const resolved = await resolveGitHubRepo(
                        context.github,
                        context.briefingConfig,
                        targetRepo,
                        context.runtime
                    )

                    if (!isResourceError(resolved)) {
                        const { owner, repo, github } = resolved
                        const runs = await github.getWorkflowRuns(owner, repo, 10)

                        const entries = runs.map((run) => ({
                            id: -1 * run.id,
                            entryType: 'tool_output',
                            content: `Workflow: ${run.name}\nStatus: ${run.status}\nConclusion: ${run.conclusion || 'pending'}\nBranch: ${run.headBranch}\nURL: ${run.url}`,
                            timestamp: run.createdAt,
                            isPersonal: false,
                            significanceType: null,
                            workflowRunId: run.id,
                            workflowName: run.name,
                            workflowStatus: run.conclusion || run.status,
                        }))

                        const data = { entries, count: entries.length, source: 'github_api' }
                        const tokenEstimate = Math.ceil(JSON.stringify(data).length / 4)
                        return { data: { ...data, _meta: { tokenEstimate } } }
                    } else if (targetRepo) {
                        throw new McpError(-32002, `Repository not found or GitHub integration unavailable for: ${targetRepo}`)
                    }
                } catch (error) {
                    if (error instanceof McpError) throw error;
                    if (targetRepo) {
                        throw new McpError(ErrorCode.InternalError, `GitHub integration failed: ${error instanceof Error ? error.message : String(error)}`)
                    }
                    // Fallback to DB if GitHub fails for default case
                }

                const entries = context.db.getWorkflowActionEntries(10)
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
