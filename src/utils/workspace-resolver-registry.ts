import type { ProjectRegistryEntry, ToolHandlerConfig } from '../types/index.js'
import * as os from 'node:os'
import * as path from 'node:path'
import * as fs from 'node:fs'
import { logger } from './logger.js'
import { parseConfigObjectContent } from './registry-config-file.js'
import {
    PROJECT_KEYWORD_ALIASES,
    findCanonicalRegistryKey,
    matchRegistryByTagsOrContent,
    findWorkspaceByProjectNumber,
    cwdMatchesRegistryPath,
    findBestMatchingPathEntry,
    type ResolutionInput,
    type ResolvedContext,
    type RegistryEntry,
} from './workspace-registry-match.js'

export {
    PROJECT_KEYWORD_ALIASES,
    findCanonicalRegistryKey,
    matchRegistryByTagsOrContent,
    findWorkspaceByProjectNumber,
    cwdMatchesRegistryPath,
    type ResolutionInput,
    type ResolvedContext,
    type RegistryEntry,
}

interface ParsedConfig {
    projectRegistry?: Record<string, ProjectRegistryEntry>
}

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
