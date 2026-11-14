/**
 * Memory Journal MCP Server - Adversarial Prompt Argument Schemas & Scope Validation
 */

import { z } from 'zod'
import { ValidationError } from '../../types/errors.js'
import { loadProjectRegistryFromConfig } from '../../utils/workspace-resolver.js'
import {
    activeProjectRegistry,
    exactRegistryKey,
    pairStoredScope,
    uniqueWorkspaceForProject,
} from '../../utils/write-scope.js'
import type { BriefingConfig } from '../resources/shared.js'

function emptyToUndefined(val: unknown): unknown {
    return typeof val === 'string' && val.trim() === '' ? undefined : val
}

function preprocessDepth(val: unknown): unknown {
    if (typeof val !== 'string') return val
    const trimmed = val.trim().toLowerCase()
    return trimmed === '' ? undefined : trimmed
}

function preprocessCopilot(val: unknown): unknown {
    if (typeof val === 'boolean') return val ? 'true' : 'false'
    if (typeof val !== 'string') return val
    const trimmed = val.trim().toLowerCase()
    if (trimmed === '') return undefined
    if (trimmed === 'true' || trimmed === '1' || trimmed === 'yes') return 'true'
    if (trimmed === 'false' || trimmed === '0' || trimmed === 'no') return 'false'
    return val
}

function preprocessProjectNumber(val: unknown): unknown {
    if (val === undefined) return undefined
    if (typeof val === 'number') return val
    if (typeof val !== 'string') return val
    const trimmed = val.trim()
    if (trimmed === '') return undefined
    const match = /^#?(\d+)$/.exec(trimmed)
    if (match?.[1] !== undefined) {
        return Number(match[1])
    }
    return val
}

export const planReviewArgsSchema = z.object({
    topic: z.preprocess(emptyToUndefined, z.string().optional()),
    depth: z.preprocess(preprocessDepth, z.enum(['light', 'standard', 'deep']).optional()),
    copilot: z.preprocess(preprocessCopilot, z.enum(['true', 'false']).optional()),
    workspace_id: z.preprocess(emptyToUndefined, z.string().optional()),
    project_number: z.preprocess(preprocessProjectNumber, z.number().int().positive().optional()),
})

export const auditArgsSchema = z.object({
    target: z.preprocess(emptyToUndefined, z.string().optional()),
    copilot: z.preprocess(preprocessCopilot, z.enum(['true', 'false']).optional()),
    workspace_id: z.preprocess(emptyToUndefined, z.string().optional()),
    project_number: z.preprocess(preprocessProjectNumber, z.number().int().positive().optional()),
})

export const PLAN_REVIEW_ARGUMENTS = [
    { name: 'topic', description: 'Topic or feature to review', required: false },
    {
        name: 'depth',
        description: "Review depth profile ('light' | 'standard' | 'deep', default: 'standard')",
        required: false,
    },
    {
        name: 'copilot',
        description:
            "Opt-in to external GitHub Copilot CLI validation ('true' | 'false', default: 'false')",
        required: false,
    },
    {
        name: 'workspace_id',
        description:
            "Journal workspace of the planned project, used to load only that project's prior plans (default: resolved from topic/cwd/server config)",
        required: false,
    },
    {
        name: 'project_number',
        description:
            'GitHub/registry project number of the planned project, pair-validated with workspace_id',
        required: false,
    },
]

export const AUDIT_ARGUMENTS = [
    {
        name: 'target',
        description: 'Target file, directory, skill, or workflow to audit',
        required: false,
    },
    {
        name: 'copilot',
        description:
            "Opt-in to external GitHub Copilot CLI validation ('true' | 'false', default: 'false')",
        required: false,
    },
    {
        name: 'workspace_id',
        description:
            "Journal workspace of the audited project, used to load only that project's prior audits (default: resolved from target/cwd/project registry)",
        required: false,
    },
    {
        name: 'project_number',
        description:
            'GitHub/registry project number of the audited project, pair-validated with workspace_id',
        required: false,
    },
]

/**
 * Pair-validate `(workspace_id, project_number)` for adversarial prompts without rejecting
 * unmatched `workspace_id` values when `project_number` is omitted (preserving C13 fallback tests).
 */
export function validateAdversarialPromptScope(
    workspaceId?: string,
    projectNumber?: number,
    briefingConfig?: Partial<BriefingConfig>
): { effectiveWorkspaceId?: string; projectNumber?: number } {
    const trimmedWs = workspaceId?.trim()
    if (trimmedWs === '*') {
        throw new ValidationError("Wildcard workspace_id '*' is not valid for a single-target prompt.")
    }

    const effectiveWs = trimmedWs !== undefined && trimmedWs !== '' ? trimmedWs : undefined
    if (projectNumber === undefined) {
        return effectiveWs !== undefined ? { effectiveWorkspaceId: effectiveWs } : {}
    }

    const registry = briefingConfig?.projectRegistry ?? loadProjectRegistryFromConfig()
    if (registry === undefined || Object.keys(registry).length === 0) {
        return {
            ...(effectiveWs !== undefined ? { effectiveWorkspaceId: effectiveWs } : {}),
            projectNumber,
        }
    }

    if (effectiveWs === undefined || /^#?\d{1,10}$/.test(effectiveWs)) {
        if (effectiveWs !== undefined && Number(effectiveWs.replace(/^#/, '')) !== projectNumber) {
            throw new ValidationError(
                `Conflicting numeric workspace_id '${effectiveWs}' and project_number ${String(projectNumber)}.`
            )
        }
        const matched = uniqueWorkspaceForProject(projectNumber, registry)
        if (matched === undefined) {
            throw new ValidationError(
                `project_number ${String(projectNumber)} is not registered in projectRegistry.`
            )
        }
        return { effectiveWorkspaceId: matched, projectNumber }
    }

    const canonical = exactRegistryKey(effectiveWs, registry) ?? effectiveWs
    pairStoredScope(canonical, projectNumber, activeProjectRegistry(registry))
    return { effectiveWorkspaceId: canonical, projectNumber }
}
