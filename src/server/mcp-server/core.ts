import { type McpServer } from '@modelcontextprotocol/server'
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio'
import { logger } from '../../utils/logger.js'
import { getTools, callTool } from '../../handlers/tools/index.js'
import { getRequiredScope } from '../../auth/scope-map.js'
import { getResources } from '../../handlers/resources/index.js'
import { getPrompts } from '../../handlers/prompts/index.js'
import { HttpTransport } from '../../transports/http/index.js'
import type { ToolHandlerConfig } from '../../types/index.js'
import type { PromptDefinition, ResourceDefinition } from '../registration.js'
import { globalSubscriptionManager } from '../subscription-manager.js'

import type { ServerOptions } from './types.js'
import { initializeDependencies } from './initialization.js'
import { createServerInstance } from './tool-registration.js'
import { startMetricsServer } from '../../observability/metrics-server.js'
import type { DynamicConfig } from '../../utils/config-manager.js'
import {
    buildBaseToolConfig,
    buildHttpTransportConfig,
    closeServerResources,
    logShutdownError,
    runShutdownStep,
} from './core-helpers.js'
import { resolveActiveBriefingConfig } from './tool-registration/register-tools-helpers.js'

async function executeGracefulShutdown(params: {
    label: string
    configManager: { close: () => void }
    runtime: {
        stopBackgroundTasks?: (() => void) | null
        auditLogger?: { close: () => Promise<void> } | null
        metrics: { saveToFile: (path: string) => Promise<void> }
    }
    shutdownMetrics?: () => Promise<void>
    stopHttpTransport?: () => Promise<void>
    activeMetricsPath?: string
    closeDatabases: () => void
    detachSignals?: () => void
}): Promise<never> {
    const {
        label,
        configManager,
        runtime,
        shutdownMetrics,
        stopHttpTransport,
        activeMetricsPath,
        closeDatabases,
    } = params
    try {
        logger.info('Shutting down...', { module: 'McpServer' })
        runtime.stopBackgroundTasks?.()
        configManager.close()
        if (shutdownMetrics) {
            await shutdownMetrics().catch((err: unknown) => {
                logger.debug('Error shutting down metrics server', {
                    module: 'McpServer',
                    error: String(err),
                })
            })
        }
        if (stopHttpTransport) {
            await runShutdownStep('http transport stop', stopHttpTransport)
        }
        await runShutdownStep('audit log close', async () => {
            if (runtime.auditLogger) {
                await runtime.auditLogger.close()
            }
        })
        if (activeMetricsPath) {
            await runShutdownStep('metrics save', () =>
                runtime.metrics.saveToFile(activeMetricsPath)
            )
        }
    } catch (error: unknown) {
        logShutdownError(label, error)
    } finally {
        params.detachSignals?.()
        closeDatabases()
        // [INTENT] Preserve any non-zero exit code set earlier instead of forcing 0 (L6).
        const code = typeof process.exitCode === 'number' ? process.exitCode : 0
        process.exit(code)
    }
}

export async function createServer(options: ServerOptions): Promise<void> {
    const context = await initializeDependencies(options)
    const {
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
        allowedIoRoots,
        activeMetricsPath,
    } = context
    const { transport } = options

    const initialDynamicConfig = configManager.getConfig()
    const filterConfig = initialDynamicConfig.toolFilterConfig

    const baseConfig: ToolHandlerConfig = buildBaseToolConfig(
        options,
        runtime,
        allowedIoRoots,
        filterConfig
    )
    baseConfig.briefingConfig = resolveActiveBriefingConfig(
        initialDynamicConfig.briefingConfig,
        options,
        allowedIoRoots
    )
    if (
        baseConfig.defaultProjectNumber === undefined &&
        baseConfig.briefingConfig.defaultProjectNumber !== undefined
    ) {
        baseConfig.defaultProjectNumber = baseConfig.briefingConfig.defaultProjectNumber
    }
    if (
        baseConfig.defaultWorkspaceId === undefined &&
        baseConfig.briefingConfig.defaultWorkspaceId !== undefined
    ) {
        baseConfig.defaultWorkspaceId = baseConfig.briefingConfig.defaultWorkspaceId
    }
    if (
        baseConfig.projectRegistry === undefined &&
        baseConfig.briefingConfig.projectRegistry !== undefined
    ) {
        baseConfig.projectRegistry = baseConfig.briefingConfig.projectRegistry
    }

    const customToolHandlerConfig: ToolHandlerConfig = { ...baseConfig }
    const dispatch = (name: string, args: Record<string, unknown>): Promise<unknown> =>
        callTool(
            name,
            args,
            db,
            vectorManager,
            github,
            customToolHandlerConfig,
            undefined,
            teamDb ?? undefined,
            teamVectorManager ?? undefined
        )
    customToolHandlerConfig.dispatch = dispatch

    const allTools = getTools(
        db,
        filterConfig,
        vectorManager,
        github,
        customToolHandlerConfig,
        teamDb ?? undefined,
        teamVectorManager ?? undefined
    )
    const allToolNames = new Set(allTools.map((t) => t.name))

    for (const toolName of allToolNames) {
        getRequiredScope(toolName)
    }

    const resources = getResources()
    const prompts = getPrompts()

    // Subscribe to config changes to send notifications
    configManager.on('changed', (newConfig: DynamicConfig) => {
        const nextBriefing = resolveActiveBriefingConfig(
            newConfig.briefingConfig,
            options,
            allowedIoRoots
        )
        baseConfig.filterConfig = newConfig.toolFilterConfig
        baseConfig.briefingConfig = nextBriefing
        customToolHandlerConfig.filterConfig = newConfig.toolFilterConfig
        customToolHandlerConfig.briefingConfig = nextBriefing
        // [INVARIANT] Mirror the reloaded config exactly, clearing removed fields (C1/H3).
        for (const target of [baseConfig, customToolHandlerConfig]) {
            if (nextBriefing.defaultProjectNumber !== undefined) {
                target.defaultProjectNumber = nextBriefing.defaultProjectNumber
            } else {
                delete target.defaultProjectNumber
            }
            if (nextBriefing.defaultWorkspaceId !== undefined) {
                target.defaultWorkspaceId = nextBriefing.defaultWorkspaceId
            } else {
                delete target.defaultWorkspaceId
            }
            if (nextBriefing.projectRegistry !== undefined) {
                target.projectRegistry = nextBriefing.projectRegistry
            } else {
                delete target.projectRegistry
            }
            if (newConfig.codemodeInternalFullAccess !== undefined) {
                target.codemodeInternalFullAccess = newConfig.codemodeInternalFullAccess
            } else if (options.codemodeInternalFullAccess !== undefined) {
                target.codemodeInternalFullAccess = options.codemodeInternalFullAccess
            } else {
                delete target.codemodeInternalFullAccess
            }
        }
        scheduler?.updateWorkspaceContext({
            ...(nextBriefing.defaultWorkspaceId !== undefined
                ? { defaultWorkspaceId: nextBriefing.defaultWorkspaceId }
                : {}),
            ...(nextBriefing.defaultProjectNumber !== undefined
                ? { defaultProjectNumber: nextBriefing.defaultProjectNumber }
                : {}),
            ...(nextBriefing.projectRegistry !== undefined
                ? { projectRegistry: nextBriefing.projectRegistry }
                : {}),
        })
        void globalSubscriptionManager.notifyResourceUpdated('memory://briefing')
        try {
            void globalSubscriptionManager.broadcastNotification('notifications/tools/list_changed')
            void globalSubscriptionManager.broadcastNotification('notifications/resources/list_changed')
        } catch (error: unknown) {
            logger.debug('Failed to send list_changed notifications to MCP client', {
                module: 'McpServer',
                error: error instanceof Error ? error.message : String(error),
            })
        }
    })

    const getServerInstance = (): McpServer =>
        createServerInstance(
            context,
            options,
            prompts as PromptDefinition[],
            resources as ResourceDefinition[],
            allTools,
            allToolNames,
            customToolHandlerConfig
        )

    let shutdownMetrics: (() => Promise<void>) | undefined

    const closeDatabases = (): void => {
        closeServerResources([db, testDb, teamDb, testTeamDb])
    }
    if (options.metricsExport === 'prometheus') {
        shutdownMetrics = startMetricsServer(runtime, options.metricsPort)
    }

    if (transport === 'stdio') {
        const stdioTransport = new StdioServerTransport()
        const server = getServerInstance()
        await server.connect(stdioTransport)
        logger.info('MCP server started on stdio', { module: 'McpServer' })

        let stdioShutdownStarted = false
        const handleStdioShutdown = (): void => {
            if (stdioShutdownStarted) return
            stdioShutdownStarted = true
            executeGracefulShutdown({
                label: 'stdio shutdown',
                configManager,
                runtime,
                shutdownMetrics,
                activeMetricsPath,
                closeDatabases,
                detachSignals: () => {
                    process.off('SIGINT', handleStdioShutdown)
                    process.off('SIGTERM', handleStdioShutdown)
                },
            }).catch((error: unknown) => {
                logShutdownError('stdio shutdown', error)
                process.exit(1)
            })
        }

        process.on('SIGINT', handleStdioShutdown)
        process.on('SIGTERM', handleStdioShutdown)
    } else {
        const httpTransport = new HttpTransport(buildHttpTransportConfig(options))

        await httpTransport.start(getServerInstance, scheduler, runtime)

        let httpShutdownStarted = false
        const handleHttpShutdown = (): void => {
            if (httpShutdownStarted) return
            httpShutdownStarted = true
            executeGracefulShutdown({
                label: 'HTTP shutdown',
                configManager,
                runtime,
                shutdownMetrics,
                stopHttpTransport: () => httpTransport.stop(scheduler),
                activeMetricsPath,
                closeDatabases,
                detachSignals: () => {
                    process.off('SIGINT', handleHttpShutdown)
                    process.off('SIGTERM', handleHttpShutdown)
                },
            }).catch((error: unknown) => {
                logShutdownError('HTTP shutdown', error)
                process.exit(1)
            })
        }

        process.on('SIGINT', handleHttpShutdown)
        process.on('SIGTERM', handleHttpShutdown)
    }
}
