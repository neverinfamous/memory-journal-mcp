/**
 * memory-journal-mcp — Markdown Importer Scope Helpers
 *
 * Isolates workspace/project validation and pairing rules for markdown imports.
 */

import { ValidationError } from '../types/errors.js'
import {
    findCanonicalRegistryKey,
    resolveProjectContext,
} from '../utils/workspace-resolver.js'
import { activeProjectRegistry, pairStoredScope } from '../utils/write-scope.js'
import type { ImportOptions, ParsedFile } from './importer.js'

/**
 * [INVARIANT] An explicit caller workspace — including the real `default` workspace — locks
 * ownership checks. Only `*` and blanks are unscoped.
 */
function concreteCallerWorkspace(workspaceId: string | undefined): string | undefined {
    if (workspaceId === undefined) return undefined
    const trimmed = workspaceId.trim()
    if (trimmed === '' || trimmed === '*') return undefined
    return trimmed
}

function sameRegistryWorkspace(
    left: string,
    right: string,
    registry: Parameters<typeof findCanonicalRegistryKey>[1]
): boolean {
    const leftKey = findCanonicalRegistryKey(left, registry) ?? left
    const rightKey = findCanonicalRegistryKey(right, registry) ?? right
    return leftKey.toLowerCase() === rightKey.toLowerCase()
}

export function resolveImportedFileContext(
    file: ParsedFile,
    options: ImportOptions
): { effectiveWsId: string | undefined; effectiveProjNum: number | undefined } {
    const { metadata } = file
    const rawWorkspaceId = options.workspaceId ?? metadata.workspace_id
    if (rawWorkspaceId?.trim() === '*' || metadata.workspace_id?.trim() === '*') {
        throw new ValidationError("Workspace '*' cannot be used for import writes")
    }

    const fileProject = metadata.project_number
    if (
        (options.project_number !== undefined && options.project_number <= 0) ||
        (fileProject !== undefined && fileProject <= 0)
    ) {
        throw new ValidationError('project_number must be a positive integer')
    }

    const effectiveRegistry = activeProjectRegistry(options.config?.projectRegistry)
    const lockedWorkspace = concreteCallerWorkspace(options.workspaceId)
    const fileWorkspace = concreteCallerWorkspace(metadata.workspace_id)
    if (
        lockedWorkspace !== undefined &&
        fileWorkspace !== undefined &&
        !sameRegistryWorkspace(lockedWorkspace, fileWorkspace, effectiveRegistry)
    ) {
        throw new ValidationError(
            `Frontmatter workspace_id '${fileWorkspace}' conflicts with target workspace '${lockedWorkspace}'.`
        )
    }
    if (
        options.project_number !== undefined &&
        fileProject !== undefined &&
        options.project_number !== fileProject
    ) {
        throw new ValidationError(
            `Frontmatter project_number ${String(fileProject)} conflicts with target project_number ${String(options.project_number)}.`
        )
    }

    const explicitWs = lockedWorkspace ?? fileWorkspace
    const rawProjectNumber = options.project_number ?? fileProject
    if (explicitWs !== undefined && rawProjectNumber !== undefined && effectiveRegistry !== undefined) {
        const owner = Object.entries(effectiveRegistry).find(
            ([, entry]) => entry.project_number === rawProjectNumber
        )?.[0]
        if (owner !== undefined && !sameRegistryWorkspace(explicitWs, owner, effectiveRegistry)) {
            throw new ValidationError(
                `project_number ${String(rawProjectNumber)} belongs to workspace '${owner}', not '${explicitWs}'.`
            )
        }
        const canonicalExplicit = findCanonicalRegistryKey(explicitWs, effectiveRegistry)
        const registeredProject =
            canonicalExplicit !== undefined
                ? effectiveRegistry[canonicalExplicit]?.project_number
                : undefined
        if (registeredProject !== undefined && registeredProject !== rawProjectNumber) {
            throw new ValidationError(
                `project_number ${String(rawProjectNumber)} does not match registered project ${String(registeredProject)} for workspace '${explicitWs}'.`
            )
        }
        pairStoredScope(explicitWs, rawProjectNumber, effectiveRegistry)
    }

    const resolved = resolveProjectContext(
        {
            workspace_id: rawWorkspaceId,
            project_number: rawProjectNumber,
        },
        options.config
    )
    const paired = pairStoredScope(resolved.workspaceId, resolved.projectNumber, effectiveRegistry)
    return {
        effectiveWsId: paired.workspaceId ?? resolved.workspaceId,
        effectiveProjNum: paired.projectNumber ?? undefined,
    }
}
