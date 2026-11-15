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
import type { ToolDispatcher, GroupApiRecord, ProjectRegistryProvider } from './types.js'
import { resolveProjectContext } from '../../utils/workspace-resolver.js'
import { activeProjectRegistry, pairStoredScope } from '../../utils/write-scope.js'
import { createGroupApi, toolNameToMethodName } from './group-factory.js'
import { isRecord } from '../normalizers/shared-utils.js'
import { readProjectRegistryPayload } from '../normalizers/generic-field-aliases.js'
import { ValidationError } from '../../types/errors.js'
import {
    buildSandboxSchemasMap,
    wireProjectAndTeamAliasesHelper,
} from './journal-api-aliases.js'
import { buildSandboxBindingsMap } from './sandbox-bindings.js'

const TOOL_SCHEMA_STRING_CACHE = new WeakMap<ToolDefinition, string>()

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

    private readonly registryProvider: ProjectRegistryProvider | undefined
    private readonly hasDispatcher: boolean
    private readonly fnSchemas = new WeakMap<object, string>()

    constructor(tools: ToolDefinition[], dispatcher?: ToolDispatcher, registryProvider?: ProjectRegistryProvider) {
        this.registryProvider = registryProvider
        this.hasDispatcher = dispatcher !== undefined
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

        for (const [groupName, groupTools] of this.toolsByGroup.entries()) {
            const groupApi = this.groupApiMap[groupName]
            if (!groupApi) continue
            for (const tool of groupTools) {
                const methodName = toolNameToMethodName(tool.name, groupName)
                const fn = groupApi[methodName]
                if (typeof fn === 'function') {
                    this.fnSchemas.set(fn, this.getToolSchemaString(tool))
                }
            }
        }

        this.wireCrossGroupAliases()
        this.wireProjectAndTeamAliases()
        this.wireMethodAliases()
    }

    private getToolSchemaString(tool: ToolDefinition): string {
        let typeStr = TOOL_SCHEMA_STRING_CACHE.get(tool)
        if (typeStr === undefined) {
            typeStr = getZodTypeString(tool.inputSchema)
            TOOL_SCHEMA_STRING_CACHE.set(tool, typeStr)
        }
        return typeStr
    }

    private copyFnSchema(source: unknown, wrapper: (...args: unknown[]) => unknown): void {
        if (typeof source === 'function') {
            const schemaStr = this.fnSchemas.get(source)
            if (schemaStr !== undefined) {
                this.fnSchemas.set(wrapper, schemaStr)
            }
        }
    }

    private wireCrossGroupAliases(): void {
        const searchEntriesFn = this.search['searchEntries']
        if (searchEntriesFn) {
            this.core['searchEntries'] = searchEntriesFn
            this.core['search'] = searchEntriesFn
            this.core['listEntries'] = searchEntriesFn
            const readQueryFn = async (...args: unknown[]): Promise<unknown> => {
                const res = await searchEntriesFn(...args)
                return isRecord(res) && 'entries' in res ? { ...res, rows: res['entries'] } : res
            }
            this.copyFnSchema(searchEntriesFn, readQueryFn)
            this.core['readQuery'] = readQueryFn
        }

        const enrichEntryRecord = (
            rec: Record<string, unknown>,
            fallbackWs?: unknown,
            fallbackProj?: unknown
        ): void => {
            const itemWs = rec['workspace_id'] ?? rec['workspaceId']
            const itemWsNorm = typeof itemWs === 'string' ? itemWs.trim().toLowerCase() : ''
            const fallbackWsNorm = typeof fallbackWs === 'string' ? fallbackWs.trim().toLowerCase() : ''
            const itemNamesOtherWs =
                itemWsNorm !== '' &&
                (itemWsNorm === 'default' ? fallbackWsNorm !== 'default' : itemWsNorm !== fallbackWsNorm)
            if (itemWs === undefined && fallbackWs !== undefined) {
                rec['workspace_id'] = fallbackWs
            }
            // [INVARIANT] Never propagate the batch root project_number onto an item that names another workspace.
            if (
                rec['project_number'] === undefined &&
                rec['projectNumber'] === undefined &&
                fallbackProj !== undefined &&
                !itemNamesOtherWs
            ) {
                rec['project_number'] = fallbackProj
            }
            if (typeof rec['project_number'] === 'string') {
                const cleaned = rec['project_number'].trim()
                const pMatch = /^p-?(\d+)$/i.exec(cleaned)
                const candidate = pMatch?.[1] ?? cleaned
                const num = /^\d+$/.test(candidate) ? Number(candidate) : Number.NaN
                if (Number.isInteger(num) && num > 0) {
                    rec['project_number'] = num
                } else {
                    throw new ValidationError(
                        `Invalid project_number '${rec['project_number']}'. Expected a positive integer.`
                    )
                }
            }
            const currentWs = rec['workspace_id'] ?? rec['workspaceId']
            const projNum =
                typeof rec['project_number'] === 'number'
                    ? rec['project_number']
                    : typeof rec['projectNumber'] === 'number'
                      ? rec['projectNumber']
                      : undefined
            const hasExplicitWs =
                typeof currentWs === 'string' && currentWs.trim() !== '' && currentWs.trim() !== '*'
            // [INVARIANT] No content/tag/CWD guessing: defer project-only workspace resolution
            // to `secure-dispatcher` so session scope pair-checking runs first.
            if (hasExplicitWs) {
                const trimmedWs = currentWs.trim()
                const providerRegistry = readProjectRegistryPayload(this.registryProvider?.())
                const resolved = resolveProjectContext(
                    {
                        workspace_id: trimmedWs,
                        ...(projNum !== undefined ? { project_number: projNum } : {}),
                    },
                    providerRegistry !== undefined ? { projectRegistry: providerRegistry } : undefined
                )
                if (projNum !== undefined) {
                    pairStoredScope(trimmedWs, projNum, activeProjectRegistry(providerRegistry))
                } else if (
                    trimmedWs.toLowerCase() !== 'default' &&
                    rec['project_number'] === undefined &&
                    rec['projectNumber'] === undefined &&
                    resolved.projectNumber !== undefined
                ) {
                    rec['project_number'] = resolved.projectNumber
                }
            }
        }

        const wrapEntryCreator = (
            origFn: (...args: unknown[]) => Promise<unknown>
        ): ((...args: unknown[]) => Promise<unknown>) => {
            const wrapper = async (...args: unknown[]): Promise<unknown> => {
                const params = args[0]
                if (isRecord(params)) {
                    enrichEntryRecord(params)
                    if (Array.isArray(params['entries'])) {
                        const topWs = params['workspace_id'] ?? params['workspaceId']
                        const topProj = params['project_number'] ?? params['projectNumber']
                        for (const item of params['entries']) {
                            if (isRecord(item)) enrichEntryRecord(item, topWs, topProj)
                        }
                    }
                }
                return await origFn(...args)
            }
            this.copyFnSchema(origFn, wrapper)
            return wrapper
        }

        const origCreateEntryFn = this.core['createEntry']
        if (origCreateEntryFn) {
            const wrappedCreateEntryFn = wrapEntryCreator(origCreateEntryFn)
            for (const key of Object.keys(this.core)) {
                if (this.core[key] === origCreateEntryFn) this.core[key] = wrappedCreateEntryFn
            }
            this.core['upsert'] = wrappedCreateEntryFn
        }

        const origTeamCreateEntryFn = this.team['teamCreateEntry']
        if (origTeamCreateEntryFn) {
            const wrappedTeamCreateEntryFn = wrapEntryCreator(origTeamCreateEntryFn)
            for (const key of Object.keys(this.team)) {
                if (this.team[key] === origTeamCreateEntryFn) {
                    this.team[key] = wrappedTeamCreateEntryFn
                }
            }
        }

        const origBatchCreateEntriesFn = this.admin['batchCreateEntries']
        if (origBatchCreateEntriesFn) {
            const wrappedBatchCreateFn = wrapEntryCreator(origBatchCreateEntriesFn)
            for (const key of Object.keys(this.admin)) {
                if (this.admin[key] === origBatchCreateEntriesFn) {
                    this.admin[key] = wrappedBatchCreateFn
                }
            }
        }

        const origTeamBatchCreateEntriesFn = this.team['teamBatchCreateEntries']
        if (origTeamBatchCreateEntriesFn) {
            const wrappedTeamBatchCreateFn = wrapEntryCreator(origTeamBatchCreateEntriesFn)
            for (const key of Object.keys(this.team)) {
                if (this.team[key] === origTeamBatchCreateEntriesFn) {
                    this.team[key] = wrappedTeamBatchCreateFn
                }
            }
        }

        for (const adminKey of ['deleteEntry', 'updateEntry', 'mergeTags', 'restoreEntry', 'searchAuditLog'] as const) {
            const fn = this.admin[adminKey]
            if (fn) this.core[adminKey] = fn
        }
        const deletedFn = this.search['listDeletedEntries']
        if (deletedFn) this.core['listDeletedEntries'] = deletedFn

        const semanticFn = this.search['semanticSearch']
        if (semanticFn) {
            const wrappedSemanticFn = async (...args: unknown[]): Promise<unknown> => {
                const res = await semanticFn(...args)
                if (isRecord(res) && Array.isArray(res['entries']) && res['entries'].length === 0) {
                    return { ...res, warning: 'Semantic search returned no entries' }
                }
                return res
            }
            this.copyFnSchema(semanticFn, wrappedSemanticFn)
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
            this.core['count'] = statsFn
            this.admin['analyze'] = statsFn
        }
        if (this.core['getEntryById']) this.core['exists'] = this.core['getEntryById']
        if (this.core['markAnchorsStale']) this.git['markAnchorsStale'] = this.core['markAnchorsStale']
        if (this.git['checkEntryStaleness']) this.core['checkEntryStaleness'] = this.git['checkEntryStaleness']
    }

    private wireProjectAndTeamAliases(): void {
        wireProjectAndTeamAliasesHelper({
            core: this.core,
            search: this.search,
            admin: this.admin,
            team: this.team,
            hasDispatcher: this.hasDispatcher,
            registryProvider: this.registryProvider,
            copyFnSchema: (source, wrapper) => this.copyFnSchema(source, wrapper),
        })
    }

    private wireMethodAliases(): void {
        const maintenanceUnavailable = (): Promise<{ success: false; error: string; code: string }> =>
            Promise.resolve({
                success: false,
                error: 'Maintenance call is not available',
                code: 'VALIDATION_ERROR',
            })
        for (const [groupName, aliases] of Object.entries(METHOD_ALIASES)) {
            const groupApi = this.groupApiMap[groupName]
            if (!groupApi) continue
            if (
                Object.values(aliases).includes('maintenanceUnavailable') &&
                typeof groupApi['maintenanceUnavailable'] !== 'function'
            ) {
                groupApi['maintenanceUnavailable'] = maintenanceUnavailable
            }
            for (const [aliasName, canonicalMethod] of Object.entries(aliases)) {
                if (typeof groupApi[aliasName] !== 'function' && typeof groupApi[canonicalMethod] === 'function') {
                    groupApi[aliasName] = groupApi[canonicalMethod]
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
        return buildSandboxSchemasMap({
            toolsByGroup: this.toolsByGroup,
            bindings: this.createSandboxBindings(),
            fnSchemas: this.fnSchemas,
            getToolSchemaString: (tool) => this.getToolSchemaString(tool),
        })
    }
}

export function createJournalApi(
    tools: ToolDefinition[],
    dispatcher?: ToolDispatcher,
    registryProvider?: ProjectRegistryProvider
): JournalApi {
    return new JournalApi(tools, dispatcher, registryProvider)
}
