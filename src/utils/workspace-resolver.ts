import type { ProjectRegistryEntry, ToolHandlerConfig } from '../types/index.js'
import * as os from 'node:os'
import * as path from 'node:path'
import * as fs from 'node:fs'
import { ValidationError } from '../types/errors.js'
import { logger } from './logger.js'

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

/** Placeholder registry keys that must never be matched as real projects by keyword. */
const SENTINEL_PROJECT_KEYS: readonly string[] = ['default', 'test']

let activeSessionWorkspaceId: string | undefined = undefined
let activeSessionProjectNumber: number | undefined = undefined
const runtimeSessionProjects = new WeakMap<
    object,
    { workspaceId?: string; projectNumber?: number }
>()

/**
 * Record the active session workspace and project number (e.g. when a project briefing
 * or agent context resource is read).
 */
export function setActiveSessionProject(
    workspaceId: string | undefined,
    projectNumber?: number | null,
    runtime?: object | null
): void {
    const validWs =
        workspaceId !== undefined && workspaceId !== '' && workspaceId !== '*'
            ? workspaceId
            : undefined
    const clearProject = projectNumber === null
    const validProj =
        typeof projectNumber === 'number' && !Number.isNaN(projectNumber) && projectNumber > 0
            ? projectNumber
            : undefined

    if (runtime !== undefined && runtime !== null) {
        const prev = runtimeSessionProjects.get(runtime)
        runtimeSessionProjects.set(runtime, {
            ...(validWs !== undefined
                ? { workspaceId: validWs }
                : prev?.workspaceId !== undefined
                  ? { workspaceId: prev.workspaceId }
                  : {}),
            ...(validProj !== undefined
                ? { projectNumber: validProj }
                : clearProject
                  ? {}
                  : prev?.projectNumber !== undefined
                    ? { projectNumber: prev.projectNumber }
                    : {}),
        })
    }
    if (validWs !== undefined) activeSessionWorkspaceId = validWs
    if (validProj !== undefined) activeSessionProjectNumber = validProj
    else if (clearProject) activeSessionProjectNumber = undefined
}

export function getActiveSessionProject(
    runtime?: object | null
): { workspaceId?: string; projectNumber?: number } {
    const isTest =
        (process.env['NODE_ENV'] === 'test' || process.env['VITEST'] === 'true') &&
        process.env['VITEST_SESSION_PROJECT'] !== 'true'
    const runtimeEntry =
        runtime !== undefined && runtime !== null ? runtimeSessionProjects.get(runtime) : undefined
    const ws = runtimeEntry?.workspaceId ?? (isTest ? undefined : activeSessionWorkspaceId)
    const proj = runtimeEntry?.projectNumber ?? (isTest ? undefined : activeSessionProjectNumber)
    return {
        ...(ws !== undefined ? { workspaceId: ws } : {}),
        ...(proj !== undefined ? { projectNumber: proj } : {}),
    }
}

export function clearActiveSessionProject(): void {
    activeSessionWorkspaceId = undefined
    activeSessionProjectNumber = undefined
}

function getConfigPath(): string {
    if (process.env['MEMORY_JOURNAL_CONFIG']) {
        return path.resolve(process.env['MEMORY_JOURNAL_CONFIG'])
    }
    return path.resolve(os.homedir(), '.gemini', 'config', 'memory-journal.config.json')
}

export function loadProjectRegistryFromConfig(): Record<string, ProjectRegistryEntry> | undefined {
    if (process.env['NODE_ENV'] === 'test' || process.env['VITEST'] === 'true') {
        return undefined
    }
    try {
        const configPath = getConfigPath()
        if (!fs.existsSync(configPath)) return undefined
        const content = fs.readFileSync(configPath, 'utf-8')
        const config = JSON.parse(content) as ParsedConfig
        return config.projectRegistry
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
    'kv-manager': ['kv-manager', 'kv_manager', 'cloudflare-kv', 'workers-kv'],
    'R2-Manager-Worker': ['r2-manager', 'r2_manager', 'r2-manager-worker', 'r2_manager_worker', 'cloudflare-r2'],
    'd1-manager': ['d1-manager', 'd1_manager', 'cloudflare-d1'],
    'do-manager': ['do-manager', 'do_manager', 'durable-objects', 'durable_objects'],
    'do-manager-admin-hooks': ['do-manager-admin-hooks', 'do_manager_admin_hooks', 'admin-hooks', 'admin_hooks'],
    'adamic': ['adamic'],
    'adamic-blog': ['adamic-blog', 'adamic_blog'],
    'wiki-search-worker': ['wiki-search', 'wiki_search', 'wiki-search-worker', 'wiki_search_worker'],
    'do-test-worker': ['do-test-worker', 'do_test_worker']
}

function matchKeyCaseInsensitive(
    candidate: string,
    registry: Record<string, RegistryEntry>
): string | undefined {
    const candidateLower = candidate.toLowerCase()
    for (const key of Object.keys(registry)) {
        if (key.toLowerCase() === candidateLower) return key
    }
    return undefined
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
    registry?: Record<string, RegistryEntry>
): string | undefined {
    const lower = aliasOrKey.toLowerCase().trim()
    if (!registry) return undefined

    const direct = matchKeyCaseInsensitive(lower, registry)
    if (direct !== undefined) return direct

    return matchAliasInTable(lower, registry)
}

function collectAliasesForKey(key: string): string[] {
    const keyLower = key.toLowerCase()
    const directAliases = PROJECT_KEYWORD_ALIASES[key] ?? []
    let matchedAliases = [keyLower, ...directAliases.map((a) => a.toLowerCase())]
    for (const [canonicalKey, aliases] of Object.entries(PROJECT_KEYWORD_ALIASES)) {
        if (canonicalKey.toLowerCase() === keyLower) {
            matchedAliases = Array.from(new Set([...matchedAliases, ...aliases.map((a) => a.toLowerCase())]))
        }
    }
    return matchedAliases.sort((a, b) => b.length - a.length)
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

function matchRegistryByTagsOrContent(
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

    // Sort registry entries by key length descending to prioritize more specific/composite projects
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

function findWorkspaceByProjectNumber(
    projNum: number,
    registry: Record<string, RegistryEntry> | undefined
): string | undefined {
    if (!registry) return undefined
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
 * Resolves one workspace and that workspace's project number.
 * Priority:
 * 1. Explicit workspace_id, paired with its registry project (never the cwd project)
 * 2. Explicit project_number, paired with its registry workspace
 * 3. Registered process.cwd()
 * 4. Active session workspace
 * 5. Content / tag keywords, only when 1–4 did not resolve a project
 * 6. Configured default
 *
 * [INVARIANT] `*` is omitted so an explicit wildcard stays an admin override.
 * A stored workspace of `default` is concrete. Only an omitted workspace falls through.
 * Write callers must reject `*` before they persist a row.
 */
export function resolveProjectContext(
    input: ResolutionInput,
    config?: ToolHandlerConfig
): ResolvedContext {
    const registry = config?.projectRegistry ?? loadProjectRegistryFromConfig()

    const trimmedWorkspaceId =
        typeof input.workspace_id === 'string' ? input.workspace_id.trim() : undefined
    const sanitizedWorkspaceId =
        trimmedWorkspaceId === undefined ||
        trimmedWorkspaceId === '' ||
        trimmedWorkspaceId === '*'
            ? undefined
            : trimmedWorkspaceId

    const cwdMatch = registry
        ? resolveWorkspaceFromFilePath(process.cwd(), { ...config, projectRegistry: registry })
        : undefined
    const registeredCwd =
        cwdMatch !== undefined && cwdMatch.workspaceId.toLowerCase() !== 'test'
            ? cwdMatch
            : undefined

    // 1. Explicit workspace, including `default`. A conflicting project_number is rejected.
    if (sanitizedWorkspaceId !== undefined) {
        let wsId = sanitizedWorkspaceId
        const canonicalKey = findCanonicalRegistryKey(wsId, registry)
        if (canonicalKey) wsId = canonicalKey
        const registryProject = canonicalKey
            ? registry?.[canonicalKey]?.project_number
            : registry?.[wsId]?.project_number
        if (
            input.project_number !== undefined &&
            input.project_number !== null &&
            registryProject !== undefined &&
            input.project_number !== registryProject
        ) {
            throw new ValidationError(
                `project_number ${String(input.project_number)} does not match workspace '${wsId}', which uses project_number ${String(registryProject)}.`,
                { workspaceId: wsId, projectNumber: input.project_number }
            )
        }
        const projectNumber = registryProject ?? input.project_number ?? undefined
        return { workspaceId: wsId, projectNumber }
    }

    // 2. Explicit project_number. Keywords must not retarget an unregistered number.
    if (input.project_number !== undefined && input.project_number !== null) {
        const wsId = findWorkspaceByProjectNumber(input.project_number, registry)
        if (wsId !== undefined) {
            return { workspaceId: wsId, projectNumber: input.project_number }
        }
        const sessionCtx = getActiveSessionProject(config?.runtime)
        const fallbackWs =
            registeredCwd?.workspaceId ??
            config?.defaultWorkspaceId ??
            sessionCtx.workspaceId ??
            'default'
        return { workspaceId: fallbackWs, projectNumber: input.project_number }
    }

    // 3. Registered cwd, ahead of incidental words in the body.
    if (registeredCwd !== undefined) {
        const cwdProject =
            registeredCwd.projectNumber ??
            (registeredCwd.workspaceId.toLowerCase() === 'default'
                ? undefined
                : config?.defaultProjectNumber)
        return {
            workspaceId: registeredCwd.workspaceId,
            projectNumber: cwdProject,
        }
    }

    // 4. Active session, when the host actually exposes one (tests suppress the global).
    const sessionCtx = getActiveSessionProject(config?.runtime)
    if (
        sessionCtx.workspaceId !== undefined &&
        sessionCtx.workspaceId !== '' &&
        sessionCtx.workspaceId !== '*'
    ) {
        const registryProject = registry?.[sessionCtx.workspaceId]?.project_number
        const sessionProject =
            sessionCtx.projectNumber ??
            registryProject ??
            (sessionCtx.workspaceId.toLowerCase() === 'default'
                ? undefined
                : config?.defaultProjectNumber)
        return { workspaceId: sessionCtx.workspaceId, projectNumber: sessionProject }
    }
    if (sessionCtx.projectNumber !== undefined) {
        const sessionWorkspace = findWorkspaceByProjectNumber(sessionCtx.projectNumber, registry)
        if (sessionWorkspace !== undefined) {
            return { workspaceId: sessionWorkspace, projectNumber: sessionCtx.projectNumber }
        }
        return {
            workspaceId: config?.defaultWorkspaceId ?? 'default',
            projectNumber: sessionCtx.projectNumber,
        }
    }

    // 5. Keywords only when no explicit scope, cwd, or session was available.
    // preferCwdOverKeywords skips this step for CLI callers that already tried cwd.
    if (registry && input.preferCwdOverKeywords !== true) {
        const matched = matchRegistryByTagsOrContent(input, registry)
        if (matched !== undefined) return matched
    }

    return {
        workspaceId: config?.defaultWorkspaceId ?? sessionCtx.workspaceId ?? 'default',
        projectNumber: config?.defaultProjectNumber ?? sessionCtx.projectNumber,
    }
}

/**
 * Resolves the effective workspace ID from available context.
 * Priority: explicit workspace_id > project_number lookup > content/tags lookup > config default > 'default'
 */
export function resolveWorkspaceId(
    explicitWorkspaceId: string | undefined,
    projectNumber: number | undefined,
    config?: ToolHandlerConfig,
    content?: string,
    tags?: string[]
): string {
    if (explicitWorkspaceId === '*') {
        return '*'
    }
    const res = resolveProjectContext(
        {
            workspace_id: explicitWorkspaceId,
            project_number: projectNumber,
            content,
            tags
        },
        config
    )
    return res.workspaceId
}

interface RegistryEntry {
    path?: string;
    project_number?: number;
}

interface ParsedConfig {
    projectRegistry?: Record<string, ProjectRegistryEntry>;
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
        if (entryPath === undefined || entryPath === null || !cwdMatchesRegistryPath(entryPath, targetPath)) {
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
    if (
        registryOverride === undefined &&
        (process.env['NODE_ENV'] === 'test' || process.env['VITEST'] === 'true')
    ) {
        return undefined
    }
    try {
        let projectRegistry = registryOverride
        if (projectRegistry === undefined) {
            const configPath = getConfigPath()
            if (!fs.existsSync(configPath)) return undefined
            const content = fs.readFileSync(configPath, 'utf-8')
            projectRegistry = (JSON.parse(content) as ParsedConfig).projectRegistry
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
    const registry = config?.projectRegistry ?? loadProjectRegistryFromConfig()
    return registry ? findBestMatchingPathEntry(targetPath, registry) : undefined
}
