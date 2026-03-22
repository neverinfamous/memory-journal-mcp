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
import { GOTCHAS_CONTENT } from '../../constants/server-instructions.js'
import { ASSISTANT_FOCUSED } from '../../utils/resource-annotations.js'
import { logger } from '../../utils/logger.js'
import type { InternalResourceDef, ResourceContext, ResourceResult } from './shared.js'
import type { getTools } from '../../handlers/tools/index.js'

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

/** Friendly display names for Zod primitive type names */
const ZOD_TYPE_DISPLAY: Record<string, string> = {
    ZodString: 'string',
    ZodNumber: 'number',
    ZodBoolean: 'boolean',
    ZodArray: 'array',
    ZodObject: 'object',
    ZodEnum: 'enum',
    ZodNativeEnum: 'enum',
    ZodLiteral: 'literal',
    ZodUnion: 'union',
    ZodIntersection: 'intersection',
    ZodRecord: 'record',
    ZodTuple: 'tuple',
    ZodAny: 'any',
    ZodUnknown: 'unknown',
    ZodNull: 'null',
    ZodUndefined: 'undefined',
    ZodVoid: 'void',
}

/** Wrapper type names that make a field optional or supply a default */
const ZOD_OPTIONAL_WRAPPERS = new Set([
    'ZodOptional',
    'ZodDefault',
    'ZodNullable',
    'optional',
    'default',
    'nullable',
])

/**
 * Recursively peel ZodOptional / ZodDefault / ZodNullable wrappers from a
 * Zod `_def` object to discover the innermost concrete type, whether the
 * field is optional to callers, and the description (first `_def` that has
 * one, scanning outer → inner). Supports both Zod 3 and Zod 4 shape.
 */
function peelZodType(def: Record<string, unknown>): {
    typeName: string
    isOptional: boolean
    description: string | undefined
} {
    let isOptional = false
    let description: string | undefined
    let current = def

    for (;;) {
        if (description === undefined && typeof current['description'] === 'string') {
            description = current['description']
        }

        // Zod 3 uses .typeName ('ZodString'), Zod 4 uses .type ('string')
        const tn = (current['typeName'] ?? current['type']) as string | undefined
        if (!tn) break

        if (ZOD_OPTIONAL_WRAPPERS.has(tn)) {
            isOptional = true
            const inner = current['innerType'] as { _def?: Record<string, unknown> } | undefined
            if (!inner?._def) break
            current = inner._def
        } else {
            const normalized = tn.replace('Zod', '').toLowerCase()
            const displayName = ZOD_TYPE_DISPLAY[tn] ?? normalized
            return { typeName: displayName, isOptional, description }
        }
    }

    return { typeName: 'unknown', isOptional, description }
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
        const rawDef = field['_def'] as Record<string, unknown> | undefined
        if (!rawDef) continue

        const { typeName, isOptional, description } = peelZodType(rawDef)

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
            handler: async (_uri: string, context: ResourceContext): Promise<ResourceResult> => {
                const tools = await getAllToolDefinitionsAsync(context)

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
                        gotchas: 'memory://help/gotchas',
                        hint: 'Read memory://help/{group} for detailed parameter info on each tool. Read memory://help/gotchas for field notes and critical usage patterns.',
                    },
                }
            },
        },
        {
            uri: 'memory://help/{group}',
            name: 'Help — Tool Group Detail',
            title: 'Per-Group Tool Reference',
            description:
                'Detailed tool reference for a specific group with parameters and annotations.',
            mimeType: 'application/json',
            icons: [ICON_BRIEFING],
            annotations: ASSISTANT_FOCUSED,
            handler: async (uri: string, context: ResourceContext): Promise<ResourceResult> => {
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

                const tools = await getAllToolDefinitionsAsync(context)
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
        {
            uri: 'memory://help/gotchas',
            name: 'Help — Field Notes & Gotchas',
            title: 'Critical Usage Patterns',
            description:
                'Field notes, edge cases, and critical usage patterns for memory-journal-mcp tools.',
            mimeType: 'text/markdown',
            icons: [ICON_BRIEFING],
            annotations: ASSISTANT_FOCUSED,
            handler: (): ResourceResult => {
                return {
                    data: GOTCHAS_CONTENT,
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
 * Cached reference to handlers/tools/index.js to avoid per-import overhead.
 */
let toolIndexModule: { getTools: typeof getTools } | null = null

/**
 * Get all tool definitions from the context's database.
 * Uses lazy dynamic import to avoid circular dependency with tools/index.ts.
 */
async function getAllToolDefinitionsAsync(context: ResourceContext): Promise<MinimalToolDef[]> {
    try {
        toolIndexModule ??= await import('../../handlers/tools/index.js')
        if (toolIndexModule === null) return []

        const tools = toolIndexModule.getTools(context.db, null)
        return tools.map((t) => ({
            name: t.name,
            title: t.title ?? t.name,
            description: t.description,
            group: inferGroupFromName(t.name),
            inputSchema: t.inputSchema,
            outputSchema: t.outputSchema,
            annotations: t.annotations as MinimalToolDef['annotations'],
        }))
    } catch (e: unknown) {
        logger.error('HELP_LOAD_TOOLS_FAILED', {
            error: e instanceof Error ? e.message : String(e),
        })
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
