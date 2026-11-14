import * as fs from 'node:fs'
import * as path from 'node:path'
import { loadSkills } from '@modelcontextprotocol/server/ext/skills/node'
import type { SkillCatalog } from '@modelcontextprotocol/server/ext/skills'
import { DatabaseAdapterFactory } from '../../database/adapter-factory.js'
import { DatabaseAdapterProxy } from '../../database/core/DatabaseAdapterProxy.js'
import { getGitHubIntegration } from '../../github/github-integration/index.js'
import { logger } from '../../utils/logger.js'
import type { Scheduler } from '../scheduler.js'
import { DEFAULT_BRIEFING_CONFIG } from '../../handlers/resources/shared.js'
import { ServerRuntime } from '../../utils/maintenance-lock.js'
import { ConfigManager } from '../../utils/config-manager.js'
import { AuditLogger, createAuditInterceptor } from '../../audit/index.js'
import { awaitPendingVectorInit } from './core-helpers.js'
import {
    createSchedulerIfConfigured,
    createVectorManagers,
    resolveToolFilterConfig,
    runStartupAutoPrune,
    seedInitialDigest,
} from './initialization-helpers.js'

import type { ServerOptions, ServerContext } from './types.js'
import type { IDatabaseAdapter } from '../../database/core/interfaces.js'

/**
 * Resolves the bundled `skills/` directory relative to the current module,
 * supporting both source (`src/server/mcp-server/`) and compiled (`dist/`) layouts.
 */
export function resolveBundledSkillsDir(): string | undefined {
    let dir = import.meta.dirname
    for (let i = 0; i < 5; i++) {
        const candidate = path.join(dir, 'skills')
        if (fs.existsSync(path.join(candidate, 'memory-journal-mcp', 'SKILL.md'))) {
            return candidate
        }
        const parent = path.dirname(dir)
        if (parent === dir) break
        dir = parent
    }
    return undefined
}

/**
 * Loads the bundled SEP-2640 skill catalog from disk.
 */
export async function loadBundledSkillCatalog(
    skillsDirOverride?: string
): Promise<SkillCatalog | undefined> {
    const skillsDir = skillsDirOverride ?? resolveBundledSkillsDir()
    if (!skillsDir) {
        return undefined
    }
    try {
        return await loadSkills(skillsDir, {
            onWarning: (warning) => {
                logger.warning(`Bundled skill catalog warning (${warning.path}): ${warning.message}`, {
                    module: 'McpServer',
                })
            },
        })
    } catch (error: unknown) {
        logger.warning('Failed to load bundled skill catalog', {
            module: 'McpServer',
            path: skillsDir,
            error: error instanceof Error ? error.message : String(error),
        })
        return undefined
    }
}

async function configureMetricsPersistence(
    runtime: ServerRuntime,
    options: ServerOptions,
    dbPath: string
): Promise<string | undefined> {
    if (!options.persistMetrics) return undefined
    const configuredPath = options.metricsPath ?? dbPath.replace(/\.db$/, '') + '_metrics.json'
    await runtime.metrics.loadFromFile(configuredPath)
    const metricsTimer = setInterval(() => {
        void runtime.metrics.saveToFile(configuredPath)
    }, 5 * 60 * 1000)
    metricsTimer.unref()
    const previousStop = runtime.stopBackgroundTasks
    runtime.stopBackgroundTasks = () => {
        previousStop?.()
        clearInterval(metricsTimer)
    }
    return configuredPath
}

async function initializeTeamDatabase(options: ServerOptions): Promise<{
    primaryTeamDb: IDatabaseAdapter | undefined
    testTeamDb: IDatabaseAdapter | undefined
    teamDb: IDatabaseAdapter | undefined
}> {
    const { teamDbPath, testTeamDbPath } = options
    if (!teamDbPath) {
        return { primaryTeamDb: undefined, testTeamDb: undefined, teamDb: undefined }
    }

    let primaryTeamDb: IDatabaseAdapter | undefined
    let testTeamDb: IDatabaseAdapter | undefined
    try {
        primaryTeamDb = await DatabaseAdapterFactory.create(teamDbPath, options)
        await primaryTeamDb.initialize()
        primaryTeamDb.applyTeamSchema()
        logger.info('Team database initialized', { module: 'McpServer', teamDbPath })

        if (testTeamDbPath) {
            testTeamDb = await DatabaseAdapterFactory.create(testTeamDbPath, options)
            await testTeamDb.initialize()
            testTeamDb.applyTeamSchema()
            logger.info('Test team database initialized', { module: 'McpServer', testTeamDbPath })
        }

        const teamDb = DatabaseAdapterProxy.create(primaryTeamDb, testTeamDb)

        // Bootstrap team admin if configured and RBAC is not yet active (empty table)
        if (
            options.teamAdmin &&
            teamDb.getTeamMemberCount !== undefined &&
            teamDb.addTeamMember !== undefined &&
            !teamDb.isTeamRbacActive?.()
        ) {
            teamDb.addTeamMember(options.teamAdmin, 'admin', 'system', 'Bootstrap Admin')
            logger.info('Bootstrapped initial team admin', {
                module: 'McpServer',
                admin: options.teamAdmin,
            })
        }

        return { primaryTeamDb, testTeamDb, teamDb }
    } catch (error: unknown) {
        try {
            testTeamDb?.close()
        } catch {
            // Ignore cleanup errors during aborted team DB startup
        }
        try {
            primaryTeamDb?.close()
        } catch {
            // Ignore cleanup errors during aborted team DB startup
        }
        throw error
    }
}

const STARTUP_REPO_INFO_TIMEOUT_MS = 8000

async function readStartupRepoInfo(github: ReturnType<typeof getGitHubIntegration>): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
        await Promise.race([
            github.getRepoInfo(),
            new Promise<never>((_resolve, reject) => {
                timer = setTimeout(() => {
                    reject(new Error('Timed out reading repository info during startup'))
                }, STARTUP_REPO_INFO_TIMEOUT_MS)
                timer.unref()
            }),
        ])
    } finally {
        if (timer !== undefined) clearTimeout(timer)
    }
}

async function initializeGitHubIntegration(
    options: ServerOptions,
    runtime: ServerRuntime
): Promise<ReturnType<typeof getGitHubIntegration>> {
    let githubPath = '.'
    if (options.projectRegistry && Object.keys(options.projectRegistry).length > 0) {
        if (options.defaultProjectNumber !== undefined) {
            const matches = Object.values(options.projectRegistry).filter(
                (r) => r.project_number === options.defaultProjectNumber
            )
            const defaultEntry = matches.length === 1 ? matches[0] : undefined
            if (defaultEntry?.path) {
                githubPath = defaultEntry.path
            }
        }
    }
    const github = getGitHubIntegration(githubPath, runtime)

    try {
        // Pre-populate repository cache so synchronous tools (e.g. create_entry) can resolve GitHub URLs.
        // A stuck local git process must not keep the HTTP server from listening.
        await readStartupRepoInfo(github)
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

    return github
}

async function safeCloseStartupResources(resources: {
    scheduler: Scheduler | null
    configManager: ConfigManager | undefined
    runtime: ServerRuntime
    testTeamDb: IDatabaseAdapter | undefined
    primaryTeamDb: IDatabaseAdapter | undefined
    testDb: IDatabaseAdapter | undefined
    primaryDb: IDatabaseAdapter | undefined
}): Promise<void> {
    try {
        resources.scheduler?.stop()
    } catch {
        // Ignore cleanup errors during aborted startup
    }
    try {
        resources.configManager?.close()
    } catch {
        // Ignore cleanup errors during aborted startup
    }
    try {
        resources.runtime.stopBackgroundTasks?.()
    } catch {
        // Ignore cleanup errors during aborted startup
    }
    if (resources.runtime.auditLogger !== null) {
        await resources.runtime.auditLogger.close().catch(() => undefined)
    }
    await awaitPendingVectorInit(resources.runtime)
    for (const adapter of [
        resources.testTeamDb,
        resources.primaryTeamDb,
        resources.testDb,
        resources.primaryDb,
    ]) {
        if (adapter !== undefined) {
            try {
                adapter.close()
            } catch {
                // Ignore close errors during aborted startup
            }
        }
    }
}

export async function initializeDependencies(options: ServerOptions): Promise<ServerContext> {
    const { dbPath, testDbPath } = options
    const runtime = new ServerRuntime()
    let primaryDb: IDatabaseAdapter | undefined
    let testDb: IDatabaseAdapter | undefined
    let primaryTeamDb: IDatabaseAdapter | undefined
    let testTeamDb: IDatabaseAdapter | undefined
    let configManager: ConfigManager | undefined
    let scheduler: Scheduler | null = null

    try {
        // Initialize database
        primaryDb = await DatabaseAdapterFactory.create(dbPath, options)
        await primaryDb.initialize()
        logger.info('Database initialized', { module: 'McpServer', dbPath })

        if (testDbPath) {
            testDb = await DatabaseAdapterFactory.create(testDbPath, options)
            await testDb.initialize()
            logger.info('Test database initialized', { module: 'McpServer', testDbPath })
        }

        const db = DatabaseAdapterProxy.create(primaryDb, testDb)

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
            activeMetricsPath = await configureMetricsPersistence(runtime, options, dbPath)
        }

        const teamResult = await initializeTeamDatabase(options)
        primaryTeamDb = teamResult.primaryTeamDb
        testTeamDb = teamResult.testTeamDb
        const { teamDb } = teamResult

        // Initialize vector search managers (lazy loading) and start background initialization
        const { vectorManager, teamVectorManager, pendingVectorInit } = createVectorManagers({
            options,
            primaryDb,
            testDb,
            primaryTeamDb,
            testTeamDb,
        })
        runtime.pendingVectorInit = pendingVectorInit

        const github = await initializeGitHubIntegration(options, runtime)

        // Parse tool filter
        const filterConfig = resolveToolFilterConfig(options)

        const rawToolFilter = options.toolFilter ?? process.env['MEMORY_JOURNAL_MCP_TOOL_FILTER'] ?? process.env['TOOL_FILTER']

        configManager = new ConfigManager({
            rawToolFilter,
            toolFilterConfig: filterConfig,
            briefingConfig: {
                ...(options.briefingConfig ?? DEFAULT_BRIEFING_CONFIG),
                // --default-workspace-id, --default-project-number, and projectRegistry must reach briefing resources/prompts
                ...(options.defaultWorkspaceId !== undefined &&
                options.briefingConfig?.defaultWorkspaceId === undefined
                    ? { defaultWorkspaceId: options.defaultWorkspaceId }
                    : {}),
                ...(options.defaultProjectNumber !== undefined &&
                options.briefingConfig?.defaultProjectNumber === undefined
                    ? { defaultProjectNumber: options.defaultProjectNumber }
                    : {}),
                ...(options.projectRegistry !== undefined &&
                options.briefingConfig?.projectRegistry === undefined
                    ? { projectRegistry: options.projectRegistry }
                    : {}),
            },
            codemodeInternalFullAccess: options.codemodeInternalFullAccess
        }, options.configFilePath)

        runtime.configManager = configManager

        // [INVARIANT] Auto-prune runs only after `--config` is loaded so it is scoped to the
        // effective default workspace/project (H3).
        const loadedBriefing = configManager.getConfig().briefingConfig
        await runStartupAutoPrune(db, options, {
            ...(loadedBriefing.defaultWorkspaceId !== undefined
                ? { defaultWorkspaceId: loadedBriefing.defaultWorkspaceId }
                : {}),
            ...(loadedBriefing.defaultProjectNumber !== undefined
                ? { defaultProjectNumber: loadedBriefing.defaultProjectNumber }
                : {}),
            ...(loadedBriefing.projectRegistry !== undefined
                ? { projectRegistry: loadedBriefing.projectRegistry }
                : {}),
        })

        const effectiveDefaultWorkspaceId =
            options.defaultWorkspaceId ?? loadedBriefing.defaultWorkspaceId
        const effectiveDefaultProjectNumber =
            options.defaultProjectNumber ?? loadedBriefing.defaultProjectNumber
        const effectiveProjectRegistry = options.projectRegistry ?? loadedBriefing.projectRegistry
        const effectiveOptions: ServerOptions = {
            ...options,
            ...(effectiveDefaultWorkspaceId !== undefined
                ? { defaultWorkspaceId: effectiveDefaultWorkspaceId }
                : {}),
            ...(effectiveDefaultProjectNumber !== undefined
                ? { defaultProjectNumber: effectiveDefaultProjectNumber }
                : {}),
            ...(effectiveProjectRegistry !== undefined
                ? { projectRegistry: effectiveProjectRegistry }
                : {}),
        }

        // Initialize scheduler (HTTP/SSE only) — must be before handleResourceRead
        // which captures scheduler in its closure.
        scheduler = createSchedulerIfConfigured(
            effectiveOptions,
            db,
            vectorManager,
            runtime
        )

        // Seed initial digest snapshot so first briefing read has analytics.
        // Runs for both stdio and HTTP transports.
        seedInitialDigest(db, effectiveOptions)

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

        const skillCatalog = await loadBundledSkillCatalog()

        return {
            db,
            testDb,
            teamDb,
            testTeamDb,
            runtime,
            vectorManager,
            teamVectorManager,
            github,
            configManager,
            scheduler,
            allowedIoRoots: finalAllowedIoRoots,
            activeMetricsPath,
            ...(skillCatalog ? { skillCatalog } : {}),
        }
    } catch (error: unknown) {
        await safeCloseStartupResources({
            scheduler,
            configManager,
            runtime,
            testTeamDb,
            primaryTeamDb,
            testDb,
            primaryDb,
        })
        throw error
    }
}
