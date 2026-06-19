/**
 * Memory Journal MCP Server - Workflow Prompt Definitions
 *
 * Prompts: find-related, prepare-standup, prepare-retro, weekly-digest,
 * analyze-period, goal-tracker, get-context-bundle, get-recent-entries, confirm-briefing,
 * session-summary
 */

import type { IDatabaseAdapter } from '../../database/core/interfaces.js'
import { ICON_PROMPT } from '../../constants/icons.js'
import type { InternalPromptDef } from './index.js'
import { ConfigurationError } from '../../types/errors.js'
import { markUntrustedContent, markUntrustedContentInline } from '../../utils/security-utils.js'
import { parseFlagContext } from '../../types/auto-context.js'


/**
 * Get workflow prompt definitions
 */
export function getWorkflowPromptDefinitions(): InternalPromptDef[] {
    return [
        {
            name: 'time-period-analysis',
            description: 'Analyze entries over a specific time period (standup, weekly, retro)',
            icons: [ICON_PROMPT],
            arguments: [
                {
                    name: 'period_type',
                    description: 'standup | weekly | retro | custom',
                    required: true,
                },
                { name: 'start_date', description: 'Start date (YYYY-MM-DD)', required: false },
                { name: 'end_date', description: 'End date (YYYY-MM-DD)', required: false },
            ],
            handler: (
                args: Record<string, string>,
                db: IDatabaseAdapter,
                teamDb?: IDatabaseAdapter
            ) => {
                const type = args['period_type'] ?? 'custom'
                const startDate = args['start_date'] ?? ''
                const endDate = args['end_date'] ?? ''

                const digestSignal = buildDigestSignalForPrompt(db)
                const flagSignal = buildFlagSignalForPrompt(teamDb)

                let instructions: string
                if (type === 'standup') {
                    instructions = 'Prepare a daily standup summary (Yesterday, Today, Blockers).'
                } else if (type === 'retro') {
                    instructions = 'Prepare a sprint retrospective (What went well, What could improve, Action items).'
                } else if (type === 'weekly') {
                    instructions = 'Create a weekly digest formatted day-by-day.'
                } else {
                    instructions = `Analyze the period from ${startDate} to ${endDate}.`
                }

                return {
                    messages: [
                        {
                            role: 'user',
                            content: {
                                type: 'text',
                                text: `${digestSignal}${flagSignal}Execute a ${type} analysis.
${instructions}

To complete this task, you MUST first fetch the relevant entries using \`search_by_date_range\` or read \`memory://recent\`. Do not hallucinate entries.`,
                            },
                        },
                    ],
                }
            },
        },
        {
            name: 'goal-tracker',
            description: 'Milestone and achievement tracking',
            icons: [ICON_PROMPT],
            arguments: [],
            handler: (_args: Record<string, string>, db: IDatabaseAdapter) => {
                const entries = db.getSignificantEntries(20)

                const mappedEntries = entries.map((e) => ({
                    id: e.id,
                    type: e.entryType,
                    timestamp: e.timestamp,
                    content: markUntrustedContentInline(
                        e.content.length > 250 ? e.content.slice(0, 250) + '...' : e.content
                    ),
                }))

                return {
                    messages: [
                        {
                            role: 'user',
                            content: {
                                type: 'text',
                                text: `Track goals and milestones based on significant entries.
Summarize progress toward goals and highlight achievements.

Sources:
${JSON.stringify(mappedEntries, null, 2)}`,
                            },
                        },
                    ],
                }
            },
        },
        {
            name: 'session-summary',
            description: 'Create a formatted session summary entry',
            icons: [ICON_PROMPT],
            arguments: [
                {
                    name: 'target',
                    description: 'personal | team (default: personal)',
                    required: false,
                },
            ],
            handler: (
                args: Record<string, string>,
                db: IDatabaseAdapter,
                teamDb?: IDatabaseAdapter
            ) => {
                const target = args['target'] ?? 'personal'
                
                if (target === 'team' && !teamDb) {
                    throw new ConfigurationError('Team database not configured')
                }

                const targetDb = target === 'team' && teamDb ? teamDb : db
                const { entries: recent } = targetDb.getRecentEntries(5)

                const entrySummary =
                    recent.length > 0
                        ? recent
                              .map(
                                  (e) =>
                                      `- #${String(e.id)} (${e.entryType}) ${e.content.slice(0, 80)}${e.content.length > 80 ? '...' : ''}`
                              )
                              .join('\\n')
                        : '- No entries yet'

                const dbHint = target === 'team' 
                    ? 'YOU MUST USE `team_create_entry` OR `mj.team.teamCreateEntry` TO SAVE THIS ENTRY.'
                    : 'Use `create_entry` or `await mj.core.createEntry({ project_number: <CURRENT_PROJECT_NUMBER>, ... })` via `mj_execute_code`'

                return {
                    messages: [
                        {
                            role: 'user',
                            content: {
                                type: 'text',
                                text: `Create a ${target === 'team' ? 'team ' : ''}session summary journal entry using EXACTLY this template:

**Required Parameters:**
- \`entry_type: "retrospective"\`
- \`tags: ["session-summary"]\` (plus relevant domain tags)
- \`project_number\`: [REQUIRED] Integer ID mapped from your active workspace context
- \`auto_context\`: [OPTIONAL] JSON string of commit metadata if any commits were made
- ${dbHint}

**Required Content Structure (use EXACTLY these section headers):**
\`\`\`
## Accomplished
- [List concrete items: changes made, decisions taken, files modified, PRs submitted]

## Unfinished / Blocked
- [List pending items, blockers, open questions — or "None" if everything is complete]

## Context for Next Session
- [List key context: relevant entry IDs, branch names, PR numbers, pending decisions]

## Commits
- [List commit SHAs made during the session, or "None"]
\`\`\`

**Rules:**
- Do NOT add extra top-level sections (no "## Summary", "## Overview", "## Notes", etc.)
- Do NOT omit any of the four required sections
- Use bullet points within each section
- Reference specific entry IDs, file names, and PR numbers where relevant

**Recent Entries (for context):**
${markUntrustedContent(entrySummary)}`,
                            },
                        },
                    ],
                }
            },
        },
    ]
}

/**
 * Build a concise analytics signal string for injection into standup/retro prompts.
 * Returns empty string when no digest is available (graceful degradation).
 */
function buildDigestSignalForPrompt(db: IDatabaseAdapter): string {
    const snapshot = db.getLatestAnalyticsSnapshot?.('digest')
    if (!snapshot) return ''

    const data = snapshot.data
    const lines: string[] = ['[Analytics Context]']

    // Activity trend
    const growth = data['activityGrowthPercent'] as number | null | undefined
    const currentEntries = data['currentPeriodEntries'] as number | undefined
    if (growth !== null && growth !== undefined) {
        const sign = growth >= 0 ? '+' : ''
        lines.push(
            `Activity: ${sign}${String(growth)}% vs. last period (${String(currentEntries)} entries)`
        )
    }

    // Significance spike
    const sigMultiplier = data['significanceMultiplier'] as number | null | undefined
    const sigCount = data['currentPeriodSignificant'] as number | undefined
    if (sigMultiplier !== null && sigMultiplier !== undefined && sigMultiplier > 1.5) {
        lines.push(
            `Significance: ${String(sigCount)} significant entries (${String(sigMultiplier)}× historical avg)`
        )
    }

    // Stale projects
    const stale = data['staleProjects'] as
        | { projectNumber: number; daysSilent: number }[]
        | undefined
    if (stale && stale.length > 0) {
        const staleStr = stale
            .map((p) => `P${String(p.projectNumber)} (${String(p.daysSilent)}d silent)`)
            .join(', ')
        lines.push(`⚠ Stale: ${staleStr}`)
    }

    // Only return if we have actual signals beyond the header
    if (lines.length <= 1) return ''
    return lines.join('\\n') + '\\n\\n'
}

/**
 * Build a concise active-flags signal string for injection into standup/retro prompts.
 * Returns empty string when team DB is not configured or no active flags exist.
 */
function buildFlagSignalForPrompt(teamDb?: IDatabaseAdapter): string {
    if (!teamDb) return ''

    try {
        const { entries: flagEntries } = teamDb.searchEntries('', {
            entryType: 'flag',
            limit: 20,
        })

        const now = Date.now()
        const activeFlags: {
            flag_type: string
            preview: string
            target_user: string | null
            age: string
        }[] = []

        for (const entry of flagEntries) {
            const ctx = parseFlagContext(entry.autoContext)
            if (!ctx || ctx.resolved) continue

            const ageMs = now - new Date(entry.timestamp).getTime()
            const hours = Math.floor(ageMs / 3_600_000)
            const days = Math.floor(ageMs / 86_400_000)
            const age =
                days > 0 ? `${String(days)}d ago` : hours > 0 ? `${String(hours)}h ago` : 'just now'

            const preview =
                entry.content.length > 80 ? entry.content.slice(0, 80) + '…' : entry.content

            activeFlags.push({
                flag_type: ctx.flag_type,
                preview,
                target_user: ctx.target_user ?? null,
                age,
            })
        }

        if (activeFlags.length === 0) return ''

        const lines: string[] = ['[Active Flags]']
        for (const f of activeFlags) {
            const target = f.target_user ? ` → @${f.target_user}` : ''
            lines.push(`🚩 ${f.flag_type}${target}: ${f.preview} (${f.age})`)
        }

        return lines.join('\\n') + '\\n\\n'
    } catch {
        // Graceful degradation — flags are supplementary context
        return ''
    }
}
