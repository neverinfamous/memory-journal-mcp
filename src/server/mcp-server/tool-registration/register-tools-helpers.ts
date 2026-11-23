import { readResource } from '../../../handlers/resources/index.js'
import type { ToolHandlerConfig } from '../../../types/index.js'
import type { DEFAULT_BRIEFING_CONFIG } from '../../../handlers/resources/shared.js'
import { globalSubscriptionManager } from '../../subscription-manager.js'
import { logAgentIssue } from '../../../utils/issue-logger.js'
import { formatHandlerError } from '../../../utils/error-helpers.js'
import { getSerializedPayloadJson } from '../../../observability/token-estimator.js'
import { findCanonicalRegistryKey, getActiveSessionProject } from '../../../utils/workspace-resolver.js'
import { activeProjectRegistry, pairStoredScope } from '../../../utils/write-scope.js'
import type { ServerContext, ServerOptions } from '../types.js'
export {
    buildServerInstructions,
    getCachedReadOnlyHints,
} from './server-instructions-cache.js'
export {
    isStandardSchemaWithJson,
    relaxInputSchemaForMcp,
    relaxOutputSchemaForMcp,
} from './schema-relaxation.js'

/**
 * Helpers extracted from `createServerInstance` (instruction generation, mutation
 * notifications, error formatting, briefing config resolution). Behaviour is unchanged.
 */

export const MUTATING_TOOLS = new Set([
    'create_entry',
    'update_entry',
    'delete_entry',
    'restore_entry',
    'batch_create_entries',
    'batch_update_entries',
    'batch_delete_entries',
    'team_add_member',
    'team_update_member_role',
    'team_remove_member',
])

/** Notify resource subscribers after a successful state-mutating tool call. */
export function notifyMutationSubscribers(toolName: string): void {
    void globalSubscriptionManager.notifyResourceUpdated('memory://briefing')
    void globalSubscriptionManager.notifyResourceUpdated('memory://recent')
    void globalSubscriptionManager.notifyResourceUpdated('memory://statistics')

    if (toolName.startsWith('team_')) {
        void globalSubscriptionManager.notifyResourceUpdated('memory://team/recent')
        void globalSubscriptionManager.notifyResourceUpdated('memory://team/statistics')
    }
}

/** Convert a thrown tool error into the structured error payload and log it for agent healing. */
export function formatToolFailure(
    error: unknown,
    toolName: string,
    args: unknown
): Record<string, unknown> {
    const errorResult: Record<string, unknown> = { ...formatHandlerError(error) }

    logAgentIssue(
        {
            source: 'MCP',
            action: toolName,
            input: args,
            error: (errorResult['error'] as string) ?? 'Unknown error',
        },
        error
    )
    return errorResult
}

function resolveDefaultBriefingProject(params: {
    canonicalWs: string | undefined
    canonicalConfigWs: string | undefined
    registryProject: number | undefined
    applicableDefaultProj: number | undefined
    resolvedRegistry: typeof DEFAULT_BRIEFING_CONFIG['projectRegistry']
    sessionCtx: { workspaceId?: string; projectNumber?: number }
}): number | undefined {
    const {
        canonicalWs,
        canonicalConfigWs,
        registryProject,
        applicableDefaultProj,
        resolvedRegistry,
        sessionCtx,
    } = params

    if (canonicalConfigWs !== undefined && applicableDefaultProj !== undefined) {
        return (
            pairStoredScope(
                canonicalConfigWs,
                applicableDefaultProj,
                activeProjectRegistry(resolvedRegistry)
            ).projectNumber ?? undefined
        )
    }

    const sessionMatchesWs =
        sessionCtx.workspaceId === undefined ||
        canonicalWs === undefined ||
        sessionCtx.workspaceId.toLowerCase() === canonicalWs.toLowerCase()
    const candidateProj =
        applicableDefaultProj ?? registryProject ?? (sessionMatchesWs ? sessionCtx.projectNumber : undefined)
    const claimedElsewhere =
        canonicalWs !== undefined &&
        candidateProj !== undefined &&
        resolvedRegistry !== undefined &&
        Object.entries(resolvedRegistry).some(
            ([k, v]) => v.project_number === candidateProj && k.toLowerCase() !== canonicalWs.toLowerCase()
        )
    if (canonicalConfigWs === undefined && claimedElsewhere) return registryProject

    if (
        canonicalConfigWs !== undefined &&
        registryProject === undefined &&
        sessionCtx.projectNumber !== undefined &&
        candidateProj === sessionCtx.projectNumber &&
        claimedElsewhere
    ) {
        return undefined
    }

    if (canonicalWs?.toLowerCase() === 'default' && registryProject === undefined) {
        if (canonicalConfigWs?.toLowerCase() === 'default' && applicableDefaultProj !== undefined) {
            return applicableDefaultProj
        }
        return sessionCtx.workspaceId?.toLowerCase() === 'default'
            ? sessionCtx.projectNumber
            : undefined
    }
    return candidateProj
}

const activeBriefingConfigCache = new WeakMap<
    object,
    { roots: string[]; resolved: typeof DEFAULT_BRIEFING_CONFIG }
>()

/**
 * Merge live briefing config with server-level defaults.
 * [INVARIANT] Sticky session context is only consulted when `sessionRuntime` is supplied
 * (ephemeral, per-read resource/prompt resolution). Tool calls pass `undefined` so session
 * state is never written onto the shared `customToolHandlerConfig` (C1).
 * Explicit configured `defaultProjectNumber` wins over the registry-derived project.
 */
export function resolveActiveBriefingConfig(
    briefingConfig: typeof DEFAULT_BRIEFING_CONFIG,
    allowedIoRoots: string[],
    sessionRuntime?: object | null
): typeof DEFAULT_BRIEFING_CONFIG {
    if (sessionRuntime === undefined) {
        const cached = activeBriefingConfigCache.get(briefingConfig)
        if (cached?.roots === allowedIoRoots) {
            return cached.resolved
        }
    }
    const sessionCtx: { workspaceId?: string; projectNumber?: number } =
        sessionRuntime !== undefined ? getActiveSessionProject(sessionRuntime) : {}
    const resolvedRegistry = briefingConfig.projectRegistry
    const resolvedDefaultWs = briefingConfig.defaultWorkspaceId ?? sessionCtx.workspaceId
    const canonicalWs =
        resolvedDefaultWs !== undefined
            ? (findCanonicalRegistryKey(resolvedDefaultWs, resolvedRegistry) ?? resolvedDefaultWs)
            : undefined
    const canonicalConfigWs =
        briefingConfig.defaultWorkspaceId !== undefined
            ? (findCanonicalRegistryKey(briefingConfig.defaultWorkspaceId, resolvedRegistry) ??
              briefingConfig.defaultWorkspaceId)
            : undefined
    const briefingDefaultApplies =
        canonicalConfigWs === undefined ||
        canonicalConfigWs.toLowerCase() === canonicalWs?.toLowerCase()
    const registryProject =
        canonicalWs !== undefined && resolvedRegistry !== undefined && Object.hasOwn(resolvedRegistry, canonicalWs)
            ? resolvedRegistry[canonicalWs]?.project_number
            : undefined
    const applicableDefaultProj = briefingDefaultApplies
        ? briefingConfig.defaultProjectNumber
        : undefined
    const resolvedDefaultProj = resolveDefaultBriefingProject({
        canonicalWs,
        canonicalConfigWs,
        registryProject,
        applicableDefaultProj,
        resolvedRegistry,
        sessionCtx,
    })
    const nextConfig: typeof DEFAULT_BRIEFING_CONFIG = {
        ...briefingConfig,
        allowedIoRoots,
    }
    if (resolvedDefaultProj !== undefined) nextConfig.defaultProjectNumber = resolvedDefaultProj
    else delete nextConfig.defaultProjectNumber
    if (resolvedRegistry !== undefined) nextConfig.projectRegistry = resolvedRegistry
    else delete nextConfig.projectRegistry
    if (resolvedDefaultWs !== undefined) nextConfig.defaultWorkspaceId = resolvedDefaultWs
    else delete nextConfig.defaultWorkspaceId
    if (sessionRuntime === undefined) {
        activeBriefingConfigCache.set(briefingConfig, {
            roots: allowedIoRoots,
            resolved: nextConfig,
        })
    }
    return nextConfig
}

/** Wrap `server.close` and `server.server.onclose` so non-HTTP `stdio` subscriptions release on close. */
export function attachStdioCloseCleanup(server: Parameters<typeof globalSubscriptionManager.registerServer>[1]): void {
    const unregister = (): void => {
        globalSubscriptionManager.unregisterServerIfMatch('stdio', server)
    }
    const serverWithClose = server as {
        close?: () => Promise<void>
        server?: { onclose?: (() => void) | undefined }
    }
    const origClose = serverWithClose.close
    if (typeof origClose === 'function') {
        serverWithClose.close = async () => {
            unregister()
            return origClose.call(server)
        }
    }
    const inner = serverWithClose.server
    if (inner !== undefined && typeof inner === 'object') {
        const prevOnClose = inner.onclose
        inner.onclose = () => {
            unregister()
            prevOnClose?.()
        }
    }
}

/**
 * Synchronize live runtime config & resolved briefing defaults onto a shared `ToolHandlerConfig`.
 */
export function syncLiveHandlerConfig(
    target: ToolHandlerConfig,
    liveConfig: ReturnType<ServerContext['configManager']['getConfig']>,
    options: ServerOptions,
    liveBriefing: ReturnType<typeof resolveActiveBriefingConfig>
): void {
    if (target.briefingConfig !== liveBriefing) {
        target.briefingConfig = liveBriefing
    }
    if (target.filterConfig !== liveConfig.toolFilterConfig) {
        target.filterConfig = liveConfig.toolFilterConfig
    }
    const nextFullAccess = liveConfig.codemodeInternalFullAccess ?? options.codemodeInternalFullAccess
    if (target.codemodeInternalFullAccess !== nextFullAccess) {
        if (nextFullAccess !== undefined) target.codemodeInternalFullAccess = nextFullAccess
        else if ('codemodeInternalFullAccess' in target) delete target.codemodeInternalFullAccess
    }
    if (target.defaultProjectNumber !== liveBriefing.defaultProjectNumber) {
        if (liveBriefing.defaultProjectNumber !== undefined) {
            target.defaultProjectNumber = liveBriefing.defaultProjectNumber
        } else if ('defaultProjectNumber' in target) {
            delete target.defaultProjectNumber
        }
    }
    if (target.defaultWorkspaceId !== liveBriefing.defaultWorkspaceId) {
        if (liveBriefing.defaultWorkspaceId !== undefined) {
            target.defaultWorkspaceId = liveBriefing.defaultWorkspaceId
        } else if ('defaultWorkspaceId' in target) {
            delete target.defaultWorkspaceId
        }
    }
    if (target.projectRegistry !== liveBriefing.projectRegistry) {
        if (liveBriefing.projectRegistry !== undefined) {
            target.projectRegistry = liveBriefing.projectRegistry
        } else if ('projectRegistry' in target) {
            delete target.projectRegistry
        }
    }
}

function normalizeRfc3339(ts: string): string {
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(ts)) {
        return `${ts.replace(' ', 'T')}Z`
    }
    return ts
}

/**
 * Create the MCP resource read callback bound to live config and runtime metrics.
 */
export function createResourceReadHandler(
    context: ServerContext,
    options: ServerOptions
): (
    uri: URL,
    mimeType: string
) => Promise<{
    contents: {
        uri: string
        mimeType: string
        text: string
        annotations?: Record<string, unknown>
    }[]
}> {
    const { configManager, db, teamDb, vectorManager, github, allowedIoRoots, runtime } =
        context
    return async (uri: URL, mimeType: string) => {
        const currentConfig = configManager.getConfig()
        const baseBriefing = resolveActiveBriefingConfig(
            currentConfig.briefingConfig,
            allowedIoRoots,
            runtime
        )
        const activeBriefingConfig =
            options.instructionLevel !== undefined
                ? { ...baseBriefing, instructionLevel: options.instructionLevel }
                : baseBriefing

        try {
            const result = await readResource(
                uri.href,
                db,
                vectorManager,
                currentConfig.toolFilterConfig,
                github,
                teamDb ?? undefined,
                activeBriefingConfig,
                runtime
            )

            runtime.metrics.recordResourceRead(uri.href, false)

            const dataStr =
                typeof result.data === 'string'
                    ? result.data
                    : getSerializedPayloadJson(result.data)
            const normalizedAnnotations =
                result.annotations !== undefined
                    ? {
                          ...result.annotations,
                          ...(result.annotations.lastModified !== undefined
                              ? { lastModified: normalizeRfc3339(result.annotations.lastModified) }
                              : {}),
                      }
                    : undefined
            return {
                contents: [
                    {
                        uri: uri.href,
                        mimeType,
                        text: dataStr,
                        ...(normalizedAnnotations !== undefined
                            ? { annotations: normalizedAnnotations }
                            : {}),
                    },
                ],
            }
        } catch (error) {
            runtime.metrics.recordResourceRead(uri.href, true)
            throw error
        }
    }
}
