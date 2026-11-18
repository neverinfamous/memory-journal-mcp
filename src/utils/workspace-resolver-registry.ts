import type { ProjectRegistryEntry, ToolHandlerConfig } from '../types/index.js'
import * as os from 'node:os'
import * as path from 'node:path'
import { logger } from './logger.js'
import { readCachedConfigObject } from './registry-config-file.js'
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

function isValidLoadedRegistryEntry(
    key: string,
    val: unknown
): val is ProjectRegistryEntry {
    if (key.trim() === '' || key === '*' || key === '__proto__' || key === 'constructor' || key === 'prototype') {
        return false
    }
    if (typeof val !== 'object' || val === null || Array.isArray(val)) return false
    const entry = val as Record<string, unknown>
    if (entry['path'] !== undefined && typeof entry['path'] !== 'string') return false
    if (
        entry['project_number'] !== undefined &&
        (typeof entry['project_number'] !== 'number' ||
            !Number.isSafeInteger(entry['project_number']) ||
            entry['project_number'] <= 0)
    ) {
        return false
    }
    return true
}

function sanitizeLoadedProjectRegistry(
    raw: unknown
): Record<string, ProjectRegistryEntry> | undefined {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
        return undefined
    }
    const clean = Object.create(null) as Record<string, ProjectRegistryEntry>
    for (const [k, v] of Object.entries(raw)) {
        if (isValidLoadedRegistryEntry(k, v)) {
            clean[k] = v
        }
    }
    return clean
}

export function loadProjectRegistryFromConfig(): Record<string, ProjectRegistryEntry> | undefined {
    if (isTestRunner()) {
        return undefined
    }
    try {
        const config = readCachedConfigObject(getConfigPath()) as ParsedConfig | undefined
        return sanitizeLoadedProjectRegistry(config?.projectRegistry)
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
            const config = readCachedConfigObject(getConfigPath()) as ParsedConfig | undefined
            projectRegistry = sanitizeLoadedProjectRegistry(config?.projectRegistry)
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
