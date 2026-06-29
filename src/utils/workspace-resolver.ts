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
    if (explicitWorkspaceId) return explicitWorkspaceId
    if (projectNumber !== undefined && projectNumber !== null && config?.projectRegistry) {
        for (const [key, entry] of Object.entries(config.projectRegistry)) {
            if (entry.project_number === projectNumber) return key
        }
    }
    return config?.defaultWorkspaceId ?? 'default'
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
        const config = JSON.parse(content)
        
        if (!config.projectRegistry) return undefined
        
        const normalizedCwd = cwd.replace(/\\/g, '/').toLowerCase()
        
        // Find the most specific (longest) matching path
        let bestMatchLength = -1
        let bestProjectNumber: number | undefined = undefined
        
        for (const [key, entry] of Object.entries(config.projectRegistry)) {
            const entryPath = (entry as any).path
            if (!entryPath) continue
            
            const normalizedRegPath = entryPath.replace(/\\/g, '/').toLowerCase()
            
            if (normalizedCwd.startsWith(normalizedRegPath)) {
                if (normalizedRegPath.length > bestMatchLength) {
                    bestMatchLength = normalizedRegPath.length
                    bestProjectNumber = (entry as any).project_number
                }
            }
        }
        
        return bestProjectNumber
    } catch (err) {
        // Silently fail if auto-resolution fails
        return undefined
    }
}
