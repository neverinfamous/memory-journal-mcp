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
    getGitHubCommanderPromptDefinitions,
    requirePositiveIntOrPlaceholder,
    resolveFallbackProjectNumber,
} from './github-commander.js'

export { requirePositiveIntOrPlaceholder }

function buildProjectPromptDef(spec: {
    name: string
    description: string
    heading: string
    lead: string
    items: string
}): InternalPromptDef {
    return {
        name: spec.name,
        description: spec.description,
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
                            text: `# ${spec.heading}
${spec.lead} #${projectNumber}.
To complete this task, you MUST first read the following resource to obtain the project's context:
\`memory://projects/${projectNumber}/timeline\`

Please provide:
${spec.items}`,
                        },
                    },
                ],
            }
        },
    }
}

function buildPrPromptDef(spec: {
    name: string
    description: string
    heading: string
    lead: string
    items: string
}): InternalPromptDef {
    return {
        name: spec.name,
        description: spec.description,
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
                            text: `# ${spec.heading}
${spec.lead} #${prNumber}.
To complete this task, you MUST first read the following resource to obtain the PR's context (includes linked entries and PR metadata):
- \`memory://prs/${prNumber}/timeline\`

Please provide:
${spec.items}`,
                        },
                    },
                ],
            }
        },
    }
}

/**
 * Get GitHub prompt definitions
 */
export function getGitHubPromptDefinitions(): InternalPromptDef[] {
    return [
        ...getGitHubCommanderPromptDefinitions(),
        buildProjectPromptDef({
            name: 'project-status-summary',
            description: 'Generate a comprehensive status summary for a GitHub project',
            heading: 'GitHub Project Status Summary',
            lead: 'Generate a comprehensive status summary for Project',
            items: `1. Overall Progress\n2. Blockers and Risks\n3. Recent Achievements\n4. Next Steps`,
        }),
        buildProjectPromptDef({
            name: 'project-milestone-tracker',
            description: 'Track progress against a specific project milestone',
            heading: 'GitHub Project Milestone Tracker',
            lead: 'Analyze milestone progress for Project',
            items: `1. Current Milestone Status\n2. Velocity Analysis\n3. Scope Creep/Changes\n4. Confidence in Delivery Date`,
        }),
        buildPrPromptDef({
            name: 'pr-summary',
            description: 'Generate an executive summary of a pull request',
            heading: 'Pull Request Summary',
            lead: 'Generate a summary for PR',
            items: `1. Summary of Changes\n2. Key Decisions Made\n3. Testing Performed\n4. Remaining Work`,
        }),
        buildPrPromptDef({
            name: 'code-review-prep',
            description: 'Prepare a code review checklist and focus areas for a PR',
            heading: 'Code Review Preparation',
            lead: 'Prepare a code review plan for PR',
            items: `1. Review Checklist\n2. High-Risk Areas\n3. Testing Recommendations\n4. Architecture Verification`,
        }),
        buildPrPromptDef({
            name: 'pr-retrospective',
            description: 'Conduct a retrospective analysis on a completed pull request',
            heading: 'Pull Request Retrospective',
            lead: 'Conduct a retrospective analysis for PR',
            items: `1. What went well\n2. Friction points (CI, reviews, scope)\n3. Technical Debt incurred\n4. Learnings for future PRs`,
        }),
    ]
}
