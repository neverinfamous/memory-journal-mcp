/**
 * JournalApi class — the main API object injected as `mj` in the sandbox.
 *
 * Exposes all Memory Journal tool groups as namespaced APIs with cross-group
 * wiring to handle common agent hallucinations.
 */

import type { ToolDefinition } from '../../types/index.js'
import type { ToolGroup } from '../../types/filtering.js'
import type { ProgressContext } from '../../utils/progress-utils.js'
import { METHOD_ALIASES } from '../api-constants.js'
import { getZodTypeString } from '../type-generator.js'
import type { ToolDispatcher, GroupApiRecord } from './types.js'
import { resolveProjectContext } from '../../utils/workspace-resolver.js'
import { createGroupApi, toolNameToMethodName } from './group-factory.js'
import { isRecord } from '../normalizers/shared-utils.js'
import {
    createGetConfigFn,
    createRegisterProjectFn,
    createUpdateProjectFn,
    createDeleteProjectFn,
    createListProjectsFn,
    createGetProjectFn,
} from './project-registry-ops.js'
import { buildSandboxBindingsMap } from './sandbox-bindings.js'

/**
 * Main API class exposing all Memory Journal tool groups.
 * This is the object injected as `mj` in the sandbox.
 */
export class JournalApi {
    readonly core: GroupApiRecord
    readonly search: GroupApiRecord
    readonly analytics: GroupApiRecord
    readonly relationships: GroupApiRecord
    readonly io: GroupApiRecord
    readonly admin: GroupApiRecord
    readonly github: GroupApiRecord
    readonly backup: GroupApiRecord
    readonly team: GroupApiRecord
    readonly git: GroupApiRecord
    readonly memory: GroupApiRecord

    private readonly toolsByGroup: Map<string, ToolDefinition[]>
    private readonly groupApiMap: Record<string, GroupApiRecord>

    constructor(tools: ToolDefinition[], dispatcher?: ToolDispatcher) {
        this.toolsByGroup = new Map()
        for (const tool of tools) {
            if (tool.group === 'codemode') continue
            const existing = this.toolsByGroup.get(tool.group) ?? []
            existing.push(tool)
            this.toolsByGroup.set(tool.group, existing)
        }

        const buildGroup = (g: ToolGroup): GroupApiRecord => createGroupApi(g, this.toolsByGroup.get(g) ?? [], dispatcher)
        this.core = buildGroup('core')
        this.search = buildGroup('search')
        this.analytics = buildGroup('analytics')
        this.relationships = buildGroup('relationships')
        this.io = buildGroup('io')
        this.admin = buildGroup('admin')
        this.github = buildGroup('github')
        this.backup = buildGroup('backup')
        this.team = buildGroup('team')
        this.git = buildGroup('git')
        this.memory = this.core

        this.groupApiMap = {
            core: this.core, search: this.search, analytics: this.analytics,
            relationships: this.relationships, io: this.io, admin: this.admin,
            github: this.github, backup: this.backup, team: this.team,
            git: this.git, memory: this.memory,
        }

        this.wireCrossGroupAliases()
        this.wireProjectAndTeamAliases()
        this.wireMethodAliases()
    }

    private wireCrossGroupAliases(): void {
        const searchEntriesFn = this.search['searchEntries']
        if (searchEntriesFn) {
            this.core['searchEntries'] = searchEntriesFn
            this.core['search'] = searchEntriesFn
            this.core['listEntries'] = searchEntriesFn
            this.core['readQuery'] = async (...args: unknown[]): Promise<unknown> => {
                const res = await searchEntriesFn(...args)
                return isRecord(res) && 'entries' in res ? { ...res, rows: res['entries'] } : res
            }
        }

        const origCreateEntryFn = this.core['createEntry']
        if (origCreateEntryFn) {
            const wrappedCreateEntryFn = async (...args: unknown[]): Promise<unknown> => {
                const params = args[0]
                if (isRecord(params)) {
                    if (typeof params['project_number'] === 'string') {
                        const cleaned = params['project_number'].trim()
                        const num = Number(cleaned)
                        if (!Number.isNaN(num) && cleaned !== '') {
                            params['project_number'] = num
                        } else {
                            if (params['workspace_id'] === undefined || params['workspace_id'] === 'default') {
                                params['workspace_id'] = cleaned
                            }
                            delete params['project_number']
                        }
                    }
                    if (
                        (params['workspace_id'] === undefined || params['workspace_id'] === 'default') &&
                        (params['workspaceId'] === undefined || params['workspaceId'] === 'default')
                    ) {
                        const projNum =
                            typeof params['project_number'] === 'number'
                                ? params['project_number']
                                : typeof params['projectNumber'] === 'number'
                                  ? params['projectNumber']
                                  : undefined
                        const contentStr = typeof params['content'] === 'string' ? params['content'] : undefined
                        const tagsArr = Array.isArray(params['tags'])
                            ? params['tags'].filter((t): t is string => typeof t === 'string')
                            : undefined

                        const resolved = resolveProjectContext({
                            ...(typeof params['workspace_id'] === 'string' ? { workspace_id: params['workspace_id'] } : {}),
                            ...(projNum !== undefined ? { project_number: projNum } : {}),
                            ...(contentStr !== undefined ? { content: contentStr } : {}),
                            ...(tagsArr !== undefined ? { tags: tagsArr } : {}),
                        })
                        if (resolved.workspaceId !== undefined && resolved.workspaceId !== 'default') {
                            params['workspace_id'] = resolved.workspaceId
                            params['workspaceId'] = resolved.workspaceId
                        }
                        if (params['project_number'] === undefined && resolved.projectNumber !== undefined) {
                            params['project_number'] = resolved.projectNumber
                        }
                    }
                }
                return await origCreateEntryFn(...args)
            }

            for (const key of Object.keys(this.core)) {
                if (this.core[key] === origCreateEntryFn) this.core[key] = wrappedCreateEntryFn
            }
            this.core['upsert'] = wrappedCreateEntryFn
        }

        for (const adminKey of ['deleteEntry', 'updateEntry', 'mergeTags', 'restoreEntry', 'searchAuditLog'] as const) {
            const fn = this.admin[adminKey]
            if (fn) this.core[adminKey] = fn
        }
        const deletedFn = this.search['listDeletedEntries']
        if (deletedFn) this.core['listDeletedEntries'] = deletedFn

        const semanticFn = this.search['semanticSearch']
        const searchEntriesFallbackFn = this.search['searchEntries']
        if (semanticFn) {
            const wrappedSemanticFn = async (...args: unknown[]): Promise<unknown> => {
                const res = await semanticFn(...args)
                if (isRecord(res) && Array.isArray(res['entries']) && res['entries'].length === 0 && searchEntriesFallbackFn) {
                    const params = args[0]
                    if (isRecord(params) && typeof params['query'] === 'string') {
                        const fallback = await searchEntriesFallbackFn(...args)
                        if (isRecord(fallback) && Array.isArray(fallback['entries']) && fallback['entries'].length > 0) {
                            return fallback
                        }
                    }
                }
                return res
            }
            this.search['semanticSearch'] = wrappedSemanticFn
            this.core['semanticSearch'] = wrappedSemanticFn
        }

        const vectorStatsFn = this.search['getVectorIndexStats']
        if (vectorStatsFn) {
            this.core['getVectorIndexStats'] = vectorStatsFn
            this.core['vectorStats'] = vectorStatsFn
        }
        if (this.admin['rebuildVectorIndex']) this.core['rebuildVectorIndex'] = this.admin['rebuildVectorIndex']
        if (this.admin['addToVectorIndex']) this.core['addToVectorIndex'] = this.admin['addToVectorIndex']
        if (this.io['exportEntries']) this.core['exportEntries'] = this.io['exportEntries']
        if (this.backup['backupJournal']) {
            this.core['backupJournal'] = this.backup['backupJournal']
            this.admin['backup'] = this.backup['backupJournal']
        }
        if (this.backup['restoreBackup']) this.admin['restoreBackup'] = this.backup['restoreBackup']

        const statsFn = this.analytics['getStatistics']
        if (statsFn) {
            for (const k of ['count', 'listTables', 'describeTable', 'serverInfo', 'serverHealth', 'health', 'status']) {
                this.core[k] = statsFn
            }
            for (const k of ['analyze', 'serverInfo', 'serverHealth', 'health', 'status']) {
                this.admin[k] = statsFn
            }
        }
        if (this.core['getEntryById']) this.core['exists'] = this.core['getEntryById']
    }

    private wireProjectAndTeamAliases(): void {
        const getConfigFn = createGetConfigFn()
        this.admin['getConfig'] = getConfigFn
        this.core['getConfig'] = getConfigFn

        const existingRegisterProject = this.admin['registerProject']
        const existingUpdateProject = this.admin['updateProject']
        const existingDeleteProject = this.admin['deleteProject']

        if (typeof existingRegisterProject === 'function') {
            const fallbackRegister = createRegisterProjectFn(this.core)
            this.admin['registerProject'] = async (...args: unknown[]): Promise<unknown> => {
                if (isRecord(args[0])) return await existingRegisterProject(args[0])
                if (typeof args[0] === 'string') {
                    return await existingRegisterProject({
                        name: args[0],
                        absolute_path: typeof args[1] === 'string' ? args[1] : '',
                        ...(typeof args[2] === 'number' ? { project_number: args[2] } : {}),
                    })
                }
                return await fallbackRegister(...args)
            }
        }
        if (typeof existingUpdateProject === 'function') {
            const fallbackUpdate = createUpdateProjectFn()
            this.admin['updateProject'] = async (...args: unknown[]): Promise<unknown> => {
                if (isRecord(args[0])) return await existingUpdateProject(args[0])
                if (typeof args[0] === 'string') {
                    return await existingUpdateProject({
                        name: args[0],
                        ...(typeof args[1] === 'string' && args[1] !== '' ? { new_name: args[1] } : {}),
                        ...(typeof args[2] === 'string' && args[2] !== '' ? { absolute_path: args[2] } : {}),
                        ...(typeof args[3] === 'number' ? { project_number: args[3] } : {}),
                    })
                }
                return await fallbackUpdate(...args)
            }
        }
        if (typeof existingDeleteProject === 'function') {
            const fallbackDelete = createDeleteProjectFn()
            this.admin['deleteProject'] = async (...args: unknown[]): Promise<unknown> => {
                if (isRecord(args[0])) return await existingDeleteProject(args[0])
                if (typeof args[0] === 'string') {
                    return await existingDeleteProject({ name: args[0] })
                }
                return await fallbackDelete(...args)
            }
        }

        const listProjectsFn = createListProjectsFn(this.analytics)
        const getProjectFn = createGetProjectFn(listProjectsFn)

        for (const grp of [this.core, this.search, this.admin]) {
            grp['listProjects'] = listProjectsFn
            grp['getProjects'] = listProjectsFn
            grp['getProject'] = getProjectFn
        }
        this.core['searchProjects'] = listProjectsFn
        this.search['searchProjects'] = listProjectsFn

        if (this.team['teamDeleteEntry']) {
            this.team['deleteEntry'] = this.team['teamDeleteEntry']
            this.team['delete'] = this.team['teamDeleteEntry']
        }
        if (this.team['teamUpdateEntry']) {
            this.team['updateEntry'] = this.team['teamUpdateEntry']
            this.team['update'] = this.team['teamUpdateEntry']
        }
        if (this.team['teamCreateEntry']) {
            this.team['createEntry'] = this.team['teamCreateEntry']
            this.team['create'] = this.team['teamCreateEntry']
        }
    }

    private wireMethodAliases(): void {
        for (const [groupName, aliases] of Object.entries(METHOD_ALIASES)) {
            const groupApi = this.groupApiMap[groupName]
            if (!groupApi) continue
            for (const [aliasName, canonicalMethod] of Object.entries(aliases)) {
                if (typeof groupApi[canonicalMethod] === 'function') {
                    groupApi[aliasName] ??= groupApi[canonicalMethod]
                }
            }
        }
    }

    getGroups(): string[] {
        return [...this.toolsByGroup.keys()].sort()
    }

    getGroupMethods(group: ToolGroup): string[] {
        const groupApi = this.groupApiMap[group]
        if (!groupApi) return []
        return Object.keys(groupApi)
            .filter((k) => k !== 'help')
            .sort()
    }

    createSandboxBindings(progressCtx?: ProgressContext): Record<string, unknown> {
        return buildSandboxBindingsMap(this, progressCtx)
    }

    createSandboxSchemas(): Record<string, Record<string, string>> {
        const schemas: Record<string, Record<string, string>> = {}
        for (const [groupName, tools] of this.toolsByGroup.entries()) {
            const groupSchemas: Record<string, string> = {}
            for (const tool of tools) {
                const methodName = toolNameToMethodName(tool.name, groupName)
                groupSchemas[methodName] = getZodTypeString(tool.inputSchema)
            }
            const aliases = METHOD_ALIASES[groupName]
            if (aliases) {
                for (const [aliasName, canonicalName] of Object.entries(aliases)) {
                    if (groupSchemas[canonicalName] !== undefined) groupSchemas[aliasName] = groupSchemas[canonicalName]
                }
            }
            schemas[groupName] = groupSchemas
        }
        return schemas
    }
}

export function createJournalApi(tools: ToolDefinition[], dispatcher?: ToolDispatcher): JournalApi {
    return new JournalApi(tools, dispatcher)
}
