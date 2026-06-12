/**
 * Group API factory for Code Mode.
 *
 * Creates namespaced API objects from tool definitions, with method aliases
 * and help() for discoverability.
 */

import type { ToolDefinition } from '../../types/index.js'
import {
    METHOD_ALIASES,
    GROUP_EXAMPLES,
    GROUP_PREFIX_MAP,
    KEEP_PREFIX_GROUPS,
} from '../api-constants.js'
import type { ToolDispatcher, GroupApiRecord } from './types.js'
import { normalizeParams } from './param-normalizer.js'

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

/**
 * Create a group API from tool definitions.
 * Each tool becomes a method on the group object.
 *
 * @param groupName - Tool group name (e.g., 'core', 'search')
 * @param tools - Tool definitions for this group
 * @param dispatcher - Optional SEC-1.1 dispatch gate; when provided, calls go
 *   through callTool() rather than tool.handler() for full middleware enforcement.
 */
export function createGroupApi(
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

        // Attach original snake_case tool name for backward compatibility with tests and agents
        if (tool.name !== methodName) {
            api[tool.name] = api[methodName]
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
