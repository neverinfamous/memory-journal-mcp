/**
 * Search Group — Cross-Team Discovery
 *
 * Implements the cross_team_search tool which queries multiple configured
 * team databases in parallel for organization-wide discovery.
 */

import { z } from 'zod'
import { ENTRY_TYPES, DATE_FORMAT_REGEX, DATE_FORMAT_MESSAGE, EntryOutputSchema } from '../schemas.js'
import { ErrorFieldsMixin } from '../error-fields-mixin.js'
import { DatabaseAdapterFactory } from '../../../database/adapter-factory.js'
import type { IDatabaseAdapter } from '../../../database/core/interfaces.js'
import type { ToolContext, ToolDefinition } from '../../../types/index.js'
import { ConfigurationError } from '../../../types/errors.js'
import { mergeMultipleSources, type EntryWithSource } from './helpers.js'
import { logger } from '../../../utils/logger.js'

// ============================================================================
// Schemas
// ============================================================================

export const CrossTeamSearchSchema = z.object({
    query: z.string().min(1).max(250),
    team_dbs: z
        .array(z.string())
        .optional()
        .describe('Specific team DB labels to search. Omit to search all configured DBs.'),
    tags: z.array(z.string()).optional(),
    entry_type: z.enum(ENTRY_TYPES).optional(),
    start_date: z.string().regex(DATE_FORMAT_REGEX, DATE_FORMAT_MESSAGE).optional(),
    end_date: z.string().regex(DATE_FORMAT_REGEX, DATE_FORMAT_MESSAGE).optional(),
    limit: z.number().max(500).optional().default(20),
    sort_by: z
        .enum(['timestamp', 'importance'])
        .optional()
        .default('timestamp')
        .describe('Sort results by timestamp (default) or importance score'),
    include_archived: z.boolean().optional().default(false),
    fuzzy_match: z.boolean().optional().default(false),
})

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

// Module-level cache for lazily initialized team DB adapters.
// This is safe because MCP instances are singleton processes and additionalTeamDbs is static.
const adapterCache = new Map<string, IDatabaseAdapter>()

async function getOrCreateAdapter(label: string, path: string): Promise<IDatabaseAdapter> {
    const existing = adapterCache.get(label)
    if (existing) {
        return existing
    }
    const adapter = await DatabaseAdapterFactory.create(path)
    await adapter.initialize()
    adapter.applyTeamSchema()
    adapterCache.set(label, adapter)
    return adapter
}

export function resetCrossTeamCacheForTests(): void {
    adapterCache.clear()
}

// ============================================================================
// Handler
// ============================================================================

export async function handleCrossTeamSearch(
    args: z.infer<typeof CrossTeamSearchSchema>,
    context: ToolContext
): Promise<z.infer<typeof CrossTeamSearchOutputSchema>> {
    const { config } = context

    // 1. Resolve configured additional team DBs
    const additionalDbs: Record<string, string> = { ...(config?.additionalTeamDbs ?? {}) }
    
    // The list of all valid labels to search
    const configuredLabels = Object.keys(additionalDbs)
    if (context.teamDb) {
        configuredLabels.push('primary')
    }

    if (configuredLabels.length === 0) {
        throw new ConfigurationError(
            'Cross-team search requires ADDITIONAL_TEAM_DBS environment variable to be configured.'
        )
    }

    // 2. Filter DBs based on requested labels (if any)
    const targetLabels = args.team_dbs && args.team_dbs.length > 0
        ? args.team_dbs.filter(label => configuredLabels.includes(label))
        : configuredLabels

    if (targetLabels.length === 0 && args.team_dbs && args.team_dbs.length > 0) {
        // Requested specific DBs, but none exist in config
        return {
            success: true,
            entries: [],
            count: 0,
            searched_dbs: [],
            degraded: true,
            errors: [{ team_db: args.team_dbs.join(','), error: 'None of the requested team DBs are configured.' }],
        }
    }

    // 3. Query DBs in parallel
    // We request up to MAX limit from each DB to ensure we have enough post-merge candidates
    const perDbLimit = Math.min(args.limit * 2, 500)

    const searchPromises = targetLabels.map(async (label) => {
        let adapter: IDatabaseAdapter
        
        if (label === 'primary') {
            if (!context.teamDb) throw new Error('Primary team database not configured')
            adapter = context.teamDb
        } else {
            const dbPath = additionalDbs[label]
            if (!dbPath) throw new Error(`Missing configured path for ${label}`)
            adapter = await getOrCreateAdapter(label, dbPath)
        }

        const results = adapter.searchEntries(args.query, {
            limit: perDbLimit,
            tags: args.tags,
            entryType: args.entry_type,
            startDate: args.start_date,
            endDate: args.end_date,
            fuzzy_match: args.fuzzy_match,
            includeArchived: args.include_archived,
        })

        // Tag entries with their source
        return results.entries.map((entry) => ({
            ...entry,
            source: 'team' as const,
            team_db: label,
        }))
    })

    const settled = await Promise.allSettled(searchPromises)

    // 4. Collect results and errors
    const sources: EntryWithSource[][] = []
    const errors: { team_db: string; error: string }[] = []
    const searched_dbs: string[] = []
    let degraded = false

    for (let i = 0; i < settled.length; i++) {
        const label = targetLabels[i]
        const result = settled[i]
        if (!label || !result) continue

        if (result.status === 'fulfilled') {
            sources.push(result.value)
            searched_dbs.push(label)
        } else {
            degraded = true
            const errorMessage = result.reason instanceof Error ? result.reason.message : String(result.reason)
            errors.push({ team_db: label, error: errorMessage })
            logger.error(`Cross-team search failed for DB: ${label}`, {
                module: 'CrossTeamSearch',
                error: errorMessage,
            })
        }
    }

    // 5. Merge, sort, and apply final limit
    const merged = mergeMultipleSources(sources, args.limit, args.sort_by)

    // Ensure we enforce schema matching
    const finalEntries = merged.map((entry) => {
        const { source, ...rest } = entry
        void source
        // Strip any specific things we don't want leaked in the schema
        return {
            ...rest,
            team_db: entry.team_db || '',
        } as z.infer<typeof EntryOutputSchema> & { team_db: string; author?: string | null }
    })

    return {
        success: true,
        entries: finalEntries,
        count: finalEntries.length,
        searched_dbs,
        ...(degraded ? { degraded: true, errors } : { degraded: false }),
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
            inputSchema: CrossTeamSearchSchema,
            outputSchema: CrossTeamSearchOutputSchema,
            handler: async (args: unknown) => {
                try {
                    const parsed = CrossTeamSearchSchema.parse(args)
                    return await handleCrossTeamSearch(parsed, context)
                } catch (error) {
                    const { formatHandlerError } = await import('../../../utils/error-helpers.js');
                    return formatHandlerError(error);
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
