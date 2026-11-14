/**
 * Memory Journal MCP Server - Kanban Template Resource Definitions
 *
 * Extracted from templates.ts to keep resource modules under 500 lines
 * and preserve cache immutability when stripping large item bodies (M10).
 */

import { ProtocolError, ProtocolErrorCode } from '@modelcontextprotocol/server'
import { MEDIUM_PRIORITY } from '../../utils/resource-annotations.js'
import type { InternalResourceDef, ResourceContext } from './shared.js'
import { getBaseUri, isResourceError, resolveScopedGitHubRepo } from './shared.js'
import { resolveProjectScope } from './template-helpers.js'

/** Build Kanban board resource definitions, including dynamic `{+repo}` variants. */
export function getKanbanTemplateDefinitions(): InternalResourceDef[] {
    const baseDefinitions: InternalResourceDef[] = [
        {
            uri: 'memory://kanban/{project_number}',
            name: 'Kanban Board',
            title: 'GitHub Project Kanban Board',
            description: 'View a GitHub Project v2 as a Kanban board with items grouped by Status',
            mimeType: 'application/json',
            annotations: { ...MEDIUM_PRIORITY, audience: ['assistant'] },
            handler: async (uri: string, context: ResourceContext) => {
                const match = /memory:\/\/kanban\/(?:(.*)\/)?(\d+)$/.exec(getBaseUri(uri))
                const targetRepo = match?.[1] ? decodeURIComponent(match[1]) : undefined
                const projectNumber = match?.[2] ? parseInt(match[2], 10) : null

                if (projectNumber === null) {
                    throw new ProtocolError(ProtocolErrorCode.InvalidParams, 'Invalid project number')
                }

                const projScope =
                    targetRepo === undefined ? resolveProjectScope(context, projectNumber) : undefined
                if (projScope?.hint !== undefined) {
                    return {
                        projectNumber,
                        status: 'unresolved',
                        error: projScope.hint,
                        hint: projScope.hint,
                    }
                }
                const kanbanTarget =
                    targetRepo ??
                    (projScope !== undefined && projScope.workspaceId !== 'default'
                        ? projScope.workspaceId
                        : undefined)
                const resolved = await resolveScopedGitHubRepo(context, kanbanTarget)
                if (isResourceError(resolved)) return resolved.data
                const { owner, repo, github } = resolved

                const board = await github.getProjectKanban(owner, projectNumber, repo)
                if (!board) {
                    throw new ProtocolError(
                        ProtocolErrorCode.InternalError,
                        `Project #${String(projectNumber)} not found or Status field not configured`
                    )
                }

                // [INVARIANT] M10: Return cloned columns/items so cached board data is never mutated.
                const sanitizedBoard = {
                    ...board,
                    columns: board.columns.map((column) => ({
                        ...column,
                        items: column.items.map((item) => {
                            if (!('body' in item)) return item
                            const cloned = { ...item }
                            Reflect.deleteProperty(cloned, 'body')
                            return cloned
                        }),
                    })),
                }

                const tokenEstimate = Math.ceil(JSON.stringify(sanitizedBoard).length / 4)
                return { ...sanitizedBoard, _meta: { tokenEstimate } }
            },
        },
    ]

    const dynamicDefinitions: InternalResourceDef[] = baseDefinitions.map((def) => ({
        ...def,
        uri: def.uri.replace('{project_number}', '{+repo}/{project_number}'),
        name: `${def.name} (Dynamic)`,
        description: `${def.description} (Supports explicit multi-project repository targeting via {repo})`,
    }))

    return [...baseDefinitions, ...dynamicDefinitions]
}
