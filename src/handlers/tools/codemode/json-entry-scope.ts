/**
 * Scope inheritance and project/workspace normalization helpers for Code Mode JSON payload recovery.
 */

import {
    getActiveProjectRegistry,
    hasActiveProjectRegistry,
    resolveEffectiveProjectRegistry,
} from '../../../codemode/normalizers/project-alias-helpers.js'
import { findCanonicalRegistryKey, loadProjectRegistryFromConfig } from '../../../utils/workspace-resolver.js'
import { parseCanonicalPositiveInt } from '../../../utils/safe-positive-int.js'

/** Resolves `project_number` / aliases from a JSON recovery payload record. */
export function readProjectNumber(target: Record<string, unknown>): number | string | undefined {
    const raw =
        target['project_number'] ??
        target['projectNumber'] ??
        target['project_id'] ??
        target['projectId'] ??
        target['project_name'] ??
        target['projectName'] ??
        target['project']
    if (typeof raw === 'number') {
        return Number.isSafeInteger(raw) && raw > 0 ? raw : undefined
    }
    if (typeof raw === 'string' && raw.trim() !== '') {
        const trimmed = raw.trim()
        const parsed = /^p-?\d+$/i.test(trimmed)
            ? parseCanonicalPositiveInt(trimmed.replace(/^p-?/i, ''))
            : parseCanonicalPositiveInt(trimmed)
        if (parsed !== undefined) return parsed
        return trimmed
    }
    return undefined
}

/** Maps a `repo` / `owner/repo` value onto a registered workspace key; never copies it verbatim. */
export function resolveRepoWorkspace(repo: unknown): string | undefined {
    if (typeof repo !== 'string' || repo.trim() === '') return undefined
    const name = repo.trim().split(/[/\\]/).filter(Boolean).pop()?.trim() ?? ''
    if (name === '') return undefined
    const registry = hasActiveProjectRegistry()
        ? getActiveProjectRegistry()
        : (resolveEffectiveProjectRegistry() ?? loadProjectRegistryFromConfig())
    if (registry === undefined) return undefined
    return findCanonicalRegistryKey(name, registry)
}

/** Resolves explicit workspace or registered repo workspace from a JSON recovery payload record. */
export function readWorkspaceId(target: Record<string, unknown>): string | undefined {
    const raw = target['workspace_id'] ?? target['workspaceId'] ?? target['workspace']
    if (typeof raw === 'string' && raw.trim() !== '') return raw.trim()
    return resolveRepoWorkspace(
        target['repo'] ?? target['repo_name'] ?? target['repoName'] ?? target['repository']
    )
}

/**
 * Resolves compatible `(workspaceId, projectNumber)` scope inherited from outer wrapper onto target,
 * forwarding explicit `'default'` outer `project_number` only onto `'default'` / unspecified targets.
 */
export function resolveCompatibleInheritedScope(
    target: Record<string, unknown>,
    original: Record<string, unknown>,
    allowDefaultProjForward = false
): { workspaceId?: string; projectNumber?: number | string } {
    const targetWs = readWorkspaceId(target)
    const origWs = original !== target ? readWorkspaceId(original) : undefined
    const targetProj = readProjectNumber(target)
    const origProj = original !== target ? readProjectNumber(original) : undefined

    const workspaceId = targetWs ?? (targetProj === undefined ? origWs : undefined)
    const compatibleWs = targetWs === undefined || targetWs.toLowerCase() === origWs?.toLowerCase()
    const origIsDefault = origWs?.toLowerCase() === 'default'
    const targetIsDefault = targetWs?.toLowerCase() === 'default'
    const origIsDefaultWithoutTargetWs = targetWs === undefined && origIsDefault
    const allowOrigProj =
        targetProj === undefined &&
        origProj !== undefined &&
        compatibleWs &&
        (!targetIsDefault || origIsDefault) &&
        (!origIsDefaultWithoutTargetWs || allowDefaultProjForward || origIsDefault)

    return {
        ...(workspaceId !== undefined ? { workspaceId } : {}),
        ...(targetProj !== undefined
            ? { projectNumber: targetProj }
            : allowOrigProj
              ? { projectNumber: origProj }
              : {}),
    }
}

/** Populates missing `workspace_id` / `project_number` fields on recovered dispatch parameter maps. */
export function assignMissingScope(
    params: Record<string, unknown>,
    target: Record<string, unknown>,
    original: Record<string, unknown>
): void {
    const hasWsParam = params['workspace_id'] !== undefined || params['workspaceId'] !== undefined
    const hasProjParam = params['project_number'] !== undefined || params['projectNumber'] !== undefined
    const effectiveTarget =
        hasWsParam || hasProjParam
            ? {
                  ...target,
                  ...(hasWsParam ? { workspace_id: params['workspace_id'] ?? params['workspaceId'] } : {}),
                  ...(hasProjParam ? { project_number: params['project_number'] ?? params['projectNumber'] } : {}),
              }
            : target
    const scope = resolveCompatibleInheritedScope(effectiveTarget, original)
    if (!hasWsParam && scope.workspaceId !== undefined) {
        params['workspace_id'] = scope.workspaceId
    }
    if (!hasProjParam && scope.projectNumber !== undefined) {
        params['project_number'] = scope.projectNumber
    }
}
