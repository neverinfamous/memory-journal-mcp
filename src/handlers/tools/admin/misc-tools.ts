import { z } from 'zod'
import type { ToolDefinition, ToolContext } from '../../../types/index.js'
import { formatHandlerError } from '../../../utils/error-helpers.js'
import { resolveWorkspaceId } from '../../../utils/workspace-resolver.js'
import { healAgentHallucinations } from '../schemas/hallucination-healer.js'
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
            inputSchema: z.preprocess(
                healAgentHallucinations,
                z.object({
                    source_tag: z
                        .union([z.string(), z.number()])
                        .describe('Tag to merge from (will be deleted). Anti-Hallucination Hint: use source_tag or old_tag'),
                    target_tag: z
                        .union([z.string(), z.number()])
                        .describe('Tag to merge into (will be created if not exists). Anti-Hallucination Hint: use target_tag or new_tag'),
                    workspace_id: z.string().optional().describe('Workspace whose entries are retagged (pass "*" to merge globally across all workspaces)'),
                }).strict()
            ),
            outputSchema: MergeTagsOutputSchema,
            annotations: {
                readOnlyHint: false,
                destructiveHint: false,
                idempotentHint: false,
                openWorldHint: false,
            },
            handler: (params: unknown) => {
                try {
                    const healedParams = healAgentHallucinations(params)
                    const { source_tag, target_tag, workspace_id } = z
                        .object({
                            source_tag: z.preprocess((v) => v !== undefined ? String(v as string | number) : v, z.string().min(1)),
                            target_tag: z.preprocess((v) => v !== undefined ? String(v as string | number) : v, z.string().min(1)),
                            workspace_id: z.string().optional(),
                        }).strict()
                        .parse(healedParams)

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

                    const wsId = resolveWorkspaceId(workspace_id, undefined, context.config)
                    const result = db.mergeTags(source_tag, target_tag, wsId)
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
                            success: false,
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
                        ...(input.project_number !== undefined
                            ? {
                                  warning:
                                      'project_number was ignored: audit log entries are not project-scoped, so results are not filtered by project.',
                              }
                            : {}),
                    }
                } catch (err) {
                    return formatHandlerError(err)
                }
            },
        },
    ];
}
