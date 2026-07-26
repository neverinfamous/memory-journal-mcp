/**
 * JournalApi class — the main API object injected as `mj` in the sandbox.
 *
 * Exposes all Memory Journal tool groups as namespaced APIs with cross-group
 * wiring to handle common agent hallucinations.
 */

import type { ToolDefinition } from '../../types/index.js'
import type { ToolGroup } from '../../types/filtering.js'
import { sendProgress, type ProgressContext } from '../../utils/progress-utils.js'
import { METHOD_ALIASES } from '../api-constants.js'
import { getZodTypeString } from '../type-generator.js'
import type { ToolDispatcher, GroupApiRecord } from './types.js'
import { parseProjectRegistry } from './types.js'
import { resolveProjectContext } from '../../utils/workspace-resolver.js'
import { createGroupApi, toolNameToMethodName } from './group-factory.js'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

function isRecord(val: unknown): val is Record<string, unknown> {
    return typeof val === 'object' && val !== null && !Array.isArray(val)
}

// =============================================================================
// JournalApi Class
// =============================================================================

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
    readonly memory: GroupApiRecord // Alias for core to handle cross-server hallucinations

    private readonly toolsByGroup: Map<string, ToolDefinition[]>

    constructor(tools: ToolDefinition[], dispatcher?: ToolDispatcher) {
        // Group tools by their group property
        this.toolsByGroup = new Map()
        for (const tool of tools) {
            // Skip codemode tools (no recursion)
            if (tool.group === 'codemode') continue

            const existing = this.toolsByGroup.get(tool.group) ?? []
            existing.push(tool)
            this.toolsByGroup.set(tool.group, existing)
        }

        // Create group-specific APIs for all 9 groups
        this.core = createGroupApi('core', this.toolsByGroup.get('core') ?? [], dispatcher)
        this.search = createGroupApi('search', this.toolsByGroup.get('search') ?? [], dispatcher)
        this.analytics = createGroupApi(
            'analytics',
            this.toolsByGroup.get('analytics') ?? [],
            dispatcher
        )
        this.relationships = createGroupApi(
            'relationships',
            this.toolsByGroup.get('relationships') ?? [],
            dispatcher
        )
        this.io = createGroupApi('io', this.toolsByGroup.get('io') ?? [], dispatcher)
        this.admin = createGroupApi('admin', this.toolsByGroup.get('admin') ?? [], dispatcher)
        this.github = createGroupApi('github', this.toolsByGroup.get('github') ?? [], dispatcher)
        this.backup = createGroupApi('backup', this.toolsByGroup.get('backup') ?? [], dispatcher)
        this.team = createGroupApi('team', this.toolsByGroup.get('team') ?? [], dispatcher)
        this.git = createGroupApi('git', this.toolsByGroup.get('git') ?? [], dispatcher)
        this.memory = this.core

        // Smooth out common cross-group agent hallucinations
        const searchEntriesFn = this.search['searchEntries']
        if (searchEntriesFn) {
            this.core['searchEntries'] = searchEntriesFn
            this.core['search'] = searchEntriesFn
            this.core['listEntries'] = searchEntriesFn
            this.core['readQuery'] = async (...args: unknown[]) => {
                const res = await searchEntriesFn(...args)
                if (isRecord(res) && 'entries' in res) {
                    return { ...res, rows: res['entries'] }
                }
                return res
            }
        }

        // db-mcp bleedover: upsert maps to createEntry in journal context
        const _createEntryFn = this.core['createEntry']
        if (_createEntryFn) {
            // Auto-resolve workspaceId from projectNumber, content, tags, or registry if omitted by the script
            const wrappedCreateEntryFn = async (...args: unknown[]): Promise<unknown> => {
                const params = args[0]
                if (isRecord(params) && (params['workspace_id'] === undefined || params['workspace_id'] === 'default') && (params['workspaceId'] === undefined || params['workspaceId'] === 'default')) {
                    const projNum = typeof params['project_number'] === 'number' ? params['project_number'] : (typeof params['projectNumber'] === 'number' ? params['projectNumber'] : undefined)
                    const contentStr = typeof params['content'] === 'string' ? params['content'] : undefined
                    const tagsArr = Array.isArray(params['tags']) ? params['tags'].filter((t): t is string => typeof t === 'string') : undefined
                    
                    const resolved = resolveProjectContext({
                        project_number: projNum,
                        content: contentStr,
                        tags: tagsArr
                    })
                    if (resolved.workspaceId && resolved.workspaceId !== 'default') {
                        params['workspace_id'] = resolved.workspaceId
                        params['workspaceId'] = resolved.workspaceId
                    }
                }
                return await _createEntryFn(...args)
            }
            
            // Re-map all aliases that pointed to the original function
            for (const key of Object.keys(this.core)) {
                if (this.core[key] === _createEntryFn) {
                    this.core[key] = wrappedCreateEntryFn
                }
            }
            this.core['upsert'] = wrappedCreateEntryFn
        }

        // Cross-group: admin operations commonly attempted on core
        const deleteEntryFn = this.admin['deleteEntry']
        if (deleteEntryFn) this.core['deleteEntry'] = deleteEntryFn
        const updateEntryFn = this.admin['updateEntry']
        if (updateEntryFn) this.core['updateEntry'] = updateEntryFn
        const mergeTagsFn = this.admin['mergeTags']
        if (mergeTagsFn) this.core['mergeTags'] = mergeTagsFn
        const restoreEntryFn = this.admin['restoreEntry']
        if (restoreEntryFn) this.core['restoreEntry'] = restoreEntryFn
        const auditLogFn = this.admin['searchAuditLog']
        if (auditLogFn) this.core['searchAuditLog'] = auditLogFn

        const deletedFn = this.search['listDeletedEntries']
        if (deletedFn) this.core['listDeletedEntries'] = deletedFn

        // §2.2: Cross-group — agents commonly attempt mj.core.semanticSearch()
        const semanticFn = this.search['semanticSearch']
        const searchEntriesFallbackFn = this.search['searchEntries']
        if (semanticFn) {
            const wrappedSemanticFn = async (...args: unknown[]): Promise<unknown> => {
                const res = await semanticFn(...args)
                if (isRecord(res) && 'entries' in res) {
                    const entries = res['entries']
                    if (Array.isArray(entries) && entries.length === 0 && searchEntriesFallbackFn) {
                        const params = args[0]
                        if (isRecord(params) && typeof params['query'] === 'string') {
                            const fallback = await searchEntriesFallbackFn(...args)
                            if (isRecord(fallback) && 'entries' in fallback) {
                                const fallbackEntries = fallback['entries']
                                if (Array.isArray(fallbackEntries) && fallbackEntries.length > 0) {
                                    return fallback
                                }
                            }
                        }
                    }
                }
                return res
            }
            this.search['semanticSearch'] = wrappedSemanticFn
            this.core['semanticSearch'] = wrappedSemanticFn
        }

        // §2.1: Cross-group — agents commonly attempt mj.core.vectorStats() / mj.core.rebuildVectorIndex()
        const vectorStatsFn = this.search['getVectorIndexStats']
        if (vectorStatsFn) {
            this.core['getVectorIndexStats'] = vectorStatsFn
            this.core['vectorStats'] = vectorStatsFn
        }
        const rebuildVectorFn = this.admin['rebuildVectorIndex']
        if (rebuildVectorFn) this.core['rebuildVectorIndex'] = rebuildVectorFn
        const addToVectorFn = this.admin['addToVectorIndex']
        if (addToVectorFn) this.core['addToVectorIndex'] = addToVectorFn

        // Cross-group: io/backup operations commonly attempted on core
        const exportFn = this.io['exportEntries']
        if (exportFn) this.core['exportEntries'] = exportFn
        const backupFn = this.backup['backupJournal']
        if (backupFn) this.core['backupJournal'] = backupFn

        // Cross-group: db-mcp admin operations mapping to backup
        const restoreFn = this.backup['restoreBackup']
        if (backupFn) this.admin['backup'] = backupFn
        if (restoreFn) this.admin['restoreBackup'] = restoreFn

        // Smooth out getConfig hallucination via Constructor Wiring
        const getConfigFn = (): Promise<{ PROJECT_REGISTRY: unknown[] | undefined; dbPath: string }> =>
            Promise.resolve({
                PROJECT_REGISTRY: parseProjectRegistry(),
                dbPath: 'memory://internal',
            })
        this.admin['getConfig'] = getConfigFn
        this.core['getConfig'] = getConfigFn

        // db-mcp bleedover: database operations → closest journal equivalents
        const statsFn = this.analytics['getStatistics']
        if (statsFn) {
            this.core['count'] = statsFn
            this.core['listTables'] = statsFn
            this.core['describeTable'] = statsFn
            this.admin['analyze'] = statsFn
        }
        const getByIdFn = this.core['getEntryById']
        if (getByIdFn) this.core['exists'] = getByIdFn

        // Expose Project methods natively to admin API
        this.admin['registerProject'] = async (...args: unknown[]): Promise<{ success: boolean, message: string }> => {
            const name = args[0] as string
            const absolutePath = args[1] as string
            const projectNumber = args[2] as number | undefined
            
            const configPath = process.env['MEMORY_JOURNAL_CONFIG'] ?? path.resolve(os.homedir(), '.gemini', 'config', 'memory-journal.config.json')
            let config: Record<string, unknown> = { projectRegistry: {} }
            if (fs.existsSync(configPath)) {
                try {
                    config = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as Record<string, unknown>
                } catch {
                    // Ignore parse error
                }
            }
            config['projectRegistry'] ??= {}
            const registry = config['projectRegistry'] as Record<string, { path: string, project_number?: number }>
            registry[name] = { path: absolutePath }
            if (typeof projectNumber === 'number' && !Number.isNaN(projectNumber)) {
                registry[name].project_number = projectNumber
            }
            fs.mkdirSync(path.dirname(configPath), { recursive: true })
            fs.writeFileSync(configPath, JSON.stringify(config, null, 4), 'utf-8')
            
            // Update env for subsequent parseProjectRegistry calls
            process.env['PROJECT_REGISTRY'] = JSON.stringify(config['projectRegistry'])
            
            const createEntryFn = this.core['createEntry']
            if (!createEntryFn) {
                return { success: true, message: `Project '${name}' registered, but createEntry tool is missing. DB init skipped.` }
            }
            try {
                await createEntryFn({
                    entryType: 'project_decision',
                    significanceType: 'architecture',
                    content: `Initialized project ${name}`,
                    tags: ['project-initialization', 'setup'],
                    projectNumber: projectNumber ?? 0,
                    trustScore: 1.0,
                    impactScore: 0.8,
                    autoContext: JSON.stringify({ action: 'register_project', target: name })
                })
            } catch {
                // Ignore DB initialization failures natively
            }
            return { success: true, message: `Project '${name}' successfully registered.` }
        }

        this.admin['updateProject'] = (...args: unknown[]): Promise<{ success: boolean, message?: string, error?: string }> => {
            const name = args[0] as string
            const newName = args[1] as string | undefined
            const absolutePath = args[2] as string | undefined
            const projectNumber = args[3] as number | undefined
            
            const configPath = process.env['MEMORY_JOURNAL_CONFIG'] ?? path.resolve(os.homedir(), '.gemini', 'config', 'memory-journal.config.json')
            let config: Record<string, unknown> = { projectRegistry: {} }
            if (fs.existsSync(configPath)) {
                try { config = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as Record<string, unknown> } catch { /* no-op */ }
            }
            config['projectRegistry'] ??= {}
            const registry = config['projectRegistry'] as Record<string, { path: string, project_number?: number }>
            
            if (!registry[name]) return Promise.resolve({ success: false, error: `🛠️ AUTONOMOUS HEALING: Project not found: '${name}'` })
            
            const project = registry[name]
            if (absolutePath) project.path = absolutePath
            if (typeof projectNumber === 'number' && !Number.isNaN(projectNumber)) project.project_number = projectNumber
            
            const targetName = newName ?? name
            const { [name]: removed, ...rest } = registry
            void removed
            const newRegistry = { ...rest, [targetName]: project }
            config['projectRegistry'] = newRegistry
            fs.mkdirSync(path.dirname(configPath), { recursive: true })
            fs.writeFileSync(configPath, JSON.stringify(config, null, 4), 'utf-8')
            process.env['PROJECT_REGISTRY'] = JSON.stringify(config['projectRegistry'])
            
            return Promise.resolve({ success: true, message: `Project '${targetName}' updated.` })
        }

        this.admin['deleteProject'] = (...args: unknown[]): Promise<{ success: boolean, message?: string, error?: string }> => {
            const name = args[0] as string
            
            const configPath = process.env['MEMORY_JOURNAL_CONFIG'] ?? path.resolve(os.homedir(), '.gemini', 'config', 'memory-journal.config.json')
            let config: Record<string, unknown> = { projectRegistry: {} }
            if (fs.existsSync(configPath)) {
                try { config = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as Record<string, unknown> } catch { /* no-op */ }
            }
            config['projectRegistry'] ??= {}
            const registry = config['projectRegistry'] as Record<string, { path: string, project_number?: number }>
            
            if (!registry[name]) return Promise.resolve({ success: false, error: `🛠️ AUTONOMOUS HEALING: Project not found: '${name}'` })
            
            const { [name]: removed, ...rest } = registry
            void removed
            config['projectRegistry'] = rest
            fs.mkdirSync(path.dirname(configPath), { recursive: true })
            fs.writeFileSync(configPath, JSON.stringify(config, null, 4), 'utf-8')
            process.env['PROJECT_REGISTRY'] = JSON.stringify(config['projectRegistry'])
            
            return Promise.resolve({ success: true, message: `Project '${name}' deleted.` })
        }

        this.admin['listProjects'] = (): Promise<{ success: boolean, projects: unknown }> => {
            const configPath = process.env['MEMORY_JOURNAL_CONFIG'] ?? path.resolve(os.homedir(), '.gemini', 'config', 'memory-journal.config.json')
            let config: Record<string, unknown> = { projectRegistry: {} }
            if (fs.existsSync(configPath)) {
                try { config = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as Record<string, unknown> } catch { /* no-op */ }
            }
            return Promise.resolve({ success: true, projects: config['projectRegistry'] ?? {} })
        }

        this.admin['getProject'] = (...args: unknown[]): Promise<{ success: boolean, project?: unknown, error?: string }> => {
            const name = args[0] as string
            const configPath = process.env['MEMORY_JOURNAL_CONFIG'] ?? path.resolve(os.homedir(), '.gemini', 'config', 'memory-journal.config.json')
            let config: Record<string, unknown> = { projectRegistry: {} }
            if (fs.existsSync(configPath)) {
                try { config = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as Record<string, unknown> } catch { /* no-op */ }
            }
            const registry = config['projectRegistry'] as Record<string, { path: string, project_number?: number }> | undefined
            if (!registry?.[name]) return Promise.resolve({ success: false, error: `🛠️ AUTONOMOUS HEALING: Project not found: '${name}'` })
            return Promise.resolve({ success: true, project: { name, ...(registry[name] ?? {}) } })
        }

        // Smooth out team aliases since KEEP_PREFIX_GROUPS makes them verbose
        const teamDeleteEntryFn = this.team['teamDeleteEntry']
        if (teamDeleteEntryFn) {
            this.team['deleteEntry'] = teamDeleteEntryFn
            this.team['delete'] = teamDeleteEntryFn
        }
        const teamUpdateEntryFn = this.team['teamUpdateEntry']
        if (teamUpdateEntryFn) {
            this.team['updateEntry'] = teamUpdateEntryFn
            this.team['update'] = teamUpdateEntryFn
        }
        const teamCreateEntryFn = this.team['teamCreateEntry']
        if (teamCreateEntryFn) {
            this.team['createEntry'] = teamCreateEntryFn
            this.team['create'] = teamCreateEntryFn
        }

        // Implement listProjects hallucination gracefully across groups
        const listProjectsFn = async (): Promise<unknown> => {
            try {
                const registry = parseProjectRegistry()
                if (registry !== undefined) return registry
            } catch {
                // Ignore parse errors and fallback to analytics
            }
            const statsFn = this.analytics['getStatistics']
            if (!statsFn) return Promise.reject(new Error('getStatistics is not available'))

            const stats = await statsFn({ group_by: 'month', project_breakdown: true })
            if (isRecord(stats) && 'projectBreakdown' in stats) {
                return stats['projectBreakdown']
            }
            return []
        }

        const getProjectFn = async (params?: unknown): Promise<unknown> => {
            try {
                let searchVal: string | number | undefined
                if (typeof params === 'number') searchVal = params
                else if (typeof params === 'string') searchVal = params
                if (isRecord(params)) {
                    const obj = params
                    if (typeof obj['project_number'] === 'number') searchVal = obj['project_number']
                    else if (typeof obj['projectNumber'] === 'number')
                        searchVal = obj['projectNumber']
                    else if (typeof obj['name'] === 'string') searchVal = obj['name']
                    else if (typeof obj['query'] === 'string') searchVal = obj['query']
                }

                if (searchVal !== undefined) {
                    const isNum = typeof searchVal === 'number' || !Number.isNaN(Number(searchVal))
                    const numVal = isNum ? Number(searchVal) : undefined
                    const strVal = String(searchVal).toLowerCase()

                    const projects = await listProjectsFn()
                    if (Array.isArray(projects)) {
                        const projArray = projects as unknown[]
                        const found = projArray.find((p: unknown) => {
                            if (!isRecord(p)) return false
                            const proj = p
                            if (numVal !== undefined && (proj['project_number'] === numVal || proj['projectNumber'] === numVal))
                                return true
                            if (strVal !== undefined && typeof proj['name'] === 'string') {
                                const projName = proj['name'].toLowerCase()
                                if (projName === strVal || projName.includes(strVal)) return true
                            }
                            return false
                        })
                        if (found !== undefined) return found
                    }
                }
            } catch {
                // Ignore error
            }
            throw new Error(`Project not found: ${JSON.stringify(params)}`)
        }

        this.core['listProjects'] = listProjectsFn
        this.core['searchProjects'] = listProjectsFn
        this.core['getProjects'] = listProjectsFn
        this.core['getProject'] = getProjectFn
        this.search['listProjects'] = listProjectsFn
        this.search['searchProjects'] = listProjectsFn
        this.search['getProjects'] = listProjectsFn
        this.search['getProject'] = getProjectFn
        this.admin['listProjects'] = listProjectsFn
        this.admin['getProjects'] = listProjectsFn
        this.admin['getProject'] = getProjectFn

        // Automatically map all METHOD_ALIASES into the group proxies to ensure the sandbox
        // worker proxy seamlessly inherits aliases without needing duplicate hardcoding.
        for (const [groupName, aliases] of Object.entries(METHOD_ALIASES)) {
            const groupApi = this[groupName as keyof JournalApi] as GroupApiRecord | undefined
            if (!groupApi) continue

            for (const [aliasName, canonicalMethod] of Object.entries(aliases)) {
                // Only wire up the alias if the canonical method actually exists in this group
                // (which protects against shadow aliasing bugs).
                if (typeof groupApi[canonicalMethod] === 'function') {
                    // Do not overwrite existing explicitly-wired methods or native tools
                    groupApi[aliasName] ??= groupApi[canonicalMethod]
                }
            }
        }
    }

    /**
     * Get all available groups
     */
    getGroups(): string[] {
        return [...this.toolsByGroup.keys()].sort()
    }

    /**
     * Get method names for a group
     */
    getGroupMethods(group: ToolGroup): string[] {
        const groupApi = this[group as keyof JournalApi] as GroupApiRecord | undefined
        if (!groupApi || typeof groupApi !== 'object') return []
        return Object.keys(groupApi)
            .filter((k) => k !== 'help')
            .sort()
    }

    /**
     * Create the sandbox bindings object.
     * This is the object injected as `mj` in the sandbox.
     * Includes group namespaces + top-level aliases for common operations.
     */
    createSandboxBindings(progressCtx?: ProgressContext): Record<string, unknown> {
        const bindings: Record<string, unknown> = {
            // Group namespaces
            core: this.core,
            search: this.search,
            analytics: this.analytics,
            relationships: this.relationships,
            io: this.io,
            // Backward-compat alias — agents using mj.export.* still work
            export: this.io,
            admin: this.admin,
            github: this.github,
            backup: this.backup,
            team: this.team,
            git: this.git,
            gitApi: this.git,
            memory: this.memory,

            // Top-level convenience aliases
            createEntry: this.core['createEntry'],
            getRecentEntries: this.core['getRecentEntries'],
            searchEntries: this.search['searchEntries'],
            getStatistics: this.analytics['getStatistics'],
            listProjects: this.core['listProjects'],
            searchProjects: this.core['listProjects'],
            getProjects: this.core['listProjects'],
            getProject: this.core['getProject'],
            getBriefing: this.core['getBriefing'],

            // Common hallucinated aliases mapped to correct endpoints to smooth out agent executions
            getConfig: this.core['getConfig'],
            addEntry: this.core['createEntry'],
            sqlite_journal_add_entry: this.core['createEntry'],
            entries: this.core,
            deleteEntry: this.admin['deleteEntry'],
            updateEntry: this.admin['updateEntry'],
            
            // Global Hallucinations
            readResource: (uri?: string) => {
                if (typeof uri === 'string') {
                    if (uri.startsWith('memory://briefing') && typeof this.core['getBriefing'] === 'function') {
                        return this.core['getBriefing']()
                    }
                    if ((uri.startsWith('memory://agent-id') || uri.startsWith('memory://config')) && typeof this.core['getConfig'] === 'function') {
                        return this.core['getConfig']()
                    }
                    if (uri.startsWith('memory://recent') && typeof this.core['getRecentEntries'] === 'function') {
                        return this.core['getRecentEntries']()
                    }
                    if (uri.startsWith('memory://statistics') && typeof this.analytics['getStatistics'] === 'function') {
                        return this.analytics['getStatistics']()
                    }
                    if (uri.startsWith('memory://tags') && typeof this.core['listTags'] === 'function') {
                        return this.core['listTags']()
                    }
                    if (uri.startsWith('memory://flags') && typeof this.team['teamListFlags'] === 'function') {
                        return this.team['teamListFlags']({ status: 'active' })
                    }
                    if (uri.startsWith('memory://insights') && typeof this.analytics['getCrossProjectInsights'] === 'function') {
                        return this.analytics['getCrossProjectInsights']()
                    }
                }
                const suggestions: Record<string, string> = {
                    'memory://recent': 'mj.core.getRecentEntries()',
                    'memory://statistics': 'mj.analytics.getStatistics()',
                    'memory://tags': 'mj.core.listTags()',
                    'memory://flags': 'mj.team.teamListFlags({ status: "active" })',
                    'memory://significant': 'mj.search.searchEntries({ sort_by: "importance" })',
                    'memory://insights': 'mj.analytics.getCrossProjectInsights()',
                }
                let hint = ''
                if (typeof uri === 'string') {
                    const match = Object.entries(suggestions).find(([k]) => uri.startsWith(k))
                    if (match !== undefined) {
                        hint = ` Try: ${match[1]}`
                    }
                }
                return Promise.reject(new Error(
                    `Code Mode cannot directly read MCP resources (e.g., memory://briefing) using readResource().${hint} Use the appropriate mj.* tools to query data, or read the resource via standard MCP client requests outside of Code Mode.`
                ))
            },

            // Extended top-level convenience aliases for common hallucinations
            find: this.search['searchEntries'],
            listEntries: this.search['searchEntries'],
            recent: this.core['getRecentEntries'],
            listTags: this.core['listTags'],
            semanticSearch: this.search['semanticSearch'],
            linkEntries: this.relationships['linkEntries'],
            mergeTags: this.admin['mergeTags'],
            exportEntries: this.io['exportEntries'],

            // Anti-Hallucination: setWorkspace interceptor
            setWorkspace: () => {
                return Promise.reject(new Error(
                    `Workspace changes should be done via parameters (e.g., passing \`workspace_id\` to tool functions), not through imperative state like setWorkspace().`
                ))
            },

            // Top-level help
            help: (): Promise<{
                groups: string[]
                totalMethods: number
                usage: string
            }> => {
                const groups = this.getGroups()
                let totalMethods = 0
                for (const group of groups) {
                    totalMethods += this.getGroupMethods(group as ToolGroup).length
                }
                return Promise.resolve({
                    groups,
                    totalMethods,
                    usage: 'Use mj.<group>.help() for group details. Example: mj.core.help()',
                })
            },
        }

        // Progress notification reporting
        bindings['reportProgress'] = async (
            progress: number,
            total?: number,
            message?: string
        ): Promise<void> => {
            await sendProgress(progressCtx, progress, total, message)
        }

        return bindings
    }

    /**
     * Create the sandbox schemas object.
     * Contains the TypeScript type string representation for each method.
     */
    createSandboxSchemas(): Record<string, Record<string, string>> {
        const schemas: Record<string, Record<string, string>> = {}

        for (const [groupName, tools] of this.toolsByGroup.entries()) {
            const groupSchemas: Record<string, string> = {}
            for (const tool of tools) {
                const methodName = toolNameToMethodName(tool.name, groupName)
                groupSchemas[methodName] = getZodTypeString(tool.inputSchema)
            }

            // Handle aliases
            const aliases = METHOD_ALIASES[groupName]
            if (aliases) {
                for (const [aliasName, canonicalName] of Object.entries(aliases)) {
                    if (groupSchemas[canonicalName] !== undefined) {
                        groupSchemas[aliasName] = groupSchemas[canonicalName]
                    }
                }
            }

            schemas[groupName] = groupSchemas
        }

        return schemas
    }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create a JournalApi instance from tool definitions.
 * Convenience factory for use in tool handler setup.
 *
 * @param tools - All non-codemode tool definitions
 * @param dispatcher - Optional SEC-1.1 dispatch gate (routes calls through callTool())
 */
export function createJournalApi(tools: ToolDefinition[], dispatcher?: ToolDispatcher): JournalApi {
    return new JournalApi(tools, dispatcher)
}
