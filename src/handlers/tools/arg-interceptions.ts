/**
 * Tool Argument Interception, Normalization & Instrumentation Helpers
 *
 * Extracted from src/handlers/tools/index.ts to keep module sizes modular (< 420 lines).
 */

import { z } from 'zod'
import type {
    ToolDefinition,
    ToolHandlerConfig,
    ProjectRegistryEntry,
} from '../../types/index.js'
import { ResourceNotFoundError } from '../../types/errors.js'
import { wrapWithMetrics } from '../../observability/index.js'
import { requestContextStorage } from '../../utils/request-context.js'
import { applyArgInterceptions as applyCodeModeArgInterceptions } from '../../codemode/param-normalizer.js'

/**
 * Common argument alias map for MCP tool invocations.
 */
export const ARG_ALIASES: Readonly<Record<string, string>> = {
    user: 'target_user',
    severity: 'flag_type',
    msg: 'message',
    sort: 'sort_by',
    sortBy: 'sort_by',
    orderBy: 'sort_by',
    order_by: 'sort_by',
    validation: 'validation_status',
    validationStatus: 'validation_status',
    confidence: 'trust_score',
    trust: 'trust_score',
    trustScore: 'trust_score',
    impact: 'impact_score',
    impactScore: 'impact_score',
    item_type: 'type',
    category: 'type',
    search: 'query',
}

/**
 * Keys that should be coerced to boolean when passed as string/number literals.
 */
export const BOOLEAN_COERCIONS: readonly string[] = [
    'is_personal',
    'isPersonal',
    'include_content',
    'includeContent',
    'case_insensitive',
    'caseInsensitive',
    'is_regex',
    'isRegex',
    'match_per_line',
    'matchPerLine',
    'move_to_done',
    'use_test_db',
]

/**
 * Keys that should be coerced to number when passed as numeric string literals.
 */
export const NUMBER_COERCIONS: readonly string[] = [
    'entry_id',
    'entryId',
    'id',
    'from_entry_id',
    'fromEntryId',
    'to_entry_id',
    'toEntryId',
    'project_number',
    'projectNumber',
    'issue_number',
    'issueNumber',
    'pr_number',
    'prNumber',
    'milestone_number',
    'milestoneNumber',
    'offset',
    'limit',
    'expected_version',
]

/**
 * Apply argument interceptions and hallucination healing for MCP tool calls.
 */
export function applyArgInterceptions(
    methodName: string,
    args: unknown[]
): { args: unknown[] } | { error: Record<string, unknown> } {
    return applyCodeModeArgInterceptions(methodName, args)
}

/**
 * Inject resolved project names from the project registry into tool responses.
 */
export function injectProjectNames(
    obj: unknown,
    registry?: Record<string, ProjectRegistryEntry>,
    depth = 0,
    seen = new WeakSet()
): void {
    if (
        depth > 10 ||
        obj === undefined ||
        obj === null ||
        typeof obj !== 'object' ||
        registry === undefined
    ) {
        return
    }
    if (seen.has(obj)) return
    seen.add(obj)

    if (Array.isArray(obj)) {
        obj.forEach((item) => injectProjectNames(item, registry, depth + 1, seen))
        return
    }

    const record = obj as Record<string, unknown>
    const pNum =
        typeof record['projectNumber'] === 'number'
            ? record['projectNumber']
            : typeof record['project_number'] === 'number'
              ? record['project_number']
              : undefined

    if (pNum !== undefined && typeof record['projectName'] === 'undefined') {
        const entry = Object.entries(registry).find(([_, r]) => r.project_number === pNum)
        if (entry) {
            record['projectName'] = entry[0]
        }
    }
    for (const key of Object.keys(record)) {
        if (typeof record[key] === 'object' && record[key] !== null) {
            injectProjectNames(record[key], registry, depth + 1, seen)
        }
    }
}

/**
 * Map a tool group identifier to its Material Design icon metadata.
 */
export function getToolIcon(
    group: string
): { iconUrl: string; title: string; description: string } | undefined {
    const iconMap: Record<string, { iconUrl: string; title: string; description: string }> = {
        core: {
            iconUrl: 'https://cdn.jsdelivr.net/npm/@mdi/svg@7.4.47/svg/notebook.svg',
            title: 'Journal Core',
            description: 'Core journal operations',
        },
        search: {
            iconUrl: 'https://cdn.jsdelivr.net/npm/@mdi/svg@7.4.47/svg/magnify.svg',
            title: 'Search',
            description: 'Entry search operations',
        },
        analytics: {
            iconUrl: 'https://cdn.jsdelivr.net/npm/@mdi/svg@7.4.47/svg/chart-bar.svg',
            title: 'Analytics',
            description: 'Journal analytics',
        },
        relationships: {
            iconUrl: 'https://cdn.jsdelivr.net/npm/@mdi/svg@7.4.47/svg/graph-outline.svg',
            title: 'Relationships',
            description: 'Entry relationship management',
        },
        io: {
            iconUrl: 'https://cdn.jsdelivr.net/npm/@mdi/svg@7.4.47/svg/swap-horizontal.svg',
            title: 'IO',
            description: 'Import/export operations',
        },
        admin: {
            iconUrl: 'https://cdn.jsdelivr.net/npm/@mdi/svg@7.4.47/svg/cog.svg',
            title: 'Admin',
            description: 'Administrative operations',
        },
        github: {
            iconUrl: 'https://cdn.jsdelivr.net/npm/@mdi/svg@7.4.47/svg/github.svg',
            title: 'GitHub',
            description: 'GitHub integration',
        },
        backup: {
            iconUrl: 'https://cdn.jsdelivr.net/npm/@mdi/svg@7.4.47/svg/backup-restore.svg',
            title: 'Backup',
            description: 'Backup and restore',
        },
        team: {
            iconUrl: 'https://cdn.jsdelivr.net/npm/@mdi/svg@7.4.47/svg/account-group.svg',
            title: 'Team',
            description: 'Team collaboration',
        },
        codemode: {
            iconUrl: 'https://cdn.jsdelivr.net/npm/@mdi/svg@7.4.47/svg/code-braces.svg',
            title: 'Code Mode',
            description: 'Sandboxed code execution',
        },
        git: {
            iconUrl: 'https://cdn.jsdelivr.net/npm/@mdi/svg@7.4.47/svg/source-branch.svg',
            title: 'Git History',
            description: 'Git history operations',
        },
    }
    return iconMap[group]
}

/**
 * Wrap a tool handler with metrics, audit interceptor, and `use_test_db` context isolation.
 */
export function wrapToolHandlerWithInterceptors(
    toolName: string,
    handler: (params: unknown) => unknown,
    config?: ToolHandlerConfig
): (args: Record<string, unknown>) => Promise<unknown> {
    const metricsInstance = config?.runtime?.metrics
    const metricsWrapped =
        metricsInstance !== undefined
            ? wrapWithMetrics(
                  toolName,
                  (args: Record<string, unknown>) => Promise.resolve(handler(args)),
                  metricsInstance
              )
            : (args: Record<string, unknown>) => Promise.resolve(handler(args))

    const interceptor =
        config?.runtime !== undefined && config.runtime !== null
            ? config.runtime.auditInterceptor
            : null

    const baseHandler =
        interceptor !== null && interceptor !== undefined
            ? (args: Record<string, unknown>): Promise<unknown> =>
                  interceptor.around(toolName, args, () => metricsWrapped(args))
            : metricsWrapped

    return (args: Record<string, unknown>): Promise<unknown> => {
        if (args['use_test_db'] === true) {
            const cleanArgs = { ...args }
            delete cleanArgs['use_test_db']
            return requestContextStorage.run({ useTestDb: true }, () => baseHandler(cleanArgs))
        }
        return baseHandler(args)
    }
}

/**
 * Instrument raw tool definitions with `use_test_db` schema extension and metrics/audit wrappers.
 */
export function instrumentToolDefinitions(
    rawDefs: ToolDefinition[],
    config?: ToolHandlerConfig
): ToolDefinition[] {
    return rawDefs.map((t) => {
        let schema = t.inputSchema
        if (schema instanceof z.ZodObject) {
            schema = schema.extend({ use_test_db: z.boolean().optional() })
        }
        const finalHandler = wrapToolHandlerWithInterceptors(t.name, t.handler, config)
        return {
            ...t,
            inputSchema: schema,
            handler: finalHandler as (params: unknown) => unknown,
        }
    })
}

/**
 * Throw descriptive ResourceNotFoundError with Code Mode guidance when an unknown tool is called.
 */
export function throwToolNotFoundError(name: string): never {
    if (name === 'read_resource' || name === 'readResource') {
        throw new ResourceNotFoundError(
            'Tool',
            `${name}. Code Mode cannot directly call read_resource as an MCP tool. Use mj_execute_code or query tools directly.`
        )
    }
    if (
        [
            'create_entry',
            'createEntry',
            'insert_entry',
            'insertEntry',
            'add_entry',
            'addEntry',
            'search_entries',
            'searchEntries',
            'get_recent_entries',
            'getRecentEntries',
            'list_projects',
            'listProjects',
            'get_project',
            'getProject',
        ].includes(name)
    ) {
        throw new ResourceNotFoundError(
            'Tool',
            `${name}. memory-journal-mcp uses Code Mode: use 'mj_execute_code' with JavaScript (e.g. return await mj.core.${name}(...)).`
        )
    }
    if (
        name.includes('.') ||
        name.startsWith('mj.') ||
        name.startsWith('mj_core_') ||
        name.startsWith('mj_admin_') ||
        name.startsWith('mj_search_')
    ) {
        throw new ResourceNotFoundError(
            'Tool',
            `${name}. '${name}' is a Code Mode JavaScript function/namespace, not a top-level MCP tool. Use 'mj_execute_code' with JavaScript (e.g. return await ${name}({ ... })).`
        )
    }
    throw new ResourceNotFoundError('Tool', name)
}
