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
        const wsId = input.workspace_id
        let projNum = input.project_number ?? (registry?.[wsId]?.project_number)
        projNum ??= resolveProjectNumberFromPath(process.cwd())
        return {
            workspaceId: wsId,
            projectNumber: projNum
        }
    }

    // 2. Explicit project_number provided (or workspace_id was 'default'/missing)
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
            let matched = tagSet.has(keyLower)

            if (!matched && contentLower.length > 0) {
                if (keyLower.length > 3 && !['default', 'test'].includes(keyLower)) {
                    const escapedKey = keyLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
                    const regex = new RegExp(`\\b${escapedKey}\\b`, 'i')
                    if (regex.test(contentLower)) {
                        matched = true
                    }
                }
            }

            if (matched) {
                return {
                    workspaceId: key,
                    projectNumber: input.project_number ?? entry.project_number
                }
            }
        }
    }

    // 4. Fallback (respect explicit input.workspace_id if passed, otherwise defaultWorkspaceId or 'default')
    const cwdProjNum = input.project_number ?? resolveProjectNumberFromPath(process.cwd())

    return {
        workspaceId: input.workspace_id ?? config?.defaultWorkspaceId ?? 'default',
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
