import { z } from 'zod'
import type { ErrorResponse } from '../../../types/error-types.js'
import type { ToolDefinition, ToolContext } from '../../../types/index.js'
import { formatHandlerError } from '../../../utils/error-helpers.js'
import { sanitizeAuditEntryForEgress } from '../../../audit/audit-resource.js'
import { ValidationError } from '../../../types/errors.js'
import { resolveWriteWorkspaceId } from '../write-workspace.js'
import { activeProjectRegistry, alignedProjectFilter } from '../../../utils/write-scope.js'
import { relaxedNumber, StrictProjectNumberSchema } from '../schemas.js'
import { healAgentHallucinations } from '../schemas/hallucination-healer.js'
import {
    MergeTagsOutputSchema,
    SearchAuditLogSchema,
    SearchAuditLogSchemaMcp,
    SearchAuditLogOutputSchema,
} from './schemas.js'

function auditScopeWarning(
    projectNumber: number | undefined,
    workspaceId: string | undefined
): { warning: string } | Record<string, never> {
    const hasWorkspaceFilter = workspaceId !== undefined && workspaceId !== '*'
    if (projectNumber === undefined && !hasWorkspaceFilter) return {}
    return {
        warning:
            'Results filtered by active workspace_id/project_number scope; unscoped or legacy audit entries without scope metadata are excluded.',
    }
}

const MergeTagNamesFallbackSchema = z.object({ source_tag: z.string(), target_tag: z.string() })

export const MergeTagsSchemaMcp = z.preprocess(
    healAgentHallucinations,
    z
        .object({
            source_tag: z
                .union([z.string(), z.number()])
                .describe(
                    'Tag to merge from (will be deleted). Anti-Hallucination Hint: use source_tag or old_tag'
                ),
            target_tag: z
                .union([z.string(), z.number()])
                .describe(
                    'Tag to merge into (will be created if not exists). Anti-Hallucination Hint: use target_tag or new_tag'
                ),
            project_number: relaxedNumber().optional(),
            workspace_id: z
                .string()
                .optional()
                .describe('Workspace whose entries are retagged'),
        })
        .strict()
)

export const MergeTagsSchema = z
    .object({
        source_tag: z.preprocess(
            (v) => (typeof v === 'number' && Number.isFinite(v) ? String(v) : v),
            z.string().min(1)
        ),
        target_tag: z.preprocess(
            (v) => (typeof v === 'number' && Number.isFinite(v) ? String(v) : v),
            z.string().min(1)
        ),
        project_number: StrictProjectNumberSchema.optional(),
        workspace_id: z.string().max(255).optional(),
    })
    .strict()

function executeMergeTags(
    params: unknown,
    context: ToolContext
): Record<string, unknown> | ErrorResponse {
    const { db } = context
    let healedParams: unknown = params
    try {
        healedParams = healAgentHallucinations(params)
        const input = MergeTagsSchema.parse(healedParams)
        const { source_tag, target_tag } = input

        if (source_tag === target_tag) {
            return {
                success: false,
                sourceTag: source_tag,
                targetTag: target_tag,
                entriesUpdated: 0,
                sourceDeleted: false,
                message: 'Source and target tags cannot be the same',
                error: 'Source and target tags must be different',
                code: 'VALIDATION_ERROR',
                category: 'validation',
                suggestion: 'Provide two different tag names',
                recoverable: true,
            }
        }

        const wsId =
            input.workspace_id?.trim() === '*'
                ? '*'
                : resolveWriteWorkspaceId(input.workspace_id, input.project_number, context.config)
        const result = db.mergeTags(
            source_tag,
            target_tag,
            wsId,
            alignedProjectFilter(
                wsId,
                input.project_number,
                activeProjectRegistry(context.config?.projectRegistry)
            )
        )
        return {
            success: true,
            sourceTag: source_tag,
            targetTag: target_tag,
            entriesUpdated: result.entriesUpdated,
            sourceDeleted: result.sourceDeleted,
            message: `Merged "${source_tag}" into "${target_tag}". Updated ${String(result.entriesUpdated)} entries.`,
        }
    } catch (error) {
        if (error instanceof z.ZodError || error instanceof ValidationError) {
            return formatHandlerError(error)
        }
        // [INTENT] L8: classify via formatHandlerError (never hardcode RESOURCE_NOT_FOUND)
        // while preserving the merge output shape when tag names are recoverable.
        const parsed = MergeTagNamesFallbackSchema.safeParse(healedParams)
        if (!parsed.success) return formatHandlerError(error)
        return {
            ...formatHandlerError(error),
            success: false,
            sourceTag: parsed.data.source_tag,
            targetTag: parsed.data.target_tag,
            entriesUpdated: 0,
            sourceDeleted: false,
            message: 'Tag merge failed',
        }
    }
}

async function executeSearchAuditLog(
    params: unknown,
    context: ToolContext
): Promise<Record<string, unknown> | ErrorResponse> {
    try {
        const input = SearchAuditLogSchema.parse(params)

        if (!context.config?.runtime?.auditLogger) {
            return {
                success: false,
                results: [],
                count: 0,
                warning: 'Audit logging is disabled or not configured on this server.',
            }
        }

        // Map to the internal type AuditSearchFilters
        const results = (await context.config.runtime.auditLogger.search(input)).map(
            sanitizeAuditEntryForEgress
        )
        return {
            success: true,
            count: results.length,
            results,
            ...auditScopeWarning(input.project_number, input.workspace_id),
        }
    } catch (err) {
        return formatHandlerError(err)
    }
}

export function getMiscTools(context: ToolContext): ToolDefinition[] {
    return [
        {
            name: 'merge_tags',
            title: 'Merge Tags',
            description:
                'Merge one tag into another to consolidate similar tags (e.g., merge "phase-2" into "phase2"). The source tag is deleted after merge. Only updates non-deleted entries.',
            group: 'admin',
            inputSchema: MergeTagsSchemaMcp,
            outputSchema: MergeTagsOutputSchema,
            annotations: {
                readOnlyHint: false,
                destructiveHint: true,
                idempotentHint: false,
                openWorldHint: false,
            },
            handler: (params: unknown) => executeMergeTags(params, context),
        },
        {
            name: 'search_audit_log',
            title: 'Search Audit Log',
            description: 'Search operational telemetry audit logs by tool name, user, date range, status, or category. Returns the most recent matches up to the limit.',
            group: 'admin',
            inputSchema: SearchAuditLogSchemaMcp,
            outputSchema: SearchAuditLogOutputSchema,
            annotations: {
                readOnlyHint: true,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: false,
            },
            handler: (params: unknown) => executeSearchAuditLog(params, context),
        },
    ];
}
