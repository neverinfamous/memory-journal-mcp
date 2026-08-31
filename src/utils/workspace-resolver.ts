import type { ToolHandlerConfig } from '../types/index.js'
import * as os from 'node:os'
import * as path from 'node:path'
import * as fs from 'node:fs'

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
    } catch {
        return undefined
    }
}

export const PROJECT_KEYWORD_ALIASES: Record<string, string[]> = {
    'db-mcp': ['sqlite', 'sqlite3', 'sqlite-mcp', 'sqlite_mcp', 'better-sqlite3', 'better_sqlite3', 'db-mcp', 'db_mcp', 'lib-db', 'db-mcp-wasm'],
    'mysql-mcp': ['mysql', 'mysql-mcp', 'mysql_mcp', 'mariadb', 'mysqlsh', 'proxysql', 'mysql-router', 'mysqlrouter', 'innodb'],
    'postgres-mcp': ['postgres', 'postgresql', 'postgres-mcp', 'postgres_mcp', 'pg', 'psql', 'pgvector'],
    'memory-journal-mcp': ['memory-journal', 'memory-journal-mcp', 'memory_journal', 'memory_journal_mcp', 'memoryjournal', 'journal', 'mj'],
    'kv-manager': ['kv', 'kv-manager', 'kv_manager', 'cloudflare-kv', 'workers-kv'],
    'R2-Manager-Worker': ['r2', 'r2-manager', 'r2_manager', 'r2-manager-worker', 'r2_manager_worker', 'cloudflare-r2'],
    'd1-manager': ['d1', 'd1-manager', 'd1_manager', 'cloudflare-d1'],
    'do-manager': ['do', 'do-manager', 'do_manager', 'durable-object', 'durable-objects', 'durable_object', 'durable_objects'],
    'do-manager-admin-hooks': ['do-manager-admin-hooks', 'do_manager_admin_hooks', 'admin-hooks', 'admin_hooks'],
    'adamic': ['adamic'],
    'adamic-blog': ['adamic-blog', 'adamic_blog', 'blog'],
    'wiki-search-worker': ['wiki', 'wiki-search', 'wiki_search', 'wiki-search-worker', 'wiki_search_worker'],
    'do-test-worker': ['do-test-worker', 'do_test_worker']
}

function findCanonicalRegistryKey(aliasOrKey: string, registry?: Record<string, RegistryEntry>): string | undefined {
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
    return undefined
}

/**
 * Resolves full workspace and project context from available inputs.
 * Priority:
 * 1. Explicit workspace_id (if not 'default') and explicit project_number
 * 2. Explicit project_number -> lookup workspace_id in projectRegistry
 * 3. Explicit workspace_id -> lookup project_number in projectRegistry
 * 4. Content / Tags fuzzy matching against projectRegistry keys and names
 * 5. process.cwd() path matching against projectRegistry
 * 6. Config defaults or fallback 'default'
 */
export function resolveProjectContext(
    input: ResolutionInput,
    config?: ToolHandlerConfig
): ResolvedContext {
    const registry = config?.projectRegistry ?? loadProjectRegistryFromConfig()

    // 1. Truly explicit non-default workspace_id provided
    if (
        input.workspace_id !== undefined &&
        input.workspace_id !== null &&
        input.workspace_id !== 'default'
    ) {
        let wsId = input.workspace_id
        const canonicalKey = findCanonicalRegistryKey(wsId, registry)
        if (canonicalKey) {
            wsId = canonicalKey
        }
        let projNum = input.project_number ?? (canonicalKey ? registry?.[canonicalKey]?.project_number : registry?.[wsId]?.project_number)
        projNum ??= resolveProjectNumberFromPath(process.cwd())
        return {
            workspaceId: wsId,
            projectNumber: projNum
        }
    }

    // 2. Explicit project_number provided -> lookup matching workspace_id in projectRegistry
    if (input.project_number !== undefined && input.project_number !== null) {
        const projNum = input.project_number
        let wsId: string | undefined
        if (registry) {
            for (const [key, entry] of Object.entries(registry)) {
                if (entry.project_number === projNum) {
                    wsId = key
                    break
                }
            }
        }
        if (wsId) {
            return {
                workspaceId: wsId,
                projectNumber: projNum
            }
        }
    }

    // 3. Content / Tags keyword matching against projectRegistry
    if (registry) {
        const tagSet = new Set((input.tags ?? []).map((t) => t.toLowerCase().trim()))
        const contentLower = (input.content ?? '').toLowerCase()

        for (const [key, entry] of Object.entries(registry)) {
            const keyLower = key.toLowerCase()
            if (['default', 'test'].includes(keyLower)) continue

            // Collect all aliases for this registry key
            const directAliases = PROJECT_KEYWORD_ALIASES[key] ?? []
            let matchedAliases = [keyLower, ...directAliases.map((a) => a.toLowerCase())]
            for (const [canonicalKey, aliases] of Object.entries(PROJECT_KEYWORD_ALIASES)) {
                if (canonicalKey.toLowerCase() === keyLower) {
                    matchedAliases = Array.from(new Set([...matchedAliases, ...aliases.map((a) => a.toLowerCase())]))
                }
            }

            // Check if any tag matches
            let matched = matchedAliases.some((a) => tagSet.has(a))

            // Check if content matches any alias or key
            if (!matched && contentLower.length > 0) {
                for (const alias of matchedAliases) {
                    if (alias.length >= 2) {
                        const escapedAlias = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
                        const regex = new RegExp(`(?:^|[^a-zA-Z0-9_-])${escapedAlias}(?:$|[^a-zA-Z0-9_-])`, 'i')
                        if (regex.test(contentLower)) {
                            matched = true
                            break
                        }
                    }
                }
            }

            if (matched) {
                // Matched registered workspace entry takes precedence for projectNumber
                return {
                    workspaceId: key,
                    projectNumber: entry.project_number ?? input.project_number
                }
            }
        }
    }

    // 4. Explicit input.project_number fallback (when no conflicting registry workspace matched)
    if (input.project_number !== undefined && input.project_number !== null) {
        let wsId = input.workspace_id
        if ((!wsId || wsId === 'default') && registry) {
            for (const [key, entry] of Object.entries(registry)) {
                if (entry.project_number === input.project_number) {
                    wsId = key
                    break
                }
            }
        }
        return {
            workspaceId: wsId ?? config?.defaultWorkspaceId ?? 'default',
            projectNumber: input.project_number
        }
    }

    // 5. CWD / Config Fallback
    const cwdProjNum = resolveProjectNumberFromPath(process.cwd())
    let resolvedWsId = input.workspace_id
    if ((!resolvedWsId || resolvedWsId === 'default') && cwdProjNum !== undefined && registry) {
        for (const [key, entry] of Object.entries(registry)) {
            if (entry.project_number === cwdProjNum) {
                resolvedWsId = key
                break
            }
        }
    }

    return {
        workspaceId: resolvedWsId ?? config?.defaultWorkspaceId ?? 'default',
        projectNumber: cwdProjNum
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
export function resolveProjectNumberFromPath(cwd: string): number | undefined {
    if (process.env['NODE_ENV'] === 'test' || process.env['VITEST'] === 'true') {
        return undefined
    }
    try {
        const configPath = getConfigPath()
        if (!fs.existsSync(configPath)) return undefined
        
        const content = fs.readFileSync(configPath, 'utf-8')
        const config = JSON.parse(content) as ParsedConfig
        
        if (config.projectRegistry === undefined || config.projectRegistry === null) return undefined
        
        const normalizedCwd = cwd.replace(/\\/g, '/').toLowerCase()
        
        // Find the most specific (longest) matching path
        let bestMatchLength = -1
        let bestProjectNumber: number | undefined = undefined
        
        for (const [, entry] of Object.entries(config.projectRegistry)) {
            const entryPath = entry.path
            if (entryPath === undefined || entryPath === null) continue
            
            const normalizedRegPath = entryPath.replace(/\\/g, '/').toLowerCase()
            
            if (normalizedCwd.startsWith(normalizedRegPath)) {
                if (normalizedRegPath.length > bestMatchLength) {
                    bestMatchLength = normalizedRegPath.length
                    bestProjectNumber = entry.project_number
                }
            }
        }
        
        return bestProjectNumber
    } catch {
        // Silently fail if auto-resolution fails
        return undefined
    }
}
