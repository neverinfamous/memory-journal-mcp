/**
 * Memory Journal MCP Server - GitHub Prompt Definitions
 *
 * Prompts: project-status-summary, pr-summary, code-review-prep,
 * pr-retrospective, actions-failure-digest, project-milestone-tracker
 */

import type { IDatabaseAdapter } from '../../database/core/interfaces.js'
import { ICON_PROMPT } from '../../constants/icons.js'
import type { InternalPromptDef } from './index.js'
import type { JournalEntry } from '../../types/index.js'
import { markUntrustedContentInline } from '../../utils/security-utils.js'

function formatPromptEntries(
    entries: JournalEntry[],
    maxCount = 50
): { id: number; type: string; timestamp: string; content: string }[] {
    return entries
        .slice(0, maxCount)
        .map(
            (
                e: JournalEntry
            ): { id: number; type: string; timestamp: string; content: string } => ({
                id: e.id,
                type: e.entryType,
                timestamp: e.timestamp,
                content: markUntrustedContentInline(
                    e.content.length > 250 ? e.content.slice(0, 250) + '...' : e.content
                ),
            })
        )
}

/**
 * Get GitHub prompt definitions
 */
export function getGitHubPromptDefinitions(): InternalPromptDef[] {
    return [
        {
            name: 'project-workflow',
            description: 'Project status and milestone tracking',
            icons: [ICON_PROMPT],
            arguments: [
                { name: 'project_number', description: 'GitHub Project number', required: true },
                { name: 'workflow_type', description: 'status | milestone', required: false },
            ],
            handler: (args: Record<string, string>, _db: IDatabaseAdapter) => {
                const projectNumber = parseInt(args['project_number'] ?? '0', 10)
                const type = args['workflow_type'] ?? 'status'

                return {
                    messages: [
                        {
                            role: 'user',
                            content: {
                                type: 'text',
                                text: `Execute a ${type} workflow for Project #${String(projectNumber)}.
To complete this task, you MUST first read the following resource to obtain the project's context:
\`memory://projects/${String(projectNumber)}/timeline\`

If doing a status summary: Provide overview, recent activity, blockers, next steps.
If doing a milestone tracker: Provide progress summary, upcoming milestones, timeline.`,
                            },
                        },
                    ],
                }
            },
        },
        {
            name: 'pr-workflow',
            description: 'Pull request summary, review prep, and retrospectives',
            icons: [ICON_PROMPT],
            arguments: [
                { name: 'pr_number', description: 'Pull request number', required: true },
                { name: 'workflow_type', description: 'summary | review | retro', required: false },
            ],
            handler: (args: Record<string, string>, _db: IDatabaseAdapter) => {
                const prNumber = parseInt(args['pr_number'] ?? '0', 10)
                const type = args['workflow_type'] ?? 'summary'

                return {
                    messages: [
                        {
                            role: 'user',
                            content: {
                                type: 'text',
                                text: `Execute a ${type} workflow for PR #${String(prNumber)}.
To complete this task, you MUST first read the following resources to obtain the PR's context:
- \`memory://prs/${String(prNumber)}/entries\`
- \`memory://prs/${String(prNumber)}/timeline\`

If doing a summary: Provide summary of changes, decisions made, testing done.
If doing a review: Provide review checklist, areas of concern, testing recommendations.
If doing a retro: Provide what went well, challenges, lessons learned.`,
                            },
                        },
                    ],
                }
            },
        },
        {
            name: 'actions-failure-digest',
            description: 'CI/CD failure analysis with root cause identification',
            icons: [ICON_PROMPT],
            arguments: [],
            handler: (_args: Record<string, string>, db: IDatabaseAdapter) => {
                const entries = db.getWorkflowActionEntries(20)

                return {
                    messages: [
                        {
                            role: 'user',
                            content: {
                                type: 'text',
                                text: `Analyze CI/CD failures from these workflow entries.
Provide: failure patterns, root causes, remediation steps.

Sources:
${JSON.stringify(formatPromptEntries(entries), null, 2)}`,
                            },
                        },
                    ],
                }
            },
        },
    ]
}
