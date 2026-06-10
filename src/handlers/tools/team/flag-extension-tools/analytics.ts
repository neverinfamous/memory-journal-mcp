import type { ToolDefinition, ToolContext } from '../../../../types/index.js'
import { formatHandlerError } from '../../../../utils/error-helpers.js'
import { TEAM_DB_ERROR_RESPONSE } from '../helpers.js'
import { FlagAnalyticsSchema, FlagAnalyticsSchemaMcp, FlagAnalyticsOutputSchema } from '../schemas.js'
import { parseFlagContext } from '../../../../types/auto-context.js'
import { getPeriodMs, median, STALE_THRESHOLD_MS } from './helpers.js'

export function getFlagAnalyticsTool(context: ToolContext): ToolDefinition[] {
    const { teamDb } = context

    return [
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

                    const projectNumber = input.project_number

                    const now = Date.now()
                    const periodMs = getPeriodMs(input.period)

                    const { entries: flagEntries } = teamDb.searchEntries('', {
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
                    const targetStats: Record<string, { received: number; active: number }> = {}

                    let currentPeriodCount = 0
                    let previousPeriodCount = 0

                    for (const entry of flagEntries) {
                        const ctx = parseFlagContext(entry.autoContext)
                        if (!ctx) continue

                        // Project boundary filter
                        if (entry.projectNumber !== projectNumber) continue

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
                                    Math.round(((resolvedTime - entryTime) / 3_600_000) * 10) / 10
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
