/**
 * Project registry operations and configuration helpers for JournalApi.
 */

import * as os from 'node:os'
import * as path from 'node:path'
import { isRecord, safeString } from '../normalizers/shared-utils.js'
import { readProjectRegistryFile, writeProjectRegistryFile } from '../../utils/registry-config-file.js'
import { mcpLogger } from '../../utils/mcp-logger.js'
import {
    findCaseInsensitiveKeyConflict,
    findProjectNumberConflict,
    isForbiddenProjectKey,
    isValidProjectPath,
} from '../../utils/project-registry-guards.js'
import { parsePositiveProjectNumber } from '../../utils/safe-positive-int.js'
import { sanitizeErrorForLogging } from '../../utils/security-utils.js'
import { findCanonicalRegistryKey } from '../../utils/workspace-registry-match.js'
import { parseProjectRegistry, type GroupApiRecord, type ProjectRegistryProvider } from './types.js'

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
    return sanitizeErrorForLogging(err instanceof Error ? err.message : String(err))
}

function saveRegistryConfig(configPath: string, config: Record<string, unknown>): void {
    writeProjectRegistryFile(configPath, config)
}

/** Live registry first (config provider), then the startup PROJECT_REGISTRY snapshot. */
function resolveRegistry(provider?: ProjectRegistryProvider): unknown[] | undefined {
    if (provider !== undefined) {
        const live = provider()
        if (live !== undefined && live !== null) {
            return parseProjectRegistry(live)
        }
    }
    return parseProjectRegistry()
}

export function createGetConfigFn(
    provider?: ProjectRegistryProvider
): () => Promise<{ PROJECT_REGISTRY: unknown[] | undefined; dbPath: string }> {
    return (): Promise<{ PROJECT_REGISTRY: unknown[] | undefined; dbPath: string }> =>
        Promise.resolve({
            PROJECT_REGISTRY: resolveRegistry(provider),
            dbPath: 'memory://internal',
        })
}

function toGuardRegistry(
    registry: Record<string, unknown>
): Record<string, { path?: string; project_number?: number }> {
    const out = Object.create(null) as Record<
        string,
        { path?: string; project_number?: number }
    >
    for (const [k, v] of Object.entries(registry)) {
        if (isRecord(v)) {
            out[k] = {
                ...(typeof v['path'] === 'string' ? { path: v['path'] } : {}),
                ...(typeof v['project_number'] === 'number'
                    ? { project_number: v['project_number'] }
                    : {}),
            }
        }
    }
    return out
}

function resolveCanonicalDirPath(dirPath: string): string {
    if (/^[A-Za-z]:[\\/]/.test(dirPath)) return path.win32.resolve(dirPath)
    if (dirPath.startsWith('/')) return path.posix.resolve(dirPath)
    return path.resolve(dirPath)
}

function checkRegistryConflicts(
    registry: Record<string, unknown>,
    targetName: string,
    projectNumber: number | undefined,
    existingName?: string
): string | undefined {
    const guardReg = toGuardRegistry(registry)
    if (existingName !== undefined && targetName !== existingName && Object.hasOwn(registry, targetName)) {
        return `Project '${targetName}' already exists; refusing to overwrite it.`
    }
    const keyConflict = findCaseInsensitiveKeyConflict(guardReg, targetName, existingName ?? targetName)
    if (keyConflict !== undefined) {
        return `Project '${keyConflict}' already exists (conflicts with '${targetName}').`
    }
    if (projectNumber !== undefined) {
        const ignoreKeys = existingName !== undefined ? [existingName, targetName] : [targetName]
        const numConflict = findProjectNumberConflict(guardReg, projectNumber, ignoreKeys)
        if (numConflict !== undefined) {
            return `Project number ${String(projectNumber)} is already assigned to project '${numConflict}'.`
        }
    }
    return undefined
}

async function recordProjectInitEntry(
    coreApi: GroupApiRecord,
    name: string,
    projectNumber: number | undefined
): Promise<{ success: boolean; message?: string; warning?: string }> {
    const createEntryFn = coreApi['createEntry']
    if (!createEntryFn) {
        return {
            success: true,
            warning: 'createEntry tool is missing. DB init skipped.',
            message: `Project '${name}' registered, but createEntry tool is missing. DB init skipped.`,
        }
    }
    try {
        const res: unknown = await createEntryFn({
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
        if (isRecord(res) && res['success'] === false) {
            const dbInitError =
                typeof res['error'] === 'string' && res['error'] !== ''
                    ? res['error']
                    : 'createEntry returned failure'
            mcpLogger.warning('codemode', 'Project initialization entry failed', {
                project: name,
                error: dbInitError,
            })
            return {
                success: true,
                warning: dbInitError,
                message: `Project '${name}' registered, but the initialization journal entry failed: ${dbInitError}`,
            }
        }
        return { success: true, message: `Project '${name}' successfully registered.` }
    } catch (err) {
        const dbInitError = registryError(err)
        mcpLogger.warning('codemode', 'Project initialization entry failed', {
            project: name,
            error: dbInitError,
        })
        return {
            success: true,
            warning: dbInitError,
            message: `Project '${name}' registered, but the initialization journal entry failed: ${dbInitError}`,
        }
    }
}

export function createRegisterProjectFn(
    coreApi: GroupApiRecord,
    allowedIoRoots?: string[]
): (...args: unknown[]) => Promise<{ success: boolean; message?: string; warning?: string; error?: string }> {
    return async (...args: unknown[]): Promise<{ success: boolean; message?: string; warning?: string; error?: string }> => {
        const name = safeString(args[0] ?? '').trim()
        const absolutePath = safeString(args[1] ?? '').trim()
        const rawProjectNumber = args[2]
        const projectNumber =
            rawProjectNumber !== undefined && rawProjectNumber !== null
                ? parsePositiveProjectNumber(rawProjectNumber)
                : undefined

        if (rawProjectNumber !== undefined && rawProjectNumber !== null && projectNumber === undefined) {
            return { success: false, error: 'Invalid project_number: expected a positive integer.' }
        }
        if (isForbiddenProjectKey(name)) {
            return { success: false, error: `Invalid project name: '${name}'` }
        }
        if (!isValidProjectPath(absolutePath, allowedIoRoots)) {
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
        const conflict = checkRegistryConflicts(registry, name, projectNumber)
        if (conflict !== undefined) {
            return { success: false, error: conflict }
        }
        const entry: Record<string, unknown> = { path: resolveCanonicalDirPath(absolutePath) }
        if (projectNumber !== undefined) {
            entry['project_number'] = projectNumber
        }
        registry[name] = entry
        try {
            saveRegistryConfig(configPath, config)
        } catch (err) {
            return { success: false, error: registryError(err) }
        }

        return recordProjectInitEntry(coreApi, name, projectNumber)
    }
}

export function createUpdateProjectFn(allowedIoRoots?: string[]): (...args: unknown[]) => Promise<{
    success: boolean
    message?: string
    error?: string
}> {
    return (...args: unknown[]): Promise<{ success: boolean; message?: string; error?: string }> => {
        const name = safeString(args[0] ?? '').trim()
        const newName = typeof args[1] === 'string' && args[1].trim() !== '' ? args[1].trim() : undefined
        const absolutePath =
            typeof args[2] === 'string' && args[2].trim() !== '' ? args[2].trim() : undefined
        const rawProjectNumber = args[3]
        const projectNumber =
            rawProjectNumber !== undefined && rawProjectNumber !== null
                ? parsePositiveProjectNumber(rawProjectNumber)
                : undefined

        if (rawProjectNumber !== undefined && rawProjectNumber !== null && projectNumber === undefined) {
            return Promise.resolve({ success: false, error: 'Invalid project_number: expected a positive integer.' })
        }
        if (isForbiddenProjectKey(name) || (newName !== undefined && isForbiddenProjectKey(newName))) {
            return Promise.resolve({ success: false, error: 'Invalid project name.' })
        }
        if (absolutePath !== undefined && !isValidProjectPath(absolutePath, allowedIoRoots)) {
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
        const guardReg = toGuardRegistry(registry)
        const existingKey = Object.hasOwn(registry, name)
            ? name
            : findCanonicalRegistryKey(name, guardReg)
        const rawProject = existingKey !== undefined ? registry[existingKey] : undefined
        if (existingKey === undefined || !isRecord(rawProject)) {
            return Promise.resolve({ success: false, error: `🛠️ AUTONOMOUS HEALING: Project not found: '${name}'` })
        }
        const targetName = newName ?? existingKey
        const conflict = checkRegistryConflicts(registry, targetName, projectNumber, existingKey)
        if (conflict !== undefined) {
            return Promise.resolve({ success: false, error: conflict })
        }

        const updatedProject: Record<string, unknown> = { ...rawProject }
        if (absolutePath !== undefined) updatedProject['path'] = resolveCanonicalDirPath(absolutePath)
        if (projectNumber !== undefined) updatedProject['project_number'] = projectNumber

        const rest = Object.fromEntries(Object.entries(registry).filter(([key]) => key !== existingKey))
        config['projectRegistry'] = { ...rest, [targetName]: updatedProject }
        try {
            saveRegistryConfig(configPath, config)
        } catch (err) {
            return Promise.resolve({ success: false, error: registryError(err) })
        }

        return Promise.resolve({ success: true, message: `Project '${targetName}' updated.` })
    }
}

export function createDeleteProjectFn(): (...args: unknown[]) => Promise<{
    success: boolean
    message?: string
    error?: string
}> {
    return (...args: unknown[]): Promise<{ success: boolean; message?: string; error?: string }> => {
        const name = safeString(args[0] ?? '').trim()
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

        const existingKey = Object.hasOwn(registry, name)
            ? name
            : findCanonicalRegistryKey(name, toGuardRegistry(registry))
        if (existingKey === undefined || !isRecord(registry[existingKey])) {
            return Promise.resolve({ success: false, error: `🛠️ AUTONOMOUS HEALING: Project not found: '${name}'` })
        }

        config['projectRegistry'] = Object.fromEntries(
            Object.entries(registry).filter(([key]) => key !== existingKey)
        )
        try {
            saveRegistryConfig(configPath, config)
        } catch (err) {
            return Promise.resolve({ success: false, error: registryError(err) })
        }

        return Promise.resolve({ success: true, message: `Project '${existingKey}' deleted.` })
    }
}

export function createListProjectsFn(provider?: ProjectRegistryProvider): () => Promise<unknown> {
    return (): Promise<unknown> => {
        if (provider !== undefined) {
            const live = resolveRegistry(provider)
            if (live !== undefined) return Promise.resolve(live)
        }

        try {
            const { registry: reg } = readRegistryConfig()
            const entries = Object.entries(reg)
            if (entries.length > 0) {
                return Promise.resolve(
                    entries.map(([name, val]) => {
                        const info = isRecord(val) ? val : {}
                        return {
                            name,
                            projectNumber: info['project_number'] ?? info['id'],
                            project_number: info['project_number'] ?? info['id'],
                            ...info,
                        }
                    })
                )
            }
        } catch (err) {
            mcpLogger.warning('codemode', 'Registry read failed', {
                error: registryError(err),
            })
            return Promise.resolve({
                success: false,
                error: registryError(err),
                code: 'REGISTRY_UNAVAILABLE',
            })
        }
        const startup = parseProjectRegistry()
        if (startup !== undefined && startup.length > 0) return Promise.resolve(startup)
        return Promise.resolve({
            success: false,
            error: 'Project registry is unavailable',
            code: 'REGISTRY_UNAVAILABLE',
        })
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
                const numVal = parsePositiveProjectNumber(searchVal)
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
                }
            }
        } catch (err) {
            throw new Error(`Project lookup failed: ${registryError(err)}`, { cause: err })
        }
        throw new Error(`Project not found: ${JSON.stringify(typeof params === 'string' || typeof params === 'number' ? params : '[object]')}`)
    }
}
