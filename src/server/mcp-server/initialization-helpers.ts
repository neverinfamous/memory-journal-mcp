import { VectorSearchManager } from '../../vector/vector-search-manager/index.js'
import { VectorSearchManagerProxy } from '../../vector/vector-search-manager/VectorSearchManagerProxy.js'
import { logger } from '../../utils/logger.js'
import {
    parseToolFilter,
    getToolFilterFromEnv,
    getFilterSummary,
    getAllToolNames,
} from '../../filtering/tool-filter.js'
import { runAutoPrune } from '../auto-prune.js'
import { resolveAutoPruneScope, resolveWorkspaceId } from '../../utils/workspace-resolver.js'
export { resolveAutoPruneScope }
import type { IDatabaseAdapter } from '../../database/core/interfaces.js'
import type { ToolFilterConfig } from '../../filtering/tool-filter.js'
import { MemoryJournalMcpError } from '../../types/errors.js'
import type { MaintenanceManager } from '../../utils/maintenance-lock.js'
import type { ServerOptions } from './types.js'

/**
 * Helpers extracted from `initializeDependencies` (startup auto-prune, vector managers,
 * tool filter resolution, digest seeding). Behaviour is unchanged.
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
    pendingVectorInit: Promise<void>
    disposeVectorManagers: () => Promise<void>
}

type VectorSearchManagerProxyResult = ReturnType<typeof VectorSearchManagerProxy.create>

interface VectorManagerInputs {
    options: ServerOptions
    primaryDb: IDatabaseAdapter
    testDb: IDatabaseAdapter | undefined
    primaryTeamDb: IDatabaseAdapter | undefined
    testTeamDb: IDatabaseAdapter | undefined
    maintenanceManager?: MaintenanceManager | undefined
}

async function runVectorMaintenanceJob(
    maintenanceManager: MaintenanceManager | undefined,
    phase: string,
    fn: () => Promise<void>
): Promise<boolean> {
    try {
        if (maintenanceManager !== undefined) {
            await maintenanceManager.withActiveJob(fn)
        } else {
            await fn()
        }
        return true
    } catch (err: unknown) {
        if (err instanceof MemoryJournalMcpError && err.code === 'MAINTENANCE_MODE') {
            logger.info('Deferred background vector init during maintenance', {
                module: 'McpServer',
                phase,
            })
            return false
        }
        throw err
    }
}

function isManagerDisposed(manager: VectorSearchManager): boolean {
    return typeof manager.isDisposed === 'function' && manager.isDisposed()
}

async function initSecondaryManagerStep(
    manager: VectorSearchManager | undefined,
    phase: string,
    logLabel: string,
    maintenanceManager: MaintenanceManager | undefined,
    isCancelled: () => boolean
): Promise<boolean> {
    if (manager === undefined) return true
    if (isCancelled() || isManagerDisposed(manager)) return false
    try {
        return await runVectorMaintenanceJob(maintenanceManager, phase, () => {
            if (isCancelled() || isManagerDisposed(manager)) return Promise.resolve()
            return manager.initialize()
        })
    } catch (err: unknown) {
        logger.error(logLabel, { module: 'McpServer', error: err })
        return !isCancelled() && !isManagerDisposed(manager)
    }
}

async function initSecondaryRebuildManagers(
    testVectorManager: VectorSearchManager | undefined,
    primaryTeamVectorManager: VectorSearchManager | undefined,
    testTeamVectorManager: VectorSearchManager | undefined,
    maintenanceManager: MaintenanceManager | undefined,
    isCancelled: () => boolean
): Promise<void> {
    if (isCancelled()) return
    const testOk = await initSecondaryManagerStep(
        testVectorManager,
        'test-init',
        'Background test vector init failed',
        maintenanceManager,
        isCancelled
    )
    if (!testOk || isCancelled() || primaryTeamVectorManager === undefined) return
    logger.info('Team vector search manager eager initialization started in background', {
        module: 'McpServer',
    })
    const teamOk = await initSecondaryManagerStep(
        primaryTeamVectorManager,
        'team-init',
        'Background team vector init failed',
        maintenanceManager,
        isCancelled
    )
    if (!teamOk || isCancelled()) return
    await initSecondaryManagerStep(
        testTeamVectorManager,
        'test-team-init',
        'Background test team vector init failed',
        maintenanceManager,
        isCancelled
    )
}

function scheduleAutoRebuildVectorInits(
    primaryVectorManager: VectorSearchManager,
    testVectorManager: VectorSearchManager | undefined,
    primaryTeamVectorManager: VectorSearchManager | undefined,
    testTeamVectorManager: VectorSearchManager | undefined,
    maintenanceManager: MaintenanceManager | undefined,
    isCancelled: () => boolean
): Promise<void>[] {
    logger.info('Auto-rebuilding vector index in background...', { module: 'McpServer' })
    const chain = (async (): Promise<void> => {
        try {
            if (isCancelled() || isManagerDisposed(primaryVectorManager)) return
            const initOk = await runVectorMaintenanceJob(maintenanceManager, 'primary-init', () => {
                if (isCancelled() || isManagerDisposed(primaryVectorManager)) return Promise.resolve()
                return primaryVectorManager.initialize()
            })
            if (!initOk || isCancelled() || isManagerDisposed(primaryVectorManager)) return
            const rebuildOk = await runVectorMaintenanceJob(
                maintenanceManager,
                'primary-rebuild',
                async () => {
                    if (isCancelled() || isManagerDisposed(primaryVectorManager)) return
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
                }
            )
            if (!rebuildOk || isCancelled()) return
        } catch (err: unknown) {
            logger.error('Background vector init/rebuild failed', { module: 'McpServer', error: err })
            if (isCancelled()) return
        }
        await initSecondaryRebuildManagers(
            testVectorManager,
            primaryTeamVectorManager,
            testTeamVectorManager,
            maintenanceManager,
            isCancelled
        )
    })()

    return [chain]
}

function scheduleEagerVectorInits(
    primaryVectorManager: VectorSearchManager,
    testVectorManager: VectorSearchManager | undefined,
    primaryTeamVectorManager: VectorSearchManager | undefined,
    testTeamVectorManager: VectorSearchManager | undefined,
    maintenanceManager: MaintenanceManager | undefined,
    isCancelled: () => boolean
): Promise<void>[] {
    // Eager-load the model in the background so the first request isn't blocked
    logger.info('Vector search manager eager initialization started in background', {
        module: 'McpServer',
    })
    const chain = (async (): Promise<void> => {
        try {
            if (isCancelled() || isManagerDisposed(primaryVectorManager)) return
            const p1 = await runVectorMaintenanceJob(maintenanceManager, 'primary-eager-init', () => {
                if (isCancelled() || isManagerDisposed(primaryVectorManager)) return Promise.resolve()
                return primaryVectorManager.initialize()
            })
            if (!p1 || isCancelled()) return
            if (testVectorManager !== undefined) {
                const p2 = await runVectorMaintenanceJob(
                    maintenanceManager,
                    'test-eager-init',
                    () => {
                        if (isCancelled() || isManagerDisposed(testVectorManager)) return Promise.resolve()
                        return testVectorManager.initialize()
                    }
                )
                if (!p2 || isCancelled()) return
            }
            // Initialize team vector sequentially to avoid concurrent ONNX model loading crashes
            if (primaryTeamVectorManager !== undefined) {
                logger.info(
                    'Team vector search manager eager initialization started in background',
                    { module: 'McpServer' }
                )
                const t1 = await runVectorMaintenanceJob(
                    maintenanceManager,
                    'team-eager-init',
                    () => {
                        if (isCancelled() || isManagerDisposed(primaryTeamVectorManager)) {
                            return Promise.resolve()
                        }
                        return primaryTeamVectorManager.initialize()
                    }
                )
                if (!t1 || isCancelled() || testTeamVectorManager === undefined) return
                await runVectorMaintenanceJob(maintenanceManager, 'test-team-eager-init', () => {
                    if (isCancelled() || isManagerDisposed(testTeamVectorManager)) return Promise.resolve()
                    return testTeamVectorManager.initialize()
                })
            }
        } catch (err: unknown) {
            logger.error('Background vector init failed', { module: 'McpServer', error: err })
        }
    })()
    return [chain]
}

/**
 * Create the (lazy) vector search managers and kick off background initialization
 * (and optional index rebuild) without blocking startup.
 */
export function createVectorManagers(inputs: VectorManagerInputs): VectorManagers {
    const { options, primaryDb, testDb, primaryTeamDb, testTeamDb, maintenanceManager } = inputs

    // Initialize vector search manager (lazy loading - model loads on first use)
    const primaryVectorManager = new VectorSearchManager(primaryDb, { modelName: options.embeddingModel })
    const testVectorManager = testDb
        ? new VectorSearchManager(testDb, { modelName: options.embeddingModel })
        : undefined
    const vectorManager = VectorSearchManagerProxy.create(primaryVectorManager, testVectorManager)

    // Initialize team vector search manager if team DB is configured
    let primaryTeamVectorManager: VectorSearchManager | undefined
    let testTeamVectorManager: VectorSearchManager | undefined
    let teamVectorManager: VectorSearchManagerProxyResult | undefined
    if (primaryTeamDb) {
        primaryTeamVectorManager = new VectorSearchManager(primaryTeamDb, {
            modelName: options.embeddingModel,
        })
        if (testTeamDb) {
            testTeamVectorManager = new VectorSearchManager(testTeamDb, {
                modelName: options.embeddingModel,
            })
        }
        teamVectorManager = VectorSearchManagerProxy.create(
            primaryTeamVectorManager,
            testTeamVectorManager
        )
        logger.info('Team vector search manager created', { module: 'McpServer' })
    }

    let cancelled = false
    const isCancelled = (): boolean => cancelled
    const pendingInits = options.autoRebuildIndex
        ? scheduleAutoRebuildVectorInits(
              primaryVectorManager,
              testVectorManager,
              primaryTeamVectorManager,
              testTeamVectorManager,
              maintenanceManager,
              isCancelled
          )
        : scheduleEagerVectorInits(
              primaryVectorManager,
              testVectorManager,
              primaryTeamVectorManager,
              testTeamVectorManager,
              maintenanceManager,
              isCancelled
          )

    const allManagers = [
        primaryVectorManager,
        testVectorManager,
        primaryTeamVectorManager,
        testTeamVectorManager,
    ].filter((m): m is VectorSearchManager => m !== undefined)
    const disposeVectorManagers = async (): Promise<void> => {
        cancelled = true
        await Promise.allSettled(allManagers.map((m) => m.dispose()))
    }
    const pendingVectorInit = Promise.allSettled(pendingInits).then(() => undefined)
    return { vectorManager, teamVectorManager, pendingVectorInit, disposeVectorManagers }
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
 * Seed initial digest snapshot so first briefing read has analytics.
 * Skipped if a snapshot already exists (from a previous session).
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
