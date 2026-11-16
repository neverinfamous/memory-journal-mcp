import type { ProjectRegistryEntry, ToolHandlerConfig } from '../types/index.js'
import * as os from 'node:os'
import * as path from 'node:path'
import * as fs from 'node:fs'
import { ValidationError } from '../types/errors.js'
import { logger } from './logger.js'
import { parseConfigObjectContent } from './registry-config-file.js'

/**
 * [BOUNDARY] Project registry loading, alias/keyword matching, and path-based lookups.
 * Re-exported from `workspace-resolver.ts`.
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

interface ParsedConfig {
    projectRegistry?: Record<string, ProjectRegistryEntry>
}

/** Placeholder registry keys that must never be matched as real projects by keyword. */
const SENTINEL_PROJECT_KEYS: readonly string[] = ['default', 'test']

function isTestRunner(): boolean {
    return process.env['NODE_ENV'] === 'test' || process.env['VITEST'] === 'true'
}

function getConfigPath(): string {
    const override = process.env['MEMORY_JOURNAL_CONFIG']
    if (override !== undefined && override !== '') {
        return path.resolve(override)
    }
    return path.resolve(os.homedir(), '.gemini', 'config', 'memory-journal.config.json')
}

export function loadProjectRegistryFromConfig(): Record<string, ProjectRegistryEntry> | undefined {
    if (isTestRunner()) {
        return undefined
    }
    try {
        const configPath = getConfigPath()
        if (!fs.existsSync(configPath)) return undefined
        const content = fs.readFileSync(configPath, 'utf-8')
        const config = parseConfigObjectContent(configPath, content) as ParsedConfig | null
        return typeof config === 'object' && config !== null ? config.projectRegistry : undefined
    } catch (error) {
        logger.debug('Failed to load project registry from config', {
            module: 'workspace-resolver',
            error: error instanceof Error ? error.message : String(error),
        })
        return undefined
    }
}

export const PROJECT_KEYWORD_ALIASES: Record<string, string[]> = {
    'db-mcp': ['sqlite', 'sqlite3', 'sqlite-mcp', 'sqlite_mcp', 'better-sqlite3', 'better_sqlite3', 'db-mcp', 'db_mcp', 'lib-db', 'db-mcp-wasm', 'sqlite_create_view', 'sqlite_query', 'sqlite_exec', 'sqlite_execute_code'],
    'mysql-mcp': ['mysql', 'mysql-mcp', 'mysql_mcp', 'mariadb', 'mysqlsh', 'proxysql', 'mysql-router', 'mysqlrouter', 'innodb'],
    'postgres-mcp': ['postgres', 'postgresql', 'postgres-mcp', 'postgres_mcp', 'pgvector'],
    'memory-journal-mcp': ['memory-journal', 'memory-journal-mcp', 'memory_journal', 'memory_journal_mcp', 'memoryjournal'],
}

function matchKeyCaseInsensitive(
    candidate: string,
    registry: Record<string, RegistryEntry>
): string | undefined {
    const candidateLower = candidate.toLowerCase()
    const keys = Object.keys(registry)
    for (const key of keys) {
        if (key.toLowerCase() === candidateLower) {
            return key
        }
    }
    const candidateSlug = candidateLower.replace(/_/g, '-')
    const slugMatches: string[] = []
    for (const key of keys) {
        if (key.toLowerCase().replace(/_/g, '-') === candidateSlug) {
            slugMatches.push(key)
        }
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

    if (options?.allowKeywordAliases === true) {
        return matchAliasInTable(lower, registry)
    }
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
        const matched =
            matchedAliases.some((a) => tagTokens.has(a)) ||
            contentMatchesAnyAlias(contentLower, matchedAliases)

        if (matched) {
            return {
                workspaceId: key,
                projectNumber: entry.project_number ?? input.project_number,
            }
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

/**
 * True when cwd is the registry root or a directory inside it.
 * A sibling whose name only shares a prefix, such as
 * `memory-journal-mcp.wiki` next to `memory-journal-mcp`, does not match.
 * Windows paths are compared case-insensitively. Other platforms are not.
 */
export function cwdMatchesRegistryPath(registryPath: string, cwd: string): boolean {
    const caseFold = process.platform === 'win32'
    const root = caseFold ? path.resolve(registryPath).toLowerCase() : path.resolve(registryPath)
    const target = caseFold ? path.resolve(cwd).toLowerCase() : path.resolve(cwd)
    const relative = path.relative(root, target)
    if (relative === '') return true
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
        return false
    }
    return true
}

function findBestMatchingPathEntry(
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
        const resolvedLength = path.resolve(entryPath).length
        if (resolvedLength > bestMatchLength) {
            bestMatchLength = resolvedLength
            bestMatch = { workspaceId: key, projectNumber: entry.project_number }
        }
    }
    return bestMatch
}

/**
 * Resolve a project number from the registry entry whose path contains `cwd`.
 * Pass `registryOverride` to resolve against an explicit registry; without it the global
 * config file is read, and that read is skipped under test runners so unit tests stay hermetic.
 */
export function resolveProjectNumberFromPath(
    cwd: string,
    registryOverride?: Record<string, RegistryEntry>
): number | undefined {
    if (registryOverride === undefined && isTestRunner()) {
        return undefined
    }
    try {
        let projectRegistry = registryOverride
        if (projectRegistry === undefined) {
            const configPath = getConfigPath()
            if (!fs.existsSync(configPath)) return undefined
            const content = fs.readFileSync(configPath, 'utf-8')
            const config = parseConfigObjectContent(configPath, content) as ParsedConfig | null
            projectRegistry =
                typeof config === 'object' && config !== null ? config.projectRegistry : undefined
        }
        if (projectRegistry === undefined || projectRegistry === null) return undefined
        return findBestMatchingPathEntry(cwd, projectRegistry)?.projectNumber
    } catch (err) {
        logger.warning(
            `Project auto-resolution from path failed: ${err instanceof Error ? err.message : String(err)}`,
            { module: 'WorkspaceResolver' }
        )
        return undefined
    }
}

/**
 * Resolve workspaceId and projectNumber from a file or directory path by matching
 * against the most specific (longest) registered project path.
 */
export function resolveWorkspaceFromFilePath(
    targetPath: string,
    config?: ToolHandlerConfig
): ResolvedContext | undefined {
    if (targetPath.trim() === '') return undefined
    const registry = config?.projectRegistry ?? loadProjectRegistryFromConfig()
    return registry !== undefined ? findBestMatchingPathEntry(targetPath, registry) : undefined
}
