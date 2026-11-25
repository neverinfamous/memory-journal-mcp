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
import { HELP_CONTENT } from '../../constants/server-instructions.js'
import { ASSISTANT_FOCUSED } from '../../utils/resource-annotations.js'
import { logger } from '../../utils/logger.js'
import { getAllToolNames, getToolGroup, isToolVisibleForFilter } from '../../filtering/tool-filter.js'
import {
    getBaseUri,
    safeDecodeUriSegment,
    withResourceTokenMeta,
    type InternalResourceDef,
    type ResourceContext,
    type ResourceResult,
} from './shared.js'
import { hasCodemodeFullAccess } from './core/instructions.js'
import type { getTools } from '../../handlers/tools/index.js'
import { ProtocolError, ProtocolErrorCode } from '@modelcontextprotocol/server'
import {
    extractParameters,
    peelZodType,
    type ParameterInfo,
} from './help-schema-params.js'

export { extractParameters, peelZodType, type ParameterInfo }

// ============================================================================
// Group Metadata
// ============================================================================

const CANONICAL_TOOL_NAMES = new Set(getAllToolNames())

/** Human-readable descriptions for each tool group */
const GROUP_DESCRIPTIONS: Record<string, string> = {
    core: 'Journal entries, tags, entry history, and anchor staleness marking',
    search: 'Full-text search, semantic search, date range queries, and vector index stats',
    analytics: 'Entry analytics, importance scoring, and productivity trends',
    relationships: 'Link and visualize relationships between journal entries',
    io: 'Markdown & external knowledge-base import/export (JSON frontmatter, Notion/Obsidian/Logseq)',
    admin: 'Runtime config, entry mutations, batch operations, auto-pruning, project registry, and audit logs',
    github: 'GitHub integration — issues, PRs, milestones, workflow runs, Kanban boards',
    git: 'Git history mining — commit search, release tracking, pattern analysis, and entry anchor staleness checks',
    backup: 'Create and restore database backups',
    team: 'Team collaboration — shared entries, cross-project insights, team analytics',
    codemode: 'Sandboxed JavaScript execution with access to the journal API',
}

// ============================================================================
// Resource Definitions
// ============================================================================

function filterVisibleHelpTools(
    rawTools: MinimalToolDef[],
    context: ResourceContext
): MinimalToolDef[] {
    const codemodeFull =
        (context.filterConfig?.enabledTools.has('mj_execute_code') ?? false) &&
        hasCodemodeFullAccess(context)
    const filterRaw = context.filterConfig?.raw
    return rawTools.filter((t) => {
        if (!isToolVisibleForFilter(t.name, t.annotations?.readOnlyHint, filterRaw)) {
            return false
        }
        if (!context.filterConfig || codemodeFull) return true
        return context.filterConfig.enabledTools.has(t.name)
    })
}

async function handleHelpRootResource(
    _uri: string,
    context: ResourceContext
): Promise<ResourceResult> {
    const tools = filterVisibleHelpTools(await getAllToolDefinitionsAsync(context), context)
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

    const data = {
        totalTools: tools.length,
        totalGroups: groupList.length,
        staticTopics: ['gotchas', 'templates'],
        groups: groupList,
        hint: 'Read memory://help/{group} for detailed parameter info on each tool, or memory://help/gotchas / memory://help/templates.',
    }
    return { data: withResourceTokenMeta(data) }
}

interface HelpToolDetail {
    name: string
    title: string
    description: string
    parameters: ParameterInfo[]
    annotations: {
        readOnly: boolean
        destructive: boolean
        idempotent: boolean
        openWorld: boolean
    }
    hasOutputSchema: boolean
}

function formatGroupToolDetails(
    groupTools: MinimalToolDef[],
    context: ResourceContext
): HelpToolDetail[] {
    const filterRaw = context.filterConfig?.raw
    const enabledSet = context.filterConfig?.enabledTools
    const isCodemodeOnly =
        filterRaw?.trim() === 'codemode' ||
        (enabledSet !== undefined &&
            enabledSet.has('mj_execute_code') &&
            [...enabledSet].every((t) => t === 'mj_execute_code' || t === 'update_configuration'))

    return groupTools.map((tool) => {
        let displayName = tool.name
        if (
            isCodemodeOnly &&
            tool.name !== 'mj_execute_code' &&
            tool.name !== 'update_configuration'
        ) {
            const camelCase = tool.name.replace(/_([a-z])/g, (_: string, letter: string) =>
                letter.toUpperCase()
            )
            displayName = `mj.${tool.group}.${camelCase}`
        }
        return {
            name: displayName,
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
        }
    })
}

async function handleHelpGroupResource(
    uri: string,
    context: ResourceContext
): Promise<ResourceResult> {
    const match = /^memory:\/\/help\/([^/?#]+)$/.exec(getBaseUri(uri))
    const rawGroupName = match?.[1] ? safeDecodeUriSegment(match[1]) : undefined
    const groupName = rawGroupName === 'export' ? 'io' : rawGroupName

    if (!groupName) {
        throw new ProtocolError(
            ProtocolErrorCode.InvalidParams,
            'Invalid group name in URI. Read memory://help for a list of available groups.'
        )
    }

    const staticContent = HELP_CONTENT.get(groupName)
    // [INVARIANT] Static-only topics (e.g., `gotchas`, `templates`) do not belong to any tool
    // group; return them immediately without triggering the lazy tools/index.js dynamic import.
    if (staticContent !== undefined && !Object.hasOwn(GROUP_DESCRIPTIONS, groupName)) {
        return { data: staticContent }
    }

    let rawTools: MinimalToolDef[]
    try {
        rawTools = await getAllToolDefinitionsAsync(context)
    } catch (err: unknown) {
        if (staticContent !== undefined && isStaleModuleNotFoundError(err)) {
            return { data: staticContent }
        }
        throw err
    }

    const tools = filterVisibleHelpTools(rawTools, context)
    const groupTools = tools.filter((t) => t.group === groupName)

    if (groupTools.length > 0) {
        const toolDetails = formatGroupToolDetails(groupTools, context)
        const result: Record<string, unknown> = {
            group: groupName,
            description: GROUP_DESCRIPTIONS[groupName] ?? groupName,
            toolCount: toolDetails.length,
            tools: toolDetails,
        }
        if (staticContent) {
            result['helpContent'] = staticContent
        }
        return { data: withResourceTokenMeta(result) }
    }

    if (staticContent) {
        return { data: staticContent }
    }

    const availableGroups = [...new Set(tools.map((t) => t.group))].sort()
    const staticKeys = [...HELP_CONTENT.keys()]
    throw new ProtocolError(
        ProtocolErrorCode.InternalError,
        `Group "${groupName}" not found. Available groups: ${availableGroups.join(', ')}. Static help: ${staticKeys.join(', ')}.`
    )
}

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
            handler: handleHelpRootResource,
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
            handler: handleHelpGroupResource,
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
import { getRuntimeWrapperConfig } from '../tools/tool-cache-helpers.js'

let toolIndexModule: { getTools: typeof getTools } | null = null

/** Detect stale hashed ESM chunk import failures after an out-of-process dist/ rebuild. */
export function isStaleModuleNotFoundError(err: unknown): boolean {
    if (typeof err === 'object' && err !== null && 'code' in err && err.code === 'ERR_MODULE_NOT_FOUND') {
        return true
    }
    const msg = err instanceof Error ? err.message : String(err)
    return /ERR_MODULE_NOT_FOUND|Cannot find module/i.test(msg)
}

/** Format tool-definition load errors with actionable restart guidance on stale dist/ chunks. */
export function formatHelpLoadErrorMessage(err: unknown): string {
    const message = err instanceof Error ? err.message : String(err)
    if (isStaleModuleNotFoundError(err)) {
        return `Failed to load tool definitions: ${message} 🛠️ AUTONOMOUS HEALING: dist/ was likely rebuilt while this MCP server process was running (rotating chunk hashes). Restart the memory-journal-mcp server or click Refresh in your MCP client.`
    }
    return `Failed to load tool definitions: ${message}`
}

/**
 * Get all tool definitions from the context's database.
 * Uses lazy dynamic import to avoid circular dependency with tools/index.ts.
 */
async function getAllToolDefinitionsAsync(context: ResourceContext): Promise<MinimalToolDef[]> {
    try {
        toolIndexModule ??= await import('../../handlers/tools/index.js')
        if (toolIndexModule === null) return []

        const tools = toolIndexModule.getTools(
            context.db,
            null,
            context.vectorManager,
            context.github ?? undefined,
            getRuntimeWrapperConfig(context.runtime),
            context.teamDb,
            undefined
        )
        return tools
            .filter((t) => CANONICAL_TOOL_NAMES.has(t.name))
            .map((t) => {
                const regWithGroup = t as typeof t & { group?: string }
                return {
                    name: t.name,
                    title: t.title ?? t.name,
                    description: t.description,
                    group:
                        typeof regWithGroup.group === 'string' && regWithGroup.group.length > 0
                            ? regWithGroup.group
                            : inferGroupFromName(t.name),
                    inputSchema: t.inputSchema,
                    outputSchema: t.outputSchema,
                    annotations: t.annotations,
                }
            })
    } catch (e: unknown) {
        const message = e instanceof Error ? e.message : String(e)
        logger.error('HELP_LOAD_TOOLS_FAILED', { error: message })
        throw new ProtocolError(ProtocolErrorCode.InternalError, formatHelpLoadErrorMessage(e))
    }
}

/**
 * Infer tool group from the tool name via the canonical tool-filter lookup.
 */
function inferGroupFromName(name: string): string {
    if (name === 'mj_execute_code') return 'codemode'
    return getToolGroup(name) ?? 'core'
}
