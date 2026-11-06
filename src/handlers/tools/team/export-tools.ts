/**
 * Team Export Tools - 1 tool
 *
 * Tools: team_export_entries
 */

import type { ToolDefinition, ToolContext } from '../../../types/index.js'
import { formatHandlerError } from '../../../utils/error-helpers.js'
import { sendProgress } from '../../../utils/progress-utils.js'
import { resolveWorkspaceId } from '../../../utils/workspace-resolver.js'
import { DATE_MIN_SENTINEL, DATE_MAX_SENTINEL } from '../schemas.js'
import { TEAM_DB_ERROR_RESPONSE, batchFetchAuthors } from './helpers.js'
import {
    TeamExportEntriesSchema,
    TeamExportEntriesSchemaMcp,
    TeamExportOutputSchema,
} from './schemas.js'

// ============================================================================
// Tool Definitions
// ============================================================================

export function getTeamExportTools(context: ToolContext): ToolDefinition[] {
    const { teamDb, progress } = context

    return [
        {
            name: 'team_export_entries',
            title: 'Export Team Entries',
            description:
                'Export team entries in JSON or Markdown format with optional date range, type, and tag filters. Requires TEAM_DB_PATH.',
            group: 'team',
            inputSchema: TeamExportEntriesSchemaMcp,
            outputSchema: TeamExportOutputSchema,
            annotations: {
                readOnlyHint: true,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: false,
            },
            handler: async (params: unknown) => {
                try {
                    if (!teamDb) {
                        return { ...TEAM_DB_ERROR_RESPONSE }
                    }

                    const {
                        format,
                        start_date,
                        end_date,
                        entry_type,
                        tags,
                        limit,
                        project_number,
                        workspace_id,
                    } = TeamExportEntriesSchema.parse(params)

                    await sendProgress(progress, 0, 3, 'Preparing team export...')
                    await sendProgress(progress, 1, 3, 'Fetching team entries...')

                    const wsId = resolveWorkspaceId(workspace_id, project_number, context.config)

                    // When entry_type or tags filters are active, fetch a larger
                    // batch so post-filtering doesn't silently return too few results.
                    const hasTypeFilter = !!entry_type
                    const hasTagFilter = tags && tags.length > 0
                    const fetchLimit = hasTypeFilter || hasTagFilter ? 500 : limit

                    const projectFilter = project_number !== undefined ? { projectNumber: project_number } : {}

                    // Fetch entries with optional filters
                    let entries
                    if (start_date !== undefined || end_date !== undefined) {
                        entries = teamDb.searchByDateRange(
                            start_date ?? DATE_MIN_SENTINEL,
                            end_date ?? DATE_MAX_SENTINEL,
                            {
                                entryType: entry_type,
                                tags,
                                limit: fetchLimit,
                                workspaceId: wsId,
                                ...projectFilter,
                            }
                        ).entries
                    } else if (hasTypeFilter || hasTagFilter) {
                        // Use wide date range to scan the full database
                        entries = teamDb.searchByDateRange(DATE_MIN_SENTINEL, DATE_MAX_SENTINEL, {
                            entryType: entry_type,
                            tags,
                            limit: fetchLimit,
                            workspaceId: wsId,
                            ...projectFilter,
                        }).entries
                    } else {
                        entries = teamDb.getRecentEntries(
                            fetchLimit,
                            undefined,
                            undefined,
                            undefined,
                            undefined,
                            wsId,
                            project_number
                        ).entries
                    }

                    // Post-filter by entry_type if searchByDateRange
                    // doesn't natively support it, then cap to requested limit
                    if (hasTypeFilter && entry_type !== undefined) {
                        entries = entries.filter((e) => e.entryType === entry_type)
                    }
                    if (entries.length > limit) {
                        entries = entries.slice(0, limit)
                    }

                    // Enforce < 5MB payload ceiling (approximate based on content + overhead)
                    const MAX_PAYLOAD_BYTES = 5 * 1024 * 1024
                    let currentBytes = 0
                    const boundedEntries: typeof entries = []
                    let truncated = false

                    for (const entry of entries) {
                        const entrySize = Buffer.byteLength(entry.content, 'utf8') + 500
                        if (currentBytes + entrySize > MAX_PAYLOAD_BYTES) {
                            truncated = true
                            break
                        }
                        currentBytes += entrySize
                        boundedEntries.push(entry)
                    }

                    entries = boundedEntries

                    await sendProgress(progress, 2, 3, 'Formatting export data...')

                    // Enrich with authors
                    const authorMap = batchFetchAuthors(
                        teamDb,
                        entries.map((e) => e.id)
                    )
                    const enriched = entries.map((e) => ({
                        ...e,
                        author: authorMap.get(e.id) ?? null,
                    }))

                    let data: string
                    if (format === 'markdown') {
                        const lines: string[] = ['# Team Journal Export', '']
                        for (const entry of enriched) {
                            lines.push(`## Entry #${String(entry.id)}`)
                            lines.push(`**Date:** ${entry.timestamp}`)
                            lines.push(`**Type:** ${entry.entryType}`)
                            if (entry.author) {
                                lines.push(`**Author:** ${entry.author}`)
                            }
                            if (entry.tags !== undefined && entry.tags.length > 0) {
                                lines.push(`**Tags:** ${entry.tags.join(', ')}`)
                            }
                            lines.push('')
                            lines.push(entry.content)
                            lines.push('')
                            lines.push('---')
                            lines.push('')
                        }
                        data = lines.join('\n')
                    } else {
                        data = JSON.stringify(enriched)
                    }

                    await sendProgress(progress, 3, 3, 'Export complete')

                    return {
                        success: true,
                        format,
                        data,
                        count: enriched.length,
                        truncated,
                    }
                } catch (err) {
                    return formatHandlerError(err)
                }
            },
        },
    ]
}
