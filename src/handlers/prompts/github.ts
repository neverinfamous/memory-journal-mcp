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
            name: 'issue-commander',
            description: 'Issue triage, milestone sprinting, and roadmap kickoff with HITL checkpoints. Optional arguments: project_number, workflow_type',
            icons: [ICON_PROMPT],
            arguments: [],
            handler: (args: Record<string, string> | undefined, _db: IDatabaseAdapter) => {
                const projectNumber = args?.['project_number']
                const type = args?.['workflow_type'] ?? 'triage'
                const projectStr = projectNumber ? String(parseInt(projectNumber, 10)) : '{project_number}'

                return {
                    messages: [
                        {
                            role: 'user',
                            content: {
                                type: 'text',
                                text: `# GitHub Issue Commander
Execute a ${type} workflow for Project #${projectStr}.
If the project number is '{project_number}', determine it from the user's request. If the user hasn't specified a project number, ask them for it now.
To complete this task, you MUST first read the following resource to obtain the project's context:
\`memory://projects/${projectStr}/timeline\`

## Core Rules & Validation Gates
1. **Validation Pipeline**: Before completing, you MUST pass these gates sequentially:
   Gate 1: Lint + Typecheck → Gate 2: Build → Gate 3: Tests → Gate 4: E2E → Gate 5: Security (npm-audit, codeql, trivy, docker-scout, gitleaks)
2. **Auto-fix**: Attempt to auto-fix errors (lint/types) up to 2 times.
3. **Journaling**: Create a journal entry for EVERY significant action using tags: \`["commander", "triage", "gate_pass" | "gate_fail", "security"]\`.
4. **HITL Checkpoints**: Pause and request human approval:
   - Before \`git push\`
   - On critical security findings
   - Unfixable test failures (after 2 attempts)
   - Large changesets (>10 files touched)

If doing a triage: Provide overview, recent activity, blockers, next steps.
If doing a milestone: Provide progress summary, upcoming milestones, timeline.`,
                            },
                        },
                    ],
                }
            },
        },
        {
            name: 'pr-commander',
            description: 'Pull request summary, review prep, and dependency updates with validation gates. Optional arguments: pr_number, workflow_type',
            icons: [ICON_PROMPT],
            arguments: [],
            handler: (
                args: Record<string, string> | undefined,
                _db: IDatabaseAdapter,
                _teamDb?: IDatabaseAdapter
            ) => {
                const prNumber = args?.['pr_number']
                const type = args?.['workflow_type'] ?? 'summary'
                const prStr = prNumber ? String(parseInt(prNumber, 10)) : '{pr_number}'

                return {
                    messages: [
                        {
                            role: 'user',
                            content: {
                                type: 'text',
                                text: `# GitHub PR Commander
Execute a ${type} workflow for PR #${prStr}.
If the PR number is '{pr_number}', determine it from the user's request. If the user hasn't specified a PR number, ask them for it now.
To complete this task, you MUST first read the following resources to obtain the PR's context:
- \`memory://prs/${prStr}/entries\`
- \`memory://prs/${prStr}/timeline\`

## Core Rules & Validation Gates
1. **Validation Pipeline**: Before approving/merging, you MUST pass these gates sequentially:
   Gate 1: Lint + Typecheck → Gate 2: Build → Gate 3: Tests → Gate 4: E2E → Gate 5: Security
2. **Auto-fix**: Attempt to auto-fix errors up to 2 times.
3. **Journaling**: Create a journal entry for EVERY significant action using tags: \`["commander", "review", "gate_pass" | "gate_fail"]\`.
4. **HITL Checkpoints**: Pause and request human approval:
   - Before \`git push\` or merging
   - On critical security findings
   - Unfixable test failures (after 2 attempts)
   - Large changesets (>10 files touched)

If doing a summary: Provide summary of changes, decisions made, testing done.
If doing a review: Provide review checklist, areas of concern, testing recommendations.
If doing deps/changelog: Audit updates and backfill SHA provenance.`,
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
            handler: (_args: Record<string, string> | undefined, db: IDatabaseAdapter) => {
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
        {
            name: 'project-status-summary',
            description: 'Generate a comprehensive status summary for a GitHub project',
            icons: [ICON_PROMPT],
            arguments: [{ name: 'project_number', description: 'GitHub Project Number', required: true }],
            handler: (args: Record<string, string> | undefined, _db: IDatabaseAdapter) => {
                const projectNumber = args?.['project_number'] ?? '{project_number}'
                return {
                    messages: [
                        {
                            role: 'user',
                            content: {
                                type: 'text',
                                text: `# GitHub Project Status Summary
Generate a comprehensive status summary for Project #${projectNumber}.
To complete this task, you MUST first read the following resource to obtain the project's context:
\`memory://projects/${projectNumber}/timeline\`

Please provide:
1. Overall Progress
2. Blockers and Risks
3. Recent Achievements
4. Next Steps`
                            }
                        }
                    ]
                }
            }
        },
        {
            name: 'project-milestone-tracker',
            description: 'Track progress against a specific project milestone',
            icons: [ICON_PROMPT],
            arguments: [{ name: 'project_number', description: 'GitHub Project Number', required: true }],
            handler: (args: Record<string, string> | undefined, _db: IDatabaseAdapter) => {
                const projectNumber = args?.['project_number'] ?? '{project_number}'
                return {
                    messages: [
                        {
                            role: 'user',
                            content: {
                                type: 'text',
                                text: `# GitHub Project Milestone Tracker
Analyze milestone progress for Project #${projectNumber}.
To complete this task, you MUST first read the following resource to obtain the project's context:
\`memory://projects/${projectNumber}/timeline\`

Please provide:
1. Current Milestone Status
2. Velocity Analysis
3. Scope Creep/Changes
4. Confidence in Delivery Date`
                            }
                        }
                    ]
                }
            }
        },
        {
            name: 'pr-summary',
            description: 'Generate an executive summary of a pull request',
            icons: [ICON_PROMPT],
            arguments: [{ name: 'pr_number', description: 'Pull Request Number', required: true }],
            handler: (args: Record<string, string> | undefined, _db: IDatabaseAdapter) => {
                const prNumber = args?.['pr_number'] ?? '{pr_number}'
                return {
                    messages: [
                        {
                            role: 'user',
                            content: {
                                type: 'text',
                                text: `# Pull Request Summary
Generate a summary for PR #${prNumber}.
To complete this task, you MUST first read the following resources to obtain the PR's context:
- \`memory://prs/${prNumber}/entries\`
- \`memory://prs/${prNumber}/timeline\`

Please provide:
1. Summary of Changes
2. Key Decisions Made
3. Testing Performed
4. Remaining Work`
                            }
                        }
                    ]
                }
            }
        },
        {
            name: 'code-review-prep',
            description: 'Prepare a code review checklist and focus areas for a PR',
            icons: [ICON_PROMPT],
            arguments: [{ name: 'pr_number', description: 'Pull Request Number', required: true }],
            handler: (args: Record<string, string> | undefined, _db: IDatabaseAdapter) => {
                const prNumber = args?.['pr_number'] ?? '{pr_number}'
                return {
                    messages: [
                        {
                            role: 'user',
                            content: {
                                type: 'text',
                                text: `# Code Review Preparation
Prepare a code review plan for PR #${prNumber}.
To complete this task, you MUST first read the following resources to obtain the PR's context:
- \`memory://prs/${prNumber}/entries\`
- \`memory://prs/${prNumber}/timeline\`

Please provide:
1. Review Checklist
2. High-Risk Areas
3. Testing Recommendations
4. Architecture Verification`
                            }
                        }
                    ]
                }
            }
        },
        {
            name: 'pr-retrospective',
            description: 'Conduct a retrospective analysis on a completed pull request',
            icons: [ICON_PROMPT],
            arguments: [{ name: 'pr_number', description: 'Pull Request Number', required: true }],
            handler: (args: Record<string, string> | undefined, _db: IDatabaseAdapter) => {
                const prNumber = args?.['pr_number'] ?? '{pr_number}'
                return {
                    messages: [
                        {
                            role: 'user',
                            content: {
                                type: 'text',
                                text: `# Pull Request Retrospective
Conduct a retrospective analysis for PR #${prNumber}.
To complete this task, you MUST first read the following resources to obtain the PR's context:
- \`memory://prs/${prNumber}/entries\`
- \`memory://prs/${prNumber}/timeline\`

Please provide:
1. What went well
2. Friction points (CI, reviews, scope)
3. Technical Debt incurred
4. Learnings for future PRs`
                            }
                        }
                    ]
                }
            }
        }
    ]
}
