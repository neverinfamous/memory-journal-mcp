import type { ToolDefinition, ToolContext } from '../../../../types/index.js'
import { formatHandlerError } from '../../../../utils/error-helpers.js'
import { TEAM_DB_ERROR_RESPONSE, fetchAuthor } from '../helpers.js'
import { ListTeamFlagsSchema, ListTeamFlagsSchemaMcp, ListFlagsOutputSchema } from '../schemas.js'
import { parseFlagContext } from '../../../../types/auto-context.js'
import { STALE_THRESHOLD_MS, getFlagPriority, type ParsedFlagEntry } from './helpers.js'

export function getListFlagsTool(context: ToolContext): ToolDefinition[] {
    const { teamDb } = context

    return [
        {
            name: 'team_list_flags',
            title: 'List Team Flags',
            description:
                'List and filter Hush Protocol flags with structured metadata. Filter by status (active/resolved/all), flag_type, target_user, or author. Returns enriched flag objects — no manual auto_context parsing needed.',
            group: 'team',
            inputSchema: ListTeamFlagsSchemaMcp,
            outputSchema: ListFlagsOutputSchema,
            annotations: {
                readOnlyHint: true,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: false,
            },
            handler: (params: unknown) => {
                try {
                    if (!teamDb) {
                        return { ...TEAM_DB_ERROR_RESPONSE }
                    }

                    const input = ListTeamFlagsSchema.parse(params)

                    const projectNumber = input.project_number

                    const { entries: flagEntries } = teamDb.searchEntries('', {
                        entryType: 'flag',
                        limit: 500, // fetch all, filter in-memory
                    })

                    const now = Date.now()
                    let activeCount = 0
                    let resolvedCount = 0
                    const flags: ParsedFlagEntry[] = []

                    for (const entry of flagEntries) {
                        const ctx = parseFlagContext(entry.autoContext)
                        if (!ctx) continue

                        // Project boundary filter
                        if (projectNumber !== undefined && projectNumber !== null && entry.projectNumber !== projectNumber) continue

                        // Status filter
                        if (input.status === 'active' && ctx.resolved) continue
                        if (input.status === 'resolved' && !ctx.resolved) continue

                        // Flag type filter
                        if (input.flag_type && ctx.flag_type !== input.flag_type) continue

                        // Target user filter
                        const targetUser = ctx.target_user ?? null
                        if (input.target_user) {
                            const normalizedFilter = input.target_user.replace(/^@/, '')
                            if (targetUser !== normalizedFilter) continue
                        }

                        // Author filter
                        const author = fetchAuthor(teamDb, entry.id)
                        if (input.author && author !== input.author) continue

                        const entryTime = new Date(entry.timestamp).getTime()
                        const ageMs = now - entryTime
                        const ageHours = Math.round((ageMs / 3_600_000) * 10) / 10

                        // Track counts for summary
                        if (ctx.resolved) {
                            resolvedCount++
                        } else {
                            activeCount++
                        }

                        flags.push({
                            id: entry.id,
                            flag_type: ctx.flag_type,
                            target_user: targetUser,
                            author,
                            message: entry.content,
                            link: ctx.link ?? null,
                            resolved: ctx.resolved,
                            resolved_at: ctx.resolved_at ?? null,
                            resolution: ctx.resolution ?? null,
                            timestamp: entry.timestamp,
                            age_hours: ageHours,
                            is_stale: !ctx.resolved && ageMs > STALE_THRESHOLD_MS,
                            tags: entry.tags ?? [],
                            project_number: entry.projectNumber ?? null,
                        })
                    }

                    // Sort
                    if (input.sort_by === 'priority') {
                        flags.sort((a, b) => {
                            const priorityDiff =
                                getFlagPriority(a.flag_type) - getFlagPriority(b.flag_type)
                            if (priorityDiff !== 0) return priorityDiff
                            return b.age_hours - a.age_hours // older first within same priority
                        })
                    } else {
                        flags.sort((a, b) => b.age_hours - a.age_hours) // newest last
                    }

                    // Apply limit
                    const limited = flags.slice(0, input.limit)

                    return {
                        success: true,
                        flags: limited,
                        count: limited.length,
                        active_count: activeCount,
                        resolved_count: resolvedCount,
                    }
                } catch (err) {
                    return formatHandlerError(err)
                }
            },
        },
    ]
}
