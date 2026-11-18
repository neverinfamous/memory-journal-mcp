/**
 * Memory Journal MCP Server - Adversarial Prompt Argument Schemas & Scope Validation
 */

import * as path from 'node:path'
import { z } from 'zod'
import { ValidationError } from '../../types/errors.js'
import {
    cwdMatchesRegistryPath,
    loadProjectRegistryFromConfig,
} from '../../utils/workspace-resolver.js'
import {
    activeProjectRegistry,
    exactRegistryKey,
    pairStoredScope,
    uniqueWorkspaceForProject,
} from '../../utils/write-scope.js'
import type { BriefingConfig } from '../resources/shared.js'
import { parseCanonicalPositiveInt } from '../../utils/safe-positive-int.js'

export function resolveRegistryMatchForTarget(
    registry: NonNullable<BriefingConfig['projectRegistry']>,
    cleanTarget: string
): string | undefined {
    if (/^#?\d{1,10}$/.test(cleanTarget)) {
        const num = parseCanonicalPositiveInt(cleanTarget)
        const matchByNum = num !== undefined ? uniqueWorkspaceForProject(num, registry) : undefined
        if (matchByNum !== undefined) return matchByNum
    }
    const exactMatch = exactRegistryKey(cleanTarget, registry)
    if (exactMatch !== undefined) return exactMatch
    const isWinAbs = /^[a-zA-Z]:[\\/]/.test(cleanTarget)
    const isAbsTarget = path.isAbsolute(cleanTarget) || isWinAbs
    const normalizedRel = cleanTarget.replace(/\\/g, '/')
    if (!isAbsTarget && !normalizedRel.startsWith('/') && normalizedRel.includes('/')) {
        const firstSeg = normalizedRel.split('/')[0]
        if (firstSeg !== undefined && firstSeg !== '') {
            const prefixMatch = exactRegistryKey(firstSeg, registry)
            if (prefixMatch !== undefined) return prefixMatch
        }
    }
    // [BOUNDARY] Only absolute targets are path-matched; a relative target would otherwise
    // resolve against the server's process.cwd(), not the caller's project.
    if (isAbsTarget) {
        const sortedEntries = Object.entries(registry).sort(
            ([, a], [, b]) => (b.path?.length ?? 0) - (a.path?.length ?? 0)
        )
        for (const [key, data] of sortedEntries) {
            if (
                data.path !== undefined &&
                data.path.trim() !== '' &&
                cwdMatchesRegistryPath(data.path, cleanTarget)
            ) {
                return key
            }
        }
    }
    return undefined
}

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
    const parsed = parseCanonicalPositiveInt(trimmed)
    return parsed ?? val
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

function parseOptionalNumericWorkspace(
    effectiveWs: string,
    registry: NonNullable<BriefingConfig['projectRegistry']>
): number | undefined {
    const trimmed = effectiveWs.trim()
    if (!/^#?(?:0|[1-9]\d*)$/.test(trimmed)) return undefined
    const parsed = parseCanonicalPositiveInt(trimmed)
    if (parsed !== undefined) return parsed
    // Reject non-canonical numeric tokens like #0 or #005 when registry has entries
    if (Object.keys(registry).length > 0) {
        throw new ValidationError(`Invalid numeric workspace_id '${effectiveWs}'.`)
    }
    return undefined
}

function assertTargetWorkspaceCompatibility(
    targetMatch: string,
    cleanTarget: string,
    effectiveWs: string | undefined,
    projectNumber: number | undefined,
    registry: NonNullable<BriefingConfig['projectRegistry']>
): void {
    if (effectiveWs !== undefined) {
        const numericWs = parseOptionalNumericWorkspace(effectiveWs, registry)
        const conflicts =
            numericWs !== undefined
                ? uniqueWorkspaceForProject(numericWs, registry)?.toLowerCase() !==
                  targetMatch.toLowerCase()
                : effectiveWs.toLowerCase() === 'default' ||
                  (exactRegistryKey(effectiveWs, registry) ?? effectiveWs).toLowerCase() !==
                      targetMatch.toLowerCase()
        if (conflicts) {
            throw new ValidationError(
                `workspace_id '${effectiveWs}' conflicts with target '${cleanTarget}' (registered workspace '${targetMatch}').`
            )
        }
    }
    if (projectNumber !== undefined) {
        pairStoredScope(targetMatch, projectNumber, activeProjectRegistry(registry))
    }
}

/**
 * Pair-validate `(workspace_id, project_number)` for adversarial prompts without rejecting
 * unmatched `workspace_id` values when `project_number` is omitted (preserving C13 fallback tests).
 */
export function validateAdversarialPromptScope(
    workspaceId?: string,
    projectNumber?: number,
    briefingConfig?: Partial<BriefingConfig>,
    targetOrTopic?: string
): { effectiveWorkspaceId?: string; projectNumber?: number } {
    const trimmedWs = workspaceId?.trim()
    if (trimmedWs === '*') {
        throw new ValidationError("Wildcard workspace_id '*' is not valid for a single-target prompt.")
    }

    const registry = briefingConfig?.projectRegistry ?? loadProjectRegistryFromConfig()
    const cleanTarget = targetOrTopic?.trim()
    const isPlaceholder = cleanTarget === '{target}' || cleanTarget === '{topic}'
    const targetMatch =
        cleanTarget !== undefined &&
        cleanTarget !== '' &&
        !isPlaceholder &&
        registry !== undefined
            ? resolveRegistryMatchForTarget(registry, cleanTarget)
            : undefined

    const effectiveWs = trimmedWs !== undefined && trimmedWs !== '' ? trimmedWs : undefined
    if (targetMatch !== undefined && registry !== undefined && cleanTarget !== undefined) {
        assertTargetWorkspaceCompatibility(
            targetMatch,
            cleanTarget,
            effectiveWs,
            projectNumber,
            registry
        )
    }

    if (projectNumber === undefined) {
        return effectiveWs !== undefined ? { effectiveWorkspaceId: effectiveWs } : {}
    }

    if (registry === undefined || Object.keys(registry).length === 0) {
        return {
            ...(effectiveWs !== undefined ? { effectiveWorkspaceId: effectiveWs } : {}),
            projectNumber,
        }
    }

    const numericWs =
        effectiveWs !== undefined ? parseOptionalNumericWorkspace(effectiveWs, registry) : undefined
    if (effectiveWs === undefined || numericWs !== undefined) {
        if (numericWs !== undefined && numericWs !== projectNumber) {
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
