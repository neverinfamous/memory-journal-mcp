/**
 * ConfigManager initialization, startup auto-prune/digest jobs, and I/O root validation.
 */

import type { IDatabaseAdapter } from '../../database/core/interfaces.js'
import type { VectorSearchManager } from '../../vector/vector-search-manager/index.js'
import { DEFAULT_BRIEFING_CONFIG } from '../../handlers/resources/shared.js'
import { ConfigManager } from '../../utils/config-manager.js'
import type { ServerRuntime } from '../../utils/maintenance-lock.js'
import { logger } from '../../utils/logger.js'
import type { Scheduler } from '../scheduler.js'
import {
    createSchedulerIfConfigured,
    resolveToolFilterConfig,
    runStartupAutoPrune,
    seedInitialDigest,
} from './initialization-helpers.js'
import type { ServerOptions } from './types.js'

export async function initConfigAndStartupJobs(params: {
    options: ServerOptions
    db: IDatabaseAdapter
    vectorManager: VectorSearchManager | null
    runtime: ServerRuntime
}): Promise<{ configManager: ConfigManager; scheduler: Scheduler | null }> {
    const { options, db, vectorManager, runtime } = params
    const filterConfig = resolveToolFilterConfig(options)
    const rawToolFilter =
        options.toolFilter ??
        process.env['MEMORY_JOURNAL_MCP_TOOL_FILTER'] ??
        process.env['TOOL_FILTER']

    const configManager = new ConfigManager(
        {
            rawToolFilter,
            toolFilterConfig: filterConfig,
            briefingConfig: {
                ...(options.briefingConfig ?? DEFAULT_BRIEFING_CONFIG),
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
            codemodeInternalFullAccess: options.codemodeInternalFullAccess,
        },
        options.configFilePath
    )

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

    const scheduler = createSchedulerIfConfigured(
        effectiveOptions,
        db,
        vectorManager ?? undefined,
        runtime
    )
    seedInitialDigest(db, effectiveOptions)

    return { configManager, scheduler }
}

export function resolveFinalAllowedIoRoots(options: ServerOptions): string[] {
    let finalAllowedIoRoots = options.allowedIoRoots
    if (!finalAllowedIoRoots) {
        if (options.transport === 'http') {
            const errorMsg = `FATAL: Refusing to bind HTTP transport without explicit ALLOWED_IO_ROOTS. You MUST specify --allowed-io-roots (or ALLOWED_IO_ROOTS env var) to prevent ambient filesystem authority.`
            logger.error(errorMsg, { module: 'HTTP' })
            throw new Error(errorMsg)
        }
        finalAllowedIoRoots = []
        logger.warning(
            '⚠️ SECURITY WARNING: ALLOWED_IO_ROOTS not explicitly provided. Defaulting to empty array (NO filesystem access). You MUST specify --allowed-io-roots (or ALLOWED_IO_ROOTS env var) to enable filesystem tools.',
            { module: 'McpServer' }
        )
    }

    logger.info('IO sandbox configured', {
        module: 'McpServer',
        allowedRoots: finalAllowedIoRoots,
    })

    return finalAllowedIoRoots
}
