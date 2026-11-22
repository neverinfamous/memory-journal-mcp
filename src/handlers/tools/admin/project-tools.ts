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
import {
    findCaseInsensitiveKeyConflict,
    findProjectNumberConflict,
    isForbiddenProjectKey,
    isValidProjectPath,
} from '../../../utils/project-registry-guards.js'
import { parsePositiveProjectNumber } from '../../../utils/safe-positive-int.js'
import { findCanonicalRegistryKey } from '../../../utils/workspace-resolver.js'
import {
    readProjectRegistryFile,
    resolveRegistryConfigPath,
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
    return resolveRegistryConfigPath(fromManager)
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
    if (change !== undefined) {
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
    const sessionMatchesWs =
        change !== undefined &&
        activeSession.workspaceId?.toLowerCase() === change.from.toLowerCase()
    const sessionMatchesProj =
        activeSession.workspaceId === undefined &&
        change?.previousProjectNumber !== undefined &&
        activeSession.projectNumber === change.previousProjectNumber
    if (change !== undefined && (sessionMatchesWs || sessionMatchesProj)) {
        if (change.to !== undefined) {
            const nextProj =
                change.projectNumber !== undefined ? change.projectNumber : activeSession.projectNumber
            const nextWs = sessionMatchesWs ? change.to : activeSession.workspaceId
            setActiveSessionProject(nextWs, nextProj ?? null, runtime)
        } else {
            clearActiveSessionProject(runtime)
        }
    }
    syncManagerRegistry(runtime?.configManager, effectiveRegistry, change)
}

function coerceRegistryProjectNumber(raw: number | string | undefined): number | undefined {
    return parsePositiveProjectNumber(raw)
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
    const previousProjNum = existing?.project_number
    const keyChange: RegistryKeyChange | undefined =
        existing !== undefined && coercedNum !== undefined && coercedNum !== previousProjNum
            ? {
                  from: cleanName,
                  to: cleanName,
                  ...(typeof previousProjNum === 'number'
                      ? { previousProjectNumber: previousProjNum }
                      : {}),
                  projectNumber: coercedNum,
              }
            : undefined
    const projectRef: ProjectRegistryEntry = {
        ...(existing ?? { path: parsed.absolute_path }),
        path: parsed.absolute_path,
        ...(coercedNum !== undefined ? { project_number: coercedNum } : {}),
    }
    diskRegistry[cleanName] = projectRef
    saveConfig(diskConfig, context, keyChange, { ...liveRegistry, ...diskRegistry })

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
): { error?: Record<string, unknown>; targetName?: string; resolvedName?: string; coercedUpdateNum?: number } {
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
    const resolvedName = Object.hasOwn(mergedRegistry, parsed.name)
        ? parsed.name
        : findCanonicalRegistryKey(parsed.name, mergedRegistry)
    if (resolvedName === undefined || !mergedRegistry[resolvedName]) {
        return { error: { success: false, error: `🛠️ AUTONOMOUS HEALING: Project not found: '${parsed.name}'` } }
    }
    const targetName = parsed.new_name !== undefined ? parsed.new_name.trim() : resolvedName
    if (isForbiddenProjectKey(targetName)) {
        return { error: { success: false, error: 'Invalid target project name.' } }
    }
    if (targetName !== resolvedName) {
        if (Object.hasOwn(mergedRegistry, targetName)) {
            return {
                error: {
                    success: false,
                    error: `Project '${targetName}' already exists; refusing to overwrite it.`,
                },
            }
        }
        const renameConflict = findCaseInsensitiveKeyConflict(mergedRegistry, targetName, resolvedName)
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
            resolvedName,
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
    return coercedUpdateNum !== undefined
        ? { targetName, resolvedName, coercedUpdateNum }
        : { targetName, resolvedName }
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
    if (
        validation.error !== undefined ||
        validation.targetName === undefined ||
        validation.resolvedName === undefined
    ) {
        return validation.error ?? { success: false, error: 'Invalid update project input' }
    }

    const { targetName, resolvedName, coercedUpdateNum } = validation
    const previousProjNum = mergedRegistry[resolvedName]?.project_number
    const project: ProjectRegistryEntry = {
        ...(mergedRegistry[resolvedName] ?? { path: '' }),
        ...(parsed.absolute_path !== undefined ? { path: parsed.absolute_path } : {}),
        ...(coercedUpdateNum !== undefined ? { project_number: coercedUpdateNum } : {}),
    }

    const nextDiskRegistry =
        targetName !== resolvedName ? omitRegistryKey(diskRegistry, resolvedName) : { ...diskRegistry }
    nextDiskRegistry[targetName] = project
    diskConfig['projectRegistry'] = nextDiskRegistry

    const nextLiveRegistry =
        targetName !== resolvedName ? omitRegistryKey(liveRegistry, resolvedName) : liveRegistry
    const keyChange: RegistryKeyChange | undefined =
        targetName !== resolvedName || coercedUpdateNum !== undefined
            ? {
                  from: resolvedName,
                  to: targetName,
                  ...(typeof previousProjNum === 'number'
                      ? { previousProjectNumber: previousProjNum }
                      : {}),
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

    const resolvedName = Object.hasOwn(mergedRegistry, parsed.name)
        ? parsed.name
        : findCanonicalRegistryKey(parsed.name, mergedRegistry)
    if (resolvedName === undefined || !mergedRegistry[resolvedName]) {
        return { success: false, error: `🛠️ AUTONOMOUS HEALING: Project not found: '${parsed.name}'` }
    }

    const previousProjNum = mergedRegistry[resolvedName]?.project_number
    const nextDiskRegistry = omitRegistryKey(diskRegistry, resolvedName)
    diskConfig['projectRegistry'] = nextDiskRegistry
    const nextLiveRegistry = omitRegistryKey(liveRegistry, resolvedName)
    saveConfig(
        diskConfig,
        context,
        {
            from: resolvedName,
            ...(typeof previousProjNum === 'number'
                ? { previousProjectNumber: previousProjNum }
                : {}),
        },
        { ...nextLiveRegistry, ...nextDiskRegistry }
    )
    return { success: true, message: `Project '${resolvedName}' deleted.` }
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
