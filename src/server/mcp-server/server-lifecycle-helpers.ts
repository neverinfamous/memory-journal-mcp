/**
 * Lifecycle helpers for MCP server config hot-reload and transport startup/shutdown.
 */

import type { McpServer } from '@modelcontextprotocol/server'
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio'
import { HttpTransport } from '../../transports/http/index.js'
import type { ToolHandlerConfig } from '../../types/index.js'
import type { DynamicConfig } from '../../utils/config-manager.js'
import { logger } from '../../utils/logger.js'
import type { ServerRuntime } from '../../utils/maintenance-lock.js'
import { globalSubscriptionManager } from '../subscription-manager.js'
import type { Scheduler } from '../scheduler.js'
import type { ServerOptions } from './types.js'
import {
    awaitPendingVectorInit,
    buildHttpTransportConfig,
    logShutdownError,
    runShutdownStep,
} from './core-helpers.js'
import { resolveActiveBriefingConfig } from './tool-registration/register-tools-helpers.js'

export interface GracefulShutdownParams {
    label: string
    configManager: { close: () => void }
    runtime: ServerRuntime
    shutdownMetrics?: (() => Promise<void>) | undefined
    stopHttpTransport?: (() => Promise<void>) | undefined
    activeMetricsPath?: string | undefined
    closeDatabases: () => void
    detachSignals?: (() => void) | undefined
}

export async function executeGracefulShutdown(params: GracefulShutdownParams): Promise<never> {
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
            if (runtime.auditLogger) await runtime.auditLogger.close()
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
        await awaitPendingVectorInit(runtime)
        closeDatabases()
        // [INTENT] Preserve any non-zero exit code set earlier instead of forcing 0 (L6).
        const code = typeof process.exitCode === 'number' ? process.exitCode : 0
        process.exit(code)
    }
}

export function registerConfigChangeListener(params: {
    configManager: { on: (event: 'changed', listener: (cfg: DynamicConfig) => void) => unknown }
    options: ServerOptions
    allowedIoRoots: string[]
    baseConfig: ToolHandlerConfig
    customToolHandlerConfig: ToolHandlerConfig
    scheduler: Scheduler | null
}): void {
    const { configManager, options, allowedIoRoots, baseConfig, customToolHandlerConfig, scheduler } = params
    configManager.on('changed', (newConfig: DynamicConfig) => {
        const nextBriefing = resolveActiveBriefingConfig(newConfig.briefingConfig, options, allowedIoRoots)
        baseConfig.filterConfig = newConfig.toolFilterConfig
        baseConfig.briefingConfig = nextBriefing
        customToolHandlerConfig.filterConfig = newConfig.toolFilterConfig
        customToolHandlerConfig.briefingConfig = nextBriefing
        // [INVARIANT] Mirror the reloaded config exactly, clearing removed fields (C1/H3).
        for (const target of [baseConfig, customToolHandlerConfig]) {
            if (nextBriefing.defaultProjectNumber !== undefined) target.defaultProjectNumber = nextBriefing.defaultProjectNumber
            else delete target.defaultProjectNumber
            if (nextBriefing.defaultWorkspaceId !== undefined) target.defaultWorkspaceId = nextBriefing.defaultWorkspaceId
            else delete target.defaultWorkspaceId
            if (nextBriefing.projectRegistry !== undefined) target.projectRegistry = nextBriefing.projectRegistry
            else delete target.projectRegistry
            if (newConfig.codemodeInternalFullAccess !== undefined) target.codemodeInternalFullAccess = newConfig.codemodeInternalFullAccess
            else if (options.codemodeInternalFullAccess !== undefined) target.codemodeInternalFullAccess = options.codemodeInternalFullAccess
            else delete target.codemodeInternalFullAccess
        }
        scheduler?.updateWorkspaceContext({
            ...(nextBriefing.defaultWorkspaceId !== undefined ? { defaultWorkspaceId: nextBriefing.defaultWorkspaceId } : {}),
            ...(nextBriefing.defaultProjectNumber !== undefined ? { defaultProjectNumber: nextBriefing.defaultProjectNumber } : {}),
            ...(nextBriefing.projectRegistry !== undefined ? { projectRegistry: nextBriefing.projectRegistry } : {}),
        })
        void Promise.resolve(globalSubscriptionManager.notifyResourceUpdated('memory://briefing')).catch((error: unknown) => {
            logger.debug('Failed to send briefing updated notification to MCP client', {
                module: 'McpServer',
                error: error instanceof Error ? error.message : String(error),
            })
        })
        for (const method of ['notifications/tools/list_changed', 'notifications/resources/list_changed']) {
            void Promise.resolve(globalSubscriptionManager.broadcastNotification(method)).catch((error: unknown) => {
                logger.debug('Failed to send list_changed notifications to MCP client', {
                    module: 'McpServer',
                    error: error instanceof Error ? error.message : String(error),
                })
            })
        }
    })
}

export async function startSelectedTransport(params: {
    options: ServerOptions
    getServerInstance: () => McpServer
    scheduler: Scheduler | null
    runtime: GracefulShutdownParams['runtime']
    configManager: GracefulShutdownParams['configManager']
    shutdownMetrics: (() => Promise<void>) | undefined
    activeMetricsPath: string | undefined
    closeDatabases: () => void
}): Promise<void> {
    const { options, getServerInstance, scheduler, runtime, configManager, shutdownMetrics, activeMetricsPath, closeDatabases } = params
    if (options.transport === 'stdio') {
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
        return
    }

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
