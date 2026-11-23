import type { ToolDefinition } from '../../types/index.js'
import { METHOD_ALIASES } from '../api-constants.js'
import type { GroupApiRecord, ProjectRegistryProvider, RegistryOpsConfig } from './types.js'
import { toolNameToMethodName } from './group-factory.js'
import { isRecord } from '../normalizers/shared-utils.js'
import { runWithSilentTeamProbe } from '../rpc-context.js'
import {
    createGetConfigFn,
    createRegisterProjectFn,
    createUpdateProjectFn,
    createDeleteProjectFn,
    createListProjectsFn,
    createGetProjectFn,
} from './project-registry-ops.js'

export interface ProjectAndTeamAliasDeps {
    core: GroupApiRecord
    search: GroupApiRecord
    admin: GroupApiRecord
    relationships: GroupApiRecord
    team: GroupApiRecord
    hasDispatcher: boolean
    registryProvider: ProjectRegistryProvider | undefined
    registryOpsConfig?: RegistryOpsConfig
    copyFnSchema: (source: unknown, wrapper: (...args: unknown[]) => unknown) => void
}

function replaceAliasedFn(
    groups: readonly GroupApiRecord[],
    originalFn: unknown,
    wrappedFn: (...args: unknown[]) => Promise<unknown>
): void {
    for (const group of groups) {
        for (const key of Object.keys(group)) {
            if (group[key] === originalFn) {
                group[key] = wrappedFn
            }
        }
    }
}

function wireProjectMutationWrappers(deps: ProjectAndTeamAliasDeps): void {
    const { core, search, admin, hasDispatcher, registryOpsConfig, copyFnSchema } = deps

    const existingRegisterProject = admin['registerProject']
    const existingUpdateProject = admin['updateProject']
    const existingDeleteProject = admin['deleteProject']

    if (typeof existingRegisterProject === 'function') {
        const fallbackRegister = hasDispatcher
            ? undefined
            : createRegisterProjectFn(core, undefined, registryOpsConfig)
        const wrappedRegister = async (...args: unknown[]): Promise<unknown> => {
            if (isRecord(args[0])) return await existingRegisterProject(args[0])
            if (typeof args[0] === 'string') {
                if (isRecord(args[1])) {
                    return await existingRegisterProject({ ...args[1], name: args[0] })
                }
                return await existingRegisterProject({
                    name: args[0],
                    absolute_path: typeof args[1] === 'string' ? args[1] : '',
                    ...(args[2] !== undefined && args[2] !== null ? { project_number: args[2] } : {}),
                })
            }
            if (fallbackRegister === undefined) return await existingRegisterProject({})
            return await fallbackRegister(...args)
        }
        copyFnSchema(existingRegisterProject, wrappedRegister)
        admin['registerProject'] = wrappedRegister
        replaceAliasedFn([admin, core, search], existingRegisterProject, wrappedRegister)
    }
    if (typeof existingUpdateProject === 'function') {
        const fallbackUpdate = hasDispatcher
            ? undefined
            : createUpdateProjectFn(undefined, registryOpsConfig)
        const wrappedUpdate = async (...args: unknown[]): Promise<unknown> => {
            if (isRecord(args[0])) return await existingUpdateProject(args[0])
            if (typeof args[0] === 'string') {
                if (isRecord(args[1])) {
                    return await existingUpdateProject({ ...args[1], name: args[0] })
                }
                return await existingUpdateProject({
                    name: args[0],
                    ...(typeof args[1] === 'string' && args[1] !== '' ? { new_name: args[1] } : {}),
                    ...(typeof args[2] === 'string' && args[2] !== '' ? { absolute_path: args[2] } : {}),
                    ...(args[3] !== undefined && args[3] !== null ? { project_number: args[3] } : {}),
                })
            }
            if (fallbackUpdate === undefined) return await existingUpdateProject({})
            return await fallbackUpdate(...args)
        }
        copyFnSchema(existingUpdateProject, wrappedUpdate)
        admin['updateProject'] = wrappedUpdate
        replaceAliasedFn([admin, core, search], existingUpdateProject, wrappedUpdate)
    }
    if (typeof existingDeleteProject === 'function') {
        const fallbackDelete = hasDispatcher
            ? undefined
            : createDeleteProjectFn(registryOpsConfig)
        const wrappedDelete = async (...args: unknown[]): Promise<unknown> => {
            if (isRecord(args[0])) return await existingDeleteProject(args[0])
            if (typeof args[0] === 'string') return await existingDeleteProject({ name: args[0] })
            if (fallbackDelete === undefined) return await existingDeleteProject({})
            return await fallbackDelete(...args)
        }
        copyFnSchema(existingDeleteProject, wrappedDelete)
        admin['deleteProject'] = wrappedDelete
        replaceAliasedFn([admin, core, search], existingDeleteProject, wrappedDelete)
    }
}

function disabledToolStub(toolName: string): () => Promise<unknown> {
    return (): Promise<unknown> =>
        Promise.resolve({
            success: false,
            error: `Tool '${toolName}' is disabled by the active --tool-filter configuration.`,
            code: 'TOOL_DISABLED',
            category: 'authorization',
            recoverable: false,
        })
}

function resolveGetConfigFn(
    hasDispatcher: boolean,
    existingListProjects: unknown,
    listProjectsFn: (...args: unknown[]) => Promise<unknown>,
    registryProvider: ProjectRegistryProvider | undefined
): (...args: unknown[]) => Promise<unknown> {
    if (!hasDispatcher) return createGetConfigFn(registryProvider)
    if (typeof existingListProjects !== 'function') return disabledToolStub('list_projects')
    // [M3] Route through listProjectsFn so --tool-filter, OAuth scopes, and AuditInterceptor apply identically.
    return async (): Promise<unknown> => {
        const res = await listProjectsFn({})
        if (isRecord(res) && res['success'] === false) return res
        const registryPayload = isRecord(res) ? (res['items'] ?? res['projects']) : res
        return { PROJECT_REGISTRY: registryPayload, dbPath: 'memory://internal' }
    }
}

function wireProjectQueryAndTeamAliases(deps: ProjectAndTeamAliasDeps): void {
    const { core, search, admin, team, hasDispatcher, registryProvider, registryOpsConfig, copyFnSchema } = deps
    const existingListProjects = admin['listProjects']
    const existingGetProject = admin['getProject']
    const fallbackListProjectsFn = createListProjectsFn(registryProvider, registryOpsConfig)

    let listProjectsFn: (...args: unknown[]) => Promise<unknown>
    if (hasDispatcher) {
        if (typeof existingListProjects === 'function') {
            const wrappedListProjects = async (...args: unknown[]): Promise<unknown> => {
                if (isRecord(args[0])) return await existingListProjects(args[0])
                return await existingListProjects({})
            }
            copyFnSchema(existingListProjects, wrappedListProjects)
            listProjectsFn = wrappedListProjects
        } else {
            listProjectsFn = disabledToolStub('list_projects')
        }
    } else {
        listProjectsFn = fallbackListProjectsFn
    }

    let getProjectFn: (...args: unknown[]) => Promise<unknown>
    if (hasDispatcher) {
        if (typeof existingGetProject === 'function') {
            const wrappedGetProject = async (...args: unknown[]): Promise<unknown> => {
                if (isRecord(args[0])) return await existingGetProject(args[0])
                if (typeof args[0] === 'string') return await existingGetProject({ name: args[0] })
                if (typeof args[0] === 'number') return await existingGetProject({ project_number: args[0] })
                return await existingGetProject({})
            }
            copyFnSchema(existingGetProject, wrappedGetProject)
            getProjectFn = wrappedGetProject
        } else {
            getProjectFn = disabledToolStub('get_project')
        }
    } else {
        getProjectFn = createGetProjectFn(fallbackListProjectsFn)
    }

    for (const grp of [core, search, admin]) {
        grp['listProjects'] = listProjectsFn
        grp['list_projects'] = listProjectsFn
        grp['getProjects'] = listProjectsFn
        grp['getProject'] = getProjectFn
        grp['get_project'] = getProjectFn
    }
    core['searchProjects'] = listProjectsFn
    search['searchProjects'] = listProjectsFn

    const getConfigFn = resolveGetConfigFn(hasDispatcher, existingListProjects, listProjectsFn, registryProvider)
    admin['getConfig'] = getConfigFn
    core['getConfig'] = getConfigFn

    if (team['teamDeleteEntry']) {
        team['deleteEntry'] = team['teamDeleteEntry']
        team['delete'] = team['teamDeleteEntry']
    }
    if (team['teamUpdateEntry']) {
        team['updateEntry'] = team['teamUpdateEntry']
        team['update'] = team['teamUpdateEntry']
    }
    if (team['teamCreateEntry']) {
        team['createEntry'] = team['teamCreateEntry']
        team['create'] = team['teamCreateEntry']
    }
}

interface TeamAutoRouteOptions {
    primaryGroup: GroupApiRecord
    aliasGroups?: readonly GroupApiRecord[]
    primaryMethod: string
    snakeMethod: string
    teamFn: GroupApiRecord[string] | undefined
    suggestionHint: string
    allowPositionalEntryId?: boolean
    buildTeamArgs: (args: Record<string, unknown>) => Record<string, unknown>
    copyFnSchema: (source: unknown, wrapper: (...args: unknown[]) => unknown) => void
}

function normalizeAutoRouteArg(
    args: unknown[],
    allowPositionalEntryId: boolean
): Record<string, unknown> | null {
    const firstArg = args[0]
    if (allowPositionalEntryId && (typeof firstArg === 'number' || typeof firstArg === 'string')) {
        const extra = isRecord(args[1]) ? args[1] : undefined
        const entryId = firstArg
        const workspaceExtra = extra?.['workspace_id'] ?? extra?.['workspaceId'] ?? extra?.['workspace']
        return {
            ...(extra ?? {}),
            entry_id: entryId,
            ...(workspaceExtra !== undefined && extra?.['workspace_id'] === undefined
                ? { workspace_id: workspaceExtra }
                : {}),
            ...(extra?.['projectNumber'] !== undefined && extra['project_number'] === undefined
                ? { project_number: extra['projectNumber'] }
                : {}),
            ...(extra?.['includeRelationships'] !== undefined &&
            extra['include_relationships'] === undefined
                ? { include_relationships: extra['includeRelationships'] }
                : {}),
        }
    }
    if (!isRecord(firstArg)) return null
    const entryId = firstArg['entry_id'] ?? firstArg['entryId'] ?? firstArg['id']
    const workspaceId = firstArg['workspace_id'] ?? firstArg['workspaceId'] ?? firstArg['workspace']
    const projectNumber = firstArg['project_number'] ?? firstArg['projectNumber']
    const includeRelationships =
        firstArg['include_relationships'] ?? firstArg['includeRelationships']
    return {
        ...firstArg,
        ...(entryId !== undefined ? { entry_id: entryId } : {}),
        ...(workspaceId !== undefined ? { workspace_id: workspaceId } : {}),
        ...(projectNumber !== undefined ? { project_number: projectNumber } : {}),
        ...(includeRelationships !== undefined
            ? { include_relationships: includeRelationships }
            : {}),
    }
}

function wrapTeamAutoRoute(opts: TeamAutoRouteOptions): void {
    const primaryFn = opts.primaryGroup[opts.primaryMethod]
    const teamFn = opts.teamFn
    if (typeof primaryFn !== 'function' || typeof teamFn !== 'function') return

    const wrapped = async (...args: unknown[]): Promise<unknown> => {
        const normalized = normalizeAutoRouteArg(args, opts.allowPositionalEntryId === true)
        if (normalized === null || normalized['source'] !== undefined) {
            return await primaryFn(...args)
        }
        const res = await runWithSilentTeamProbe(() => primaryFn(...args))
        if (
            isRecord(res) &&
            res['success'] === false &&
            res['code'] === 'RESOURCE_NOT_FOUND' &&
            typeof res['suggestion'] === 'string' &&
            res['suggestion'].includes(opts.suggestionHint)
        ) {
            const rawUseTestDb = normalized['use_test_db'] ?? normalized['useTestDb']
            const teamRes = await teamFn({
                ...opts.buildTeamArgs(normalized),
                ...(typeof rawUseTestDb === 'boolean' ? { use_test_db: rawUseTestDb } : {}),
            })
            if (isRecord(teamRes) && teamRes['success'] !== false) {
                return { ...teamRes, _healed: { routedTo: 'team' } }
            }
        }
        return res
    }
    opts.copyFnSchema(primaryFn, wrapped)
    opts.primaryGroup[opts.primaryMethod] = wrapped
    if (opts.primaryGroup[opts.snakeMethod] !== undefined) {
        opts.primaryGroup[opts.snakeMethod] = wrapped
    }
    replaceAliasedFn([opts.primaryGroup, ...(opts.aliasGroups ?? [])], primaryFn, wrapped)
}

function wireSilentTeamFallbackRouting(deps: ProjectAndTeamAliasDeps): void {
    const { core, search, admin, relationships, team, copyFnSchema } = deps
    wrapTeamAutoRoute({
        primaryGroup: core,
        aliasGroups: [search, admin, relationships],
        primaryMethod: 'getEntryById',
        snakeMethod: 'get_entry_by_id',
        teamFn: team['teamGetEntryById'],
        suggestionHint: 'team_get_entry_by_id',
        allowPositionalEntryId: true,
        copyFnSchema,
        buildTeamArgs: (p) => ({
            entry_id: p['entry_id'],
            ...(p['include_relationships'] !== undefined
                ? { include_relationships: p['include_relationships'] }
                : {}),
            ...(p['session_id'] !== undefined ? { session_id: p['session_id'] } : {}),
            ...(p['workspace_id'] !== undefined ? { workspace_id: p['workspace_id'] } : {}),
            ...(p['project_number'] !== undefined ? { project_number: p['project_number'] } : {}),
        }),
    })
    wrapTeamAutoRoute({
        primaryGroup: relationships,
        aliasGroups: [core, search, admin],
        primaryMethod: 'visualizeRelationships',
        snakeMethod: 'visualize_relationships',
        teamFn: team['teamVisualizeRelationships'],
        suggestionHint: 'team_visualize_relationships',
        allowPositionalEntryId: true,
        copyFnSchema,
        buildTeamArgs: (p) => {
            const tagsVal = p['tags']
            const firstTag =
                Array.isArray(tagsVal) && typeof tagsVal[0] === 'string'
                    ? tagsVal[0]
                    : typeof p['tag'] === 'string'
                      ? p['tag']
                      : undefined
            return {
                ...(p['entry_id'] !== undefined ? { entry_id: p['entry_id'] } : {}),
                ...(firstTag !== undefined ? { tag: firstTag } : {}),
                ...(p['depth'] !== undefined ? { depth: p['depth'] } : {}),
                ...(p['limit'] !== undefined ? { limit: p['limit'] } : {}),
                ...(p['session_id'] !== undefined ? { session_id: p['session_id'] } : {}),
                ...(p['workspace_id'] !== undefined ? { workspace_id: p['workspace_id'] } : {}),
                ...(p['project_number'] !== undefined ? { project_number: p['project_number'] } : {}),
            }
        },
    })
}

/** Wires positional project management wrappers, project listing helpers, and team aliases. */
export function wireProjectAndTeamAliasesHelper(deps: ProjectAndTeamAliasDeps): void {
    wireProjectMutationWrappers(deps)
    wireProjectQueryAndTeamAliases(deps)
    wireSilentTeamFallbackRouting(deps)
}

function collectGroupObjectSchemas(
    val: Record<string, unknown>,
    fnSchemas: WeakMap<object, string>
): Record<string, string> | undefined {
    const out: Record<string, string> = {}
    let hasEntries = false
    for (const [mName, mVal] of Object.entries(val)) {
        if (typeof mVal !== 'function') continue
        const s = fnSchemas.get(mVal)
        if (s !== undefined) {
            out[mName] = s
            hasEntries = true
        }
    }
    return hasEntries ? out : undefined
}

export interface SandboxSchemaDeps {
    toolsByGroup: Map<string, ToolDefinition[]>
    bindings: Record<string, unknown>
    fnSchemas: WeakMap<object, string>
    getToolSchemaString: (tool: ToolDefinition) => string
}

/** Builds schema help maps across registered tool groups, aliases, and sandbox bindings. */
export function buildSandboxSchemasMap(deps: SandboxSchemaDeps): Record<string, Record<string, string>> {
    const { toolsByGroup, bindings, fnSchemas, getToolSchemaString } = deps
    const schemas: Record<string, Record<string, string>> = {}
    for (const [groupName, tools] of toolsByGroup.entries()) {
        const groupSchemas: Record<string, string> = {}
        for (const tool of tools) {
            const methodName = toolNameToMethodName(tool.name, groupName)
            const typeStr = getToolSchemaString(tool)
            groupSchemas[methodName] = typeStr
            if (tool.name !== methodName) groupSchemas[tool.name] = typeStr
        }
        const aliases = METHOD_ALIASES[groupName]
        if (aliases) {
            for (const [aliasName, canonicalName] of Object.entries(aliases)) {
                if (groupSchemas[canonicalName] !== undefined) groupSchemas[aliasName] = groupSchemas[canonicalName]
            }
        }
        schemas[groupName] = groupSchemas
    }

    for (const [key, val] of Object.entries(bindings)) {
        if (typeof val === 'function') {
            const s = fnSchemas.get(val)
            if (s !== undefined) (schemas['_topLevel'] ??= {})[key] = s
            continue
        }
        if (!isRecord(val)) continue
        const groupEntries = collectGroupObjectSchemas(val, fnSchemas)
        if (groupEntries !== undefined) {
            schemas[key] = { ...schemas[key], ...groupEntries }
        }
    }
    return schemas
}
