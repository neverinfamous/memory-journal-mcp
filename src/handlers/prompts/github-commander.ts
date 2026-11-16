import type { IDatabaseAdapter } from '../../database/core/interfaces.js'
import { ICON_PROMPT } from '../../constants/icons.js'
import type { InternalPromptDef } from './index.js'
import type { JournalEntry } from '../../types/index.js'
import { markUntrustedContentInline } from '../../utils/security-utils.js'
import { ValidationError } from '../../types/errors.js'
import { resourceWorkspace, type BriefingConfig } from '../resources/shared.js'
import { exactRegistryKey, uniqueWorkspaceForProject } from '../../utils/write-scope.js'

const ISSUE_COMMANDER_WORKFLOWS = new Set(['triage', 'milestone'])
const PR_COMMANDER_WORKFLOWS = new Set(['summary', 'review', 'dependencies'])

export function resolveFallbackProjectNumber(briefingConfig?: BriefingConfig): string {
    const num = briefingConfig?.defaultProjectNumber
    if (num === undefined) return '{project_number}'
    const defaultWs = briefingConfig?.defaultWorkspaceId?.trim()
    if (defaultWs === 'default' || defaultWs === '*') return '{project_number}'
    const registry = briefingConfig?.projectRegistry
    if (registry !== undefined && Object.keys(registry).length > 0) {
        if (defaultWs !== undefined && defaultWs !== '') {
            const entry = registry[exactRegistryKey(defaultWs, registry) ?? defaultWs]
            if (entry?.project_number !== undefined && entry.project_number !== num) {
                return '{project_number}'
            }
        } else if (uniqueWorkspaceForProject(num, registry) === undefined) {
            return '{project_number}'
        }
    }
    return String(num)
}

function validateWorkflowType(
    raw: string | undefined,
    fallback: string,
    allowed: ReadonlySet<string>
): string {
    if (raw === undefined || raw.trim() === '') return fallback
    const trimmed = raw.trim()
    if (allowed.has(trimmed)) return trimmed
    throw new ValidationError(
        `Invalid workflow_type '${trimmed}': expected one of ${Array.from(allowed).join(', ')}`
    )
}

export function requirePositiveIntOrPlaceholder(
    raw: string | undefined,
    placeholder: string,
    fieldName: string
): string {
    if (raw === undefined || raw.trim() === '') {
        return placeholder
    }
    const trimmed = raw.trim()
    if (/^[1-9]\d*$/.test(trimmed)) {
        return trimmed
    }
    throw new ValidationError(`Invalid ${fieldName}: expected a positive integer`)
}

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

/** Build commander and CI failure digest prompts (extracted from `prompts/github.ts`, Appendix A). */
export function getGitHubCommanderPromptDefinitions(): InternalPromptDef[] {
    return [
        {
            name: 'issue-commander',
            description:
                'Issue triage, milestone sprinting, and roadmap kickoff with HITL checkpoints. Optional arguments: project_number, workflow_type',
            icons: [ICON_PROMPT],
            arguments: [
                {
                    name: 'project_number',
                    description: 'GitHub project number for the commander workflow',
                    required: false,
                },
                {
                    name: 'workflow_type',
                    description: 'Commander workflow: triage or milestone',
                    required: false,
                },
            ],
            handler: (
                args: Record<string, string> | undefined,
                _db: IDatabaseAdapter,
                _teamDb?: unknown,
                _github?: unknown,
                briefingConfig?: BriefingConfig
            ) => {
                const providedProject = args?.['project_number']?.trim()
                const fallbackProject = resolveFallbackProjectNumber(briefingConfig)
                const projectStr = requirePositiveIntOrPlaceholder(
                    providedProject,
                    fallbackProject,
                    'project_number'
                )
                const type = validateWorkflowType(
                    args?.['workflow_type'],
                    'triage',
                    ISSUE_COMMANDER_WORKFLOWS
                )

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
3. **Journaling**: Create a journal entry for EVERY significant action using tags: \`["commander", "triage", "gate_pass" | "gate_fail", "security"]\`, explicitly passing \`project_number: ${projectStr}\` and the repository's \`workspace_id\` so entries do not route to \`default\`.
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
            description:
                'Pull request summary, review prep, and dependency updates with validation gates. Optional arguments: pr_number, workflow_type',
            icons: [ICON_PROMPT],
            arguments: [
                {
                    name: 'pr_number',
                    description: 'Pull request number for the commander workflow',
                    required: false,
                },
                {
                    name: 'workflow_type',
                    description: 'Commander workflow: summary, review, or dependencies',
                    required: false,
                },
            ],
            handler: (
                args: Record<string, string> | undefined,
                _db: IDatabaseAdapter,
                _teamDb?: IDatabaseAdapter
            ) => {
                const prStr = requirePositiveIntOrPlaceholder(
                    args?.['pr_number'],
                    '{pr_number}',
                    'pr_number'
                )
                const type = validateWorkflowType(
                    args?.['workflow_type'],
                    'summary',
                    PR_COMMANDER_WORKFLOWS
                )

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
3. **Journaling**: Create a journal entry for EVERY significant action using tags: \`["commander", "review", "gate_pass" | "gate_fail"]\`, explicitly passing \`pr_number: ${prStr}\`, \`project_number\`, and the repository's \`workspace_id\` so entries do not route to \`default\`.
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
            handler: (
                _args: Record<string, string> | undefined,
                db: IDatabaseAdapter,
                _teamDb?: IDatabaseAdapter,
                _github?: unknown,
                briefingConfig?: Partial<BriefingConfig>,
                runtime?: object | null
            ) => {
                const entries = db.getWorkflowActionEntries(
                    20,
                    resourceWorkspace({
                        briefingConfig,
                        ...(runtime !== undefined ? { runtime } : {}),
                    })
                )

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
