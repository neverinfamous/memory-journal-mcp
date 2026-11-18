/**
 * Nested Code Mode `executeCode` scope validation helpers.
 * Worker-thread safe (no host DB, config-file, or external npm imports).
 */

import type { ProjectRegistryEntry } from '../../types/index.js'
import { readProjectRegistryPayload } from '../normalizers/generic-field-aliases.js'

export function isPlainRecord(val: unknown): val is Record<string, unknown> {
    return typeof val === 'object' && val !== null && !Array.isArray(val)
}

export function findRegistryKey(
    name: string,
    registry: Record<string, ProjectRegistryEntry> | undefined
): string | undefined {
    if (registry === undefined) return undefined
    const lower = name.trim().toLowerCase()
    if (lower === '') return undefined
    for (const key of Object.keys(registry)) {
        if (key.toLowerCase() === lower) return key
    }
    const slug = lower.replace(/_/g, '-')
    const slugMatches = Object.keys(registry).filter(
        (key) => key.toLowerCase().replace(/_/g, '-') === slug
    )
    if (slugMatches.length === 1) return slugMatches[0]

    const pathMatches = Object.entries(registry)
        .filter(([, entry]) => {
            const p = typeof entry.path === 'string' ? entry.path : ''
            const base = p.split(/[/\\]/).filter(Boolean).pop() ?? ''
            return base.toLowerCase() === lower
        })
        .map(([key]) => key)
    return pathMatches.length === 1 ? pathMatches[0] : undefined
}

function collectNestedScopeRecords(argRec: Record<string, unknown>): Record<string, unknown>[] {
    const records: Record<string, unknown>[] = [argRec]
    for (const key of ['metadata', 'context', 'params', 'entry', 'payload', 'input'] as const) {
        const nested = argRec[key]
        if (isPlainRecord(nested)) records.push(nested)
    }
    return records
}

export function parseProjectNumberCandidate(
    rawProj: unknown,
    registry: Record<string, ProjectRegistryEntry> | undefined
): number | null {
    if (typeof rawProj === 'number') {
        return Number.isSafeInteger(rawProj) && rawProj > 0 ? rawProj : null
    }
    if (typeof rawProj === 'string') {
        const trimmed = rawProj.trim()
        const numMatch = /^(?:#|p-)?([1-9]\d*)$/i.exec(trimmed)
        if (numMatch?.[1] !== undefined) {
            const parsed = Number(numMatch[1])
            return Number.isSafeInteger(parsed) && parsed > 0 && String(parsed) === numMatch[1]
                ? parsed
                : null
        }
        const matchedKey = findRegistryKey(trimmed, registry)
        const regProj = matchedKey !== undefined ? registry?.[matchedKey]?.project_number : undefined
        return typeof regProj === 'number' && Number.isSafeInteger(regProj) && regProj > 0
            ? regProj
            : null
    }
    return null
}

export function isProjectStringValue(val: unknown): val is string {
    if (typeof val !== 'string') return false
    const trimmed = val.trim()
    return trimmed !== '' && !/^(?:#|p-)?\d+$/i.test(trimmed)
}

function validateWorkspaceAliases(
    records: Record<string, unknown>[],
    pinnedWorkspace: string,
    canonPinned: string,
    registry: Record<string, ProjectRegistryEntry> | undefined
): { error: string } | null {
    const wsKeys = [
        'workspace_id',
        'workspaceId',
        'workspace',
        'target_workspace_id',
        'targetWorkspaceId',
        'project_name',
        'projectName',
    ] as const
    for (const rec of records) {
        for (const key of wsKeys) {
            const raw = rec[key]
            if (typeof raw !== 'string') continue
            const trimmed = raw.trim()
            if (trimmed === '') continue
            if (trimmed === '*') {
                return { error: `Workspace '*' conflicts with pinned session workspace '${pinnedWorkspace}'` }
            }
            const canonArg = findRegistryKey(trimmed, registry) ?? trimmed
            if (canonArg.toLowerCase() !== canonPinned.toLowerCase()) {
                return { error: `Workspace '${trimmed}' conflicts with pinned session workspace '${pinnedWorkspace}'` }
            }
        }
        const rawProject = rec['project']
        if (isProjectStringValue(rawProject)) {
            const trimmed = rawProject.trim()
            if (trimmed === '*') {
                return { error: `Workspace '*' conflicts with pinned session workspace '${pinnedWorkspace}'` }
            }
            const canonArg = findRegistryKey(trimmed, registry) ?? trimmed
            if (canonArg.toLowerCase() !== canonPinned.toLowerCase()) {
                return { error: `Workspace '${trimmed}' conflicts with pinned session workspace '${pinnedWorkspace}'` }
            }
        }
    }
    return null
}

function validateRepoAliases(
    records: Record<string, unknown>[],
    pinnedWorkspace: string,
    canonPinned: string,
    registry: Record<string, ProjectRegistryEntry> | undefined
): { error: string } | null {
    const repoKeys = ['repo', 'repo_name', 'repoName', 'repository'] as const
    for (const rec of records) {
        for (const key of repoKeys) {
            const rawRepo = rec[key]
            if (typeof rawRepo !== 'string' || rawRepo.trim() === '') continue
            const trimmedRepo = rawRepo.trim()
            const repoSlug = trimmedRepo.split(/[/\\]/).filter(Boolean).pop() ?? trimmedRepo
            const matchedRepoKey =
                findRegistryKey(trimmedRepo, registry) ?? findRegistryKey(repoSlug, registry)
            if (matchedRepoKey !== undefined) {
                if (matchedRepoKey.toLowerCase() !== canonPinned.toLowerCase()) {
                    return {
                        error: `Repository '${trimmedRepo}' conflicts with pinned session workspace '${pinnedWorkspace}'`,
                    }
                }
            } else if (
                repoSlug.toLowerCase() !== pinnedWorkspace.toLowerCase() &&
                repoSlug.toLowerCase() !== canonPinned.toLowerCase()
            ) {
                return {
                    error: `Repository '${trimmedRepo}' conflicts with pinned session workspace '${pinnedWorkspace}'`,
                }
            }
        }
    }
    return null
}

function validateProjectNumberAliases(
    records: Record<string, unknown>[],
    pinnedWorkspace: string | undefined,
    pinnedProjectNumber: number | undefined,
    canonPinned: string | undefined,
    registry: Record<string, ProjectRegistryEntry> | undefined
): { error: string } | null {
    const projKeys = ['project_number', 'projectNumber', 'project_id', 'projectId', 'project'] as const
    for (const rec of records) {
        for (const key of projKeys) {
            const rawProj = rec[key]
            if (rawProj === undefined || rawProj === null || rawProj === '') continue
            if (key === 'project' && isProjectStringValue(rawProj)) continue
            const parsedProj = parseProjectNumberCandidate(rawProj, registry)
            if (parsedProj === null) {
                const projDesc =
                    typeof rawProj === 'string' ||
                    typeof rawProj === 'number' ||
                    typeof rawProj === 'boolean'
                        ? String(rawProj)
                        : (JSON.stringify(rawProj) ?? 'invalid')
                return { error: `Invalid project_number '${projDesc}' in nested executeCode` }
            }
            if (pinnedProjectNumber !== undefined && parsedProj !== pinnedProjectNumber) {
                return {
                    error: `project_number ${String(parsedProj)} conflicts with pinned session project_number ${String(pinnedProjectNumber)}`,
                }
            }
            if (pinnedWorkspace?.toLowerCase() === 'default') {
                const defaultRegProj = registry?.['default']?.project_number
                if (parsedProj !== pinnedProjectNumber && parsedProj !== defaultRegProj) {
                    return {
                        error: `project_number ${String(parsedProj)} conflicts with pinned session workspace '${pinnedWorkspace}'`,
                    }
                }
            } else if (pinnedWorkspace !== undefined && registry !== undefined && canonPinned !== undefined) {
                const owners = Object.entries(registry)
                    .filter(([, entry]) => entry.project_number === parsedProj)
                    .map(([ownerKey]) => ownerKey)
                if (
                    owners.length > 0 &&
                    !owners.some((k) => k.toLowerCase() === canonPinned.toLowerCase())
                ) {
                    return {
                        error: `project_number ${String(parsedProj)} conflicts with pinned session workspace '${pinnedWorkspace}'`,
                    }
                }
            }
        }
    }
    return null
}

/**
 * Validates that nested `mj.executeCode` / `executeCode` arguments do not drift outside the
 * outer session's pinned `workspace_id` or `project_number`.
 */
export function validateNestedExecScope(
    argRec: Record<string, unknown> | undefined,
    pinnedWorkspace: string | undefined,
    pinnedProjectNumber: number | undefined,
    projectRegistryRaw: unknown
): { error: string } | null {
    if (argRec === undefined) return null
    const registry = readProjectRegistryPayload(projectRegistryRaw)
    const records = collectNestedScopeRecords(argRec)
    const canonPinned =
        pinnedWorkspace !== undefined
            ? findRegistryKey(pinnedWorkspace, registry) ?? pinnedWorkspace
            : undefined

    if (pinnedWorkspace !== undefined && canonPinned !== undefined) {
        const wsErr = validateWorkspaceAliases(records, pinnedWorkspace, canonPinned, registry)
        if (wsErr !== null) return wsErr
        const repoErr = validateRepoAliases(records, pinnedWorkspace, canonPinned, registry)
        if (repoErr !== null) return repoErr
    }

    return validateProjectNumberAliases(
        records,
        pinnedWorkspace,
        pinnedProjectNumber,
        canonPinned,
        registry
    )
}
