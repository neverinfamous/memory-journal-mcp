import { DatabaseAdapterFactory } from '../../database/adapter-factory.js'
import { VectorSearchManager } from '../../vector/vector-search-manager/index.js'
import { getGitHubIntegration } from '../../github/github-integration/index.js'
import { logger } from '../../utils/logger.js'
import { parseToolFilter, getToolFilterFromEnv, getFilterSummary } from '../../filtering/tool-filter.js'
import { Scheduler } from '../scheduler.js'
import { DEFAULT_BRIEFING_CONFIG } from '../../handlers/resources/shared.js'
import { ServerRuntime } from '../../utils/maintenance-lock.js'
import { ConfigManager } from '../../utils/config-manager.js'
import { AuditLogger, createAuditInterceptor } from '../../audit/index.js'
import { runAutoPrune } from '../auto-prune.js'

import type { ServerOptions, ServerContext } from './types.js'
import type { IDatabaseAdapter } from '../../database/core/interfaces.js'
import type { ToolFilterConfig } from '../../filtering/tool-filter.js'
export async function initializeDependencies(options: ServerOptions): Promise<ServerContext> {
    const { transport, dbPath, teamDbPath } = options

    // Initialize database
    const db = await DatabaseAdapterFactory.create(dbPath)
    await db.initialize()
    logger.info('Database initialized', { module: 'McpServer', dbPath })

    // Auto-prune low-importance old entries if configured
    const hasAutoPrune = ((options.archiveOlderThanDays ?? 0) > 0) ||
                         ((options.pruneOlderThanDays ?? 0) > 0) ||
                         ((options.hardDeleteOlderThanDays ?? 0) > 0)

    if (hasAutoPrune) {
        const pruneResult = await runAutoPrune(db, {
            archiveOlderThanDays: options.archiveOlderThanDays ?? 0,
            pruneOlderThanDays: options.pruneOlderThanDays ?? 0,
            hardDeleteOlderThanDays: options.hardDeleteOlderThanDays ?? 0,
            importanceThreshold: options.pruneImportanceThreshold ?? 0.15,
            dryRun: options.pruneDryRun,
            excludeTags: options.pruneExcludeTags,
        })
        logger.info('Auto-prune completed', {
            module: 'McpServer',
            archivedCount: pruneResult.archivedCount,
            prunedCount: pruneResult.prunedCount,
            hardDeletedCount: pruneResult.hardDeletedCount,
            backupFile: pruneResult.backupFile,
        })
    }

    // Initialize ServerRuntime (handles instance-scoped globals)
    const runtime = new ServerRuntime()

    // Initialize audit logging if configured
    if (options.auditConfig?.enabled) {
        runtime.auditLogger = new AuditLogger(options.auditConfig)
        runtime.auditInterceptor = createAuditInterceptor(runtime.auditLogger)
        logger.info('Audit logging enabled', {
            module: 'McpServer',
            path: options.auditConfig.logPath,
            redact: options.auditConfig.redact,
            auditReads: options.auditConfig.auditReads,
        })
    }

    // Configure metrics persistence path
    let activeMetricsPath: string | undefined
    if (options.persistMetrics) {
        const configuredPath = options.metricsPath ?? (dbPath.replace(/\.db$/, '') + '_metrics.json')
        activeMetricsPath = configuredPath
        
        await runtime.metrics.loadFromFile(configuredPath)
        
        // Periodic save every 5 minutes
        setInterval(() => {
            void runtime.metrics.saveToFile(configuredPath)
        }, 5 * 60 * 1000).unref()
    }

    // Initialize team database if configured
    let teamDb: IDatabaseAdapter | undefined
    if (teamDbPath) {
        teamDb = await DatabaseAdapterFactory.create(teamDbPath)
        await teamDb.initialize()
        teamDb.applyTeamSchema()
        logger.info('Team database initialized', { module: 'McpServer', teamDbPath })

        // Bootstrap team admin if configured and RBAC is not yet active (empty table)
        if (options.teamAdmin && teamDb.getTeamMemberCount !== undefined && teamDb.addTeamMember !== undefined) {
            if (!teamDb.isTeamRbacActive?.()) {
                teamDb.addTeamMember(options.teamAdmin, 'admin', 'system', 'Bootstrap Admin')
                logger.info('Bootstrapped initial team admin', { module: 'McpServer', admin: options.teamAdmin })
            }
        }
    }

    // Initialize vector search manager (lazy loading - model loads on first use)
    const vectorManager = new VectorSearchManager(db, options.embeddingModel)

    // Initialize team vector search manager if team DB is configured
    let teamVectorManager: VectorSearchManager | undefined
    if (teamDb) {
        teamVectorManager = new VectorSearchManager(teamDb, options.embeddingModel)
        logger.info('Team vector search manager created', { module: 'McpServer' })
    }

    // Auto-rebuild vector index if enabled (non-blocking)
    if (options.autoRebuildIndex) {
        logger.info('Auto-rebuilding vector index in background...', { module: 'McpServer' })
        vectorManager
            .initialize()
            .then(async () => {
                const { indexed: count } = await vectorManager.rebuildIndex(db)
                logger.info('Vector index rebuilt in background', {
                    module: 'McpServer',
                    entriesIndexed: count,
                })
            })
            .catch((err: unknown) => {
                logger.error('Background vector init/rebuild failed', {
                    module: 'McpServer',
                    error: err,
                })
            })

        if (teamVectorManager) {
            teamVectorManager.initialize().catch((err: unknown) => {
                logger.error('Background team vector init failed', {
                    module: 'McpServer',
                    error: err,
                })
            })
            logger.info('Team vector search manager eager initialization started in background', {
                module: 'McpServer',
            })
        }
    } else {
        // Otherwise, eager-load the model in the background so the first request isn't blocked
        logger.info('Vector search manager eager initialization started in background', {
            module: 'McpServer',
        })
        vectorManager
            .initialize()
            .then(async () => {
                // Initialize team vector sequentially to avoid concurrent ONNX model loading crashes
                if (teamVectorManager) {
                    logger.info(
                        'Team vector search manager eager initialization started in background',
                        { module: 'McpServer' }
                    )
                    await teamVectorManager.initialize()
                }
            })
            .catch((err: unknown) => {
                logger.error('Background vector init failed', { module: 'McpServer', error: err })
            })
    }

    // Initialize GitHub integration
    let githubPath = '.'
    if (options.projectRegistry && Object.keys(options.projectRegistry).length > 0) {
        if (options.defaultProjectNumber !== undefined) {
            const defaultEntry = Object.values(options.projectRegistry).find(
                (r) => r.project_number === options.defaultProjectNumber
            )
            if (defaultEntry?.path) {
                githubPath = defaultEntry.path
            }
        }

        // Removed implicit fallback to the first registry entry.
        // Mutating operations without an explicit owner/repo will throw or request clarification
        // rather than guessing the wrong project boundary.
    }
    const github = getGitHubIntegration(githubPath, runtime)
    try {
        // Pre-populate repository cache so synchronous tools (e.g. create_entry) can resolve GitHub URLs
        await github.getRepoInfo()
    } catch (error: unknown) {
        logger.warning('Failed to pre-populate GitHub repository cache', {
            module: 'McpServer',
            path: githubPath,
            error: error instanceof Error ? error.message : 'Unknown error',
        })
    }

    logger.info('GitHub integration initialized', {
        module: 'McpServer',
        hasToken: github.isApiAvailable(),
    })

    // Parse tool filter
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

    const rawToolFilter = options.toolFilter ?? process.env['MEMORY_JOURNAL_MCP_TOOL_FILTER'] ?? process.env['TOOL_FILTER']

    const configManager = new ConfigManager({
        instructionLevel: options.instructionLevel ?? 'standard',
        rawToolFilter,
        toolFilterConfig: filterConfig,
        briefingConfig: options.briefingConfig ?? DEFAULT_BRIEFING_CONFIG
    }, options.configFilePath)

    runtime.configManager = configManager

    // Initialize scheduler (HTTP/SSE only) — must be before handleResourceRead
    // which captures scheduler in its closure.
    let scheduler: Scheduler | null = null
    if (options.scheduler) {
        const hasAnyJob =
            options.scheduler.backupIntervalMinutes > 0 ||
            options.scheduler.vacuumIntervalMinutes > 0 ||
            options.scheduler.rebuildIndexIntervalMinutes > 0 ||
            options.scheduler.digestIntervalMinutes > 0 ||
            options.scheduler.reportIntervalMinutes > 0

        if (hasAnyJob && transport === 'stdio') {
            logger.warning(
                'Scheduler options ignored for stdio transport (session is ephemeral). ' +
                    'Use HTTP/SSE transport for automated scheduling.',
                { module: 'Scheduler' }
            )
        } else if (hasAnyJob) {
            scheduler = new Scheduler(options.scheduler, db, vectorManager, runtime)
        }
    }

    // Seed initial digest snapshot so first briefing read has analytics.
    // Runs for both stdio and HTTP transports. Skip if a snapshot already exists
    // (e.g., from a previous server session or prior scheduler run).
    try {
        const existingSnapshot = db.getLatestAnalyticsSnapshot('digest')
        if (!existingSnapshot) {
            const digest = db.computeDigest()
            db.saveAnalyticsSnapshot('digest', digest)
            logger.info('Initial analytics digest seeded', { module: 'McpServer' })
        }
    } catch (error: unknown) {
        logger.debug('Failed to seed initial digest (non-critical)', {
            module: 'McpServer',
            error: error instanceof Error ? error.message : String(error),
        })
    }

    let finalAllowedIoRoots = options.allowedIoRoots
    if (!finalAllowedIoRoots) {
        if (options.transport === 'http') {
            const errorMsg = `FATAL: Refusing to bind HTTP transport without explicit ALLOWED_IO_ROOTS. You MUST specify --allowed-io-roots (or ALLOWED_IO_ROOTS env var) to prevent ambient filesystem authority.`
            logger.error(errorMsg, { module: 'HTTP' })
            throw new Error(errorMsg)
        }
        finalAllowedIoRoots = [] // Empty array means NO filesystem access
        logger.warning(
            '⚠️ SECURITY WARNING: ALLOWED_IO_ROOTS not explicitly provided. Defaulting to empty array (NO filesystem access). You MUST specify --allowed-io-roots (or ALLOWED_IO_ROOTS env var) to enable filesystem tools.',
            {
                module: 'McpServer',
            }
        )
    }

    logger.info('IO sandbox configured', {
        module: 'McpServer',
        allowedRoots: finalAllowedIoRoots,
    })

    return {
        db,
        teamDb,
        runtime,
        vectorManager,
        teamVectorManager,
        github,
        configManager,
        scheduler,
        allowedIoRoots: finalAllowedIoRoots,
        activeMetricsPath
    }
}