/**
 * Memory Journal MCP Server - GitHub Prompt Definitions
 *
 * Prompts: project-status-summary, pr-summary, code-review-prep,
 * pr-retrospective, actions-failure-digest, project-milestone-tracker
 */

import type { IDatabaseAdapter } from '../../database/core/interfaces.js'
import { ICON_PROMPT } from '../../constants/icons.js'
import type { InternalPromptDef } from './index.js'
import type { BriefingConfig } from '../resources/shared.js'
import {
    formatPositiveIntOrPlaceholder,
    getGitHubCommanderPromptDefinitions,
    requirePositiveIntOrPlaceholder,
    resolveFallbackProjectNumber,
} from './github-commander.js'

export { formatPositiveIntOrPlaceholder, requirePositiveIntOrPlaceholder }

/**
 * Get GitHub prompt definitions
 */
export function getGitHubPromptDefinitions(): InternalPromptDef[] {
    return [
        ...getGitHubCommanderPromptDefinitions(),
        {
            name: 'project-status-summary',
            description: 'Generate a comprehensive status summary for a GitHub project',
            icons: [ICON_PROMPT],
            arguments: [
                {
                    name: 'project_number',
                    description:
                        'GitHub Project Number (optional; falls back to configured default project)',
                    required: false,
                },
            ],
            handler: (
                args: Record<string, string> | undefined,
                _db: IDatabaseAdapter,
                _teamDb?: IDatabaseAdapter,
                _github?: unknown,
                briefingConfig?: BriefingConfig
            ) => {
                const fallbackProject = resolveFallbackProjectNumber(briefingConfig)
                const projectNumber = requirePositiveIntOrPlaceholder(
                    args?.['project_number'],
                    fallbackProject,
                    'project_number'
                )
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
            arguments: [
                {
                    name: 'project_number',
                    description:
                        'GitHub Project Number (optional; falls back to configured default project)',
                    required: false,
                },
            ],
            handler: (
                args: Record<string, string> | undefined,
                _db: IDatabaseAdapter,
                _teamDb?: IDatabaseAdapter,
                _github?: unknown,
                briefingConfig?: BriefingConfig
            ) => {
                const fallbackProject = resolveFallbackProjectNumber(briefingConfig)
                const projectNumber = requirePositiveIntOrPlaceholder(
                    args?.['project_number'],
                    fallbackProject,
                    'project_number'
                )
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
                const prNumber = requirePositiveIntOrPlaceholder(
                    args?.['pr_number'],
                    '{pr_number}',
                    'pr_number'
                )
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
                const prNumber = requirePositiveIntOrPlaceholder(
                    args?.['pr_number'],
                    '{pr_number}',
                    'pr_number'
                )
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
                const prNumber = requirePositiveIntOrPlaceholder(
                    args?.['pr_number'],
                    '{pr_number}',
                    'pr_number'
                )
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
