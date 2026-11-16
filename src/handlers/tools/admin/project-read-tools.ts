import type { ToolDefinition, ToolContext, ProjectRegistryEntry } from '../../../types/index.js'
import { ConfigManager } from '../../../utils/config-manager.js'
import { formatHandlerError } from '../../../utils/error-helpers.js'
import { isForbiddenProjectKey } from '../../../utils/project-registry-guards.js'
import { GetProjectSchemaMcp, ListProjectsSchemaMcp, ProjectOutputSchema } from './schemas.js'

type RawRegistryEntry = ProjectRegistryEntry & { id?: number; description?: string }
type RawRegistry = Record<string, RawRegistryEntry>

export interface ProjectReadToolDeps {
    loadConfig: () => Record<string, unknown>
    coerceRegistryProjectNumber: (raw: number | string | undefined) => number | undefined
}

export type RegistryMap = Record<string, ProjectRegistryEntry>

export interface RegistryKeyChange {
    from: string
    to?: string
    projectNumber?: number | null
}

/** Rewrites/clears session defaults that pointed at a renamed/deleted project. */
export function applyDefaultsChange(
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

export function readRegistryObject(value: unknown): RawRegistry | undefined {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
    return value as RawRegistry
}

function readManagerRegistry(manager: unknown): RawRegistry | undefined {
    if (manager instanceof ConfigManager) {
        return readRegistryObject(manager.getConfig().briefingConfig.projectRegistry)
    }
    if (
        manager !== null &&
        manager !== undefined &&
        typeof manager === 'object' &&
        'getConfig' in manager &&
        typeof (manager as { getConfig?: unknown }).getConfig === 'function'
    ) {
        const mgrLike = manager as {
            getConfig: () => { briefingConfig?: { projectRegistry?: unknown } } | undefined
        }
        return readRegistryObject(mgrLike.getConfig()?.briefingConfig?.projectRegistry)
    }
    return undefined
}

/** Read live in-memory projectRegistry from ConfigManager or ToolContext config. */
export function readLiveProjectRegistry(context?: ToolContext): RegistryMap {
    return (
        readManagerRegistry(context?.config?.runtime?.configManager) ??
        readRegistryObject(context?.config?.briefingConfig?.projectRegistry) ??
        readRegistryObject(context?.config?.projectRegistry) ??
        {}
    )
}

/** Propagate an updated registry and default-workspace change to ConfigManager. */
export function syncManagerRegistry(
    manager: unknown,
    reg: RegistryMap,
    change: RegistryKeyChange | undefined
): void {
    if (manager instanceof ConfigManager) {
        const briefingConfig = { ...manager.getConfig().briefingConfig, projectRegistry: reg }
        applyDefaultsChange(briefingConfig, change)
        manager.updateConfig({ briefingConfig })
        return
    }
    if (
        manager !== null &&
        manager !== undefined &&
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

/**
 * [INTENT] Prefer live in-memory projectRegistry from ConfigManager / ToolContext so runtime
 * updates made via update_configuration or register_project are immediately visible before disk.
 */
function resolveLiveRegistry(
    context: ToolContext,
    loadDiskConfig: () => Record<string, unknown>
): RawRegistry {
    const fromManager = readManagerRegistry(context.config?.runtime?.configManager)
    if (fromManager !== undefined) return fromManager

    const fromBriefing = readRegistryObject(context.config?.briefingConfig?.projectRegistry)
    if (fromBriefing !== undefined) return fromBriefing

    const fromConfig = readRegistryObject(context.config?.projectRegistry)
    if (fromConfig !== undefined && Object.keys(fromConfig).length > 0) return fromConfig

    const disk = readRegistryObject(loadDiskConfig()['projectRegistry'])
    return disk ?? fromConfig ?? {}
}

function formatListItems(registry: RawRegistry): Record<string, unknown>[] {
    return Object.entries(registry).map(([name, data]) => {
        const desc = typeof data.description === 'string' ? data.description : ''
        const res: Record<string, unknown> = {
            ...data,
            name,
            description: desc,
            path: data.path,
        }
        const projNum = data.project_number ?? data.id
        if (typeof projNum === 'number') {
            res['project_number'] = projNum
            res['projectNumber'] = projNum
        }
        return res
    })
}

function lookupProjectByNumber(
    registry: RawRegistry,
    targetNum: number | undefined
): { foundName: string; projectInfo: RawRegistryEntry } | undefined {
    if (targetNum === undefined) return undefined
    for (const [pName, pData] of Object.entries(registry)) {
        if (pData.project_number === targetNum || pData.id === targetNum) {
            return { foundName: pName, projectInfo: pData }
        }
    }
    return undefined
}

function resolveProjectMatch(
    parsed: ReturnType<typeof GetProjectSchemaMcp.parse>,
    registry: RawRegistry,
    coerceRegistryProjectNumber: ProjectReadToolDeps['coerceRegistryProjectNumber']
): { foundName?: string; projectInfo?: RawRegistryEntry; error?: Record<string, unknown> } {
    let foundName = parsed.name
    let projectInfo = Object.hasOwn(registry, foundName) ? registry[foundName] : undefined
    const rawProjNum = (parsed as Record<string, unknown>)['project_number']
    if (rawProjNum !== undefined && typeof rawProjNum !== 'number' && typeof rawProjNum !== 'string') {
        return {
            error: {
                success: false,
                error: `🛠️ AUTONOMOUS HEALING: Invalid project_number: '${JSON.stringify(rawProjNum) ?? typeof rawProjNum}'`,
            },
        }
    }
    const parsedProjNum = coerceRegistryProjectNumber(rawProjNum)
    if (rawProjNum !== undefined && parsedProjNum === undefined) {
        return {
            error: {
                success: false,
                error: `🛠️ AUTONOMOUS HEALING: Invalid project_number: '${JSON.stringify(rawProjNum) ?? typeof rawProjNum}'`,
            },
        }
    }
    const nameProjNum = coerceRegistryProjectNumber(parsed.name)
    if (
        projectInfo &&
        parsedProjNum !== undefined &&
        projectInfo.project_number !== parsedProjNum &&
        projectInfo.id !== parsedProjNum
    ) {
        return {
            error: {
                success: false,
                error: `🛠️ AUTONOMOUS HEALING: Project '${foundName}' uses project_number ${String(projectInfo.project_number ?? projectInfo.id)}, not ${String(parsedProjNum)}.`,
            },
        }
    }
    if (!projectInfo && (nameProjNum !== undefined || parsedProjNum !== undefined)) {
        if (nameProjNum !== undefined && parsedProjNum !== undefined && nameProjNum !== parsedProjNum) {
            return {
                error: {
                    success: false,
                    error: `🛠️ AUTONOMOUS HEALING: Conflicting project_number values '${parsed.name}' and ${String(parsedProjNum)}.`,
                },
            }
        }
        const matched = lookupProjectByNumber(registry, parsedProjNum ?? nameProjNum)
        if (matched !== undefined) {
            foundName = matched.foundName
            projectInfo = matched.projectInfo
        }
    }
    if (!projectInfo) {
        return { error: { success: false, error: `🛠️ AUTONOMOUS HEALING: Project not found: '${parsed.name}'` } }
    }
    return { foundName, projectInfo }
}

function executeGetProject(
    params: unknown,
    context: ToolContext,
    deps: ProjectReadToolDeps
): Record<string, unknown> {
    const parsed = GetProjectSchemaMcp.parse(params)
    if (isForbiddenProjectKey(parsed.name)) {
        return { success: false, error: `Invalid project name: '${parsed.name}'` }
    }
    const registry = resolveLiveRegistry(context, deps.loadConfig)
    const match = resolveProjectMatch(parsed, registry, deps.coerceRegistryProjectNumber)
    if (match.error !== undefined || match.projectInfo === undefined || match.foundName === undefined) {
        return match.error ?? { success: false, error: `🛠️ AUTONOMOUS HEALING: Project not found: '${parsed.name}'` }
    }
    const resolvedId = match.projectInfo.project_number ?? match.projectInfo.id
    return {
        success: true,
        project: {
            name: match.foundName,
            id: resolvedId,
            project_number: resolvedId,
            ...match.projectInfo,
        },
    }
}

export function getProjectReadTools(
    context: ToolContext,
    deps: ProjectReadToolDeps
): ToolDefinition[] {
    return [
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
            handler: (): Promise<Record<string, unknown>> => {
                try {
                    const registry = resolveLiveRegistry(context, deps.loadConfig)
                    const items = formatListItems(registry)
                    return Promise.resolve({ success: true, projects: registry, items, data: items })
                } catch (err) {
                    return Promise.resolve({ ...formatHandlerError(err) })
                }
            },
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
            handler: (params: unknown): Promise<Record<string, unknown>> => {
                try {
                    return Promise.resolve(executeGetProject(params, context, deps))
                } catch (err) {
                    return Promise.resolve({ ...formatHandlerError(err) })
                }
            },
        },
    ]
}
