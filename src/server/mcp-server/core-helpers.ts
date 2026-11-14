import { logger } from '../../utils/logger.js'
import { globalSubscriptionManager } from '../subscription-manager.js'
import { disposeCodemodeResources } from '../../handlers/tools/codemode/singleton-state.js'
import type { HttpTransportConfig } from '../../transports/http/index.js'
import type { ToolHandlerConfig } from '../../types/index.js'
import type { ServerRuntime } from '../../utils/maintenance-lock.js'
import type { IDatabaseAdapter } from '../../database/core/interfaces.js'
import type { ServerOptions } from './types.js'

/**
 * Helpers extracted from `createServer`: tool handler config, HTTP transport config,
 * and shutdown utilities. Behaviour is unchanged.
 */

/** Build the shared tool handler configuration from server options and initialized context. */
export function buildBaseToolConfig(
    options: ServerOptions,
    runtime: ServerRuntime,
    allowedIoRoots: string[],
    filterConfig: ToolHandlerConfig['filterConfig']
): ToolHandlerConfig {
    return {
        defaultProjectNumber: options.defaultProjectNumber,
        defaultWorkspaceId: options.defaultWorkspaceId,
        projectRegistry: options.projectRegistry,
        additionalTeamDbs: options.additionalTeamDbs,

        allowedIoRoots,
        filterConfig,
        authEnabled: Boolean(options.authToken ?? process.env['MCP_AUTH_TOKEN']),
        oauthEnabled: options.oauthEnabled,
        codemodeEnabled: true,
        codemodeInternalFullAccess: options.codemodeInternalFullAccess,
        agentHealing: options.agentHealing,
        teamDefaultRole: options.teamDefaultRole,
        teamAdmin: options.teamAdmin,
        runtime,
        subscriptionManager: globalSubscriptionManager,
        archiveOlderThanDays: options.archiveOlderThanDays,
        pruneOlderThanDays: options.pruneOlderThanDays,
        hardDeleteOlderThanDays: options.hardDeleteOlderThanDays,
        pruneImportanceThreshold: options.pruneImportanceThreshold,
        ...(options.pruneExcludeTags !== undefined
            ? { pruneExcludeTags: options.pruneExcludeTags }
            : {}),
    }
}

/** Build the HTTP transport configuration (port, CORS, auth, OAuth, metrics) from options/env. */
export function buildHttpTransportConfig(options: ServerOptions): HttpTransportConfig {
    const corsRaw = process.env['MCP_CORS_ORIGIN']
    const corsOrigins =
        options.corsOrigins ?? (corsRaw ? corsRaw.split(',').map((s) => s.trim()) : [])
    const authToken = options.authToken ?? process.env['MCP_AUTH_TOKEN'] ?? undefined

    return {
        port: options.port ?? 3000,
        host: options.host ?? 'localhost',
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
    }
}

export function logShutdownError(step: string, error: unknown): void {
    logger.error(`Error during ${step}`, {
        module: 'McpServer',
        error: error instanceof Error ? error.message : String(error),
    })
}

/** Run a shutdown step; failures are logged so later steps (DB close, exit) still run. */
export async function runShutdownStep(step: string, fn: () => Promise<void>): Promise<void> {
    try {
        await fn()
    } catch (error: unknown) {
        logShutdownError(step, error)
    }
}

/**
 * Wait briefly for any in-flight background vector initialization to settle so DB
 * handles are not closed mid-write during rapid shutdown or aborted startup (L5).
 */
export async function awaitPendingVectorInit(
    runtime: { pendingVectorInit?: Promise<void> | null } | undefined,
    timeoutMs = 2000
): Promise<void> {
    const pending = runtime?.pendingVectorInit
    if (pending === undefined || pending === null) return
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
        await Promise.race([
            pending.catch(() => undefined),
            new Promise<void>((resolve) => {
                timer = setTimeout(resolve, timeoutMs)
                timer.unref()
            }),
        ])
    } finally {
        if (timer !== undefined) clearTimeout(timer)
    }
}

/** Dispose codemode resources and close every database handle, logging (not throwing) failures. */
export function closeServerResources(
    handles: (Pick<IDatabaseAdapter, 'close'> | undefined)[]
): void {
    try {
        disposeCodemodeResources()
    } catch (error: unknown) {
        logShutdownError('codemode dispose', error)
    }
    for (const handle of handles) {
        try {
            handle?.close()
        } catch (error: unknown) {
            logShutdownError('database close', error)
        }
    }
}
