import type { z } from 'zod'
import type { IDatabaseAdapter } from '../../database/core/interfaces.js'
import type { CreateEntryInput, ToolHandlerConfig } from '../../types/index.js'
import { ValidationError } from '../../types/errors.js'
import { resolveEntryAnchors } from '../../handlers/tools/core/staleness-tools.js'
import {
    activeProjectRegistry,
    concreteWorkspace,
    exactRegistryKey,
    pairStoredScope,
    workspacesForProject,
} from '../../utils/write-scope.js'
import { findCanonicalRegistryKey, resolveWorkspaceId } from '../../utils/workspace-resolver.js'
import type { updateEntryOptionsSchema } from '../schemas.js'
import { CliExitError } from './db-helper.js'
import type { EntryPayload } from './entry-payload.js'

export type UpdateEntryCliOptions = z.infer<typeof updateEntryOptionsSchema> & {
    tag?: string
    contentFile?: string
    body?: string
}

export interface ValidatedCliUpdateArgs {
    entryId: number
    version: number
    rawWorkspaceOpt: string | undefined
    trimmedTargetWs: string | undefined
}

export function validateCliUpdateArgsAndTarget(
    options: UpdateEntryCliOptions
): ValidatedCliUpdateArgs {
    const entryId = options.id
    if (entryId === undefined || !Number.isSafeInteger(entryId) || entryId < 1) {
        process.stderr.write('Error: Must provide a valid --id (positive integer)\n')
        throw new CliExitError(1)
    }

    const version = options.expectedVersion
    if (version === undefined || !Number.isSafeInteger(version) || version < 1) {
        process.stderr.write(
            'Error: Must provide a valid --expected-version (expected positive integer version) to prevent concurrent overwrites\n'
        )
        throw new CliExitError(1)
    }

    const rawWorkspaceOpt = options.workspaceId ?? options.workspace ?? options.workspace_id
    if (rawWorkspaceOpt?.trim() === '*') {
        throw new ValidationError(
            "workspace_id '*' cannot be used to update an entry. Pass a concrete workspace.",
            { workspaceId: '*' }
        )
    }
    const rawTargetWsOpt = options.targetWorkspace ?? options.target_workspace
    const trimmedTargetWs = rawTargetWsOpt?.trim()
    if (trimmedTargetWs === '*') {
        throw new ValidationError(
            "target_workspace '*' cannot be used to update an entry. Pass a concrete workspace.",
            { targetWorkspace: '*' }
        )
    }
    if (rawTargetWsOpt !== undefined && (trimmedTargetWs === undefined || trimmedTargetWs === '')) {
        throw new ValidationError('target_workspace cannot be blank.', {
            targetWorkspace: rawTargetWsOpt,
        })
    }

    return { entryId, version, rawWorkspaceOpt, trimmedTargetWs }
}

function resolveExplicitSourceWorkspace(
    rawWorkspaceOpt: string | undefined,
    payload: EntryPayload,
    trimmedTargetWs: string | undefined,
    metaSourceWs?: string
): string | undefined {
    if (rawWorkspaceOpt !== undefined && rawWorkspaceOpt.trim() !== '') {
        return rawWorkspaceOpt.trim()
    }
    if (metaSourceWs !== undefined && metaSourceWs !== '') {
        return metaSourceWs
    }
    if (payload.hasExplicitWorkspace === true && trimmedTargetWs === undefined) {
        return payload.workspaceId
    }
    return undefined
}

function sameCliWorkspaceScope(
    left: string,
    right: string,
    registry: Parameters<typeof findCanonicalRegistryKey>[1]
): boolean {
    const leftKey = findCanonicalRegistryKey(left, registry)
    const rightKey = findCanonicalRegistryKey(right, registry)
    if (leftKey !== undefined && rightKey !== undefined) {
        return leftKey.toLowerCase() === rightKey.toLowerCase()
    }
    return left === right
}

function assertImplicitUpdateWorkspaceMatch(
    entryId: number,
    existingEntry: { workspaceId?: string } | null | undefined,
    trimmedTargetWs: string | undefined,
    config: ToolHandlerConfig
): void {
    const registry = activeProjectRegistry(config.projectRegistry)
    const implicitWorkspace = resolveWorkspaceId(undefined, undefined, {
        runtime: null,
        ...(config.defaultWorkspaceId !== undefined
            ? { defaultWorkspaceId: config.defaultWorkspaceId }
            : {}),
        ...(config.projectRegistry !== undefined
            ? { projectRegistry: config.projectRegistry }
            : {}),
    })
    if (
        trimmedTargetWs !== undefined &&
        existingEntry?.workspaceId !== undefined &&
        !sameCliWorkspaceScope(existingEntry.workspaceId, trimmedTargetWs, registry) &&
        (implicitWorkspace === undefined ||
            !sameCliWorkspaceScope(existingEntry.workspaceId, implicitWorkspace, registry))
    ) {
        throw new ValidationError(
            `Entry #${String(entryId)} belongs to workspace '${existingEntry.workspaceId}'. Pass --workspace '${existingEntry.workspaceId}' --target-workspace '${trimmedTargetWs}' explicitly to reassign it.`,
            {
                entryId,
                entryWorkspaceId: existingEntry.workspaceId,
                targetWorkspaceId: trimmedTargetWs,
            }
        )
    }
    if (
        existingEntry?.workspaceId !== undefined &&
        implicitWorkspace !== undefined &&
        !sameCliWorkspaceScope(existingEntry.workspaceId, implicitWorkspace, registry)
    ) {
        throw new ValidationError(
            `Entry #${String(entryId)} belongs to workspace '${existingEntry.workspaceId}', not active workspace '${implicitWorkspace}'. Pass --workspace '${existingEntry.workspaceId}' explicitly to update it.`,
            {
                entryId,
                entryWorkspaceId: existingEntry.workspaceId,
                activeWorkspaceId: implicitWorkspace,
            }
        )
    }
}

export function assertCliUpdateWorkspaceOwnership(
    entryId: number,
    existingEntry: { workspaceId?: string } | null | undefined,
    rawWorkspaceOpt: string | undefined,
    payload: EntryPayload,
    trimmedTargetWs: string | undefined,
    config: ToolHandlerConfig,
    metaSourceWs?: string
): void {
    if (payload.workspaceId?.trim() === '*') {
        throw new ValidationError(
            "workspace_id '*' cannot be used to update an entry. Pass a concrete workspace.",
            { workspaceId: '*' }
        )
    }

    const explicitSourceWs = resolveExplicitSourceWorkspace(
        rawWorkspaceOpt,
        payload,
        trimmedTargetWs,
        metaSourceWs
    )
    if (explicitSourceWs !== undefined) {
        const registry = activeProjectRegistry(config.projectRegistry)
        if (
            existingEntry?.workspaceId !== undefined &&
            !sameCliWorkspaceScope(existingEntry.workspaceId, explicitSourceWs, registry)
        ) {
            throw new ValidationError(
                `Entry #${String(entryId)} belongs to workspace '${existingEntry.workspaceId}', not '${explicitSourceWs}'. Pass --workspace '${existingEntry.workspaceId}' --target-workspace '${trimmedTargetWs ?? explicitSourceWs}' explicitly to reassign it.`,
                {
                    entryId,
                    entryWorkspaceId: existingEntry.workspaceId,
                    requestedWorkspaceId: explicitSourceWs,
                }
            )
        }
        return
    }

    assertImplicitUpdateWorkspaceMatch(entryId, existingEntry, trimmedTargetWs, config)
}

export function assertCliUpdateProjectOwnership(
    entryId: number,
    existingEntry: { workspaceId?: string; projectNumber?: number | null } | null | undefined,
    payload: EntryPayload,
    trimmedTargetWs: string | undefined,
    config: ToolHandlerConfig,
    isTeam = false
): void {
    if (trimmedTargetWs !== undefined) return
    if (payload.hasExplicitProject !== true || payload.projectNumber === undefined) return

    const registry = activeProjectRegistry(config.projectRegistry)
    const effectiveWs = existingEntry?.workspaceId ?? payload.workspaceId
    pairStoredScope(effectiveWs, payload.projectNumber, registry)

    const existingProject = existingEntry?.projectNumber
    if (
        existingProject === null ||
        existingProject === undefined ||
        existingProject === 0 ||
        existingProject === payload.projectNumber
    ) {
        return
    }

    if (!isTeam && existingEntry?.workspaceId?.toLowerCase() === 'default') return

    const storedWs = concreteWorkspace(existingEntry?.workspaceId)
    const regKey = storedWs !== undefined ? exactRegistryKey(storedWs, registry) : undefined
    const registeredProject =
        regKey !== undefined ? registry?.[regKey]?.project_number : undefined
    const canRealignOrphanedRegisteredProject =
        !isTeam &&
        registeredProject === payload.projectNumber &&
        workspacesForProject(existingProject, registry).length === 0

    if (!canRealignOrphanedRegisteredProject) {
        throw new ValidationError(
            `Entry #${String(entryId)} belongs to project ${String(existingProject)}, not ${String(payload.projectNumber)}.`,
            {
                entryId,
                entryProjectNumber: existingProject,
                requestedProjectNumber: payload.projectNumber,
            }
        )
    }
}

export type CliEntryUpdateInput = Omit<Partial<CreateEntryInput>, 'projectNumber'> & {
    projectNumber?: number | null
    expectedVersion: number
    targetWorkspaceId?: string
}

export function buildCliEntryUpdateObject(
    content: string,
    version: number,
    payload: EntryPayload,
    existingEntry: { workspaceId?: string; projectNumber?: number | null } | null | undefined,
    trimmedTargetWs: string | undefined,
    config: ToolHandlerConfig
): CliEntryUpdateInput {
    const updates: CliEntryUpdateInput = { content, expectedVersion: version }
    if (payload.entryType !== undefined) updates.entryType = payload.entryType
    if (payload.tags !== undefined) updates.tags = payload.tags

    // [INVARIANT] A cwd-derived project number is only backfilled onto an unnumbered entry
    // that lives in a non-`default` workspace and stays in that workspace; `default` entries
    // stay unnumbered unless the caller passed an explicit project (C2).
    const existingIsDefault = existingEntry?.workspaceId?.toLowerCase() === 'default'
    const shouldApplyProject =
        payload.hasExplicitProject === true ||
        (!existingIsDefault &&
            (existingEntry?.projectNumber == null || existingEntry.projectNumber === 0) &&
            trimmedTargetWs === undefined &&
            payload.workspaceId === existingEntry?.workspaceId)
    if (payload.projectNumber !== undefined && shouldApplyProject) {
        updates.projectNumber = payload.projectNumber
    }

    if (trimmedTargetWs !== undefined) {
        const targetWorkspace = payload.workspaceId ?? trimmedTargetWs
        const registry = activeProjectRegistry(config.projectRegistry)
        if (
            existingEntry?.workspaceId !== undefined &&
            !sameCliWorkspaceScope(existingEntry.workspaceId, targetWorkspace, registry)
        ) {
            updates.workspaceId = '*'
            updates.targetWorkspaceId = targetWorkspace
            if (payload.hasExplicitProject !== true) {
                updates.projectNumber = payload.projectNumber ?? null
            }
        } else {
            updates.workspaceId = targetWorkspace
        }
    } else if (existingEntry?.workspaceId !== undefined) {
        if (payload.hasExplicitProject === true && payload.projectNumber !== undefined) {
            pairStoredScope(
                existingEntry.workspaceId,
                payload.projectNumber,
                activeProjectRegistry(config.projectRegistry)
            )
        }
        updates.workspaceId = existingEntry.workspaceId
    } else if (payload.workspaceId !== undefined) {
        updates.workspaceId = payload.workspaceId
    }

    if (payload.trustScore !== undefined) updates.trustScore = payload.trustScore
    if (payload.impactScore !== undefined) updates.impactScore = payload.impactScore
    if (payload.validationStatus !== undefined) updates.validationStatus = payload.validationStatus
    if (payload.significanceType !== undefined) updates.significanceType = payload.significanceType
    if (payload.sessionId !== undefined) updates.sessionId = payload.sessionId
    if (payload.autoContextStr !== undefined) updates.autoContext = payload.autoContextStr
    if (payload.anchors !== undefined && payload.anchors.length > 0) {
        updates.anchors = payload.anchors.map((a) => ({
            anchorPath: a.anchor_path,
            anchorType: a.anchor_type,
        }))
    }
    return updates
}

export async function applyCliUpdateAnchors(
    updates: CliEntryUpdateInput,
    payload: EntryPayload,
    workspaceId: string,
    db: IDatabaseAdapter,
    config: ToolHandlerConfig
): Promise<void> {
    const resolved = await resolveEntryAnchors(
        payload.anchors,
        payload.autoContextStr,
        workspaceId,
        { db, config }
    )
    if (resolved !== undefined) {
        updates.anchors = resolved
    }
}

export async function prepareCliEntryUpdate(params: {
    entryId: number
    version: number
    existingEntry: { workspaceId?: string; projectNumber?: number | null } | null | undefined
    rawWorkspaceOpt: string | undefined
    trimmedTargetWs: string | undefined
    metaSourceWs: string | undefined
    content: string
    payload: EntryPayload
    config: ToolHandlerConfig
    db: IDatabaseAdapter
    isTeam: boolean
}): Promise<CliEntryUpdateInput> {
    assertCliUpdateWorkspaceOwnership(
        params.entryId,
        params.existingEntry,
        params.rawWorkspaceOpt,
        params.payload,
        params.trimmedTargetWs,
        params.config,
        params.metaSourceWs
    )
    assertCliUpdateProjectOwnership(
        params.entryId,
        params.existingEntry,
        params.payload,
        params.trimmedTargetWs,
        params.config,
        params.isTeam
    )
    const updates = buildCliEntryUpdateObject(
        params.content,
        params.version,
        params.payload,
        params.existingEntry,
        params.trimmedTargetWs,
        params.config
    )
    await applyCliUpdateAnchors(
        updates,
        params.payload,
        updates.workspaceId ?? params.existingEntry?.workspaceId ?? 'default',
        params.db,
        params.config
    )
    return updates
}
