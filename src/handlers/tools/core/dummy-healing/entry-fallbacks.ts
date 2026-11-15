import { z } from 'zod'
import type { ToolDefinition, ToolContext } from '../../../../types/index.js'
import { getCoreTools } from '../tools.js'
import { getSearchTools } from '../../search/index.js'
import { getAdminTools } from '../../admin/index.js'
import { getCodeModeTools } from '../../codemode/handler.js'
import { ErrorFieldsMixin } from '../../error-fields-mixin.js'
import { healAgentHallucinations } from '../../schemas.js'
import { methodTokens } from '../../../../codemode/method-tokens.js'
import {
    DUMMY_ENTRY_CREATION_TOOL_NAMES,
    DUMMY_MJ_FUNC_TOOL_NAMES,
    DUMMY_DOTTED_TOOL_NAMES,
    DUMMY_SQL_EXECUTION_TOOL_NAMES,
    DUMMY_PROJECT_TOOL_NAMES,
    projectAliasTarget,
} from './alias-catalog.js'

export { projectAliasTarget }

const FLEXIBLE_PASSTHROUGH_SCHEMA = z.looseObject({ ...ErrorFieldsMixin.shape })

export async function handleCreateEntry(
    params: unknown,
    toolName: string,
    context?: ToolContext
): Promise<unknown> {
    const rawArgs =
        typeof params === 'object' && params !== null ? (params as Record<string, unknown>) : {}
    const preArgs: Record<string, unknown> = { ...rawArgs }

    if (preArgs['topic'] !== undefined) {
        if (preArgs['tags'] === undefined) {
            preArgs['tags'] = [preArgs['topic']]
        } else if (Array.isArray(preArgs['tags'])) {
            preArgs['tags'] = [...(preArgs['tags'] as unknown[]), preArgs['topic']]
        }
        delete preArgs['topic']
    }

    if (preArgs['category'] !== undefined && preArgs['entry_type'] === undefined) {
        preArgs['entry_type'] = preArgs['category']
        delete preArgs['category']
    }

    const healed = healAgentHallucinations(preArgs)
    const args: Record<string, unknown> =
        typeof healed === 'object' && healed !== null
            ? (healed as Record<string, unknown>)
            : preArgs

    if (context !== undefined) {
        const coreTools = getCoreTools(context)
        const createTool = coreTools.find((t: ToolDefinition) => t.name === 'create_entry')
        if (createTool !== undefined) {
            const result = await Promise.resolve(createTool.handler(args))
            if (typeof result === 'object' && result !== null) {
                const resultRecord = result as Record<string, unknown>
                const succeeded = resultRecord['success'] !== false
                return {
                    ...resultRecord,
                    _healing_note: succeeded
                        ? `🛠️ AUTONOMOUS HEALING: '${toolName}' was invoked directly as an MCP tool. The entry was created successfully. In Code Mode, prefer using 'mj_execute_code' with 'mj.core.createEntry({ ... })'.`
                        : `🛠️ AUTONOMOUS HEALING: '${toolName}' was invoked directly as an MCP tool and routed to create_entry, but the entry was NOT created. Fix the reported error and retry, preferring 'mj_execute_code' with 'mj.core.createEntry({ ... })'.`,
                }
            }
            return result
        }
    }
    return {
        success: false,
        error: `🛠️ AUTONOMOUS HEALING: '${toolName}' is not directly active in Code Mode. Use 'mj_execute_code' with 'mj.core.createEntry({ ... })'.`,
        code: 'VALIDATION_ERROR',
        category: 'validation',
        recoverable: true,
    }
}

async function routeNamedTargetTool(
    name: string,
    targetToolName: string,
    group: 'core' | 'search' | 'admin',
    args: Record<string, unknown>,
    context?: ToolContext
): Promise<unknown> {
    if (context === undefined) return undefined
    const tools =
        group === 'core'
            ? getCoreTools(context)
            : group === 'search'
              ? getSearchTools(context)
              : getAdminTools(context)
    const tool = tools.find((t) => t.name === targetToolName)
    if (tool === undefined) return undefined
    const res = await Promise.resolve(tool.handler(args))
    if (typeof res !== 'object' || res === null) return res
    const resRecord = res as Record<string, unknown>
    return {
        ...resRecord,
        _healing_note:
            resRecord['success'] !== false
                ? `🛠️ AUTONOMOUS HEALING: '${name}' was routed to '${targetToolName}' and executed successfully.`
                : `🛠️ AUTONOMOUS HEALING: '${name}' was routed to '${targetToolName}', but the operation did not succeed. See the reported error.`,
    }
}

function isProjectAlias(name: string): boolean {
    return (
        name === 'mj.projects' ||
        methodTokens(name).some((token) => token === 'project' || token === 'projects')
    )
}

/** True when the alias's whole tokens end with `suffix` (e.g. `mj_core_delete_entry` ends with `delete entry`). */
function endsWithTokens(tokens: string[], suffix: string[]): boolean {
    if (tokens.length < suffix.length) return false
    const offset = tokens.length - suffix.length
    return suffix.every((token, i) => tokens[offset + i] === token)
}

const ENTRY_ALIAS_TARGETS: readonly {
    tokens: string[]
    target: string
    group: 'core' | 'search' | 'admin'
}[] = [
    { tokens: ['create', 'entry'], target: 'create_entry', group: 'core' },
    { tokens: ['search', 'entries'], target: 'search_entries', group: 'search' },
    { tokens: ['get', 'recent', 'entries'], target: 'get_recent_entries', group: 'core' },
    { tokens: ['get', 'entry', 'by', 'id'], target: 'get_entry_by_id', group: 'core' },
    { tokens: ['update', 'entry'], target: 'update_entry', group: 'admin' },
    { tokens: ['delete', 'entry'], target: 'delete_entry', group: 'admin' },
]

function resolveTargetFromAlias(
    name: string
): { target: string; group: 'core' | 'search' | 'admin' } | undefined {
    const tokens = methodTokens(name)
    const has = (t: string): boolean => tokens.includes(t)
    if (has('team') || has('batch')) return undefined

    for (const candidate of ENTRY_ALIAS_TARGETS) {
        if (endsWithTokens(tokens, candidate.tokens)) {
            return { target: candidate.target, group: candidate.group }
        }
    }
    if (isProjectAlias(name)) {
        const target = projectAliasTarget(name)
        if (target === undefined) return undefined
        return { target, group: 'admin' }
    }
    return undefined
}

const NON_READONLY_ALIAS_TARGETS = new Set(['create_entry', 'update_entry', 'delete_entry'])

function isReadOnlyDummyAlias(name: string): boolean {
    const resolved = resolveTargetFromAlias(name)
    return resolved !== undefined && !NON_READONLY_ALIAS_TARGETS.has(resolved.target)
}

export function getEntryAndCodemodeFallbackToolDefinitions(
    context?: ToolContext
): ToolDefinition[] {
    return [
        ...['create_entry', ...DUMMY_ENTRY_CREATION_TOOL_NAMES].map(
            (name): ToolDefinition => ({
                name,
                title: `Create Entry (${name} Fallback)`,
                description: `Fallback handler for \`${name}\` when called directly as an MCP tool.`,
                group: 'core',
                inputSchema: FLEXIBLE_PASSTHROUGH_SCHEMA,
                outputSchema: FLEXIBLE_PASSTHROUGH_SCHEMA,
                annotations: { readOnlyHint: false, openWorldHint: false },
                handler: async (params: unknown) => handleCreateEntry(params, name, context),
            })
        ),
        {
            name: 'search_entries',
            title: 'Search Entries (Code Mode Fallback)',
            description: 'Fallback handler for `search_entries` when called directly in Code Mode.',
            group: 'core',
            inputSchema: FLEXIBLE_PASSTHROUGH_SCHEMA,
            outputSchema: FLEXIBLE_PASSTHROUGH_SCHEMA,
            annotations: { readOnlyHint: true, openWorldHint: false },
            handler: async (params: unknown) => {
                const args =
                    typeof params === 'object' && params !== null
                        ? (params as Record<string, unknown>)
                        : {}
                if (context !== undefined) {
                    const searchTool = getSearchTools(context).find(
                        (t: ToolDefinition) => t.name === 'search_entries'
                    )
                    if (searchTool !== undefined) {
                        const result = await Promise.resolve(searchTool.handler(args))
                        if (typeof result === 'object' && result !== null) {
                            const record = result as Record<string, unknown>
                            const completed = record['success'] !== false
                            const outcome = completed ? 'Search completed successfully.' : 'Search did not succeed.'
                            return {
                                ...record,
                                _healing_note:
                                    `🛠️ AUTONOMOUS HEALING: \`search_entries\` was invoked directly while in Code Mode. ${outcome} In Code Mode, prefer using \`mj_execute_code\` with \`mj.search.searchEntries({ ... })\`.`,
                            }
                        }
                        return result
                    }
                }
                return {
                    success: false,
                    error: '🛠️ AUTONOMOUS HEALING: `search_entries` is not directly active in Code Mode. Use `mj_execute_code` with `mj.search.searchEntries({ ... })`.',
                    code: 'VALIDATION_ERROR',
                    category: 'validation',
                    recoverable: true,
                }
            },
        },
        ...(
            [
                ['get_recent_entries', 'Get Recent Entries', true, 'getRecentEntries'],
                ['get_entry_by_id', 'Get Entry By ID', true, 'getEntryById'],
                ['update_entry', 'Update Entry', false, 'updateEntry'],
                ['delete_entry', 'Delete Entry', false, 'deleteEntry'],
            ] as const
        ).map(
            ([name, label, readOnly, camelMethod]): ToolDefinition => ({
                name,
                title: `${label} (Code Mode Fallback)`,
                description: `Fallback handler for \`${name}\` when called directly in Code Mode.`,
                group: 'core',
                inputSchema: FLEXIBLE_PASSTHROUGH_SCHEMA,
                outputSchema: FLEXIBLE_PASSTHROUGH_SCHEMA,
                annotations: { readOnlyHint: readOnly, openWorldHint: false },
                handler: async (params: unknown) => {
                    const args =
                        typeof params === 'object' && params !== null
                            ? (params as Record<string, unknown>)
                            : {}
                    if (context !== undefined) {
                        const sourceTools =
                            name === 'update_entry' || name === 'delete_entry'
                                ? getAdminTools(context)
                                : getCoreTools(context)
                        const tool = sourceTools.find(
                            (t: ToolDefinition) => t.name === name
                        )
                        if (tool !== undefined) {
                            const res = await Promise.resolve(tool.handler(args))
                            if (typeof res !== 'object' || res === null) return res
                            const resRecord = res as Record<string, unknown>
                            return {
                                ...resRecord,
                                _healing_note:
                                    resRecord['success'] !== false
                                        ? `🛠️ AUTONOMOUS HEALING: '${name}' was invoked directly while in Code Mode and succeeded. In Code Mode, prefer using 'mj_execute_code' with 'mj.core.${camelMethod}({ ... })'.`
                                        : `🛠️ AUTONOMOUS HEALING: '${name}' was invoked directly while in Code Mode, but the operation did not succeed. In Code Mode, prefer using 'mj_execute_code' with 'mj.core.${camelMethod}({ ... })'.`,
                            }
                        }
                    }
                    return {
                        success: false,
                        error: `🛠️ AUTONOMOUS HEALING: \`${name}\` is not directly active in Code Mode. Use \`mj_execute_code\` with \`mj.core.${camelMethod}({ ... })\`.`,
                        code: 'VALIDATION_ERROR',
                        category: 'validation',
                        recoverable: true,
                    }
                },
            })
        ),
        ...DUMMY_MJ_FUNC_TOOL_NAMES.map(
            (name): ToolDefinition => ({
                name,
                title: `Code Mode Function Fallback (${name})`,
                description: `Fallback handler for \`${name}\` when called directly as an MCP tool.`,
                group: 'core',
                inputSchema: FLEXIBLE_PASSTHROUGH_SCHEMA,
                outputSchema: FLEXIBLE_PASSTHROUGH_SCHEMA,
                annotations: { readOnlyHint: isReadOnlyDummyAlias(name), openWorldHint: false },
                handler: async (params: unknown) => {
                    const args =
                        typeof params === 'object' && params !== null
                            ? (params as Record<string, unknown>)
                            : {}
                    const resolved = resolveTargetFromAlias(name)
                    if (resolved !== undefined) {
                        const routed = await routeNamedTargetTool(
                            name,
                            resolved.target,
                            resolved.group,
                            args,
                            context
                        )
                        if (routed !== undefined) return routed
                    }
                    const canonical = name
                        .replace(/^mj_([a-z]+)_/, 'mj.$1.')
                        .replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase())
                    return {
                        success: false,
                        error: `🛠️ AUTONOMOUS HEALING: '${name}' is a Code Mode function, not a top-level MCP tool. Use 'mj_execute_code' with JavaScript (e.g. return await ${canonical}({ ... })).`,
                        code: 'VALIDATION_ERROR',
                        category: 'validation',
                        recoverable: true,
                    }
                },
            })
        ),
        ...DUMMY_DOTTED_TOOL_NAMES.map(
            (name): ToolDefinition => ({
                name,
                title: `Code Mode Dotted Function Fallback (${name})`,
                description: `Fallback handler for \`${name}\` when called directly as an MCP tool.`,
                group: 'core',
                inputSchema: FLEXIBLE_PASSTHROUGH_SCHEMA,
                outputSchema: FLEXIBLE_PASSTHROUGH_SCHEMA,
                annotations: { readOnlyHint: isReadOnlyDummyAlias(name), openWorldHint: false },
                handler: async (params: unknown) => {
                    const args =
                        typeof params === 'object' && params !== null
                            ? (params as Record<string, unknown>)
                            : {}
                    const resolved = resolveTargetFromAlias(name)
                    if (resolved !== undefined) {
                        const routed = await routeNamedTargetTool(
                            name,
                            resolved.target,
                            resolved.group,
                            args,
                            context
                        )
                        if (routed !== undefined) return routed
                    }
                    return {
                        success: false,
                        error: `🛠️ AUTONOMOUS HEALING: '${name}' is a Code Mode JavaScript function, not a top-level MCP tool. Use 'mj_execute_code' with JavaScript (e.g. return await ${name}({ ... })).`,
                        code: 'VALIDATION_ERROR',
                        category: 'validation',
                        recoverable: true,
                    }
                },
            })
        ),
        ...DUMMY_SQL_EXECUTION_TOOL_NAMES.map(
            (name): ToolDefinition => ({
                name,
                title: `SQL / Code Mode Execution Fallback (${name})`,
                description: `Fallback handler for \`${name}\` when called directly as an MCP tool. Routes automatically to \`mj_execute_code\`.`,
                group: 'core',
                inputSchema: FLEXIBLE_PASSTHROUGH_SCHEMA,
                outputSchema: FLEXIBLE_PASSTHROUGH_SCHEMA,
                annotations: { readOnlyHint: false, openWorldHint: false },
                handler: async (params: unknown) => {
                    if (context !== undefined) {
                        const codemodeTools = getCodeModeTools(context)
                        const codemodeTool = codemodeTools.find(
                            (t: ToolDefinition) => t.name === 'mj_execute_code'
                        )
                        if (codemodeTool !== undefined) {
                            const forwardedParams =
                                typeof params === 'object' && params !== null
                                    ? ((): Record<string, unknown> => {
                                          const rec = { ...(params as Record<string, unknown>) }
                                          if (rec['repo'] === undefined && rec['repo_name'] !== undefined) {
                                              rec['repo'] = rec['repo_name']
                                              delete rec['repo_name']
                                          }
                                          return rec
                                      })()
                                    : params
                            const res = await Promise.resolve(codemodeTool.handler(forwardedParams))
                            if (typeof res === 'object' && res !== null) {
                                const resRecord = res as Record<string, unknown>
                                const succeeded = resRecord['success'] !== false
                                return {
                                    ...resRecord,
                                    _healing_note: succeeded
                                        ? `🛠️ AUTONOMOUS HEALING: '${name}' was called as an MCP tool. It was automatically translated and executed via Code Mode ('mj_execute_code').`
                                        : `🛠️ AUTONOMOUS HEALING: '${name}' was called as an MCP tool and translated to Code Mode ('mj_execute_code'), but the execution did not succeed. Fix the reported error and prefer calling 'mj_execute_code' directly.`,
                                }
                            }
                            return res
                        }
                    }
                    return {
                        success: false,
                        error: `🛠️ AUTONOMOUS HEALING: '${name}' was called, but direct SQLite execution tools are not active in memory-journal-mcp. Use 'mj_execute_code' with JavaScript (e.g. return await mj.core.getRecentEntries({ limit: 10 })).`,
                        code: 'VALIDATION_ERROR',
                        category: 'validation',
                        recoverable: true,
                    }
                },
            })
        ),
        ...DUMMY_PROJECT_TOOL_NAMES.map(
            (name): ToolDefinition => ({
                name,
                title: `Project Tool Fallback (${name})`,
                description: `Fallback handler for \`${name}\` when called directly as an MCP tool. Returns project registry info.`,
                group: 'admin',
                inputSchema: FLEXIBLE_PASSTHROUGH_SCHEMA,
                outputSchema: FLEXIBLE_PASSTHROUGH_SCHEMA,
                annotations: { readOnlyHint: true, openWorldHint: false },
                handler: async (params: unknown) => {
                    const args =
                        typeof params === 'object' && params !== null
                            ? (params as Record<string, unknown>)
                            : {}
                    const targetTool = projectAliasTarget(name)
                    if (targetTool === undefined) {
                        return {
                            success: false,
                            error: `🛠️ AUTONOMOUS HEALING: '${name}' was not routed to a project tool.`,
                            code: 'VALIDATION_ERROR',
                            category: 'validation',
                            recoverable: true,
                            _healing_note: 'The operation was not executed.',
                        }
                    }

                    if (context !== undefined) {
                        const tool = getAdminTools(context).find((t) => t.name === targetTool)
                        if (tool !== undefined) {
                            const res = await Promise.resolve(tool.handler(args))
                            if (typeof res !== 'object' || res === null) return res
                            const resRecord = res as Record<string, unknown>
                            // [INVARIANT] M5: never claim success for a failed routed call.
                            return {
                                ...resRecord,
                                _healing_note:
                                    resRecord['success'] !== false
                                        ? `🛠️ AUTONOMOUS HEALING: '${name}' was routed to '${targetTool}' and executed successfully.`
                                        : `🛠️ AUTONOMOUS HEALING: '${name}' was routed to '${targetTool}', but the operation did not succeed. See the reported error.`,
                            }
                        }
                    }
                    return {
                        success: false,
                        error: `🛠️ AUTONOMOUS HEALING: '${name}' failed because admin tools are not available.`,
                        code: 'VALIDATION_ERROR',
                        category: 'validation',
                        recoverable: true,
                    }
                },
            })
        ),
    ]
}
