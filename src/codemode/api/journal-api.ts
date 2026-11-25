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
import type {
    ToolDispatcher,
    GroupApiRecord,
    ProjectRegistryProvider,
    RegistryOpsConfig,
} from './types.js'
import { createGroupApi, toolNameToMethodName } from './group-factory.js'
import {
    buildSandboxSchemasMap,
    wireProjectAndTeamAliasesHelper,
} from './journal-api-aliases.js'
import { buildSandboxBindingsMap } from './sandbox-bindings.js'
import { wireCrossGroupAliasesHelper } from './cross-group-aliases.js'

const TOOL_SCHEMA_STRING_CACHE = new WeakMap<object, string>()
const TOOL_INSTANCE_IDS = new WeakMap<ToolDefinition, number>()
const SANDBOX_SCHEMAS_CACHE = new Map<string, Record<string, Record<string, string>>>()
const MAX_SANDBOX_SCHEMAS_CACHE = 16
let nextToolInstanceId = 1

function computeToolsCacheKey(tools: readonly ToolDefinition[]): string {
    const ids = new Array<number>(tools.length)
    for (let i = 0; i < tools.length; i++) {
        const tool = tools[i]
        if (tool === undefined) continue
        let id = TOOL_INSTANCE_IDS.get(tool)
        if (id === undefined) {
            id = nextToolInstanceId++
            TOOL_INSTANCE_IDS.set(tool, id)
        }
        ids[i] = id
    }
    return ids.join(',')
}

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
    private readonly toolsKey: string
    private readonly groupApiMap: Record<string, GroupApiRecord>

    private readonly registryProvider: ProjectRegistryProvider | undefined
    private readonly registryOpsConfig: RegistryOpsConfig | undefined
    private readonly hasDispatcher: boolean
    private readonly fnSchemas = new WeakMap<object, string>()

    constructor(
        tools: ToolDefinition[],
        dispatcher?: ToolDispatcher,
        registryProvider?: ProjectRegistryProvider,
        registryOpsConfig?: RegistryOpsConfig
    ) {
        this.registryProvider = registryProvider
        this.registryOpsConfig = registryOpsConfig
        this.hasDispatcher = dispatcher !== undefined
        this.toolsKey = computeToolsCacheKey(tools)
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
        const schemaKey =
            typeof tool.inputSchema === 'object' && tool.inputSchema !== null
                ? tool.inputSchema
                : tool
        let typeStr = TOOL_SCHEMA_STRING_CACHE.get(schemaKey)
        if (typeStr === undefined) {
            typeStr = getZodTypeString(tool.inputSchema)
            TOOL_SCHEMA_STRING_CACHE.set(schemaKey, typeStr)
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
        wireCrossGroupAliasesHelper({
            core: this.core,
            search: this.search,
            analytics: this.analytics,
            relationships: this.relationships,
            io: this.io,
            admin: this.admin,
            backup: this.backup,
            team: this.team,
            git: this.git,
            ...(this.registryProvider !== undefined ? { registryProvider: this.registryProvider } : {}),
            copyFnSchema: (source, wrapper) => this.copyFnSchema(source, wrapper),
        })
    }

    private wireProjectAndTeamAliases(): void {
        wireProjectAndTeamAliasesHelper({
            core: this.core,
            search: this.search,
            admin: this.admin,
            relationships: this.relationships,
            team: this.team,
            hasDispatcher: this.hasDispatcher,
            registryProvider: this.registryProvider,
            ...(this.registryOpsConfig !== undefined ? { registryOpsConfig: this.registryOpsConfig } : {}),
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

    getGroupMethods(group: string): string[] {
        const groupApi = Object.hasOwn(this.groupApiMap, group) ? this.groupApiMap[group] : undefined
        if (!groupApi) return []
        return Object.keys(groupApi)
            .filter((k) => k !== 'help')
            .sort()
    }

    createSandboxBindings(
        progressCtx?: ProgressContext | (() => ProgressContext | undefined)
    ): Record<string, unknown> {
        return buildSandboxBindingsMap(this, progressCtx)
    }

    createSandboxSchemas(): Record<string, Record<string, string>> {
        const cached = SANDBOX_SCHEMAS_CACHE.get(this.toolsKey)
        if (cached !== undefined) return cached

        const built = buildSandboxSchemasMap({
            toolsByGroup: this.toolsByGroup,
            bindings: this.createSandboxBindings(),
            fnSchemas: this.fnSchemas,
            getToolSchemaString: (tool) => this.getToolSchemaString(tool),
        })
        if (SANDBOX_SCHEMAS_CACHE.size >= MAX_SANDBOX_SCHEMAS_CACHE) {
            const oldestKey = SANDBOX_SCHEMAS_CACHE.keys().next().value
            if (oldestKey !== undefined) SANDBOX_SCHEMAS_CACHE.delete(oldestKey)
        }
        SANDBOX_SCHEMAS_CACHE.set(this.toolsKey, built)
        return built
    }
}

export function getCachedSandboxSchemas(
    tools: ToolDefinition[]
): Record<string, Record<string, string>> {
    const key = computeToolsCacheKey(tools)
    const cached = SANDBOX_SCHEMAS_CACHE.get(key)
    if (cached !== undefined) return cached
    return new JournalApi(tools).createSandboxSchemas()
}

export function createJournalApi(
    tools: ToolDefinition[],
    dispatcher?: ToolDispatcher,
    registryProvider?: ProjectRegistryProvider,
    registryOpsConfig?: RegistryOpsConfig
): JournalApi {
    return new JournalApi(tools, dispatcher, registryProvider, registryOpsConfig)
}
