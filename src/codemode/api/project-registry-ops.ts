/**
 * Project registry operations and configuration helpers for JournalApi.
 */

import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { isRecord, safeString } from '../normalizers/shared-utils.js'
import { readProjectRegistryFile } from '../../utils/registry-config-file.js'
import { mcpLogger } from '../../utils/mcp-logger.js'
import { parseProjectRegistry, type GroupApiRecord } from './types.js'

function getConfigPath(): string {
    return (
        process.env['MEMORY_JOURNAL_CONFIG'] ??
        path.resolve(os.homedir(), '.gemini', 'config', 'memory-journal.config.json')
    )
}

function readRegistryConfig(): {
    configPath: string
    config: Record<string, unknown>
    registry: Record<string, unknown>
} {
    const configPath = getConfigPath()
    const { config, registry } = readProjectRegistryFile(configPath)
    return { configPath, config, registry }
}

function registryError(err: unknown): string {
    return err instanceof Error ? err.message : String(err)
}

function saveRegistryConfig(configPath: string, config: Record<string, unknown>): void {
    fs.mkdirSync(path.dirname(configPath), { recursive: true })
    fs.writeFileSync(configPath, JSON.stringify(config, null, 4), 'utf-8')
    process.env['PROJECT_REGISTRY'] = JSON.stringify(config['projectRegistry'])
}

export function createGetConfigFn(): () => Promise<{ PROJECT_REGISTRY: unknown[] | undefined; dbPath: string }> {
    return (): Promise<{ PROJECT_REGISTRY: unknown[] | undefined; dbPath: string }> =>
        Promise.resolve({
            PROJECT_REGISTRY: parseProjectRegistry(),
            dbPath: 'memory://internal',
        })
}

const FORBIDDEN_PROJECT_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

function isForbiddenProjectKey(name: string): boolean {
    return name.trim().length === 0 || FORBIDDEN_PROJECT_KEYS.has(name.trim())
}

function isValidProjectPath(dirPath: string): boolean {
    if (dirPath.trim().length === 0) return false
    if (dirPath.includes('\0') || dirPath.startsWith('\\\\') || dirPath.startsWith('//')) return false
    if (!path.isAbsolute(dirPath)) return false
    // Reject any `..` segment so the registered path is the canonical location the caller named.
    return !dirPath.split(/[\\/]+/).includes('..')
}

export function createRegisterProjectFn(
    coreApi: GroupApiRecord
): (...args: unknown[]) => Promise<{ success: boolean; message?: string; warning?: string; error?: string }> {
    return async (...args: unknown[]): Promise<{ success: boolean; message?: string; warning?: string; error?: string }> => {
        const name = safeString(args[0] ?? '')
        const absolutePath = safeString(args[1] ?? '')
        const projectNumber = typeof args[2] === 'number' ? args[2] : undefined

        if (isForbiddenProjectKey(name)) {
            return { success: false, error: `Invalid project name: '${name}'` }
        }
        if (!isValidProjectPath(absolutePath)) {
            return { success: false, error: `Invalid project path: '${absolutePath}'. Must be a local absolute path.` }
        }

        let configPath: string
        let config: Record<string, unknown>
        let registry: Record<string, unknown>
        try {
            const loaded = readRegistryConfig()
            configPath = loaded.configPath
            config = loaded.config
            registry = loaded.registry
        } catch (err) {
            return { success: false, error: registryError(err) }
        }
        const entry: Record<string, unknown> = { path: path.resolve(absolutePath) }
        if (typeof projectNumber === 'number' && !Number.isNaN(projectNumber)) {
            entry['project_number'] = projectNumber
        }
        registry[name] = entry
        saveRegistryConfig(configPath, config)

        const createEntryFn = coreApi['createEntry']
        if (!createEntryFn) {
            return {
                success: true,
                message: `Project '${name}' registered, but createEntry tool is missing. DB init skipped.`,
            }
        }
        let dbInitError: string | undefined
        try {
            await createEntryFn({
                entryType: 'project_decision',
                significanceType: 'architecture',
                content: `Initialized project ${name}`,
                tags: ['project-initialization', 'setup'],
                workspaceId: name,
                ...(projectNumber !== undefined ? { projectNumber } : {}),
                trustScore: 1.0,
                impactScore: 0.8,
                autoContext: JSON.stringify({ action: 'register_project', target: name }),
            })
        } catch (err) {
            dbInitError = registryError(err)
            mcpLogger.warning('codemode', 'Project initialization entry failed', {
                project: name,
                error: dbInitError,
            })
        }
        if (dbInitError !== undefined) {
            return {
                success: true,
                warning: dbInitError,
                message: `Project '${name}' registered, but the initialization journal entry failed: ${dbInitError}`,
            }
        }
        return { success: true, message: `Project '${name}' successfully registered.` }
    }
}

export function createUpdateProjectFn(): (...args: unknown[]) => Promise<{
    success: boolean
    message?: string
    error?: string
}> {
    return (...args: unknown[]): Promise<{ success: boolean; message?: string; error?: string }> => {
        const name = safeString(args[0] ?? '')
        const newName = typeof args[1] === 'string' && args[1] !== '' ? args[1] : undefined
        const absolutePath = typeof args[2] === 'string' && args[2] !== '' ? args[2] : undefined
        const projectNumber = typeof args[3] === 'number' ? args[3] : undefined

        if (isForbiddenProjectKey(name) || (newName !== undefined && isForbiddenProjectKey(newName))) {
            return Promise.resolve({ success: false, error: 'Invalid project name.' })
        }
        if (absolutePath !== undefined && !isValidProjectPath(absolutePath)) {
            return Promise.resolve({ success: false, error: `Invalid project path: '${absolutePath}'.` })
        }

        let configPath: string
        let config: Record<string, unknown>
        let registry: Record<string, unknown>
        try {
            const loaded = readRegistryConfig()
            configPath = loaded.configPath
            config = loaded.config
            registry = loaded.registry
        } catch (err) {
            return Promise.resolve({ success: false, error: registryError(err) })
        }
        const project = Object.hasOwn(registry, name) ? registry[name] : undefined
        if (!isRecord(project)) {
            return Promise.resolve({ success: false, error: `🛠️ AUTONOMOUS HEALING: Project not found: '${name}'` })
        }

        if (absolutePath !== undefined) project['path'] = path.resolve(absolutePath)
        if (typeof projectNumber === 'number' && !Number.isNaN(projectNumber)) {
            project['project_number'] = projectNumber
        }

        const targetName = newName ?? name
        const rest = Object.fromEntries(Object.entries(registry).filter(([key]) => key !== name))
        config['projectRegistry'] = { ...rest, [targetName]: project }
        saveRegistryConfig(configPath, config)

        return Promise.resolve({ success: true, message: `Project '${targetName}' updated.` })
    }
}

export function createDeleteProjectFn(): (...args: unknown[]) => Promise<{
    success: boolean
    message?: string
    error?: string
}> {
    return (...args: unknown[]): Promise<{ success: boolean; message?: string; error?: string }> => {
        const name = safeString(args[0] ?? '')
        if (isForbiddenProjectKey(name)) {
            return Promise.resolve({ success: false, error: `Invalid project name: '${name}'` })
        }
        let configPath: string
        let config: Record<string, unknown>
        let registry: Record<string, unknown>
        try {
            const loaded = readRegistryConfig()
            configPath = loaded.configPath
            config = loaded.config
            registry = loaded.registry
        } catch (err) {
            return Promise.resolve({ success: false, error: registryError(err) })
        }

        if (!Object.hasOwn(registry, name) || !isRecord(registry[name])) {
            return Promise.resolve({ success: false, error: `🛠️ AUTONOMOUS HEALING: Project not found: '${name}'` })
        }

        config['projectRegistry'] = Object.fromEntries(Object.entries(registry).filter(([key]) => key !== name))
        saveRegistryConfig(configPath, config)

        return Promise.resolve({ success: true, message: `Project '${name}' deleted.` })
    }
}

export function createListProjectsFn(analyticsApi: GroupApiRecord): () => Promise<unknown> {
    return async (): Promise<unknown> => {
        try {
            const registry = parseProjectRegistry()
            if (registry !== undefined && registry.length > 0) return registry
        } catch (err) {
            mcpLogger.warning('codemode', 'Registry parse failed; falling back to config registry', {
                error: registryError(err),
            })
        }

        try {
            const { registry: reg } = readRegistryConfig()
            const entries = Object.entries(reg)
            if (entries.length > 0) {
                return entries.map(([name, val]) => {
                    const info = isRecord(val) ? val : {}
                    return {
                        name,
                        projectNumber: info['project_number'] ?? info['id'],
                        project_number: info['project_number'] ?? info['id'],
                        ...info,
                    }
                })
            }
        } catch (err) {
            mcpLogger.warning('codemode', 'Registry read failed; falling back to analytics', {
                error: registryError(err),
            })
        }

        const statsFn = analyticsApi['getStatistics']
        if (typeof statsFn === 'function') {
            try {
                const stats = await statsFn({ group_by: 'month', project_breakdown: true })
                if (isRecord(stats) && Array.isArray(stats['projectBreakdown'])) {
                    return stats['projectBreakdown']
                }
            } catch (err) {
                mcpLogger.warning('codemode', 'Project statistics fallback failed', {
                    error: registryError(err),
                })
            }
        }
        return {
            success: false,
            error: 'Project registry is unavailable',
            code: 'REGISTRY_UNAVAILABLE',
        }
    }
}

export function createGetProjectFn(
    listProjectsFn: () => Promise<unknown>
): (params?: unknown) => Promise<unknown> {
    return async (params?: unknown): Promise<unknown> => {
        try {
            let searchVal: string | number | undefined
            if (typeof params === 'number' || typeof params === 'string') {
                searchVal = params
            } else if (isRecord(params)) {
                const candidate =
                    params['project_number'] ??
                    params['projectNumber'] ??
                    params['id'] ??
                    params['entry_id'] ??
                    params['entryId'] ??
                    params['name'] ??
                    params['workspace_id'] ??
                    params['workspaceId'] ??
                    params['project'] ??
                    params['query']
                if (typeof candidate === 'number' || typeof candidate === 'string') {
                    searchVal = candidate
                }
            }

            if (searchVal !== undefined) {
                const isNum =
                    typeof searchVal === 'number' ||
                    (typeof searchVal === 'string' &&
                        searchVal.trim() !== '' &&
                        !Number.isNaN(Number(searchVal)))
                const numVal = isNum ? Number(searchVal) : undefined
                const strVal = String(searchVal).trim().toLowerCase()

                const projects = await listProjectsFn()
                if (Array.isArray(projects)) {
                    const exactMatch: unknown = projects.find((p: unknown) => {
                        if (!isRecord(p)) return false
                        if (
                            numVal !== undefined &&
                            (p['project_number'] === numVal || p['projectNumber'] === numVal)
                        ) {
                            return true
                        }
                        if (typeof p['name'] === 'string') {
                            return p['name'].toLowerCase() === strVal
                        }
                        return false
                    })
                    if (exactMatch !== undefined) return exactMatch

                    const substringMatch: unknown = projects.find((p: unknown) => {
                        if (!isRecord(p)) return false
                        if (typeof p['name'] === 'string' && strVal.length > 0) {
                            return p['name'].toLowerCase().includes(strVal)
                        }
                        return false
                    })
                    if (substringMatch !== undefined) return substringMatch
                }
            }
        } catch (err) {
            throw new Error(`Project lookup failed: ${registryError(err)}`, { cause: err })
        }
        throw new Error(`Project not found: ${JSON.stringify(params)}`)
    }
}
