import type { ToolDefinition, ToolContext, ProjectRegistryEntry } from '../../../types/index.js'
import { ConfigManager } from '../../../utils/config-manager.js'
import { formatHandlerError } from '../../../utils/error-helpers.js'
import {
    RegisterProjectSchemaMcp,
    UpdateProjectSchemaMcp,
    DeleteProjectSchemaMcp,
    GetProjectSchemaMcp,
    ListProjectsSchemaMcp,
    ProjectOutputSchema
} from './schemas.js'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { assertSafeDirectoryPath } from '../../../utils/security-utils.js'
import { readProjectRegistryFile } from '../../../utils/registry-config-file.js'
import {
    clearActiveSessionProject,
    getActiveSessionProject,
    setActiveSessionProject,
} from '../../../utils/workspace-resolver-session.js'

const FORBIDDEN_PROJECT_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

function isForbiddenProjectKey(key: string): boolean {
    return FORBIDDEN_PROJECT_KEYS.has(key)
}

function isValidProjectPath(p: string, allowedRoots?: string[]): boolean {
    if (!p || p.includes('\0') || p.startsWith('\\\\') || p.startsWith('//')) {
        return false
    }
    const slashSplit = p.replace(/\\/g, '/').split('/')
    const normalizedSplit = path.normalize(p).split(path.sep)
    if (slashSplit.includes('..') || normalizedSplit.includes('..')) {
        return false
    }
    if (!path.isAbsolute(p)) {
        return false
    }
    if (allowedRoots && allowedRoots.length > 0) {
        try {
            assertSafeDirectoryPath(p, allowedRoots)
        } catch {
            return false
        }
    }
    return true
}

function getRegistryConfigPath(): string {
    return process.env['MEMORY_JOURNAL_CONFIG'] ?? path.resolve(os.homedir(), '.gemini', 'config', 'memory-journal.config.json')
}

function loadConfig(): Record<string, unknown> {
    return readProjectRegistryFile(getRegistryConfigPath()).config
}

/** Describes a rename (`to` set) or delete (`to` omitted) of a registry key, for active-default cleanup. */
interface RegistryKeyChange {
    from: string
    to?: string
    projectNumber?: number | null
}

/** Rewrites/clears session defaults that pointed at a renamed/deleted project. */
function applyDefaultsChange(
    target: { defaultWorkspaceId?: string; defaultProjectNumber?: number },
    change: RegistryKeyChange | undefined
): void {
    if (change === undefined || target.defaultWorkspaceId !== change.from) return
    if (change.to !== undefined) {
        target.defaultWorkspaceId = change.to
        if (typeof change.projectNumber === 'number') {
            target.defaultProjectNumber = change.projectNumber
        } else if (change.projectNumber === null) {
            delete target.defaultProjectNumber
        }
    } else {
        delete target.defaultWorkspaceId
        delete target.defaultProjectNumber
    }
}

/**
 * [INTENT] Persist the registry file and propagate it through in-process config (ToolContext +
 * ConfigManager) instead of mutating process.env, so hot-reload listeners observe the change.
 */
function saveConfig(config: Record<string, unknown>, context?: ToolContext, change?: RegistryKeyChange): void {
    if (change !== undefined && typeof config['defaultWorkspaceId'] === 'string' && config['defaultWorkspaceId'] === change.from) {
        if (change.to !== undefined) {
            config['defaultWorkspaceId'] = change.to
            if (typeof change.projectNumber === 'number') {
                config['defaultProjectNumber'] = change.projectNumber
            } else if (change.projectNumber === null) {
                delete config['defaultProjectNumber']
            }
        } else {
            delete config['defaultWorkspaceId']
            delete config['defaultProjectNumber']
        }
    }
    const configPath = getRegistryConfigPath()
    fs.mkdirSync(path.dirname(configPath), { recursive: true })
    fs.writeFileSync(configPath, JSON.stringify(config, null, 4), 'utf-8')
    const rawReg = config['projectRegistry']
    if (context?.config === undefined || typeof rawReg !== 'object' || rawReg === null) return
    const reg = rawReg as Record<string, ProjectRegistryEntry>
    context.config.projectRegistry = reg
    applyDefaultsChange(context.config, change)
    if (context.config.briefingConfig !== undefined) {
        context.config.briefingConfig.projectRegistry = reg
        applyDefaultsChange(context.config.briefingConfig, change)
    }
    const runtime = context.config.runtime
    const activeSession = getActiveSessionProject(runtime)
    if (change !== undefined && activeSession.workspaceId === change.from) {
        if (change.to !== undefined) {
            const nextProj =
                change.projectNumber !== undefined
                    ? change.projectNumber
                    : activeSession.projectNumber
            setActiveSessionProject(change.to, nextProj ?? null, runtime)
        } else {
            clearActiveSessionProject(runtime)
        }
    }
    const manager = runtime?.configManager
    if (manager instanceof ConfigManager) {
        const briefingConfig = { ...manager.getConfig().briefingConfig, projectRegistry: reg }
        applyDefaultsChange(briefingConfig, change)
        manager.updateConfig({ briefingConfig })
    }
}

function coerceRegistryProjectNumber(raw: number | string | undefined): number | undefined {
    const num =
        typeof raw === 'number'
            ? raw
            : typeof raw === 'string' && raw.trim() !== ''
              ? Number(raw)
              : undefined
    return num !== undefined && Number.isInteger(num) && num > 0 ? num : undefined
}

function invalidProjectNumber(raw: number | string | undefined): boolean {
    return raw !== undefined && coerceRegistryProjectNumber(raw) === undefined
}

export function getProjectTools(context: ToolContext): ToolDefinition[] {
    const allowedRoots = context.config?.allowedIoRoots
    return [
        {
            name: 'register_project',
            title: 'Register Project',
            description: 'Register a new project in the global registry. This is required before the agent can switch context to this repository.',
            group: 'admin',
            inputSchema: RegisterProjectSchemaMcp,
            outputSchema: ProjectOutputSchema,
            annotations: {
                readOnlyHint: false,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: false,
            },
            handler: (params: unknown) => {
                try {
                    const parsed = RegisterProjectSchemaMcp.parse(params)
                    if (invalidProjectNumber(parsed.project_number)) {
                        return Promise.resolve({ success: false, error: 'project_number must be a positive integer' })
                    }
                    if (isForbiddenProjectKey(parsed.name)) {
                        return Promise.resolve({ success: false, error: `Invalid project name: '${parsed.name}'` })
                    }
                    if (!isValidProjectPath(parsed.absolute_path, allowedRoots)) {
                        return Promise.resolve({ success: false, error: `Invalid or unsafe project path: '${parsed.absolute_path}'` })
                    }
                    const config = loadConfig()
                    config['projectRegistry'] ??= {}
                    const registry = config['projectRegistry'] as Record<string, { path: string, project_number?: number }>
                    
                    const projectRef = Object.hasOwn(registry, parsed.name)
                        ? (registry[parsed.name] ?? { path: parsed.absolute_path })
                        : { path: parsed.absolute_path }
                    projectRef.path = parsed.absolute_path
                    const coercedNum = coerceRegistryProjectNumber(parsed.project_number)
                    if (coercedNum !== undefined) {
                        projectRef.project_number = coercedNum
                    }
                    registry[parsed.name] = projectRef
                    
                    saveConfig(config, context)
                    
                    const message = `Project '${parsed.name}' registered successfully.`
                    return Promise.resolve({ success: true, message, project: { name: parsed.name, ...registry[parsed.name] } })
                } catch (err) {
                    return Promise.resolve(formatHandlerError(err))
                }
            }
        },
        {
            name: 'update_project',
            title: 'Update Project',
            description: 'Update the details (path, number, or name) of an existing project in the registry.',
            group: 'admin',
            inputSchema: UpdateProjectSchemaMcp,
            outputSchema: ProjectOutputSchema,
            annotations: {
                readOnlyHint: false,
                destructiveHint: false,
                idempotentHint: false,
                openWorldHint: false,
            },
            handler: (params: unknown) => {
                try {
                    const parsed = UpdateProjectSchemaMcp.parse(params)
                    if (invalidProjectNumber(parsed.project_number)) {
                        return Promise.resolve({ success: false, error: 'project_number must be a positive integer' })
                    }
                    if (isForbiddenProjectKey(parsed.name) || (parsed.new_name && isForbiddenProjectKey(parsed.new_name))) {
                        return Promise.resolve({ success: false, error: `Invalid project name.` })
                    }
                    if (parsed.absolute_path && !isValidProjectPath(parsed.absolute_path, allowedRoots)) {
                        return Promise.resolve({ success: false, error: `Invalid or unsafe project path: '${parsed.absolute_path}'` })
                    }
                    const config = loadConfig()
                    config['projectRegistry'] ??= {}
                    const registry = config['projectRegistry'] as Record<string, { path: string, project_number?: number }>
                    
                    if (!Object.hasOwn(registry, parsed.name) || !registry[parsed.name]) {
                        return { success: false, error: `🛠️ AUTONOMOUS HEALING: Project not found: '${parsed.name}'` }
                    }
                    
                    const project = registry[parsed.name] ?? { path: '' }
                    if (parsed.absolute_path) project.path = parsed.absolute_path
                    const coercedUpdateNum = coerceRegistryProjectNumber(parsed.project_number)
                    if (coercedUpdateNum !== undefined) project.project_number = coercedUpdateNum
                    
                    const targetName = parsed.new_name ?? parsed.name
                    if (parsed.new_name && parsed.new_name !== parsed.name) {
                        config['projectRegistry'] = Object.fromEntries(
                            Object.entries(registry).filter(([key]) => key !== parsed.name)
                        )
                    }
                    
                    const updatedRegistry = config['projectRegistry'] as Record<string, { path: string, project_number?: number }>
                    updatedRegistry[targetName] = project
                    const keyChange: RegistryKeyChange | undefined =
                        targetName !== parsed.name || coercedUpdateNum !== undefined
                            ? {
                                  from: parsed.name,
                                  to: targetName,
                                  ...(coercedUpdateNum !== undefined
                                      ? { projectNumber: coercedUpdateNum }
                                      : {}),
                              }
                            : undefined
                    saveConfig(config, context, keyChange)
                    
                    return Promise.resolve({ success: true, message: `Project '${targetName}' updated.`, project: { name: targetName, ...updatedRegistry[targetName] } })
                } catch (err) {
                    return Promise.resolve(formatHandlerError(err))
                }
            }
        },
        {
            name: 'delete_project',
            title: 'Delete Project',
            description: 'Remove a project from the global registry.',
            group: 'admin',
            inputSchema: DeleteProjectSchemaMcp,
            outputSchema: ProjectOutputSchema,
            annotations: {
                readOnlyHint: false,
                destructiveHint: true,
                idempotentHint: true,
                openWorldHint: false,
            },
            handler: (params: unknown) => {
                try {
                    const parsed = DeleteProjectSchemaMcp.parse(params)
                    if (isForbiddenProjectKey(parsed.name)) {
                        return Promise.resolve({ success: false, error: `Invalid project name: '${parsed.name}'` })
                    }
                    const config = loadConfig()
                    config['projectRegistry'] ??= {}
                    const registry = config['projectRegistry'] as Record<string, { path: string, project_number?: number }>
                    
                    if (!Object.hasOwn(registry, parsed.name) || !registry[parsed.name]) {
                        return Promise.resolve({ success: false, error: `🛠️ AUTONOMOUS HEALING: Project not found: '${parsed.name}'` })
                    }
                    
                    const rest = Object.fromEntries(Object.entries(registry).filter(([key]) => key !== parsed.name))
                    config['projectRegistry'] = rest
                    saveConfig(config, context, { from: parsed.name })
                    
                    return Promise.resolve({ success: true, message: `Project '${parsed.name}' deleted.` })
                } catch (err) {
                    return Promise.resolve(formatHandlerError(err))
                }
            }
        },
        {
            name: 'list_projects',
            title: 'List Projects',
            description: 'List all registered projects.',
            group: 'admin',
            inputSchema: ListProjectsSchemaMcp,
            outputSchema: ProjectOutputSchema,
            annotations: {
                readOnlyHint: true,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: false,
            },
            handler: () => {
                try {
                    const config = loadConfig()
                    config['projectRegistry'] ??= {}
                    const registry = config['projectRegistry'] as Record<string, { path: string, project_number?: number }>
                    
                    const items = Object.entries(registry).map(([name, data]) => {
                        const dataObj = data as Record<string, unknown>
                        const desc = typeof dataObj['description'] === 'string' ? dataObj['description'] : ''
                        const res: Record<string, unknown> = {
                            ...data,
                            name,
                            description: desc,
                            path: data.path,
                        }
                        if (typeof data.project_number === 'number') {
                            res['project_number'] = data.project_number
                            res['projectNumber'] = data.project_number
                        }
                        return res
                    })
                    
                    return Promise.resolve({ success: true, projects: registry, items, data: items })
                } catch (err) {
                    return Promise.resolve(formatHandlerError(err))
                }
            }
        },
        {
            name: 'get_project',
            title: 'Get Project',
            description: 'Get details of a specific registered project.',
            group: 'admin',
            inputSchema: GetProjectSchemaMcp,
            outputSchema: ProjectOutputSchema,
            annotations: {
                readOnlyHint: true,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: false,
            },
            handler: (params: unknown) => {
                try {
                    const parsed = GetProjectSchemaMcp.parse(params)
                    if (isForbiddenProjectKey(parsed.name)) {
                        return Promise.resolve({ success: false, error: `Invalid project name: '${parsed.name}'` })
                    }
                    const config = loadConfig()
                    config['projectRegistry'] ??= {}
                    const registry = config['projectRegistry'] as Record<string, { path: string, project_number?: number, id?: number }>
                    
                    let foundName = parsed.name
                    let projectInfo = Object.hasOwn(registry, foundName) ? registry[foundName] : undefined
                    const rawProjNum = (parsed as Record<string, unknown>)['project_number']
                    if (
                        rawProjNum !== undefined &&
                        typeof rawProjNum !== 'number' &&
                        typeof rawProjNum !== 'string'
                    ) {
                        return Promise.resolve({
                            success: false,
                            error: `🛠️ AUTONOMOUS HEALING: Invalid project_number: '${JSON.stringify(rawProjNum) ?? typeof rawProjNum}'`,
                        })
                    }
                    const parsedProjNum = coerceRegistryProjectNumber(rawProjNum)
                    if (rawProjNum !== undefined && parsedProjNum === undefined) {
                        return Promise.resolve({
                            success: false,
                            error: `🛠️ AUTONOMOUS HEALING: Invalid project_number: '${JSON.stringify(rawProjNum) ?? typeof rawProjNum}'`,
                        })
                    }
                    const nameProjNum = coerceRegistryProjectNumber(parsed.name)
                    if (
                        projectInfo &&
                        parsedProjNum !== undefined &&
                        projectInfo.project_number !== parsedProjNum &&
                        projectInfo.id !== parsedProjNum
                    ) {
                        return Promise.resolve({
                            success: false,
                            error: `🛠️ AUTONOMOUS HEALING: Project '${foundName}' uses project_number ${String(projectInfo.project_number ?? projectInfo.id)}, not ${String(parsedProjNum)}.`,
                        })
                    }
                    if (!projectInfo && (nameProjNum !== undefined || parsedProjNum !== undefined)) {
                        if (
                            nameProjNum !== undefined &&
                            parsedProjNum !== undefined &&
                            nameProjNum !== parsedProjNum
                        ) {
                            return Promise.resolve({
                                success: false,
                                error: `🛠️ AUTONOMOUS HEALING: Conflicting project_number values '${parsed.name}' and ${String(parsedProjNum)}.`,
                            })
                        }
                        const targetNum = parsedProjNum ?? nameProjNum
                        for (const [pName, pData] of Object.entries(registry)) {
                            if (pData.project_number === targetNum || pData.id === targetNum) {
                                foundName = pName
                                projectInfo = pData
                                break
                            }
                        }
                    }

                    if (!projectInfo) {
                        return Promise.resolve({ success: false, error: `🛠️ AUTONOMOUS HEALING: Project not found: '${parsed.name}'` })
                    }
                    
                    return Promise.resolve({
                        success: true,
                        project: {
                            name: foundName,
                            id: projectInfo.project_number ?? projectInfo.id,
                            project_number: projectInfo.project_number ?? projectInfo.id,
                            ...projectInfo
                        }
                    })
                } catch (err) {
                    return Promise.resolve(formatHandlerError(err))
                }
            }
        }
    ]
}
