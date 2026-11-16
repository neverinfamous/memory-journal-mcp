import type { ToolDefinition, ToolContext, ProjectRegistryEntry } from '../../../types/index.js'
import { ConfigManager } from '../../../utils/config-manager.js'
import { formatHandlerError } from '../../../utils/error-helpers.js'
import {
    RegisterProjectSchemaMcp,
    UpdateProjectSchemaMcp,
    DeleteProjectSchemaMcp,
    ProjectOutputSchema,
} from './schemas.js'
import { getProjectReadTools } from './project-read-tools.js'
import path from 'node:path'
import os from 'node:os'
import {
    findCaseInsensitiveKeyConflict,
    findProjectNumberConflict,
    isForbiddenProjectKey,
    isValidProjectPath,
} from '../../../utils/project-registry-guards.js'
import {
    readProjectRegistryFile,
    writeProjectRegistryFile,
} from '../../../utils/registry-config-file.js'
import {
    clearActiveSessionProject,
    getActiveSessionProject,
    setActiveSessionProject,
} from '../../../utils/workspace-resolver-session.js'

function getRegistryConfigPath(context?: ToolContext): string {
    const configManager = context?.config?.runtime?.configManager
    const fromManager =
        configManager instanceof ConfigManager ? configManager.getConfigFilePath() : undefined
    if (fromManager !== undefined && fromManager !== '') {
        return path.resolve(fromManager)
    }
    return (
        process.env['MEMORY_JOURNAL_CONFIG'] ??
        path.resolve(os.homedir(), '.gemini', 'config', 'memory-journal.config.json')
    )
}

function loadConfig(context?: ToolContext): Record<string, unknown> {
    return readProjectRegistryFile(getRegistryConfigPath(context)).config
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
    const configPath = getRegistryConfigPath(context)
    writeProjectRegistryFile(configPath, config)
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
    } else if (
        manager !== null &&
        typeof manager === 'object' &&
        'updateConfig' in manager &&
        typeof (manager as { updateConfig?: unknown }).updateConfig === 'function'
    ) {
        const mgrLike = manager as {
            getConfig?: () => { briefingConfig?: Record<string, unknown> }
            updateConfig: (cfg: Record<string, unknown>) => unknown
        }
        const existingBriefing = mgrLike.getConfig?.()?.briefingConfig ?? {}
        const briefingConfig = { ...existingBriefing, projectRegistry: reg }
        applyDefaultsChange(
            briefingConfig as { defaultWorkspaceId?: string; defaultProjectNumber?: number },
            change
        )
        mgrLike.updateConfig({ briefingConfig })
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
                    const cleanName = parsed.name.trim()
                    if (invalidProjectNumber(parsed.project_number)) {
                        return Promise.resolve({ success: false, error: 'project_number must be a positive integer' })
                    }
                    if (cleanName === '' || isForbiddenProjectKey(cleanName)) {
                        return Promise.resolve({ success: false, error: `Invalid project name: '${parsed.name}'` })
                    }
                    if (!isValidProjectPath(parsed.absolute_path, allowedRoots)) {
                        return Promise.resolve({ success: false, error: `Invalid or unsafe project path: '${parsed.absolute_path}'` })
                    }
                    const config = loadConfig(context)
                    config['projectRegistry'] ??= {}
                    const registry = config['projectRegistry'] as Record<string, { path: string, project_number?: number }>

                    const keyConflict = findCaseInsensitiveKeyConflict(registry, cleanName, cleanName)
                    if (keyConflict !== undefined) {
                        return Promise.resolve({
                            success: false,
                            error: `Project '${keyConflict}' already exists (conflicts with '${cleanName}').`,
                        })
                    }

                    const coercedNum = coerceRegistryProjectNumber(parsed.project_number)
                    if (coercedNum !== undefined) {
                        const numConflict = findProjectNumberConflict(registry, coercedNum, [cleanName])
                        if (numConflict !== undefined) {
                            return Promise.resolve({
                                success: false,
                                error: `Project number ${String(coercedNum)} is already assigned to project '${numConflict}'.`,
                            })
                        }
                    }

                    const projectRef = Object.hasOwn(registry, cleanName)
                        ? { ...(registry[cleanName] ?? { path: parsed.absolute_path }) }
                        : { path: parsed.absolute_path }
                    projectRef.path = parsed.absolute_path
                    if (coercedNum !== undefined) {
                        projectRef.project_number = coercedNum
                    }
                    registry[cleanName] = projectRef

                    saveConfig(config, context)

                    const message = `Project '${cleanName}' registered successfully.`
                    return Promise.resolve({ success: true, message, project: { name: cleanName, ...registry[cleanName] } })
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
                    if (isForbiddenProjectKey(parsed.name) || (parsed.new_name !== undefined && isForbiddenProjectKey(parsed.new_name))) {
                        return Promise.resolve({ success: false, error: `Invalid project name.` })
                    }
                    if (parsed.absolute_path !== undefined && !isValidProjectPath(parsed.absolute_path, allowedRoots)) {
                        return Promise.resolve({ success: false, error: `Invalid or unsafe project path: '${parsed.absolute_path}'` })
                    }
                    const config = loadConfig(context)
                    config['projectRegistry'] ??= {}
                    const registry = config['projectRegistry'] as Record<string, { path: string, project_number?: number }>

                    if (!Object.hasOwn(registry, parsed.name) || !registry[parsed.name]) {
                        return { success: false, error: `🛠️ AUTONOMOUS HEALING: Project not found: '${parsed.name}'` }
                    }

                    const targetName = parsed.new_name !== undefined ? parsed.new_name.trim() : parsed.name
                    if (isForbiddenProjectKey(targetName)) {
                        return Promise.resolve({ success: false, error: 'Invalid target project name.' })
                    }
                    if (targetName !== parsed.name) {
                        if (Object.hasOwn(registry, targetName)) {
                            return Promise.resolve({
                                success: false,
                                error: `Project '${targetName}' already exists; refusing to overwrite it.`,
                            })
                        }
                        const renameConflict = findCaseInsensitiveKeyConflict(registry, targetName, parsed.name)
                        if (renameConflict !== undefined) {
                            return Promise.resolve({
                                success: false,
                                error: `Project '${renameConflict}' already exists (conflicts with '${targetName}'); refusing to overwrite it.`,
                            })
                        }
                    }

                    const coercedUpdateNum = coerceRegistryProjectNumber(parsed.project_number)
                    if (coercedUpdateNum !== undefined) {
                        const numConflict = findProjectNumberConflict(registry, coercedUpdateNum, [
                            parsed.name,
                            targetName,
                        ])
                        if (numConflict !== undefined) {
                            return Promise.resolve({
                                success: false,
                                error: `Project number ${String(coercedUpdateNum)} is already assigned to project '${numConflict}'.`,
                            })
                        }
                    }

                    const project = { ...(registry[parsed.name] ?? { path: '' }) }
                    if (parsed.absolute_path !== undefined) project.path = parsed.absolute_path
                    if (coercedUpdateNum !== undefined) project.project_number = coercedUpdateNum

                    if (targetName !== parsed.name) {
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
                    const config = loadConfig(context)
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
        ...getProjectReadTools(context, { loadConfig: () => loadConfig(context), coerceRegistryProjectNumber }),
    ]
}
