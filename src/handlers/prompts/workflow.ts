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

/**
 * Get workflow prompt definitions
 */
export function getWorkflowPromptDefinitions(): InternalPromptDef[] {
    return [
        {
            name: 'session-summary',
            description: 'Create a formatted session summary entry',
            icons: [ICON_PROMPT],
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
                return generateSummaryPrompt(
                    db,
                    teamDb,
                    'personal',
                    ws,
                    briefingConfig,
                    scope.projectNumber,
                    scope.explicitDefaultRequested
                )
            },
        },
        {
            name: 'team-session-summary',
            description: 'Create a formatted team session summary entry',
            icons: [ICON_PROMPT],
            capabilities: { requiresTeamScope: true },
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
                return generateSummaryPrompt(
                    db,
                    teamDb,
                    'team',
                    ws,
                    briefingConfig,
                    scope.projectNumber,
                    scope.explicitDefaultRequested,
                    runtime
                )
            },
        },
        {
            name: 'create-entry',
            description: 'Create a structured mid-thread journal entry',
            icons: [ICON_PROMPT],
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
                return generateEntryPrompt(
                    db,
                    teamDb,
                    'personal',
                    ws,
                    briefingConfig,
                    scope.projectNumber,
                    scope.explicitDefaultRequested
                )
            },
        },
        {
            name: 'create-team-entry',
            description: 'Create a structured mid-thread team journal entry',
            icons: [ICON_PROMPT],
            capabilities: { requiresTeamScope: true },
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
                return generateEntryPrompt(
                    db,
                    teamDb,
                    'team',
                    ws,
                    briefingConfig,
                    scope.projectNumber,
                    scope.explicitDefaultRequested,
                    runtime
                )
            },
        },
        {
            name: 'update-entry',
            description: 'Safely update an existing mid-thread entry or session summary',
            icons: [ICON_PROMPT],
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
                return generateUpdateEntryPrompt(
                    db,
                    teamDb,
                    'personal',
                    ws,
                    briefingConfig,
                    scope.projectNumber,
                    scope.explicitDefaultRequested
                )
            },
        },
        {
            name: 'update-team-entry',
            description: 'Safely update an existing team entry or team session summary',
            icons: [ICON_PROMPT],
            capabilities: { requiresTeamScope: true },
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
                return generateUpdateEntryPrompt(
                    db,
                    teamDb,
                    'team',
                    ws,
                    briefingConfig,
                    scope.projectNumber,
                    scope.explicitDefaultRequested,
                    runtime
                )
            },
        },
        ...getWorkflowMaintenancePromptDefinitions(),
    ]
}
