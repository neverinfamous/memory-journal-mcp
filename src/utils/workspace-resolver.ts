import type { ToolHandlerConfig } from '../types/index.js'
import * as os from 'node:os'
import * as path from 'node:path'
import * as fs from 'node:fs'

/**
 * Resolves the effective workspace ID from available context.
 * Priority: explicit workspace_id > project_number lookup > config default > 'default'
 */
export function resolveWorkspaceId(
    explicitWorkspaceId: string | undefined,
    projectNumber: number | undefined,
    config?: ToolHandlerConfig
): string {
    if (explicitWorkspaceId && explicitWorkspaceId !== 'default') return explicitWorkspaceId
    
    const effectiveProjectNumber = projectNumber ?? resolveProjectNumberFromPath(process.cwd())

    if (effectiveProjectNumber !== undefined && effectiveProjectNumber !== null && config?.projectRegistry) {
        for (const [key, entry] of Object.entries(config.projectRegistry)) {
            if (entry.project_number === effectiveProjectNumber) return key
        }
    }
    return explicitWorkspaceId || config?.defaultWorkspaceId || 'default'
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
