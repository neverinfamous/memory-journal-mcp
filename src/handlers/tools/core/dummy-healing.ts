import { z } from 'zod'
import type { ToolDefinition, ToolContext } from '../../../types/index.js'
import { getCoreTools } from './tools.js'
import { getSearchTools } from '../search/index.js'

export const DUMMY_DOTTED_TOOL_NAMES = [
    'mj.core.createEntry',
    'mj.core.create_entry',
    'mj.core.searchEntries',
    'mj.core.search_entries',
    'mj.core.getRecentEntries',
    'mj.core.get_recent_entries',
    'mj.core.getEntryById',
    'mj.core.get_entry_by_id',
    'mj.core.updateEntry',
    'mj.core.update_entry',
    'mj.core.deleteEntry',
    'mj.core.delete_entry',
    'mj.admin.getProject',
    'mj.admin.get_project',
    'mj.admin.listProjects',
    'mj.admin.list_projects',
]

export const DUMMY_HEALING_TOOL_NAMES = new Set<string>([
    'create_entry',
    'search_entries',
    'get_recent_entries',
    'get_entry_by_id',
    'update_entry',
    'delete_entry',
    'read_resource',
    'mj_read_resource',
    'load-briefing',
    'mj_session_summary',
    'mj_core_create_entry',
    'mj_core_search_entries',
    'mj_core_get_recent_entries',
    'mj_core_get_entry_by_id',
    'mj_admin_get_project',
    'mj_admin_list_projects',
    ...DUMMY_DOTTED_TOOL_NAMES,
])

export function getDummyHealingTools(context?: ToolContext): ToolDefinition[] {
    return [
        {
            name: 'create_entry',
            title: 'Create Entry (Code Mode Fallback)',
            description: 'Fallback handler for `create_entry` when called directly in Code Mode.',
            group: 'core',
            inputSchema: z.any(),
            outputSchema: z.any(),
            annotations: { readOnlyHint: false, openWorldHint: false },
            handler: async (params: unknown) => {
                const args = (params ?? {}) as Record<string, unknown>
                if (context) {
                    const coreTools = getCoreTools(context)
                    const createTool = coreTools.find((t: ToolDefinition) => t.name === 'create_entry')
                    if (createTool) {
                        const result = await Promise.resolve(createTool.handler(args))
                        if (typeof result === 'object' && result !== null) {
                            return {
                                ...(result as Record<string, unknown>),
                                _healing_note: '🛠️ AUTONOMOUS HEALING: `create_entry` was invoked directly while in Code Mode. The entry was created successfully. In Code Mode, prefer using `mj_execute_code` with `mj.core.createEntry({ ... })`.'
                            }
                        }
                        return result
                    }
                }
                return {
                    success: false,
                    error: '🛠️ AUTONOMOUS HEALING: `create_entry` is not directly active in Code Mode. Use `mj_execute_code` with `mj.core.createEntry({ ... })`.',
                    code: 'VALIDATION_ERROR',
                    category: 'validation',
                    recoverable: true
                }
            },
        },
        {
            name: 'search_entries',
            title: 'Search Entries (Code Mode Fallback)',
            description: 'Fallback handler for `search_entries` when called directly in Code Mode.',
            group: 'core',
            inputSchema: z.any(),
            outputSchema: z.any(),
            annotations: { readOnlyHint: true, openWorldHint: false },
            handler: async (params: unknown) => {
                const args = (params ?? {}) as Record<string, unknown>
                if (context) {
                    const searchTools = getSearchTools(context)
                    const searchTool = searchTools.find((t: ToolDefinition) => t.name === 'search_entries')
                    if (searchTool) {
                        const result = await Promise.resolve(searchTool.handler(args))
                        if (typeof result === 'object' && result !== null) {
                            return {
                                ...(result as Record<string, unknown>),
                                _healing_note: '🛠️ AUTONOMOUS HEALING: `search_entries` was invoked directly while in Code Mode. Search completed successfully. In Code Mode, prefer using `mj_execute_code` with `mj.search.searchEntries({ ... })`.'
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
                    recoverable: true
                }
            },
        },
        {
            name: 'get_recent_entries',
            title: 'Get Recent Entries (Code Mode Fallback)',
            description: 'Fallback handler for `get_recent_entries` when called directly in Code Mode.',
            group: 'core',
            inputSchema: z.any(),
            outputSchema: z.any(),
            annotations: { readOnlyHint: true, openWorldHint: false },
            handler: async (params: unknown) => {
                const args = (params ?? {}) as Record<string, unknown>
                if (context) {
                    const coreTools = getCoreTools(context)
                    const tool = coreTools.find((t: ToolDefinition) => t.name === 'get_recent_entries')
                    if (tool) {
                        return await Promise.resolve(tool.handler(args))
                    }
                }
                return {
                    success: false,
                    error: '🛠️ AUTONOMOUS HEALING: `get_recent_entries` is not directly active in Code Mode. Use `mj_execute_code` with `mj.core.getRecentEntries({ ... })`.',
                    code: 'VALIDATION_ERROR',
                    category: 'validation',
                    recoverable: true
                }
            },
        },
        {
            name: 'get_entry_by_id',
            title: 'Get Entry By ID (Code Mode Fallback)',
            description: 'Fallback handler for `get_entry_by_id` when called directly in Code Mode.',
            group: 'core',
            inputSchema: z.any(),
            outputSchema: z.any(),
            annotations: { readOnlyHint: true, openWorldHint: false },
            handler: async (params: unknown) => {
                const args = (params ?? {}) as Record<string, unknown>
                if (context) {
                    const coreTools = getCoreTools(context)
                    const tool = coreTools.find((t: ToolDefinition) => t.name === 'get_entry_by_id')
                    if (tool) {
                        return await Promise.resolve(tool.handler(args))
                    }
                }
                return {
                    success: false,
                    error: '🛠️ AUTONOMOUS HEALING: `get_entry_by_id` is not directly active in Code Mode. Use `mj_execute_code` with `mj.core.getEntryById({ ... })`.',
                    code: 'VALIDATION_ERROR',
                    category: 'validation',
                    recoverable: true
                }
            },
        },
        {
            name: 'update_entry',
            title: 'Update Entry (Code Mode Fallback)',
            description: 'Fallback handler for `update_entry` when called directly in Code Mode.',
            group: 'core',
            inputSchema: z.any(),
            outputSchema: z.any(),
            annotations: { readOnlyHint: false, openWorldHint: false },
            handler: async (params: unknown) => {
                const args = (params ?? {}) as Record<string, unknown>
                if (context) {
                    const coreTools = getCoreTools(context)
                    const tool = coreTools.find((t: ToolDefinition) => t.name === 'update_entry')
                    if (tool) {
                        return await Promise.resolve(tool.handler(args))
                    }
                }
                return {
                    success: false,
                    error: '🛠️ AUTONOMOUS HEALING: `update_entry` is not directly active in Code Mode. Use `mj_execute_code` with `mj.core.updateEntry({ ... })`.',
                    code: 'VALIDATION_ERROR',
                    category: 'validation',
                    recoverable: true
                }
            },
        },
        {
            name: 'delete_entry',
            title: 'Delete Entry (Code Mode Fallback)',
            description: 'Fallback handler for `delete_entry` when called directly in Code Mode.',
            group: 'core',
            inputSchema: z.any(),
            outputSchema: z.any(),
            annotations: { readOnlyHint: false, openWorldHint: false },
            handler: async (params: unknown) => {
                const args = (params ?? {}) as Record<string, unknown>
                if (context) {
                    const coreTools = getCoreTools(context)
                    const tool = coreTools.find((t: ToolDefinition) => t.name === 'delete_entry')
                    if (tool) {
                        return await Promise.resolve(tool.handler(args))
                    }
                }
                return {
                    success: false,
                    error: '🛠️ AUTONOMOUS HEALING: `delete_entry` is not directly active in Code Mode. Use `mj_execute_code` with `mj.core.deleteEntry({ ... })`.',
                    code: 'VALIDATION_ERROR',
                    category: 'validation',
                    recoverable: true
                }
            },
        },
        {
            name: 'read_resource',
            title: 'DO NOT USE',
            description: 'DO NOT USE. 🛠️ AUTONOMOUS HEALING: This is a protocol-level MCP resource method, not an MCP tool. To read a file, use the native agent tool `read_file`, `read_resource` or the MCP tool `mj_execute_code`.',
            group: 'core',
            inputSchema: z.any(),
            outputSchema: z.any(),
            annotations: { readOnlyHint: true, openWorldHint: false },
            handler: (params: unknown) => {
                const args = (params ?? {}) as Record<string, unknown>
                const uri = typeof args['uri'] === 'string' ? args['uri'] : (typeof args['_uri'] === 'string' ? args['_uri'] : undefined)
                const hint = uri ? ` Requested URI: ${uri}.` : ''
                return Promise.resolve({
                    success: false,
                    error: `🛠️ AUTONOMOUS HEALING: 'read_resource' is an MCP protocol resource method, not an MCP tool.${hint} Use native agent tool 'read_resource' / 'read_file', or query via 'mj_execute_code'.`,
                    code: 'VALIDATION_ERROR',
                    category: 'validation',
                    recoverable: true
                })
            },
        },
        {
            name: 'mj_read_resource',
            title: 'DO NOT USE',
            description: 'DO NOT USE. 🛠️ AUTONOMOUS HEALING: Use the native agent tool `read_resource` or `read_file`.',
            group: 'core',
            inputSchema: z.any(),
            outputSchema: z.any(),
            annotations: { readOnlyHint: true, openWorldHint: false },
            handler: () => {
                return Promise.resolve({
                    success: false,
                    error: '🛠️ AUTONOMOUS HEALING: `mj_read_resource` is not a valid tool. Use the native environment tool `read_resource` or `read_file`.',
                    code: 'VALIDATION_ERROR',
                    category: 'validation',
                    recoverable: true
                })
            },
        },
        {
            name: 'load-briefing',
            title: 'DO NOT USE',
            description: 'DO NOT USE. 🛠️ AUTONOMOUS HEALING: `load-briefing` is an MCP Prompt, not a Tool. Fetch it via the Prompts API.',
            group: 'core',
            inputSchema: z.any(),
            outputSchema: z.any(),
            annotations: { readOnlyHint: true, openWorldHint: false },
            handler: () => {
                return Promise.resolve({
                    success: false,
                    error: '🛠️ AUTONOMOUS HEALING: `load-briefing` is an MCP Prompt, not an MCP Tool. Please fetch it via the Prompts API or use the `prompts/list` endpoint.',
                    code: 'VALIDATION_ERROR',
                    category: 'validation',
                    recoverable: true
                })
            },
        },
        {
            name: 'mj_session_summary',
            title: 'DO NOT USE',
            description: 'DO NOT USE. 🛠️ AUTONOMOUS HEALING: `mj_session_summary` is an MCP Prompt, not a Tool. Fetch it via the Prompts API.',
            group: 'core',
            inputSchema: z.any(),
            outputSchema: z.any(),
            annotations: { readOnlyHint: true, openWorldHint: false },
            handler: () => {
                return Promise.resolve({
                    success: false,
                    error: '🛠️ AUTONOMOUS HEALING: `mj_session_summary` is an MCP Prompt, not an MCP Tool. Please fetch it via the Prompts API or use the `prompts/list` endpoint.',
                    code: 'VALIDATION_ERROR',
                    category: 'validation',
                    recoverable: true
                })
            },
        },
        ...['mj_core_create_entry', 'mj_core_search_entries', 'mj_core_get_recent_entries', 'mj_core_get_entry_by_id', 'mj_admin_get_project', 'mj_admin_list_projects'].map((name): ToolDefinition => ({
            name,
            title: 'DO NOT USE (Code Mode Function)',
            description: `DO NOT USE. 🛠️ AUTONOMOUS HEALING: '${name}' is a Code Mode function/namespace, not a direct MCP tool.`,
            group: 'core',
            inputSchema: z.any(),
            outputSchema: z.any(),
            annotations: { readOnlyHint: true, openWorldHint: false },
            handler: () => {
                const canonical = name.replace(/^mj_/, '').replace('_', '.')
                return Promise.resolve({
                    success: false,
                    error: `🛠️ AUTONOMOUS HEALING: '${name}' is a Code Mode function, not a top-level MCP tool. Use 'mj_execute_code' with JavaScript (e.g. return await ${canonical}({ ... })).`,
                    code: 'VALIDATION_ERROR',
                    category: 'validation',
                    recoverable: true
                })
            }
        })),
        ...DUMMY_DOTTED_TOOL_NAMES.map((name): ToolDefinition => ({
            name,
            title: 'DO NOT USE (Code Mode Function)',
            description: `DO NOT USE. 🛠️ AUTONOMOUS HEALING: '${name}' is a Code Mode function, not a direct MCP tool.`,
            group: 'core',
            inputSchema: z.any(),
            outputSchema: z.any(),
            annotations: { readOnlyHint: true, openWorldHint: false },
            handler: () => {
                return Promise.resolve({
                    success: false,
                    error: `🛠️ AUTONOMOUS HEALING: '${name}' is a Code Mode JavaScript function, not a top-level MCP tool. Use 'mj_execute_code' with JavaScript (e.g. return await ${name}({ ... })).`,
                    code: 'VALIDATION_ERROR',
                    category: 'validation',
                    recoverable: true
                })
            }
        }))
    ]
}
