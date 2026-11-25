import type { ToolContext } from '../../../types/index.js'
import {
    findCanonicalRegistryKey,
    loadProjectRegistryFromConfig,
    resolveProjectContext,
} from '../../../utils/workspace-resolver.js'
import { activeProjectRegistry, pairStoredScope } from '../../../utils/write-scope.js'
import { resolveProjectNumber } from './helpers.js'

function concreteCallerWorkspace(workspaceId: string | undefined): string | undefined {
    if (workspaceId === undefined) return undefined
    const trimmed = workspaceId.trim()
    if (trimmed === '' || trimmed === '*') return undefined
    return trimmed
}

type Registry = ReturnType<typeof loadProjectRegistryFromConfig>

/**
 * Detect `(repo, workspace_id, project_number)` combinations that point at different registered projects.
 */
export function detectScopeMismatch(
    registry: Registry,
    canonicalRepo: string | undefined,
    callerWorkspace: string | undefined,
    projectNumber: number | undefined
): string | undefined {
    if (registry === undefined || registry === null) return undefined
    const isExplicitDefault = callerWorkspace?.toLowerCase() === 'default'
    const wsKey =
        callerWorkspace !== undefined
            ? findCanonicalRegistryKey(callerWorkspace, registry)
            : undefined
    const repoKey =
        canonicalRepo !== undefined
            ? findCanonicalRegistryKey(canonicalRepo, registry)
            : undefined
    if (
        callerWorkspace !== undefined &&
        canonicalRepo !== undefined &&
        (!isExplicitDefault || repoKey !== undefined) &&
        (wsKey ?? callerWorkspace).toLowerCase() !== (repoKey ?? canonicalRepo).toLowerCase()
    ) {
        return `workspace_id "${callerWorkspace}" does not match repository "${canonicalRepo}".`
    }
    if (projectNumber !== undefined) {
        const owners = Object.entries(registry)
            .filter(([, entry]) => entry.project_number === projectNumber)
            .map(([key]) => key)
        if (owners.length > 1) {
            return `project_number ${String(projectNumber)} is registered to more than one workspace.`
        }
        const projectOwner = owners[0]
        if (
            projectOwner !== undefined &&
            callerWorkspace !== undefined &&
            (wsKey ?? callerWorkspace).toLowerCase() !== projectOwner.toLowerCase()
        ) {
            return `project_number ${String(projectNumber)} belongs to workspace "${projectOwner}", not "${callerWorkspace}".`
        }
        if (
            projectOwner !== undefined &&
            canonicalRepo !== undefined &&
            (repoKey ?? canonicalRepo).toLowerCase() !== projectOwner.toLowerCase()
        ) {
            return `project_number ${String(projectNumber)} belongs to workspace "${projectOwner}", not repository "${canonicalRepo}".`
        }
    }
    const ownerKey = wsKey ?? repoKey
    const registered = ownerKey !== undefined ? registry[ownerKey]?.project_number : undefined
    if (
        projectNumber !== undefined &&
        registered !== undefined &&
        registered !== null &&
        registered !== projectNumber
    ) {
        return `project_number ${String(projectNumber)} does not belong to workspace "${ownerKey ?? ''}" (registered project ${String(registered)}).`
    }
    return undefined
}

export function scopeMismatchResponse(error: string): Record<string, unknown> {
    return {
        success: false,
        error,
        code: 'VALIDATION_ERROR',
        category: 'validation',
        suggestion:
            'Provide a consistent repo, workspace_id, and project_number for a single registered project.',
        recoverable: true,
    }
}

function resolveCandidateScope(
    context: ToolContext,
    canonicalRepo: string | undefined,
    callerWorkspace: string | undefined,
    inputProjectNumber: number | undefined,
    entryProjectNumber: number | undefined,
    isExplicitDefault: boolean,
    effectiveRegistry: Registry
): { candidateWs: string; candidateProj: number | undefined } {
    if (isExplicitDefault) {
        return { candidateWs: 'default', candidateProj: inputProjectNumber }
    }
    const pairCallerWorkspace = callerWorkspace !== undefined && inputProjectNumber === undefined
    const resolvedCtx = resolveProjectContext(
        {
            workspace_id: callerWorkspace ?? canonicalRepo,
            ...(pairCallerWorkspace || entryProjectNumber === undefined
                ? {}
                : { project_number: entryProjectNumber }),
        },
        context.config
    )
    const candidateWs =
        resolvedCtx.workspaceId === 'default' && canonicalRepo && callerWorkspace === undefined
            ? canonicalRepo
            : resolvedCtx.workspaceId
    const candidateWsRegistered =
        candidateWs !== undefined &&
        findCanonicalRegistryKey(candidateWs, effectiveRegistry) !== undefined
    let candidateProj: number | undefined
    if (pairCallerWorkspace) {
        candidateProj = resolvedCtx.projectNumber
    } else if (candidateWsRegistered || inputProjectNumber !== undefined) {
        candidateProj = resolvedCtx.projectNumber ?? entryProjectNumber
    }
    return { candidateWs, candidateProj }
}

export function resolveIssueEntryScope(
    context: ToolContext,
    resolvedRepo: string | undefined,
    inputWorkspaceId: string | undefined,
    inputProjectNumber: number | undefined,
    wildcardAction: string,
    owner?: string,
    detectedOwner?: string | null
):
    | { workspaceId: string; projectNumber: number | undefined }
    | { errorResponse: Record<string, unknown> } {
    if (inputWorkspaceId?.trim() === '*') {
        return {
            errorResponse: scopeMismatchResponse(
                `workspace_id '*' is a read-only wildcard and cannot be used to ${wildcardAction}.`
            ),
        }
    }
    const callerWorkspace = concreteCallerWorkspace(inputWorkspaceId)
    const isExplicitDefault = callerWorkspace?.toLowerCase() === 'default'
    const isForeignOwner =
        owner !== undefined &&
        detectedOwner !== undefined &&
        detectedOwner !== null &&
        owner.toLowerCase() !== detectedOwner.toLowerCase()
    const entryProjectNumber = isExplicitDefault
        ? inputProjectNumber
        : resolveProjectNumber(context, resolvedRepo, inputProjectNumber, owner, detectedOwner)
    if (entryProjectNumber !== undefined && entryProjectNumber <= 0) {
        return {
            errorResponse: scopeMismatchResponse('project_number must be a positive integer.'),
        }
    }

    const registry = context.config?.projectRegistry ?? loadProjectRegistryFromConfig()
    let canonicalRepo: string | undefined
    if (isForeignOwner && callerWorkspace === undefined && owner !== undefined) {
        canonicalRepo = resolvedRepo !== undefined ? `${owner}/${resolvedRepo}` : undefined
    } else if (resolvedRepo !== undefined && resolvedRepo !== '') {
        canonicalRepo = findCanonicalRegistryKey(resolvedRepo, registry) ?? resolvedRepo
    }
    const mismatch = detectScopeMismatch(
        registry,
        canonicalRepo,
        callerWorkspace,
        inputProjectNumber
    )
    if (mismatch !== undefined) return { errorResponse: scopeMismatchResponse(mismatch) }

    const effectiveRegistry = activeProjectRegistry(context.config?.projectRegistry)
    const { candidateWs, candidateProj } = resolveCandidateScope(
        context,
        canonicalRepo,
        callerWorkspace,
        inputProjectNumber,
        entryProjectNumber,
        isExplicitDefault,
        effectiveRegistry
    )
    const paired = pairStoredScope(candidateWs, candidateProj, effectiveRegistry)
    const finalWorkspaceId = paired.workspaceId ?? candidateWs
    const finalProjectNumber = paired.projectNumber ?? undefined
    if (
        finalWorkspaceId === 'default' &&
        (finalProjectNumber === undefined || finalProjectNumber <= 0)
    ) {
        return {
            errorResponse: scopeMismatchResponse(
                "Cannot record issue journal entry in workspace 'default' without a valid project_number."
            ),
        }
    }
    return {
        workspaceId: finalWorkspaceId,
        projectNumber: finalProjectNumber,
    }
}
