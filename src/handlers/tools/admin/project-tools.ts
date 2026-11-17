import type { ToolDefinition, ToolContext, ProjectRegistryEntry } from '../../../types/index.js'
import { ConfigManager } from '../../../utils/config-manager.js'
import { formatHandlerError } from '../../../utils/error-helpers.js'
import {
    RegisterProjectSchemaMcp,
    UpdateProjectSchemaMcp,
    DeleteProjectSchemaMcp,
    ProjectOutputSchema,
} from './schemas.js'
import {
    applyDefaultsChange,
    getProjectReadTools,
    readLiveProjectRegistry,
    readRegistryObject,
    syncManagerRegistry,
    type RegistryKeyChange,
    type RegistryMap,
} from './project-read-tools.js'
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

function omitRegistryKey(registry: RegistryMap, keyToRemove: string): RegistryMap {
    return Object.fromEntries(Object.entries(registry).filter(([key]) => key !== keyToRemove))
}

/**
 * [INTENT] Persist ONLY disk registry entries to disk and propagate the merged live+disk
 * registry through in-process config (ToolContext + ConfigManager) without dumping CLI/env baselines.
 */
function saveConfig(
    diskConfig: Record<string, unknown>,
    context?: ToolContext,
    change?: RegistryKeyChange,
    inMemoryRegistry?: RegistryMap
): void {
    if (
        change !== undefined &&
        typeof diskConfig['defaultWorkspaceId'] === 'string' &&
        diskConfig['defaultWorkspaceId'] === change.from
    ) {
        applyDefaultsChange(diskConfig, change)
    }
    writeProjectRegistryFile(getRegistryConfigPath(context), diskConfig)
    const effectiveRegistry = inMemoryRegistry ?? readRegistryObject(diskConfig['projectRegistry'])
    if (context?.config === undefined || effectiveRegistry === undefined) return
    context.config.projectRegistry = effectiveRegistry
    applyDefaultsChange(context.config, change)
    if (context.config.briefingConfig !== undefined) {
        context.config.briefingConfig.projectRegistry = effectiveRegistry
        applyDefaultsChange(context.config.briefingConfig, change)
    }
    const runtime = context.config.runtime
    const activeSession = getActiveSessionProject(runtime)
    if (change !== undefined && activeSession.workspaceId === change.from) {
        if (change.to !== undefined) {
            const nextProj =
                change.projectNumber !== undefined ? change.projectNumber : activeSession.projectNumber
            setActiveSessionProject(change.to, nextProj ?? null, runtime)
        } else {
            clearActiveSessionProject(runtime)
        }
    }
    syncManagerRegistry(runtime?.configManager, effectiveRegistry, change)
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

function handleRegisterProject(
    params: unknown,
    context: ToolContext,
    allowedRoots?: string[]
): Record<string, unknown> {
    const parsed = RegisterProjectSchemaMcp.parse(params)
    const cleanName = parsed.name.trim()
    if (invalidProjectNumber(parsed.project_number)) {
        return { success: false, error: 'project_number must be a positive integer' }
    }
    if (cleanName === '' || isForbiddenProjectKey(cleanName)) {
        return { success: false, error: `Invalid project name: '${parsed.name}'` }
    }
    if (!isValidProjectPath(parsed.absolute_path, allowedRoots)) {
        return { success: false, error: `Invalid or unsafe project path: '${parsed.absolute_path}'` }
    }

    const diskConfig = loadConfig(context)
    diskConfig['projectRegistry'] ??= {}
    const diskRegistry = diskConfig['projectRegistry'] as RegistryMap
    const liveRegistry = readLiveProjectRegistry(context)
    const mergedRegistry: RegistryMap = { ...liveRegistry, ...diskRegistry }

    const keyConflict = findCaseInsensitiveKeyConflict(mergedRegistry, cleanName, cleanName)
    if (keyConflict !== undefined) {
        return {
            success: false,
            error: `Project '${keyConflict}' already exists (conflicts with '${cleanName}').`,
        }
    }

    const coercedNum = coerceRegistryProjectNumber(parsed.project_number)
    if (coercedNum !== undefined) {
        const numConflict = findProjectNumberConflict(mergedRegistry, coercedNum, [cleanName])
        if (numConflict !== undefined) {
            return {
                success: false,
                error: `Project number ${String(coercedNum)} is already assigned to project '${numConflict}'.`,
            }
        }
    }

    const existing = Object.hasOwn(diskRegistry, cleanName)
        ? diskRegistry[cleanName]
        : Object.hasOwn(mergedRegistry, cleanName)
          ? mergedRegistry[cleanName]
          : undefined
    const projectRef: ProjectRegistryEntry = {
        ...(existing ?? { path: parsed.absolute_path }),
        path: parsed.absolute_path,
        ...(coercedNum !== undefined ? { project_number: coercedNum } : {}),
    }
    diskRegistry[cleanName] = projectRef
    saveConfig(diskConfig, context, undefined, { ...liveRegistry, ...diskRegistry })

    return {
        success: true,
        message: `Project '${cleanName}' registered successfully.`,
        project: { name: cleanName, ...projectRef },
    }
}

function validateUpdateProjectInputs(
    parsed: ReturnType<typeof UpdateProjectSchemaMcp.parse>,
    mergedRegistry: RegistryMap,
    allowedRoots?: string[]
): { error?: Record<string, unknown>; targetName?: string; coercedUpdateNum?: number } {
    if (invalidProjectNumber(parsed.project_number)) {
        return { error: { success: false, error: 'project_number must be a positive integer' } }
    }
    if (
        isForbiddenProjectKey(parsed.name) ||
        (parsed.new_name !== undefined && isForbiddenProjectKey(parsed.new_name))
    ) {
        return { error: { success: false, error: 'Invalid project name.' } }
    }
    if (parsed.absolute_path !== undefined && !isValidProjectPath(parsed.absolute_path, allowedRoots)) {
        return {
            error: { success: false, error: `Invalid or unsafe project path: '${parsed.absolute_path}'` },
        }
    }
    if (!Object.hasOwn(mergedRegistry, parsed.name) || !mergedRegistry[parsed.name]) {
        return { error: { success: false, error: `🛠️ AUTONOMOUS HEALING: Project not found: '${parsed.name}'` } }
    }
    const targetName = parsed.new_name !== undefined ? parsed.new_name.trim() : parsed.name
    if (isForbiddenProjectKey(targetName)) {
        return { error: { success: false, error: 'Invalid target project name.' } }
    }
    if (targetName !== parsed.name) {
        if (Object.hasOwn(mergedRegistry, targetName)) {
            return {
                error: {
                    success: false,
                    error: `Project '${targetName}' already exists; refusing to overwrite it.`,
                },
            }
        }
        const renameConflict = findCaseInsensitiveKeyConflict(mergedRegistry, targetName, parsed.name)
        if (renameConflict !== undefined) {
            return {
                error: {
                    success: false,
                    error: `Project '${renameConflict}' already exists (conflicts with '${targetName}'); refusing to overwrite it.`,
                },
            }
        }
    }
    const coercedUpdateNum = coerceRegistryProjectNumber(parsed.project_number)
    if (coercedUpdateNum !== undefined) {
        const numConflict = findProjectNumberConflict(mergedRegistry, coercedUpdateNum, [
            parsed.name,
            targetName,
        ])
        if (numConflict !== undefined) {
            return {
                error: {
                    success: false,
                    error: `Project number ${String(coercedUpdateNum)} is already assigned to project '${numConflict}'.`,
                },
            }
        }
    }
    return coercedUpdateNum !== undefined ? { targetName, coercedUpdateNum } : { targetName }
}

function handleUpdateProject(
    params: unknown,
    context: ToolContext,
    allowedRoots?: string[]
): Record<string, unknown> {
    const parsed = UpdateProjectSchemaMcp.parse(params)
    const diskConfig = loadConfig(context)
    diskConfig['projectRegistry'] ??= {}
    const diskRegistry = diskConfig['projectRegistry'] as RegistryMap
    const liveRegistry = readLiveProjectRegistry(context)
    const mergedRegistry: RegistryMap = { ...liveRegistry, ...diskRegistry }

    const validation = validateUpdateProjectInputs(parsed, mergedRegistry, allowedRoots)
    if (validation.error !== undefined || validation.targetName === undefined) {
        return validation.error ?? { success: false, error: 'Invalid update project input' }
    }

    const { targetName, coercedUpdateNum } = validation
    const project: ProjectRegistryEntry = {
        ...(mergedRegistry[parsed.name] ?? { path: '' }),
        ...(parsed.absolute_path !== undefined ? { path: parsed.absolute_path } : {}),
        ...(coercedUpdateNum !== undefined ? { project_number: coercedUpdateNum } : {}),
    }

    const nextDiskRegistry =
        targetName !== parsed.name ? omitRegistryKey(diskRegistry, parsed.name) : { ...diskRegistry }
    nextDiskRegistry[targetName] = project
    diskConfig['projectRegistry'] = nextDiskRegistry

    const nextLiveRegistry =
        targetName !== parsed.name ? omitRegistryKey(liveRegistry, parsed.name) : liveRegistry
    const keyChange: RegistryKeyChange | undefined =
        targetName !== parsed.name || coercedUpdateNum !== undefined
            ? {
                  from: parsed.name,
                  to: targetName,
                  ...(coercedUpdateNum !== undefined ? { projectNumber: coercedUpdateNum } : {}),
              }
            : undefined

    saveConfig(diskConfig, context, keyChange, { ...nextLiveRegistry, ...nextDiskRegistry })
    return {
        success: true,
        message: `Project '${targetName}' updated.`,
        project: { name: targetName, ...project },
    }
}

function handleDeleteProject(params: unknown, context: ToolContext): Record<string, unknown> {
    const parsed = DeleteProjectSchemaMcp.parse(params)
    if (isForbiddenProjectKey(parsed.name)) {
        return { success: false, error: `Invalid project name: '${parsed.name}'` }
    }
    const diskConfig = loadConfig(context)
    diskConfig['projectRegistry'] ??= {}
    const diskRegistry = diskConfig['projectRegistry'] as RegistryMap
    const liveRegistry = readLiveProjectRegistry(context)
    const mergedRegistry: RegistryMap = { ...liveRegistry, ...diskRegistry }

    if (!Object.hasOwn(mergedRegistry, parsed.name) || !mergedRegistry[parsed.name]) {
        return { success: false, error: `🛠️ AUTONOMOUS HEALING: Project not found: '${parsed.name}'` }
    }

    const nextDiskRegistry = omitRegistryKey(diskRegistry, parsed.name)
    diskConfig['projectRegistry'] = nextDiskRegistry
    const nextLiveRegistry = omitRegistryKey(liveRegistry, parsed.name)
    saveConfig(
        diskConfig,
        context,
        { from: parsed.name },
        { ...nextLiveRegistry, ...nextDiskRegistry }
    )
    return { success: true, message: `Project '${parsed.name}' deleted.` }
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
                    return Promise.resolve(handleRegisterProject(params, context, allowedRoots))
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
                    return Promise.resolve(handleUpdateProject(params, context, allowedRoots))
                } catch (err) {
                    return Promise.resolve(formatHandlerError(err))
                }
            }
        },
        {
            name: 'delete_project',
            title: 'Delete Project',
            description:
                'Remove a project from the global registry. Returns success: false when the project is already absent.',
            group: 'admin',
            inputSchema: DeleteProjectSchemaMcp,
            outputSchema: ProjectOutputSchema,
            annotations: {
                readOnlyHint: false,
                destructiveHint: true,
                idempotentHint: false,
                openWorldHint: false,
            },
            handler: (params: unknown) => {
                try {
                    return Promise.resolve(handleDeleteProject(params, context))
                } catch (err) {
                    return Promise.resolve(formatHandlerError(err))
                }
            }
        },
        ...getProjectReadTools(context, { loadConfig: () => loadConfig(context), coerceRegistryProjectNumber }),
    ]
}
