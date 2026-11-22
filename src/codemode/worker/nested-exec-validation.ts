/**
 * Nested Code Mode `executeCode` scope validation helpers.
 * Worker-thread safe (no host DB, config-file, or external npm imports).
 */

import type { ProjectRegistryEntry } from '../../types/index.js'
import { readProjectRegistryPayload } from '../normalizers/generic-field-aliases.js'
import { parseStringContextPayload } from '../shared-context-parsers.js'

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

const NESTED_SCOPE_KEYS = ['metadata', 'context', 'params', 'entry', 'payload', 'input'] as const
const NESTED_WS_ALIAS_KEYS = [
    'workspace_id',
    'workspaceId',
    'workspace',
    'target_workspace_id',
    'targetWorkspaceId',
    'project_name',
    'projectName',
] as const
const NESTED_REPO_ALIAS_KEYS = ['repo', 'repo_name', 'repoName', 'repository'] as const
const NESTED_PROJ_ALIAS_KEYS = ['project_number', 'projectNumber', 'project_id', 'projectId', 'project'] as const
const NESTED_PROJ_NUM_RE = /^(?:#|p-)?([1-9]\d*)$/i
const NESTED_PROJ_DIGITS_RE = /^(?:#|p-)?\d+$/i
const NESTED_PATH_SPLIT_RE = /[/\\]/

function collectNestedScopeRecords(argRec: Record<string, unknown>): Record<string, unknown>[] {
    const records: Record<string, unknown>[] = [argRec]
    for (const key of NESTED_SCOPE_KEYS) {
        const nested = argRec[key]
        if (isPlainRecord(nested)) {
            records.push(nested)
        } else if (key === 'context' && typeof nested === 'string') {
            const parsed = parseStringContextPayload(nested)
            if (isPlainRecord(parsed)) records.push(parsed)
        }
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
        const numMatch = NESTED_PROJ_NUM_RE.exec(trimmed)
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
    return trimmed !== '' && !NESTED_PROJ_DIGITS_RE.test(trimmed)
}

function validateWorkspaceAliases(
    records: Record<string, unknown>[],
    pinnedWorkspace: string,
    canonPinned: string,
    registry: Record<string, ProjectRegistryEntry> | undefined
): { error: string } | null {
    for (const rec of records) {
        for (const key of NESTED_WS_ALIAS_KEYS) {
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

function extractPinnedGitHubOwner(pinnedWorkspace: string, canonPinned: string): string | undefined {
    const candidate = canonPinned.includes('/') ? canonPinned : pinnedWorkspace.includes('/') ? pinnedWorkspace : undefined
    if (candidate === undefined) return undefined
    const parts = candidate.split('/').filter(Boolean)
    return parts.length >= 2 ? parts[0] : undefined
}

function validateRepoAliases(
    records: Record<string, unknown>[],
    pinnedWorkspace: string,
    canonPinned: string,
    registry: Record<string, ProjectRegistryEntry> | undefined
): { error: string } | null {
    const pinnedOwner = extractPinnedGitHubOwner(pinnedWorkspace, canonPinned)
    for (const rec of records) {
        const rawOwner = rec['owner']
        if (typeof rawOwner === 'string' && rawOwner.trim() !== '' && pinnedOwner !== undefined) {
            if (rawOwner.trim().toLowerCase() !== pinnedOwner.toLowerCase()) {
                return { error: `GitHub owner '${rawOwner.trim()}' conflicts with pinned session workspace '${pinnedWorkspace}'` }
            }
        }
        for (const key of NESTED_REPO_ALIAS_KEYS) {
            const rawRepo = rec[key]
            if (typeof rawRepo !== 'string' || rawRepo.trim() === '') continue
            const trimmedRepo = rawRepo.trim()
            const slashParts = trimmedRepo.split(NESTED_PATH_SPLIT_RE).filter(Boolean)
            if (pinnedOwner !== undefined && slashParts.length >= 2 && slashParts[0]?.toLowerCase() !== pinnedOwner.toLowerCase()) {
                return { error: `Repository '${trimmedRepo}' conflicts with pinned session workspace '${pinnedWorkspace}'` }
            }
            const repoSlug = slashParts.pop() ?? trimmedRepo
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

function hasRegistryProjectOwnerConflict(
    parsedProj: number,
    pinnedWorkspace: string | undefined,
    pinnedProjectNumber: number | undefined,
    canonPinnedLower: string | undefined,
    registry: Record<string, ProjectRegistryEntry> | undefined
): string | null {
    if (pinnedProjectNumber !== undefined && parsedProj !== pinnedProjectNumber) {
        return `project_number ${String(parsedProj)} conflicts with pinned session project_number ${String(pinnedProjectNumber)}`
    }
    if (pinnedWorkspace?.toLowerCase() === 'default') {
        const defaultRegProj = registry?.['default']?.project_number
        if (parsedProj !== pinnedProjectNumber && parsedProj !== defaultRegProj) {
            return `project_number ${String(parsedProj)} conflicts with pinned session workspace '${pinnedWorkspace}'`
        }
        return null
    }
    if (pinnedWorkspace === undefined || registry === undefined || canonPinnedLower === undefined) {
        return null
    }
    let hasOwner = false
    for (const [ownerKey, entry] of Object.entries(registry)) {
        if (
            ownerKey.toLowerCase() === canonPinnedLower &&
            entry.project_number !== undefined &&
            entry.project_number !== parsedProj
        ) {
            return `project_number ${String(parsedProj)} conflicts with pinned session workspace '${pinnedWorkspace}'`
        }
        if (entry.project_number !== parsedProj) continue
        hasOwner = true
        if (ownerKey.toLowerCase() === canonPinnedLower) return null
    }
    return hasOwner
        ? `project_number ${String(parsedProj)} conflicts with pinned session workspace '${pinnedWorkspace}'`
        : null
}

function formatInvalidProjectCandidate(rawProj: unknown): string {
    if (
        typeof rawProj === 'bigint' ||
        typeof rawProj === 'string' ||
        typeof rawProj === 'number' ||
        typeof rawProj === 'boolean'
    ) {
        return String(rawProj)
    }
    try {
        return JSON.stringify(rawProj) ?? 'invalid'
    } catch {
        return typeof rawProj
    }
}

function validateProjectNumberAliases(
    records: Record<string, unknown>[],
    pinnedWorkspace: string | undefined,
    pinnedProjectNumber: number | undefined,
    canonPinned: string | undefined,
    registry: Record<string, ProjectRegistryEntry> | undefined
): { error: string } | null {
    const canonPinnedLower = canonPinned?.toLowerCase()
    for (const rec of records) {
        for (const key of NESTED_PROJ_ALIAS_KEYS) {
            const rawProj = rec[key]
            if (rawProj === undefined || rawProj === null || rawProj === '') continue
            if (key === 'project' && isProjectStringValue(rawProj)) continue
            const parsedProj = parseProjectNumberCandidate(rawProj, registry)
            if (parsedProj === null) {
                return { error: `Invalid project_number '${formatInvalidProjectCandidate(rawProj)}' in nested executeCode` }
            }
            const conflict = hasRegistryProjectOwnerConflict(
                parsedProj,
                pinnedWorkspace,
                pinnedProjectNumber,
                canonPinnedLower,
                registry
            )
            if (conflict !== null) return { error: conflict }
        }
    }
    return null
}

function validateUnpinnedScopeAliases(
    records: Record<string, unknown>[],
    registry: Record<string, ProjectRegistryEntry> | undefined
): { error?: string; inferredWorkspace?: string } {
    let resolvedWs: string | undefined
    for (const rec of records) {
        const candidates: string[] = []
        for (const key of NESTED_WS_ALIAS_KEYS) {
            const raw = rec[key]
            if (typeof raw === 'string' && raw.trim() !== '' && raw.trim() !== '*') {
                candidates.push(raw.trim())
            }
        }
        if (isProjectStringValue(rec['project']) && rec['project'].trim() !== '*') {
            candidates.push(rec['project'].trim())
        }
        for (const candidate of candidates) {
            const canon = findRegistryKey(candidate, registry) ?? candidate
            if (resolvedWs !== undefined && canon.toLowerCase() !== resolvedWs.toLowerCase()) {
                return { error: `Workspace '${candidate}' conflicts with nested workspace '${resolvedWs}'` }
            }
            resolvedWs = canon
        }
        for (const key of NESTED_REPO_ALIAS_KEYS) {
            const rawRepo = rec[key]
            if (typeof rawRepo !== 'string' || rawRepo.trim() === '') continue
            const trimmedRepo = rawRepo.trim()
            const repoSlug = trimmedRepo.split(NESTED_PATH_SPLIT_RE).filter(Boolean).pop() ?? trimmedRepo
            const matchedRepoKey =
                findRegistryKey(trimmedRepo, registry) ?? findRegistryKey(repoSlug, registry)
            if (matchedRepoKey === undefined) {
                return { error: `Repository '${trimmedRepo}' is not registered in projectRegistry` }
            }
            if (resolvedWs !== undefined && matchedRepoKey.toLowerCase() !== resolvedWs.toLowerCase()) {
                return { error: `Repository '${trimmedRepo}' conflicts with workspace '${resolvedWs}'` }
            }
            resolvedWs = matchedRepoKey
        }
    }
    return resolvedWs !== undefined ? { inferredWorkspace: resolvedWs } : {}
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

    let effectiveWs = pinnedWorkspace
    let effectiveCanon = canonPinned
    if (pinnedWorkspace !== undefined && canonPinned !== undefined) {
        const wsErr = validateWorkspaceAliases(records, pinnedWorkspace, canonPinned, registry)
        if (wsErr !== null) return wsErr
        const repoErr = validateRepoAliases(records, pinnedWorkspace, canonPinned, registry)
        if (repoErr !== null) return repoErr
    } else {
        const unpinned = validateUnpinnedScopeAliases(records, registry)
        if (unpinned.error !== undefined) return { error: unpinned.error }
        if (unpinned.inferredWorkspace !== undefined) {
            effectiveWs = unpinned.inferredWorkspace
            effectiveCanon = findRegistryKey(unpinned.inferredWorkspace, registry) ?? unpinned.inferredWorkspace
        }
        if (
            pinnedProjectNumber !== undefined &&
            effectiveWs !== undefined &&
            effectiveCanon !== undefined &&
            effectiveCanon !== '*'
        ) {
            const regProj = registry?.[effectiveCanon]?.project_number
            if (regProj !== undefined && regProj !== pinnedProjectNumber) {
                return {
                    error: `Workspace '${effectiveWs}' (project_number ${String(regProj)}) conflicts with pinned session project_number ${String(pinnedProjectNumber)}`,
                }
            }
            const conflict = hasRegistryProjectOwnerConflict(
                pinnedProjectNumber,
                effectiveWs,
                undefined,
                effectiveCanon.toLowerCase(),
                registry
            )
            if (conflict !== null) return { error: conflict }
        }
    }

    return validateProjectNumberAliases(
        records,
        effectiveWs,
        pinnedProjectNumber,
        effectiveCanon,
        registry
    )
}

export function readNarrowedWorkspace(
    sources: Record<string, unknown>[],
    registry: Record<string, ProjectRegistryEntry> | undefined
): string | undefined {
    for (const src of sources) {
        for (const key of ['workspace_id', 'workspaceId', 'workspace'] as const) {
            const raw = src[key]
            if (typeof raw === 'string' && raw.trim() !== '' && raw.trim() !== '*') {
                return findRegistryKey(raw.trim(), registry) ?? raw.trim()
            }
        }
        for (const key of ['repo', 'repo_name', 'repoName', 'repository'] as const) {
            const raw = src[key]
            if (typeof raw !== 'string' || raw.trim() === '') continue
            const trimmed = raw.trim()
            const slug = trimmed.split(/[/\\]/).filter(Boolean).pop() ?? trimmed
            const matched = findRegistryKey(trimmed, registry) ?? findRegistryKey(slug, registry)
            if (matched !== undefined) return matched
        }
    }
    return undefined
}

export function uniqueWorkspaceForProjectNum(
    projectNum: number,
    registry: Record<string, ProjectRegistryEntry> | undefined
): string | undefined {
    if (registry === undefined) return undefined
    let matched: string | undefined
    for (const [key, entry] of Object.entries(registry)) {
        if (entry.project_number !== projectNum) continue
        if (matched !== undefined) return undefined
        matched = key
    }
    return matched
}
