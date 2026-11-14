import { VectorSearchManager } from '../../vector/vector-search-manager/index.js'
import { VectorSearchManagerProxy } from '../../vector/vector-search-manager/VectorSearchManagerProxy.js'
import { logger } from '../../utils/logger.js'
import {
    parseToolFilter,
    getToolFilterFromEnv,
    getFilterSummary,
    getAllToolNames,
} from '../../filtering/tool-filter.js'
import { Scheduler } from '../scheduler.js'
import { runAutoPrune } from '../auto-prune.js'
import { resolveAutoPruneScope, resolveWorkspaceId } from '../../utils/workspace-resolver.js'
export { resolveAutoPruneScope }
import type { ServerRuntime } from '../../utils/maintenance-lock.js'
import type { IDatabaseAdapter } from '../../database/core/interfaces.js'
import type { ToolFilterConfig } from '../../filtering/tool-filter.js'
import type { ServerOptions } from './types.js'

/**
 * Helpers extracted from `initializeDependencies` (startup auto-prune, vector managers,
 * tool filter resolution, scheduler wiring, digest seeding). Behaviour is unchanged.
 */

/**
 * Auto-prune low-importance old entries if any retention threshold is configured.
 * [INVARIANT] Must run after the `--config` file is loaded so the prune is scoped to the
 * effective default workspace/project (H3); `scope` carries those loaded values.
 */
export async function runStartupAutoPrune(
    db: IDatabaseAdapter,
    options: ServerOptions,
    scope?: {
        defaultWorkspaceId?: string
        defaultProjectNumber?: number
        projectRegistry?: ServerOptions['projectRegistry']
    }
): Promise<void> {
    const hasAutoPrune =
        (options.archiveOlderThanDays ?? 0) > 0 ||
        (options.pruneOlderThanDays ?? 0) > 0 ||
        (options.hardDeleteOlderThanDays ?? 0) > 0

    if (!hasAutoPrune) return

    const defaultWorkspaceId = scope?.defaultWorkspaceId ?? options.defaultWorkspaceId
    const defaultProjectNumber = scope?.defaultProjectNumber ?? options.defaultProjectNumber
    const projectRegistry = scope?.projectRegistry ?? options.projectRegistry
    const pruneScope = resolveAutoPruneScope(
        defaultWorkspaceId,
        defaultProjectNumber,
        projectRegistry
    )
    const pruneResult = await runAutoPrune(db, {
        archiveOlderThanDays: options.archiveOlderThanDays ?? 0,
        pruneOlderThanDays: options.pruneOlderThanDays ?? 0,
        hardDeleteOlderThanDays: options.hardDeleteOlderThanDays ?? 0,
        importanceThreshold: options.pruneImportanceThreshold ?? 0.15,
        dryRun: options.pruneDryRun,
        excludeTags: options.pruneExcludeTags,
        workspaceId: pruneScope.workspaceId,
        ...(pruneScope.projectNumber !== undefined
            ? { projectNumber: pruneScope.projectNumber }
            : {}),
    })
    if (pruneResult.aborted === true) {
        throw new Error('Auto-prune aborted because the pre-prune backup failed')
    }
    logger.info('Auto-prune completed', {
        module: 'McpServer',
        archivedCount: pruneResult.archivedCount,
        prunedCount: pruneResult.prunedCount,
        hardDeletedCount: pruneResult.hardDeletedCount,
        backupFile: pruneResult.backupFile,
    })
}

export interface VectorManagers {
    vectorManager: VectorSearchManagerProxyResult
    teamVectorManager: VectorSearchManagerProxyResult | undefined
}

type VectorSearchManagerProxyResult = ReturnType<typeof VectorSearchManagerProxy.create>

interface VectorManagerInputs {
    options: ServerOptions
    primaryDb: IDatabaseAdapter
    testDb: IDatabaseAdapter | undefined
    primaryTeamDb: IDatabaseAdapter | undefined
    testTeamDb: IDatabaseAdapter | undefined
}

/**
 * Create the (lazy) vector search managers and kick off background initialization
 * (and optional index rebuild) without blocking startup.
 */
export function createVectorManagers(inputs: VectorManagerInputs): VectorManagers {
    const { options, primaryDb, testDb, primaryTeamDb, testTeamDb } = inputs

    // Initialize vector search manager (lazy loading - model loads on first use)
    const primaryVectorManager = new VectorSearchManager(primaryDb, { modelName: options.embeddingModel })
    let testVectorManager: VectorSearchManager | undefined
    if (testDb) {
        testVectorManager = new VectorSearchManager(testDb, { modelName: options.embeddingModel })
    }
    const vectorManager = VectorSearchManagerProxy.create(primaryVectorManager, testVectorManager)

    // Initialize team vector search manager if team DB is configured
    let primaryTeamVectorManager: VectorSearchManager | undefined
    let testTeamVectorManager: VectorSearchManager | undefined
    let teamVectorManager: VectorSearchManagerProxyResult | undefined
    if (primaryTeamDb) {
        primaryTeamVectorManager = new VectorSearchManager(primaryTeamDb, { modelName: options.embeddingModel })
        if (testTeamDb) {
            testTeamVectorManager = new VectorSearchManager(testTeamDb, { modelName: options.embeddingModel })
        }
        teamVectorManager = VectorSearchManagerProxy.create(primaryTeamVectorManager, testTeamVectorManager)
        logger.info('Team vector search manager created', { module: 'McpServer' })
    }

    // Auto-rebuild vector index if enabled (non-blocking)
    if (options.autoRebuildIndex) {
        logger.info('Auto-rebuilding vector index in background...', { module: 'McpServer' })
        primaryVectorManager
            .initialize()
            .then(async () => {
                const rebuilt = await primaryVectorManager.rebuildIndex()
                const rebuildLog = {
                    module: 'McpServer',
                    entriesIndexed: rebuilt.indexed,
                    success: rebuilt.success,
                    failed: rebuilt.failed,
                    firstError: rebuilt.firstError,
                }
                if (rebuilt.success) {
                    logger.info('Vector index rebuilt in background', rebuildLog)
                } else {
                    logger.error('Vector index rebuild failed in background', rebuildLog)
                }
            })
            .catch((err: unknown) => {
                logger.error('Background vector init/rebuild failed', {
                    module: 'McpServer',
                    error: err,
                })
            })

        if (testVectorManager) {
            testVectorManager.initialize().catch((err: unknown) => {
                logger.error('Background test vector init failed', { module: 'McpServer', error: err })
            })
        }

        if (primaryTeamVectorManager) {
            primaryTeamVectorManager.initialize().catch((err: unknown) => {
                logger.error('Background team vector init failed', {
                    module: 'McpServer',
                    error: err,
                })
            })
            if (testTeamVectorManager) {
                testTeamVectorManager.initialize().catch((err: unknown) => {
                    logger.error('Background test team vector init failed', { module: 'McpServer', error: err })
                })
            }
            logger.info('Team vector search manager eager initialization started in background', {
                module: 'McpServer',
            })
        }
    } else {
        // Otherwise, eager-load the model in the background so the first request isn't blocked
        logger.info('Vector search manager eager initialization started in background', {
            module: 'McpServer',
        })
        primaryVectorManager
            .initialize()
            .then(async () => {
                if (testVectorManager) await testVectorManager.initialize()

                // Initialize team vector sequentially to avoid concurrent ONNX model loading crashes
                if (primaryTeamVectorManager) {
                    logger.info(
                        'Team vector search manager eager initialization started in background',
                        { module: 'McpServer' }
                    )
                    await primaryTeamVectorManager.initialize()
                    if (testTeamVectorManager) await testTeamVectorManager.initialize()
                }
            })
            .catch((err: unknown) => {
                logger.error('Background vector init failed', { module: 'McpServer', error: err })
            })
    }

    return { vectorManager, teamVectorManager }
}

/** Resolve the tool filter from options/env and warn about context bloat when unfiltered. */
export function resolveToolFilterConfig(options: ServerOptions): ToolFilterConfig | null {
    let filterConfig: ToolFilterConfig | null
    if (options.toolFilter) {
        filterConfig = parseToolFilter(options.toolFilter)
        logger.info('Tool filter applied', {
            module: 'McpServer',
            summary: getFilterSummary(filterConfig),
        })
    } else {
        filterConfig = getToolFilterFromEnv()
        if (filterConfig) {
            logger.info('Tool filter from env', {
                module: 'McpServer',
                summary: getFilterSummary(filterConfig),
            })
        }
    }

    if (!filterConfig) {
        const totalTools = getAllToolNames().length
        if (totalTools > 50) {
            logger.warning(`CONTEXT BLOAT WARNING: ${totalTools} tools are being registered without a tool filter.`)
            logger.warning(`  This may consume excessive context window in the LLM. Consider using '--tool-filter codemode' or '--tool-filter starter' to save tokens.`)
        }
    }
    return filterConfig
}

/**
 * Build the scheduler (HTTP/SSE only) when any job interval is configured.
 * Inherits auto-prune thresholds and the default workspace from the server options.
 */
export function createSchedulerIfConfigured(
    options: ServerOptions,
    db: IDatabaseAdapter,
    vectorManager: ConstructorParameters<typeof Scheduler>[2],
    runtime: ServerRuntime
): Scheduler | null {
    if (!options.scheduler) return null

    const hasAnyJob =
        options.scheduler.backupIntervalMinutes > 0 ||
        options.scheduler.vacuumIntervalMinutes > 0 ||
        options.scheduler.rebuildIndexIntervalMinutes > 0 ||
        options.scheduler.digestIntervalMinutes > 0 ||
        options.scheduler.pruneIntervalMinutes > 0 ||
        options.scheduler.reportIntervalMinutes > 0

    if (hasAnyJob && options.transport === 'stdio') {
        logger.warning(
            'Scheduler options ignored for stdio transport (session is ephemeral). ' +
                'Use HTTP/SSE transport for automated scheduling.',
            { module: 'Scheduler' }
        )
        return null
    }
    if (!hasAnyJob) return null

    // Inherit auto-prune thresholds for the scheduler's prune job
    options.scheduler.archiveOlderThanDays = options.archiveOlderThanDays
    options.scheduler.pruneOlderThanDays = options.pruneOlderThanDays
    options.scheduler.hardDeleteOlderThanDays = options.hardDeleteOlderThanDays
    options.scheduler.pruneImportanceThreshold = options.pruneImportanceThreshold
    options.scheduler.pruneDryRun = options.pruneDryRun
    options.scheduler.pruneExcludeTags = options.pruneExcludeTags
    const resolvedDefaultWs = resolveWorkspaceId(
        options.defaultWorkspaceId,
        options.defaultProjectNumber,
        options
    )
    options.scheduler.defaultWorkspaceId = resolvedDefaultWs
    options.scheduler.defaultProjectNumber = options.defaultProjectNumber
    options.scheduler.projectRegistry = options.projectRegistry

    return new Scheduler(options.scheduler, db, vectorManager, runtime)
}

/**
 * Seed initial digest snapshot so first briefing read has analytics.
 * Skipped if a snapshot already exists (previous session or scheduler run).
 */
export function seedInitialDigest(db: IDatabaseAdapter, options: ServerOptions): void {
    try {
        const wsId = resolveWorkspaceId(
            options.defaultWorkspaceId,
            options.defaultProjectNumber,
            options
        )
        const existingSnapshot = db.getLatestAnalyticsSnapshot('digest', wsId)
        if (!existingSnapshot) {
            const digest = db.computeDigest(wsId)
            db.saveAnalyticsSnapshot('digest', digest, wsId)
            logger.info('Initial analytics digest seeded', { module: 'McpServer' })
        }
    } catch (error: unknown) {
        logger.debug('Failed to seed initial digest (non-critical)', {
            module: 'McpServer',
            error: error instanceof Error ? error.message : String(error),
        })
    }
}
