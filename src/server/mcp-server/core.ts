import { type McpServer } from '@modelcontextprotocol/server'
import { getTools, callTool } from '../../handlers/tools/index.js'
import { getRequiredScope } from '../../auth/scope-map.js'
import { getResources } from '../../handlers/resources/index.js'
import { getPrompts } from '../../handlers/prompts/index.js'
import type { ToolHandlerConfig } from '../../types/index.js'
import type { PromptDefinition, ResourceDefinition } from '../registration.js'

import type { ServerOptions } from './types.js'
import { initializeDependencies } from './initialization.js'
import { createServerInstance } from './tool-registration.js'
import { startMetricsServer } from '../../observability/metrics-server.js'
import { logger } from '../../utils/logger.js'
import type { ServerRuntime } from '../../utils/maintenance-lock.js'
import { buildBaseToolConfig, closeServerResources } from './core-helpers.js'
import { closeCrossTeamAdapters } from '../../handlers/tools/search/cross-team.js'
import { resolveActiveBriefingConfig } from './tool-registration/register-tools-helpers.js'
import {
    registerConfigChangeListener,
    startSelectedTransport,
} from './server-lifecycle-helpers.js'

/**
 * Starts the standalone Prometheus metrics server when allowed by auth/OAuth configuration.
 * Skips unauthenticated standalone startup if OAuth 2.1 is enabled without a static token.
 */
export function startConfiguredMetricsServer(
    runtime: ServerRuntime,
    options: Pick<ServerOptions, 'metricsExport' | 'metricsPort' | 'authToken' | 'oauthEnabled'>
): (() => Promise<void>) | undefined {
    if (options.metricsExport !== 'prometheus') {
        return undefined
    }
    const envToken = process.env['MCP_AUTH_TOKEN']?.trim()
    const effectiveAuthToken =
        options.authToken !== undefined && options.authToken !== ''
            ? options.authToken
            : envToken !== undefined && envToken !== ''
              ? envToken
              : undefined
    if (options.oauthEnabled === true && effectiveAuthToken === undefined) {
        logger.warning(
            'Standalone metrics server (:9465) skipped because OAuth 2.1 is enabled without a static --auth-token / MCP_AUTH_TOKEN; scrape OAuth-protected /metrics on the HTTP transport instead.',
            { module: 'MetricsServer' }
        )
        return undefined
    }
    return startMetricsServer(runtime, options.metricsPort, {
        ...(effectiveAuthToken !== undefined ? { authToken: effectiveAuthToken } : {}),
    })
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
        allowedIoRoots
    )
    if (baseConfig.defaultProjectNumber === undefined && baseConfig.briefingConfig.defaultProjectNumber !== undefined) {
        baseConfig.defaultProjectNumber = baseConfig.briefingConfig.defaultProjectNumber
    }
    if (baseConfig.defaultWorkspaceId === undefined && baseConfig.briefingConfig.defaultWorkspaceId !== undefined) {
        baseConfig.defaultWorkspaceId = baseConfig.briefingConfig.defaultWorkspaceId
    }
    if (baseConfig.projectRegistry === undefined && baseConfig.briefingConfig.projectRegistry !== undefined) {
        baseConfig.projectRegistry = baseConfig.briefingConfig.projectRegistry
    }

    const customToolHandlerConfig: ToolHandlerConfig = { ...baseConfig }
    customToolHandlerConfig.dispatch = (name: string, args: Record<string, unknown>): Promise<unknown> =>
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

    const allTools = getTools(
        db,
        null,
        vectorManager,
        github,
        customToolHandlerConfig,
        teamDb ?? undefined,
        teamVectorManager ?? undefined
    )
    const allToolNames = new Set(allTools.map((t) => t.name))
    for (const toolName of allToolNames) getRequiredScope(toolName)

    const resources = getResources()
    const prompts = getPrompts()

    registerConfigChangeListener({
        configManager,
        options,
        allowedIoRoots,
        baseConfig,
        customToolHandlerConfig,
        scheduler,
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

    const shutdownMetrics = startConfiguredMetricsServer(runtime, options)
    const closeDatabases = (): void => {
        closeServerResources([db, testDb, teamDb, testTeamDb])
        closeCrossTeamAdapters()
    }

    try {
        await startSelectedTransport({
            options,
            getServerInstance,
            scheduler,
            runtime,
            configManager,
            shutdownMetrics,
            activeMetricsPath,
            closeDatabases,
        })
    } catch (startupError) {
        scheduler?.stop()
        runtime.stopBackgroundTasks?.()
        configManager.close()
        if (shutdownMetrics !== undefined) {
            await shutdownMetrics().catch(() => undefined)
        }
        await runtime.auditLogger?.close().catch(() => undefined)
        closeDatabases()
        throw startupError
    }
}
