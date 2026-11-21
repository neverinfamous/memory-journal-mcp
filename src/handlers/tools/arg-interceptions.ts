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
import { invalidateSerializedPayload, wrapWithMetrics } from '../../observability/index.js'
import { requestContextStorage, getRequestContext } from '../../utils/request-context.js'
import { applyArgInterceptions as applyCodeModeArgInterceptions } from '../../codemode/param-normalizer.js'
import {
    getActiveProjectRegistry,
    setActiveProjectRegistry,
    setFallbackProjectRegistryLoader,
} from '../../codemode/normalizers/generic-field-aliases.js'
import { loadProjectRegistryFromConfig } from '../../utils/workspace-resolver.js'

setFallbackProjectRegistryLoader(loadProjectRegistryFromConfig)

function stripMarkerArray(items: unknown[]): unknown[] {
    let changed = false
    const next = items.map((item) => {
        const cleaned = stripInternalNormalizerMarkers(item)
        if (cleaned !== item) changed = true
        return cleaned
    })
    return changed ? next : items
}

function stripInternalNormalizerMarkers(val: unknown): unknown {
    if (typeof val !== 'object' || val === null) return val
    if (Array.isArray(val)) return stripMarkerArray(val)
    const record = val as Record<string, unknown>
    const hasMarker = '_alias_derived_workspace' in record
    const rawEntries = Array.isArray(record['entries']) ? (record['entries'] as unknown[]) : undefined
    const cleanedEntries = rawEntries !== undefined ? stripMarkerArray(rawEntries) : undefined
    const rawUpdates = Array.isArray(record['updates']) ? (record['updates'] as unknown[]) : undefined
    const cleanedUpdates = rawUpdates !== undefined ? stripMarkerArray(rawUpdates) : undefined
    if (
        !hasMarker &&
        cleanedEntries === rawEntries &&
        cleanedUpdates === rawUpdates
    ) {
        return val
    }
    const obj = { ...record }
    if (hasMarker) delete obj['_alias_derived_workspace']
    if (cleanedEntries !== rawEntries && cleanedEntries !== undefined) {
        obj['entries'] = cleanedEntries
    }
    if (cleanedUpdates !== rawUpdates && cleanedUpdates !== undefined) {
        obj['updates'] = cleanedUpdates
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

function getReverseProjectMap(
    registry: Record<string, ProjectRegistryEntry>
): Map<number, string> {
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
    return reverseMap
}

const projectNamesInjected = new WeakSet()

function injectProjectNamesRecursive(
    obj: unknown,
    reverseMap: ReadonlyMap<number, string>,
    depth: number,
    seen: WeakSet<object>
): boolean {
    if (depth > 10 || obj === undefined || obj === null || typeof obj !== 'object') {
        return false
    }
    if (seen.has(obj)) return false
    seen.add(obj)

    let mutated = false
    if (Array.isArray(obj)) {
        for (const item of obj as unknown[]) {
            if (typeof item === 'object' && item !== null) {
                if (injectProjectNamesRecursive(item, reverseMap, depth + 1, seen)) {
                    mutated = true
                }
            }
        }
        return mutated
    }

    const record = obj as Record<string, unknown>
    const pNum =
        typeof record['projectNumber'] === 'number'
            ? record['projectNumber']
            : typeof record['project_number'] === 'number'
              ? record['project_number']
              : undefined

    if (pNum !== undefined && typeof record['projectName'] === 'undefined') {
        const projectName = reverseMap.get(pNum)
        if (projectName !== undefined) {
            record['projectName'] = projectName
            mutated = true
        }
    }
    for (const key of Object.keys(record)) {
        const child = record[key]
        if (typeof child === 'object' && child !== null) {
            if (injectProjectNamesRecursive(child, reverseMap, depth + 1, seen)) {
                mutated = true
            }
        }
    }
    return mutated
}

/**
 * Inject resolved project names from the project registry into tool responses.
 */
export function injectProjectNames(
    obj: unknown,
    registry?: Record<string, ProjectRegistryEntry>,
    depth = 0,
    seen?: WeakSet<object>
): void {
    if (registry === undefined || obj === undefined || obj === null || typeof obj !== 'object') {
        return
    }
    if (depth === 0 && projectNamesInjected.has(obj)) {
        return
    }
    const reverseMap = getReverseProjectMap(registry)
    if (reverseMap.size > 0) {
        const mutated = injectProjectNamesRecursive(obj, reverseMap, depth, seen ?? new WeakSet())
        if (mutated) {
            invalidateSerializedPayload(obj)
        }
    }
    if (depth === 0) {
        projectNamesInjected.add(obj)
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
    const innerHandler = (args: Record<string, unknown>): Promise<unknown> =>
        Promise.resolve(handler(args)).then((res) => {
            injectProjectNames(res, config?.projectRegistry)
            return res
        })
    const metricsInstance = config?.runtime?.metrics
    const metricsWrapped =
        metricsInstance !== undefined
            ? wrapWithMetrics(toolName, innerHandler, metricsInstance)
            : innerHandler

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

const USE_TEST_DB_EXTEND_SHAPE = { use_test_db: z.boolean().optional() }
const EXTENDED_TEST_DB_SCHEMA_CACHE = new WeakMap<object, z.ZodType>()

function extendSchemaWithUseTestDb(rawSchema: z.ZodType): z.ZodType
function extendSchemaWithUseTestDb(rawSchema: unknown): unknown
function extendSchemaWithUseTestDb(rawSchema: unknown): unknown {
    if (typeof rawSchema !== 'object' || rawSchema === null) return rawSchema
    const cached = EXTENDED_TEST_DB_SCHEMA_CACHE.get(rawSchema)
    if (cached !== undefined) return cached
    let extended = rawSchema
    if (rawSchema instanceof z.ZodObject) {
        extended = rawSchema.extend(USE_TEST_DB_EXTEND_SHAPE)
    } else if (rawSchema instanceof z.ZodPipe && rawSchema.out instanceof z.ZodObject) {
        extended = z.pipe(
            rawSchema.in as z.ZodType,
            rawSchema.out.extend(USE_TEST_DB_EXTEND_SHAPE)
        )
    } else if (rawSchema instanceof z.ZodPipe && rawSchema.in instanceof z.ZodObject) {
        const extendedIn: z.ZodType = rawSchema.in.extend(USE_TEST_DB_EXTEND_SHAPE)
        extended = z.pipe(extendedIn, rawSchema.out)
    }
    if (extended !== rawSchema && extended instanceof z.ZodType) {
        EXTENDED_TEST_DB_SCHEMA_CACHE.set(rawSchema, extended)
    }
    return extended
}

/**
 * Instrument raw tool definitions with `use_test_db` schema extension and metrics/audit wrappers.
 */
export function instrumentToolDefinitions(
    rawDefs: ToolDefinition[],
    config?: ToolHandlerConfig
): ToolDefinition[] {
    return rawDefs.map((t) => {
        const schema = extendSchemaWithUseTestDb(t.inputSchema)
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
    const CORE_CODEMODE_HINTS: Record<string, string> = {
        create_entry: 'mj.core.createEntry',
        createEntry: 'mj.core.createEntry',
        insert_entry: 'mj.core.createEntry',
        insertEntry: 'mj.core.createEntry',
        add_entry: 'mj.core.createEntry',
        addEntry: 'mj.core.createEntry',
        search_entries: 'mj.search.searchEntries',
        searchEntries: 'mj.search.searchEntries',
        get_recent_entries: 'mj.core.getRecentEntries',
        getRecentEntries: 'mj.core.getRecentEntries',
        list_projects: 'mj.admin.listProjects',
        listProjects: 'mj.admin.listProjects',
        get_project: 'mj.admin.getProject',
        getProject: 'mj.admin.getProject',
    }
    const hintMethod = CORE_CODEMODE_HINTS[name]
    if (hintMethod !== undefined) {
        throw new ResourceNotFoundError(
            'Tool',
            `${name}. memory-journal-mcp uses Code Mode: use 'mj_execute_code' with JavaScript (e.g. return await ${hintMethod}(...)).`
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
