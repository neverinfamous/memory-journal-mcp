/**
 * memory-journal-mcp - Code Mode API
 *
 * Generates the `mj.*` API object that is injected into the sandbox.
 * Each tool group becomes a namespace (e.g., `mj.core.createEntry()`).
 *
 * Architecture:
 * - Reads tool definitions from the handler barrel
 * - Groups tools by their `group` property
 * - Converts tool names to camelCase method names
 * - Creates proxy methods that normalize positional args and call handlers
 * - Exposes `help()` at top level and per-group for discoverability
 */

import type { ToolDefinition } from '../types/index.js'
import type { ToolGroup } from '../types/filtering.js'
import {
    METHOD_ALIASES,
    GROUP_EXAMPLES,
    POSITIONAL_PARAM_MAP,
    GROUP_PREFIX_MAP,
    KEEP_PREFIX_GROUPS,
} from './api-constants.js'

/**
 * Dispatcher function signature for SEC-1.1 Code Mode dispatch gate.
 * When provided, sandbox tool calls are routed through callTool() instead
 * of calling raw tool handlers, ensuring scope/maintenance/audit apply.
 */
export type ToolDispatcher = (name: string, args: Record<string, unknown>) => Promise<unknown>

/**
 * Convert tool name to camelCase method name.
 *
 * Examples:
 *   create_entry (core)         → createEntry
 *   search_entries (search)     → searchEntries
 *   get_github_issues (github)  → getGithubIssues
 *   team_create_entry (team)    → teamCreateEntry
 *   backup_journal (backup)     → backupJournal
 */
export function toolNameToMethodName(toolName: string, groupName: string): string {
    let name = toolName

    // For groups not in KEEP_PREFIX_GROUPS, strip the group prefix
    if (!KEEP_PREFIX_GROUPS.has(groupName)) {
        const groupPrefix = GROUP_PREFIX_MAP[groupName] ?? ''
        if (groupPrefix && name.startsWith(groupPrefix)) {
            name = name.substring(groupPrefix.length)
        }
    }

    // Convert snake_case to camelCase
    return name.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase())
}

// =============================================================================
// Parameter Normalization
// =============================================================================

/**
 * Normalize parameters to support positional arguments.
 * Handles both single positional args and multiple positional args.
 */
function normalizeParams(methodName: string, args: unknown[]): unknown {
    if (args.length === 0) return undefined

    if (args.length === 1) {
        const arg = args[0]

        // Object arg — pass through
        if (typeof arg === 'object' && arg !== null && !Array.isArray(arg)) {
            return arg
        }

        // Primitive arg (string, number, boolean) — use positional mapping
        if (typeof arg === 'string' || typeof arg === 'number' || typeof arg === 'boolean') {
            const paramMapping = POSITIONAL_PARAM_MAP[methodName]
            if (typeof paramMapping === 'string') {
                return { [paramMapping]: arg }
            }
            if (Array.isArray(paramMapping) && paramMapping[0] !== undefined) {
                return { [paramMapping[0]]: arg }
            }
            // Fallback: try common names (only for strings)
            if (typeof arg === 'string') {
                return { content: arg, query: arg }
            }
            return arg
        }

        return arg
    }

    // Multi-arg: use positional parameter mapping
    const paramMapping = POSITIONAL_PARAM_MAP[methodName]
    if (paramMapping === undefined) {
        return args[0]
    }

    if (typeof paramMapping === 'string') {
        const result: Record<string, unknown> = { [paramMapping]: args[0] }
        if (args.length > 1) {
            const lastArg = args[args.length - 1]
            if (typeof lastArg === 'object' && lastArg !== null && !Array.isArray(lastArg)) {
                Object.assign(result, lastArg)
            }
        }
        return result
    }

    // Array mapping — map positional args to named params
    const result: Record<string, unknown> = {}

    for (let i = 0; i < paramMapping.length && i < args.length; i++) {
        const key = paramMapping[i]
        if (key !== undefined) {
            result[key] = args[i]
        }
    }

    // Merge trailing options object
    if (args.length > paramMapping.length) {
        const lastArg = args[args.length - 1]
        if (typeof lastArg === 'object' && lastArg !== null && !Array.isArray(lastArg)) {
            Object.assign(result, lastArg)
        }
    }

    return result
}

// =============================================================================
// Group API Factory
// =============================================================================

/** Type alias for group API record */
type GroupApiRecord = Record<string, (...args: unknown[]) => Promise<unknown>>

/**
 * Create a group API from tool definitions.
 * Each tool becomes a method on the group object.
 *
 * @param groupName - Tool group name (e.g., 'core', 'search')
 * @param tools - Tool definitions for this group
 * @param dispatcher - Optional SEC-1.1 dispatch gate; when provided, calls go
 *   through callTool() rather than tool.handler() for full middleware enforcement.
 */
function createGroupApi(
    groupName: string,
    tools: ToolDefinition[],
    dispatcher?: ToolDispatcher
): GroupApiRecord {
    const api: GroupApiRecord = {}

    for (const tool of tools) {
        const methodName = toolNameToMethodName(tool.name, groupName)

        api[methodName] = (...args: unknown[]): Promise<unknown> => {
            const normalizedParams = normalizeParams(methodName, args) ?? {}
            // SEC-1.1: Route through dispatcher (callTool gate) when available.
            // Dispatcher enforces scope checks, maintenance mode, and audit.
            if (dispatcher) {
                return dispatcher(tool.name, normalizedParams as Record<string, unknown>)
            }
            return Promise.resolve(tool.handler(normalizedParams))
        }
    }

    // Add method aliases
    const aliases = METHOD_ALIASES[groupName]
    if (aliases) {
        for (const [aliasName, canonicalName] of Object.entries(aliases)) {
            if (api[canonicalName] !== undefined) {
                api[aliasName] = api[canonicalName]
            }
        }
    }

    // Add help() for discoverability
    api['help'] = (): Promise<{
        group: string
        methods: string[]
        examples: string[]
    }> => {
        const methods = Object.keys(api)
            .filter((k) => k !== 'help')
            .sort()

        return Promise.resolve({
            group: groupName,
            methods,
            examples: GROUP_EXAMPLES[groupName] ?? [],
        })
    }

    return api
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
        this.analytics = createGroupApi('analytics', this.toolsByGroup.get('analytics') ?? [], dispatcher)
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
    createSandboxBindings(): Record<string, unknown> {
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

            // Top-level convenience aliases
            createEntry: this.core['createEntry'],
            getRecentEntries: this.core['getRecentEntries'],
            searchEntries: this.search['searchEntries'],
            getStatistics: this.analytics['getStatistics'],

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

        return bindings
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
