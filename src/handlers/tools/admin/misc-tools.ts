import { z } from 'zod'
import type { ToolDefinition, ToolContext } from '../../../types/index.js'
import { formatHandlerError } from '../../../utils/error-helpers.js'
import {
    MergeTagsOutputSchema,
    SearchAuditLogSchema,
    SearchAuditLogOutputSchema,
} from './schemas.js'

export function getMiscTools(context: ToolContext): ToolDefinition[] {
    const { db } = context;
    return [
        {
            name: 'merge_tags',
            title: 'Merge Tags',
            description:
                'Merge one tag into another to consolidate similar tags (e.g., merge "phase-2" into "phase2"). The source tag is deleted after merge. Only updates non-deleted entries.',
            group: 'admin',
            inputSchema: z.object({
                source_tag: z
                    .union([z.string(), z.number()])
                    .optional()
                    .describe('Tag to merge from (will be deleted)'),
                target_tag: z
                    .union([z.string(), z.number()])
                    .optional()
                    .describe('Tag to merge into (will be created if not exists)'),
            }),
            outputSchema: MergeTagsOutputSchema,
            annotations: {
                readOnlyHint: false,
                destructiveHint: false,
                idempotentHint: false,
                openWorldHint: false,
            },
            handler: (params: unknown) => {
                try {
                    const { source_tag, target_tag } = z
                        .object({
                            source_tag: z.string().min(1),
                            target_tag: z.string().min(1),
                        })
                        .parse(params)

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

                    const result = db.mergeTags(source_tag, target_tag)
                    return {
                        success: true,
                        sourceTag: source_tag,
                        targetTag: target_tag,
                        entriesUpdated: result.entriesUpdated,
                        sourceDeleted: result.sourceDeleted,
                        message: `Merged "${source_tag}" into "${target_tag}". Updated ${String(result.entriesUpdated)} entries.`,
                    }
                } catch (error) {
                    // Zod or domain error
                    if (error instanceof z.ZodError) {
                        return formatHandlerError(error)
                    }
                    // Domain error from db.mergeTags — try to preserve schema shape
                    try {
                        const parsed = z
                            .object({ source_tag: z.string(), target_tag: z.string() })
                            .parse(params)
                        return {
                            success: false,
                            sourceTag: parsed.source_tag,
                            targetTag: parsed.target_tag,
                            entriesUpdated: 0,
                            sourceDeleted: false,
                            message: 'Tag merge failed',
                            error: error instanceof Error ? error.message : 'Unknown error',
                            code: 'RESOURCE_NOT_FOUND',
                            category: 'resource',
                            suggestion: 'Verify the source tag exists using list_tags',
                            recoverable: true,
                        }
                    } catch {
                        return formatHandlerError(error)
                    }
                }
            },
        },
        {
            name: 'search_audit_log',
            title: 'Search Audit Log',
            description: 'Search operational telemetry audit logs by tool name, user, date range, status, or category. Returns the most recent matches up to the limit.',
            group: 'admin',
            inputSchema: SearchAuditLogSchema,
            outputSchema: SearchAuditLogOutputSchema,
            annotations: {
                readOnlyHint: true,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: false,
            },
            handler: async (params: unknown) => {
                try {
                    const input = SearchAuditLogSchema.parse(params)
                    
                    if (!context.config?.runtime?.auditLogger) {
                        return {
                            success: true, // Graceful fallback
                            results: [],
                            count: 0,
                            warning: 'Audit logging is disabled or not configured on this server.',
                        }
                    }

                    // Map to the internal type AuditSearchFilters
                    const results = await context.config.runtime.auditLogger.search(input)
                    return {
                        success: true,
                        count: results.length,
                        results,
                    }
                } catch (err) {
                    return formatHandlerError(err)
                }
            },
        },
        {
            name: '_execute_raw_query_unsafe',
            title: 'Execute Raw Query Unsafe',
            description: 'Internal admin method to run a raw SQL query. Should only be used for debugging or verifying indexes.',
            group: 'admin',
            inputSchema: z.object({
                query: z.string().describe('The raw SQL query to execute'),
            }),
            outputSchema: z.object({
                success: z.boolean(),
                result: z.unknown().optional()
            }).describe('The raw query execution result array'),
            annotations: {
                readOnlyHint: true,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: false,
            },
            handler: (params: unknown) => {
                try {
                    const input = z.object({ query: z.string() }).parse(params)
                    const res = context.db._executeRawQueryUnsafe(input.query)
                    return { success: true, result: res }
                } catch (err) {
                    return formatHandlerError(err)
                }
            },
        },
    ];
}
