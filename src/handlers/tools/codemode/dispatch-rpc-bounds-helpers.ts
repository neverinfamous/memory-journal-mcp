/**
 * Helper predicates and bounds checks for Code Mode nested RPC scope enforcement.
 */

import type { ToolContext } from '../../../types/index.js'
import { isRecord } from '../../../codemode/normalizers/shared-utils.js'
import { parseCanonicalPositiveInt } from '../../../utils/safe-positive-int.js'
import { findCanonicalRegistryKey } from '../../../utils/workspace-registry-match.js'
import { assertSafeDirectoryPath, PathTraversalError } from '../../../utils/security-utils.js'

export type RegistryMap = NonNullable<ToolContext['config']>['projectRegistry']

export const PROJECT_ADMIN_TOOL_NAMES: ReadonlySet<string> = new Set([
    'get_project',
    'register_project',
    'update_project',
    'delete_project',
])

export const IO_DIR_TOOL_NAMES: ReadonlySet<string> = new Set([
    'export_markdown',
    'import_markdown',
    'import_external',
    'team_export_markdown',
    'team_import_markdown',
    'team_import_external',
])

const NESTED_CONTAINER_KEYS = ['entry', 'filters', 'filter', 'metadata', 'context'] as const
const MAX_COLLECTED_CONTAINERS = 64
const CANONICAL_INT_STR_RE = /^[1-9]\d*$/
const PREFIXED_INT_STR_RE = /^[p#][1-9]\d*$/i

export function validationErrResult(error: string): Record<string, unknown> {
    return {
        success: false,
        error,
        code: 'VALIDATION_ERROR',
        category: 'validation',
        recoverable: true,
    }
}

export function workspacesConflict(
    explicitWs: string,
    pinnedWs: string,
    registry: RegistryMap
): boolean {
    const canonExplicit = findCanonicalRegistryKey(explicitWs, registry) ?? explicitWs
    const canonPinned = findCanonicalRegistryKey(pinnedWs, registry) ?? pinnedWs
    return canonExplicit.toLowerCase() !== canonPinned.toLowerCase()
}

export function resolveRegistryEntryProject(
    keyOrRepo: string,
    registry: RegistryMap
): { matchedKey: string | undefined; projectNumber: number | undefined } {
    if (registry === undefined) return { matchedKey: undefined, projectNumber: undefined }
    const direct = findCanonicalRegistryKey(keyOrRepo, registry)
    if (direct !== undefined) {
        return { matchedKey: direct, projectNumber: registry[direct]?.project_number }
    }
    const slug = keyOrRepo.split(/[/\\]/).filter(Boolean).pop()
    const slugKey = slug !== undefined && slug !== '' ? findCanonicalRegistryKey(slug, registry) : undefined
    return {
        matchedKey: slugKey,
        projectNumber: slugKey !== undefined ? registry[slugKey]?.project_number : undefined,
    }
}

/** Parse positive integer IDs expressed cleanly or with optional `p` / `#` prefixes. */
export function parsePrefixedProjectInt(raw: string): number | undefined {
    const cleaned = raw.trim()
    if (CANONICAL_INT_STR_RE.test(cleaned)) {
        return parseCanonicalPositiveInt(cleaned)
    }
    if (PREFIXED_INT_STR_RE.test(cleaned)) {
        return parseCanonicalPositiveInt(cleaned.slice(1))
    }
    return undefined
}

function resolvePinnedPathsForScope(
    effectivePinnedWs: string | undefined,
    pinnedProj: number | undefined,
    registry: RegistryMap
): string[] {
    if (registry === undefined) return []
    if (effectivePinnedWs !== undefined) {
        const key = findCanonicalRegistryKey(effectivePinnedWs, registry) ?? effectivePinnedWs
        const p = registry[key]?.path
        return typeof p === 'string' && p.trim() !== '' ? [p] : []
    }
    if (pinnedProj !== undefined) {
        return Object.values(registry).flatMap((e) =>
            e.project_number === pinnedProj && typeof e.path === 'string' && e.path.trim() !== ''
                ? [e.path]
                : []
        )
    }
    return []
}

function checkDirectoryBoundsForScope(
    dirVal: unknown,
    fieldName: string,
    effectivePinnedWs: string | undefined,
    pinnedProj: number | undefined,
    registry: RegistryMap,
    requirePinnedPath: boolean
): Record<string, unknown> | undefined {
    if (typeof dirVal !== 'string' || dirVal.trim() === '') return undefined
    const allowedPaths = resolvePinnedPathsForScope(effectivePinnedWs, pinnedProj, registry)
    if (allowedPaths.length === 0) {
        return requirePinnedPath
            ? validationErrResult(`${fieldName} is not allowed without a registered path in nested executeCode scope.`)
            : undefined
    }
    try {
        assertSafeDirectoryPath(dirVal.trim(), allowedPaths)
        return undefined
    } catch (err) {
        const msg = err instanceof PathTraversalError ? err.message : `${fieldName} conflicts with nested executeCode scope.`
        return validationErrResult(msg)
    }
}

export function checkScopedRepoAndOwnerFields(
    rec: Record<string, unknown>,
    effectivePinnedWs: string,
    registry: RegistryMap
): Record<string, unknown> | undefined {
    const pinnedOwner = effectivePinnedWs.includes('/') ? effectivePinnedWs.split('/')[0] : undefined
    const rawOwner = rec['owner']
    if (typeof rawOwner === 'string' && rawOwner.trim() !== '' && pinnedOwner !== undefined) {
        if (rawOwner.trim().toLowerCase() !== pinnedOwner.toLowerCase()) {
            return validationErrResult(
                `owner '${rawOwner.trim()}' conflicts with nested executeCode scope '${effectivePinnedWs}'.`
            )
        }
    }
    for (const repoKey of ['repo', 'repo_name', 'repository'] as const) {
        const rawRepo = rec[repoKey]
        if (typeof rawRepo !== 'string' || rawRepo.trim() === '') continue
        const trimmedRepo = rawRepo.trim()
        const slashParts = trimmedRepo.split(/[/\\]/).filter(Boolean)
        if (pinnedOwner !== undefined && slashParts.length >= 2 && slashParts[0]?.toLowerCase() !== pinnedOwner.toLowerCase()) {
            return validationErrResult(
                `${repoKey} '${trimmedRepo}' conflicts with nested executeCode scope '${effectivePinnedWs}'.`
            )
        }
        const repoSlug = slashParts.pop() ?? trimmedRepo
        const resolvedRepo =
            findCanonicalRegistryKey(trimmedRepo, registry) ??
            findCanonicalRegistryKey(repoSlug, registry) ??
            repoSlug
        if (workspacesConflict(resolvedRepo, effectivePinnedWs, registry)) {
            return validationErrResult(
                `${repoKey} '${trimmedRepo}' conflicts with nested executeCode scope '${effectivePinnedWs}'.`
            )
        }
    }
    return undefined
}

function checkProjectAdminCandidate(
    candidate: string,
    keyName: string,
    effectivePinnedWs: string | undefined,
    pinnedProj: number | undefined,
    registry: RegistryMap
): Record<string, unknown> | undefined {
    if (CANONICAL_INT_STR_RE.test(candidate)) {
        const numVal = Number(candidate)
        if (pinnedProj !== undefined && numVal !== pinnedProj) {
            return validationErrResult(`${keyName} '${candidate}' conflicts with nested executeCode project_number ${String(pinnedProj)}.`)
        }
        if (effectivePinnedWs !== undefined) {
            const pinnedWsProj = resolveRegistryEntryProject(effectivePinnedWs, registry).projectNumber
            if (pinnedWsProj !== numVal) {
                return validationErrResult(`${keyName} '${candidate}' conflicts with nested executeCode scope '${effectivePinnedWs}'.`)
            }
        }
        return undefined
    }
    if (effectivePinnedWs !== undefined && workspacesConflict(candidate, effectivePinnedWs, registry)) {
        return validationErrResult(`${keyName} '${candidate}' conflicts with nested executeCode scope '${effectivePinnedWs}'.`)
    }
    if (pinnedProj !== undefined && resolveRegistryEntryProject(candidate, registry).projectNumber !== pinnedProj) {
        return validationErrResult(`${keyName} '${candidate}' conflicts with nested executeCode project_number ${String(pinnedProj)}.`)
    }
    return undefined
}

const DB_WIDE_BACKUP_TOOL_NAMES: ReadonlySet<string> = new Set([
    'restore_backup',
    'cleanup_backups',
    'backup_journal',
    'list_backups',
    'team_backup',
    'team_list_backups',
])

export function checkToolSpecificRpcBounds(
    toolName: string,
    rec: Record<string, unknown>,
    effectivePinnedWs: string | undefined,
    pinnedProj: number | undefined,
    registry: RegistryMap
): Record<string, unknown> | undefined {
    if (toolName === 'update_configuration' || DB_WIDE_BACKUP_TOOL_NAMES.has(toolName)) {
        return validationErrResult(`Tool '${toolName}' is not allowed inside a scope-narrowed nested executeCode call.`)
    }
    if (PROJECT_ADMIN_TOOL_NAMES.has(toolName)) {
        const keys =
            toolName === 'get_project'
                ? (['name', 'new_name', 'project_name', 'project', 'id', 'project_number'] as const)
                : (['name', 'new_name', 'project_name', 'project', 'id'] as const)
        for (const nameKey of keys) {
            const rawVal = rec[nameKey]
            const candidate =
                typeof rawVal === 'number' && Number.isFinite(rawVal)
                    ? String(rawVal)
                    : typeof rawVal === 'string'
                      ? rawVal.trim()
                      : ''
            if (candidate === '') continue
            const candidateErr = checkProjectAdminCandidate(candidate, nameKey, effectivePinnedWs, pinnedProj, registry)
            if (candidateErr !== undefined) return candidateErr
        }
        return checkDirectoryBoundsForScope(rec['absolute_path'], 'absolute_path', effectivePinnedWs, pinnedProj, registry, true)
    }
    if (IO_DIR_TOOL_NAMES.has(toolName)) {
        for (const dirKey of ['output_dir', 'source_dir', 'target_dir', 'path', 'filepath', 'dir'] as const) {
            const dirErr = checkDirectoryBoundsForScope(rec[dirKey], dirKey, effectivePinnedWs, pinnedProj, registry, true)
            if (dirErr !== undefined) return dirErr
        }
    }
    return undefined
}

function collectNestedRecursive(
    cur: Record<string, unknown>,
    depth: number,
    maxDepth: number,
    seen: Set<object>,
    out: Record<string, unknown>[]
): void {
    if (depth >= maxDepth || out.length >= MAX_COLLECTED_CONTAINERS || seen.has(cur)) return
    seen.add(cur)
    try {
        for (const key of NESTED_CONTAINER_KEYS) {
            if (out.length >= MAX_COLLECTED_CONTAINERS) break
            const child = cur[key]
            if (!isRecord(child) || seen.has(child)) continue
            out.push(child)
            collectNestedRecursive(child, depth + 1, maxDepth, seen, out)
        }
    } finally {
        seen.delete(cur)
    }
}

/** Collect nested container objects (`entry`, `filters`, `filter`, `metadata`, `context`) for bounds checks. */
export function collectNestedContainerRecords(
    rec: Record<string, unknown>,
    maxDepth = 4
): Record<string, unknown>[] {
    const out: Record<string, unknown>[] = []
    collectNestedRecursive(rec, 0, maxDepth, new Set<object>(), out)
    return out
}
