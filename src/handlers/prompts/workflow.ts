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

/** Milliseconds in one day */
const MS_PER_DAY = 86_400_000

/**
 * Get workflow prompt definitions
 */
export function getWorkflowPromptDefinitions(): InternalPromptDef[] {
    return [
        {
            name: 'find-related',
            description: 'Discover connected entries via semantic similarity',
            icons: [ICON_PROMPT],
            arguments: [
                {
                    name: 'query',
                    description: 'Search query for finding related entries',
                    required: true,
                },
            ],
            handler: (args: Record<string, string>, db: IDatabaseAdapter) => {
                const query = args['query'] ?? ''
                const entries = db.searchEntries(query, { limit: 5 })

                return {
                    messages: [
                        {
                            role: 'user',
                            content: {
                                type: 'text',
                                text: `Find entries related to: "${query}"

Recent matching entries:
${markUntrustedContent(entries.map((e) => `- [${String(e.id)}] ${e.content.slice(0, 100)}...`).join('\n'))}`,
                            },
                        },
                    ],
                }
            },
        },
        {
            name: 'prepare-standup',
            description: 'Daily standup summaries',
            icons: [ICON_PROMPT],
            arguments: [],
            handler: (_args: Record<string, string>, db: IDatabaseAdapter) => {
                const today = new Date().toISOString().split('T')[0] ?? ''
                const yesterday =
                    new Date(Date.now() - MS_PER_DAY).toISOString().split('T')[0] ?? ''

                const entries = db.searchByDateRange(yesterday, today)

                // Inject digest signals when available
                const digestSignal = buildDigestSignalForPrompt(db)

                return {
                    messages: [
                        {
                            role: 'user',
                            content: {
                                type: 'text',
                                text: `${digestSignal}Prepare a standup summary based on these recent entries.
Format as:
- Yesterday: <summary>
- Today: <planned work>
- Blockers: <any blockers>

Sources:
${markUntrustedContent(entries.map((e) => `[${e.timestamp}] ${e.entryType}: ${e.content}`).join('\n\n'))}`,
                            },
                        },
                    ],
                }
            },
        },
        {
            name: 'prepare-retro',
            description: 'Sprint retrospectives',
            icons: [ICON_PROMPT],
            arguments: [
                {
                    name: 'days',
                    description: 'Number of days to include (default: 14)',
                    required: false,
                },
            ],
            handler: (args: Record<string, string>, db: IDatabaseAdapter) => {
                const days = parseInt(args['days'] ?? '14', 10)
                const endDate = new Date().toISOString().split('T')[0] ?? ''
                const startDate =
                    new Date(Date.now() - days * MS_PER_DAY).toISOString().split('T')[0] ?? ''

                const entries = db.searchByDateRange(startDate, endDate)

                // Inject digest signals when available
                const digestSignal = buildDigestSignalForPrompt(db)

                return {
                    messages: [
                        {
                            role: 'user',
                            content: {
                                type: 'text',
                                text: `${digestSignal}Prepare a retrospective for the last ${String(days)} days based on these entries.
Format as:
- What went well
- What could improve
- Action items

Sources:
${markUntrustedContent(
    entries
        .slice(0, 20)
        .map((e) => `[${e.timestamp}] ${e.entryType}: ${e.content.slice(0, 200)}`)
        .join('\n\n')
)}`,
                            },
                        },
                    ],
                }
            },
        },
        {
            name: 'weekly-digest',
            description: 'Day-by-day weekly summaries',
            icons: [ICON_PROMPT],
            arguments: [],
            handler: (_args: Record<string, string>, db: IDatabaseAdapter) => {
                const endDate = new Date().toISOString().split('T')[0] ?? ''
                const startDate =
                    new Date(Date.now() - 7 * MS_PER_DAY).toISOString().split('T')[0] ?? ''

                const entries = db.searchByDateRange(startDate, endDate)

                return {
                    messages: [
                        {
                            role: 'user',
                            content: {
                                type: 'text',
                                text: `Create a weekly digest from these entries.
Format as day-by-day summary with highlights.

Sources:
${markUntrustedContent(entries.map((e) => `[${e.timestamp}] ${e.entryType}: ${e.content.slice(0, 150)}`).join('\n\n'))}`,
                            },
                        },
                    ],
                }
            },
        },
        {
            name: 'analyze-period',
            description: 'Deep period analysis with insights',
            icons: [ICON_PROMPT],
            arguments: [
                { name: 'start_date', description: 'Start date (YYYY-MM-DD)', required: true },
                { name: 'end_date', description: 'End date (YYYY-MM-DD)', required: true },
            ],
            handler: (args: Record<string, string>, db: IDatabaseAdapter) => {
                const startDate = args['start_date'] ?? ''
                const endDate = args['end_date'] ?? ''

                const entries = db.searchByDateRange(startDate, endDate)
                const stats = db.getStatistics('day')

                return {
                    messages: [
                        {
                            role: 'user',
                            content: {
                                type: 'text',
                                text: `Analyze the period ${startDate} to ${endDate}:

Statistics: ${JSON.stringify(stats, null, 2)}

Provide insights on patterns, productivity, and recommendations.

Sources (${String(entries.length)} total):
${markUntrustedContent(
    entries
        .slice(0, 15)
        .map((e) => `[${e.timestamp}] ${e.entryType}: ${e.content.slice(0, 100)}`)
        .join('\n')
)}`,
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
            name: 'get-context-bundle',
            description: 'Project context with recent entries, statistics, and GitHub status hints',
            icons: [ICON_PROMPT],
            arguments: [],
            handler: (_args: Record<string, string>, db: IDatabaseAdapter) => {
                const recent = db.getRecentEntries(5)
                const stats = db.getStatistics('week')

                const entrySummaries = recent.map((e) => ({
                    id: e.id,
                    type: e.entryType,
                    timestamp: e.timestamp,
                    preview: e.content.slice(0, 60) + (e.content.length > 60 ? '...' : ''),
                }))

                return {
                    messages: [
                        {
                            role: 'user',
                            content: {
                                type: 'text',
                                text: `Project context bundle:

**Statistics:** ${JSON.stringify(stats)}

**For full GitHub status:** Fetch \`memory://github/status\`
**For full entry details:** Use \`get_entry_by_id\` with entry ID

**Recent Entries (${String(recent.length)}):**
${markUntrustedContent(entrySummaries.map((e) => `- #${String(e.id)} (${e.type}) ${e.preview}`).join('\n'))}`,
                            },
                        },
                    ],
                }
            },
        },
        {
            name: 'get-recent-entries',
            description: 'Formatted recent entries',
            icons: [ICON_PROMPT],
            arguments: [
                { name: 'limit', description: 'Number of entries (default: 10)', required: false },
            ],
            handler: (args: Record<string, string>, db: IDatabaseAdapter) => {
                const limit = parseInt(args['limit'] ?? '10', 10)
                const entries = db.getRecentEntries(limit)

                return {
                    messages: [
                        {
                            role: 'user',
                            content: {
                                type: 'text',
                                text: `Recent ${String(limit)} entries:

${markUntrustedContent(entries.map((e) => `## ${e.timestamp} (${e.entryType})\n\n${e.content}\n\nTags: ${e.tags.join(', ') || 'none'}`).join('\n\n---\n\n'))}`,
                            },
                        },
                    ],
                }
            },
        },
        {
            name: 'confirm-briefing',
            description:
                'Acknowledge session context received from memory://briefing to inform the user',
            icons: [ICON_PROMPT],
            arguments: [],
            handler: (_args: Record<string, string>, db: IDatabaseAdapter) => {
                const recent = db.getRecentEntries(3)
                const stats = db.getStatistics('week')
                const totalEntries = (stats as { totalEntries?: number }).totalEntries ?? 0

                const entrySummary =
                    recent.length > 0
                        ? recent
                              .map(
                                  (e) =>
                                      `  - #${String(e.id)} (${e.entryType}) ${e.content.slice(0, 40)}...`
                              )
                              .join('\n')
                        : '  - No entries yet'

                return {
                    messages: [
                        {
                            role: 'user',
                            content: {
                                type: 'text',
                                text: `Generate a briefing acknowledgment for the user with this context:

**Session Context Received:**
- **Journal**: ${String(totalEntries)} total entries
- **Latest Entries**:
${markUntrustedContent(entrySummary)}

**My Behaviors:**
- Create entries for: implementations, decisions, bug fixes, milestones
- Search before: major decisions, referencing prior work
- Link entries: implementation→spec, bugfix→issue

**For More Context:**
- Full entries: \`memory://recent\` or \`get_entry_by_id(ID)\`
- GitHub status: \`memory://github/status\`
- Repo insights: \`memory://github/insights\` (stars, traffic, clones)
- Full health: \`memory://health\`

Please confirm this context to the user in a concise, friendly format. Use a table if helpful.`,
                            },
                        },
                    ],
                }
            },
        },
        {
            name: 'session-summary',
            description:
                'Create a session summary entry capturing what was accomplished, pending items, and context for the next session',
            icons: [ICON_PROMPT],
            arguments: [],
            handler: (_args: Record<string, string>, db: IDatabaseAdapter) => {
                const recent = db.getRecentEntries(5)

                const entrySummary =
                    recent.length > 0
                        ? recent
                              .map(
                                  (e) =>
                                      `- #${String(e.id)} (${e.entryType}) ${e.content.slice(0, 80)}${e.content.length > 80 ? '...' : ''}`
                              )
                              .join('\n')
                        : '- No entries yet'

                return {
                    messages: [
                        {
                            role: 'user',
                            content: {
                                type: 'text',
                                text: `Create a session summary journal entry based on this context:

**Instructions:**
1. Summarize what was accomplished in this session (key changes, decisions, files modified)
2. Note what's unfinished or blocked (pending items, open questions)
3. Include context for the next session (relevant entry IDs, branch names, PR numbers)
4. Use \`entry_type: "retrospective"\` and tag with \`session-summary\`

**Recent Entries:**
${markUntrustedContent(entrySummary)}`,
                            },
                        },
                    ],
                }
            },
        },
        {
            name: 'team-session-summary',
            description:
                'Create a session summary entry for the team capturing what was accomplished, pending items, and context for the next team session',
            icons: [ICON_PROMPT],
            arguments: [],
            handler: (
                _args: Record<string, string>,
                _db: IDatabaseAdapter,
                teamDb?: IDatabaseAdapter
            ) => {
                if (!teamDb) {
                    throw new ConfigurationError('Team database not configured')
                }

                const recent = teamDb.getRecentEntries(5)

                const entrySummary =
                    recent.length > 0
                        ? recent
                              .map(
                                  (e) =>
                                      `- #${String(e.id)} (${e.entryType}) ${e.content.slice(0, 80)}${e.content.length > 80 ? '...' : ''}`
                              )
                              .join('\n')
                        : '- No entries yet'

                return {
                    messages: [
                        {
                            role: 'user',
                            content: {
                                type: 'text',
                                text: `Create a team session summary journal entry based on this context:

**Instructions:**
1. Summarize what the team accomplished in this session (key changes, decisions, files modified)
2. Note what's unfinished or blocked for the team (pending items, open questions)
3. Include context for the next team session (relevant entry IDs, branch names, PR numbers)
4. Use \`entry_type: "retrospective"\` and tag with \`session-summary\`
5. YOU MUST USE \`team_create_entry\` OR \`mj.team.create\` TO SAVE THIS ENTRY.

**Recent Team Entries:**
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
