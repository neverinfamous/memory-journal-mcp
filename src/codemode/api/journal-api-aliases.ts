import type { ToolDefinition } from '../../types/index.js'
import { METHOD_ALIASES } from '../api-constants.js'
import type { GroupApiRecord, ProjectRegistryProvider } from './types.js'
import { toolNameToMethodName } from './group-factory.js'
import { isRecord } from '../normalizers/shared-utils.js'
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
    team: GroupApiRecord
    hasDispatcher: boolean
    registryProvider: ProjectRegistryProvider | undefined
    copyFnSchema: (source: unknown, wrapper: (...args: unknown[]) => unknown) => void
}

function wireProjectMutationWrappers(deps: ProjectAndTeamAliasDeps): void {
    const { core, admin, hasDispatcher, registryProvider, copyFnSchema } = deps
    const getConfigFn = createGetConfigFn(registryProvider)
    admin['getConfig'] = getConfigFn
    core['getConfig'] = getConfigFn

    const existingRegisterProject = admin['registerProject']
    const existingUpdateProject = admin['updateProject']
    const existingDeleteProject = admin['deleteProject']

    if (typeof existingRegisterProject === 'function') {
        const fallbackRegister = hasDispatcher ? undefined : createRegisterProjectFn(core)
        const wrappedRegister = async (...args: unknown[]): Promise<unknown> => {
            if (isRecord(args[0])) return await existingRegisterProject(args[0])
            if (typeof args[0] === 'string') {
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
    }
    if (typeof existingUpdateProject === 'function') {
        const fallbackUpdate = hasDispatcher ? undefined : createUpdateProjectFn()
        const wrappedUpdate = async (...args: unknown[]): Promise<unknown> => {
            if (isRecord(args[0])) return await existingUpdateProject(args[0])
            if (typeof args[0] === 'string') {
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
    }
    if (typeof existingDeleteProject === 'function') {
        const fallbackDelete = hasDispatcher ? undefined : createDeleteProjectFn()
        const wrappedDelete = async (...args: unknown[]): Promise<unknown> => {
            if (isRecord(args[0])) return await existingDeleteProject(args[0])
            if (typeof args[0] === 'string') return await existingDeleteProject({ name: args[0] })
            if (fallbackDelete === undefined) return await existingDeleteProject({})
            return await fallbackDelete(...args)
        }
        copyFnSchema(existingDeleteProject, wrappedDelete)
        admin['deleteProject'] = wrappedDelete
    }
}

function wireProjectQueryAndTeamAliases(deps: ProjectAndTeamAliasDeps): void {
    const { core, search, admin, team, hasDispatcher, registryProvider, copyFnSchema } = deps
    const existingListProjects = admin['listProjects']
    const existingGetProject = admin['getProject']
    const fallbackListProjectsFn = createListProjectsFn(registryProvider)

    const disabledToolStub = (toolName: string): (() => Promise<unknown>) => {
        return (): Promise<unknown> =>
            Promise.resolve({
                success: false,
                error: `Tool '${toolName}' is disabled by the active --tool-filter configuration.`,
                code: 'TOOL_DISABLED',
                category: 'authorization',
                recoverable: false,
            })
    }

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

/** Wires positional project management wrappers, project listing helpers, and team aliases. */
export function wireProjectAndTeamAliasesHelper(deps: ProjectAndTeamAliasDeps): void {
    wireProjectMutationWrappers(deps)
    wireProjectQueryAndTeamAliases(deps)
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
