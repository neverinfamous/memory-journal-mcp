/**
 * Memory Journal MCP Server - GitHub Prompt Definitions
 *
 * Prompts: project-status-summary, pr-summary, code-review-prep,
 * pr-retrospective, actions-failure-digest, project-milestone-tracker
 */

import type { IDatabaseAdapter } from '../../database/core/interfaces.js'
import { RAW_ENTRY_COLUMNS as ENTRY_COLUMNS } from '../../database/core/entry-columns.js'
import { ICON_PROMPT } from '../../constants/icons.js'
import { execQuery, type InternalPromptDef } from './index.js'

/**
 * Get GitHub prompt definitions
 */
export function getGitHubPromptDefinitions(): InternalPromptDef[] {
    return [
        {
            name: 'project-status-summary',
            description: 'GitHub Project status reports',
            icons: [ICON_PROMPT],
            arguments: [
                { name: 'project_number', description: 'GitHub Project number', required: true },
            ],
            handler: (args: Record<string, string>, db: IDatabaseAdapter) => {
                const projectNumber = parseInt(args['project_number'] ?? '0', 10)
                const entries = execQuery(
                    db,
                    `
                    SELECT ${ENTRY_COLUMNS} FROM memory_journal
                    WHERE project_number = ?
                    AND deleted_at IS NULL
                    ORDER BY timestamp DESC
                    LIMIT 20
                `,
                    [projectNumber]
                )

                return {
                    messages: [
                        {
                            role: 'user',
                            content: {
                                type: 'text',
                                text: `Generate a status summary for Project #${String(projectNumber)}:\n\nEntries: ${JSON.stringify(entries, null, 2)}\n\nProvide: overview, recent activity, blockers, next steps.`,
                            },
                        },
                    ],
                }
            },
        },
        {
            name: 'pr-summary',
            description: 'Pull request journal activity summary',
            icons: [ICON_PROMPT],
            arguments: [{ name: 'pr_number', description: 'Pull request number', required: true }],
            handler: (args: Record<string, string>, db: IDatabaseAdapter) => {
                const prNumber = parseInt(args['pr_number'] ?? '0', 10)
                const entries = execQuery(
                    db,
                    `
                    SELECT ${ENTRY_COLUMNS} FROM memory_journal
                    WHERE pr_number = ?
                    AND deleted_at IS NULL
                    ORDER BY timestamp ASC
                `,
                    [prNumber]
                )

                return {
                    messages: [
                        {
                            role: 'user',
                            content: {
                                type: 'text',
                                text: `Summarize PR #${String(prNumber)} activity:\n\nJournal entries: ${JSON.stringify(entries, null, 2)}\n\nProvide: summary of changes, decisions made, testing done.`,
                            },
                        },
                    ],
                }
            },
        },
        {
            name: 'code-review-prep',
            description: 'Comprehensive PR review preparation',
            icons: [ICON_PROMPT],
            arguments: [{ name: 'pr_number', description: 'Pull request number', required: true }],
            handler: (args: Record<string, string>, db: IDatabaseAdapter) => {
                const prNumber = parseInt(args['pr_number'] ?? '0', 10)
                const entries = execQuery(
                    db,
                    `
                    SELECT ${ENTRY_COLUMNS} FROM memory_journal
                    WHERE pr_number = ?
                    AND deleted_at IS NULL
                    ORDER BY timestamp ASC
                `,
                    [prNumber]
                )

                return {
                    messages: [
                        {
                            role: 'user',
                            content: {
                                type: 'text',
                                text: `Prepare for code review of PR #${String(prNumber)}:\n\nContext entries: ${JSON.stringify(entries, null, 2)}\n\nProvide: review checklist, areas of concern, testing recommendations.`,
                            },
                        },
                    ],
                }
            },
        },
        {
            name: 'pr-retrospective',
            description: 'Completed PR analysis with learnings',
            icons: [ICON_PROMPT],
            arguments: [{ name: 'pr_number', description: 'Pull request number', required: true }],
            handler: (args: Record<string, string>, db: IDatabaseAdapter) => {
                const prNumber = parseInt(args['pr_number'] ?? '0', 10)
                const entries = execQuery(
                    db,
                    `
                    SELECT ${ENTRY_COLUMNS} FROM memory_journal
                    WHERE pr_number = ?
                    AND deleted_at IS NULL
                    ORDER BY timestamp ASC
                `,
                    [prNumber]
                )

                return {
                    messages: [
                        {
                            role: 'user',
                            content: {
                                type: 'text',
                                text: `Retrospective for PR #${String(prNumber)}:\n\nJournal entries: ${JSON.stringify(entries, null, 2)}\n\nProvide: what went well, challenges, lessons learned.`,
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
                const entries = execQuery(
                    db,
                    `
                    SELECT ${ENTRY_COLUMNS} FROM memory_journal
                    WHERE workflow_run_id IS NOT NULL
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
                                text: `Analyze CI/CD failures from these workflow entries:\n\n${JSON.stringify(entries, null, 2)}\n\nProvide: failure patterns, root causes, remediation steps.`,
                            },
                        },
                    ],
                }
            },
        },
        {
            name: 'project-milestone-tracker',
            description: 'Milestone progress tracking',
            icons: [ICON_PROMPT],
            arguments: [
                { name: 'project_number', description: 'GitHub Project number', required: true },
            ],
            handler: (args: Record<string, string>, db: IDatabaseAdapter) => {
                const projectNumber = parseInt(args['project_number'] ?? '0', 10)
                const entries = execQuery(
                    db,
                    `
                    SELECT ${ENTRY_COLUMNS} FROM memory_journal
                    WHERE project_number = ?
                    AND significance_type IS NOT NULL
                    AND deleted_at IS NULL
                    ORDER BY timestamp DESC
                `,
                    [projectNumber]
                )

                return {
                    messages: [
                        {
                            role: 'user',
                            content: {
                                type: 'text',
                                text: `Track milestones for Project #${String(projectNumber)}:\n\nMilestone entries: ${JSON.stringify(entries, null, 2)}\n\nProvide: progress summary, upcoming milestones, timeline.`,
                            },
                        },
                    ],
                }
            },
        },
    ]
}
