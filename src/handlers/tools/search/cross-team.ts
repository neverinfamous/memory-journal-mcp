/**
 * Search Group — Cross-Team Discovery
 *
 * Implements the cross_team_search tool which queries multiple configured
 * team databases in parallel for organization-wide discovery.
 */

import { z } from 'zod'
import { healSearchPayload } from '../schemas/hallucination-healer.js'
import {
    ENTRY_TYPES,
    DATE_FORMAT_REGEX,
    DATE_FORMAT_MESSAGE,
    EntryOutputSchema,
    coerceIntString,
    relaxedNumber,
    StrictProjectNumberSchema,
} from '../schemas.js'
import { ErrorFieldsMixin } from '../error-fields-mixin.js'
import { DatabaseAdapterFactory } from '../../../database/adapter-factory.js'
import type { IDatabaseAdapter } from '../../../database/core/interfaces.js'
import type { ToolContext, ToolDefinition } from '../../../types/index.js'
import { ConfigurationError, PermissionError, ValidationError } from '../../../types/errors.js'
import { enforceAccessBoundary } from '../../../auth/validation.js'
import { enforceTeamRbac, getCallerIdentity } from '../team/rbac.js'
import { resolveTeamProjectNumber } from '../team/helpers.js'
import { formatHandlerError } from '../../../utils/error-helpers.js'
import { sanitizeAuthor, sanitizeErrorForLogging } from '../../../utils/security-utils.js'
import { resolveWorkspaceId } from '../../../utils/workspace-resolver.js'
import { activeProjectRegistry } from '../../../utils/write-scope.js'
import { mergeMultipleSources, type EntryWithSource } from './helpers.js'
import { logger } from '../../../utils/logger.js'

// ============================================================================
// Schemas
// ============================================================================

export const CrossTeamSearchSchema = z.preprocess(
    healSearchPayload,
    z.object({
    query: z.string().min(1).max(250),
    team_dbs: z
        .array(z.string())
        .optional()
        .describe('Specific team DB labels to search. Omit to search all configured DBs.'),
    tags: z.array(z.string()).optional(),
    exclude_tags: z.array(z.string()).optional(),
    project_number: z.preprocess(coerceIntString, StrictProjectNumberSchema).optional(),
    workspace_id: z.string().max(255).optional().describe('Optional workspace isolation identifier (e.g. "alpha"). Do not use numeric project IDs or "workspace" as the key.'),
    entry_type: z.enum(ENTRY_TYPES).optional(),
    start_date: z.string().regex(DATE_FORMAT_REGEX, DATE_FORMAT_MESSAGE).optional(),
    end_date: z.string().regex(DATE_FORMAT_REGEX, DATE_FORMAT_MESSAGE).optional(),
    limit: z.preprocess(coerceIntString, z.number().int().min(1).max(500)).optional().default(20),
    sort_by: z
        .enum(['timestamp', 'importance'])
        .optional()
        .default('timestamp')
        .describe('Sort results by timestamp (default) or importance score'),
    include_archived: z.boolean().optional().default(false),
    fuzzy_match: z.boolean().optional().default(false),
}).strict()
)

export const CrossTeamSearchSchemaMcp = z.preprocess(
    healSearchPayload,
    z
        .object({
            query: z.string().optional(),
            team_dbs: z
                .array(z.string())
                .optional()
                .describe('Specific team DB labels to search. Omit to search all configured DBs.'),
            tags: z.array(z.string()).optional(),
            exclude_tags: z.array(z.string()).optional(),
            project_number: relaxedNumber().optional(),
            workspace_id: z
                .string()
                .optional()
                .describe(
                    'Optional workspace isolation identifier (e.g. "alpha"). Do not use numeric project IDs or "workspace" as the key.'
                ),
            entry_type: z.string().optional(),
            start_date: z.string().optional(),
            end_date: z.string().optional(),
            limit: relaxedNumber().optional().default(20),
            sort_by: z
                .string()
                .optional()
                .default('timestamp')
                .describe('Sort results by timestamp (default) or importance score'),
            include_archived: z.boolean().optional().default(false),
            fuzzy_match: z.boolean().optional().default(false),
        })
        .strict()
)

export const CrossTeamSearchOutputSchema = z
    .object({
        success: z.boolean().optional(),
        entries: z
            .array(
                EntryOutputSchema.extend({
                    team_db: z.string(),
                    author: z.string().nullable().optional(),
                })
            )
            .optional(),
        count: z.number().optional(),
        searched_dbs: z.array(z.string()).optional(),
        degraded: z.boolean().optional(),
        errors: z
            .array(
                z.object({
                    team_db: z.string(),
                    error: z.string(),
                })
            )
            .optional(),
        error: z.string().optional(),
    })
    .extend(ErrorFieldsMixin.shape)

// ============================================================================
// State
// ============================================================================

// Module-level cache for lazily initialized team DB adapters, keyed by label and verified by resolved path.
const adapterCache = new Map<string, { path: string; adapter: IDatabaseAdapter }>()
const initPromises = new Map<string, Promise<IDatabaseAdapter>>()

async function getOrCreateAdapter(label: string, dbPath: string): Promise<IDatabaseAdapter> {
    const existing = adapterCache.get(label)
    if (existing !== undefined) {
        if (existing.path === dbPath) {
            return existing.adapter
        }
        try {
            existing.adapter.close()
        } catch {
            // Best-effort close on path change
        }
        adapterCache.delete(label)
    }
    const inflightKey = `${label}\0${dbPath}`
    const inflight = initPromises.get(inflightKey)
    if (inflight !== undefined) {
        return inflight
    }
    const promise = (async () => {
        const adapter = await DatabaseAdapterFactory.create(dbPath)
        try {
            await adapter.initialize()
            adapter.applyTeamSchema()
            adapterCache.set(label, { path: dbPath, adapter })
            return adapter
        } catch (err) {
            try {
                adapter.close()
            } catch {
                // Ignore cleanup errors on init failure
            }
            throw err
        } finally {
            initPromises.delete(inflightKey)
        }
    })()
    initPromises.set(inflightKey, promise)
    return promise
}

export function closeCrossTeamAdapters(): void {
    for (const entry of adapterCache.values()) {
        try {
            entry.adapter.close()
        } catch {
            // Ignore cleanup errors during shutdown
        }
    }
    adapterCache.clear()
    initPromises.clear()
}

export function resetCrossTeamCacheForTests(): void {
    closeCrossTeamAdapters()
}

// ============================================================================
// Handler
// ============================================================================

type CrossTeamSearchArgs = z.infer<typeof CrossTeamSearchSchema>

function resolveCrossTeamTargetLabels(
    args: CrossTeamSearchArgs,
    context: ToolContext,
    additionalDbs: Record<string, string>
): string[] {
    const configuredLabels = Object.keys(additionalDbs)
    if (context.teamDb) configuredLabels.push('primary')
    if (configuredLabels.length === 0) {
        throw new ConfigurationError(
            'Cross-team search requires ADDITIONAL_TEAM_DBS environment variable to be configured.'
        )
    }
    const targetLabels =
        args.team_dbs && args.team_dbs.length > 0
            ? args.team_dbs.filter((label) => configuredLabels.includes(label))
            : configuredLabels
    if (targetLabels.length === 0 && args.team_dbs && args.team_dbs.length > 0) {
        throw new ValidationError('None of the requested team DBs are configured.', {
            team_dbs: args.team_dbs,
        })
    }
    return targetLabels
}

async function querySingleTeamDb(
    label: string,
    args: CrossTeamSearchArgs,
    context: ToolContext,
    additionalDbs: Record<string, string>,
    caller: ReturnType<typeof getCallerIdentity>,
    wsId: string,
    alignedProject: number | undefined,
    perDbLimit: number
): Promise<EntryWithSource[]> {
    let adapter: IDatabaseAdapter
    if (label === 'primary') {
        if (!context.teamDb) throw new Error('Primary team database not configured')
        adapter = context.teamDb
        if (adapter.isTeamRbacActive?.()) {
            enforceTeamRbac(context, caller, 'viewer', wsId)
        }
    } else {
        const dbPath = additionalDbs[label]
        if (!dbPath) throw new Error(`Missing configured path for ${label}`)
        adapter = await getOrCreateAdapter(label, dbPath)
        if (adapter.isTeamRbacActive?.()) {
            enforceTeamRbac({ ...context, teamDb: adapter }, caller, 'viewer', wsId)
        }
    }

    const results = adapter.searchEntries(args.query, {
        limit: perDbLimit,
        tags: args.tags,
        ...(args.exclude_tags !== undefined ? { excludeTags: args.exclude_tags } : {}),
        entryType: args.entry_type,
        startDate: args.start_date,
        endDate: args.end_date,
        sortBy: args.sort_by,
        fuzzy_match: args.fuzzy_match,
        includeArchived: args.include_archived,
        workspaceId: wsId,
        ...(alignedProject !== undefined ? { projectNumber: alignedProject } : {}),
    })
    return results.entries.map((entry) => ({ ...entry, source: 'team' as const, team_db: label }))
}

function collectSettledTeamResults(
    settled: PromiseSettledResult<EntryWithSource[]>[],
    targetLabels: string[]
): {
    sources: EntryWithSource[][]
    errors: { team_db: string; error: string }[]
    searched_dbs: string[]
    degraded: boolean
} {
    const sources: EntryWithSource[][] = []
    const errors: { team_db: string; error: string }[] = []
    const searched_dbs: string[] = []
    let degraded = false
    let authFailure: Error | undefined

    for (let i = 0; i < settled.length; i++) {
        const label = targetLabels[i]
        const result = settled[i]
        if (!label || !result) continue
        if (result.status === 'fulfilled') {
            sources.push(result.value)
            searched_dbs.push(label)
        } else {
            degraded = true
            if (authFailure === undefined && result.reason instanceof Error && result.reason.name === 'AuthorizationError') {
                authFailure = result.reason
            }
            const errorMessage = sanitizeErrorForLogging(
                result.reason instanceof Error ? result.reason.message : String(result.reason)
            )
            errors.push({ team_db: label, error: errorMessage })
            logger.error(`Cross-team search failed for DB: ${label}`, {
                module: 'CrossTeamSearch',
                error: errorMessage,
            })
        }
    }
    if (searched_dbs.length === 0 && errors.length > 0 && authFailure !== undefined) {
        throw authFailure
    }
    return { sources, errors, searched_dbs, degraded }
}

export async function handleCrossTeamSearch(
    args: CrossTeamSearchArgs,
    context: ToolContext
): Promise<z.infer<typeof CrossTeamSearchOutputSchema>> {
    const { config } = context
    const wsId = resolveWorkspaceId(args.workspace_id, args.project_number, config)
    const activeRegistry = activeProjectRegistry(config?.projectRegistry)
    const hasActiveRegistry =
        activeRegistry !== undefined && Object.keys(activeRegistry).length > 0
    const resolvedProj = resolveTeamProjectNumber(
        context,
        wsId,
        args.project_number,
        args.workspace_id
    )
    const alignedProject = typeof resolvedProj === 'number' ? resolvedProj : undefined
    if ((wsId === '*' || hasActiveRegistry) && alignedProject === undefined) {
        throw new ValidationError(
            'cross_team_search requires an explicit project_number bound to the workspace'
        )
    }
    const additionalDbs: Record<string, string> = { ...(config?.additionalTeamDbs ?? {}) }
    const targetLabels = resolveCrossTeamTargetLabels(args, context, additionalDbs)

    const caller = getCallerIdentity()
    const perDbLimit = Math.min(args.limit * 2, 500)
    const settled = await Promise.allSettled(
        targetLabels.map((label) =>
            querySingleTeamDb(
                label,
                args,
                context,
                additionalDbs,
                caller,
                wsId,
                alignedProject,
                perDbLimit
            )
        )
    )

    const { sources, errors, searched_dbs, degraded } = collectSettledTeamResults(
        settled,
        targetLabels
    )
    const merged = mergeMultipleSources(sources, args.limit, args.sort_by)
    const finalEntries = merged.map((entry) => {
        const rawAuthor: unknown =
            'author' in entry ? (entry as { author?: unknown }).author : undefined
        const author =
            typeof rawAuthor === 'string'
                ? sanitizeAuthor(rawAuthor)
                : rawAuthor === null
                  ? null
                  : undefined
        return {
            ...entry,
            team_db: entry.team_db || '',
            source: entry.source ?? ('team' as const),
            ...(author !== undefined ? { author } : {}),
        }
    }) as (z.infer<typeof EntryOutputSchema> & { team_db: string; author?: string | null })[]

    const everySearchFailed = searched_dbs.length === 0 && errors.length > 0
    return {
        success: !everySearchFailed,
        entries: finalEntries,
        count: finalEntries.length,
        searched_dbs,
        ...(degraded ? { degraded: true, errors } : { degraded: false }),
        ...(everySearchFailed ? { error: 'Every team database query failed', code: 'DATABASE_ERROR' } : {}),
    }
}

// ============================================================================
// Tool Definition
// ============================================================================

export function getCrossTeamTools(context: ToolContext): ToolDefinition[] {


    return [
        {
            name: 'cross_team_search',
            title: 'Cross-Team Search',
            description: 'Search across multiple configured team databases simultaneously. Returns results with team_db labels.',
            group: 'search',
            capabilities: { requiresTeamScope: true },
            inputSchema: CrossTeamSearchSchemaMcp,
            outputSchema: CrossTeamSearchOutputSchema,
            handler: async (args: unknown) => {
                try {
                    enforceAccessBoundary(
                        'cross_team_search',
                        'tool',
                        { requiresTeamScope: true },
                        context.config?.runtime?.auditLogger
                    )
                    const parsed = CrossTeamSearchSchema.parse(args)
                    return await handleCrossTeamSearch(parsed, context)
                } catch (error) {
                    if (error instanceof PermissionError) throw error
                    return formatHandlerError(error)
                }
            },
            annotations: {
                openWorldHint: false,
                readOnlyHint: true,
                destructiveHint: false,
                idempotentHint: true,
            },
        },
    ]
}
