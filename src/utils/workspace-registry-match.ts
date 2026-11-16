import * as path from 'node:path'
import type { ProjectRegistryEntry } from '../types/index.js'
import { ValidationError } from '../types/errors.js'

/**
 * [BOUNDARY] Pure in-memory project registry matching and scope pairing.
 * Must remain free of filesystem, config-loader, `yaml`, and `zod` imports so
 * Code Mode workers (`dist/worker-script.js`) bundle zero external dependencies.
 */

export interface ResolutionInput {
    workspace_id?: string
    project_number?: number
    content?: string
    tags?: string[]
    preferCwdOverKeywords?: boolean
}

export interface ResolvedContext {
    workspaceId: string
    projectNumber: number | undefined
}

export interface RegistryEntry {
    path?: string
    project_number?: number
}

export type ProjectRegistry = Record<string, Pick<ProjectRegistryEntry, 'project_number'>>

/** Placeholder registry keys that must never be matched as real projects by keyword. */
const SENTINEL_PROJECT_KEYS: readonly string[] = ['default', 'test']

export const PROJECT_KEYWORD_ALIASES: Record<string, string[]> = {
    'db-mcp': [
        'sqlite',
        'sqlite3',
        'sqlite-mcp',
        'sqlite_mcp',
        'better-sqlite3',
        'better_sqlite3',
        'db-mcp',
        'db_mcp',
        'lib-db',
        'db-mcp-wasm',
        'sqlite_create_view',
        'sqlite_query',
        'sqlite_exec',
        'sqlite_execute_code',
    ],
    'mysql-mcp': [
        'mysql',
        'mysql-mcp',
        'mysql_mcp',
        'mariadb',
        'mysqlsh',
        'proxysql',
        'mysql-router',
        'mysqlrouter',
        'innodb',
    ],
    'postgres-mcp': ['postgres', 'postgresql', 'postgres-mcp', 'postgres_mcp', 'pgvector'],
    'memory-journal-mcp': [
        'memory-journal',
        'memory-journal-mcp',
        'memory_journal',
        'memory_journal_mcp',
        'memoryjournal',
    ],
}

function matchKeyCaseInsensitive(
    candidate: string,
    registry: Record<string, RegistryEntry>
): string | undefined {
    const candidateLower = candidate.toLowerCase()
    const keys = Object.keys(registry)
    for (const key of keys) {
        if (key.toLowerCase() === candidateLower) return key
    }
    const candidateSlug = candidateLower.replace(/_/g, '-')
    const slugMatches: string[] = []
    for (const key of keys) {
        if (key.toLowerCase().replace(/_/g, '-') === candidateSlug) slugMatches.push(key)
    }
    return slugMatches.length === 1 ? slugMatches[0] : undefined
}

function matchAliasInTable(
    tokenLower: string,
    registry: Record<string, RegistryEntry>
): string | undefined {
    for (const [canonicalKey, aliases] of Object.entries(PROJECT_KEYWORD_ALIASES)) {
        if (aliases.some((a) => a.toLowerCase() === tokenLower)) {
            const matched = matchKeyCaseInsensitive(canonicalKey, registry)
            if (matched !== undefined) return matched
        }
    }
    return undefined
}

export function findCanonicalRegistryKey(
    aliasOrKey: string,
    registry?: Record<string, RegistryEntry>,
    options?: { allowKeywordAliases?: boolean }
): string | undefined {
    const lower = aliasOrKey.toLowerCase().trim()
    if (registry === undefined || lower === '') return undefined
    const direct = matchKeyCaseInsensitive(lower, registry)
    if (direct !== undefined) return direct
    if (options?.allowKeywordAliases === true) return matchAliasInTable(lower, registry)
    return undefined
}

function collectAliasesForKey(key: string): string[] {
    const keyLower = key.toLowerCase()
    const derived = [keyLower, keyLower.replace(/_/g, '-'), keyLower.replace(/-/g, '_')]
    for (const suffix of ['-worker', '_worker']) {
        if (keyLower.endsWith(suffix) && keyLower.length > suffix.length) {
            const stem = keyLower.slice(0, -suffix.length)
            derived.push(stem, stem.replace(/_/g, '-'), stem.replace(/-/g, '_'))
        }
    }
    const directAliases = PROJECT_KEYWORD_ALIASES[key] ?? []
    const matchedAliases = new Set<string>([
        ...derived,
        ...directAliases.map((a) => a.toLowerCase()),
    ])
    for (const [canonicalKey, aliases] of Object.entries(PROJECT_KEYWORD_ALIASES)) {
        if (canonicalKey.toLowerCase() === keyLower) {
            for (const alias of aliases) matchedAliases.add(alias.toLowerCase())
        }
    }
    return Array.from(matchedAliases).sort((a, b) => b.length - a.length)
}

function contentMatchesAnyAlias(contentLower: string, sortedAliases: readonly string[]): boolean {
    if (contentLower.length === 0) return false
    for (const alias of sortedAliases) {
        if (alias.length < 2) continue
        const escapedAlias = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        const postBoundary = alias.includes('_') ? '(?:$|[^a-zA-Z0-9_-])' : '(?:$|[^a-zA-Z0-9-])'
        const preBoundary = alias.includes('_') ? '(?:^|[^a-zA-Z0-9_-])' : '(?:^|[^a-zA-Z0-9-])'
        const regex = new RegExp(`${preBoundary}${escapedAlias}${postBoundary}`, 'i')
        if (regex.test(contentLower)) return true
    }
    return false
}

export function matchRegistryByTagsOrContent(
    input: ResolutionInput,
    registry: Record<string, RegistryEntry>
): ResolvedContext | undefined {
    const tagSet = new Set((input.tags ?? []).map((t) => t.toLowerCase().trim()))
    const tagTokens = new Set<string>()
    for (const tag of tagSet) {
        tagTokens.add(tag)
        for (const part of tag.split(/[-_:.]+/)) {
            if (part.length >= 2) tagTokens.add(part)
        }
    }
    const contentLower = (input.content ?? '').toLowerCase()

    // [INTENT] Longest keys first so composite projects win over their prefixes.
    const sortedEntries = Object.entries(registry)
        .filter(([k]) => !SENTINEL_PROJECT_KEYS.includes(k.toLowerCase()))
        .sort(([a], [b]) => b.length - a.length)

    for (const [key, entry] of sortedEntries) {
        const matchedAliases = collectAliasesForKey(key)
        if (
            matchedAliases.some((a) => tagTokens.has(a)) ||
            contentMatchesAnyAlias(contentLower, matchedAliases)
        ) {
            return { workspaceId: key, projectNumber: entry.project_number ?? input.project_number }
        }
    }
    return undefined
}

export function findWorkspaceByProjectNumber(
    projNum: number,
    registry: Record<string, RegistryEntry> | undefined
): string | undefined {
    if (registry === undefined) return undefined
    const matches: string[] = []
    for (const [key, entry] of Object.entries(registry)) {
        if (entry.project_number === projNum) matches.push(key)
    }
    if (matches.length > 1) {
        throw new ValidationError(
            `project_number ${String(projNum)} is registered to more than one workspace.`,
            { projectNumber: projNum }
        )
    }
    return matches[0]
}

const WIN_DRIVE_PATH_RE = /^[a-zA-Z]:[\\/]/

/**
 * True when cwd is the registry root or a directory inside it.
 * Uses `path.win32` + case-folding whenever either path has Windows drive syntax,
 * and case-folds on Windows hosts.
 */
export function cwdMatchesRegistryPath(registryPath: string, cwd: string): boolean {
    const regIsWinDrive = WIN_DRIVE_PATH_RE.test(registryPath)
    const cwdIsWinDrive = WIN_DRIVE_PATH_RE.test(cwd)
    if (
        regIsWinDrive !== cwdIsWinDrive &&
        process.platform !== 'win32' &&
        (regIsWinDrive ? cwd.startsWith('/') : registryPath.startsWith('/'))
    ) {
        return false
    }
    const isWinSyntax = regIsWinDrive || cwdIsWinDrive
    const pathMod = isWinSyntax ? path.win32 : path
    const caseFold = isWinSyntax || process.platform === 'win32'
    const rawRoot = isWinSyntax ? registryPath.replace(/\//g, '\\') : registryPath
    const rawTarget = isWinSyntax ? cwd.replace(/\//g, '\\') : cwd
    const root = caseFold ? pathMod.resolve(rawRoot).toLowerCase() : pathMod.resolve(rawRoot)
    const target = caseFold ? pathMod.resolve(rawTarget).toLowerCase() : pathMod.resolve(rawTarget)
    const relative = pathMod.relative(root, target)
    if (relative === '') return true
    return !(
        relative === '..' ||
        relative.startsWith(`..${pathMod.sep}`) ||
        pathMod.isAbsolute(relative)
    )
}

export function findBestMatchingPathEntry(
    targetPath: string,
    registry: Record<string, RegistryEntry>
): ResolvedContext | undefined {
    let bestMatchLength = -1
    let bestMatch: ResolvedContext | undefined = undefined
    for (const [key, entry] of Object.entries(registry)) {
        const entryPath = entry.path
        // [INVARIANT] An empty path would `path.resolve('')` to process.cwd() and match everything.
        if (
            entryPath === undefined ||
            entryPath === null ||
            entryPath.trim() === '' ||
            !cwdMatchesRegistryPath(entryPath, targetPath)
        ) {
            continue
        }
        const isWinSyntax = WIN_DRIVE_PATH_RE.test(entryPath)
        const pathMod = isWinSyntax ? path.win32 : path
        const normalized = isWinSyntax ? entryPath.replace(/\//g, '\\') : entryPath
        const resolvedLength = pathMod.resolve(normalized).length
        if (resolvedLength > bestMatchLength) {
            bestMatchLength = resolvedLength
            bestMatch = { workspaceId: key, projectNumber: entry.project_number }
        }
    }
    return bestMatch
}

/** A named registry workspace. `*`, `default`, and blanks are not registry keys. */
export function concreteWorkspace(workspaceId: string | undefined): string | undefined {
    if (workspaceId === undefined) return undefined
    const trimmed = workspaceId.trim()
    if (trimmed === '' || trimmed === '*' || trimmed.toLowerCase() === 'default') return undefined
    return trimmed
}

function persistedWorkspace(workspaceId: string | undefined): string | undefined {
    if (workspaceId === undefined) return undefined
    const trimmed = workspaceId.trim()
    if (trimmed === '' || trimmed === '*') return undefined
    return trimmed
}

export function exactRegistryKey(
    workspaceId: string,
    registry: ProjectRegistry | undefined
): string | undefined {
    if (registry === undefined) return undefined
    const lower = workspaceId.toLowerCase()
    for (const key of Object.keys(registry)) {
        if (key.toLowerCase() === lower) return key
    }
    const slug = lower.replace(/_/g, '-')
    const slugMatches = Object.keys(registry).filter(
        (key) => key.toLowerCase().replace(/_/g, '-') === slug
    )
    return slugMatches.length === 1 ? slugMatches[0] : undefined
}

export function workspacesForProject(
    projectNumber: number,
    registry: ProjectRegistry | undefined
): string[] {
    if (registry === undefined) return []
    const matches: string[] = []
    for (const [key, entry] of Object.entries(registry)) {
        if (entry.project_number === projectNumber) matches.push(key)
    }
    return matches
}

export function uniqueWorkspaceForProject(
    projectNumber: number,
    registry: ProjectRegistry | undefined
): string | undefined {
    const matches = workspacesForProject(projectNumber, registry)
    return matches.length === 1 ? matches[0] : undefined
}

export function workspaceForProject(
    projectNumber: number,
    registry: ProjectRegistry | undefined
): string | undefined {
    const matches = workspacesForProject(projectNumber, registry)
    if (matches.length > 1) {
        throw new ValidationError(
            `project_number ${String(projectNumber)} is registered to more than one workspace.`,
            { projectNumber }
        )
    }
    return matches[0]
}

function suppliedProject(projectNumber: number | null | undefined): number | undefined {
    if (typeof projectNumber !== 'number' || Number.isNaN(projectNumber)) return undefined
    return projectNumber
}

export function pairStoredScope(
    workspaceId: string | undefined,
    projectNumber: number | null | undefined,
    registry: ProjectRegistry | undefined
): { workspaceId: string | undefined; projectNumber: number | null | undefined } {
    const concrete = persistedWorkspace(workspaceId)
    const key = concrete !== undefined ? exactRegistryKey(concrete, registry) : undefined
    const registryProject = key !== undefined ? registry?.[key]?.project_number : undefined
    const supplied = suppliedProject(projectNumber)
    const owner = supplied !== undefined ? workspaceForProject(supplied, registry) : undefined

    if (concrete !== undefined && owner !== undefined && key?.toLowerCase() !== owner.toLowerCase()) {
        throw new ValidationError(
            `project_number ${String(supplied)} belongs to workspace '${owner}', not '${concrete}'.`,
            { workspaceId: concrete, projectNumber: supplied }
        )
    }
    if (
        key !== undefined &&
        registryProject !== undefined &&
        supplied !== undefined &&
        supplied !== registryProject
    ) {
        throw new ValidationError(
            `workspace '${key}' uses project_number ${String(registryProject)}, not ${String(supplied)}.`,
            { workspaceId: key, projectNumber: supplied }
        )
    }

    const pairedProject = supplied ?? registryProject
    const trimmedWs = workspaceId !== undefined ? workspaceId.trim() : undefined
    return {
        workspaceId: key ?? trimmedWs,
        projectNumber: pairedProject ?? projectNumber,
    }
}

export function alignedProjectFilter(
    workspaceId: string,
    requested: number | undefined,
    registry: ProjectRegistry | undefined
): number | undefined {
    if (requested === undefined) return undefined
    const trimmed = workspaceId.trim()
    if (trimmed === '' || trimmed === '*') return requested
    const paired = pairStoredScope(trimmed, requested, registry)
    return typeof paired.projectNumber === 'number' ? paired.projectNumber : requested
}
