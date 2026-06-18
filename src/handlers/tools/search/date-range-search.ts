import type { ToolDefinition, ToolContext } from '../../../types/index.js'
import { resolveWorkspaceId } from '../../../utils/workspace-resolver.js'
import { formatHandlerError } from '../../../utils/error-helpers.js'
import { calcPerDbLimit, mergeAndDedup } from './helpers.js'
import { SearchByDateRangeSchema, SearchByDateRangeSchemaMcp } from './schemas.js'
import { EntriesListOutputSchema } from '../schemas.js'

export function getDateRangeSearchTool(context: ToolContext): ToolDefinition[] {
    const { db, teamDb } = context;
    return [
        {
            name: 'search_by_date_range',
            title: 'Search by Date Range',
            description: 'Search journal entries within a date range with optional filters',
            group: 'search',
            inputSchema: SearchByDateRangeSchemaMcp,
            outputSchema: EntriesListOutputSchema,
            annotations: {
                readOnlyHint: true,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: false,
            },
            handler: async (params: unknown) => {
                try {
                    const input = SearchByDateRangeSchema.parse(params)
                    const wsId = resolveWorkspaceId(input.workspace_id, input.project_number, context.config)

                    // Validate date range order (YYYY-MM-DD sorts lexicographically)
                    if (input.start_date > input.end_date) {
                        return {
                            success: false,
                            error: `Invalid date range: start_date (${input.start_date}) is after end_date (${input.end_date})`,
                            code: 'VALIDATION_ERROR',
                            category: 'validation',
                            suggestion: 'Ensure start_date is before or equal to end_date',
                            recoverable: true,
                        }
                    }

                    let personalCursor = input.cursor
                    let teamCursor = input.cursor
                    if (input.cursor && input.include_team && input.is_personal !== true) {
                        const { decodeCompoundCursor } = await import('./fts.js')
                        const compound = decodeCompoundCursor(input.cursor)
                        if (compound) {
                            personalCursor = compound.p
                            teamCursor = compound.t
                        }
                    }

                    const perDbLimit = calcPerDbLimit(input.limit, !!teamDb)
                    const personalEntries = db.searchByDateRange(input.start_date, input.end_date, {
                        entryType: input.entry_type,
                        tags: input.tags,
                        isPersonal: input.is_personal,
                        projectNumber: input.project_number,
                        issueNumber: input.issue_number,
                        prNumber: input.pr_number,
                        workflowRunId: input.workflow_run_id,
                        limit: perDbLimit,
                        sortBy: input.sort_by,
                        cursor: personalCursor,
                        includeArchived: input.include_archived,
                        workspaceId: wsId,
                    })

                    // Cross-database merge when team DB is available
                    // Skip team DB when is_personal is explicitly true (team entries are never personal)
                    if (teamDb && input.include_team && input.is_personal !== true) {
                        const teamEntries = teamDb.searchByDateRange(
                            input.start_date,
                            input.end_date,
                            {
                                entryType: input.entry_type,
                                tags: input.tags,
                                projectNumber: input.project_number,
                                issueNumber: input.issue_number,
                                prNumber: input.pr_number,
                                workflowRunId: input.workflow_run_id,
                                limit: perDbLimit,
                                sortBy: input.sort_by,
                                cursor: teamCursor,
                                includeArchived: input.include_archived,
                                workspaceId: wsId,
                            }
                        )
                        const merged = mergeAndDedup(
                            personalEntries.entries.map((e) => ({ ...e, source: 'personal' as const })),
                            teamEntries.entries.map((e) => ({ ...e, source: 'team' as const })),
                            input.limit,
                            input.sort_by
                        )
                        let compoundNextCursor: string | undefined
                        if (personalEntries.nextCursor || teamEntries.nextCursor) {
                            const { encodeCompoundCursor } = await import('./fts.js')
                            compoundNextCursor = encodeCompoundCursor(personalEntries.nextCursor, teamEntries.nextCursor)
                        }
                        return {
                            success: true,
                            entries: merged,
                            count: merged.length,
                            degraded: false,
                            next_cursor: compoundNextCursor,
                        }
                    }

                    return {
                        success: true,
                        entries: personalEntries.entries.map((e) => ({
                            ...e,
                            source: 'personal' as const,
                        })),
                        count: personalEntries.entries.length,
                        degraded: false,
                        next_cursor: personalEntries.nextCursor,
                    }
                } catch (err) {
                    return formatHandlerError(err)
                }
            },
        },
    ];
}
