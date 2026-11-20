import { z } from 'zod'
import type { ToolDefinition, ToolContext } from '../../../types/index.js'
import { formatHandlerError } from '../../../utils/error-helpers.js'
import { resolveWorkspaceId } from '../../../utils/workspace-resolver.js'
import { activeProjectRegistry, alignedProjectFilter } from '../../../utils/write-scope.js'
import { coerceNumber } from '../../../utils/query-helpers.js'
import { parsePositiveProjectNumber } from '../../../utils/safe-positive-int.js'
import { VectorStatsOutputSchema } from './schemas.js'
import { EntriesListOutputSchema, MAX_QUERY_LIMIT, relaxedNumber } from '../schemas.js'

function preprocessProjectNumber(val: unknown): unknown {
    if (val === undefined || val === null || (typeof val === 'string' && val.trim() === '')) return undefined
    const parsed = parsePositiveProjectNumber(val)
    return parsed ?? Number.NaN
}

const EmptyStrictSchema = z.object({}).strict()

const ListDeletedEntriesMcpSchema = z.object({
    limit: relaxedNumber().optional().default(50),
    offset: relaxedNumber().optional().default(0),
    workspace_id: z.string().optional().describe('Filter by workspace ID, or "*" for all workspaces'),
    workspaceId: z.string().optional().describe('Workspace identifier alias'),
    project_number: relaxedNumber().optional().describe('Filter by numeric project ID'),
    projectNumber: relaxedNumber().optional().describe('Project number alias'),
})

const ListDeletedEntriesStrictSchema = z
    .object({
        limit: z.preprocess(
            coerceNumber,
            z.number().int().min(1).max(MAX_QUERY_LIMIT).optional().default(50)
        ),
        offset: z.preprocess(coerceNumber, z.number().int().min(0).optional().default(0)),
        workspace_id: z.string().max(255).optional(),
        workspaceId: z.string().max(255).optional(),
        project_number: z.preprocess(preprocessProjectNumber, z.number().int().positive().optional()),
        projectNumber: z.preprocess(preprocessProjectNumber, z.number().int().positive().optional()),
    })
    .strict()

const READ_ONLY_ANNOTATIONS = {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
} as const

export function getMiscSearchTools(context: ToolContext): ToolDefinition[] {
    const { db, vectorManager } = context;
    return [
        {
            name: 'get_vector_index_stats',
            title: 'Get Vector Index Stats',
            description: 'Get statistics about the semantic search vector index',
            group: 'search',
            inputSchema: EmptyStrictSchema,
            outputSchema: VectorStatsOutputSchema,
            annotations: READ_ONLY_ANNOTATIONS,
            handler: (_params: unknown) => {
                try {
                    if (!vectorManager) {
                        return {
                            success: false,
                            available: false,
                            error: 'Vector search not available',
                            code: 'CONFIGURATION_ERROR',
                            category: 'configuration',
                            suggestion:
                                'Enable semantic search with --auto-rebuild-index or set up the vector manager',
                            recoverable: false,
                        }
                    }
                    const stats = vectorManager.getStats()
                    return { success: true, available: true, ...stats }
                } catch (err) {
                    return formatHandlerError(err)
                }
            },
        },
        {
            name: 'list_deleted_entries',
            title: 'List Deleted Entries',
            description: 'List recently soft-deleted entries that can be restored',
            group: 'search',
            inputSchema: ListDeletedEntriesMcpSchema,
            outputSchema: EntriesListOutputSchema,
            annotations: READ_ONLY_ANNOTATIONS,
            handler: (params: unknown) => {
                try {
                    const parsed = ListDeletedEntriesStrictSchema.parse(params)
                    const rawWs = parsed.workspace_id ?? parsed.workspaceId
                    const rawProj = parsed.project_number ?? parsed.projectNumber
                    const wsId = rawWs === '*' ? '*' : resolveWorkspaceId(rawWs, rawProj, context.config)
                    const projectNumber = alignedProjectFilter(
                        wsId,
                        rawProj,
                        activeProjectRegistry(context.config?.projectRegistry)
                    )
                    const result = db.getDeletedEntries({
                        limit: parsed.limit,
                        offset: parsed.offset,
                        workspaceId: wsId,
                        ...(projectNumber !== undefined ? { projectNumber } : {}),
                    })
                    return {
                        success: true,
                        entries: result.entries.map((e) => ({ ...e, source: 'personal' as const })),
                        count: result.count,
                    }
                } catch (err) {
                    return formatHandlerError(err)
                }
            },
        },
    ];
}
