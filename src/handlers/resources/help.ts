/**
 * Help Resource Definitions
 *
 * Dynamic help resources generated from live tool definitions.
 * - `memory://help` — Root help listing all tool groups
 * - `memory://help/{group}` — Per-group help with tool details
 *
 * Content is generated at runtime from getTools(), so it automatically
 * stays in sync when tools are added or modified.
 */

import { ICON_BRIEFING } from '../../constants/icons.js'
import { ASSISTANT_FOCUSED } from '../../utils/resource-annotations.js'
import type { InternalResourceDef, ResourceContext, ResourceResult } from './shared.js'

// ============================================================================
// Group Metadata
// ============================================================================

/** Human-readable descriptions for each tool group */
const GROUP_DESCRIPTIONS: Record<string, string> = {
    core: 'Create, read, update, delete journal entries and manage recent activity',
    search: 'Full-text search, semantic search, date range queries, and vector index stats',
    analytics: 'Entry analytics, importance scoring, and productivity trends',
    relationships: 'Link and visualize relationships between journal entries',
    export: 'Export journal data in various formats (JSON, Markdown, CSV)',
    admin: 'Update entries, rebuild indexes, and manage the vector search index',
    github: 'GitHub integration — issues, PRs, milestones, workflow runs, Kanban boards',
    backup: 'Create and restore database backups',
    team: 'Team collaboration — shared entries, cross-project insights, team analytics',
    codemode: 'Sandboxed JavaScript execution with access to the journal API',
}

// ============================================================================
// Schema Introspection
// ============================================================================

interface ParameterInfo {
    name: string
    type: string
    required: boolean
    description?: string
}

/**
 * Extract parameter info from a Zod schema's shape.
 * Works with z.object() schemas that have a `.shape` property.
 */
function extractParameters(inputSchema: unknown): ParameterInfo[] {
    if (inputSchema === undefined || inputSchema === null || typeof inputSchema !== 'object') {
        return []
    }

    const schema = inputSchema as Record<string, unknown>
    const rawShape: unknown = schema['shape']
    if (rawShape === undefined || rawShape === null || typeof rawShape !== 'object') {
        return []
    }

    const shape = rawShape as Record<string, unknown>
    const params: ParameterInfo[] = []

    for (const [name, fieldSchema] of Object.entries(shape)) {
        if (fieldSchema === undefined || fieldSchema === null || typeof fieldSchema !== 'object') {
            continue
        }
        const field = fieldSchema as Record<string, unknown>
        const rawDef: unknown = field['_def']

        // Determine if optional by checking for ZodOptional wrapper
        const isOptional =
            rawDef !== undefined &&
            rawDef !== null &&
            typeof rawDef === 'object' &&
            (rawDef as Record<string, unknown>)['typeName'] === 'ZodOptional'

        // Extract description from _def.description
        let description: string | undefined
        if (rawDef !== undefined && rawDef !== null && typeof rawDef === 'object') {
            const def = rawDef as Record<string, unknown>
            description = typeof def['description'] === 'string' ? def['description'] : undefined
        }

        // Determine type name
        let typeName = 'unknown'
        if (rawDef !== undefined && rawDef !== null && typeof rawDef === 'object') {
            const def = rawDef as Record<string, unknown>
            const tn: unknown = def['typeName']
            if (typeof tn === 'string') {
                typeName = tn
                    .replace('Zod', '')
                    .replace('Optional', '')
                    .replace('Default', '')
                    .toLowerCase()
            }
        }

        params.push({
            name,
            type: typeName,
            required: !isOptional,
            ...(description !== undefined ? { description } : {}),
        })
    }

    return params
}

// ============================================================================
// Resource Definitions
// ============================================================================

/**
 * Get help resource definitions
 */
export function getHelpResourceDefinitions(): InternalResourceDef[] {
    return [
        {
            uri: 'memory://help',
            name: 'Help — Tool Groups',
            title: 'Tool Group Overview',
            description:
                'Lists all tool groups with tool counts and descriptions. Read memory://help/{group} for per-tool details.',
            mimeType: 'application/json',
            icons: [ICON_BRIEFING],
            annotations: ASSISTANT_FOCUSED,
            handler: (_uri: string, context: ResourceContext): ResourceResult => {
                const tools = getAllToolDefinitions(context)

                // Group tools by their group field
                const groups = new Map<string, { names: string[]; readOnly: boolean }>()
                for (const tool of tools) {
                    const existing = groups.get(tool.group)
                    if (existing) {
                        existing.names.push(tool.name)
                        // A group is read-only only if ALL its tools are read-only
                        if (!tool.annotations?.readOnlyHint) existing.readOnly = false
                    } else {
                        groups.set(tool.group, {
                            names: [tool.name],
                            readOnly: tool.annotations?.readOnlyHint ?? false,
                        })
                    }
                }

                const groupList = Array.from(groups.entries())
                    .sort(([a], [b]) => a.localeCompare(b))
                    .map(([name, info]) => ({
                        name,
                        description: GROUP_DESCRIPTIONS[name] ?? name,
                        toolCount: info.names.length,
                        readOnly: info.readOnly,
                        tools: info.names.sort(),
                        helpUri: `memory://help/${name}`,
                    }))

                return {
                    data: {
                        totalTools: tools.length,
                        totalGroups: groupList.length,
                        groups: groupList,
                        hint: 'Read memory://help/{group} for detailed parameter info on each tool.',
                    },
                }
            },
        },
        {
            uri: 'memory://help/{group}',
            name: 'Help — Tool Group Detail',
            title: 'Per-Group Tool Reference',
            description: 'Detailed tool reference for a specific group with parameters and annotations.',
            mimeType: 'application/json',
            icons: [ICON_BRIEFING],
            annotations: ASSISTANT_FOCUSED,
            handler: (uri: string, context: ResourceContext): ResourceResult => {
                const match = /memory:\/\/help\/([a-z]+)/.exec(uri)
                const groupName = match?.[1]

                if (!groupName) {
                    return {
                        data: {
                            error: 'Invalid group name in URI',
                            hint: 'Read memory://help for a list of available groups.',
                        },
                    }
                }

                const tools = getAllToolDefinitions(context)
                const groupTools = tools.filter((t) => t.group === groupName)

                if (groupTools.length === 0) {
                    const availableGroups = [...new Set(tools.map((t) => t.group))].sort()
                    return {
                        data: {
                            error: `Group "${groupName}" not found`,
                            availableGroups,
                            hint: 'Read memory://help for a list of available groups.',
                        },
                    }
                }

                const toolDetails = groupTools.map((tool) => ({
                    name: tool.name,
                    title: tool.title,
                    description: tool.description,
                    parameters: extractParameters(tool.inputSchema),
                    annotations: {
                        readOnly: tool.annotations?.readOnlyHint ?? false,
                        destructive: tool.annotations?.destructiveHint ?? false,
                        idempotent: tool.annotations?.idempotentHint ?? false,
                        openWorld: tool.annotations?.openWorldHint ?? false,
                    },
                    hasOutputSchema: tool.outputSchema !== undefined,
                }))

                return {
                    data: {
                        group: groupName,
                        description: GROUP_DESCRIPTIONS[groupName] ?? groupName,
                        toolCount: toolDetails.length,
                        tools: toolDetails,
                    },
                }
            },
        },
    ]
}

// ============================================================================
// Internal Helpers
// ============================================================================

/**
 * Minimal tool definition shape needed for help generation.
 * Avoids importing the full ToolDefinition type to prevent circular deps.
 */
interface MinimalToolDef {
    name: string
    title: string
    description: string
    group: string
    inputSchema: unknown
    outputSchema?: unknown
    annotations?: {
        readOnlyHint?: boolean
        destructiveHint?: boolean
        idempotentHint?: boolean
        openWorldHint?: boolean
    }
}

/**
 * Get all tool definitions from the context's database.
 * Uses lazy dynamic import to avoid circular dependency with tools/index.ts.
 */
function getAllToolDefinitions(context: ResourceContext): MinimalToolDef[] {
    // We can't import getTools statically (circular dep: tools → types → resources → tools).
    // Instead, query the database for the raw tool definitions by importing dynamically.
    // Since this is a sync handler, we use require-style resolution.
    try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const toolIndex = require('../../handlers/tools/index.js') as {
            getTools: (
                db: unknown,
                filterConfig: unknown,
                vectorManager?: unknown
            ) => { name: string; description: string; annotations: unknown }[]
        }

        // getTools returns ToolRegistration[] which doesn't include `group`.
        // We need access to the internal tool map instead.
        // Workaround: call getTools with no filter to get all tools, but we
        // lose the `group` field. We'll reconstruct it from the tool name prefix.
        const tools = toolIndex.getTools(context.db, null)
        return tools.map((t) => ({
            name: t.name,
            title: (t as Record<string, unknown>)['title'] as string ?? t.name,
            description: t.description,
            group: inferGroupFromName(t.name),
            inputSchema: (t as Record<string, unknown>)['inputSchema'],
            outputSchema: (t as Record<string, unknown>)['outputSchema'],
            annotations: t.annotations as MinimalToolDef['annotations'],
        }))
    } catch {
        return []
    }
}

/**
 * Infer tool group from the tool name.
 * Exhaustive map of all 61 tools — team_ and mj_ prefixes handled first,
 * then explicit lookup for the remaining 41 tools.
 */
function inferGroupFromName(name: string): string {
    if (name.startsWith('team_')) return 'team'
    if (name.startsWith('mj_')) return 'codemode'

    const groupMap: Record<string, string> = {
        // core (6)
        create_entry: 'core',
        create_entry_minimal: 'core',
        get_entry_by_id: 'core',
        get_recent_entries: 'core',
        test_simple: 'core',
        list_tags: 'core',
        // search (4)
        search_entries: 'search',
        search_by_date_range: 'search',
        semantic_search: 'search',
        get_vector_index_stats: 'search',
        // analytics (2)
        get_statistics: 'analytics',
        get_cross_project_insights: 'analytics',
        // relationships (2)
        link_entries: 'relationships',
        visualize_relationships: 'relationships',
        // export (1)
        export_entries: 'export',
        // admin (5)
        update_entry: 'admin',
        delete_entry: 'admin',
        merge_tags: 'admin',
        rebuild_vector_index: 'admin',
        add_to_vector_index: 'admin',
        // backup (4)
        backup_journal: 'backup',
        list_backups: 'backup',
        restore_backup: 'backup',
        cleanup_backups: 'backup',
        // github (16)
        get_github_issues: 'github',
        get_github_prs: 'github',
        get_github_issue: 'github',
        get_github_pr: 'github',
        get_github_context: 'github',
        get_github_milestones: 'github',
        get_github_milestone: 'github',
        create_github_milestone: 'github',
        update_github_milestone: 'github',
        delete_github_milestone: 'github',
        get_kanban_board: 'github',
        move_kanban_item: 'github',
        create_github_issue_with_entry: 'github',
        close_github_issue_with_entry: 'github',
        get_repo_insights: 'github',
        get_copilot_reviews: 'github',
    }

    return groupMap[name] ?? 'core'
}
