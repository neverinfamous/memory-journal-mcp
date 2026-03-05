/**
 * Memory Journal MCP Server - Workflow Prompt Definitions
 *
 * Prompts: find-related, prepare-standup, prepare-retro, weekly-digest,
 * analyze-period, goal-tracker, get-context-bundle, get-recent-entries, confirm-briefing
 */

import type { SqliteAdapter } from '../../database/SqliteAdapter.js'
import { ICON_PROMPT } from '../../constants/icons.js'
import { execQuery, type InternalPromptDef } from './index.js'

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
            handler: (args: Record<string, string>, db: SqliteAdapter) => {
                const query = args['query'] ?? ''
                const entries = db.searchEntries(query, { limit: 5 })

                return {
                    messages: [
                        {
                            role: 'user',
                            content: {
                                type: 'text',
                                text: `Find entries related to: "${query}"\n\nRecent matching entries:\n${entries.map((e) => `- [${String(e.id)}] ${e.content.slice(0, 100)}...`).join('\n')}`,
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
            handler: (_args: Record<string, string>, db: SqliteAdapter) => {
                const today = new Date().toISOString().split('T')[0] ?? ''
                const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0] ?? ''

                const entries = db.searchByDateRange(yesterday, today)

                return {
                    messages: [
                        {
                            role: 'user',
                            content: {
                                type: 'text',
                                text: `Prepare a standup summary based on these recent entries:\n\n${entries.map((e) => `[${e.timestamp}] ${e.entryType}: ${e.content}`).join('\n\n')}\n\nFormat as:\n- Yesterday: <summary>\n- Today: <planned work>\n- Blockers: <any blockers>`,
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
            handler: (args: Record<string, string>, db: SqliteAdapter) => {
                const days = parseInt(args['days'] ?? '14', 10)
                const endDate = new Date().toISOString().split('T')[0] ?? ''
                const startDate =
                    new Date(Date.now() - days * 86400000).toISOString().split('T')[0] ?? ''

                const entries = db.searchByDateRange(startDate, endDate)

                return {
                    messages: [
                        {
                            role: 'user',
                            content: {
                                type: 'text',
                                text: `Prepare a retrospective for the last ${String(days)} days based on these entries:\n\n${entries
                                    .slice(0, 20)
                                    .map(
                                        (e) =>
                                            `[${e.timestamp}] ${e.entryType}: ${e.content.slice(0, 200)}`
                                    )
                                    .join(
                                        '\n\n'
                                    )}\n\nFormat as:\n- What went well\n- What could improve\n- Action items`,
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
            handler: (_args: Record<string, string>, db: SqliteAdapter) => {
                const endDate = new Date().toISOString().split('T')[0] ?? ''
                const startDate =
                    new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0] ?? ''

                const entries = db.searchByDateRange(startDate, endDate)

                return {
                    messages: [
                        {
                            role: 'user',
                            content: {
                                type: 'text',
                                text: `Create a weekly digest from these entries:\n\n${entries.map((e) => `[${e.timestamp}] ${e.entryType}: ${e.content.slice(0, 150)}`).join('\n\n')}\n\nFormat as day-by-day summary with highlights.`,
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
            handler: (args: Record<string, string>, db: SqliteAdapter) => {
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
                                text: `Analyze the period ${startDate} to ${endDate}:\n\nStatistics: ${JSON.stringify(stats, null, 2)}\n\nEntries (${String(entries.length)} total):\n${entries
                                    .slice(0, 15)
                                    .map(
                                        (e) =>
                                            `[${e.timestamp}] ${e.entryType}: ${e.content.slice(0, 100)}`
                                    )
                                    .join(
                                        '\n'
                                    )}\n\nProvide insights on patterns, productivity, and recommendations.`,
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
            handler: (_args: Record<string, string>, db: SqliteAdapter) => {
                const entries = execQuery(
                    db,
                    `
                    SELECT * FROM memory_journal
                    WHERE significance_type IS NOT NULL
                    AND deleted_at IS NULL
                    ORDER BY timestamp DESC
                    LIMIT 20
                `
                )

                return {
                    messages: [
                        {
                            role: 'user',
                            content: {
                                type: 'text',
                                text: `Track goals and milestones based on significant entries:\n\n${JSON.stringify(entries, null, 2)}\n\nSummarize progress toward goals and highlight achievements.`,
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
            handler: (_args: Record<string, string>, db: SqliteAdapter) => {
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

**Recent Entries (${String(recent.length)}):**
${entrySummaries.map((e) => `- #${String(e.id)} (${e.type}) ${e.preview}`).join('\n')}

**Statistics:** ${JSON.stringify(stats)}

**For full GitHub status:** Fetch \`memory://github/status\`
**For full entry details:** Use \`get_entry_by_id\` with entry ID`,
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
            handler: (args: Record<string, string>, db: SqliteAdapter) => {
                const limit = parseInt(args['limit'] ?? '10', 10)
                const entries = db.getRecentEntries(limit)

                return {
                    messages: [
                        {
                            role: 'user',
                            content: {
                                type: 'text',
                                text: `Recent ${String(limit)} entries:\n\n${entries.map((e) => `## ${e.timestamp} (${e.entryType})\n\n${e.content}\n\nTags: ${e.tags.join(', ') || 'none'}`).join('\n\n---\n\n')}`,
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
            handler: (_args: Record<string, string>, db: SqliteAdapter) => {
                const recent = db.getRecentEntries(3)
                const stats = db.getStatistics('week')
                const totalEntries = stats.totalEntries ?? 0

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
${entrySummary}

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
    ]
}
