/**
 * Sandbox bindings builder for JournalApi.
 */

import type { ToolGroup } from '../../types/filtering.js'
import { sendProgress, type ProgressContext } from '../../utils/progress-utils.js'
import type { GroupApiRecord } from './types.js'

export interface SandboxBindingsSource {
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
    getGroups(): string[]
    getGroupMethods(group: ToolGroup): string[]
}

const FACTORY_SHIM_NAMES = [
    'getInstance', 'get_instance', 'createInstance', 'create_instance',
    'getClient', 'get_client', 'createClient', 'create_client',
    'initClient', 'init_client', 'getService', 'get_service',
    'createService', 'create_service', 'getJournal', 'get_journal',
    'createJournal', 'create_journal', 'loadJournal', 'load_journal',
    'loadMemory', 'load_memory', 'load', 'init', 'initialize',
    'connect', 'open', 'start', 'create',
]

const CREATE_ENTRY_ALIAS_NAMES = [
    'createEntry', 'addEntry', 'append', 'appendEntry', 'append_entry',
    'logJournal', 'log_journal', 'logEntry', 'log_entry',
    'insertJournal', 'insert_journal', 'insertEntry', 'insert_entry',
    'addJournal', 'add_journal', 'saveJournalEntry', 'save_journal_entry',
    'createJournalEntry', 'create_journal_entry', 'sqlite_journal_add_entry',
    'memory_journal_create', 'journal_create', 'create_entry',
]

export function createHandleReadResource(api: SandboxBindingsSource): (uri?: string) => unknown {
    return (uri?: string): unknown => {
        if (typeof uri === 'string') {
            if (uri.startsWith('memory://briefing') && typeof api.core['getBriefing'] === 'function') return api.core['getBriefing']()
            if ((uri.startsWith('memory://agent-id') || uri.startsWith('memory://config')) && typeof api.core['getConfig'] === 'function') {
                return api.core['getConfig']()
            }
            if (uri.startsWith('memory://recent') && typeof api.core['getRecentEntries'] === 'function') return api.core['getRecentEntries']()
            if (uri.startsWith('memory://statistics') && typeof api.analytics['getStatistics'] === 'function') return api.analytics['getStatistics']()
            if (uri.startsWith('memory://tags') && typeof api.core['listTags'] === 'function') return api.core['listTags']()
            if (uri.startsWith('memory://flags') && typeof api.team['teamListFlags'] === 'function') {
                return api.team['teamListFlags']({ status: 'active' })
            }
            if (uri.startsWith('memory://insights') && typeof api.analytics['getCrossProjectInsights'] === 'function') {
                return api.analytics['getCrossProjectInsights']()
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
            if (match !== undefined) hint = ` Try: ${match[1]}`
        }
        return Promise.reject(
            new Error(
                `Code Mode cannot directly read MCP resources (e.g., memory://briefing) using readResource().${hint} Use the appropriate mj.* tools to query data, or read the resource via standard MCP client requests outside of Code Mode.`
            )
        )
    }
}

export function createSchemaCallable(analyticsApi: GroupApiRecord): unknown {
    const schemaHelpFn = (): Promise<unknown> =>
        Promise.resolve({
            group: 'schema',
            description: 'Memory Journal Schema: Embedded SQLite database storing entries, tags, entry tags, relationships, and projects.',
            tables: ['entries', 'tags', 'entry_tags', 'relationships', 'projects'],
            entrySchema: {
                id: 'number (auto-increment primary key)',
                title: 'string (required, entry title)',
                content: 'string (markdown body)',
                entry_type: "'journal' | 'retrospective' | 'decision' | 'note' | 'runbook'",
                tags: 'string[] (optional array of tags)',
                project_number: 'number (optional project number)',
                session_id: 'string (optional session tracking id)',
                metadata: 'Record<string, unknown> (optional JSON metadata)',
            },
            methods: ['help', 'describe', 'listTables', 'describeTable', 'getSchema'],
            usage: 'Call mj.core.createEntry.schema() for parameter validation details, or mj.analytics.getStatistics() for database statistics.',
        })

    return Object.assign(
        async (...args: unknown[]): Promise<unknown> => {
            const stats = analyticsApi['getStatistics']
            if (typeof stats === 'function') return stats(...args)
            return schemaHelpFn()
        },
        {
            help: schemaHelpFn,
            describe: schemaHelpFn,
            listTables: (): Promise<{ success: boolean; tables: string[] }> =>
                Promise.resolve({ success: true, tables: ['entries', 'tags', 'entry_tags', 'relationships', 'projects'] }),
            describeTable: (tableName?: string): Promise<unknown> => {
                const table = typeof tableName === 'string' ? tableName.toLowerCase() : 'entries'
                if (table === 'entries' || table === 'journal' || table === 'memory') return schemaHelpFn()
                return Promise.resolve({ table, description: `Table '${table}' in Memory Journal SQLite database.` })
            },
            getSchema: schemaHelpFn,
        }
    )
}

export function buildSandboxBindingsMap(api: SandboxBindingsSource, progressCtx?: ProgressContext): Record<string, unknown> {
    const handleReadResource = createHandleReadResource(api)
    const schemaCallable = createSchemaCallable(api.analytics)

    const bindings: Record<string, unknown> = {
        core: api.core,
        search: api.search,
        analytics: api.analytics,
        relationships: api.relationships,
        io: api.io,
        export: api.io,
        admin: api.admin,
        github: api.github,
        backup: api.backup,
        team: api.team,
        git: api.git,
        gitApi: api.git,
        memory: api.memory,
        entries: api.core,
        schema: schemaCallable,
        getSchema: schemaCallable,
        get_schema: schemaCallable,

        getRecentEntries: api.core['getRecentEntries'],
        recent: api.core['getRecentEntries'],
        get_recent_entries: api.core['getRecentEntries'],
        searchEntries: api.search['searchEntries'],
        find: api.search['searchEntries'],
        listEntries: api.search['searchEntries'],
        memory_journal_search: api.search['searchEntries'],
        journal_search: api.search['searchEntries'],
        search_entries: api.search['searchEntries'],
        getStatistics: api.analytics['getStatistics'],
        serverInfo: api.analytics['getStatistics'],
        serverHealth: api.analytics['getStatistics'],
        getServerInfo: api.analytics['getStatistics'],
        getServerHealth: api.analytics['getStatistics'],
        listProjects: api.core['listProjects'],
        searchProjects: api.core['listProjects'],
        getProjects: api.core['listProjects'],
        getProject: api.core['getProject'],
        getBriefing: api.core['getBriefing'],
        getConfig: api.core['getConfig'],
        deleteEntry: api.admin['deleteEntry'],
        delete_entry: api.admin['deleteEntry'],
        updateEntry: api.admin['updateEntry'],
        update_entry: api.admin['updateEntry'],
        get_entry_by_id: api.core['getEntryById'],
        listTags: api.core['listTags'],
        semanticSearch: api.search['semanticSearch'],
        linkEntries: api.relationships['linkEntries'],
        mergeTags: api.admin['mergeTags'],
        exportEntries: api.io['exportEntries'],

        readResource: handleReadResource,
        read_resource: handleReadResource,
        memory_read_resource: handleReadResource,
        memoryReadResource: handleReadResource,

        Agent: {
            system: {
                exec: () =>
                    Promise.reject(
                        new Error(
                            "🛠️ AUTONOMOUS HEALING: Code Mode sandbox cannot execute shell commands via 'Agent.system.exec'. To execute terminal commands or scripts, call 'run_command' outside of Code Mode in the agent shell."
                        )
                    ),
            },
            exec: () =>
                Promise.reject(
                    new Error(
                        "🛠️ AUTONOMOUS HEALING: Code Mode sandbox cannot execute shell commands via 'Agent.exec'. To execute terminal commands or scripts, call 'run_command' outside of Code Mode in the agent shell."
                    )
                ),
        },

        setWorkspace: () =>
            Promise.reject(
                new Error(
                    'Workspace changes should be done via parameters (e.g., passing `workspace_id` to tool functions), not through imperative state like setWorkspace().'
                )
            ),

        help: (): Promise<{ groups: string[]; totalMethods: number; usage: string }> => {
            const groups = api.getGroups()
            let totalMethods = 0
            for (const group of groups) totalMethods += api.getGroupMethods(group as ToolGroup).length
            return Promise.resolve({
                groups,
                totalMethods,
                usage: 'Use mj.<group>.help() for group details. Example: mj.core.help()',
            })
        },
        reportProgress: async (progress: number, total?: number, message?: string): Promise<void> => {
            await sendProgress(progressCtx, progress, total, message)
        },
    }

    for (const alias of CREATE_ENTRY_ALIAS_NAMES) bindings[alias] = api.core['createEntry']
    const selfShim = (): Record<string, unknown> => bindings
    for (const shim of FACTORY_SHIM_NAMES) bindings[shim] = selfShim

    return bindings
}
