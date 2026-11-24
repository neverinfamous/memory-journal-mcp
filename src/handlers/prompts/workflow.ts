/**
 * Memory Journal MCP Server - Workflow Prompt Definitions
 *
 * Prompts: find-related, prepare-standup, prepare-retro, weekly-digest,
 * analyze-period, goal-tracker, get-context-bundle, get-recent-entries, confirm-briefing,
 * session-summary, team-session-summary, create-entry, create-team-entry,
 * update-entry, update-team-entry
 */

import type { IDatabaseAdapter } from '../../database/core/interfaces.js'
import { ICON_PROMPT } from '../../constants/icons.js'
import type { InternalPromptDef } from './index.js'
import type { BriefingConfig } from '../resources/shared.js'
import { ValidationError } from '../../types/errors.js'
import { parseCanonicalPositiveInt } from '../../utils/safe-positive-int.js'
import {
    findCanonicalRegistryKey,
    loadProjectRegistryFromConfig,
} from '../../utils/workspace-resolver.js'
import { resolvePromptPriorWorkspace } from './adversarial-helpers.js'
import {
    WORKFLOW_WORKSPACE_ARGUMENTS,
    generateSummaryPrompt,
    generateEntryPrompt,
    generateUpdateEntryPrompt,
} from './workflow-helpers.js'
import { getWorkflowMaintenancePromptDefinitions } from './workflow-maintenance-prompts.js'

function resolveWorkflowPromptScope(
    args: Record<string, string> | undefined,
    briefingConfig?: Partial<BriefingConfig>
): {
    workspaceHint?: string
    projectNumber?: number
    explicitDefaultRequested: boolean
} {
    const rawWorkspace = args?.['workspace_id']?.trim()
    const rawProject = args?.['project_number']?.trim()
    if (rawWorkspace === '*') {
        throw new ValidationError(
            "workspace_id '*' is a read-only wildcard and cannot be used to target a workflow write prompt."
        )
    }

    let numericProject: number | undefined
    if (rawProject !== undefined && rawProject.length > 0) {
        const projMatch = /^#?(\d+)$/.exec(rawProject)
        const parsedNum = projMatch?.[1] !== undefined ? parseCanonicalPositiveInt(projMatch[1]) : undefined
        if (parsedNum === undefined || !Number.isSafeInteger(parsedNum) || parsedNum <= 0) {
            throw new ValidationError(
                `Invalid project_number "${rawProject}": must be a positive integer.`
            )
        }
        numericProject = parsedNum

        const registry = briefingConfig?.projectRegistry ?? loadProjectRegistryFromConfig()
        if (registry !== undefined && Object.keys(registry).length > 0) {
            const projectOwners = Object.entries(registry)
                .filter(([, entry]) => entry.project_number === numericProject)
                .map(([key]) => key)
            if (projectOwners.length === 0) {
                throw new ValidationError(
                    `project_number ${String(numericProject)} is not registered in projectRegistry.`
                )
            }
            if (rawWorkspace !== undefined && rawWorkspace.length > 0) {
                const wsKey = findCanonicalRegistryKey(rawWorkspace, registry) ?? rawWorkspace
                if (!projectOwners.some((owner) => owner.toLowerCase() === wsKey.toLowerCase())) {
                    throw new ValidationError(
                        `project_number ${String(numericProject)} belongs to "${projectOwners[0] ?? ''}", not "${rawWorkspace}".`
                    )
                }
            }
        }
    }

    const hasWorkspace = rawWorkspace !== undefined && rawWorkspace.length > 0
    const scope: {
        workspaceHint?: string
        projectNumber?: number
        explicitDefaultRequested: boolean
    } = {
        explicitDefaultRequested: rawWorkspace?.toLowerCase() === 'default',
    }
    if (hasWorkspace) {
        scope.workspaceHint = rawWorkspace
    } else if (numericProject !== undefined) {
        // [INVARIANT] A numeric project resolves through the registry only; an unmatched number
        // resolves to `default` (without explicitDefaultRequested) instead of cwd/session (C13).
        scope.workspaceHint = `#${String(numericProject)}`
    }
    if (numericProject !== undefined) {
        scope.projectNumber = numericProject
    }
    return scope
}

function buildScopedWorkflowPromptDef(
    name: string,
    description: string,
    target: 'personal' | 'team',
    generator: typeof generateSummaryPrompt
): InternalPromptDef {
    return {
        name,
        description,
        icons: [ICON_PROMPT],
        ...(target === 'team' ? { capabilities: { requiresTeamScope: true } } : {}),
        arguments: WORKFLOW_WORKSPACE_ARGUMENTS,
        handler: (
            args: Record<string, string> | undefined,
            db: IDatabaseAdapter,
            teamDb?: IDatabaseAdapter,
            _github?: unknown,
            briefingConfig?: Partial<BriefingConfig>,
            runtime?: object | null
        ) => {
            const scope = resolveWorkflowPromptScope(args, briefingConfig)
            const ws = resolvePromptPriorWorkspace(
                briefingConfig,
                scope.workspaceHint,
                undefined,
                runtime
            )
            return generator(
                db,
                teamDb,
                target,
                ws,
                briefingConfig,
                scope.projectNumber,
                scope.explicitDefaultRequested,
                target === 'team' ? runtime : undefined
            )
        },
    }
}

/**
 * Get workflow prompt definitions
 */
export function getWorkflowPromptDefinitions(): InternalPromptDef[] {
    return [
        buildScopedWorkflowPromptDef(
            'session-summary',
            'Create a formatted session summary entry',
            'personal',
            generateSummaryPrompt
        ),
        buildScopedWorkflowPromptDef(
            'team-session-summary',
            'Create a formatted team session summary entry',
            'team',
            generateSummaryPrompt
        ),
        buildScopedWorkflowPromptDef(
            'create-entry',
            'Create a structured mid-thread journal entry',
            'personal',
            generateEntryPrompt
        ),
        buildScopedWorkflowPromptDef(
            'create-team-entry',
            'Create a structured mid-thread team journal entry',
            'team',
            generateEntryPrompt
        ),
        buildScopedWorkflowPromptDef(
            'update-entry',
            'Safely update an existing mid-thread entry or session summary',
            'personal',
            generateUpdateEntryPrompt
        ),
        buildScopedWorkflowPromptDef(
            'update-team-entry',
            'Safely update an existing team entry or team session summary',
            'team',
            generateUpdateEntryPrompt
        ),
        ...getWorkflowMaintenancePromptDefinitions(),
    ]
}
