import type { ToolHandlerConfig } from '../types/index.js'
import * as os from 'node:os'
import * as path from 'node:path'
import * as fs from 'node:fs'
import { logger } from './logger.js'

export interface ResolutionInput {
    workspace_id?: string
    project_number?: number
    content?: string
    tags?: string[]
}

export interface ResolvedContext {
    workspaceId: string
    projectNumber: number | undefined
}

/** Placeholder registry keys that must never be matched as real projects by keyword. */
const SENTINEL_PROJECT_KEYS: readonly string[] = ['default', 'test']

function getConfigPath(): string {
    if (process.env['MEMORY_JOURNAL_CONFIG']) {
        return path.resolve(process.env['MEMORY_JOURNAL_CONFIG'])
    }
    return path.resolve(os.homedir(), '.gemini', 'config', 'memory-journal.config.json')
}

export function loadProjectRegistryFromConfig(): Record<string, RegistryEntry> | undefined {
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

export function findCanonicalRegistryKey(aliasOrKey: string, registry?: Record<string, RegistryEntry>): string | undefined {
    const lower = aliasOrKey.toLowerCase().trim()
    if (!registry) return undefined
    
    // Direct match (case-insensitive)
    for (const key of Object.keys(registry)) {
        if (key.toLowerCase() === lower) return key
    }
    
    // Alias lookup
    for (const [canonicalKey, aliases] of Object.entries(PROJECT_KEYWORD_ALIASES)) {
        if (aliases.map((a) => a.toLowerCase()).includes(lower)) {
            for (const key of Object.keys(registry)) {
                if (key.toLowerCase() === canonicalKey.toLowerCase()) {
                    return key
                }
            }
        }
    }
    
    // Prefix / token alias lookup
    for (const token of lower.split(/[-_:.]+/)) {
        if (token.length >= 3) {
            for (const [canonicalKey, aliases] of Object.entries(PROJECT_KEYWORD_ALIASES)) {
                if (aliases.map((a) => a.toLowerCase()).includes(token)) {
                    for (const key of Object.keys(registry)) {
                        if (key.toLowerCase() === canonicalKey.toLowerCase()) {
                            return key
                        }
                    }
                }
            }
        }
    }
    return undefined
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
    for (const [key, entry] of Object.entries(registry)) {
        if (entry.project_number === projNum) return key
    }
    return undefined
}

/**
 * Resolves full workspace and project context from available inputs.
 * Priority:
 * 1. Explicit non-'default' workspace_id
 * 2. Explicit project_number -> lookup workspace_id in projectRegistry
 * 3. Content / Tags fuzzy matching against projectRegistry keys and names
 * 4. Explicit project_number fallback (when unregistered and no conflicting keywords matched)
 * 5. process.cwd() path matching against projectRegistry or config defaults
 */
export function resolveProjectContext(
    input: ResolutionInput,
    config?: ToolHandlerConfig
): ResolvedContext {
    const registry = config?.projectRegistry ?? loadProjectRegistryFromConfig()

    // Reject internal wildcard sentinel '*' from external input so it falls through to normal resolution
    const sanitizedWorkspaceId =
        input.workspace_id === '*' ? undefined : input.workspace_id

    // 1. Truly explicit non-'default' workspace_id provided
    if (
        sanitizedWorkspaceId !== undefined &&
        sanitizedWorkspaceId !== null &&
        sanitizedWorkspaceId !== 'default'
    ) {
        let wsId = sanitizedWorkspaceId
        const canonicalKey = findCanonicalRegistryKey(wsId, registry)
        if (canonicalKey) wsId = canonicalKey
        let projNum =
            input.project_number ??
            (canonicalKey ? registry?.[canonicalKey]?.project_number : registry?.[wsId]?.project_number)
        projNum ??= resolveProjectNumberFromPath(process.cwd(), registry) ?? config?.defaultProjectNumber
        return {
            workspaceId: wsId,
            projectNumber: projNum,
        }
    }

    // 2. Explicit project_number provided -> lookup matching workspace_id in projectRegistry
    if (input.project_number !== undefined && input.project_number !== null) {
        const wsId = findWorkspaceByProjectNumber(input.project_number, registry)
        if (wsId !== undefined) {
            return {
                workspaceId: wsId,
                projectNumber: input.project_number,
            }
        }
    }

    // 3. Content / Tags keyword matching against projectRegistry
    if (registry) {
        const matched = matchRegistryByTagsOrContent(input, registry)
        if (matched !== undefined) return matched
    }

    // 4. Explicit input.project_number fallback (when no conflicting registry workspace matched)
    if (input.project_number !== undefined && input.project_number !== null) {
        const wsId = findWorkspaceByProjectNumber(input.project_number, registry) ?? sanitizedWorkspaceId
        return {
            workspaceId: wsId ?? config?.defaultWorkspaceId ?? 'default',
            projectNumber: input.project_number,
        }
    }

    // 5. CWD / Config Fallback
    const cwdProjNum =
        resolveProjectNumberFromPath(process.cwd(), registry) ?? config?.defaultProjectNumber
    let resolvedWsId = sanitizedWorkspaceId
    if ((resolvedWsId === undefined || resolvedWsId === 'default') && cwdProjNum !== undefined) {
        resolvedWsId = findWorkspaceByProjectNumber(cwdProjNum, registry) ?? resolvedWsId
    }

    return {
        workspaceId: resolvedWsId ?? config?.defaultWorkspaceId ?? 'default',
        projectNumber: cwdProjNum,
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
    projectRegistry?: Record<string, RegistryEntry>;
}

/**
 * Automatically resolves a project number by inspecting the global config
 * and matching the provided working directory against registered paths.
 */
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

        // Find the most specific (longest) matching path
        let bestMatchLength = -1
        let bestProjectNumber: number | undefined = undefined

        for (const [, entry] of Object.entries(projectRegistry)) {
            const entryPath = entry.path
            if (entryPath === undefined || entryPath === null) continue
            if (!cwdMatchesRegistryPath(entryPath, cwd)) continue

            const resolvedLength = path.resolve(entryPath).length
            if (resolvedLength > bestMatchLength) {
                bestMatchLength = resolvedLength
                bestProjectNumber = entry.project_number
            }
        }
        
        return bestProjectNumber
    } catch (err) {
        logger.warning(
            `Project auto-resolution from path failed: ${err instanceof Error ? err.message : String(err)}`,
            { module: 'WorkspaceResolver' }
        )
        return undefined
    }
}
