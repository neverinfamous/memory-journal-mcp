import * as fs from 'node:fs'
import * as path from 'node:path'
import { loadSkills } from '@modelcontextprotocol/server/ext/skills/node'
import type { SkillCatalog } from '@modelcontextprotocol/server/ext/skills'
import { DatabaseAdapterFactory } from '../../database/adapter-factory.js'
import { DatabaseAdapterProxy } from '../../database/core/DatabaseAdapterProxy.js'
import { getGitHubIntegration } from '../../github/github-integration/index.js'
import { logger } from '../../utils/logger.js'
import { ServerRuntime } from '../../utils/maintenance-lock.js'
import type { ConfigManager } from '../../utils/config-manager.js'
import { AuditLogger, createAuditInterceptor } from '../../audit/index.js'
import { awaitPendingVectorInit } from './core-helpers.js'
import { createVectorManagers } from './initialization-helpers.js'
import { initConfigAndStartupJobs, resolveFinalAllowedIoRoots } from './initialization-config.js'

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
    const isInMemory = dbPath === ':memory:' || dbPath.startsWith('file::memory:')
    if (options.metricsPath === undefined && isInMemory) {
        return undefined
    }
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

function resolveIsolatedBackupsDir(targetDbPath: string, roleSuffix: string): string {
    const ext = path.extname(targetDbPath)
    const rawStem = path.basename(targetDbPath, ext)
    const cleanStem = rawStem.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '')
    const dirName =
        cleanStem !== '' && cleanStem !== 'backups'
            ? `backups-${roleSuffix}-${cleanStem}`
            : `backups-${roleSuffix}`
    return path.join(path.dirname(targetDbPath), dirName)
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
            testTeamDb = await DatabaseAdapterFactory.create(testTeamDbPath, options, {
                backupsDir: resolveIsolatedBackupsDir(testTeamDbPath, 'team-test'),
            })
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
    configManager: ConfigManager | undefined
    runtime: ServerRuntime
    testTeamDb: IDatabaseAdapter | undefined
    primaryTeamDb: IDatabaseAdapter | undefined
    testDb: IDatabaseAdapter | undefined
    primaryDb: IDatabaseAdapter | undefined
}): Promise<void> {
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
    await resources.runtime.disposeVectorManagers?.().catch(() => undefined)
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

async function setupCoreDatabasesAndAudit(options: ServerOptions, runtime: ServerRuntime): Promise<{
    primaryDb: IDatabaseAdapter
    testDb: IDatabaseAdapter | undefined
    db: IDatabaseAdapter
    activeMetricsPath: string | undefined
}> {
    const { dbPath, testDbPath } = options
    let primaryDb: IDatabaseAdapter | undefined
    let testDb: IDatabaseAdapter | undefined
    try {
        primaryDb = await DatabaseAdapterFactory.create(dbPath, options)
        await primaryDb.initialize()
        logger.info('Database initialized', { module: 'McpServer', dbPath })

        if (testDbPath) {
            testDb = await DatabaseAdapterFactory.create(testDbPath, options, {
                backupsDir: resolveIsolatedBackupsDir(testDbPath, 'test'),
            })
            await testDb.initialize()
            logger.info('Test database initialized', { module: 'McpServer', testDbPath })
        }

        const db = DatabaseAdapterProxy.create(primaryDb, testDb)
        if (options.auditConfig?.enabled) {
            runtime.auditLogger = new AuditLogger(options.auditConfig)
            runtime.auditInterceptor = createAuditInterceptor(runtime.auditLogger, runtime)
            logger.info('Audit logging enabled', {
                module: 'McpServer',
                path: options.auditConfig.logPath,
                redact: options.auditConfig.redact,
                auditReads: options.auditConfig.auditReads,
            })
        }

        const activeMetricsPath = options.persistMetrics
            ? await configureMetricsPersistence(runtime, options, dbPath)
            : undefined
        return { primaryDb, testDb, db, activeMetricsPath }
    } catch (error: unknown) {
        if (runtime.auditLogger !== null) {
            await runtime.auditLogger.close().catch(() => undefined)
        }
        for (const adapter of [testDb, primaryDb]) {
            if (adapter !== undefined) {
                try {
                    adapter.close()
                } catch {
                    // Ignore cleanup errors during aborted core DB startup
                }
            }
        }
        throw error
    }
}

export async function initializeDependencies(options: ServerOptions): Promise<ServerContext> {
    const runtime = new ServerRuntime()
    runtime.teamDefaultRole = options.teamDefaultRole ?? 'denied'
    let primaryDb: IDatabaseAdapter | undefined
    let testDb: IDatabaseAdapter | undefined
    let primaryTeamDb: IDatabaseAdapter | undefined
    let testTeamDb: IDatabaseAdapter | undefined
    let configManager: ConfigManager | undefined

    try {
        const coreSetup = await setupCoreDatabasesAndAudit(options, runtime)
        primaryDb = coreSetup.primaryDb
        testDb = coreSetup.testDb
        const { db, activeMetricsPath } = coreSetup

        const teamResult = await initializeTeamDatabase(options)
        primaryTeamDb = teamResult.primaryTeamDb
        testTeamDb = teamResult.testTeamDb
        const { teamDb } = teamResult

        const { vectorManager, teamVectorManager, pendingVectorInit, disposeVectorManagers } =
            createVectorManagers({
                options,
                primaryDb,
                testDb,
                primaryTeamDb,
                testTeamDb,
                maintenanceManager: runtime.maintenanceManager,
            })
        runtime.pendingVectorInit = pendingVectorInit
        runtime.disposeVectorManagers = disposeVectorManagers

        const configAndJobs = await initConfigAndStartupJobs({ options, db, runtime })
        configManager = configAndJobs.configManager

        const github = await initializeGitHubIntegration(configAndJobs.effectiveOptions, runtime)

        const allowedIoRoots = resolveFinalAllowedIoRoots(options)
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
            allowedIoRoots,
            activeMetricsPath,
            ...(skillCatalog ? { skillCatalog } : {}),
        }
    } catch (error: unknown) {
        await safeCloseStartupResources({
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
