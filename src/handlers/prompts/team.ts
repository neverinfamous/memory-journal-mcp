/**
 * Memory Journal MCP Server - Team Prompt Definitions
 *
 * Prompts: flag-dashboard
 *
 * Team-scoped prompts that operate on the shared team database.
 * Requires TEAM_DB_PATH to be configured.
 */

import type { IDatabaseAdapter } from '../../database/core/interfaces.js'
import { ICON_PROMPT } from '../../constants/icons.js'
import type { InternalPromptDef } from './index.js'
import { ConfigurationError } from '../../types/errors.js'
import { parseFlagContext, type FlagContext } from '../../types/auto-context.js'
import { markUntrustedContent } from '../../utils/security-utils.js'

// ============================================================================
// Constants
// ============================================================================

/** Staleness threshold in milliseconds (24 hours) */
const STALE_THRESHOLD_MS = 86_400_000

/** Recently-resolved window in milliseconds (48 hours) */
const RESOLVED_WINDOW_MS = 172_800_000

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

interface ParsedFlag {
    id: number
    flag_type: string
    target_user: string | null
    content: string
    timestamp: string
    ageMs: number
    isStale: boolean
    context: FlagContext
}

/**
 * Format a duration in milliseconds to a human-readable age string.
 */
function formatAge(ms: number): string {
    const hours = Math.floor(ms / 3_600_000)
    const days = Math.floor(ms / 86_400_000)

    if (days > 0) return `${String(days)}d ago`
    if (hours > 0) return `${String(hours)}h ago`
    return 'just now'
}

/**
 * Get the sort priority for a flag type. Unknown types sort last.
 */
function getFlagPriority(flagType: string): number {
    return FLAG_PRIORITY.get(flagType) ?? 99
}

/**
 * Parse and partition flag entries into active and recently-resolved groups.
 */
function partitionFlags(
    teamDb: IDatabaseAdapter,
    flagTypeFilter?: string
): { active: ParsedFlag[]; recentlyResolved: ParsedFlag[] } {
    const now = Date.now()

    const flagEntries = teamDb.searchEntries('', {
        entryType: 'flag',
        limit: 50,
    })

    const active: ParsedFlag[] = []
    const recentlyResolved: ParsedFlag[] = []

    for (const entry of flagEntries) {
        const ctx = parseFlagContext(entry.autoContext)
        if (!ctx) continue

        // Apply optional type filter
        if (flagTypeFilter && ctx.flag_type !== flagTypeFilter) continue

        const entryTime = new Date(entry.timestamp).getTime()
        const ageMs = now - entryTime

        const parsed: ParsedFlag = {
            id: entry.id,
            flag_type: ctx.flag_type,
            target_user: ctx.target_user ?? null,
            content: entry.content,
            timestamp: entry.timestamp,
            ageMs,
            isStale: ageMs > STALE_THRESHOLD_MS,
            context: ctx,
        }

        if (!ctx.resolved) {
            active.push(parsed)
        } else if (ageMs < RESOLVED_WINDOW_MS) {
            recentlyResolved.push(parsed)
        }
    }

    // Sort active flags by priority (blockers first), then by age (oldest first)
    active.sort((a, b) => {
        const priorityDiff = getFlagPriority(a.flag_type) - getFlagPriority(b.flag_type)
        if (priorityDiff !== 0) return priorityDiff
        return b.ageMs - a.ageMs
    })

    // Sort resolved flags by most recently resolved first
    recentlyResolved.sort((a, b) => a.ageMs - b.ageMs)

    return { active, recentlyResolved }
}

/**
 * Format a list of parsed flags into a readable summary block.
 */
function formatFlagList(flags: ParsedFlag[], showStale: boolean): string {
    if (flags.length === 0) return '_None_'

    return flags
        .map((f) => {
            const staleMarker = showStale && f.isStale ? ' ⏰ STALE' : ''
            const targetStr = f.target_user ? ` → @${f.target_user}` : ''
            const age = formatAge(f.ageMs)
            const preview = f.content.length > 120 ? f.content.slice(0, 120) + '…' : f.content

            return `- **#${String(f.id)}** \`${f.flag_type}\`${targetStr} (${age}${staleMarker})\n  ${preview}`
        })
        .join('\n')
}

// ============================================================================
// Prompt Definitions
// ============================================================================

/**
 * Get team prompt definitions
 */
export function getTeamPromptDefinitions(): InternalPromptDef[] {
    return [
        {
            name: 'flag-dashboard',
            description: 'Triage active flags with priority assessment and resolution guidance',
            icons: [ICON_PROMPT],
            arguments: [
                {
                    name: 'flag_type',
                    description:
                        'Filter to a specific flag type (e.g., blocker, needs_review). Omit to show all.',
                    required: false,
                },
            ],
            handler: (
                args: Record<string, string>,
                _db: IDatabaseAdapter,
                teamDb?: IDatabaseAdapter
            ) => {
                if (!teamDb) {
                    throw new ConfigurationError('Team database not configured')
                }

                const flagTypeFilter = args['flag_type'] || undefined
                const { active, recentlyResolved } = partitionFlags(teamDb, flagTypeFilter)

                const filterNote = flagTypeFilter
                    ? `\n**Filter**: Showing only \`${flagTypeFilter}\` flags.\n`
                    : ''

                const activeSummary = markUntrustedContent(formatFlagList(active, true))
                const resolvedSummary = markUntrustedContent(
                    formatFlagList(recentlyResolved, false)
                )

                // Compute analytics summary for the prompt
                const allFlagEntries = teamDb.searchEntries('', {
                    entryType: 'flag',
                    limit: 500,
                })
                let totalFlags = 0
                let totalResolved = 0
                const resolutionTimes: number[] = []
                for (const entry of allFlagEntries) {
                    const ctx = parseFlagContext(entry.autoContext)
                    if (!ctx) continue
                    totalFlags++
                    if (ctx.resolved) {
                        totalResolved++
                        if (ctx.resolved_at) {
                            const created = new Date(entry.timestamp).getTime()
                            const resolved = new Date(ctx.resolved_at).getTime()
                            const hours = Math.round(((resolved - created) / 3_600_000) * 10) / 10
                            if (hours >= 0) resolutionTimes.push(hours)
                        }
                    }
                }
                const avgResolution =
                    resolutionTimes.length > 0
                        ? Math.round(
                              (resolutionTimes.reduce((a, b) => a + b, 0) /
                                  resolutionTimes.length) *
                                  10
                          ) / 10
                        : null
                const analyticsSection = `## Flag Health Summary

| Metric | Value |
|--------|-------|
| Total flags (all time) | ${String(totalFlags)} |
| Active | ${String(active.length)} |
| Resolved | ${String(totalResolved)} |
| Avg resolution time | ${avgResolution !== null ? `${String(avgResolution)}h` : 'N/A'} |
| Stale (>24h) | ${String(active.filter((f) => f.isStale).length)} |
`

                return {
                    messages: [
                        {
                            role: 'user',
                            content: {
                                type: 'text',
                                text: `# Flag Dashboard — Triage Report
${filterNote}
${analyticsSection}
## Active Flags (${String(active.length)})

${activeSummary}

## Recently Resolved (last 48h) (${String(recentlyResolved.length)})

${resolvedSummary}

## Instructions

Analyze the active flags above and provide:

1. **Priority Assessment**: Which flags need immediate attention? Highlight any flags marked ⏰ STALE (>24h unresolved) — these are overdue.
2. **Resolution Guidance**: For each active flag, suggest a concrete next step:
   - \`blocker\`: Identify what's blocking and who can unblock it. Recommend escalation if stale.
   - \`needs_review\`: Identify the reviewable artifact and suggest a reviewer assignment.
   - \`help_requested\`: Summarize the ask and suggest pairing or pointing to relevant prior entries.
   - \`fyi\`: Acknowledge and recommend resolving if no action is needed.
3. **Batch Resolutions**: If any flags are clearly resolved (work completed, no longer relevant), recommend resolving them with suggested resolution comments.
4. **Flag Health**: Comment on the overall flag health metrics above — is resolution velocity acceptable? Are there bottlenecks?

Use \`team_resolve_flag\` (or \`mj.team.resolveTeamFlag()\` in Code Mode) to resolve flags. Use \`team_update_flag\` (or \`mj.team.teamUpdateFlag()\`) to escalate or reassign. Use \`team_get_flag_analytics\` for deeper analytics. Include a resolution comment describing what was done.`,
                            },
                        },
                    ],
                }
            },
        },
    ]
}
