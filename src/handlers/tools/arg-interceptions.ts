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
import { requestContextStorage, getRequestContext } from '../../utils/request-context.js'
import { applyArgInterceptions as applyCodeModeArgInterceptions } from '../../codemode/param-normalizer.js'
import {
    getActiveProjectRegistry,
    setActiveProjectRegistry,
} from '../../codemode/normalizers/generic-field-aliases.js'

function stripInternalNormalizerMarkers(val: unknown): unknown {
    if (typeof val !== 'object' || val === null) return val
    if (Array.isArray(val)) return val.map(stripInternalNormalizerMarkers)
    const obj = { ...(val as Record<string, unknown>) }
    delete obj['_alias_derived_workspace']
    if (Array.isArray(obj['entries'])) {
        obj['entries'] = obj['entries'].map(stripInternalNormalizerMarkers)
    }
    if (Array.isArray(obj['updates'])) {
        obj['updates'] = obj['updates'].map(stripInternalNormalizerMarkers)
    }
    return obj
}

/**
 * Apply argument interceptions and hallucination healing for MCP tool calls.
 */
export function applyArgInterceptions(
    methodName: string,
    args: unknown[]
): { args: unknown[] } | { error: Record<string, unknown> } {
    const res = applyCodeModeArgInterceptions(methodName, args)
    if ('error' in res) return res
    return { args: res.args.map(stripInternalNormalizerMarkers) }
}

const projectNumberToNameCache = new WeakMap<
    Record<string, ProjectRegistryEntry>,
    Map<number, string>
>()

function getProjectNameByNumber(
    registry: Record<string, ProjectRegistryEntry>,
    projectNumber: number
): string | undefined {
    let reverseMap = projectNumberToNameCache.get(registry)
    if (reverseMap === undefined) {
        reverseMap = new Map<number, string>()
        for (const [name, entry] of Object.entries(registry)) {
            if (entry.project_number !== undefined) {
                reverseMap.set(entry.project_number, name)
            }
        }
        projectNumberToNameCache.set(registry, reverseMap)
    }
    return reverseMap.get(projectNumber)
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
        const projectName = getProjectNameByNumber(registry, pNum)
        if (projectName !== undefined) {
            record['projectName'] = projectName
        }
    }
    for (const key of Object.keys(record)) {
        if (typeof record[key] === 'object' && record[key] !== null) {
            injectProjectNames(record[key], registry, depth + 1, seen)
        }
    }
}

interface ToolGroupIconMetadata {
    iconUrl: string
    title: string
    description: string
}

const TOOL_GROUP_ICON_METADATA: Record<string, ToolGroupIconMetadata> = {
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

/**
 * Map a tool group identifier to its Material Design icon metadata.
 */
export function getToolIcon(group: string): ToolGroupIconMetadata | undefined {
    return Object.hasOwn(TOOL_GROUP_ICON_METADATA, group)
        ? TOOL_GROUP_ICON_METADATA[group]
        : undefined
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

    return async (args: Record<string, unknown>): Promise<unknown> => {
        const prevRegistry = getActiveProjectRegistry()
        const hasScopedRegistry = config?.projectRegistry !== undefined
        if (hasScopedRegistry) {
            setActiveProjectRegistry(config.projectRegistry)
        }
        try {
            if ('use_test_db' in args) {
                const cleanArgs = { ...args }
                const useTest = cleanArgs['use_test_db'] === true
                delete cleanArgs['use_test_db']
                if (useTest) {
                    const existing = getRequestContext()
                    return await requestContextStorage.run({ ...existing, useTestDb: true }, () =>
                        baseHandler(cleanArgs)
                    )
                }
                return await baseHandler(cleanArgs)
            }
            return await baseHandler(args)
        } finally {
            if (hasScopedRegistry) {
                setActiveProjectRegistry(prevRegistry)
            }
        }
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
        } else if (schema instanceof z.ZodPipe && schema.out instanceof z.ZodObject) {
            schema = z.pipe(schema.in, schema.out.extend({ use_test_db: z.boolean().optional() }))
        } else if (schema instanceof z.ZodPipe && schema.in instanceof z.ZodObject) {
            const extendedIn: z.ZodType = schema.in.extend({ use_test_db: z.boolean().optional() })
            schema = z.pipe(extendedIn, schema.out)
        }
        const finalHandler = wrapToolHandlerWithInterceptors(t.name, t.handler, config)
        return {
            ...t,
            inputSchema: schema,
            handler: finalHandler as (params: unknown) => unknown,
        }
    })
}

const CODEMODE_FLAT_PREFIXES = [
    'mj_core_',
    'mj_admin_',
    'mj_search_',
    'mj_analytics_',
    'mj_relationships_',
    'mj_io_',
    'mj_github_',
    'mj_git_',
    'mj_backup_',
    'mj_team_',
]

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
        CODEMODE_FLAT_PREFIXES.some((prefix) => name.startsWith(prefix))
    ) {
        throw new ResourceNotFoundError(
            'Tool',
            `${name}. '${name}' is a Code Mode JavaScript function/namespace, not a top-level MCP tool. Use 'mj_execute_code' with JavaScript (e.g. return await ${name}({ ... })).`
        )
    }
    throw new ResourceNotFoundError('Tool', name)
}
