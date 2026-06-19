/**
 * Memory Journal MCP Server - Graph Resource Definitions
 *
 * Resources: graph/recent, graph/actions, actions/recent
 */

import { ICON_GITHUB } from '../../constants/icons.js'
// removed ENTRY_COLUMNS
import { ASSISTANT_FOCUSED } from '../../utils/resource-annotations.js'
import type { InternalResourceDef, ResourceContext } from './shared.js'
import { resolveGitHubRepo, isResourceError } from './shared.js'

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
            handler: async (uri: string, context: ResourceContext) => {
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

                        return { entries, count: entries.length, source: 'github_api' }
                    }
                } catch {
                    // Fallback to DB if GitHub fails
                }

                const entries = context.db.getWorkflowActionEntries(10)
                return { entries, count: entries.length, source: 'database' }
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
