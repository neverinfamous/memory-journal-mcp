import { z } from 'zod'
import type { ToolDefinition, ToolContext } from '../../../types/index.js'
import { ValidationError } from '../../../types/errors.js'
import { formatHandlerError } from '../../../utils/error-helpers.js'
import { resolveWorkspaceId } from '../../../utils/workspace-resolver.js'
import { activeProjectRegistry, alignedProjectFilter } from '../../../utils/write-scope.js'
import { parsePositiveProjectNumber } from '../../../utils/safe-positive-int.js'
import { VectorStatsOutputSchema } from './schemas.js'
import { coerceIntString } from '../schemas/constants-and-primitives.js'
import { EntriesListOutputSchema, MAX_QUERY_LIMIT, relaxedNumber } from '../schemas.js'

function preprocessProjectNumber(val: unknown): unknown {
    if (val === undefined) return undefined
    const parsed = parsePositiveProjectNumber(val)
    return parsed ?? Number.NaN
}

const EmptyStrictSchema = z.object({}).strict()

const ListDeletedEntriesMcpSchema = z
    .object({
        limit: relaxedNumber().optional().default(50),
        offset: relaxedNumber().optional().default(0),
        workspace_id: z.string().optional().describe('Filter by workspace ID, or "*" for all workspaces'),
        workspaceId: z.string().optional().describe('Workspace identifier alias'),
        project_number: relaxedNumber().optional().describe('Filter by numeric project ID'),
        projectNumber: relaxedNumber().optional().describe('Project number alias'),
    })
    .strict()

const ListDeletedEntriesStrictSchema = z
    .object({
        limit: z.preprocess(
            coerceIntString,
            z.number().int().min(1).max(MAX_QUERY_LIMIT).optional().default(50)
        ),
        offset: z.preprocess(coerceIntString, z.number().int().min(0).optional().default(0)),
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

function executeGetVectorIndexStats(
    vectorManager: ToolContext['vectorManager'],
    params: unknown
): unknown {
    try {
        EmptyStrictSchema.parse(params ?? {})
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
        const formatted = formatHandlerError(err)
        if (
            typeof params === 'object' &&
            params !== null &&
            !Array.isArray(params) &&
            ('workspace_id' in params ||
                'workspaceId' in params ||
                'project_number' in params ||
                'projectNumber' in params)
        ) {
            return {
                ...formatted,
                suggestion:
                    '🛠️ AUTONOMOUS HEALING: get_vector_index_stats reports database-wide vector index statistics and accepts no parameters. Re-call with empty arguments: mj.search.getVectorIndexStats({}).',
            }
        }
        return formatted
    }
}

function executeListDeletedEntries(context: ToolContext, params: unknown): unknown {
    try {
        const parsed = ListDeletedEntriesStrictSchema.parse(params)
        if (
            parsed.workspace_id !== undefined &&
            parsed.workspaceId !== undefined &&
            parsed.workspace_id.trim().toLowerCase() !== parsed.workspaceId.trim().toLowerCase()
        ) {
            throw new ValidationError('Conflicting workspace_id and workspaceId values provided')
        }
        if (
            parsed.project_number !== undefined &&
            parsed.projectNumber !== undefined &&
            parsed.project_number !== parsed.projectNumber
        ) {
            throw new ValidationError('Conflicting project_number and projectNumber values provided')
        }
        const rawWs = parsed.workspace_id ?? parsed.workspaceId
        const rawProj = parsed.project_number ?? parsed.projectNumber
        const wsId = rawWs?.trim() === '*' ? '*' : resolveWorkspaceId(rawWs, rawProj, context.config)
        const projectNumber = alignedProjectFilter(
            wsId,
            rawProj,
            activeProjectRegistry(context.config?.projectRegistry)
        )
        const result = context.db.getDeletedEntries({
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
}

export function getMiscSearchTools(context: ToolContext): ToolDefinition[] {
    const { vectorManager } = context
    return [
        {
            name: 'get_vector_index_stats',
            title: 'Get Vector Index Stats',
            description: 'Get statistics about the semantic search vector index',
            group: 'search',
            inputSchema: EmptyStrictSchema,
            outputSchema: VectorStatsOutputSchema,
            annotations: READ_ONLY_ANNOTATIONS,
            handler: (params: unknown) => executeGetVectorIndexStats(vectorManager, params),
        },
        {
            name: 'list_deleted_entries',
            title: 'List Deleted Entries',
            description: 'List recently soft-deleted entries that can be restored',
            group: 'search',
            inputSchema: ListDeletedEntriesMcpSchema,
            outputSchema: EntriesListOutputSchema,
            annotations: READ_ONLY_ANNOTATIONS,
            handler: (params: unknown) => executeListDeletedEntries(context, params),
        },
    ]
}
