import { type McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
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

export async function createServer(options: ServerOptions): Promise<void> {
    const context = await initializeDependencies(options);
    const { db, testDb, teamDb, testTeamDb, runtime, vectorManager, teamVectorManager, github, configManager, scheduler, allowedIoRoots, activeMetricsPath } = context;
    const { transport, defaultProjectNumber } = options;

    const filterConfig = configManager.getConfig().toolFilterConfig;
    
    const baseConfig: ToolHandlerConfig = {
        defaultProjectNumber,
        defaultWorkspaceId: options.defaultWorkspaceId,
        projectRegistry: options.projectRegistry,
        additionalTeamDbs: options.additionalTeamDbs,

        allowedIoRoots,
        filterConfig,
        authEnabled: Boolean(options.authToken ?? process.env['MCP_AUTH_TOKEN']),
        oauthEnabled: options.oauthEnabled,
        codemodeEnabled: true,
        codemodeInternalFullAccess: options.codemodeInternalFullAccess,
        teamDefaultRole: options.teamDefaultRole,
        teamAdmin: options.teamAdmin,
        runtime,
        subscriptionManager: globalSubscriptionManager,
    }

    const dispatch = (name: string, args: Record<string, unknown>): Promise<unknown> =>
        callTool(
            name,
            args,
            db,
            vectorManager,
            github,
            baseConfig,
            undefined,
            teamDb ?? undefined,
            teamVectorManager ?? undefined
        )

    const customToolHandlerConfig: ToolHandlerConfig = { ...baseConfig, dispatch }

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
    configManager.on('changed', () => {
        // Send tool list changed notification if using SSE/HTTP
        void globalSubscriptionManager.notifyResourceUpdated('memory://briefing')
        try {
            // Notify MCP clients that tools might have changed (e.g. tool filter updated)
            void globalSubscriptionManager.broadcastNotification('notifications/tools/list_changed')
            // Also notify that resources might have changed (for good measure)
            void globalSubscriptionManager.broadcastNotification('notifications/resources/list_changed')
        } catch (error: unknown) {
            logger.debug('Failed to send list_changed notifications to MCP client', {
                module: 'McpServer',
                error: error instanceof Error ? error.message : String(error)
            })
        }
    })

    const getServerInstance = (): McpServer => createServerInstance(
        context,
        options,
        prompts as PromptDefinition[],
        resources as ResourceDefinition[],
        allTools,
        allToolNames,
        customToolHandlerConfig
    );

    let shutdownMetrics: (() => Promise<void>) | undefined;
    if (options.metricsExport === 'prometheus') {
        shutdownMetrics = startMetricsServer(runtime);
    }

    // Start server based on transport
    if (transport === 'stdio') {
        const stdioTransport = new StdioServerTransport()
        const server = getServerInstance()
        await server.connect(stdioTransport)
        logger.info('MCP server started on stdio', { module: 'McpServer' })

        const handleStdioShutdown = (): void => {
            logger.info('Shutting down...', { module: 'McpServer' })
            // Flush audit log before exit
            if (runtime.auditLogger) {
                void runtime.auditLogger.close()
            }
            if (shutdownMetrics) {
                void shutdownMetrics().catch((err: unknown) => {
                    logger.debug('Error shutting down metrics server', { module: 'McpServer', error: String(err) })
                });
            }
            if (activeMetricsPath) {
                void runtime.metrics.saveToFile(activeMetricsPath).then(() => {
                    db.close()
                    testDb?.close()
                    teamDb?.close()
                    testTeamDb?.close()
                    process.exit(0)
                })
            } else {
                db.close()
                testDb?.close()
                teamDb?.close()
                testTeamDb?.close()
                process.exit(0)
            }
        }

        // Handle shutdown for stdio
        process.on('SIGINT', handleStdioShutdown)
        process.on('SIGTERM', handleStdioShutdown)
    } else {
        // HTTP transport
        const port = options.port ?? 3000
        const host = options.host ?? 'localhost'
        const corsRaw = process.env['MCP_CORS_ORIGIN']
        const corsOrigins =
            options.corsOrigins ?? (corsRaw ? corsRaw.split(',').map((s) => s.trim()) : [])
        const authToken = options.authToken ?? process.env['MCP_AUTH_TOKEN'] ?? undefined

        const httpTransport = new HttpTransport({
            port,
            host,
            corsOrigins,
            stateless: options.statelessHttp === true,
            authToken,
            enableHSTS: options.enableHSTS,
            oauthEnabled: options.oauthEnabled,
            oauthIssuer: options.oauthIssuer,
            oauthAudience: options.oauthAudience,
            oauthJwksUri: options.oauthJwksUri,
            oauthClockTolerance: options.oauthClockTolerance,
            allowPlaintextLoopbackOAuth: options.allowPlaintextLoopbackOAuth,
            trustProxy: options.trustProxy,
            publicOrigin: options.publicOrigin,
            metricsExport: options.metricsExport,
        })

        await httpTransport.start(getServerInstance, scheduler, runtime)

        const handleHttpShutdown = (): void => {
            void (async () => {
                if (shutdownMetrics) {
                    await shutdownMetrics().catch((err: unknown) => {
                    logger.debug('Error shutting down metrics server', { module: 'McpServer', error: String(err) })
                });
                }
                await httpTransport.stop(scheduler)
                // Flush audit log before exit
                if (runtime.auditLogger) {
                    await runtime.auditLogger.close()
                }
                if (activeMetricsPath) {
                    await runtime.metrics.saveToFile(activeMetricsPath)
                }
                db.close()
                testDb?.close()
                teamDb?.close()
                testTeamDb?.close()
                process.exit(0)
            })()
        }

        // Handle shutdown
        process.on('SIGINT', handleHttpShutdown)
        process.on('SIGTERM', handleHttpShutdown)
    }
}


