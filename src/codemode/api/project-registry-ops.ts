/**
 * Project registry operations and configuration helpers for JournalApi.
 */

import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { isRecord, safeString } from '../normalizers/shared-utils.js'
import { parseProjectRegistry, type GroupApiRecord } from './types.js'

function getConfigPath(): string {
    return (
        process.env['MEMORY_JOURNAL_CONFIG'] ??
        path.resolve(os.homedir(), '.gemini', 'config', 'memory-journal.config.json')
    )
}

function readRegistryConfig(): { configPath: string; config: Record<string, unknown>; registry: Record<string, Record<string, unknown>> } {
    const configPath = getConfigPath()
    let config: Record<string, unknown> = { projectRegistry: {} }
    try {
        const parsed: unknown = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
        if (isRecord(parsed)) {
            config = parsed
        }
    } catch {
        // Ignore missing or unreadable config file
    }
    if (!isRecord(config['projectRegistry'])) {
        config['projectRegistry'] = {}
    }
    const registry = config['projectRegistry'] as Record<string, Record<string, unknown>>
    return { configPath, config, registry }
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

export function createRegisterProjectFn(
    coreApi: GroupApiRecord
): (...args: unknown[]) => Promise<{ success: boolean; message: string }> {
    return async (...args: unknown[]): Promise<{ success: boolean; message: string }> => {
        const name = safeString(args[0] ?? '')
        const absolutePath = safeString(args[1] ?? '')
        const projectNumber = typeof args[2] === 'number' ? args[2] : undefined

        const { configPath, config, registry } = readRegistryConfig()
        const entry: Record<string, unknown> = { path: absolutePath }
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
        try {
            await createEntryFn({
                entryType: 'project_decision',
                significanceType: 'architecture',
                content: `Initialized project ${name}`,
                tags: ['project-initialization', 'setup'],
                projectNumber: projectNumber ?? 0,
                trustScore: 1.0,
                impactScore: 0.8,
                autoContext: JSON.stringify({ action: 'register_project', target: name }),
            })
        } catch {
            // Ignore DB initialization failures natively
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

        const { configPath, config, registry } = readRegistryConfig()
        const project = registry[name]
        if (!project) {
            return Promise.resolve({ success: false, error: `🛠️ AUTONOMOUS HEALING: Project not found: '${name}'` })
        }

        if (absolutePath !== undefined) project['path'] = absolutePath
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
        const { configPath, config, registry } = readRegistryConfig()

        if (!registry[name]) {
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
        } catch {
            // Ignore parse errors and fallback to admin / analytics
        }

        try {
            const configPath = getConfigPath()
            if (fs.existsSync(configPath)) {
                const parsed: unknown = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
                if (isRecord(parsed) && isRecord(parsed['projectRegistry'])) {
                    const reg = parsed['projectRegistry']
                    return Object.entries(reg).map(([name, val]) => {
                        const info = isRecord(val) ? val : {}
                        return {
                            name,
                            projectNumber: info['project_number'] ?? info['id'],
                            project_number: info['project_number'] ?? info['id'],
                            ...info,
                        }
                    })
                }
            }
        } catch {
            // Fallback to analytics
        }

        const statsFn = analyticsApi['getStatistics']
        if (typeof statsFn === 'function') {
            try {
                const stats = await statsFn({ group_by: 'month', project_breakdown: true })
                if (isRecord(stats) && Array.isArray(stats['projectBreakdown'])) {
                    return stats['projectBreakdown']
                }
            } catch {
                // Ignore error
            }
        }
        return []
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
                if (typeof params['project_number'] === 'number') searchVal = params['project_number']
                else if (typeof params['projectNumber'] === 'number') searchVal = params['projectNumber']
                else if (typeof params['name'] === 'string') searchVal = params['name']
                else if (typeof params['query'] === 'string') searchVal = params['query']
            }

            if (searchVal !== undefined) {
                const isNum = typeof searchVal === 'number' || !Number.isNaN(Number(searchVal))
                const numVal = isNum ? Number(searchVal) : undefined
                const strVal = String(searchVal).toLowerCase()

                const projects = await listProjectsFn()
                if (Array.isArray(projects)) {
                    const found: unknown = projects.find((p: unknown) => {
                        if (!isRecord(p)) return false
                        if (
                            numVal !== undefined &&
                            (p['project_number'] === numVal || p['projectNumber'] === numVal)
                        ) {
                            return true
                        }
                        if (typeof p['name'] === 'string') {
                            const projName = p['name'].toLowerCase()
                            if (projName === strVal || projName.includes(strVal)) return true
                        }
                        return false
                    })
                    if (found !== undefined) return found
                }
            }
        } catch {
            // Ignore error
        }
        throw new Error(`Project not found: ${JSON.stringify(params)}`)
    }
}
