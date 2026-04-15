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

function formatPromptEntries(
    entries: JournalEntry[],
    maxCount = 50
): { id: number; type: string; timestamp: string; content: string }[] {
    return entries.slice(0, maxCount).map((e: JournalEntry): { id: number; type: string; timestamp: string; content: string } => ({
        id: e.id,
        type: e.entryType,
        timestamp: e.timestamp,
        content: e.content.length > 250 ? e.content.slice(0, 250) + '...' : e.content,
    }))
}

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
                const entries = db.searchEntries('', { projectNumber, limit: 20 })

                return {
                    messages: [
                        {
                            role: 'user',
                            content: {
                                type: 'text',
                                text: `Generate a status summary for Project #${String(projectNumber)}:\n\nEntries: ${JSON.stringify(formatPromptEntries(entries), null, 2)}\n\nProvide: overview, recent activity, blockers, next steps.`,
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
                const entries = db.searchEntries('', { prNumber, limit: 100 }).reverse()

                return {
                    messages: [
                        {
                            role: 'user',
                            content: {
                                type: 'text',
                                text: `Summarize PR #${String(prNumber)} activity:\n\nJournal entries: ${JSON.stringify(formatPromptEntries(entries), null, 2)}\n\nProvide: summary of changes, decisions made, testing done.`,
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
                const entries = db.searchEntries('', { prNumber, limit: 100 }).reverse()

                return {
                    messages: [
                        {
                            role: 'user',
                            content: {
                                type: 'text',
                                text: `Prepare for code review of PR #${String(prNumber)}:\n\nContext entries: ${JSON.stringify(formatPromptEntries(entries), null, 2)}\n\nProvide: review checklist, areas of concern, testing recommendations.`,
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
                const entries = db.searchEntries('', { prNumber, limit: 100 }).reverse()

                return {
                    messages: [
                        {
                            role: 'user',
                            content: {
                                type: 'text',
                                text: `Retrospective for PR #${String(prNumber)}:\n\nJournal entries: ${JSON.stringify(formatPromptEntries(entries), null, 2)}\n\nProvide: what went well, challenges, lessons learned.`,
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
                                text: `Analyze CI/CD failures from these workflow entries:\n\n${JSON.stringify(formatPromptEntries(entries), null, 2)}\n\nProvide: failure patterns, root causes, remediation steps.`,
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
                const entries = db.getSignificantEntries(100, projectNumber)

                return {
                    messages: [
                        {
                            role: 'user',
                            content: {
                                type: 'text',
                                text: `Track milestones for Project #${String(projectNumber)}:\n\nMilestone entries: ${JSON.stringify(formatPromptEntries(entries), null, 2)}\n\nProvide: progress summary, upcoming milestones, timeline.`,
                            },
                        },
                    ],
                }
            },
        },
    ]
}
