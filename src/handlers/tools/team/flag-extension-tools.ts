/**
 * Team Flag Query & Mutation Tools — Hush Protocol Extensions - 3 tools
 *
 * Tools: team_list_flags, team_update_flag, team_get_flag_analytics
 *
 * Extends the core flag lifecycle (pass/resolve) with structured querying,
 * metadata mutation (escalate, reassign, reopen), and aggregate analytics.
 */

import type { ToolDefinition, ToolContext } from '../../../types/index.js'
import { formatHandlerError } from '../../../utils/error-helpers.js'
import { TEAM_DB_ERROR_RESPONSE, fetchAuthor } from './helpers.js'
import {
    ListTeamFlagsSchema,
    ListTeamFlagsSchemaMcp,
    UpdateTeamFlagSchema,
    UpdateTeamFlagSchemaMcp,
    FlagAnalyticsSchema,
    FlagAnalyticsSchemaMcp,
    ListFlagsOutputSchema,
    UpdateFlagOutputSchema,
    FlagAnalyticsOutputSchema,
    DEFAULT_FLAG_VOCABULARY,
} from './schemas.js'
import { parseFlagContext, type FlagContext } from '../../../types/auto-context.js'

// ============================================================================
// Constants
// ============================================================================

/** Staleness threshold in milliseconds (24 hours) */
const STALE_THRESHOLD_MS = 86_400_000

/** Priority ordering for flag types (highest severity first) */
const FLAG_PRIORITY: ReadonlyMap<string, number> = new Map([
    ['blocker', 0],
    ['needs_review', 1],
    ['help_requested', 2],
    ['fyi', 3],
])

// ============================================================================
// Helpers
// ============================================================================

/**
 * Get the active flag vocabulary from context config or defaults.
 */
function getVocabulary(context: ToolContext): readonly string[] {
    const custom = context.config?.flagVocabulary
    return custom && custom.length > 0 ? custom : DEFAULT_FLAG_VOCABULARY
}

/**
 * Get the sort priority for a flag type. Unknown types sort last.
 */
function getFlagPriority(flagType: string): number {
    return FLAG_PRIORITY.get(flagType) ?? 99
}

/**
 * Compute median of a numeric array. Returns null for empty arrays.
 */
function median(values: number[]): number | null {
    if (values.length === 0) return null
    const sorted = [...values].sort((a, b) => a - b)
    const mid = Math.floor(sorted.length / 2)
    if (sorted.length % 2 === 0) {
        const lo = sorted[mid - 1] ?? 0
        const hi = sorted[mid] ?? 0
        return Math.round(((lo + hi) / 2) * 10) / 10
    }
    return Math.round((sorted[mid] ?? 0) * 10) / 10
}

/**
 * Get period boundaries in milliseconds for trend comparison.
 */
function getPeriodMs(period: string): number {
    switch (period) {
        case 'day':
            return 86_400_000
        case 'month':
            return 2_592_000_000 // 30 days
        case 'week':
        default:
            return 604_800_000 // 7 days
    }
}

// ============================================================================
// Parsed flag entry type
// ============================================================================

interface ParsedFlagEntry {
    id: number
    flag_type: string
    target_user: string | null
    author: string | null
    message: string
    link: string | null
    resolved: boolean
    resolved_at: string | null
    resolution: string | null
    timestamp: string
    age_hours: number
    is_stale: boolean
    tags: string[]
    project_number: number | null
}

// ============================================================================
// Tool Definitions
// ============================================================================

export function getTeamFlagExtensionTools(context: ToolContext): ToolDefinition[] {
    const { teamDb } = context

    return [
        // ================================================================
        // team_list_flags
        // ================================================================
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

                    const flagEntries = teamDb.searchEntries('', {
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

        // ================================================================
        // team_update_flag
        // ================================================================
        {
            name: 'team_update_flag',
            title: 'Update Team Flag',
            description:
                'Update a flag\'s metadata without resolving it. Escalate severity (fyi → blocker), reassign target_user, edit message, add/update link, or reopen a resolved flag. Returns the updated flag with a list of changes made.',
            group: 'team',
            inputSchema: UpdateTeamFlagSchemaMcp,
            outputSchema: UpdateFlagOutputSchema,
            annotations: {
                readOnlyHint: false,
                destructiveHint: false,
                idempotentHint: false,
                openWorldHint: false,
            },
            handler: (params: unknown) => {
                try {
                    if (!teamDb) {
                        return { ...TEAM_DB_ERROR_RESPONSE }
                    }

                    const input = UpdateTeamFlagSchema.parse(params)
                    const entry = teamDb.getEntryById(input.flag_id)

                    if (!entry) {
                        return {
                            success: false,
                            error: `Flag entry ${String(input.flag_id)} not found`,
                            code: 'RESOURCE_NOT_FOUND',
                            category: 'resource',
                            suggestion: 'Verify the flag entry ID and try again',
                            recoverable: true,
                        }
                    }

                    if (entry.entryType !== 'flag') {
                        return {
                            success: false,
                            error: `Entry ${String(input.flag_id)} is not a flag (type: ${entry.entryType})`,
                            code: 'VALIDATION_ERROR',
                            category: 'validation',
                            suggestion:
                                'Use team_update_flag only on entries created by team_pass_flag',
                            recoverable: true,
                        }
                    }

                    const flagCtx = parseFlagContext(entry.autoContext)
                    if (!flagCtx) {
                        return {
                            success: false,
                            error: `Flag entry ${String(input.flag_id)} has invalid auto_context`,
                            code: 'INTERNAL_ERROR',
                            category: 'internal',
                            recoverable: false,
                        }
                    }

                    // Validate new flag_type against vocabulary
                    const vocabulary = getVocabulary(context)
                    if (input.flag_type && !vocabulary.includes(input.flag_type)) {
                        return {
                            success: false,
                            error: `Invalid flag type: "${input.flag_type}". Valid types: ${vocabulary.join(', ')}`,
                            code: 'VALIDATION_ERROR',
                            category: 'validation',
                            suggestion: `Use one of: ${vocabulary.join(', ')}`,
                            recoverable: true,
                        }
                    }

                    // Track changes for audit trail
                    const changes: string[] = []
                    const updatedContext: FlagContext = { ...flagCtx }

                    // Handle reopen
                    if (input.reopen === true && flagCtx.resolved) {
                        updatedContext.resolved = false
                        updatedContext.resolved_at = null
                        updatedContext.resolution = null
                        changes.push('reopened')
                    }

                    // Update flag_type
                    if (input.flag_type !== undefined && input.flag_type !== flagCtx.flag_type) {
                        const old = flagCtx.flag_type
                        updatedContext.flag_type = input.flag_type
                        changes.push(`flag_type: ${old} → ${input.flag_type}`)
                    }

                    // Update target_user
                    if (input.target_user !== undefined) {
                        const newTarget =
                            input.target_user === null
                                ? null
                                : input.target_user.replace(/^@/, '')
                        if (newTarget !== (flagCtx.target_user ?? null)) {
                            const old = flagCtx.target_user ?? 'none'
                            updatedContext.target_user = newTarget
                            changes.push(
                                `target_user: ${old} → ${newTarget ?? 'cleared'}`
                            )
                        }
                    }

                    // Update link
                    if (input.link !== undefined) {
                        if (input.link !== (flagCtx.link ?? null)) {
                            updatedContext.link = input.link
                            changes.push(
                                input.link === null ? 'link: cleared' : `link: updated`
                            )
                        }
                    }

                    // No changes detected
                    if (changes.length === 0 && input.message === undefined) {
                        const author = fetchAuthor(teamDb, input.flag_id)
                        return {
                            success: true,
                            entry: {
                                ...entry,
                                author,
                                flagMetadata: flagCtx as Record<string, unknown>,
                            },
                            flag_type: flagCtx.flag_type,
                            target_user: flagCtx.target_user ?? null,
                            resolved: flagCtx.resolved,
                            author,
                            changes: [],
                        }
                    }

                    // Rebuild content with updated metadata
                    const effectiveFlagType = updatedContext.flag_type
                    const effectiveTarget = updatedContext.target_user
                    const messageBody = input.message ?? extractMessageBody(entry.content)
                    const contentPrefix = `flag:${effectiveFlagType}`
                    const targetSuffix = effectiveTarget ? ` — @${effectiveTarget}` : ''
                    let updatedContent = `${contentPrefix}${targetSuffix}: ${messageBody}`

                    // Preserve [RESOLVED] suffix if still resolved
                    if (updatedContext.resolved && updatedContext.resolution) {
                        updatedContent += ` [RESOLVED: ${updatedContext.resolution}]`
                    } else if (updatedContext.resolved) {
                        updatedContent += ' [RESOLVED]'
                    }

                    if (input.message !== undefined) {
                        changes.push('message: updated')
                    }

                    // Rebuild tags
                    const tags = [`flag:${effectiveFlagType}`]
                    if (effectiveTarget) {
                        tags.push(`@${effectiveTarget}`)
                    }

                    // Persist
                    teamDb.updateEntry(input.flag_id, {
                        autoContext: JSON.stringify(updatedContext),
                        content: updatedContent,
                        tags,
                    })
                    teamDb.flushSave()

                    const updatedEntry = teamDb.getEntryById(input.flag_id)
                    const author = fetchAuthor(teamDb, input.flag_id)

                    return {
                        success: true,
                        entry: updatedEntry
                            ? {
                                  ...updatedEntry,
                                  author,
                                  flagMetadata: updatedContext as Record<string, unknown>,
                              }
                            : undefined,
                        flag_type: updatedContext.flag_type,
                        target_user: updatedContext.target_user ?? null,
                        resolved: updatedContext.resolved,
                        author,
                        changes,
                    }
                } catch (err) {
                    return formatHandlerError(err)
                }
            },
        },

        // ================================================================
        // team_get_flag_analytics
        // ================================================================
        {
            name: 'team_get_flag_analytics',
            title: 'Flag Analytics',
            description:
                'Get aggregate Hush Protocol flag analytics: resolution velocity, type distribution, per-user workload, staleness counts, and period-over-period trend comparison.',
            group: 'team',
            inputSchema: FlagAnalyticsSchemaMcp,
            outputSchema: FlagAnalyticsOutputSchema,
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

                    const input = FlagAnalyticsSchema.parse(params)
                    const now = Date.now()
                    const periodMs = getPeriodMs(input.period)

                    const flagEntries = teamDb.searchEntries('', {
                        entryType: 'flag',
                        limit: 500,
                    })

                    // Accumulators
                    let totalFlags = 0
                    let activeFlags = 0
                    let resolvedFlags = 0
                    let staleCount = 0
                    const resolutionTimes: number[] = []

                    const typeStats: Record<
                        string,
                        { total: number; active: number; resolutionTimes: number[] }
                    > = {}
                    const targetStats: Record<
                        string,
                        { received: number; active: number }
                    > = {}

                    let currentPeriodCount = 0
                    let previousPeriodCount = 0

                    for (const entry of flagEntries) {
                        const ctx = parseFlagContext(entry.autoContext)
                        if (!ctx) continue

                        totalFlags++
                        const entryTime = new Date(entry.timestamp).getTime()
                        const ageMs = now - entryTime

                        // Trend: count entries in current vs previous period
                        if (ageMs <= periodMs) {
                            currentPeriodCount++
                        } else if (ageMs <= periodMs * 2) {
                            previousPeriodCount++
                        }

                        // Per-type accumulation
                        typeStats[ctx.flag_type] ??= {
                            total: 0,
                            active: 0,
                            resolutionTimes: [],
                        }
                        const typeEntry = typeStats[ctx.flag_type]
                        if (typeEntry) typeEntry.total++

                        // Per-target accumulation
                        if (ctx.target_user) {
                            targetStats[ctx.target_user] ??= { received: 0, active: 0 }
                            const targetEntry = targetStats[ctx.target_user]
                            if (targetEntry) targetEntry.received++
                        }

                        if (ctx.resolved) {
                            resolvedFlags++

                            // Calculate resolution time
                            if (ctx.resolved_at) {
                                const resolvedTime = new Date(ctx.resolved_at).getTime()
                                const hours =
                                    Math.round(
                                        ((resolvedTime - entryTime) / 3_600_000) * 10
                                    ) / 10
                                if (hours >= 0) {
                                    resolutionTimes.push(hours)
                                    const typeEntryRes = typeStats[ctx.flag_type]
                                    if (typeEntryRes) typeEntryRes.resolutionTimes.push(hours)
                                }
                            }
                        } else {
                            activeFlags++
                            const typeEntryActive = typeStats[ctx.flag_type]
                            if (typeEntryActive) typeEntryActive.active++

                            if (ageMs > STALE_THRESHOLD_MS) {
                                staleCount++
                            }

                            if (ctx.target_user && targetStats[ctx.target_user]) {
                                const targetEntryActive = targetStats[ctx.target_user]
                                if (targetEntryActive) targetEntryActive.active++
                            }
                        }
                    }

                    // Build by_type output
                    const byType: Record<
                        string,
                        { total: number; active: number; avg_resolution_hours: number | null }
                    > = {}
                    for (const [type, stats] of Object.entries(typeStats)) {
                        byType[type] = {
                            total: stats.total,
                            active: stats.active,
                            avg_resolution_hours:
                                stats.resolutionTimes.length > 0
                                    ? Math.round(
                                          (stats.resolutionTimes.reduce((a, b) => a + b, 0) /
                                              stats.resolutionTimes.length) *
                                              10
                                      ) / 10
                                    : null,
                        }
                    }

                    // Build by_target output (sorted by received desc)
                    const byTarget = Object.entries(targetStats)
                        .map(([user, stats]) => ({
                            user,
                            received: stats.received,
                            active: stats.active,
                        }))
                        .sort((a, b) => b.received - a.received)

                    // Trend calculation
                    const changePct =
                        previousPeriodCount > 0
                            ? Math.round(
                                  ((currentPeriodCount - previousPeriodCount) /
                                      previousPeriodCount) *
                                      100
                              )
                            : null

                    return {
                        success: true,
                        summary: {
                            total_flags: totalFlags,
                            active_flags: activeFlags,
                            resolved_flags: resolvedFlags,
                            avg_resolution_hours:
                                resolutionTimes.length > 0
                                    ? Math.round(
                                          (resolutionTimes.reduce((a, b) => a + b, 0) /
                                              resolutionTimes.length) *
                                              10
                                      ) / 10
                                    : null,
                            median_resolution_hours: median(resolutionTimes),
                            stale_count: staleCount,
                        },
                        by_type: byType,
                        by_target: byTarget,
                        trend: {
                            current_period: currentPeriodCount,
                            previous_period: previousPeriodCount,
                            change_pct: changePct,
                        },
                    }
                } catch (err) {
                    return formatHandlerError(err)
                }
            },
        },
    ]
}

// ============================================================================
// Internal Helpers
// ============================================================================

/**
 * Extract the message body from a flag's content string.
 * Content format: `flag:{type}[ — @{target}]: {message}[ [RESOLVED[: comment]]]`
 */
function extractMessageBody(content: string): string {
    // Strip [RESOLVED...] suffix
    const stripped = content.replace(/\s*\[RESOLVED(?::\s*[^\\\]]*)?\]$/u, '')
    // Find the first `: ` after the prefix and return everything after it
    const colonIdx = stripped.indexOf(': ')
    return colonIdx >= 0 ? stripped.slice(colonIdx + 2) : stripped
}
