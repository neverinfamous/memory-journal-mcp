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

export function loadProjectRegistryFromConfig(): Record<string, RegistryEntry> | undefined {
    try {
        const configPath = path.resolve(os.homedir(), '.gemini', 'config', 'memory-journal.config.json')
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

    // 1. Explicit workspace_id provided (even if 'default')
    if (input.workspace_id !== undefined && input.workspace_id !== null) {
        const wsId = input.workspace_id
        let projNum = input.project_number ?? (registry?.[wsId]?.project_number)
        projNum ??= config?.defaultProjectNumber ?? resolveProjectNumberFromPath(process.cwd())
        return {
            workspaceId: wsId,
            projectNumber: projNum
        }
    }

    // 2. Explicit project_number provided (without explicit workspace_id)
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
        return {
            workspaceId: wsId ?? config?.defaultWorkspaceId ?? 'default',
            projectNumber: projNum
        }
    }

    // 3. Content / Tags keyword matching against projectRegistry (without explicit workspace_id or project_number)
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
                    projectNumber: entry.project_number
                }
            }
        }
    }

    // 4. Fallback (default workspace, inferred project number from cwd or config)
    const cwdProjNum = config?.defaultProjectNumber ?? resolveProjectNumberFromPath(process.cwd())
    return {
        workspaceId: config?.defaultWorkspaceId ?? 'default',
        projectNumber: cwdProjNum ?? config?.defaultProjectNumber
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
    try {
        const configPath = path.resolve(os.homedir(), '.gemini', 'config', 'memory-journal.config.json')
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
