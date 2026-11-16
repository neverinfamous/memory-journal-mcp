import type { z } from 'zod'
import type { CreateEntryInput, ToolHandlerConfig } from '../../types/index.js'
import { ValidationError } from '../../types/errors.js'
import { activeProjectRegistry, pairStoredScope } from '../../utils/write-scope.js'
import { resolveWorkspaceId } from '../../utils/workspace-resolver.js'
import type { updateEntryOptionsSchema } from '../schemas.js'
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
    if (entryId === undefined || !Number.isInteger(entryId) || entryId < 1) {
        process.stderr.write('Error: Must provide a valid --id (positive integer)\n')
        process.exit(1)
    }

    const version = options.expectedVersion
    if (version === undefined || !Number.isInteger(version) || version < 1) {
        process.stderr.write(
            'Error: Must provide a valid --expected-version (expected positive integer version) to prevent concurrent overwrites\n'
        )
        process.exit(1)
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

    const explicitSourceWs =
        rawWorkspaceOpt !== undefined && rawWorkspaceOpt.trim() !== ''
            ? rawWorkspaceOpt.trim()
            : metaSourceWs !== undefined && metaSourceWs !== ''
              ? metaSourceWs
              : payload.hasExplicitWorkspace === true && trimmedTargetWs === undefined
                ? payload.workspaceId
                : undefined

    if (explicitSourceWs !== undefined) {
        if (
            existingEntry?.workspaceId !== undefined &&
            existingEntry.workspaceId.toLowerCase() !== explicitSourceWs.toLowerCase()
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
        existingEntry.workspaceId.toLowerCase() !== trimmedTargetWs.toLowerCase() &&
        existingEntry.workspaceId.toLowerCase() !== implicitWorkspace?.toLowerCase()
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
        existingEntry.workspaceId.toLowerCase() !== implicitWorkspace.toLowerCase()
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
        if (
            existingEntry?.workspaceId !== undefined &&
            existingEntry.workspaceId.toLowerCase() !== targetWorkspace.toLowerCase()
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
    return updates
}
